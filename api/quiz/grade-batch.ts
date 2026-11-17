import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(data: unknown): void;
}

const GRADING_MODEL_CANDIDATES = [
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
] as const;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'by', 'is',
  'are', 'was', 'were', 'be', 'being', 'been', 'it', 'its', 'with', 'from', 'that',
  'this', 'as', 'into', 'between', 'which', 'who', 'what', 'when', 'where', 'their',
]);

function normalizeForFastCheck(raw: string): string {
  let cleaned = String(raw || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[^\p{L}\p{N}\s.%+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/\b(\d+(?:\.\d+)?)k\b/g, (_, num) =>
    String(Math.round(Number(num) * 1000))
  );
  cleaned = cleaned.replace(/\b(\d+)%/g, '$1 percent');
  cleaned = cleaned.replace(/[.%+-]+/g, ' ').replace(/\s+/g, ' ').trim();

  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(?:the|a|an)\s+/i, '').trim();
  }
  return cleaned;
}

function fastLocalCheck(studentAnswer: string, officialAnswer: string): boolean {
  const studentNorm = normalizeForFastCheck(studentAnswer);
  if (!studentNorm) return false;
  const officialNorm = normalizeForFastCheck(officialAnswer);
  if (!officialNorm) return false;
  if (studentNorm === officialNorm) return true;

  const noParen = normalizeForFastCheck(officialAnswer.replace(/\([^)]*\)/g, ' '));
  if (noParen && noParen === studentNorm) return true;

  const parts = officialAnswer
    .split(/\s*[;/]\s*/)
    .map((p) => normalizeForFastCheck(p))
    .filter((p) => p.length >= 2);
  return parts.length > 1 && parts.some((p) => p === studentNorm);
}

function smartSemanticFallbackCheck(studentAnswer: string, officialAnswer: string): boolean {
  if (fastLocalCheck(studentAnswer, officialAnswer)) return true;
  const sTokens = normalizeForFastCheck(studentAnswer)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  const oTokens = normalizeForFastCheck(officialAnswer)
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (!sTokens.length || !oTokens.length) return false;

  const matched = oTokens.filter((ot) =>
    sTokens.some((st) => st === ot || (st.length >= 5 && ot.length >= 5 && st.startsWith(ot.slice(0, 5))))
  ).length;
  return matched / oTokens.length >= 0.65 && matched / sTokens.length >= 0.45;
}

interface BatchItem {
  id: string;
  question: string;
  officialAnswer: string;
  studentAnswer: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.status(200).json({ ok: true });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let body: Record<string, unknown> = {};
  if (typeof req.body === 'string') {
    try {
      body = JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      res.status(400).json({ error: 'Invalid JSON body.' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as Record<string, unknown>;
  }

  let items: BatchItem[] = [];
  if (Array.isArray(body.items)) {
    items = body.items.map((raw, idx) => {
      const it = (raw || {}) as Record<string, unknown>;
      return {
        id: String(it.id || `item_${idx}`),
        question: String(it.question || ''),
        officialAnswer: String(it.officialAnswer || ''),
        studentAnswer: String(it.studentAnswer ?? it.playerAnswer ?? ''),
      };
    });
  } else if (Array.isArray(body.submissions)) {
    const question = String(body.question || '');
    const officialAnswer = String(body.officialAnswer || '');
    items = body.submissions.map((raw, idx) => {
      const it = (raw || {}) as Record<string, unknown>;
      return {
        id: String(it.id || it.playerId || `item_${idx}`),
        question,
        officialAnswer,
        studentAnswer: String(it.studentAnswer ?? it.answer ?? ''),
      };
    });
  }

  if (!items.length) {
    res.status(200).json({ results: [] });
    return;
  }

  const results = new Map<string, { id: string; correct: boolean; source: 'local' | 'ai' | 'fallback' }>();
  const needsAi: BatchItem[] = [];

  for (const item of items) {
    if (!item.studentAnswer.trim()) {
      results.set(item.id, { id: item.id, correct: false, source: 'local' });
    } else if (fastLocalCheck(item.studentAnswer, item.officialAnswer)) {
      results.set(item.id, { id: item.id, correct: true, source: 'local' });
    } else {
      needsAi.push(item);
    }
  }

  if (needsAi.length > 0) {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
      for (const item of needsAi) {
        results.set(item.id, {
          id: item.id,
          correct: smartSemanticFallbackCheck(item.studentAnswer, item.officialAnswer),
          source: 'fallback',
        });
      }
    } else {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
      const promptLines = needsAi
        .map(
          (it, idx) =>
            `${idx + 1}. [id=${it.id}] Q: ${it.question} | Official: ${it.officialAnswer} | Student: ${it.studentAnswer}`
        )
        .join('\n');

      const responseSchema = {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            correct: { type: Type.BOOLEAN },
          },
          required: ['id', 'correct'],
        },
      };

      let graded = false;
      for (const model of GRADING_MODEL_CANDIDATES) {
        const thinkingLevel = model === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL;
        try {
          const response = await Promise.race([
            ai.models.generateContent({
              model,
              contents: promptLines,
              config: {
                systemInstruction:
                  'Grade each numbered student flashcard answer generously by core factual meaning against the official answer (accepting abbreviations, synonyms, unit formats, and month+year dates like "Nov 1918" for "9 November 1918"). Return strict JSON array of {id, correct}.',
                thinkingConfig: { thinkingLevel },
                responseMimeType: 'application/json',
                responseSchema,
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Gemini batch timeout')), 5000)
            ),
          ]);

          const parsed = JSON.parse((response.text || '[]').trim()) as Array<{
            id: string;
            correct: boolean;
          }>;
          const aiMap = new Map<string, boolean>();
          if (Array.isArray(parsed)) {
            parsed.forEach((row) => {
              if (row && typeof row.id === 'string') {
                aiMap.set(row.id, Boolean(row.correct));
              }
            });
          }
          for (const item of needsAi) {
            results.set(item.id, {
              id: item.id,
              correct: aiMap.get(item.id) ?? false,
              source: 'ai',
            });
          }
          graded = true;
          break;
        } catch {
          continue;
        }
      }

      if (!graded) {
        for (const item of needsAi) {
          results.set(item.id, {
            id: item.id,
            correct: smartSemanticFallbackCheck(item.studentAnswer, item.officialAnswer),
            source: 'fallback',
          });
        }
      }
    }
  }

  res.status(200).json({
    results: items.map((it) => results.get(it.id) || { id: it.id, correct: false, source: 'fallback' }),
  });
}
