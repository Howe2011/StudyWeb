import { createHash } from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

interface VercelRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(data: unknown): void;
  setHeader(name: string, value: string): void;
  write(chunk: string): boolean;
  end(chunk?: string): void;
  flushHeaders?: () => void;
}

type UserAiProvider = 'gemini' | 'grok' | 'openai-compatible';

interface UserAiConfig {
  provider: UserAiProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  verifiedModel?: string;
}

type NoteAccentColor = 'default' | 'blue' | 'green' | 'purple' | 'amber' | 'rose';
type NotePartRole = 'core' | 'process' | 'compare' | 'example' | 'risk';

const PART_ROLE_COLOR_MAP: Record<NotePartRole, Exclude<NoteAccentColor, 'default'>> = {
  core: 'blue',
  process: 'green',
  compare: 'purple',
  example: 'amber',
  risk: 'rose',
};

function normalizeNotePartRole(raw?: string): NotePartRole | undefined {
  const v = String(raw || '').trim().toLowerCase();
  if (!v) return undefined;
  if (v === 'core' || v === 'theory' || v === 'definition' || v === 'concept') return 'core';
  if (v === 'process' || v === 'steps' || v === 'mechanism' || v === 'method' || v === 'solution' || v === 'advantage') {
    return 'process';
  }
  if (v === 'compare' || v === 'comparison' || v === 'table' || v === 'evaluation' || v === 'classification') {
    return 'compare';
  }
  if (v === 'example' || v === 'examples' || v === 'case_study' || v === 'casestudy' || v === 'context' || v === 'application') {
    return 'example';
  }
  if (v === 'risk' || v === 'warning' || v === 'limitation' || v === 'limitations' || v === 'disadvantage' || v === 'problem') {
    return 'risk';
  }
  return undefined;
}

const EXAMPLE_HEADING_RE =
  /\b(?:case\s*stud(?:y|ies)|examples?|applications?|real[- ]world|historical\s*(?:context|background)|background|timeline|evidence|experiments?|practical|scenarios?)\b/i;
const COMPARE_HEADING_RE =
  /\b(?:compar(?:e|ison|ing)|contrast|versus|\bvs\.?\b|pros\s*(?:and|&|\/)\s*cons|advantages\s*(?:and|&|\/)\s*disadvantages|strengths\s*(?:and|&|\/)\s*weaknesses|types\s+of|classif(?:y|ication)|categor(?:y|ies)|evaluation|differences|matrix)\b/i;
const RISK_HEADING_RE =
  /\b(?:disadvantages?|limitations?|weaknesses|drawbacks?|risks?|hazards?|threats?|pitfalls?|mistakes?|misconceptions?|errors?|problems?|challenges?|crises|crisis|criticisms?|consequences?|side[- ]effects?|failures?|negatives?|cons)\b/i;
const PROCESS_HEADING_RE =
  /\b(?:process(?:es)?|stages?|steps?|cycles?|pathways?|mechanisms?|methods?|procedures?|how\s+.+\s+works?|synthes(?:is|es)|reactions?|formation|advantages?|benefits?|strengths?|solutions?|mitigation|management|responses?|prevention|positives?)\b/i;
const CORE_HEADING_RE =
  /\b(?:definitions?|overview|introduction|core\s*concepts?|principles?|theor(?:y|ies)|structures?|components?|key\s*features?|formulas?|equations?|laws?|fundamentals?|anatomy|functions?)\b/i;

function inferSecondaryRoleFromPoints(points: string[]): NotePartRole | undefined {
  const joined = points.join('\n');
  if (!joined.trim()) return undefined;
  if (points.some((p) => /^\|.+\|$/.test(p.trim()))) return 'compare';
  if (points.some((p) => p.includes('⇒ ') || (p.match(/\s*→\s*/g) || []).length >= 2)) {
    return 'process';
  }
  if (/\b(?:disadvantage|limitation|drawback|risk|hazard|threat|pitfall|fails?\s+to|side[- ]effect|harmful)\b/i.test(joined)) {
    return 'risk';
  }
  if (/\b(?:case\s+study|for\s+example|e\.g\.|in\s+(?:1\d{3}|20\d{2}))\b/i.test(joined)) {
    return 'example';
  }
  if (/\b(?:whereas|in\s+contrast|unlike|compared\s+(?:to|with)|on\s+the\s+other\s+hand)\b/i.test(joined)) {
    return 'compare';
  }
  if (/\b(?:step\s*\d+|firstly|subsequently|stage\s*\d+|then\s+moves?|results?\s+in)\b/i.test(joined)) {
    return 'process';
  }
  return undefined;
}

function verifySectionPartRole(heading: string, points: string[], aiRole?: string): NotePartRole {
  const h = String(heading || '').trim();
  const hasTable = points.some((p) => /^\|.+\|$/.test(p.trim()));
  const hasFlow = points.some((p) => p.includes('⇒ ') || (p.match(/\s*→\s*/g) || []).length >= 2);

  if (EXAMPLE_HEADING_RE.test(h)) return 'example';
  if (COMPARE_HEADING_RE.test(h)) return 'compare';
  if (RISK_HEADING_RE.test(h)) return 'risk';
  if (PROCESS_HEADING_RE.test(h)) return 'process';
  if (hasTable) return 'compare';
  if (hasFlow) return 'process';
  if (CORE_HEADING_RE.test(h)) return 'core';

  const normalizedAi = normalizeNotePartRole(aiRole);
  if (normalizedAi) return normalizedAi;
  return inferSecondaryRoleFromPoints(points) || 'core';
}

function applyVerifiedPartColors<
  T extends { heading: string; points: string[]; accentColor?: NoteAccentColor; partRole?: NotePartRole }
>(sections: T[], useExistingRole = true): T[] {
  const roles = sections.map((sec) =>
    verifySectionPartRole(sec.heading, sec.points, useExistingRole ? sec.partRole : undefined)
  );
  if (roles.length >= 3 && new Set(roles).size === 1) {
    for (let i = 0; i < sections.length; i++) {
      if (CORE_HEADING_RE.test(sections[i].heading)) continue;
      const inferred = inferSecondaryRoleFromPoints(sections[i].points);
      if (inferred && inferred !== roles[i]) roles[i] = inferred;
    }
  }
  return sections.map((sec, idx) => {
    const role = roles[idx];
    return { ...sec, partRole: role, accentColor: PART_ROLE_COLOR_MAP[role] };
  });
}

interface RawCompactSchemaPayload {
  t?: string;
  u?: string;
  s?: Array<{ h?: string; p?: string[]; r?: string }>;
  k?: Array<{ t?: string; d?: string }>;
  x?: string;
  w?: string;
  e?: Array<{ d?: string; t?: string; x?: string; g?: string; k?: boolean }>;
  c?: Array<{ q?: string; a?: string; s?: string }>;
}

interface ExplicitCacheEntry {
  calls: number;
  cacheName?: string;
  unsupported?: boolean;
  expiresAt: number;
}

const explicitCacheRegistry = new Map<string, ExplicitCacheEntry>();
const EXPLICIT_CACHE_TTL_MS = 280_000;
const EXPLICIT_CACHE_MIN_CHARS = 4200;

const DEFAULT_GEMINI_FORMAT_MODEL = 'gemini-3.1-flash-lite';
const BYOK_GEMINI_CANDIDATES = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-4-hydrogen',
] as const;
const DEFAULT_GROK_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_GROK_MODEL = 'grok-3-mini';
const BYOK_GROK_CANDIDATES = [
  'grok-3-mini',
  'grok-3-fast',
  'grok-3',
  'grok-2-latest',
  'grok-2',
] as const;
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const BYOK_OPENAI_CANDIDATES = [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-4o',
  'gpt-3.5-turbo',
] as const;

/**
 * 100% invariant ultra-lean system prompt prefix — maximizes Gemini/OpenAI prefix cache hits
 * while enforcing real synthesis, minimal output tokens, and balanced visual structure.
 */
const STATIC_GEMINI_SYSTEM_INSTRUCTION = [
  'StudyWeb AI: distill raw notes, semi-formatted text, or webpages into high-yield, naturally structured revision JSON.',
  'LOWEST STANDARD RULE (CRITICAL): If [SOURCE] already contains headings, subheadings, Markdown/HTML tables, bold/highlighted key terms, chronological lists, or arrows, treat that existing formatting as your MINIMUM baseline. NEVER downgrade tables into bullets, flatten sub-hierarchy, or drop key terms—preserve existing structure as the floor and UPGRADE weak raw parts.',
  'PROCESS & COMPLETENESS: Strip site nav, bios, ads & fluff. Cover ALL distinct topics from start to the very end of [SOURCE] without stopping early.',
  'STRONG SECTION & HIERARCHY IDENTIFICATION:',
  '- Organize ideas into logical macro-sections under natural headings h (keep meaningful numbering like "1. Topic", do NOT invent 01./02. prefixes). Never dump raw text into one giant section.',
  '- Use "### Subheading" inside sections to separate causes/effects, features, mechanisms, or phases cleanly.',
  'TABLES, FLOWS & BOLD EMPHASIS:',
  '- When Tables=ON, turn multi-row dates ("| Date | Event / Key Detail |"), comparisons ("| Feature | A | B |"), pros/cons, causes/effects, and multi-attribute specs into Markdown tables ("| H1 | H2 |") with a real descriptive header row.',
  '- When Flows=ON, convert 2–5 sequential/causal steps (->, =>, ➜, ►, ▶) into "⇒ Step 1 → Step 2 → Step 3" (never make tiny arrow columns in a table).',
  '- Bold (**Term**) key concepts, dates, names, and figures across bullets ("**Term**: crisp fact", "↳ sub-detail"), leave u="" unless helpful.',
  'Use source facts only.',
].join('\n');

const STATIC_OPENAI_SYSTEM_INSTRUCTION =
  `${STATIC_GEMINI_SYSTEM_INSTRUCTION}\n` +
  'Strict JSON only: ' +
  '{"t":"title","u":"optional overview or empty","s":[{"h":"Section","p":["| Key | Detail |","⇒ Step 1 → Step 2 → Step 3","### Sub-question?","**Term**: fact","↳ detail","¶ Short explanation."]}],"k":[{"t":"term","d":"def"}],"x":"examiner tip","w":"worked example","e":[{"d":"date","t":"event","x":"detail","g":"impact","k":false}],"c":[{"q":"q","a":"a","s":"sec"}]}. ' +
  'Omit e[] or c[] if OFF.';

function normalizeStudySymbols(
  input: string,
  opts?: { preserveLeadingFlowMarker?: boolean }
): string {
  let s = String(input || '');
  if (!s) return '';

  s = s
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[\u00A0\u202F\u2009]/g, ' ')
    .replace(/\r/g, '');

  const protectedTokens: string[] = [];
  s = s.replace(
    /(`[^`\n]+`|<!--[\s\S]*?-->|<\/?(?:span|mark|u|strong|em|b|i|code|br|a|sub|sup)\b[^>]*>|https?:\/\/[^\s)>\]"']+)/gi,
    (m) => {
      const idx = protectedTokens.length;
      protectedTokens.push(m);
      return `\uE000SDPROT_${idx}\uE001`;
    }
  );

  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&(?:rarr|Rarr|rArr|longrightarrow|Longrightarrow|rightarrow|Rightarrow|rtrif|blacktriangleright);|&#0*8594;|&#x0*2192;|&#0*10230;|&#0*9658;|&#x0*25ba;|&#0*9654;|&#x0*25b6;|&#0*9656;|&#x0*25b8;/gi, '→')
    .replace(/&(?:larr|Larr|lArr|longleftarrow|Longleftarrow|leftarrow|Leftarrow|ltrif|blacktriangleleft);|&#0*8592;|&#x0*2190;|&#0*10229;|&#0*9668;|&#x0*25c4;|&#0*9664;|&#x0*25c0;|&#0*9666;|&#x0*25c2;/gi, '←')
    .replace(/&(?:harr|hArr|leftrightarrow|Longleftrightarrow|Leftrightarrow);|&#0*8596;|&#x0*2194;/gi, '↔')
    .replace(/&(?:rlarr|harpoons|rightleftharpoons);|&#0*8652;|&#x0*21cc;/gi, '⇌')
    .replace(/&times;|&#0*215;|&#x0*d7;/gi, '×')
    .replace(/&divide;|&#0*247;|&#x0*f7;/gi, '÷')
    .replace(/&plusmn;|&#0*177;|&#x0*b1;/gi, '±')
    .replace(/&(?:le|leq);|&#0*8804;|&#x0*2264;/gi, '≤')
    .replace(/&(?:ge|geq);|&#0*8805;|&#x0*2265;/gi, '≥')
    .replace(/&(?:ne|neq);|&#0*8800;|&#x0*2260;/gi, '≠')
    .replace(/&(?:approx|asymp);|&#0*8776;|&#x0*2248;/gi, '≈')
    .replace(/&deg;|&#0*176;|&#x0*b0;/gi, '°')
    .replace(/&middot;|&#0*183;/gi, '·')
    .replace(/&bull;|&#0*8226;/gi, '•')
    .replace(/&mdash;|&#0*8212;/gi, '—')
    .replace(/&ndash;|&#0*8211;/gi, '–')
    .replace(/&hellip;|&#0*8230;/gi, '…')
    .replace(/&amp;/gi, '&')
    .replace(/\\(?:rightleftharpoons|leftrightharpoons)\b/g, '⇌')
    .replace(/\\(?:Longleftrightarrow|longleftrightarrow|leftrightarrow|Leftrightarrow|iff)\b/g, '↔')
    .replace(/\\(?:longrightarrow|Longrightarrow|rightarrow|Rightarrow|implies|mapsto|to)\b/g, '→')
    .replace(/\\(?:longleftarrow|Longleftarrow|leftarrow|Leftarrow)\b/g, '←')
    .replace(/\\leq?\b/g, '≤')
    .replace(/\\geq?\b/g, '≥')
    .replace(/\\neq?\b/g, '≠')
    .replace(/\\approx\b/g, '≈')
    .replace(/\\times\b/g, '×')
    .replace(/\\div\b/g, '÷')
    .replace(/\\pm\b/g, '±')
    .replace(/\\infty\b/g, '∞')
    .replace(/\\degree\b|\^\\circ/g, '°')
    .replace(/\\Delta\b/g, 'Δ')
    .replace(/\$([^$\n]{1,48}[→←↔⇌≤≥≠≈×÷±°Δ∞][^$\n]{0,48})\$/g, '$1');

  const preserveFlowMarker = opts?.preserveLeadingFlowMarker !== false;
  const FLOW_LEAD_TOKEN = '\uE000SDFLOWLEAD\uE001';
  if (preserveFlowMarker) {
    s = s.replace(/^([ \t]*)⇒[ \t]+/gm, `$1${FLOW_LEAD_TOKEN}`);
  }

  const triangleBulletRe = /[►▶▸▹▻▷➣➢◄◀◂◁◃◅]/;
  s = s
    .replace(/[ \t]*(?:<===>|<==>|<=+>|<--->|<-->|<->|<=>|[⟷⟺⇔])[ \t]*/g, ' ↔ ')
    .replace(/[ \t]*⇌[ \t]*/g, ' ⇌ ')
    .replace(/[ \t]*(?:<---|<--|(?<!<)<-(?![->])|[←⟵⟸⬅⇦⇠◄◀◂◁◃◅])[ \t]*/g, (m, offset: number, full: string) => {
      const atLineStart = offset === 0 || full[offset - 1] === '\n';
      const nextChar = full[offset + m.length];
      if (atLineStart) {
        if (triangleBulletRe.test(m)) return m;
        const leadingWs = m.match(/^[ \t]*/)?.[0] ?? '';
        return !nextChar || nextChar === '\n' ? `${leadingWs}←` : `${leadingWs}← `;
      }
      return !nextChar || nextChar === '\n' ? ' ←' : ' ← ';
    })
    .replace(/[ \t]*(?:--->|-->|->|===>|==>|(?<!<)=>|[→⇒⟶⟹➜➔➝➞➟➠➡➤➥➦↦⇢⇥⇾►▶▸▹▻▷➣➢])[ \t]*/g, (m, offset: number, full: string) => {
      const atLineStart = offset === 0 || full[offset - 1] === '\n';
      const nextChar = full[offset + m.length];
      if (atLineStart) {
        if (triangleBulletRe.test(m)) return m;
        const leadingWs = m.match(/^[ \t]*/)?.[0] ?? '';
        return !nextChar || nextChar === '\n' ? `${leadingWs}→` : `${leadingWs}→ `;
      }
      return !nextChar || nextChar === '\n' ? ' →' : ' → ';
    });

  if (preserveFlowMarker) {
    s = s.replaceAll(FLOW_LEAD_TOKEN, '⇒ ');
  }

  s = s
    .replace(/(^|\s)\+\/-(?=\s|\d|$)/gm, '$1±')
    .replace(/(\d)\s*\+\/-\s*(\d)/g, '$1 ± $2')
    .replace(/[ \t]*!=[ \t]*/g, ' ≠ ')
    .replace(/^[ \t]*(?:└──?|├──?|└)[ \t]+/gm, '↳ ')
    .replace(/([^\s])[ \t]{2,}(→|←|↔|⇌)/g, '$1 $2')
    .replace(/(→|←|↔|⇌)[ \t]{2,}/g, '$1 ')
    .replace(/\uE000SDPROT_(\d+)\uE001/g, (_m, idxStr) => protectedTokens[Number(idxStr)] ?? '');

  return s;
}

function readHeader(
  headers: VercelRequest['headers'],
  name: string
): string {
  const val = headers?.[name];
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val) && typeof val[0] === 'string') return val[0].trim();
  return '';
}

function parseUserAiConfig(
  raw: unknown,
  headers?: VercelRequest['headers']
): UserAiConfig | null {
  const hdrKey = readHeader(headers, 'x-user-api-key');
  const hdrProvider = readHeader(headers, 'x-user-ai-provider');
  const hdrBaseUrl = readHeader(headers, 'x-user-ai-base-url');
  const hdrModel = readHeader(headers, 'x-user-ai-model');

  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const apiKey = (typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '') || hdrKey;
  if (!apiKey || apiKey.length < 10) return null;

  const rawProv = (typeof obj.provider === 'string' ? obj.provider.trim() : '') || hdrProvider;
  const provider: UserAiProvider =
    rawProv === 'grok'
      ? 'grok'
      : rawProv === 'openai-compatible'
      ? 'openai-compatible'
      : 'gemini';

  return {
    provider,
    apiKey,
    baseUrl:
      (typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : '') || hdrBaseUrl || undefined,
    model: (typeof obj.model === 'string' ? obj.model.trim() : '') || hdrModel || undefined,
    verifiedModel:
      typeof obj.verifiedModel === 'string' ? obj.verifiedModel.trim() || undefined : undefined,
  };
}

function sanitizeAllowedModel(model: string | undefined, fallback: string): string {
  const m = (model || '').trim();
  if (!m) return fallback;
  if (/^gemini-(?:1\.5|2\.0|pro\b)/i.test(m)) return fallback;
  return m;
}

function buildGeminiCandidateList(config: UserAiConfig): string[] {
  const ordered: string[] = [];
  const pushUnique = (m?: string) => {
    const trimmed = (m || '').trim();
    if (!trimmed || /^gemini-(?:1\.5|2\.0|pro\b)/i.test(trimmed)) return;
    if (!ordered.includes(trimmed)) ordered.push(trimmed);
  };

  if (config.model?.trim()) {
    pushUnique(sanitizeAllowedModel(config.model, DEFAULT_GEMINI_FORMAT_MODEL));
  }
  if (config.verifiedModel?.trim()) {
    pushUnique(config.verifiedModel);
  }
  for (const m of BYOK_GEMINI_CANDIDATES) {
    pushUnique(m);
  }
  return ordered;
}

function normalizeOpenAiBaseUrl(baseUrl?: string): string {
  const clean = (baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) return DEFAULT_OPENAI_BASE_URL;
  return clean;
}

function buildOpenAiCandidateList(config: UserAiConfig): string[] {
  const isGrok = config.provider === 'grok';
  const ordered: string[] = [];
  const pushUnique = (m?: string) => {
    const trimmed = (m || '').trim();
    if (trimmed && !ordered.includes(trimmed)) ordered.push(trimmed);
  };
  if (config.model?.trim()) pushUnique(config.model);
  if (config.verifiedModel?.trim()) pushUnique(config.verifiedModel);
  const defaults = isGrok ? BYOK_GROK_CANDIDATES : BYOK_OPENAI_CANDIDATES;
  for (const m of defaults) pushUnique(m);
  return ordered;
}

async function discoverOpenAiModels(
  baseUrl: string,
  apiKey: string,
  alreadyTried: Set<string>
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    if (!Array.isArray(data?.data)) return [];
    return data.data
      .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
      .filter(
        (id) =>
          Boolean(id) &&
          !alreadyTried.has(id) &&
          !/embed|whisper|tts|dall-e|moderation|realtime|transcribe|audio|image|sora|flux|rerank/i.test(
            id
          )
      )
      .slice(0, 4);
  } catch {
    return [];
  }
}

function getGeminiModelTuning(model: string): {
  thinkingConfig?: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number };
  maxOutputTokens: number;
  temperature?: number;
  topP?: number;
  seed?: number;
} {
  if (/^gemini-3\./i.test(model)) {
    return {
      thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
      maxOutputTokens: 8192,
      seed: 42,
    };
  }
  if (/^gemini-2\.5-flash-lite/i.test(model)) {
    return {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 8192,
      temperature: 0.15,
      topP: 0.85,
    };
  }
  if (/^gemini-2\.5-/i.test(model)) {
    return {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 8192,
      temperature: 0.2,
      topP: 0.9,
    };
  }
  if (/^gemini-4-/i.test(model)) {
    return {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      maxOutputTokens: 8192,
      seed: 42,
    };
  }
  return { maxOutputTokens: 8192, temperature: 0.2 };
}

function getOpenAiModelTuning(
  provider: UserAiProvider,
  model: string
): { temperature: number; max_tokens: number; reasoning_effort?: 'low' } {
  if (provider === 'grok' && /grok-3-mini/i.test(model)) {
    return { temperature: 0.2, max_tokens: 8192, reasoning_effort: 'low' };
  }
  return { temperature: 0.2, max_tokens: 8192 };
}

async function resolveExplicitGeminiCache(
  ai: GoogleGenAI,
  apiKey: string,
  model: string,
  compacted: string
): Promise<string | undefined> {
  if (compacted.length < EXPLICIT_CACHE_MIN_CHARS) return undefined;

  const now = Date.now();
  for (const [k, v] of explicitCacheRegistry.entries()) {
    if (v.expiresAt < now) explicitCacheRegistry.delete(k);
  }
  if (explicitCacheRegistry.size > 80) {
    const oldestKey = explicitCacheRegistry.keys().next().value;
    if (oldestKey) explicitCacheRegistry.delete(oldestKey);
  }

  const hash = createHash('sha256')
    .update(`${apiKey.slice(-12)}|${model}|${compacted}`)
    .digest('hex');

  const existing = explicitCacheRegistry.get(hash);
  if (!existing) {
    // First call on this document: use implicit prefix cache without paying explicit cache creation overhead
    explicitCacheRegistry.set(hash, {
      calls: 1,
      expiresAt: now + EXPLICIT_CACHE_TTL_MS,
    });
    return undefined;
  }

  existing.calls += 1;
  if (existing.unsupported) return undefined;
  if (existing.cacheName && existing.expiresAt > now + 15_000) {
    return existing.cacheName;
  }

  // Second+ call (preset switch / re-format / toggle cards): promote document to explicit Gemini context cache
  try {
    const created = await ai.caches.create({
      model,
      config: {
        systemInstruction: STATIC_GEMINI_SYSTEM_INSTRUCTION,
        contents: compacted,
        ttl: '300s',
      },
    });
    if (created.name) {
      existing.cacheName = created.name;
      existing.expiresAt = now + EXPLICIT_CACHE_TTL_MS;
      return created.name;
    }
  } catch {
    existing.unsupported = true;
  }
  return undefined;
}

function extractGeminiResponseText(response: {
  text?: string;
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
}): string {
  const direct = typeof response.text === 'string' ? response.text.trim() : '';
  if (direct) return direct;
  const parts = response.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((p) => !p?.thought && typeof p?.text === 'string')
    .map((p) => p.text || '')
    .join('')
    .trim();
}

function detectKeyProviderMismatch(config: UserAiConfig): string | null {
  const k = config.apiKey.trim();
  if (config.provider === 'gemini') {
    if (k.startsWith('xai-')) {
      return 'This looks like an xAI Grok key (xai-…). Switch the provider above to "Grok (xAI)".';
    }
    if (k.startsWith('sk-')) {
      return 'This looks like an OpenAI-compatible key (sk-…). Switch the provider above to "OpenAI-Compatible".';
    }
  } else if (config.provider === 'grok') {
    if (k.startsWith('AIza')) {
      return 'This looks like a Google Gemini key (AIza…). Switch the provider above to "Google Gemini (Default)".';
    }
  } else if (config.provider === 'openai-compatible') {
    if (k.startsWith('AIza')) {
      return 'This looks like a Google Gemini key (AIza…). Switch the provider above to "Google Gemini (Default)".';
    }
    if (k.startsWith('xai-')) {
      return 'This looks like an xAI Grok key (xai-…). Switch the provider above to "Grok (xAI)".';
    }
  }
  return null;
}

function shouldFallbackToNextModel(err: unknown, config: UserAiConfig): boolean {
  if (detectKeyProviderMismatch(config)) return false;
  const msg = err instanceof Error ? err.message : String(err || '');
  if (err instanceof Error && err.name === 'AbortError' && !/timed out/i.test(msg)) {
    return false;
  }
  if (
    /API_KEY_INVALID|API key not valid|Incorrect API key|invalid x-api-key|invalid_api_key|AuthenticationError|\b401\b|Unauthorized/i.test(
      msg
    )
  ) {
    return false;
  }
  if (/ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ERR_INVALID_URL/i.test(msg)) {
    return false;
  }
  if (/insufficient_quota|exceeded your current quota|billing.*not active|account.*deactivated/i.test(msg)) {
    return false;
  }
  return true;
}

function extractReadableErrorMessage(err: unknown, config: UserAiConfig): string {
  const mismatch = detectKeyProviderMismatch(config);
  if (mismatch) return mismatch;

  const raw = err instanceof Error ? err.message : String(err || 'Request failed.');
  let detail = raw;

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        error?: { message?: string } | string;
        message?: string;
      };
      if (typeof parsed.error === 'string' && parsed.error.trim()) {
        detail = parsed.error.trim();
      } else if (parsed.error && typeof parsed.error === 'object' && parsed.error.message) {
        detail = parsed.error.message.trim();
      } else if (parsed.message) {
        detail = parsed.message.trim();
      }
    } catch {
      // keep raw detail
    }
  }

  if (/API_KEY_INVALID|API key not valid|Incorrect API key|invalid x-api-key|unauthorized|401/i.test(detail)) {
    return 'Invalid API key. Double-check you copied the full key without extra spaces and that it matches the selected provider.';
  }
  if (/PERMISSION_DENIED|403/i.test(detail)) {
    return `Permission denied by ${
      config.provider === 'gemini' ? 'Google AI' : config.provider === 'grok' ? 'xAI' : 'API host'
    }. Make sure the key is active and has model access/credits.`;
  }
  if (/RESOURCE_EXHAUSTED|429|quota|rate limit|insufficient_quota/i.test(detail)) {
    return 'API quota or rate limit exceeded for this key. Wait a minute or check billing/credits on your provider account.';
  }
  if (/TimeoutError|AbortError|timed out|aborted/i.test(detail)) {
    return 'AI request timed out. Try shorter study text or retry in a moment.';
  }
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(detail)) {
    return config.provider === 'openai-compatible'
      ? 'Could not reach the custom API Base URL. Check the URL in Model / endpoint options.'
      : 'Could not reach the AI provider network endpoint. Please try again in a moment.';
  }
  return detail.slice(0, 260);
}

function tryRepairTruncatedJson(raw: string): RawCompactSchemaPayload | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let candidate = raw.slice(start).trim();

  const stack: Array<'{' | '['> = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (ch === ']' && stack[stack.length - 1] === '[') stack.pop();
  }

  if (inString) {
    if (escaped) candidate = candidate.slice(0, -1);
    candidate += '"';
  }
  candidate = candidate.replace(/,\s*$/, '').replace(/:\s*$/, ': ""');
  while (stack.length > 0) {
    const open = stack.pop();
    candidate = candidate.replace(/,\s*$/, '');
    candidate += open === '{' ? '}' : ']';
  }

  try {
    const parsed = JSON.parse(candidate) as RawCompactSchemaPayload;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.s)) {
      return parsed;
    }
  } catch {
    const lastCompleteBrace = raw.lastIndexOf('}', raw.length - 1);
    if (lastCompleteBrace > start) {
      try {
        return JSON.parse(raw.slice(start, lastCompleteBrace + 1)) as RawCompactSchemaPayload;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function extractJsonPayload(rawText: string, allowRepair = true): RawCompactSchemaPayload {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!cleaned) {
    throw new Error('The AI model returned an empty response. Please try again.');
  }

  try {
    return JSON.parse(cleaned) as RawCompactSchemaPayload;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as RawCompactSchemaPayload;
      } catch {
        // fall through
      }
    }
    if (allowRepair) {
      const repaired = tryRepairTruncatedJson(cleaned);
      if (repaired) return repaired;
    }
    throw new Error('The AI model returned malformed JSON. Try again or pick another model.');
  }
}

/**
 * Smart pre-filter for webpages & raw notes: normalizes external symbols, strips trailing Reference/See-Also sections,
 * Wikipedia footnotes, media captions, conversational filler, URLs, and duplicate lines BEFORE AI runs.
 */
function compactInputForAi(rawText: string, maxChars = 60000): string {
  const noiseLine =
    /^(?:skip to (?:main )?content|cookie (?:policy|preferences|settings)|accept all cookies|sign in|log in|subscribe|advertisement|sponsored|menu|breadcrumbs?|back to top|all rights reserved|©\s*\d{4}|table of contents|edit section|\[edit\]|jump to navigation|share this page|print page|related topics?|did this page help you\??|yes\s*no|test yourself|join now|sign up|download pdf|view all topics)$/i;
  const webFluffPrefix =
    /^(?:image\s+(?:source|caption)|video\s+caption|media\s+caption|watch:|listen:|play\s+video|read\s+more:|related:|in\s+this\s+(?:article|guide|page),?\s+we\s+(?:will|are\s+going\s+to)|welcome\s+to\s+this|click\s+here\s+to|scroll\s+down\s+to)/i;
  const trailingJunkHeading =
    /^(?:#{1,4}\s*)?(?:see\s+also|references?|external\s+links?|further\s+reading|bibliography|notes\s+and\s+references|citations|related\s+(?:topics?|articles?|guides?|resources?)|more\s+on\s+this\s+topic|watch\s+and\s+listen)$/i;

  const seen = new Set<string>();
  const normalizedRaw = normalizeStudySymbols(String(rawText || ''), {
    preserveLeadingFlowMarker: true,
  });
  const rawLines = normalizedRaw
    .replace(/\[([^\]\n]{1,120})\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[(?:\d+|citation needed|edit|note\s*\d*)\]/gi, '')
    .split('\n');

  const kept: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const cleanedLine = rawLines[i]
      .replace(/(?<=\S)(?:\t+| {3,})(?=\S)/g, ' | ')
      .replace(/ {2,}/g, ' ')
      .trimEnd();
    const t = cleanedLine.trim();
    if (!t) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }

    if (kept.length >= 14 && trailingJunkHeading.test(t.replace(/[:*]/g, '').trim())) {
      break;
    }

    if (noiseLine.test(t) || webFluffPrefix.test(t)) continue;
    if (t.length >= 16) {
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
    }
    kept.push(cleanedLine);
  }

  const collapsed = kept
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (collapsed.length <= maxChars) return collapsed;
  const cutIdx = collapsed.lastIndexOf('\n', maxChars);
  return collapsed.slice(0, cutIdx > maxChars * 0.7 ? cutIdx : maxChars).trim();
}

const SINGLE_PASS_CHUNK_LIMIT = 12500;
const CHUNK_TARGET_CHARS = 10500;

function splitTextIntoBalancedChunks(text: string, maxChunkChars = CHUNK_TARGET_CHARS): string[] {
  const clean = text.trim();
  if (clean.length <= maxChunkChars) return [clean];

  const blocks = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';

  const flushBuf = () => {
    if (buf.trim()) {
      chunks.push(buf.trim());
      buf = '';
    }
  };

  for (const blk of blocks) {
    if (blk.length > maxChunkChars) {
      flushBuf();
      const lines = blk.split('\n');
      let lineBuf = '';
      for (const ln of lines) {
        if (lineBuf && lineBuf.length + ln.length + 1 > maxChunkChars) {
          chunks.push(lineBuf.trim());
          lineBuf = ln;
        } else {
          lineBuf = lineBuf ? `${lineBuf}\n${ln}` : ln;
        }
      }
      if (lineBuf.trim()) chunks.push(lineBuf.trim());
      continue;
    }

    const isMajorHeading = /^#{1,2}\s+\S/.test(blk.trim());
    if (buf && (buf.length + blk.length + 2 > maxChunkChars || (isMajorHeading && buf.length >= maxChunkChars * 0.55))) {
      flushBuf();
    }
    buf = buf ? `${buf}\n\n${blk}` : blk;
  }
  flushBuf();

  return chunks.length > 0 ? chunks : [clean];
}

function splitChunkInHalf(text: string): [string, string] | null {
  const clean = text.trim();
  if (clean.length < 1800) return null;
  const mid = Math.floor(clean.length / 2);
  const searchStart = Math.floor(clean.length * 0.3);
  const searchEnd = Math.floor(clean.length * 0.7);
  let splitIdx = -1;

  const headingAfter = clean.indexOf('\n#', mid);
  if (headingAfter !== -1 && headingAfter <= searchEnd) splitIdx = headingAfter;
  if (splitIdx === -1) {
    const headingBefore = clean.lastIndexOf('\n#', mid);
    if (headingBefore >= searchStart) splitIdx = headingBefore;
  }
  if (splitIdx === -1) {
    const paraAfter = clean.indexOf('\n\n', mid);
    const paraBefore = clean.lastIndexOf('\n\n', mid);
    if (paraAfter !== -1 && paraAfter <= searchEnd) splitIdx = paraAfter;
    else if (paraBefore >= searchStart) splitIdx = paraBefore;
  }
  if (splitIdx === -1) {
    const lineAfter = clean.indexOf('\n', mid);
    const lineBefore = clean.lastIndexOf('\n', mid);
    if (lineAfter !== -1 && lineAfter <= searchEnd) splitIdx = lineAfter;
    else if (lineBefore >= searchStart) splitIdx = lineBefore;
  }
  if (splitIdx === -1) splitIdx = mid;

  const left = clean.slice(0, splitIdx).trim();
  const right = clean.slice(splitIdx).trim();
  if (!left || !right) return null;
  return [left, right];
}

/**
 * Checks if compacted text ALREADY has clean headings + bullets/tables/visuals and no prose walls.
 * If already good, keeps the formatting intact with 0 AI tokens used!
 */
function detectAlreadyGoodFormatting(text: string): boolean {
  const normalized = normalizeStudySymbols(text, { preserveLeadingFlowMarker: true });
  const lines = normalized.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 4) return false;

  let headings = 0;
  let structured = 0;
  let denseBlobs = 0;
  let totalChars = 0;

  for (const raw of lines) {
    const t = raw.trim();
    totalChars += t.length;
    if (/^#{1,3}\s+\S/.test(t)) headings++;
    else if (
      /^\|.+\|$/.test(t) ||
      /^⇒\s+/.test(t) ||
      /^📌\s+/.test(t) ||
      /^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣↳]|[☐☑✓✔✅]|\[[ xX✓✔]?\]|\d+[.)])\s+\S/.test(t)
    ) {
      structured++;
    } else if (t.length > 360) {
      denseBlobs++;
    }
  }

  const avgLen = totalChars / Math.max(1, lines.length);
  if (denseBlobs > 0 || avgLen > 165) return false;
  if (normalized.length < 900) return headings >= 1 && structured >= 3;
  return headings >= 2 && structured >= 4;
}

function preserveWellFormattedText(text: string, includeCards: boolean, colorCodeParts = false) {
  const sections: Array<{
    heading: string;
    points: string[];
    partRole?: NotePartRole;
    accentColor?: NoteAccentColor;
  }> = [];
  const keyTerms: Array<{ term: string; definition: string }> = [];
  const cards: Array<{ q: string; a: string; sectionName: string }> = [];
  const seenTerms = new Set<string>();
  let title: string | undefined;
  let summary = '';
  let examTip = '';
  let workedExample = '';
  let current = { heading: 'Study Notes', points: [] as string[] };

  const pushCurrent = () => {
    if (current.points.length > 0 || (current.heading !== 'Study Notes' && sections.length > 0)) {
      sections.push(current);
    }
  };

  const normalizedText = normalizeStudySymbols(text, { preserveLeadingFlowMarker: true });
  for (const raw of normalizedText.split('\n')) {
    const isSub =
      /^\s{2,}(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣↳]|\d+[.)])\s+/.test(raw) || raw.trim().startsWith('↳ ');
    const line = raw.trim();
    if (!line) continue;
    if (/^\|\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|$/.test(line)) continue;

    const h1Match = line.match(/^#\s+(.+)$/);
    if (h1Match && !title && sections.length === 0 && current.points.length === 0) {
      title = h1Match[1].replace(/\*\*/g, '').trim();
      continue;
    }

    const hMatch = line.match(/^(#{1,2})\s+(.+)$/);
    if (hMatch) {
      pushCurrent();
      current = { heading: hMatch[2].replace(/\*\*/g, '').trim(), points: [] };
      continue;
    }

    if (line.startsWith('### ')) {
      current.points.push(`### ${line.slice(4).replace(/\*\*/g, '').trim()}`);
      continue;
    }

    const sumMatch = line.match(/^(?:\*\*)?(?:summary|overview)(?:\*\*)?\s*[:–—-]\s*(.+)$/i);
    if (sumMatch && !summary) {
      summary = sumMatch[1].trim();
      continue;
    }

    const tipMatch = line.match(/^(?:\*\*)?exam(?:iner)?\s*tip(?:\*\*)?\s*[:–—-]\s*(.+)$/i);
    if (tipMatch) {
      examTip = examTip ? `${examTip}\n${tipMatch[1].trim()}` : tipMatch[1].trim();
      continue;
    }

    const exMatch = line.match(/^(?:\*\*)?worked\s*example(?:\*\*)?\s*[:–—-]\s*(.+)$/i);
    if (exMatch) {
      workedExample = workedExample ? `${workedExample}\n${exMatch[1].trim()}` : exMatch[1].trim();
      continue;
    }

    if (/^\|.+\|$/.test(line) || line.startsWith('📌 ') || line.startsWith('⇒ ')) {
      current.points.push(line);
      continue;
    }

    const bulletRe = /^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣↳]|\d+[.)])\s+/;
    const cleanedBullet = line
      .replace(bulletRe, '')
      .replace(/^\[[ ]\]\s+/, '☐ ')
      .replace(/^\[[xX✓✔]\]\s+/, '✓ ')
      .trim();
    const isBullet =
      bulletRe.test(line) || /^(?:\[[ xX✓✔]?\]|[☐☑✓✔✅])\s+/.test(line);

    const kv = cleanedBullet.match(/^\*\*(.+?)\*\*\s*[:–—-]\s*(.+)$/);
    if (kv && kv[1].length <= 65 && !seenTerms.has(kv[1].toLowerCase())) {
      const term = kv[1].trim();
      const def = kv[2].trim();
      seenTerms.add(term.toLowerCase());
      keyTerms.push({ term, definition: def });
      if (includeCards) {
        cards.push({ q: term, a: def, sectionName: current.heading });
      }
    }

    if (isSub) {
      current.points.push(`↳ ${cleanedBullet}`);
    } else if (isBullet) {
      current.points.push(cleanedBullet);
    } else {
      current.points.push(cleanedBullet.startsWith('¶ ') ? cleanedBullet : `¶ ${cleanedBullet}`);
    }
  }
  pushCurrent();

  const finalSections = sections.length ? sections : [{ heading: 'Study Notes', points: [] }];
  return {
    title,
    summary,
    sections: colorCodeParts ? applyVerifiedPartColors(finalSections, true) : finalSections,
    keyTerms,
    examTip,
    workedExample,
    timelineEvents: [],
    cards: includeCards ? cards.slice(0, 8) : [],
  };
}

function getPresetDirective(preset?: string): string {
  switch (preset) {
    case 'save-my-exams':
      return 'Style=ExamRevision(syllabus headings h,<=15w **Term** bullets,"↳ " sub-points,"| A | B |" tables,x=ExaminerTip,w=WorkedExample).';
    case 'cornell':
      return 'Style=SummaryCues(u=strong overview;cue ### subheads + "↳ " indented proof;k=glossary).';
    case 'timeline-causal':
      return 'Style=TimelineCauseEffect(chronological Key Dates table or sections,"⇒ Cause → Effect",dated events e[]).';
    case 'compact':
      return 'Style=QuickCheatSheet(minimal words,high-yield tables, bullets & key terms only).';
    case 'balanced-visual':
    default:
      return 'Style=CleanNaturalNotes(synthesize cohesively without artificial mini-section splits; lead with Key Dates/Data table if applicable; use clear "### " subheadings, horizontal "⇒ A → B → C" arrow cards, "| A | B |" comparisons, and crisp bullets + "↳ " sub-points; leave u="" unless helpful).';
  }
}

function buildCompactOptionsLine(params: {
  preset?: string;
  includeTimeline: boolean;
  includeCards: boolean;
  detectFlowDiagrams: boolean;
  autoTables: boolean;
  colorCodeParts: boolean;
}): string {
  return [
    `[OPT] ${getPresetDirective(params.preset)}`,
    params.detectFlowDiagrams ? 'Flows=ON("⇒ A → B → C").' : 'Flows=OFF.',
    params.autoTables ? 'Tables=ON("| H1 | H2 |" with real header row; convert dates/contrasts/matrices).' : 'Tables=OFF.',
    params.includeTimeline ? 'Dates=ON.' : 'Dates=OFF.',
    params.includeCards ? 'Cards=4-6.' : 'Cards=OFF.',
    params.colorCodeParts
      ? 'ColorParts=ON(classify s[].r strictly: core|process|compare|example|risk; core=theory/definitions, process=steps/mechanisms/solutions, compare=tables/types/eval, example=case-studies/dates/examples, risk=limits/disadvantages/risks).'
      : 'ColorParts=OFF.',
    'Treat any existing formatting in [SOURCE] as minimum baseline to preserve & upgrade; clear macro sections + ### subheads and **bold** key terms.',
  ].join(' ');
}

function buildAutoformatSchema(opts: {
  includeTimeline: boolean;
  includeCards: boolean;
  colorCodeParts: boolean;
}) {
  const sectionProps: Record<string, unknown> = {
    h: { type: Type.STRING },
    p: { type: Type.ARRAY, items: { type: Type.STRING } },
  };
  if (opts.colorCodeParts) {
    sectionProps.r = {
      type: Type.STRING,
      enum: ['core', 'process', 'compare', 'example', 'risk'],
      description:
        'Part type: core (theory/defs), process (steps/mechanisms), compare (tables/eval), example (case study/dates), risk (limits/disadvantages)',
    };
  }

  const properties: Record<string, unknown> = {
    t: { type: Type.STRING, description: 'Short title' },
    u: { type: Type.STRING, description: '1-sentence summary' },
    s: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: sectionProps,
        required: opts.colorCodeParts ? ['h', 'p', 'r'] : ['h', 'p'],
      },
    },
    k: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          t: { type: Type.STRING },
          d: { type: Type.STRING },
        },
        required: ['t', 'd'],
      },
    },
    x: { type: Type.STRING },
    w: { type: Type.STRING },
  };

  if (opts.includeTimeline) {
    properties.e = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          d: { type: Type.STRING },
          t: { type: Type.STRING },
          x: { type: Type.STRING },
          g: { type: Type.STRING },
          k: { type: Type.BOOLEAN },
        },
        required: ['d', 't', 'x'],
      },
    };
  }

  if (opts.includeCards) {
    properties.c = {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          q: { type: Type.STRING },
          a: { type: Type.STRING },
          s: { type: Type.STRING },
        },
        required: ['q', 'a'],
      },
    };
  }

  return {
    type: Type.OBJECT,
    properties,
    required: ['s'],
  };
}

function expandCompactPayload(raw: RawCompactSchemaPayload, colorCodeParts = false) {
  const norm = (v: unknown, preserveFlow = false) =>
    normalizeStudySymbols(String(v || ''), { preserveLeadingFlowMarker: preserveFlow }).trim();

  const baseSections = Array.isArray(raw.s)
    ? raw.s
        .map((sec) => ({
          heading: norm(sec?.h) || 'Key Points',
          points: Array.isArray(sec?.p)
            ? sec.p.map((pt) => norm(pt, true)).filter((pt) => pt.length > 0)
            : [],
          partRole: colorCodeParts ? normalizeNotePartRole(sec?.r) : undefined,
        }))
        .filter((sec) => sec.points.length > 0)
    : [];

  const nonEmptySections = baseSections.length
    ? baseSections
    : [{ heading: 'Key Points', points: [] as string[], partRole: undefined }];

  const sections = colorCodeParts
    ? applyVerifiedPartColors(nonEmptySections, true)
    : nonEmptySections.map(({ heading, points }) => ({ heading, points }));

  const keyTerms = Array.isArray(raw.k)
    ? raw.k
        .map((kt) => ({
          term: norm(kt?.t),
          definition: norm(kt?.d),
        }))
        .filter((kt) => kt.term && kt.definition)
    : [];

  const timelineEvents = Array.isArray(raw.e)
    ? raw.e
        .map((ev) => ({
          date: norm(ev?.d) || 'Undated',
          title: norm(ev?.t),
          detail: norm(ev?.x),
          significance: norm(ev?.g) || undefined,
          keyEvent: Boolean(ev?.k) || undefined,
        }))
        .filter((ev) => ev.title)
    : [];

  const cards = Array.isArray(raw.c)
    ? raw.c
        .map((fc) => ({
          q: norm(fc?.q),
          a: norm(fc?.a),
          sectionName: norm(fc?.s) || 'AI Key Cards',
        }))
        .filter((fc) => fc.q && fc.a)
    : [];

  return {
    title: typeof raw.t === 'string' && norm(raw.t) ? norm(raw.t) : undefined,
    summary: norm(raw.u),
    sections,
    keyTerms,
    examTip: norm(raw.x),
    workedExample: norm(raw.w),
    timelineEvents,
    cards,
  };
}

type ExpandedPayload = ReturnType<typeof expandCompactPayload>;

function mergeExpandedPayloads(parts: ExpandedPayload[]): ExpandedPayload {
  if (parts.length === 1) return parts[0];

  const mergedSections: ExpandedPayload['sections'] = [];
  const mergedTerms: ExpandedPayload['keyTerms'] = [];
  const seenTerms = new Set<string>();
  const mergedEvents: ExpandedPayload['timelineEvents'] = [];
  const seenEvents = new Set<string>();
  const mergedCards: ExpandedPayload['cards'] = [];
  const seenCards = new Set<string>();
  const tipParts: string[] = [];
  const exParts: string[] = [];
  let title: string | undefined;
  let summary = '';

  for (const part of parts) {
    if (!title && part.title) title = part.title;
    if (!summary && part.summary) summary = part.summary;
    if (part.examTip && !tipParts.includes(part.examTip)) tipParts.push(part.examTip);
    if (part.workedExample && !exParts.includes(part.workedExample)) exParts.push(part.workedExample);

    for (const sec of part.sections) {
      const prev = mergedSections[mergedSections.length - 1];
      if (prev && prev.heading.trim().toLowerCase() === sec.heading.trim().toLowerCase()) {
        prev.points.push(...sec.points);
      } else {
        mergedSections.push({ ...sec, points: [...sec.points] });
      }
    }
    for (const kt of part.keyTerms) {
      const key = kt.term.trim().toLowerCase();
      if (!seenTerms.has(key)) {
        seenTerms.add(key);
        mergedTerms.push(kt);
      }
    }
    for (const ev of part.timelineEvents) {
      const key = `${ev.date.toLowerCase()}::${ev.title.toLowerCase()}`;
      if (!seenEvents.has(key)) {
        seenEvents.add(key);
        mergedEvents.push(ev);
      }
    }
    for (const c of part.cards) {
      const key = c.q.trim().toLowerCase();
      if (!seenCards.has(key)) {
        seenCards.add(key);
        mergedCards.push(c);
      }
    }
  }

  return {
    title,
    summary,
    sections: mergedSections.length ? mergedSections : [{ heading: 'Key Points', points: [] }],
    keyTerms: mergedTerms,
    examTip: tipParts.join('\n\n'),
    workedExample: exParts.join('\n\n'),
    timelineEvents: mergedEvents,
    cards: mergedCards.slice(0, 12),
  };
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

  const config = parseUserAiConfig(body.byok, req.headers);
  if (!config) {
    res.status(401).json({
      error:
        'AI Autoformatting requires your own API key. Add one in Account & Data (the website key is strictly reserved for Live Quiz marking).',
      requiresByok: true,
    });
    return;
  }

  const mismatch = detectKeyProviderMismatch(config);
  if (mismatch) {
    res.status(400).json({ error: mismatch });
    return;
  }

  const compacted = compactInputForAi(String(body.rawText || '').trim());
  if (!compacted) {
    res.status(400).json({
      error: 'No useful study content found after filtering webpage navigation/noise. Paste study notes directly.',
    });
    return;
  }

  const preset = typeof body.preset === 'string' ? body.preset : 'balanced-visual';
  const includeCards = Boolean(body.includeCards);
  const includeTimeline = body.includeTimeline !== false;
  const detectFlowDiagrams = body.detectFlowDiagrams !== false;
  const autoTables = body.autoTables !== false;
  const colorCodeParts = Boolean(body.colorCodeParts);
  const keepExistingOnly = Boolean(body.keepExistingOnly);
  const wantsStream =
    Boolean(body.stream) || readHeader(req.headers, 'accept').includes('text/event-stream');

  const optionsLine = buildCompactOptionsLine({
    preset,
    includeTimeline,
    includeCards,
    detectFlowDiagrams,
    autoTables,
    colorCodeParts,
  });

  const sendSse = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
  }

  if (keepExistingOnly && detectAlreadyGoodFormatting(compacted)) {
    const preserved = preserveWellFormattedText(compacted, includeCards, colorCodeParts);
    const usage = {
      provider: config.provider,
      model: 'kept-existing',
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
    };
    if (wantsStream) {
      sendSse({ type: 'status', message: 'Keeping existing layout (0 tokens)…' });
      sendSse({ type: 'done', formatted: preserved, usage, keptExistingFormat: true });
      res.end();
      return;
    }
    res.status(200).json({ formatted: preserved, usage, keptExistingFormat: true });
    return;
  }

  if (wantsStream) {
    sendSse({ type: 'status', message: 'Filtered webpage noise. Connecting to AI…' });
  }

  const formatSingleChunk = async (
    chunkText: string,
    chunkLabel?: string,
    depth = 0,
    activeConfig: UserAiConfig = config
  ): Promise<{
    formatted: ExpandedPayload;
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cachedTokens: number;
  }> => {
    const recoverFromTruncation = async (
      rawOutput: string,
      fallbackModel: string
    ): Promise<{
      formatted: ExpandedPayload;
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      cachedTokens: number;
    } | null> => {
      if (depth < 2 && chunkText.length >= 1800) {
        const halves = splitChunkInHalf(chunkText);
        if (halves) {
          if (wantsStream) {
            sendSse({ type: 'status', message: 'Output limit reached — splitting section for full coverage…' });
          }
          const nextCfg = { ...activeConfig, verifiedModel: fallbackModel };
          const left = await formatSingleChunk(halves[0], chunkLabel ? `${chunkLabel} (a)` : 'part 1 of 2', depth + 1, nextCfg);
          const right = await formatSingleChunk(
            halves[1],
            chunkLabel ? `${chunkLabel} (b)` : 'part 2 of 2',
            depth + 1,
            { ...nextCfg, verifiedModel: left.model }
          );
          return {
            formatted: mergeExpandedPayloads([left.formatted, right.formatted]),
            model: right.model,
            inputTokens: left.inputTokens + right.inputTokens,
            outputTokens: left.outputTokens + right.outputTokens,
            totalTokens: left.totalTokens + right.totalTokens,
            cachedTokens: left.cachedTokens + right.cachedTokens,
          };
        }
      }
      const repaired = tryRepairTruncatedJson(
        rawOutput
          .trim()
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim()
      );
      if (repaired) {
        return {
          formatted: expandCompactPayload(repaired, colorCodeParts),
          model: fallbackModel,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
        };
      }
      return null;
    };

    if (activeConfig.provider === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey: activeConfig.apiKey.trim(),
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const candidates = buildGeminiCandidateList(activeConfig);
      const responseSchema = buildAutoformatSchema({
        includeTimeline,
        includeCards,
        colorCodeParts,
      });

      let lastErr: unknown = null;
      for (let i = 0; i < candidates.length; i++) {
        const model = candidates[i];
        const tuning = getGeminiModelTuning(model);
        try {
          const cachedContent = await resolveExplicitGeminiCache(
            ai,
            activeConfig.apiKey.trim(),
            model,
            chunkText
          );
          const userContents = cachedContent
            ? optionsLine
            : `${optionsLine}\n\n[SOURCE]\n${chunkText}`;
          const genConfig = {
            ...(cachedContent
              ? { cachedContent }
              : { systemInstruction: STATIC_GEMINI_SYSTEM_INSTRUCTION }),
            ...tuning,
            abortSignal: AbortSignal.timeout(45000),
            responseMimeType: 'application/json',
            responseSchema,
          };

          if (wantsStream) {
            const partPrefix = chunkLabel ? ` (${chunkLabel})` : '';
            sendSse({
              type: 'status',
              model,
              message:
                i > 0
                  ? `Switched to ${model}${partPrefix} (${candidates[i - 1]} unavailable)…`
                  : cachedContent
                  ? `Formatting with ${model}${partPrefix} (cached context)…`
                  : `Formatting with ${model}${partPrefix}…`,
            });
            const stream = await ai.models.generateContentStream({
              model,
              contents: userContents,
              config: genConfig,
            });

            let fullText = '';
            let lastEmit = 0;
            let inputTokens = 0;
            let outputTokens = 0;
            let totalTokens = 0;
            let cachedTokens = 0;
            let lastFinishReason = '';

            for await (const chunk of stream) {
              const delta = extractGeminiResponseText(chunk);
              if (delta) {
                fullText += delta;
                const now = Date.now();
                if (now - lastEmit >= 180) {
                  lastEmit = now;
                  sendSse({ type: 'progress', model, chars: fullText.length });
                }
              }
              const fr = chunk.candidates?.[0]?.finishReason;
              if (fr) lastFinishReason = String(fr);
              if (chunk.usageMetadata) {
                inputTokens = Number(chunk.usageMetadata.promptTokenCount || inputTokens);
                outputTokens = Number(chunk.usageMetadata.candidatesTokenCount || outputTokens);
                totalTokens = Number(chunk.usageMetadata.totalTokenCount || totalTokens);
                cachedTokens = Number(chunk.usageMetadata.cachedContentTokenCount || cachedTokens);
              }
            }

            if (lastFinishReason === 'MAX_TOKENS') {
              const recovered = await recoverFromTruncation(fullText, model);
              if (recovered) {
                return {
                  formatted: recovered.formatted,
                  model: recovered.model || model,
                  inputTokens: recovered.inputTokens || inputTokens,
                  outputTokens: recovered.outputTokens || outputTokens,
                  totalTokens: recovered.totalTokens || totalTokens,
                  cachedTokens: recovered.cachedTokens || cachedTokens,
                };
              }
            }

            let parsed: RawCompactSchemaPayload;
            try {
              parsed = extractJsonPayload(fullText);
            } catch (parseErr) {
              const recovered = await recoverFromTruncation(fullText, model);
              if (recovered) return recovered;
              throw parseErr;
            }

            return {
              formatted: expandCompactPayload(parsed, colorCodeParts),
              model,
              inputTokens,
              outputTokens,
              totalTokens,
              cachedTokens,
            };
          }

          const response = await ai.models.generateContent({
            model,
            contents: userContents,
            config: genConfig,
          });
          const jsonStr = extractGeminiResponseText(response);
          const finishReason = String(response.candidates?.[0]?.finishReason || '');
          if (finishReason === 'MAX_TOKENS') {
            const recovered = await recoverFromTruncation(jsonStr, model);
            if (recovered) return recovered;
          }

          let parsed: RawCompactSchemaPayload;
          try {
            parsed = extractJsonPayload(jsonStr);
          } catch (parseErr) {
            const recovered = await recoverFromTruncation(jsonStr, model);
            if (recovered) return recovered;
            throw parseErr;
          }
          const usageMeta = response.usageMetadata;
          return {
            formatted: expandCompactPayload(parsed, colorCodeParts),
            model,
            inputTokens: Number(usageMeta?.promptTokenCount || 0),
            outputTokens: Number(usageMeta?.candidatesTokenCount || 0),
            totalTokens: Number(usageMeta?.totalTokenCount || 0),
            cachedTokens: Number(usageMeta?.cachedContentTokenCount || 0),
          };
        } catch (err) {
          lastErr = err;
          if (i < candidates.length - 1 && shouldFallbackToNextModel(err, activeConfig)) {
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    }

    const isGrok = activeConfig.provider === 'grok';
    const baseUrl = isGrok ? DEFAULT_GROK_BASE_URL : normalizeOpenAiBaseUrl(activeConfig.baseUrl);
    const candidates = buildOpenAiCandidateList(activeConfig);
    const triedSet = new Set(candidates);
    let discoveredExtra = false;
    const userMsg = `${optionsLine}\n\n[SOURCE]\n${chunkText}`;

    let lastErr: unknown = null;
    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      const tuning = getOpenAiModelTuning(activeConfig.provider, model);

      const sendChatCompletion = async (opts: {
        stream: boolean;
        withJsonFormat: boolean;
        withReasoningEffort: boolean;
        maxTokens: number;
      }) => {
        const bodyObj: Record<string, unknown> = {
          model,
          stream: opts.stream,
          temperature: tuning.temperature,
          max_tokens: opts.maxTokens,
          messages: [
            { role: 'system', content: STATIC_OPENAI_SYSTEM_INSTRUCTION },
            { role: 'user', content: userMsg },
          ],
        };
        if (opts.withJsonFormat) bodyObj.response_format = { type: 'json_object' };
        if (opts.withReasoningEffort && tuning.reasoning_effort) bodyObj.reasoning_effort = tuning.reasoning_effort;
        if (opts.stream) bodyObj.stream_options = { include_usage: true };
        return fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(45000),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${activeConfig.apiKey}`,
          },
          body: JSON.stringify(bodyObj),
        });
      };

      const callWithCompatFallback = async (stream: boolean) => {
        let useJson = true;
        let useReasoning = Boolean(tuning.reasoning_effort);
        let maxTokens = tuning.max_tokens;
        let apiRes = await sendChatCompletion({
          stream,
          withJsonFormat: useJson,
          withReasoningEffort: useReasoning,
          maxTokens,
        });
        if (!apiRes.ok && apiRes.status === 400) {
          const errText = await apiRes.text().catch(() => '');
          if (
            /response_format|json_object|stream_options|reasoning_effort|max_tokens/i.test(errText) &&
            !/model/i.test(errText)
          ) {
            if (/response_format|json_object/i.test(errText)) useJson = false;
            if (/reasoning_effort/i.test(errText)) useReasoning = false;
            if (/max_tokens/i.test(errText)) maxTokens = 4096;
            apiRes = await sendChatCompletion({
              stream,
              withJsonFormat: useJson,
              withReasoningEffort: useReasoning,
              maxTokens,
            });
          } else {
            throw new Error(`HTTP ${apiRes.status}: ${errText}`);
          }
        }
        return apiRes;
      };

      try {
        if (wantsStream) {
          const partPrefix = chunkLabel ? ` (${chunkLabel})` : '';
          sendSse({
            type: 'status',
            model,
            message:
              i > 0
                ? `Switched to ${model}${partPrefix} (${candidates[i - 1]} unavailable)…`
                : `Formatting with ${model}${partPrefix}…`,
          });
          const apiRes = await callWithCompatFallback(true);
          if (!apiRes.ok || !apiRes.body) {
            const errText = await apiRes.text().catch(() => '');
            throw new Error(`HTTP ${apiRes.status}: ${errText}`);
          }

          const reader = apiRes.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          let fullContent = '';
          let lastEmit = 0;
          let inputTokens = 0;
          let outputTokens = 0;
          let totalTokens = 0;
          let cachedTokens = 0;
          let lastFinishReason = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line.startsWith('data:')) continue;
              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const parsedChunk = JSON.parse(payload) as {
                  choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
                  usage?: {
                    prompt_tokens?: number;
                    completion_tokens?: number;
                    total_tokens?: number;
                    prompt_tokens_details?: { cached_tokens?: number };
                  };
                };
                const piece = parsedChunk.choices?.[0]?.delta?.content || '';
                if (parsedChunk.choices?.[0]?.finish_reason) {
                  lastFinishReason = String(parsedChunk.choices[0].finish_reason);
                }
                if (piece) {
                  fullContent += piece;
                  const now = Date.now();
                  if (now - lastEmit >= 180) {
                    lastEmit = now;
                    sendSse({ type: 'progress', model, chars: fullContent.length });
                  }
                }
                if (parsedChunk.usage) {
                  inputTokens = Number(parsedChunk.usage.prompt_tokens || inputTokens);
                  outputTokens = Number(parsedChunk.usage.completion_tokens || outputTokens);
                  totalTokens = Number(parsedChunk.usage.total_tokens || totalTokens);
                  cachedTokens = Number(parsedChunk.usage.prompt_tokens_details?.cached_tokens || cachedTokens);
                }
              } catch {
                // ignore partial SSE line
              }
            }
          }

          if (lastFinishReason === 'length') {
            const recovered = await recoverFromTruncation(fullContent, model);
            if (recovered) {
              return {
                formatted: recovered.formatted,
                model: recovered.model || model,
                inputTokens: recovered.inputTokens || inputTokens,
                outputTokens: recovered.outputTokens || outputTokens,
                totalTokens: recovered.totalTokens || totalTokens,
                cachedTokens: recovered.cachedTokens || cachedTokens,
              };
            }
          }

          let parsed: RawCompactSchemaPayload;
          try {
            parsed = extractJsonPayload(fullContent);
          } catch (parseErr) {
            const recovered = await recoverFromTruncation(fullContent, model);
            if (recovered) return recovered;
            throw parseErr;
          }

          return {
            formatted: expandCompactPayload(parsed, colorCodeParts),
            model,
            inputTokens,
            outputTokens,
            totalTokens,
            cachedTokens,
          };
        }

        const apiRes = await callWithCompatFallback(false);
        if (!apiRes.ok) {
          const errText = await apiRes.text().catch(() => '');
          throw new Error(`HTTP ${apiRes.status}: ${errText}`);
        }

        const data = (await apiRes.json()) as {
          choices?: Array<{ message?: { content?: string }; finish_reason?: string | null }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
            prompt_tokens_details?: { cached_tokens?: number };
          };
        };
        const content = (data.choices?.[0]?.message?.content || '').trim();
        if (data.choices?.[0]?.finish_reason === 'length') {
          const recovered = await recoverFromTruncation(content, model);
          if (recovered) return recovered;
        }

        let parsed: RawCompactSchemaPayload;
        try {
          parsed = extractJsonPayload(content);
        } catch (parseErr) {
          const recovered = await recoverFromTruncation(content, model);
          if (recovered) return recovered;
          throw parseErr;
        }

        return {
          formatted: expandCompactPayload(parsed, colorCodeParts),
          model,
          inputTokens: Number(data.usage?.prompt_tokens || 0),
          outputTokens: Number(data.usage?.completion_tokens || 0),
          totalTokens: Number(data.usage?.total_tokens || 0),
          cachedTokens: Number(data.usage?.prompt_tokens_details?.cached_tokens || 0),
        };
      } catch (err) {
        lastErr = err;
        if (!shouldFallbackToNextModel(err, activeConfig)) {
          throw err;
        }
        if (i === candidates.length - 1 && !discoveredExtra && !isGrok) {
          discoveredExtra = true;
          const extraModels = await discoverOpenAiModels(baseUrl, activeConfig.apiKey, triedSet);
          for (const em of extraModels) {
            triedSet.add(em);
            candidates.push(em);
          }
        }
        if (i < candidates.length - 1) {
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  };

  try {
    const chunks =
      compacted.length <= SINGLE_PASS_CHUNK_LIMIT
        ? [compacted]
        : splitTextIntoBalancedChunks(compacted, CHUNK_TARGET_CHARS);

    const formattedParts: ExpandedPayload[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalTokens = 0;
    let totalCached = 0;
    let lastModel = config.model || DEFAULT_GEMINI_FORMAT_MODEL;
    let workingConfig: UserAiConfig = { ...config };

    for (let idx = 0; idx < chunks.length; idx++) {
      const label = chunks.length > 1 ? `part ${idx + 1} of ${chunks.length}` : undefined;
      const chunkRes = await formatSingleChunk(chunks[idx], label, 0, workingConfig);
      formattedParts.push(chunkRes.formatted);
      totalInput += chunkRes.inputTokens;
      totalOutput += chunkRes.outputTokens;
      totalTokens += chunkRes.totalTokens;
      totalCached += chunkRes.cachedTokens;
      lastModel = chunkRes.model;
      workingConfig = { ...workingConfig, verifiedModel: lastModel };
    }

    const finalFormatted = mergeExpandedPayloads(formattedParts);
    const usage = {
      provider: config.provider,
      model: lastModel,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens,
      cachedTokens: totalCached,
    };

    if (wantsStream) {
      sendSse({ type: 'done', formatted: finalFormatted, usage });
      res.end();
      return;
    }

    res.status(200).json({ formatted: finalFormatted, usage });
  } catch (err) {
    const msg = extractReadableErrorMessage(err, config);
    if (wantsStream) {
      sendSse({ type: 'error', error: msg });
      res.end();
      return;
    }
    res.status(502).json({ error: msg });
  }
}
