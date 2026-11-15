import { StudyPack } from '../types';

export const CUSTOM_PACKS_STORAGE_KEY = 'studydeck_custom_packs';
export const APPLIED_PACKS_STORAGE_KEY = 'studydeck_applied_packs';

// Starts empty so new users begin with a clean template-driven Study Packs experience
export const CURATED_STUDY_PACKS: StudyPack[] = [];

export function loadCustomPacksFromLocal(): StudyPack[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PACKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomPacksToLocal(packs: StudyPack[]): void {
  try {
    localStorage.setItem(CUSTOM_PACKS_STORAGE_KEY, JSON.stringify(packs));
  } catch {
    // ignore
  }
}

export function loadAppliedPackIdsFromLocal(): string[] {
  try {
    const raw = localStorage.getItem(APPLIED_PACKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAppliedPackIdsToLocal(ids: string[]): void {
  try {
    localStorage.setItem(APPLIED_PACKS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}
