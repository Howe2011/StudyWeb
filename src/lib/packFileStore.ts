import {
  deleteObject,
  getBytes,
  listAll,
  ref,
  uploadString,
} from 'firebase/storage';
import { storage } from '../firebase';
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

export function parseStudyPackFile(rawText: string, fallbackVisibility?: 'public' | 'private'): StudyPack | null {
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
// Static /public/study-packs/*.json files (served by Vite & Vercel to all)
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

// ============================================================================
// Firebase Storage per-pack JSON files
// ============================================================================

function getStoragePackPath(packId: string, visibility: 'public' | 'private', uid?: string): string {
  const fileName = getPackFileName(packId);
  if (visibility === 'public') {
    return `study-packs/public/${fileName}`;
  }
  return `study-packs/private/${uid || 'anon'}/${fileName}`;
}

export async function uploadPackFileToStorage(
  pack: StudyPack,
  visibility: 'public' | 'private',
  uid: string
): Promise<{ ok: boolean; path: string; error?: string }> {
  const path = getStoragePackPath(pack.id, visibility, uid);
  const fileJson = serializeStudyPackFile({
    ...pack,
    id: sanitizePackId(pack.id),
    visibility,
    ownerId: pack.ownerId || uid,
  });

  try {
    const storageRef = ref(storage, path);
    await uploadString(storageRef, fileJson, 'raw', {
      contentType: 'application/json',
      customMetadata: {
        id: sanitizePackId(pack.id),
        title: (pack.title || 'Untitled Study Pack').slice(0, 120),
        visibility,
        ownerId: pack.ownerId || uid,
        ownerName: (pack.ownerName || pack.author || 'StudyDeck User').slice(0, 80),
      },
    });
    return { ok: true, path };
  } catch (err) {
    return {
      ok: false,
      path,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deletePackFileFromStorage(
  packId: string,
  visibility: 'public' | 'private',
  uid?: string
): Promise<void> {
  const path = getStoragePackPath(packId, visibility, uid);
  try {
    await deleteObject(ref(storage, path));
  } catch {
    // Ignore missing object or unconfigured Storage bucket
  }
}

async function listPackFolderFromStorage(
  folderPath: string,
  visibility: 'public' | 'private'
): Promise<StudyPack[]> {
  try {
    const res = await listAll(ref(storage, folderPath));
    const jsonItems = res.items.filter((item) => item.name.endsWith('.json'));
    if (!jsonItems.length) return [];

    const decoder = new TextDecoder();
    const packs = await Promise.all(
      jsonItems.map(async (itemRef) => {
        try {
          const bytes = await getBytes(itemRef, 1024 * 1024);
          const raw = decoder.decode(bytes);
          return parseStudyPackFile(raw, visibility);
        } catch {
          return null;
        }
      })
    );
    return packs
      .filter((p): p is StudyPack => Boolean(p))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } catch {
    // Gracefully return empty if Firebase Storage is not enabled or rules aren't set yet
    return [];
  }
}

export async function listPublicPackFilesFromStorage(): Promise<StudyPack[]> {
  return listPackFolderFromStorage('study-packs/public', 'public');
}

export async function listPrivatePackFilesFromStorage(uid: string): Promise<StudyPack[]> {
  if (!uid) return [];
  return listPackFolderFromStorage(`study-packs/private/${uid}`, 'private');
}
