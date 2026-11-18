import { useEffect, useState } from 'react';

export type ByokProvider = 'gemini' | 'grok' | 'openai-compatible';

export interface ByokConfig {
  provider: ByokProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  updatedAt?: string;
}

const BYOK_STORAGE_KEY = 'studydeck_byok_config_v1';
const BYOK_EVENT = 'studydeck:byok-changed';

export const DEFAULT_GEMINI_FORMAT_MODEL = 'gemini-4-hydrogen';
export const DEFAULT_GROK_BASE_URL = 'https://api.x.ai/v1';
export const DEFAULT_GROK_MODEL = 'grok-3-mini';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

function normalizeProvider(raw: unknown): ByokProvider {
  if (raw === 'grok') return 'grok';
  if (raw === 'openai-compatible') return 'openai-compatible';
  return 'gemini';
}

export function getByokConfig(): ByokConfig | null {
  try {
    const raw = localStorage.getItem(BYOK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ByokConfig>;
    const apiKey = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    if (!apiKey) return null;
    return {
      provider: normalizeProvider(parsed.provider),
      apiKey,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl.trim() : '',
      model: typeof parsed.model === 'string' ? parsed.model.trim() : '',
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function saveByokConfig(next: ByokConfig | null): void {
  try {
    if (!next || !next.apiKey.trim()) {
      localStorage.removeItem(BYOK_STORAGE_KEY);
    } else {
      const provider = normalizeProvider(next.provider);
      const payload: ByokConfig = {
        provider,
        apiKey: next.apiKey.trim(),
        baseUrl:
          provider === 'openai-compatible'
            ? (next.baseUrl || '').trim() || undefined
            : undefined,
        model: (next.model || '').trim() || undefined,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(BYOK_STORAGE_KEY, JSON.stringify(payload));
    }
    window.dispatchEvent(new CustomEvent(BYOK_EVENT));
  } catch {
    // ignore storage failures
  }
}

export function maskApiKey(key: string): string {
  const t = key.trim();
  if (t.length <= 10) return '••••••••';
  return `${t.slice(0, 6)}••••${t.slice(-4)}`;
}

export function useByokConfig(): ByokConfig | null {
  const [config, setConfig] = useState<ByokConfig | null>(() => getByokConfig());

  useEffect(() => {
    const sync = () => setConfig(getByokConfig());
    const onStorage = (e: StorageEvent) => {
      if (e.key === BYOK_STORAGE_KEY) sync();
    };
    window.addEventListener(BYOK_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(BYOK_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return config;
}
