import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { Express, Request, Response } from 'express';

export type UserAiProvider = 'gemini' | 'grok' | 'openai-compatible';

export interface UserAiConfig {
  provider: UserAiProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface CompactFormattedOutput {
  title?: string;
  summary: string;
  sections: Array<{
    heading: string;
    points: string[];
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
}

const DEFAULT_GEMINI_FORMAT_MODEL = 'gemini-4-hydrogen';
const BYOK_GEMINI_CANDIDATES = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
] as const;
const DEFAULT_GROK_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_GROK_MODEL = 'grok-3-mini';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

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
  // Block deprecated Gemini aliases
  if (/^gemini-(?:1\.5|2\.0|pro\b)/i.test(m)) return fallback;
  return m;
}

function normalizeOpenAiBaseUrl(baseUrl?: string): string {
  const clean = (baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) return DEFAULT_OPENAI_BASE_URL;
  return clean;
}

function getGeminiThinkingConfig(model: string): { thinkingConfig?: { thinkingLevel: ThinkingLevel } } {
  if (/^gemini-4-/i.test(model)) {
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };
  }
  if (/^gemini-3\./i.test(model)) {
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } };
  }
  return {};
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

  // Unwrap JSON error payloads returned by Gemini / OpenAI / xAI APIs
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
  if (/TimeoutError|AbortError|timed out/i.test(detail)) {
    return 'Connection to the AI provider timed out. Please try again.';
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
 * Strips non-content boilerplate, collapses blank lines, and tightens spacing
 * BEFORE sending to the model so input token count stays minimal.
 */
export function compactInputForAi(rawText: string, maxChars = 18000): string {
  const noiseLine =
    /^(?:skip to (?:main )?content|cookie (?:policy|preferences|settings)|accept all cookies|sign in|log in|subscribe|advertisement|menu|breadcrumbs?|back to top|all rights reserved|©\s*\d{4}|table of contents|edit section|\[edit\]|jump to navigation|share this page|print page|related topics?)$/i;

  const lines = String(rawText || '')
    .replace(/\u200B|\uFEFF/g, '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t) return true;
      if (noiseLine.test(t)) return false;
      return true;
    });

  const collapsed = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, maxChars)}\n...[truncated]`;
}

function getPresetDirective(preset?: string): string {
  switch (preset) {
    case 'cornell':
      return 'Preset:Cornell(u=1-2 sentence overview;s=top cues + indented sub-bullets ↳;k=key terms).';
    case 'timeline-causal':
      return 'Preset:Timeline&Causal(chronological sections,causal chains "⇒ A → B",populate dates array e).';
    case 'compact':
      return 'Preset:Compact(ultra-concise high-yield bullet points,merge micro-points,max brevity).';
    default:
      return 'Preset:SaveMyExams(clear topic sections h,concise **Term** bullets,nested "↳ " sub-points,Markdown "| A | B |" comparison tables where contrasting,x=Examiner Tip,w=Worked Example if present).';
  }
}

interface RawCompactSchemaPayload {
  t?: string;
  u?: string;
  s?: Array<{ h?: string; p?: string[] }>;
  k?: Array<{ t?: string; d?: string }>;
  x?: string;
  w?: string;
  e?: Array<{ d?: string; t?: string; x?: string; g?: string; k?: boolean }>;
  c?: Array<{ q?: string; a?: string; s?: string }>;
}

function expandCompactPayload(raw: RawCompactSchemaPayload): CompactFormattedOutput {
  const sections = Array.isArray(raw.s)
    ? raw.s
        .map((sec) => ({
          heading: String(sec?.h || '').trim() || 'Key Points',
          points: Array.isArray(sec?.p)
            ? sec.p.map((pt) => String(pt || '').trimEnd()).filter((pt) => pt.trim().length > 0)
            : [],
        }))
        .filter((sec) => sec.points.length > 0)
    : [];

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
    sections: sections.length ? sections : [{ heading: 'Key Points', points: [] }],
    keyTerms,
    examTip: String(raw.x || '').trim(),
    workedExample: String(raw.w || '').trim(),
    timelineEvents,
    cards,
  };
}

/**
 * Formats messy study notes using the USER's own API key (never the website key)
 * with ultra-compact schema keys and minimal thinking tokens for top cost efficiency.
 */
export async function runByokAutoformat(params: {
  config: UserAiConfig;
  rawText: string;
  preset?: string;
  includeCards?: boolean;
  includeTimeline?: boolean;
  detectFlowDiagrams?: boolean;
  autoTables?: boolean;
}): Promise<{ formatted: CompactFormattedOutput; usage: AiUsageMeta }> {
  const mismatch = detectKeyProviderMismatch(params.config);
  if (mismatch) {
    throw new Error(mismatch);
  }

  const compacted = compactInputForAi(params.rawText);
  if (!compacted) {
    throw new Error('No study text provided to format.');
  }

  const ruleBits = [
    getPresetDirective(params.preset),
    params.detectFlowDiagrams !== false ? 'Use "⇒ A → B → C" for multi-step processes.' : '',
    params.autoTables !== false ? 'Use Markdown "| H1 | H2 |" rows for comparisons/pros-cons.' : '',
    params.includeTimeline !== false
      ? 'Extract dated historical events into e[].'
      : 'Leave e=[] empty.',
    params.includeCards
      ? 'Generate 4-10 crisp Q/A cards in c[].'
      : 'Leave c=[] empty.',
    'Do NOT invent facts. Bold key terms with **term**. Sub-bullets start with "↳ ". Short strings only.',
  ]
    .filter(Boolean)
    .join(' ');

  if (params.config.provider === 'gemini') {
    const ai = createGeminiClient(params.config.apiKey);
    const customModel = params.config.model?.trim()
      ? sanitizeAllowedModel(params.config.model, DEFAULT_GEMINI_FORMAT_MODEL)
      : '';
    const candidates = customModel ? [customModel] : [...BYOK_GEMINI_CANDIDATES];

    let lastErr: unknown = null;
    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      try {
        const response = await ai.models.generateContent({
          model,
          contents: compacted,
          config: {
            systemInstruction: `Convert raw student notes into tight revision JSON. ${ruleBits}`,
            ...getGeminiThinkingConfig(model),
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                t: { type: Type.STRING, description: 'Short topic title' },
                u: { type: Type.STRING, description: '1-sentence summary' },
                s: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      h: { type: Type.STRING },
                      p: { type: Type.ARRAY, items: { type: Type.STRING } },
                    },
                    required: ['h', 'p'],
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
                x: { type: Type.STRING, description: 'Examiner tip or empty' },
                w: { type: Type.STRING, description: 'Worked example or empty' },
                e: {
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
                },
                c: {
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
                },
              },
              required: ['u', 's', 'k'],
            },
          },
        });

        const jsonStr = extractGeminiResponseText(response);
        const parsed = extractJsonPayload(jsonStr);
        const usageMeta = response.usageMetadata;

        return {
          formatted: expandCompactPayload(parsed),
          usage: {
            provider: 'gemini',
            model,
            inputTokens: Number(usageMeta?.promptTokenCount || 0),
            outputTokens: Number(usageMeta?.candidatesTokenCount || 0),
            totalTokens: Number(usageMeta?.totalTokenCount || 0),
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

  // Grok (xAI) and OpenAI-compatible providers share the same ultra-compact JSON contract
  const isGrok = params.config.provider === 'grok';
  const baseUrl = isGrok
    ? DEFAULT_GROK_BASE_URL
    : normalizeOpenAiBaseUrl(params.config.baseUrl);
  const model =
    (params.config.model || (isGrok ? DEFAULT_GROK_MODEL : DEFAULT_OPENAI_MODEL)).trim() ||
    (isGrok ? DEFAULT_GROK_MODEL : DEFAULT_OPENAI_MODEL);

  const sysPrompt =
    `Return ONLY strict JSON with compact keys: ` +
    `{"t":"title","u":"1-sentence summary","s":[{"h":"Section","p":["**Term**: fact","↳ sub-point"]}],` +
    `"k":[{"t":"term","d":"def"}],"x":"examiner tip or empty","w":"worked example or empty",` +
    `"e":[{"d":"date","t":"event","x":"detail","g":"significance","k":false}],"c":[{"q":"question","a":"answer","s":"section"}]}. ` +
    ruleBits;

  const callChat = async (withJsonResponseFormat: boolean) => {
    const bodyObj: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: compacted },
      ],
    };
    if (withJsonResponseFormat) {
      bodyObj.response_format = { type: 'json_object' };
    }
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.config.apiKey}`,
      },
      body: JSON.stringify(bodyObj),
    });
  };

  try {
    let res = await callChat(true);
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      if (
        res.status === 400 &&
        /response_format|json_object|unsupported/i.test(errText)
      ) {
        res = await callChat(false);
      } else {
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const content = (data.choices?.[0]?.message?.content || '').trim();
    const parsed = extractJsonPayload(content);

    return {
      formatted: expandCompactPayload(parsed),
      usage: {
        provider: params.config.provider,
        model,
        inputTokens: Number(data.usage?.prompt_tokens || 0),
        outputTokens: Number(data.usage?.completion_tokens || 0),
        totalTokens: Number(data.usage?.total_tokens || 0),
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
    const customModel = config.model?.trim()
      ? sanitizeAllowedModel(config.model, DEFAULT_GEMINI_FORMAT_MODEL)
      : '';
    const candidates = customModel ? [customModel] : [...BYOK_GEMINI_CANDIDATES];

    let lastErr: unknown = null;
    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      try {
        const response = await ai.models.generateContent({
          model,
          contents: 'Reply with OK',
          config: {
            systemInstruction: 'Reply with only: OK',
            ...getGeminiThinkingConfig(model),
            maxOutputTokens: 512,
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
    try {
      const body = req.body as {
        rawText?: string;
        preset?: string;
        includeCards?: boolean;
        includeTimeline?: boolean;
        detectFlowDiagrams?: boolean;
        autoTables?: boolean;
        byok?: unknown;
      };

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

      const result = await runByokAutoformat({
        config,
        rawText,
        preset: body.preset,
        includeCards: Boolean(body.includeCards),
        includeTimeline: body.includeTimeline !== false,
        detectFlowDiagrams: body.detectFlowDiagrams !== false,
        autoTables: body.autoTables !== false,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI Autoformatting failed.';
      res.status(502).json({ error: msg });
    }
  });
}
