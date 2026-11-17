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
  lan: 'local area network',
  wan: 'wide area network',
  semi: 'partially',
  semipermeable: 'partially permeable',
};

export function normalizeForFastCheck(raw: string): string {
  let cleaned = String(raw || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[^\p{L}\p{N}\s.%+-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Expand compact abbreviations like "100k" -> "100000"
  cleaned = cleaned.replace(/\b(\d+(?:\.\d+)?)k\b/g, (_, num) =>
    String(Math.round(Number(num) * 1000))
  );
  cleaned = cleaned.replace(/\b(\d+)%/g, '$1 percent');

  // Remove punctuation left around dots
  cleaned = cleaned.replace(/[.%+-]+/g, ' ').replace(/\s+/g, ' ').trim();

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
    .map((w) => WORD_EQUIV[w] || w)
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

  // Synonym-expanded equality ("USA" vs "United States", "semipermeable" vs "partially permeable")
  const sExp = expandSynonyms(sNorm);
  const oExp = expandSynonyms(oNoParen || oNorm);
  if (sExp === oExp) return true;

  // Date comparison ("Nov 1918" == "9 November 1918", "1918" if official has day+month+year and student gave month+year)
  const sDate = extractDateSig(studentRaw);
  const oDate = extractDateSig(officialRaw);
  if (sDate && oDate) {
    if (sDate.year !== oDate.year) return false;
    if (sDate.month && oDate.month && sDate.month !== oDate.month) return false;
    if (sDate.day && oDate.day && sDate.day !== oDate.day) return false;
    // Matching year and either matching month or official had no extra contradictory numbers
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
    .split(/\s*[;/]\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);
  if (parts.length > 1 && parts.some((p) => singleCandidateMatches(trimmed, p))) {
    return true;
  }
  return false;
}

/**
 * Smart semantic fallback used ONLY if AI API is unavailable or rate-limited on a free tier.
 * Avoids marking clearly valid answers wrong when Gemini cannot respond in time.
 */
export function smartSemanticFallbackCheck(studentAnswer: string, officialAnswer: string): boolean {
  if (fastLocalQuizCheck(studentAnswer, officialAnswer)) return true;

  const sTokens = expandSynonyms(normalizeForFastCheck(studentAnswer))
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  const oTokens = expandSynonyms(normalizeForFastCheck(officialAnswer))
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  if (!sTokens.length || !oTokens.length) return false;

  // Reject if official has specific numbers/years that differ from student's numbers
  const oNums = oTokens.filter((t) => /^\d+$/.test(t));
  const sNums = sTokens.filter((t) => /^\d+$/.test(t));
  if (oNums.length > 0 && sNums.length > 0) {
    const numMatch = oNums.some((n) => sNums.includes(n));
    if (!numMatch) return false;
  }

  // Check stem/typo token overlap
  let matchedOfficial = 0;
  for (const ot of oTokens) {
    const hit = sTokens.some(
      (st) =>
        st === ot ||
        (st.length >= 5 && ot.length >= 5 && (st.startsWith(ot.slice(0, 5)) || ot.startsWith(st.slice(0, 5)))) ||
        (ot.length >= 5 && levenshtein(st, ot) <= 1)
    );
    if (hit) matchedOfficial += 1;
  }

  const officialCoverage = matchedOfficial / oTokens.length;
  const studentPrecision = matchedOfficial / sTokens.length;

  // Accept if student covers >= 65% of key official concepts without adding lots of unrelated junk
  return (
    (oTokens.length >= 3 && officialCoverage >= 0.65 && studentPrecision >= 0.45) ||
    (oTokens.length <= 2 && matchedOfficial === oTokens.length)
  );
}
