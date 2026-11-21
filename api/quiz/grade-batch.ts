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
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-4-hydrogen',
] as const;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'by', 'is',
  'are', 'was', 'were', 'be', 'being', 'been', 'it', 'its', 'with', 'from', 'that',
  'this', 'these', 'those', 'as', 'into', 'between', 'which', 'who', 'whom', 'whose',
  'what', 'when', 'where', 'why', 'how', 'their', 'they', 'them', 'there', 'here',
  'then', 'than', 'also', 'very', 'much', 'many', 'more', 'most', 'some', 'such',
  'because', 'due', 'so', 'thus', 'therefore', 'called', 'known', 'means', 'mean',
  'meaning', 'refers', 'refer', 'used', 'using', 'use', 'made', 'make', 'makes',
  'having', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'would',
  'should', 'will', 'may', 'might', 'about', 'around', 'roughly', 'approx',
  'approximately', 'etc', 'eg', 'ie',
]);

const GENERIC_NOUNS = new Set([
  'party', 'republic', 'empire', 'kingdom', 'state', 'nation', 'country',
  'treaty', 'act', 'law', 'bill', 'policy', 'plan', 'system', 'method',
  'process', 'effect', 'cause', 'theory', 'model', 'principle', 'rule',
  'group', 'movement', 'period', 'era', 'war', 'battle', 'crisis',
  'cell', 'molecule', 'reaction', 'rate', 'level', 'energy', 'force',
  'person', 'leader', 'people', 'event', 'year', 'date', 'factor',
]);

const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', first: '1', two: '2', second: '2',
  three: '3', third: '3', four: '4', fourth: '4', five: '5', fifth: '5',
  six: '6', sixth: '6', seven: '7', seventh: '7', eight: '8', eighth: '8',
  nine: '9', ninth: '9', ten: '10', tenth: '10', eleven: '11', twelve: '12',
  thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16',
  seventeen: '17', eighteen: '18', nineteen: '19', twenty: '20',
  thirty: '30', forty: '40', fifty: '50', sixty: '60', seventy: '70',
  eighty: '80', ninety: '90', hundred: '100', thousand: '1000',
  half: '50 percent', quarter: '25 percent', double: '2x', triple: '3x',
};

const WORD_EQUIV: Record<string, string> = {
  usa: 'united states', us: 'united states', america: 'united states',
  uk: 'united kingdom', gb: 'united kingdom', britain: 'united kingdom',
  ussr: 'soviet union', russia: 'soviet union',
  ww1: 'world war 1', wwi: 'world war 1', ww2: 'world war 2', wwii: 'world war 2',
  pm: 'prime minister', govt: 'government', econ: 'economy',
  dna: 'deoxyribonucleic acid', rna: 'ribonucleic acid', atp: 'adenosine triphosphate',
  co2: 'carbon dioxide', o2: 'oxygen', h2o: 'water', nacl: 'sodium chloride',
  gdp: 'gross domestic product', cpu: 'central processing unit',
  ram: 'random access memory', rom: 'read only memory',
  semi: 'partially', semipermeable: 'partially permeable',
};

function stemToken(raw: string): string {
  let w = raw
    .toLowerCase()
    .replace(/ise([sd]?)$/i, 'ize$1')
    .replace(/isation$/i, 'ization')
    .replace(/our$/i, 'or');
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && w.length > 3) w = w.slice(0, -1);
  if (w.endsWith('tion') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);
  return w;
}

function normalizeForFastCheck(raw: string): string {
  let cleaned = String(raw || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1')
    .replace(/[^\p{L}\p{N}\s.%+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/\b(\d+(?:\.\d+)?)k\b/g, (_, num) =>
    String(Math.round(Number(num) * 1000))
  );
  cleaned = cleaned.replace(/\b(\d+)%/g, '$1 percent');
  cleaned = cleaned.replace(/[.%+-]+/g, ' ').replace(/\s+/g, ' ').trim();
  cleaned = cleaned
    .split(/\s+/)
    .map((w) => NUMBER_WORDS[w] ?? w)
    .join(' ')
    .trim();

  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(?:the|a|an)\s+/i, '').trim();
  }
  return cleaned;
}

function tokenizeNormalized(raw: string): string[] {
  return normalizeForFastCheck(raw)
    .split(/\s+/)
    .map((w) => WORD_EQUIV[w] || w)
    .join(' ')
    .split(/\s+/)
    .filter((w) => w.length >= 1 && !STOP_WORDS.has(w))
    .filter((w) => w.length >= 2 || /^\d+$/.test(w))
    .map((w) => (/^\d+$/.test(w) ? w : stemToken(w)));
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
    .split(/\s*(?:;|\/|\bor\b|\s+[-–—]\s+|:\s+)\s*/i)
    .map((p) => normalizeForFastCheck(p))
    .filter((p) => p.length >= 2);
  return parts.length > 1 && parts.some((p) => p === studentNorm);
}

function smartSemanticFallbackCheck(studentAnswer: string, officialAnswer: string): boolean {
  if (fastLocalCheck(studentAnswer, officialAnswer)) return true;
  const sTokens = tokenizeNormalized(studentAnswer);
  const oTokens = tokenizeNormalized(officialAnswer);
  if (!sTokens.length || !oTokens.length) return false;

  const oNums = oTokens.filter((t) => /^\d+$/.test(t));
  const sNums = sTokens.filter((t) => /^\d+$/.test(t));
  if (oNums.length > 0 && sNums.length > 0 && !oNums.some((n) => sNums.includes(n))) {
    return false;
  }

  const matched = oTokens.filter((ot) =>
    sTokens.some(
      (st) =>
        st === ot ||
        (st.length >= 4 && ot.length >= 4 && (st.startsWith(ot) || ot.startsWith(st)))
    )
  ).length;
  const matchedStudent = sTokens.filter((st) =>
    oTokens.some(
      (ot) =>
        st === ot ||
        (st.length >= 4 && ot.length >= 4 && (st.startsWith(ot) || ot.startsWith(st)))
    )
  ).length;

  const precision = matchedStudent / sTokens.length;
  if (oTokens.length === 1) return matched === 1 && precision >= 0.5;
  if (oTokens.length === 2) {
    if (matched === 2 && precision >= 0.5) return true;
    const distinctive = oTokens.filter((t) => !GENERIC_NOUNS.has(t));
    return distinctive.length === 1 && sTokens.includes(distinctive[0]) && precision >= 0.5;
  }
  return matched / oTokens.length >= 0.58 && precision >= 0.4;
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
            reason: { type: Type.STRING },
            correct: { type: Type.BOOLEAN },
          },
          required: ['id', 'reason', 'correct'],
        },
      };

      let graded = false;
      for (const model of GRADING_MODEL_CANDIDATES) {
        const thinkingConfig = /^gemini-4-/i.test(model)
          ? { thinkingLevel: ThinkingLevel.LOW }
          : /^gemini-3\./i.test(model)
          ? { thinkingLevel: ThinkingLevel.MINIMAL }
          : /^gemini-2\.5-/i.test(model)
          ? { thinkingBudget: 0 }
          : undefined;
        try {
          const response = await Promise.race([
            ai.models.generateContent({
              model,
              contents: promptLines,
              config: {
                systemInstruction:
                  'You are a fair teacher grading numbered flashcard answers by core factual meaning against the Official Answer. Accept paraphrases, plain-English wording, passive/active flips, core points when official answers have extra detail/parentheticals, acronyms/abbreviations, UK/US spelling, unit equivalents, minor typos, and month+year dates. Only mark false if factually wrong or missing the core point. Return strict JSON array of {id, reason, correct}.',
                ...(thinkingConfig ? { thinkingConfig } : {}),
                responseMimeType: 'application/json',
                responseSchema,
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Gemini batch timeout')), 6500)
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
