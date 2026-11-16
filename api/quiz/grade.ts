import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(data: unknown): void;
  setHeader(name: string, value: string): void;
}

const GRADING_MODEL_CANDIDATES = [
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
];

const GRADING_SYSTEM_INSTRUCTION =
  'You are grading a fast-paced classroom flashcard quiz. Grade generously by core factual meaning against the Official Answer. Rules: (1) Abbreviations, month+year dates omitting the exact day (e.g. "Nov 1918" for "9 November 1918"), synonyms, short phrasings, and minor spelling typos ARE CORRECT. (2) Only mark false if the answer is factually wrong, refers to a different event/date/entity, or misses the core fact. Output ONLY strict JSON {"correct": true} or {"correct": false}.';

function normalizeForFastCheck(raw: string): string {
  let cleaned = String(raw || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

  const parts = officialAnswer
    .split(/\s*[;/]\s*/)
    .map((p) => normalizeForFastCheck(p))
    .filter((p) => p.length >= 2);
  return parts.length > 1 && parts.some((p) => p === studentNorm);
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

  const question = String(body.question || '').trim();
  const officialAnswer = String(body.officialAnswer || '').trim();
  const studentAnswer = String(body.studentAnswer ?? body.playerAnswer ?? '').trim();

  if (!question || !officialAnswer) {
    res.status(400).json({ error: 'question and officialAnswer are required.' });
    return;
  }

  if (!studentAnswer) {
    res.status(200).json({ correct: false, source: 'local', latencyMs: 0 });
    return;
  }

  if (fastLocalCheck(studentAnswer, officialAnswer)) {
    res.status(200).json({ correct: true, source: 'local', latencyMs: 0 });
    return;
  }

  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    res.status(200).json({
      correct: false,
      source: 'fallback',
      latencyMs: 0,
      error: 'GEMINI_API_KEY not configured on server',
    });
    return;
  }

  const started = Date.now();
  const ai = new GoogleGenAI({ apiKey });
  const contents = `Question: ${question}\nOfficial Answer: ${officialAnswer}\nStudent Answer: ${studentAnswer}`;
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      correct: { type: Type.BOOLEAN },
    },
    required: ['correct'],
  };

  let lastErr: unknown = null;
  for (const model of GRADING_MODEL_CANDIDATES) {
    const isFlashLite = model.includes('flash-lite');
    const thinkingConfig = isFlashLite
      ? { thinkingBudget: 0 }
      : { thinkingLevel: ThinkingLevel.MINIMAL };

    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: GRADING_SYSTEM_INSTRUCTION,
          thinkingConfig,
          ...(isFlashLite ? { maxOutputTokens: 15 } : {}),
          responseMimeType: 'application/json',
          responseSchema,
        },
      });
      const rawText = (response.text || '').trim();
      if (!rawText) throw new Error(`Empty response from ${model}`);

      let correct = false;
      try {
        const parsed = JSON.parse(rawText) as { correct?: boolean };
        correct = Boolean(parsed?.correct);
      } catch {
        correct = /"correct"\s*:\s*true/i.test(rawText);
      }

      res.status(200).json({
        correct,
        source: 'ai',
        latencyMs: Date.now() - started,
        model,
      });
      return;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (/thinkingBudget|thinkingLevel|INVALID_ARGUMENT/i.test(msg)) {
        try {
          const fallbackResp = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: GRADING_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              responseSchema,
            },
          });
          const rawText = (fallbackResp.text || '').trim();
          if (rawText) {
            let correct = false;
            try {
              correct = Boolean((JSON.parse(rawText) as { correct?: boolean })?.correct);
            } catch {
              correct = /"correct"\s*:\s*true/i.test(rawText);
            }
            res.status(200).json({
              correct,
              source: 'ai',
              latencyMs: Date.now() - started,
              model,
            });
            return;
          }
        } catch (innerErr) {
          lastErr = innerErr;
        }
      }
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'Grading failed.');
  res.status(200).json({
    correct: false,
    source: 'fallback',
    latencyMs: Date.now() - started,
    error: msg.slice(0, 220),
  });
}
