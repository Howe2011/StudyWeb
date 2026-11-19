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
  const customModel = config.model?.trim()
    ? sanitizeAllowedModel(config.model, DEFAULT_GEMINI_FORMAT_MODEL)
    : '';
  if (customModel) return [customModel];

  const list: string[] = [...BYOK_GEMINI_CANDIDATES];
  const verified = config.verifiedModel?.trim();
  if (verified && !/^gemini-(?:1\.5|2\.0|pro\b)/i.test(verified)) {
    const filtered = list.filter((m) => m !== verified);
    // Keep flash-lite first unless verifiedModel was already one of the fast models
    if (verified !== 'gemini-4-hydrogen') {
      return [verified, ...filtered];
    }
  }
  return list;
}

function normalizeOpenAiBaseUrl(baseUrl?: string): string {
  const clean = (baseUrl || DEFAULT_OPENAI_BASE_URL).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(clean)) return DEFAULT_OPENAI_BASE_URL;
  return clean;
}

function getGeminiThinkingConfig(model: string): {
  thinkingConfig?: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number };
} {
  if (/^gemini-3\./i.test(model)) {
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } };
  }
  if (/^gemini-2\.5-/i.test(model)) {
    return { thinkingConfig: { thinkingBudget: 0 } };
  }
  if (/^gemini-4-/i.test(model)) {
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };
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

function compactInputForAi(rawText: string, maxChars = 11000): string {
  const noiseLine =
    /^(?:skip to (?:main )?content|cookie (?:policy|preferences|settings)|accept all cookies|sign in|log in|subscribe|advertisement|menu|breadcrumbs?|back to top|all rights reserved|©\s*\d{4}|table of contents|edit section|\[edit\]|jump to navigation|share this page|print page|related topics?)$/i;

  const seen = new Set<string>();
  const lines = String(rawText || '')
    .replace(/\u200B|\uFEFF/g, '')
    .replace(/\r/g, '')
    // Strip noisy markdown hyperlink URLs while keeping anchor labels
    .replace(/\[([^\]\n]{1,120})\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trimEnd())
    .filter((l) => {
      const t = l.trim();
      if (!t) return true;
      if (noiseLine.test(t)) return false;
      if (t.length >= 16) {
        const key = t.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
      }
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
      return 'Preset:Cornell(u=1-2 sentence overview;s=cues + "↳ " sub-bullets;k=key terms).';
    case 'timeline-causal':
      return 'Preset:Timeline&Causal(chronological s,causal "⇒ A → B",populate e).';
    case 'compact':
      return 'Preset:Compact(ultra-concise high-yield bullets,max brevity).';
    default:
      return 'Preset:SaveMyExams(2-6 crisp sections h,<=18w **Term** bullets,"↳ " sub-points,"| A | B |" tables if contrasting,optional x=Exam Tip,w=Worked Example).';
  }
}

function buildAutoformatSchema(opts: { includeTimeline: boolean; includeCards: boolean }) {
  const properties: Record<string, unknown> = {
    t: { type: Type.STRING, description: 'Short title' },
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
    required: ['u', 's', 'k'],
  };
}

function expandCompactPayload(raw: RawCompactSchemaPayload) {
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

  // Strictly requires user's own BYOK API key — NEVER uses site GEMINI_API_KEY
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
    res.status(400).json({ error: 'Provide study text or fetch a page before running AI Autoformat.' });
    return;
  }

  const preset = typeof body.preset === 'string' ? body.preset : undefined;
  const includeCards = Boolean(body.includeCards);
  const includeTimeline = body.includeTimeline !== false;
  const detectFlowDiagrams = body.detectFlowDiagrams !== false;
  const autoTables = body.autoTables !== false;
  const wantsStream =
    Boolean(body.stream) || readHeader(req.headers, 'accept').includes('text/event-stream');

  const ruleBits = [
    getPresetDirective(preset),
    detectFlowDiagrams ? 'Use "⇒ A → B → C" for flows.' : '',
    autoTables ? 'Use Markdown "| H1 | H2 |" rows for comparisons.' : '',
    includeTimeline ? 'Extract dated events into e[].' : '',
    includeCards ? 'Add 4-6 crisp Q/A cards in c[].' : '',
    'Keep output fast & high-yield: 2-6 sections, 3-6 bullets each (<=18w/bullet), 3-8 key terms max. Bold **term**, sub-bullets start "↳ ". No invented facts.',
  ]
    .filter(Boolean)
    .join(' ');

  const sendSse = (payload: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  if (wantsStream) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    sendSse({ type: 'status', message: 'Compacted notes. Connecting to AI…' });
  }

  try {
    if (config.provider === 'gemini') {
      const ai = new GoogleGenAI({
        apiKey: config.apiKey.trim(),
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const candidates = buildGeminiCandidateList(config);
      const responseSchema = buildAutoformatSchema({ includeTimeline, includeCards });
      const systemInstruction = `Convert raw student notes into tight revision JSON. ${ruleBits}`;

      let lastErr: unknown = null;
      for (let i = 0; i < candidates.length; i++) {
        const model = candidates[i];
        try {
          if (wantsStream) {
            sendSse({ type: 'status', model, message: `Formatting with ${model}…` });
            const stream = await ai.models.generateContentStream({
              model,
              contents: compacted,
              config: {
                systemInstruction,
                ...getGeminiThinkingConfig(model),
                maxOutputTokens: model === 'gemini-4-hydrogen' ? 2560 : 2048,
                abortSignal: AbortSignal.timeout(18000),
                responseMimeType: 'application/json',
                responseSchema,
              },
            });

            let fullText = '';
            let lastEmit = 0;
            let inputTokens = 0;
            let outputTokens = 0;
            let totalTokens = 0;

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
              if (chunk.usageMetadata) {
                inputTokens = Number(chunk.usageMetadata.promptTokenCount || inputTokens);
                outputTokens = Number(chunk.usageMetadata.candidatesTokenCount || outputTokens);
                totalTokens = Number(chunk.usageMetadata.totalTokenCount || totalTokens);
              }
            }

            const parsed = extractJsonPayload(fullText);
            sendSse({
              type: 'done',
              formatted: expandCompactPayload(parsed),
              usage: {
                provider: 'gemini',
                model,
                inputTokens,
                outputTokens,
                totalTokens,
              },
            });
            res.end();
            return;
          }

          const response = await ai.models.generateContent({
            model,
            contents: compacted,
            config: {
              systemInstruction,
              ...getGeminiThinkingConfig(model),
              maxOutputTokens: model === 'gemini-4-hydrogen' ? 2560 : 2048,
              abortSignal: AbortSignal.timeout(18000),
              responseMimeType: 'application/json',
              responseSchema,
            },
          });

          const parsed = extractJsonPayload(extractGeminiResponseText(response));
          const usageMeta = response.usageMetadata;
          res.status(200).json({
            formatted: expandCompactPayload(parsed),
            usage: {
              provider: 'gemini',
              model,
              inputTokens: Number(usageMeta?.promptTokenCount || 0),
              outputTokens: Number(usageMeta?.candidatesTokenCount || 0),
              totalTokens: Number(usageMeta?.totalTokenCount || 0),
            },
          });
          return;
        } catch (err) {
          lastErr = err;
          if (i < candidates.length - 1 && isModelNotFoundError(err)) {
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    }

    const isGrok = config.provider === 'grok';
    const baseUrl = isGrok ? DEFAULT_GROK_BASE_URL : normalizeOpenAiBaseUrl(config.baseUrl);
    const model =
      (config.model || (isGrok ? DEFAULT_GROK_MODEL : DEFAULT_OPENAI_MODEL)).trim() ||
      (isGrok ? DEFAULT_GROK_MODEL : DEFAULT_OPENAI_MODEL);

    const schemaHint = [
      '"t":"title"',
      '"u":"1-sentence summary"',
      '"s":[{"h":"Section","p":["**Term**: fact","↳ sub-point"]}]',
      '"k":[{"t":"term","d":"def"}]',
      '"x":"exam tip or empty"',
      '"w":"worked example or empty"',
      includeTimeline ? '"e":[{"d":"date","t":"event","x":"detail","g":"sig","k":false}]' : '',
      includeCards ? '"c":[{"q":"question","a":"answer","s":"section"}]' : '',
    ]
      .filter(Boolean)
      .join(',');

    const sysPrompt = `Return ONLY strict JSON {${schemaHint}}. ${ruleBits}`;

    if (wantsStream) {
      sendSse({ type: 'status', model, message: `Formatting with ${model}…` });
      const callStream = async (withJsonFormat: boolean) => {
        const bodyObj: Record<string, unknown> = {
          model,
          stream: true,
          max_tokens: 2048,
          messages: [
            { role: 'system', content: sysPrompt },
            { role: 'user', content: compacted },
          ],
        };
        if (withJsonFormat) {
          bodyObj.response_format = { type: 'json_object' };
        }
        return fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(22000),
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(bodyObj),
        });
      };

      let apiRes = await callStream(true);
      if (!apiRes.ok) {
        const errText = await apiRes.text().catch(() => '');
        if (apiRes.status === 400 && /response_format|json_object|unsupported/i.test(errText)) {
          apiRes = await callStream(false);
        } else {
          throw new Error(`HTTP ${apiRes.status}: ${errText}`);
        }
      }
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
              usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
            };
            const piece = parsedChunk.choices?.[0]?.delta?.content || '';
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
            }
          } catch {
            // ignore partial SSE line
          }
        }
      }

      const parsed = extractJsonPayload(fullContent);
      sendSse({
        type: 'done',
        formatted: expandCompactPayload(parsed),
        usage: {
          provider: config.provider,
          model,
          inputTokens,
          outputTokens,
          totalTokens,
        },
      });
      res.end();
      return;
    }

    const callChat = async (withJsonResponseFormat: boolean) => {
      const bodyObj: Record<string, unknown> = {
        model,
        max_tokens: 2048,
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
        signal: AbortSignal.timeout(22000),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(bodyObj),
      });
    };

    let apiRes = await callChat(true);
    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      if (apiRes.status === 400 && /response_format|json_object|unsupported/i.test(errText)) {
        apiRes = await callChat(false);
      } else {
        throw new Error(`HTTP ${apiRes.status}: ${errText}`);
      }
    }

    if (!apiRes.ok) {
      const errText = await apiRes.text().catch(() => '');
      throw new Error(`HTTP ${apiRes.status}: ${errText}`);
    }

    const data = (await apiRes.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const parsed = extractJsonPayload((data.choices?.[0]?.message?.content || '').trim());

    res.status(200).json({
      formatted: expandCompactPayload(parsed),
      usage: {
        provider: config.provider,
        model,
        inputTokens: Number(data.usage?.prompt_tokens || 0),
        outputTokens: Number(data.usage?.completion_tokens || 0),
        totalTokens: Number(data.usage?.total_tokens || 0),
      },
    });
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
