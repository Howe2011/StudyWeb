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
  'gemini-3.1-flash-lite',
  'gemini-4-hydrogen',
] as const;

const GRADING_SYSTEM_INSTRUCTION =
  'You are grading a fast-paced classroom flashcard quiz. Grade generously by core factual meaning against the Official Answer. Rules: (1) Abbreviations, month+year dates omitting the exact day (e.g. "Nov 1918" for "9 November 1918"), synonyms, short phrasings, unit variations, and minor spelling typos ARE CORRECT. (2) Only mark false if the answer is factually wrong, refers to a different event/date/entity, or misses the core fact. Output ONLY strict JSON {"correct": true} or {"correct": false}.';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'by', 'is',
  'are', 'was', 'were', 'be', 'being', 'been', 'it', 'its', 'with', 'from', 'that',
  'this', 'as', 'into', 'between', 'which', 'who', 'what', 'when', 'where', 'their',
]);

const MONTHS: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
};

const WORD_EQUIV: Record<string, string> = {
  usa: 'united states',
  us: 'united states',
  uk: 'united kingdom',
  gb: 'united kingdom',
  ussr: 'soviet union',
  ww1: 'world war 1',
  wwi: 'world war 1',
  ww2: 'world war 2',
  wwii: 'world war 2',
  dna: 'deoxyribonucleic acid',
  rna: 'ribonucleic acid',
  atp: 'adenosine triphosphate',
  co2: 'carbon dioxide',
  o2: 'oxygen',
  h2o: 'water',
  nacl: 'sodium chloride',
  gdp: 'gross domestic product',
  cpu: 'central processing unit',
  ram: 'random access memory',
  rom: 'read only memory',
  mar: 'memory address register',
  mdr: 'memory data register',
  alu: 'arithmetic logic unit',
  cu: 'control unit',
  semi: 'partially',
  semipermeable: 'partially permeable',
};

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

function expandSynonyms(norm: string): string {
  return norm.split(/\s+/).map((w) => WORD_EQUIV[w] || w).join(' ').trim();
}

function extractDateSig(raw: string): { year?: string; month?: string; day?: string } | null {
  const s = String(raw || '').toLowerCase();
  const yearM = s.match(/\b(1\d{3}|20\d{2})\b/);
  if (!yearM) return null;
  const year = yearM[1];
  let month: string | undefined;
  for (const [k, num] of Object.entries(MONTHS)) {
    if (new RegExp(`\\b${k}\\b`, 'i').test(s)) {
      month = num;
      break;
    }
  }
  const dayM = s.match(/\b([0-2]?\d|3[01])(?:st|nd|rd|th)?\b/);
  const day = dayM && dayM[1] !== year ? dayM[1].padStart(2, '0') : undefined;
  return { year, month, day };
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

function singleCandidateMatches(studentRaw: string, officialRaw: string): boolean {
  const sNorm = normalizeForFastCheck(studentRaw);
  const oNorm = normalizeForFastCheck(officialRaw);
  if (!sNorm || !oNorm) return false;
  if (sNorm === oNorm) return true;

  const oNoParen = normalizeForFastCheck(officialRaw.replace(/\([^)]*\)/g, ' '));
  if (oNoParen && sNorm === oNoParen) return true;

  const parenMatches = officialRaw.match(/\(([^)]+)\)/g) || [];
  for (const pm of parenMatches) {
    const inner = normalizeForFastCheck(pm.slice(1, -1));
    if (inner && inner === sNorm) return true;
  }

  const sExp = expandSynonyms(sNorm);
  const oExp = expandSynonyms(oNoParen || oNorm);
  if (sExp === oExp) return true;

  const sDate = extractDateSig(studentRaw);
  const oDate = extractDateSig(officialRaw);
  if (sDate && oDate) {
    if (sDate.year !== oDate.year) return false;
    if (sDate.month && oDate.month && sDate.month !== oDate.month) return false;
    if (sDate.day && oDate.day && sDate.day !== oDate.day) return false;
    if ((sDate.month && sDate.month === oDate.month) || (!sDate.month && !oDate.month)) {
      return true;
    }
  }

  if (oNoParen.length >= 5 && oNoParen.split(' ').length <= 3) {
    const maxDist = oNoParen.length >= 10 ? 2 : 1;
    if (levenshtein(sNorm, oNoParen) <= maxDist || levenshtein(sExp, oExp) <= maxDist) {
      return true;
    }
  }

  return false;
}

function fastLocalCheck(studentAnswer: string, officialAnswer: string): boolean {
  const trimmed = String(studentAnswer || '').trim();
  if (!trimmed) return false;
  if (singleCandidateMatches(trimmed, officialAnswer)) return true;

  const parts = officialAnswer
    .split(/\s*[;/]\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  return parts.length > 1 && parts.some((p) => singleCandidateMatches(trimmed, p));
}

function smartSemanticFallbackCheck(studentAnswer: string, officialAnswer: string): boolean {
  if (fastLocalCheck(studentAnswer, officialAnswer)) return true;
  const sTokens = expandSynonyms(normalizeForFastCheck(studentAnswer))
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  const oTokens = expandSynonyms(normalizeForFastCheck(officialAnswer))
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (!sTokens.length || !oTokens.length) return false;

  const oNums = oTokens.filter((t) => /^\d+$/.test(t));
  const sNums = sTokens.filter((t) => /^\d+$/.test(t));
  if (oNums.length > 0 && sNums.length > 0 && !oNums.some((n) => sNums.includes(n))) {
    return false;
  }

  let matched = 0;
  for (const ot of oTokens) {
    const hit = sTokens.some(
      (st) =>
        st === ot ||
        (st.length >= 5 && ot.length >= 5 && (st.startsWith(ot.slice(0, 5)) || ot.startsWith(st.slice(0, 5)))) ||
        (ot.length >= 5 && levenshtein(st, ot) <= 1)
    );
    if (hit) matched += 1;
  }
  const officialCoverage = matched / oTokens.length;
  const studentPrecision = matched / sTokens.length;
  return (
    (oTokens.length >= 3 && officialCoverage >= 0.65 && studentPrecision >= 0.45) ||
    (oTokens.length <= 2 && matched === oTokens.length)
  );
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
      correct: smartSemanticFallbackCheck(studentAnswer, officialAnswer),
      source: 'fallback',
      latencyMs: 0,
      error: 'GEMINI_API_KEY not configured on server',
    });
    return;
  }

  const started = Date.now();
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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
    const thinkingLevel = model === 'gemini-4-hydrogen' ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL;
    try {
      const response = await Promise.race([
        ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: GRADING_SYSTEM_INSTRUCTION,
            thinkingConfig: { thinkingLevel },
            maxOutputTokens: 24,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini grading timeout')), 4500)
        ),
      ]);
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
    }
  }

  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'Grading failed.');
  res.status(200).json({
    correct: smartSemanticFallbackCheck(studentAnswer, officialAnswer),
    source: 'fallback',
    latencyMs: Date.now() - started,
    error: msg.slice(0, 220),
  });
}
