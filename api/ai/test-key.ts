import { GoogleGenAI, ThinkingLevel } from '@google/genai';

interface VercelRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(data: unknown): void;
}

type UserAiProvider = 'gemini' | 'grok' | 'openai-compatible';

interface UserAiConfig {
  provider: UserAiProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  verifiedModel?: string;
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
  for (const m of BYOK_GEMINI_CANDIDATES) pushUnique(m);
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

function getGeminiThinkingConfig(model: string): {
  thinkingConfig?: { thinkingLevel?: ThinkingLevel; thinkingBudget?: number };
} {
  if (/^gemini-4-/i.test(model)) {
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } };
  }
  if (/^gemini-3\./i.test(model)) {
    return { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } };
  }
  if (/^gemini-2\.5-/i.test(model)) {
    return { thinkingConfig: { thinkingBudget: 0 } };
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
      res.status(400).json({ ok: false, error: 'Invalid JSON body.' });
      return;
    }
  } else if (req.body && typeof req.body === 'object') {
    body = req.body as Record<string, unknown>;
  }

  const config = parseUserAiConfig(body.byok ?? body, req.headers);
  if (!config) {
    res.status(400).json({ ok: false, error: 'Please paste a valid API key to test.' });
    return;
  }

  const mismatch = detectKeyProviderMismatch(config);
  if (mismatch) {
    res.status(400).json({ ok: false, error: mismatch });
    return;
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
              abortSignal: AbortSignal.timeout(10000),
            },
          });
          const text = extractGeminiResponseText(response);
          if (!text && !response.candidates?.length) {
            throw new Error('Empty verification response from Gemini.');
          }
          res.status(200).json({ ok: true, provider: config.provider, model });
          return;
        } catch (err) {
          lastErr = err;
          if (i < candidates.length - 1 && shouldFallbackToNextModel(err, config)) {
            continue;
          }
          throw err;
        }
      }
      throw lastErr;
    }

    const isGrok = config.provider === 'grok';
    const baseUrl = isGrok ? DEFAULT_GROK_BASE_URL : normalizeOpenAiBaseUrl(config.baseUrl);
    const candidates = buildOpenAiCandidateList(config);
    const triedSet = new Set(candidates);
    let discoveredExtra = false;

    let lastErr: unknown = null;
    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      try {
        const apiRes = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          signal: AbortSignal.timeout(12000),
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

        if (!apiRes.ok) {
          const errText = await apiRes.text().catch(() => '');
          throw new Error(`HTTP ${apiRes.status}: ${errText}`);
        }

        res.status(200).json({ ok: true, provider: config.provider, model });
        return;
      } catch (err) {
        lastErr = err;
        if (!shouldFallbackToNextModel(err, config)) {
          throw err;
        }
        if (i === candidates.length - 1 && !discoveredExtra && !isGrok) {
          discoveredExtra = true;
          const extraModels = await discoverOpenAiModels(baseUrl, config.apiKey, triedSet);
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
  } catch (err) {
    res.status(400).json({ ok: false, error: extractReadableErrorMessage(err, config) });
  }
}
