import { StudyPack } from '../types';

export interface StudyPackFile {
  app: 'studydeck-pack';
  v: 1;
  fileName: string;
  exportedAt: string;
  pack: StudyPack;
}

const LOCAL_FILE_INDEX_KEY = 'studydeck_pack_file_index_v1';
const LOCAL_FILE_PREFIX = 'studydeck_pack_file_v1_';

export function sanitizePackId(packId: string): string {
  const cleaned = String(packId || `pack_${Date.now().toString(36)}`)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return cleaned || `pack_${Date.now().toString(36)}`;
}

export function getPackFileName(packId: string): string {
  return `${sanitizePackId(packId)}.json`;
}

export function serializeStudyPackFile(pack: StudyPack): string {
  const payload: StudyPackFile = {
    app: 'studydeck-pack',
    v: 1,
    fileName: getPackFileName(pack.id),
    exportedAt: new Date().toISOString(),
    pack,
  };
  return JSON.stringify(payload, null, 2);
}

export function parseStudyPackFile(
  rawText: string,
  fallbackVisibility?: 'public' | 'private'
): StudyPack | null {
  try {
    const parsed = JSON.parse(rawText) as StudyPackFile | StudyPack;
    const candidate =
      parsed && typeof parsed === 'object' && 'pack' in parsed && parsed.pack
        ? parsed.pack
        : (parsed as StudyPack);
    if (!candidate || typeof candidate.title !== 'string') {
      return null;
    }
    return {
      ...candidate,
      id: sanitizePackId(candidate.id || `pack_${Date.now().toString(36)}`),
      visibility: fallbackVisibility || candidate.visibility || 'private',
      isCustom: true,
      revision: candidate.revision || {},
      planner: candidate.planner || {},
      tags: Array.isArray(candidate.tags) ? candidate.tags : [],
      highlights: Array.isArray(candidate.highlights) ? candidate.highlights : [],
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Per-pack local file storage (each pack stored in its own entry)
// ============================================================================

export function saveLocalPackFile(pack: StudyPack): void {
  try {
    const safeId = sanitizePackId(pack.id);
    const normalized: StudyPack = { ...pack, id: safeId };
    localStorage.setItem(`${LOCAL_FILE_PREFIX}${safeId}`, serializeStudyPackFile(normalized));
    const rawIdx = localStorage.getItem(LOCAL_FILE_INDEX_KEY);
    const ids = rawIdx ? (JSON.parse(rawIdx) as string[]) : [];
    const nextIds = Array.isArray(ids) ? Array.from(new Set([safeId, ...ids])) : [safeId];
    localStorage.setItem(LOCAL_FILE_INDEX_KEY, JSON.stringify(nextIds));
  } catch {
    // ignore storage quota errors
  }
}

export function deleteLocalPackFile(packId: string): void {
  try {
    const safeId = sanitizePackId(packId);
    localStorage.removeItem(`${LOCAL_FILE_PREFIX}${safeId}`);
    const rawIdx = localStorage.getItem(LOCAL_FILE_INDEX_KEY);
    if (!rawIdx) return;
    const ids = JSON.parse(rawIdx) as string[];
    if (Array.isArray(ids)) {
      localStorage.setItem(
        LOCAL_FILE_INDEX_KEY,
        JSON.stringify(ids.filter((id) => id !== safeId))
      );
    }
  } catch {
    // ignore
  }
}

export function loadAllLocalPackFiles(): StudyPack[] {
  try {
    const rawIdx = localStorage.getItem(LOCAL_FILE_INDEX_KEY);
    if (!rawIdx) return [];
    const ids = JSON.parse(rawIdx) as string[];
    if (!Array.isArray(ids)) return [];
    const packs: StudyPack[] = [];
    for (const id of ids) {
      const raw = localStorage.getItem(`${LOCAL_FILE_PREFIX}${id}`);
      if (!raw) continue;
      const pack = parseStudyPackFile(raw);
      if (pack) packs.push(pack);
    }
    return packs;
  } catch {
    return [];
  }
}

// ============================================================================
// Static /public/study-packs/*.json files (served free by Vite & Vercel to all)
// ============================================================================

export async function loadStaticPublicPackFiles(): Promise<StudyPack[]> {
  try {
    const res = await fetch('/study-packs/manifest.json', { cache: 'no-cache' });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !ct.includes('application/json')) return [];
    const manifest = (await res.json()) as { files?: string[] };
    const files = Array.isArray(manifest.files) ? manifest.files : [];
    if (!files.length) return [];

    const loaded = await Promise.all(
      files.map(async (fileName) => {
        try {
          const clean = String(fileName || '').replace(/^\/+/, '');
          if (!clean) return null;
          const fileRes = await fetch(`/study-packs/${clean}`);
          if (!fileRes.ok) return null;
          const txt = await fileRes.text();
          return parseStudyPackFile(txt, 'public');
        } catch {
          return null;
        }
      })
    );
    return loaded.filter((p): p is StudyPack => Boolean(p));
  } catch {
    return [];
  }
}
