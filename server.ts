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
  ParsedCsvCard,
} from './server/quizDb.ts';
import {
  attachQuizWebSocketServer,
  gradeBatchAnswers,
  gradeSingleAnswer,
} from './server/quizEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json({ limit: '4mb' }));

// Initialize built-in SQLite database at startup
getQuizDb();

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
      cards?: Array<{ question?: string; answer?: string; section?: string }>;
    };

    const title = String(body.title || '').trim();
    if (!title) {
      res.status(400).json({ error: 'Deck title is required.' });
      return;
    }

    let cards: ParsedCsvCard[] = [];
    if (typeof body.csvText === 'string' && body.csvText.trim()) {
      cards = parseCsvCards(body.csvText);
    } else if (Array.isArray(body.cards)) {
      cards = body.cards
        .map((c) => ({
          question: String(c.question || '').trim(),
          answer: String(c.answer || '').trim(),
          section: String(c.section || '').trim() || 'General',
        }))
        .filter((c) => c.question && c.answer);
    }

    if (!cards.length) {
      res.status(400).json({
        error: 'No valid Question, Answer rows found. Use CSV format: Question, Answer, Section.',
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
    };
    const question = String(body.question || '').trim();
    const officialAnswer = String(body.officialAnswer || '').trim();
    const studentAnswer = String(body.studentAnswer || '').trim();
    if (!question || !officialAnswer) {
      res.status(400).json({ error: 'question and officialAnswer are required.' });
      return;
    }
    const outcome = await gradeSingleAnswer(question, officialAnswer, studentAnswer);
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
    const results = await gradeBatchAnswers(items);
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
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`StudyDeck server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start StudyDeck server:', err);
  process.exit(1);
});
