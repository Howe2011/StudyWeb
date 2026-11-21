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
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-4-hydrogen',
] as const;

const GRADING_SYSTEM_INSTRUCTION =
  'You are a fair, experienced teacher grading a quick recall flashcard/quiz answer. Judge by core factual understanding against the Question and Official Answer — NEVER penalize valid wording differences.\n' +
  'Mark correct=true when:\n' +
  '- The student paraphrases, uses everyday/plain-English wording, active/passive voice, or reordered clauses that express the same meaning.\n' +
  '- The Official Answer contains extra elaboration, parenthetical notes, or secondary details, and the student accurately captures the essential core answer.\n' +
  '- The student gives a valid synonym, acronym/expanded form (e.g. USA/America/US, ATP, CO2/carbon dioxide), chemical formula/name, UK/US spelling, singular/plural, different tense, minor typo, or equivalent unit/number format.\n' +
  '- Dates omit the exact day (e.g. "Nov 1918" or "1918" for "9 November 1918") unless the day itself is the explicit point of contradiction.\n' +
  '- Both answers are factually equivalent in context of the Question.\n' +
  'Mark correct=false ONLY if the student answer is factually wrong, names a different person/event/term/year/value, is too vague to show knowledge, or misses the main concept.\n' +
  'Output strict JSON with a brief 1-sentence comparison "reason" BEFORE "correct": {"reason":"...", "correct": true/false}.';

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
  usa: 'united states', us: 'united states', america: 'united states', american: 'united states',
  uk: 'united kingdom', gb: 'united kingdom', britain: 'united kingdom', british: 'united kingdom',
  ussr: 'soviet union', russia: 'soviet union', russian: 'soviet union',
  un: 'united nations', eu: 'european union',
  ww1: 'world war 1', wwi: 'world war 1', ww2: 'world war 2', wwii: 'world war 2',
  pm: 'prime minister', govt: 'government', gov: 'government', econ: 'economy',
  rev: 'revolution', indep: 'independence', const: 'constitution', pop: 'population',
  temp: 'temperature', conc: 'concentration', diff: 'difference',
  dna: 'deoxyribonucleic acid', rna: 'ribonucleic acid', atp: 'adenosine triphosphate',
  co2: 'carbon dioxide', o2: 'oxygen', h2o: 'water', nacl: 'sodium chloride',
  gdp: 'gross domestic product', cpu: 'central processing unit',
  ram: 'random access memory', rom: 'read only memory',
  mar: 'memory address register', mdr: 'memory data register',
  alu: 'arithmetic logic unit', cu: 'control unit',
  semi: 'partially', semipermeable: 'partially permeable',
  jobless: 'unemployment', unemployed: 'unemployment',
  abolish: 'end', abolished: 'end', banned: 'prohibited', ban: 'prohibited',
  rise: 'increase', rose: 'increase', rising: 'increase', grown: 'increase', grew: 'increase', grow: 'increase',
  fall: 'decrease', fell: 'decrease', drop: 'decrease', dropped: 'decrease', decline: 'decrease', declined: 'decrease',
  fast: 'rapid', quickly: 'rapid', rapidly: 'rapid',
  split: 'divide', divided: 'divide', division: 'divide',
  merged: 'combine', combined: 'combine', joined: 'combine',
  stopped: 'stop', halted: 'stop', ended: 'end',
  started: 'begin', began: 'begin', begun: 'begin',
  created: 'create', formed: 'create', established: 'create', founded: 'create',
  collapsed: 'collapse', fail: 'failure', failed: 'failure',
};

function normalizeUkSpelling(w: string): string {
  return w
    .replace(/ise([sd]?)$/i, 'ize$1')
    .replace(/isation$/i, 'ization')
    .replace(/our$/i, 'or')
    .replace(/ours$/i, 'ors')
    .replace(/([a-z]{3,})re$/i, '$1er')
    .replace(/([a-z]{3,})ence$/i, '$1ense')
    .replace(/lling$/i, 'ling')
    .replace(/lled$/i, 'led');
}

function stemToken(raw: string): string {
  let w = normalizeUkSpelling(raw.toLowerCase());
  if (w.length <= 3) return w;
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('ves') && w.length > 4) w = `${w.slice(0, -3)}f`;
  else if (/(?:ss|ch|sh|x|z)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is') && w.length > 3) {
    w = w.slice(0, -1);
  }
  if (w.endsWith('ation') && w.length > 6) w = w.slice(0, -5);
  else if (w.endsWith('tion') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('sion') && w.length > 5) w = w.slice(0, -4);
  else if (w.endsWith('ment') && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith('ness') && w.length > 6) w = w.slice(0, -4);
  else if (w.endsWith('ity') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ing') && w.length > 5) w = w.slice(0, -3);
  else if (w.endsWith('ied') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('ed') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ly') && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('er') && w.length > 4) w = w.slice(0, -2);
  if (w.length >= 4 && w[w.length - 1] === w[w.length - 2] && !/[lsfz]/.test(w[w.length - 1])) {
    w = w.slice(0, -1);
  }
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
  cleaned = cleaned.replace(/\b(\d+(?:\.\d+)?)m\b/g, (_, num) =>
    String(Math.round(Number(num) * 1000000))
  );
  cleaned = cleaned.replace(/\b(\d+)%/g, '$1 percent');
  cleaned = cleaned.replace(/[.%+-]+/g, ' ').replace(/\s+/g, ' ').trim();

  cleaned = cleaned
    .split(/\s+/)
    .map((w) => NUMBER_WORDS[w] ?? w)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  let prev = '';
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(?:the|a|an)\s+/i, '').trim();
  }
  return cleaned;
}

function expandSynonyms(norm: string): string {
  return norm
    .split(/\s+/)
    .map((w) => {
      const n = normalizeUkSpelling(w);
      return WORD_EQUIV[n] || WORD_EQUIV[w] || n;
    })
    .join(' ')
    .trim();
}

function tokenizeNormalized(raw: string): string[] {
  return expandSynonyms(normalizeForFastCheck(raw))
    .split(/\s+/)
    .filter((w) => w.length >= 1 && !STOP_WORDS.has(w))
    .filter((w) => w.length >= 2 || /^\d+$/.test(w))
    .map((w) => (/^\d+$/.test(w) ? w : stemToken(w)));
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

  const sStems = tokenizeNormalized(studentRaw);
  const oStems = tokenizeNormalized(officialRaw.replace(/\([^)]*\)/g, ' '));
  if (sStems.length > 0 && sStems.length === oStems.length && sStems.every((t, i) => t === oStems[i])) {
    return true;
  }

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
    .split(/\s*(?:;|\/|\bor\b|\s+[-–—]\s+|:\s+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  return parts.length > 1 && parts.some((p) => singleCandidateMatches(trimmed, p));
}

function tokensMatch(st: string, ot: string): boolean {
  if (st === ot) return true;
  if (/^\d+$/.test(st) || /^\d+$/.test(ot)) return st === ot;
  if (st.length >= 4 && ot.length >= 4 && (st.startsWith(ot) || ot.startsWith(st))) return true;
  if (st.length >= 5 && ot.length >= 5 && (st.startsWith(ot.slice(0, 5)) || ot.startsWith(st.slice(0, 5)))) {
    return true;
  }
  return ot.length >= 4 && levenshtein(st, ot) <= 1;
}

function checkTokenOverlap(studentAnswer: string, officialCandidate: string): boolean {
  const sTokens = tokenizeNormalized(studentAnswer);
  const oTokens = tokenizeNormalized(officialCandidate);
  if (!sTokens.length || !oTokens.length) return false;

  const oNums = oTokens.filter((t) => /^\d+$/.test(t));
  const sNums = sTokens.filter((t) => /^\d+$/.test(t));
  if (oNums.length > 0 && sNums.length > 0 && !oNums.some((n) => sNums.includes(n))) {
    return false;
  }

  const matchedOfficial = oTokens.filter((ot) => sTokens.some((st) => tokensMatch(st, ot))).length;
  const matchedStudent = sTokens.filter((st) => oTokens.some((ot) => tokensMatch(st, ot))).length;
  const officialCoverage = matchedOfficial / oTokens.length;
  const studentPrecision = matchedStudent / sTokens.length;

  if (oTokens.length === 1) return matchedOfficial === 1 && studentPrecision >= 0.5;
  if (oTokens.length === 2) {
    if (matchedOfficial === 2 && studentPrecision >= 0.5) return true;
    const distinctive = oTokens.filter((t) => !GENERIC_NOUNS.has(t));
    if (distinctive.length === 1 && sTokens.some((st) => tokensMatch(st, distinctive[0])) && studentPrecision >= 0.5) {
      return true;
    }
    return false;
  }
  if (oTokens.length >= 6) return officialCoverage >= 0.5 && studentPrecision >= 0.4;
  return officialCoverage >= 0.6 && studentPrecision >= 0.42;
}

function smartSemanticFallbackCheck(studentAnswer: string, officialAnswer: string): boolean {
  if (fastLocalCheck(studentAnswer, officialAnswer)) return true;
  if (checkTokenOverlap(studentAnswer, officialAnswer)) return true;

  const noParen = officialAnswer.replace(/\([^)]*\)/g, ' ').trim();
  if (noParen && noParen !== officialAnswer && checkTokenOverlap(studentAnswer, noParen)) return true;

  const parts = officialAnswer
    .split(/\s*(?:;|\/|\bor\b|\s+[-–—]\s+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  return parts.length > 1 && parts.some((p) => checkTokenOverlap(studentAnswer, p));
}

function parseGradeJson(rawText: string): { correct: boolean; reason?: string } {
  try {
    const parsed = JSON.parse(rawText) as { correct?: boolean; reason?: string };
    return {
      correct: Boolean(parsed?.correct),
      reason: typeof parsed?.reason === 'string' ? parsed.reason.trim() : undefined,
    };
  } catch {
    return {
      correct: /"correct"\s*:\s*true/i.test(rawText),
    };
  }
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

  const byokObj =
    body.byok && typeof body.byok === 'object' ? (body.byok as Record<string, unknown>) : null;
  const byokKey = byokObj && typeof byokObj.apiKey === 'string' ? byokObj.apiKey.trim() : '';
  const byokProvider =
    byokObj && typeof byokObj.provider === 'string' ? byokObj.provider.trim() : 'gemini';
  const byokModel = byokObj && typeof byokObj.model === 'string' ? byokObj.model.trim() : '';
  const byokBaseUrl =
    byokObj && typeof byokObj.baseUrl === 'string' ? byokObj.baseUrl.trim() : '';

  const contents = `Question: ${question}\nOfficial Answer: ${officialAnswer}\nStudent Answer: ${studentAnswer}`;
  const started = Date.now();

  if (byokKey && (byokProvider === 'grok' || byokProvider === 'openai-compatible')) {
    const baseUrl =
      byokProvider === 'grok'
        ? 'https://api.x.ai/v1'
        : (byokBaseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const model = byokModel || (byokProvider === 'grok' ? 'grok-3-mini' : 'gpt-4o-mini');
    try {
      const apiRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(6500),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${byokKey}`,
        },
        body: JSON.stringify({
          model,
          response_format: { type: 'json_object' },
          max_tokens: byokProvider === 'grok' ? 512 : 180,
          messages: [
            { role: 'system', content: GRADING_SYSTEM_INSTRUCTION },
            { role: 'user', content: contents },
          ],
        }),
      });
      if (apiRes.ok) {
        const data = (await apiRes.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const rawText = (data.choices?.[0]?.message?.content || '').trim();
        if (rawText) {
          const parsed = parseGradeJson(rawText);
          res.status(200).json({
            correct: parsed.correct,
            reason: parsed.reason,
            source: 'ai',
            latencyMs: Date.now() - started,
            model,
          });
          return;
        }
      }
    } catch {
      // fall through to Gemini/fallback
    }
  }

  const apiKey =
    (byokProvider === 'gemini' && byokKey) || (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    res.status(200).json({
      correct: smartSemanticFallbackCheck(studentAnswer, officialAnswer),
      source: 'fallback',
      latencyMs: 0,
      error: 'GEMINI_API_KEY not configured on server',
    });
    return;
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      reason: { type: Type.STRING },
      correct: { type: Type.BOOLEAN },
    },
    required: ['reason', 'correct'],
  };

  const candidates = byokProvider === 'gemini' && byokKey && byokModel
    ? [byokModel, ...GRADING_MODEL_CANDIDATES.filter((m) => m !== byokModel)]
    : [...GRADING_MODEL_CANDIDATES];

  let lastErr: unknown = null;
  for (const model of candidates) {
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
          contents,
          config: {
            systemInstruction: GRADING_SYSTEM_INSTRUCTION,
            ...(thinkingConfig ? { thinkingConfig } : {}),
            maxOutputTokens: 160,
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini grading timeout')), 6500)
        ),
      ]);
      const rawText = (response.text || '').trim();
      if (!rawText) throw new Error(`Empty response from ${model}`);

      const parsed = parseGradeJson(rawText);

      res.status(200).json({
        correct: parsed.correct,
        reason: parsed.reason,
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
