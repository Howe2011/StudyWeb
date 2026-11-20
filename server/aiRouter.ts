import { createHash } from 'node:crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { Express, Request, Response } from 'express';
import { applyVerifiedPartColors, normalizeNotePartRole } from '../src/lib/noteColors.ts';
import type { NoteAccentColor, NotePartRole } from '../src/types.ts';

export type UserAiProvider = 'gemini' | 'grok' | 'openai-compatible';

export interface UserAiConfig {
  provider: UserAiProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  verifiedModel?: string;
}

export interface CompactFormattedOutput {
  title?: string;
  summary: string;
  sections: Array<{
    heading: string;
    points: string[];
    partRole?: NotePartRole;
    accentColor?: NoteAccentColor;
  }>;
  keyTerms: Array<{
    term: string;
    definition: string;
  }>;
  examTip: string;
  workedExample: string;
  timelineEvents: Array<{
    date: string;
    title: string;
    detail: string;
    significance?: string;
    era?: string;
    keyEvent?: boolean;
  }>;
  cards: Array<{
    q: string;
    a: string;
    sectionName: string;
  }>;
}

export interface AiUsageMeta {
  provider: UserAiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedTokens?: number;
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
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

/**
 * 100% invariant static system prompt prefix — never mutates per preset or toggle,
 * maximizing implicit prefix prompt caching and enabling explicit Context Caching on reuse.
 */
const STATIC_GEMINI_SYSTEM_INSTRUCTION = [
  'You are StudyDeck AI, an elite academic note synthesizer. Convert raw study material or scraped webpage text into crisp, naturally structured revision JSON.',
  'SELECTIVE EXTRACTION: Source text often comes from webpages. IGNORE navigation bars, author bios, filler intros, repetition, and tangents. Extract ONLY core examinable concepts, mechanisms, definitions, data/dates, comparisons, and formulas.',
  'NATURAL HIERARCHY (NEVER rigidly split into artificial 01/02 mini-sections or filler boxes):',
  '- Keep coherent ideas together under natural headings h (keep meaningful source numbering like "1. Topic", do NOT invent 01./02. prefixes).',
  '- Start with a clean "| Date/Key | Event/Point |" summary table (under e.g. "Key Dates" or "Key Data") when the material covers multiple dates, stats, or terms.',
  '- Use "⇒ Step 1 → Step 2 → Step 3" for 2–5 parallel causes, agreements, or sequential steps.',
  '- Use "### Question or Sub-group" for natural sub-points, "**Term**: concise point" + "↳ sub-detail" for bullets, "| A | B |" tables for contrasts, and "📌 Label | Key stat/formula" ONLY for standout facts.',
  '- Keep u (overview) empty "" unless an introductory summary genuinely helps.',
  'Never invent facts not grounded in the source.',
].join('\n');

const STATIC_OPENAI_SYSTEM_INSTRUCTION =
  `${STATIC_GEMINI_SYSTEM_INSTRUCTION}\n` +
  'Return ONLY strict JSON with compact keys: ' +
  '{"t":"title","u":"optional short overview or empty","s":[{"h":"Section Heading","p":["| Key | Detail |","⇒ Step 1 → Step 2 → Step 3","### Sub-question?","**Term**: crisp fact","↳ nested detail","¶ Short 1-2 sentence explanation."]}],"k":[{"t":"term","d":"def"}],"x":"examiner tip or empty","w":"worked example or empty","e":[{"d":"date","t":"event","x":"detail","g":"significance","k":false}],"c":[{"q":"question","a":"answer","s":"section"}]}. ' +
  'Omit e[] or c[] if disabled in [OPT].';

export function parseUserAiConfig(raw: unknown, reqHeaders?: Request['headers']): UserAiConfig | null {
  const hdrKey =
    typeof reqHeaders?.['x-user-api-key'] === 'string'
      ? reqHeaders['x-user-api-key'].trim()
      : '';
  const hdrProvider =
    typeof reqHeaders?.['x-user-ai-provider'] === 'string'
      ? reqHeaders['x-user-ai-provider'].trim()
      : '';
  const hdrBaseUrl =
    typeof reqHeaders?.['x-user-ai-base-url'] === 'string'
      ? reqHeaders['x-user-ai-base-url'].trim()
      : '';
  const hdrModel =
    typeof reqHeaders?.['x-user-ai-model'] === 'string'
      ? reqHeaders['x-user-ai-model'].trim()
      : '';

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

export function createGeminiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: apiKey.trim(),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sanitizeAllowedModel(model: string | undefined, fallback: string): string {
  const m = (model || '').trim();
  if (!m) return fallback;
  if (/^gemini-(?:1\.5|2\.0|pro\b)/i.test(m)) return fallback;
  return m;
}

function buildGeminiCandidateList(config: UserAiConfig): string[] {
  const customModel = config.model?.trim()
    ? sanitizeAllowedModel(config.model, DEFAULT_GEMINI_FORMAT_MODEL)
    : '';
  if (customModel) return [customModel];

  const list: string[] = [...BYOK_GEMINI_CANDIDATES];
  const verified = config.verifiedModel?.trim();
  if (verified && !/^gemini-(?:1\.5|2\.0|pro\b)/i.test(verified) && verified !== 'gemini-4-hydrogen') {
    return [verified, ...list.filter((m) => m !== verified)];
  }
  return list;
}

function normalizeOpenAiBaseUrl(baseUrl?: string): string {
  const clean = (baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) return DEFAULT_OPENAI_BASE_URL;
  return clean;
}

/**
 * Model-specific parameter tuning per model family to cut latency and wasted tokens
 * while obeying model parameter constraints.
 */
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
      maxOutputTokens: 2048,
      seed: 42,
    };
  }
  if (/^gemini-2\.5-flash-lite/i.test(model)) {
    return {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 2048,
      temperature: 0.15,
      topP: 0.85,
    };
  }
  if (/^gemini-2\.5-/i.test(model)) {
    return {
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 2048,
      temperature: 0.2,
      topP: 0.9,
    };
  }
  if (/^gemini-4-/i.test(model)) {
    return {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      maxOutputTokens: 2560,
      seed: 42,
    };
  }
  return { maxOutputTokens: 2048, temperature: 0.2 };
}

function getOpenAiModelTuning(
  provider: UserAiProvider,
  model: string
): { temperature: number; max_tokens: number; reasoning_effort?: 'low' } {
  if (provider === 'grok' && /grok-3-mini/i.test(model)) {
    return { temperature: 0.2, max_tokens: 2048, reasoning_effort: 'low' };
  }
  return { temperature: 0.2, max_tokens: 2048 };
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

function isModelNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return (
    /404|NOT_FOUND|not found|is not supported for generateContent|does not exist|unknown model/i.test(
      msg
    ) && !/API_KEY_INVALID|API key not valid|invalid api key/i.test(msg)
  );
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
        error?: { message?: string; status?: string; code?: number } | string;
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

function extractJsonPayload(rawText: string): RawCompactSchemaPayload {
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
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as RawCompactSchemaPayload;
    }
    throw new Error('The AI model returned malformed JSON. Try again or pick another model.');
  }
}

/**
 * Smart webpage & note pre-filter: strips trailing Reference/See-Also sections,
 * Wikipedia footnotes, media captions, conversational filler, URLs, and duplicate lines
 * BEFORE sending tokens to the AI.
 */
export function compactInputForAi(rawText: string, maxChars = 11000): string {
  const noiseLine =
    /^(?:skip to (?:main )?content|cookie (?:policy|preferences|settings)|accept all cookies|sign in|log in|subscribe|advertisement|sponsored|menu|breadcrumbs?|back to top|all rights reserved|©\s*\d{4}|table of contents|edit section|\[edit\]|jump to navigation|share this page|print page|related topics?|did this page help you\??|yes\s*no|test yourself|join now|sign up|download pdf|view all topics)$/i;
  const webFluffPrefix =
    /^(?:image\s+(?:source|caption)|video\s+caption|media\s+caption|watch:|listen:|play\s+video|read\s+more:|related:|in\s+this\s+(?:article|guide|page),?\s+we\s+(?:will|are\s+going\s+to)|welcome\s+to\s+this|click\s+here\s+to|scroll\s+down\s+to)/i;
  const trailingJunkHeading =
    /^(?:#{1,4}\s*)?(?:see\s+also|references?|external\s+links?|further\s+reading|bibliography|notes\s+and\s+references|citations|related\s+(?:topics?|articles?|guides?|resources?)|more\s+on\s+this\s+topic|watch\s+and\s+listen)$/i;

  const seen = new Set<string>();
  const rawLines = String(rawText || '')
    .replace(/\u200B|\uFEFF/g, '')
    .replace(/\r/g, '')
    .replace(/\[([^\]\n]{1,120})\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[(?:\d+|citation needed|edit|note\s*\d*)\]/gi, '')
    .split('\n');

  const kept: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const cleanedLine = rawLines[i].replace(/[ \t]{2,}/g, ' ').trimEnd();
    const t = cleanedLine.trim();
    if (!t) {
      if (kept.length > 0 && kept[kept.length - 1] !== '') kept.push('');
      continue;
    }

    if (kept.length >= 6 && trailingJunkHeading.test(t.replace(/[:*]/g, '').trim())) {
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
  return `${collapsed.slice(0, maxChars)}\n...[truncated]`;
}

function getPresetDirective(preset?: string): string {
  switch (preset) {
    case 'save-my-exams':
      return 'Style=ExamRevision(clear syllabus headings h,concise **Term** bullets,nested "↳ " points,"| A | B |" comparison tables,x=Examiner Tip,w=Worked Example).';
    case 'cornell':
      return 'Style=SummaryCues(u=strong big-picture summary;s=cue subheadings ### + indented "↳ " details;k=essential glossary).';
    case 'timeline-causal':
      return 'Style=TimelineCauseEffect(chronological Key Dates table or sections,"⇒ Cause → Effect" flow chains,populate dated events e[]).';
    case 'compact':
      return 'Style=QuickCheatSheet(minimum words,high-yield cram tables & bullets,essential terms only).';
    case 'balanced-visual':
    default:
      return (
        'Style=CleanNaturalNotes(' +
        'Organize smoothly like a top-grade study handout—never split rigidly into tiny artificial sections. ' +
        'If multiple dates/stats exist, lead with a clean "Key Dates" or "Key Data" Markdown table. ' +
        'Group each major idea into cohesive sections using clear "### " subheadings, horizontal "⇒ A → B → C" arrow cards for 2-5 part agreements/steps, "| A | B |" comparison tables, and crisp bullets + "↳ " sub-points. Leave u="" unless an intro genuinely adds value).'
      );
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
    params.autoTables ? 'Tables=ON("| H1 | H2 |").' : 'Tables=OFF.',
    params.includeTimeline ? 'Dates=ON(extract dated events into e[]).' : 'Dates=OFF.',
    params.includeCards ? 'Cards=ON(add 4-6 crisp Q/A cards in c[]).' : 'Cards=OFF.',
    params.colorCodeParts
      ? 'ColorParts=ON(group distinct parts cleanly & classify each section s[].r strictly as core|process|compare|example|risk: core=theory/definitions, process=steps/mechanisms/solutions, compare=tables/types/evaluation, example=case-studies/dates/examples, risk=limitations/disadvantages/risks/pitfalls).'
      : 'ColorParts=OFF.',
    'Keep natural section count, <=18 words/bullet, concise key terms.',
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
        'Part type: core (theory/definitions), process (steps/mechanisms/benefits), compare (tables/types/evaluation), example (case study/dates/examples), risk (limits/disadvantages/pitfalls)',
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

function detectAlreadyGoodFormatting(text: string): boolean {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 4) return false;

  let headings = 0;
  let structured = 0;
  let denseBlobs = 0;
  let totalChars = 0;

  for (const raw of lines) {
    const t = raw.trim();
    totalChars += t.length;
    if (/^#{1,3}\s+\S/.test(t)) headings++;
    else if (/^\|.+\|$/.test(t) || /^⇒\s+/.test(t) || /^📌\s+/.test(t) || /^(?:[-*•↳]|\d+[.)])\s+\S/.test(t)) {
      structured++;
    } else if (t.length > 360) {
      denseBlobs++;
    }
  }

  const avgLen = totalChars / Math.max(1, lines.length);
  if (denseBlobs > 0 || avgLen > 165) return false;
  if (text.length < 900) return headings >= 1 && structured >= 3;
  return headings >= 2 && structured >= 4;
}

function preserveWellFormattedText(
  text: string,
  includeCards: boolean,
  colorCodeParts = false
): CompactFormattedOutput {
  const sections: CompactFormattedOutput['sections'] = [];
  const keyTerms: CompactFormattedOutput['keyTerms'] = [];
  const cards: CompactFormattedOutput['cards'] = [];
  const seenTerms = new Set<string>();
  let title: string | undefined;
  let summary = '';
  let examTip = '';
  let workedExample = '';
  let current: CompactFormattedOutput['sections'][number] = { heading: 'Study Notes', points: [] };

  const pushCurrent = () => {
    if (current.points.length > 0 || (current.heading !== 'Study Notes' && sections.length > 0)) {
      sections.push(current);
    }
  };

  for (const raw of text.split('\n')) {
    const isSub = /^\s{2,}(?:[-*•▪◦‣↳]|\d+[.)])\s+/.test(raw) || raw.trim().startsWith('↳ ');
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

    const cleanedBullet = line.replace(/^(?:[-*•▪◦‣↳]|\d+[.)])\s+/, '').trim();
    const isBullet = /^(?:[-*•▪◦‣↳]|\d+[.)])\s+/.test(line);

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

function expandCompactPayload(
  raw: RawCompactSchemaPayload,
  colorCodeParts = false
): CompactFormattedOutput {
  const baseSections = Array.isArray(raw.s)
    ? raw.s
        .map((sec) => ({
          heading: String(sec?.h || '').trim() || 'Key Points',
          points: Array.isArray(sec?.p)
            ? sec.p.map((pt) => String(pt || '').trimEnd()).filter((pt) => pt.trim().length > 0)
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
          term: String(kt?.t || '').trim(),
          definition: String(kt?.d || '').trim(),
        }))
        .filter((kt) => kt.term && kt.definition)
    : [];

  const timelineEvents = Array.isArray(raw.e)
    ? raw.e
        .map((ev) => ({
          date: String(ev?.d || '').trim() || 'Undated',
          title: String(ev?.t || '').trim(),
          detail: String(ev?.x || '').trim(),
          significance: String(ev?.g || '').trim() || undefined,
          keyEvent: Boolean(ev?.k) || undefined,
        }))
        .filter((ev) => ev.title)
    : [];

  const cards = Array.isArray(raw.c)
    ? raw.c
        .map((fc) => ({
          q: String(fc?.q || '').trim(),
          a: String(fc?.a || '').trim(),
          sectionName: String(fc?.s || '').trim() || 'AI Key Cards',
        }))
        .filter((fc) => fc.q && fc.a)
    : [];

  return {
    title: typeof raw.t === 'string' && raw.t.trim() ? raw.t.trim() : undefined,
    summary: String(raw.u || '').trim(),
    sections,
    keyTerms,
    examTip: String(raw.x || '').trim(),
    workedExample: String(raw.w || '').trim(),
    timelineEvents,
    cards,
  };
}

/**
 * Formats messy study notes using the USER's own API key (never the website key)
 * with invariant prefix + explicit Gemini context caching, model-specific parameter tuning,
 * smart webpage noise filtering, and balanced visual hierarchy rules.
 */
export async function runByokAutoformat(params: {
  config: UserAiConfig;
  rawText: string;
  preset?: string;
  includeCards?: boolean;
  includeTimeline?: boolean;
  detectFlowDiagrams?: boolean;
  autoTables?: boolean;
  colorCodeParts?: boolean;
  onProgress?: (ev: { type: 'status' | 'progress'; message?: string; model?: string; chars?: number }) => void;
}): Promise<{ formatted: CompactFormattedOutput; usage: AiUsageMeta }> {
  const mismatch = detectKeyProviderMismatch(params.config);
  if (mismatch) {
    throw new Error(mismatch);
  }

  const compacted = compactInputForAi(params.rawText);
  if (!compacted) {
    throw new Error(
      'No useful study content found after filtering webpage navigation/noise. Paste study notes directly.'
    );
  }

  const includeTimeline = params.includeTimeline !== false;
  const includeCards = Boolean(params.includeCards);
  const colorCodeParts = Boolean(params.colorCodeParts);
  const optionsLine = buildCompactOptionsLine({
    preset: params.preset || 'balanced-visual',
    includeTimeline,
    includeCards,
    detectFlowDiagrams: params.detectFlowDiagrams !== false,
    autoTables: params.autoTables !== false,
    colorCodeParts,
  });

  if (params.config.provider === 'gemini') {
    const ai = createGeminiClient(params.config.apiKey);
    const candidates = buildGeminiCandidateList(params.config);
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
          params.config.apiKey.trim(),
          model,
          compacted
        );
        const userContents = cachedContent
          ? optionsLine
          : `${optionsLine}\n\n[SOURCE]\n${compacted}`;
        const genConfig = {
          ...(cachedContent
            ? { cachedContent }
            : { systemInstruction: STATIC_GEMINI_SYSTEM_INSTRUCTION }),
          ...tuning,
          abortSignal: AbortSignal.timeout(18000),
          responseMimeType: 'application/json',
          responseSchema,
        };

        if (params.onProgress) {
          params.onProgress({
            type: 'status',
            model,
            message: cachedContent
              ? `Formatting with ${model} (cached context)…`
              : `Formatting with ${model}…`,
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

          for await (const chunk of stream) {
            const delta = extractGeminiResponseText(chunk);
            if (delta) {
              fullText += delta;
              const now = Date.now();
              if (now - lastEmit >= 180) {
                lastEmit = now;
                params.onProgress({ type: 'progress', model, chars: fullText.length });
              }
            }
            if (chunk.usageMetadata) {
              inputTokens = Number(chunk.usageMetadata.promptTokenCount || inputTokens);
              outputTokens = Number(chunk.usageMetadata.candidatesTokenCount || outputTokens);
              totalTokens = Number(chunk.usageMetadata.totalTokenCount || totalTokens);
              cachedTokens = Number(chunk.usageMetadata.cachedContentTokenCount || cachedTokens);
            }
          }

          const parsed = extractJsonPayload(fullText);
          return {
            formatted: expandCompactPayload(parsed, colorCodeParts),
            usage: {
              provider: 'gemini',
              model,
              inputTokens,
              outputTokens,
              totalTokens,
              cachedTokens,
            },
          };
        }

        const response = await ai.models.generateContent({
          model,
          contents: userContents,
          config: genConfig,
        });

        const jsonStr = extractGeminiResponseText(response);
        const parsed = extractJsonPayload(jsonStr);
        const usageMeta = response.usageMetadata;

        return {
          formatted: expandCompactPayload(parsed, colorCodeParts),
          usage: {
            provider: 'gemini',
            model,
            inputTokens: Number(usageMeta?.promptTokenCount || 0),
            outputTokens: Number(usageMeta?.candidatesTokenCount || 0),
            totalTokens: Number(usageMeta?.totalTokenCount || 0),
            cachedTokens: Number(usageMeta?.cachedContentTokenCount || 0),
          },
        };
      } catch (err) {
        lastErr = err;
        if (i < candidates.length - 1 && isModelNotFoundError(err)) {
          continue;
        }
        throw new Error(extractReadableErrorMessage(err, params.config));
      }
    }
    throw new Error(extractReadableErrorMessage(lastErr, params.config));
  }

  // Grok (xAI) and OpenAI-compatible providers share invariant system prefix + model-tuned parameters
  const isGrok = params.config.provider === 'grok';
  const baseUrl = isGrok
    ? DEFAULT_GROK_BASE_URL
    : normalizeOpenAiBaseUrl(params.config.baseUrl);
  const model =
    (params.config.model || (isGrok ? DEFAULT_GROK_MODEL : DEFAULT_OPENAI_MODEL)).trim() ||
    (isGrok ? DEFAULT_GROK_MODEL : DEFAULT_OPENAI_MODEL);
  const tuning = getOpenAiModelTuning(params.config.provider, model);
  const userMsg = `${optionsLine}\n\n[SOURCE]\n${compacted}`;

  const sendChatCompletion = async (opts: {
    stream: boolean;
    withJsonFormat: boolean;
    withReasoningEffort: boolean;
  }) => {
    const bodyObj: Record<string, unknown> = {
      model,
      stream: opts.stream,
      temperature: tuning.temperature,
      max_tokens: tuning.max_tokens,
      messages: [
        { role: 'system', content: STATIC_OPENAI_SYSTEM_INSTRUCTION },
        { role: 'user', content: userMsg },
      ],
    };
    if (opts.withJsonFormat) {
      bodyObj.response_format = { type: 'json_object' };
    }
    if (opts.withReasoningEffort && tuning.reasoning_effort) {
      bodyObj.reasoning_effort = tuning.reasoning_effort;
    }
    if (opts.stream) {
      bodyObj.stream_options = { include_usage: true };
    }
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(22000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.config.apiKey}`,
      },
      body: JSON.stringify(bodyObj),
    });
  };

  const callWithCompatFallback = async (stream: boolean) => {
    let useJson = true;
    let useReasoning = Boolean(tuning.reasoning_effort);
    let res = await sendChatCompletion({
      stream,
      withJsonFormat: useJson,
      withReasoningEffort: useReasoning,
    });
    if (!res.ok && res.status === 400) {
      const errText = await res.text().catch(() => '');
      if (/response_format|json_object|stream_options|reasoning_effort|unsupported|unknown/i.test(errText)) {
        if (/response_format|json_object/i.test(errText)) useJson = false;
        if (/reasoning_effort/i.test(errText)) useReasoning = false;
        res = await sendChatCompletion({
          stream,
          withJsonFormat: useJson,
          withReasoningEffort: useReasoning,
        });
      } else {
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
    }
    return res;
  };

  try {
    if (params.onProgress) {
      params.onProgress({ type: 'status', model, message: `Formatting with ${model}…` });
      const res = await callWithCompatFallback(true);
      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let fullContent = '';
      let lastEmit = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let totalTokens = 0;
      let cachedTokens = 0;

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
              choices?: Array<{ delta?: { content?: string } }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
                total_tokens?: number;
                prompt_tokens_details?: { cached_tokens?: number };
              };
            };
            const piece = parsedChunk.choices?.[0]?.delta?.content || '';
            if (piece) {
              fullContent += piece;
              const now = Date.now();
              if (now - lastEmit >= 180) {
                lastEmit = now;
                params.onProgress({ type: 'progress', model, chars: fullContent.length });
              }
            }
            if (parsedChunk.usage) {
              inputTokens = Number(parsedChunk.usage.prompt_tokens || inputTokens);
              outputTokens = Number(parsedChunk.usage.completion_tokens || outputTokens);
              totalTokens = Number(parsedChunk.usage.total_tokens || totalTokens);
              cachedTokens = Number(
                parsedChunk.usage.prompt_tokens_details?.cached_tokens || cachedTokens
              );
            }
          } catch {
            // ignore partial SSE line
          }
        }
      }

      const parsed = extractJsonPayload(fullContent);
      return {
        formatted: expandCompactPayload(parsed, colorCodeParts),
        usage: {
          provider: params.config.provider,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
          cachedTokens,
        },
      };
    }

    const res = await callWithCompatFallback(false);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const content = (data.choices?.[0]?.message?.content || '').trim();
    const parsed = extractJsonPayload(content);

    return {
      formatted: expandCompactPayload(parsed, colorCodeParts),
      usage: {
        provider: params.config.provider,
        model,
        inputTokens: Number(data.usage?.prompt_tokens || 0),
        outputTokens: Number(data.usage?.completion_tokens || 0),
        totalTokens: Number(data.usage?.total_tokens || 0),
        cachedTokens: Number(data.usage?.prompt_tokens_details?.cached_tokens || 0),
      },
    };
  } catch (err) {
    throw new Error(extractReadableErrorMessage(err, params.config));
  }
}

export async function testUserApiKey(config: UserAiConfig): Promise<{ model: string }> {
  const mismatch = detectKeyProviderMismatch(config);
  if (mismatch) {
    throw new Error(mismatch);
  }

  if (config.provider === 'gemini') {
    const ai = createGeminiClient(config.apiKey);
    const candidates = buildGeminiCandidateList(config);

    let lastErr: unknown = null;
    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      const tuning = getGeminiModelTuning(model);
      try {
        const response = await ai.models.generateContent({
          model,
          contents: 'Reply with OK',
          config: {
            systemInstruction: 'Reply with only: OK',
            ...(tuning.thinkingConfig ? { thinkingConfig: tuning.thinkingConfig } : {}),
            maxOutputTokens: 512,
            abortSignal: AbortSignal.timeout(10000),
          },
        });
        const text = extractGeminiResponseText(response);
        if (!text && !response.candidates?.length) {
          throw new Error('Empty verification response from Gemini.');
        }
        return { model };
      } catch (err) {
        lastErr = err;
        if (i < candidates.length - 1 && isModelNotFoundError(err)) {
          continue;
        }
        throw new Error(extractReadableErrorMessage(err, config));
      }
    }
    throw new Error(extractReadableErrorMessage(lastErr, config));
  }

  const isGrok = config.provider === 'grok';
  const baseUrl = isGrok ? DEFAULT_GROK_BASE_URL : normalizeOpenAiBaseUrl(config.baseUrl);
  const model =
    (config.model || (isGrok ? DEFAULT_GROK_MODEL : DEFAULT_OPENAI_MODEL)).trim() ||
    (isGrok ? DEFAULT_GROK_MODEL : DEFAULT_OPENAI_MODEL);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: isGrok ? 256 : 64,
        messages: [{ role: 'user', content: 'Reply OK' }],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }
    return { model };
  } catch (err) {
    throw new Error(extractReadableErrorMessage(err, config));
  }
}

export function registerAiRoutes(app: Express): void {
  // Strictly requires user's own BYOK API key — NEVER uses site GEMINI_API_KEY
  app.post('/api/ai/test-key', async (req: Request, res: Response) => {
    try {
      const config = parseUserAiConfig(req.body?.byok ?? req.body, req.headers);
      if (!config) {
        res.status(400).json({ error: 'Please paste a valid API key to test.' });
        return;
      }
      const result = await testUserApiKey(config);
      res.json({ ok: true, provider: config.provider, model: result.model });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'API key verification failed.';
      res.status(400).json({ ok: false, error: msg });
    }
  });

  // Strictly requires user's own BYOK API key — website API key is strictly reserved for Live Quiz marking
  app.post('/api/ai/autoformat', async (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      rawText?: string;
      preset?: string;
      includeCards?: boolean;
      includeTimeline?: boolean;
      detectFlowDiagrams?: boolean;
      autoTables?: boolean;
      colorCodeParts?: boolean;
      forceRewrite?: boolean;
      stream?: boolean;
      byok?: unknown;
    };

    const wantsStream =
      Boolean(body.stream) || String(req.headers.accept || '').includes('text/event-stream');

    try {
      const config = parseUserAiConfig(body.byok, req.headers);
      if (!config) {
        res.status(401).json({
          error:
            'AI Autoformatting requires your own API key. Add one in Account & Data (the website key is strictly reserved for Live Quiz marking).',
          requiresByok: true,
        });
        return;
      }

      const rawText = String(body.rawText || '').trim();
      if (!rawText) {
        res.status(400).json({ error: 'Provide study text or fetch a page before running AI Autoformat.' });
        return;
      }

      const compacted = compactInputForAi(rawText);
      const forceRewrite = Boolean(body.forceRewrite);
      const includeCards = Boolean(body.includeCards);
      const colorCodeParts = Boolean(body.colorCodeParts);

      if (!forceRewrite && compacted && detectAlreadyGoodFormatting(compacted)) {
        const preserved = preserveWellFormattedText(compacted, includeCards, colorCodeParts);
        const usage: AiUsageMeta = {
          provider: config.provider,
          model: 'kept-existing',
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cachedTokens: 0,
        };
        if (wantsStream) {
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders?.();
          res.write(
            `data: ${JSON.stringify({ type: 'status', message: 'Format is already good — keeping existing layout (0 tokens)…' })}\n\n`
          );
          res.write(
            `data: ${JSON.stringify({ type: 'done', formatted: preserved, usage, keptExistingFormat: true })}\n\n`
          );
          res.end();
          return;
        }
        res.json({ formatted: preserved, usage, keptExistingFormat: true });
        return;
      }

      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();

        const sendSse = (payload: Record<string, unknown>) => {
          res.write(`data: ${JSON.stringify(payload)}\n\n`);
        };
        sendSse({ type: 'status', message: 'Filtered webpage noise. Connecting to AI…' });

        const result = await runByokAutoformat({
          config,
          rawText,
          preset: body.preset,
          includeCards,
          includeTimeline: body.includeTimeline !== false,
          detectFlowDiagrams: body.detectFlowDiagrams !== false,
          autoTables: body.autoTables !== false,
          colorCodeParts,
          onProgress: (ev) => sendSse(ev),
        });
        sendSse({ type: 'done', ...result });
        res.end();
        return;
      }

      const result = await runByokAutoformat({
        config,
        rawText,
        preset: body.preset,
        includeCards,
        includeTimeline: body.includeTimeline !== false,
        detectFlowDiagrams: body.detectFlowDiagrams !== false,
        autoTables: body.autoTables !== false,
        colorCodeParts,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI Autoformatting failed.';
      if (wantsStream) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`);
        res.end();
        return;
      }
      res.status(502).json({ error: msg });
    }
  });
}
