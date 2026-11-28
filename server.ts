import 'dotenv/config';
import http from 'http';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createDeck,
  deleteDeck,
  getDeckById,
  getQuizDb,
  listDecks,
  parseCsvCards,
  type ParsedCsvCard,
} from './server/quizDb.ts';
import {
  attachQuizWebSocketServer,
  gradeBatchAnswers,
  gradeSingleAnswer,
} from './server/quizEngine.ts';
import { parseUserAiConfig, registerAiRoutes } from './server/aiRouter.ts';
import { registerWebImportRoutes } from './server/webImport.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePort(): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n > 0) return n;
    } else if (args[i].startsWith('--port=')) {
      const n = Number(args[i].slice('--port='.length));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  const defaultAppPort = Number(process.env.DEFAULT_APP_PORT);
  if (Number.isFinite(defaultAppPort) && defaultAppPort > 0) {
    return defaultAppPort;
  }
  const envPort = Number(process.env.PORT);
  const nginxPort = Number(process.env.NGINX_PORT);
  if (Number.isFinite(envPort) && envPort > 0 && envPort !== nginxPort) {
    return envPort;
  }
  return 3000;
}

const PORT = resolvePort();

const app = express();
app.use(express.json({ limit: '4mb' }));

// Initialize built-in SQLite database at startup
getQuizDb();

registerWebImportRoutes(app);
registerAiRoutes(app);

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    aiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
  });
});

// ============================================================================
// Built-in Database CRUD for Quiz Flashcard Decks
// ============================================================================

app.get('/api/quiz/decks', (_req: Request, res: Response) => {
  try {
    const decks = listDecks();
    res.json({ decks });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to list decks.',
    });
  }
});

app.get('/api/quiz/decks/:id', (req: Request, res: Response) => {
  try {
    const deck = getDeckById(String(req.params.id || ''));
    if (!deck) {
      res.status(404).json({ error: 'Deck not found.' });
      return;
    }
    res.json({ deck });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to load deck.',
    });
  }
});

app.post('/api/quiz/decks', (req: Request, res: Response) => {
  try {
    const body = req.body as {
      title?: string;
      csvText?: string;
      rawText?: string;
      cards?: Array<{ question?: string; answer?: string; section?: string; options?: unknown }>;
    };

    const title = String(body.title || '').trim();
    if (!title) {
      res.status(400).json({ error: 'Deck title is required.' });
      return;
    }

    const rawInput = typeof body.rawText === 'string' ? body.rawText : body.csvText;
    let cards: ParsedCsvCard[] = [];
    if (typeof rawInput === 'string' && rawInput.trim()) {
      cards = parseCsvCards(rawInput);
    } else if (Array.isArray(body.cards)) {
      cards = body.cards
        .map((c) => {
          const opts = Array.isArray(c.options)
            ? c.options.map((x) => String(x || '').trim()).filter(Boolean)
            : undefined;
          return {
            question: String(c.question || '').trim(),
            answer: String(c.answer || '').trim(),
            section: String(c.section || '').trim() || 'General',
            ...(opts && opts.length >= 2 ? { options: opts } : {}),
          };
        })
        .filter((c) => c.question && c.answer);
    }

    if (!cards.length) {
      res.status(400).json({
        error:
          'No valid questions found. Paste CSV (Question, Answer, Section or Question, A, B, C, D, Correct, Section) or MCQ text blocks (Q: / A) * / B) ...).',
      });
      return;
    }

    const deck = createDeck(title, cards);
    res.status(201).json({ deck });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create deck.',
    });
  }
});

app.delete('/api/quiz/decks/:id', (req: Request, res: Response) => {
  try {
    const deleted = deleteDeck(String(req.params.id || ''));
    if (!deleted) {
      res.status(404).json({ error: 'Deck not found.' });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to delete deck.',
    });
  }
});

// ============================================================================
// AI Semantic Grading Endpoints (ONLY used during Quiz Answer Grading)
// ============================================================================

app.post('/api/quiz/grade', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      question?: string;
      officialAnswer?: string;
      studentAnswer?: string;
      byok?: unknown;
    };
    const question = String(body.question || '').trim();
    const officialAnswer = String(body.officialAnswer || '').trim();
    const studentAnswer = String(body.studentAnswer || '').trim();
    if (!question || !officialAnswer) {
      res.status(400).json({ error: 'question and officialAnswer are required.' });
      return;
    }
    const userAiConfig = parseUserAiConfig(body.byok, req.headers);
    const outcome = await gradeSingleAnswer(question, officialAnswer, studentAnswer, userAiConfig);
    res.json(outcome);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Grading failed.',
    });
  }
});

app.post('/api/quiz/grade-batch', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      items?: Array<{
        id?: string;
        question?: string;
        officialAnswer?: string;
        studentAnswer?: string;
      }>;
      byok?: unknown;
    };
    const items = Array.isArray(body.items)
      ? body.items.map((it, idx) => ({
          id: String(it.id || `item_${idx}`),
          question: String(it.question || ''),
          officialAnswer: String(it.officialAnswer || ''),
          studentAnswer: String(it.studentAnswer || ''),
        }))
      : [];

    if (!items.length) {
      res.json({ results: [] });
      return;
    }
    const userAiConfig = parseUserAiConfig(body.byok, req.headers);
    const results = await gradeBatchAnswers(items, userAiConfig);
    res.json({ results });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Batch grading failed.',
    });
  }
});

async function startServer() {
  const httpServer = http.createServer(app);
  attachQuizWebSocketServer(httpServer);

  if (process.env.NODE_ENV !== 'production') {
    const inAiStudioRuntime =
      process.env.DISABLE_HMR === 'true' ||
      Boolean(process.env.CONTROL_PLANE_PORT || process.env.NGINX_PORT || process.env.APPLET_ID);

    const viteReady = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          allowedHosts: true,
          ...(inAiStudioRuntime
            ? { hmr: false, ws: false, watch: null }
            : { ws: { server: httpServer } }),
        },
        appType: 'spa',
      })
    );

    app.use((req, res, next) => {
      viteReady
        .then((vite) => vite.middlewares(req, res, next))
        .catch(next);
    });

    viteReady.catch((err) => {
      console.error('Failed to initialize Vite dev middleware:', err);
      process.exit(1);
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`StudyWeb server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start StudyWeb server:', err);
  process.exit(1);
});
