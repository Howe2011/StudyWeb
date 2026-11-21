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

// Generic classifier nouns that shouldn't sink a short official answer on their own
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
  zero: '0',
  one: '1', first: '1',
  two: '2', second: '2',
  three: '3', third: '3',
  four: '4', fourth: '4',
  five: '5', fifth: '5',
  six: '6', sixth: '6',
  seven: '7', seventh: '7',
  eight: '8', eighth: '8',
  nine: '9', ninth: '9',
  ten: '10', tenth: '10',
  eleven: '11', eleventh: '11',
  twelve: '12', twelfth: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
  thousand: '1000',
  half: '50 percent',
  quarter: '25 percent',
  double: '2x',
  triple: '3x',
};

const WORD_EQUIV: Record<string, string> = {
  usa: 'united states',
  us: 'united states',
  america: 'united states',
  american: 'united states',
  uk: 'united kingdom',
  gb: 'united kingdom',
  britain: 'united kingdom',
  british: 'united kingdom',
  ussr: 'soviet union',
  russia: 'soviet union',
  russian: 'soviet union',
  un: 'united nations',
  eu: 'european union',
  ww1: 'world war 1',
  wwi: 'world war 1',
  ww2: 'world war 2',
  wwii: 'world war 2',
  pm: 'prime minister',
  govt: 'government',
  gov: 'government',
  econ: 'economy',
  rev: 'revolution',
  indep: 'independence',
  const: 'constitution',
  pop: 'population',
  temp: 'temperature',
  conc: 'concentration',
  diff: 'difference',
  info: 'information',
  eq: 'equation',
  approx: 'approximately',
  max: 'maximum',
  min: 'minimum',
  dna: 'deoxyribonucleic acid',
  rna: 'ribonucleic acid',
  mrna: 'messenger ribonucleic acid',
  atp: 'adenosine triphosphate',
  adp: 'adenosine diphosphate',
  co2: 'carbon dioxide',
  o2: 'oxygen',
  h2o: 'water',
  nacl: 'sodium chloride',
  hcl: 'hydrochloric acid',
  naoh: 'sodium hydroxide',
  nh3: 'ammonia',
  ch4: 'methane',
  gdp: 'gross domestic product',
  gnp: 'gross national product',
  cpu: 'central processing unit',
  gpu: 'graphics processing unit',
  ram: 'random access memory',
  rom: 'read only memory',
  mar: 'memory address register',
  mdr: 'memory data register',
  alu: 'arithmetic logic unit',
  cu: 'control unit',
  lan: 'local area network',
  wan: 'wide area network',
  os: 'operating system',
  ui: 'user interface',
  semi: 'partially',
  semipermeable: 'partially permeable',
  // Common everyday conceptual pairs
  jobless: 'unemployment',
  unemployed: 'unemployment',
  abolish: 'end',
  abolished: 'end',
  banned: 'prohibited',
  ban: 'prohibited',
  forbid: 'prohibited',
  forbidden: 'prohibited',
  rise: 'increase',
  rose: 'increase',
  rising: 'increase',
  grown: 'increase',
  grew: 'increase',
  grow: 'increase',
  fall: 'decrease',
  fell: 'decrease',
  drop: 'decrease',
  dropped: 'decrease',
  decline: 'decrease',
  declined: 'decrease',
  shrink: 'decrease',
  shrank: 'decrease',
  fast: 'rapid',
  quickly: 'rapid',
  rapidly: 'rapid',
  slowly: 'slow',
  split: 'divide',
  divided: 'divide',
  division: 'divide',
  merged: 'combine',
  combined: 'combine',
  joined: 'combine',
  stopped: 'stop',
  halted: 'stop',
  ended: 'end',
  started: 'begin',
  began: 'begin',
  begun: 'begin',
  caused: 'cause',
  led: 'lead',
  created: 'create',
  formed: 'create',
  established: 'create',
  founded: 'create',
  collapsed: 'collapse',
  fail: 'failure',
  failed: 'failure',
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
    .replace(/lled$/i, 'led')
    .replace(/ae/g, 'e')
    .replace(/oe/g, 'e');
}

export function stemToken(raw: string): string {
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

  // Deduplicate doubled final consonant after suffix strip (e.g. "stopped" -> "stopp" -> "stop")
  if (w.length >= 4 && w[w.length - 1] === w[w.length - 2] && !/[lsfz]/.test(w[w.length - 1])) {
    w = w.slice(0, -1);
  }
  return w;
}

export function normalizeForFastCheck(raw: string): string {
  let cleaned = String(raw || '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/(\d)(?:st|nd|rd|th)\b/gi, '$1')
    .replace(/[^\p{L}\p{N}\s.%+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Expand compact abbreviations like "100k" -> "100000", "2m" -> "2000000"
  cleaned = cleaned.replace(/\b(\d+(?:\.\d+)?)k\b/g, (_, num) =>
    String(Math.round(Number(num) * 1000))
  );
  cleaned = cleaned.replace(/\b(\d+(?:\.\d+)?)m\b/g, (_, num) =>
    String(Math.round(Number(num) * 1000000))
  );
  cleaned = cleaned.replace(/\b(\d+)%/g, '$1 percent');

  // Remove punctuation left around dots
  cleaned = cleaned.replace(/[.%+-]+/g, ' ').replace(/\s+/g, ' ').trim();

  // Normalize number words to digits
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
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      if (a[i - 1] === b[j - 1]) dp[j] = prev;
      else dp[j] = 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

function tokenizeNormalized(raw: string): string[] {
  return expandSynonyms(normalizeForFastCheck(raw))
    .split(/\s+/)
    .filter((w) => w.length >= 1 && !STOP_WORDS.has(w))
    .filter((w) => w.length >= 2 || /^\d+$/.test(w))
    .map((w) => (/^\d+$/.test(w) ? w : stemToken(w)));
}

function singleCandidateMatches(studentRaw: string, officialRaw: string): boolean {
  const sNorm = normalizeForFastCheck(studentRaw);
  const oNorm = normalizeForFastCheck(officialRaw);
  if (!sNorm || !oNorm) return false;
  if (sNorm === oNorm) return true;

  // Compare with parenthetical clarifications stripped, e.g. "Rentenmark (new currency)"
  const oNoParen = normalizeForFastCheck(officialRaw.replace(/\([^)]*\)/g, ' '));
  if (oNoParen && sNorm === oNoParen) return true;

  // Extract parenthetical abbreviation e.g. "Adenosine Triphosphate (ATP)"
  const parenMatches = officialRaw.match(/\(([^)]+)\)/g) || [];
  for (const pm of parenMatches) {
    const inner = normalizeForFastCheck(pm.slice(1, -1));
    if (inner && inner === sNorm) return true;
  }

  // Synonym-expanded & UK/US-normalized equality
  const sExp = expandSynonyms(sNorm);
  const oExp = expandSynonyms(oNoParen || oNorm);
  if (sExp === oExp) return true;

  // Exact stemmed token sequence equality (handles plurals/tenses with zero false positives)
  const sStems = tokenizeNormalized(studentRaw);
  const oStems = tokenizeNormalized(officialRaw.replace(/\([^)]*\)/g, ' '));
  if (
    sStems.length > 0 &&
    sStems.length === oStems.length &&
    sStems.every((t, i) => t === oStems[i])
  ) {
    return true;
  }

  // Date comparison ("Nov 1918" == "9 November 1918", "1918" if official has day+month+year and student gave month+year)
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

  // Small typo tolerance for short/single-term answers (>= 5 chars)
  if (oNoParen.length >= 5 && oNoParen.split(' ').length <= 3) {
    const maxDist = oNoParen.length >= 10 ? 2 : 1;
    if (levenshtein(sNorm, oNoParen) <= maxDist || levenshtein(sExp, oExp) <= maxDist) {
      return true;
    }
  }

  return false;
}

/**
 * 0ms fast deterministic check used before hitting Gemini.
 */
export function fastLocalQuizCheck(studentAnswer: string, officialAnswer: string): boolean {
  const trimmed = String(studentAnswer || '').trim();
  if (!trimmed) return false;
  if (singleCandidateMatches(trimmed, officialAnswer)) return true;

  const parts = officialAnswer
    .split(/\s*(?:;|\/|\bor\b|\s+[-–—]\s+|:\s+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  if (parts.length > 1 && parts.some((p) => singleCandidateMatches(trimmed, p))) {
    return true;
  }
  return false;
}

function tokensMatch(st: string, ot: string): boolean {
  if (st === ot) return true;
  if (/^\d+$/.test(st) || /^\d+$/.test(ot)) return st === ot;
  if (st.length >= 4 && ot.length >= 4 && (st.startsWith(ot) || ot.startsWith(st))) {
    return true;
  }
  if (st.length >= 5 && ot.length >= 5 && (st.startsWith(ot.slice(0, 5)) || ot.startsWith(st.slice(0, 5)))) {
    return true;
  }
  if (ot.length >= 4 && levenshtein(st, ot) <= 1) return true;
  return false;
}

function checkTokenOverlap(studentAnswer: string, officialCandidate: string): boolean {
  const sTokens = tokenizeNormalized(studentAnswer);
  const oTokens = tokenizeNormalized(officialCandidate);
  if (!sTokens.length || !oTokens.length) return false;

  // Reject if both answers specify numbers/years and they completely disagree
  const oNums = oTokens.filter((t) => /^\d+$/.test(t));
  const sNums = sTokens.filter((t) => /^\d+$/.test(t));
  if (oNums.length > 0 && sNums.length > 0) {
    const numMatch = oNums.some((n) => sNums.includes(n));
    if (!numMatch) return false;
  }

  let matchedOfficial = 0;
  for (const ot of oTokens) {
    if (sTokens.some((st) => tokensMatch(st, ot))) {
      matchedOfficial += 1;
    }
  }

  let matchedStudent = 0;
  for (const st of sTokens) {
    if (oTokens.some((ot) => tokensMatch(st, ot))) {
      matchedStudent += 1;
    }
  }

  const officialCoverage = matchedOfficial / oTokens.length;
  const studentPrecision = matchedStudent / sTokens.length;

  // Handle 1-token & 2-token answers fairly (e.g. "Weimar" for "Weimar Republic")
  if (oTokens.length === 1) {
    return matchedOfficial === 1 && studentPrecision >= 0.5;
  }
  if (oTokens.length === 2) {
    if (matchedOfficial === 2 && studentPrecision >= 0.5) return true;
    const distinctive = oTokens.filter((t) => !GENERIC_NOUNS.has(t));
    if (
      distinctive.length === 1 &&
      sTokens.some((st) => tokensMatch(st, distinctive[0])) &&
      studentPrecision >= 0.5
    ) {
      return true;
    }
    return false;
  }

  // For longer official answers (>= 3 key tokens), reward covering core meaning even if extra elaboration is omitted
  if (oTokens.length >= 6) {
    return officialCoverage >= 0.5 && studentPrecision >= 0.4;
  }
  return officialCoverage >= 0.6 && studentPrecision >= 0.42;
}

/**
 * Smart semantic fallback used when AI API is unavailable, rate-limited, or running locally without BYOK.
 * Avoids marking clearly valid paraphrases and core-concept answers wrong.
 */
export function smartSemanticFallbackCheck(studentAnswer: string, officialAnswer: string): boolean {
  if (fastLocalQuizCheck(studentAnswer, officialAnswer)) return true;

  if (checkTokenOverlap(studentAnswer, officialAnswer)) return true;

  // Also test parenthetical-stripped and sub-parts separately so extra definitions don't dilute coverage
  const noParen = officialAnswer.replace(/\([^)]*\)/g, ' ').trim();
  if (noParen && noParen !== officialAnswer && checkTokenOverlap(studentAnswer, noParen)) {
    return true;
  }

  const parts = officialAnswer
    .split(/\s*(?:;|\/|\bor\b|\s+[-–—]\s+)\s*/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  if (parts.length > 1 && parts.some((p) => checkTokenOverlap(studentAnswer, p))) {
    return true;
  }

  return false;
}
