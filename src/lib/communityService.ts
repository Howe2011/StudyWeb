import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { createEmptyStructuredNote, makeNoteId } from './noteFormat';
import { makeId } from './workspaceStore';
import {
  SharedFlashcardsPayload,
  SharedItemType,
  SharedItemVisibility,
  SharedNotesPayload,
  SharedStudyItem,
  SharedSubjectPayload,
  StudyFlashcard,
  StudySubject,
  StudyTopic,
  WorkspaceData,
} from '../types';

const SHARE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CACHE_TTL_MS = 15 * 1000;

let cachedPublicItems: { items: SharedStudyItem[]; fetchedAt: number } | null = null;

export function clearCommunityCache(): void {
  cachedPublicItems = null;
}

function generateShareCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += SHARE_CODE_CHARS[Math.floor(Math.random() * SHARE_CODE_CHARS.length)];
  }
  return out;
}

function parseSharedDoc(id: string, raw: Record<string, unknown>): SharedStudyItem | null {
  try {
    const payload = JSON.parse(String(raw.payloadJson || '{}')) as {
      notesPayload?: SharedNotesPayload;
      flashcardsPayload?: SharedFlashcardsPayload;
      subjectPayload?: SharedSubjectPayload;
    };
    const createdAt =
      raw.createdAt instanceof Timestamp
        ? raw.createdAt.toDate().toISOString()
        : new Date().toISOString();
    const updatedAt =
      raw.updatedAt instanceof Timestamp
        ? raw.updatedAt.toDate().toISOString()
        : createdAt;

    return {
      id,
      shareCode: String(raw.shareCode || ''),
      type: (raw.type as SharedItemType) || 'notes',
      title: String(raw.title || 'Shared Resource'),
      subjectName: String(raw.subjectName || 'General'),
      examBoard: String(raw.examBoard || 'GCSE / Revision'),
      summary: String(raw.summary || ''),
      visibility: (raw.visibility as SharedItemVisibility) === 'unlisted' ? 'unlisted' : 'public',
      ownerId: String(raw.ownerId || ''),
      ownerName: String(raw.ownerName || 'StudyWeb Student'),
      itemCount: Number(raw.itemCount || 0),
      copyCount: Number(raw.copyCount || 0),
      createdAt,
      updatedAt,
      notesPayload: payload.notesPayload,
      flashcardsPayload: payload.flashcardsPayload,
      subjectPayload: payload.subjectPayload,
    };
  } catch {
    return null;
  }
}

export async function fetchPublicSharedItems(forceRefresh = false): Promise<SharedStudyItem[]> {
  if (!forceRefresh && cachedPublicItems && Date.now() - cachedPublicItems.fetchedAt < CACHE_TTL_MS) {
    return cachedPublicItems.items;
  }
  const path = 'sharedItems';
  try {
    const q = query(
      collection(db, 'sharedItems'),
      where('visibility', '==', 'public'),
      limit(200)
    );
    const snap = await getDocs(q);
    const items = snap.docs
      .map((d) => parseSharedDoc(d.id, d.data() as Record<string, unknown>))
      .filter((x): x is SharedStudyItem => Boolean(x))
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));

    cachedPublicItems = { items, fetchedAt: Date.now() };
    return items;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchUserSharedItems(uid: string): Promise<SharedStudyItem[]> {
  const path = `sharedItems(ownerId=${uid})`;
  try {
    const q = query(
      collection(db, 'sharedItems'),
      where('ownerId', '==', uid),
      limit(200)
    );
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => parseSharedDoc(d.id, d.data() as Record<string, unknown>))
      .filter((x): x is SharedStudyItem => Boolean(x))
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function fetchAllSharedItemsForAdmin(): Promise<SharedStudyItem[]> {
  const path = 'sharedItems(admin)';
  try {
    const q = query(collection(db, 'sharedItems'), limit(250));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => parseSharedDoc(d.id, d.data() as Record<string, unknown>))
      .filter((x): x is SharedStudyItem => Boolean(x))
      .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function adminUpdateSharedItemVisibility(
  shareId: string,
  visibility: SharedItemVisibility
): Promise<void> {
  const path = `sharedItems/${shareId}`;
  try {
    await updateDoc(doc(db, 'sharedItems', shareId), {
      visibility,
      updatedAt: serverTimestamp(),
    });
    cachedPublicItems = null;
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function lookupSharedItemByCode(rawCode: string): Promise<SharedStudyItem | null> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return null;
  const q = query(
    collection(db, 'sharedItems'),
    where('shareCode', '==', code),
    limit(1)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return parseSharedDoc(d.id, d.data() as Record<string, unknown>);
}

export async function publishSharedItem(params: {
  uid: string;
  ownerName: string;
  type: SharedItemType;
  title: string;
  subjectName: string;
  examBoard: string;
  summary: string;
  visibility: SharedItemVisibility;
  itemCount: number;
  notesPayload?: SharedNotesPayload;
  flashcardsPayload?: SharedFlashcardsPayload;
  subjectPayload?: SharedSubjectPayload;
}): Promise<SharedStudyItem> {
  const shareCode = generateShareCode();
  const id = `sh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const payloadJson = JSON.stringify({
    notesPayload: params.notesPayload,
    flashcardsPayload: params.flashcardsPayload,
    subjectPayload: params.subjectPayload,
  });

  if (payloadJson.length > 400000) {
    throw new Error('This shared item is over the 400 KB limit. Try sharing one topic or deck at a time.');
  }

  const docRef = doc(db, 'sharedItems', id);
  const path = `sharedItems/${id}`;
  const cleanTitle = (params.title || '').trim().slice(0, 140) || 'Untitled Share';
  const cleanSubject = (params.subjectName || '').trim().slice(0, 80) || 'General';
  const cleanBoard = (params.examBoard || '').trim().slice(0, 80) || 'GCSE / Revision';
  const cleanSummary = (params.summary || '').trim().slice(0, 280);
  const cleanOwner = (params.ownerName || '').trim().slice(0, 100) || 'StudyWeb Student';

  try {
    await setDoc(docRef, {
      id,
      shareCode,
      type: params.type,
      title: cleanTitle,
      subjectName: cleanSubject,
      examBoard: cleanBoard,
      summary: cleanSummary,
      visibility: params.visibility,
      ownerId: params.uid,
      ownerName: cleanOwner,
      itemCount: Math.max(0, Math.round(params.itemCount)),
      copyCount: 0,
      payloadJson,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }

  cachedPublicItems = null;
  const nowIso = new Date().toISOString();
  return {
    id,
    shareCode,
    type: params.type,
    title: cleanTitle,
    subjectName: cleanSubject,
    examBoard: cleanBoard,
    summary: cleanSummary,
    visibility: params.visibility,
    ownerId: params.uid,
    ownerName: cleanOwner,
    itemCount: Math.max(0, Math.round(params.itemCount)),
    copyCount: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
    notesPayload: params.notesPayload,
    flashcardsPayload: params.flashcardsPayload,
    subjectPayload: params.subjectPayload,
  };
}

export async function updateSharedItem(params: {
  id: string;
  uid: string;
  ownerName: string;
  type: SharedItemType;
  shareCode?: string;
  createdAt?: string;
  copyCount?: number;
  title: string;
  subjectName: string;
  examBoard: string;
  summary: string;
  visibility: SharedItemVisibility;
  itemCount: number;
  notesPayload?: SharedNotesPayload;
  flashcardsPayload?: SharedFlashcardsPayload;
  subjectPayload?: SharedSubjectPayload;
}): Promise<SharedStudyItem> {
  const payloadJson = JSON.stringify({
    notesPayload: params.notesPayload,
    flashcardsPayload: params.flashcardsPayload,
    subjectPayload: params.subjectPayload,
  });

  if (payloadJson.length > 400000) {
    throw new Error('This shared item is over the 400 KB limit. Try sharing fewer sub-topics or removing large images.');
  }

  const docRef = doc(db, 'sharedItems', params.id);
  const path = `sharedItems/${params.id}`;
  const cleanTitle = (params.title || '').trim().slice(0, 140) || 'Untitled Share';
  const cleanSubject = (params.subjectName || '').trim().slice(0, 80) || 'General';
  const cleanBoard = (params.examBoard || '').trim().slice(0, 80) || 'GCSE / Revision';
  const cleanSummary = (params.summary || '').trim().slice(0, 280);
  const cleanOwner = (params.ownerName || '').trim().slice(0, 100) || 'StudyWeb Student';
  const cleanCount = Math.max(0, Math.round(params.itemCount));

  try {
    await updateDoc(docRef, {
      title: cleanTitle,
      subjectName: cleanSubject,
      examBoard: cleanBoard,
      summary: cleanSummary,
      visibility: params.visibility,
      ownerName: cleanOwner,
      itemCount: cleanCount,
      payloadJson,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }

  cachedPublicItems = null;
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const parsed = parseSharedDoc(snap.id, snap.data() as Record<string, unknown>);
      if (parsed) return parsed;
    }
  } catch {
    // fallback to optimistic object below
  }

  const nowIso = new Date().toISOString();
  return {
    id: params.id,
    shareCode: params.shareCode || '',
    type: params.type,
    title: cleanTitle,
    subjectName: cleanSubject,
    examBoard: cleanBoard,
    summary: cleanSummary,
    visibility: params.visibility,
    ownerId: params.uid,
    ownerName: cleanOwner,
    itemCount: cleanCount,
    copyCount: params.copyCount ?? 0,
    createdAt: params.createdAt || nowIso,
    updatedAt: nowIso,
    notesPayload: params.notesPayload,
    flashcardsPayload: params.flashcardsPayload,
    subjectPayload: params.subjectPayload,
  };
}

export async function deleteSharedItem(id: string): Promise<void> {
  const path = `sharedItems/${id}`;
  try {
    await deleteDoc(doc(db, 'sharedItems', id));
    cachedPublicItems = null;
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function incrementSharedCopyCount(id: string): Promise<void> {
  try {
    const snap = await getDoc(doc(db, 'sharedItems', id));
    if (!snap.exists()) return;
    await updateDoc(doc(db, 'sharedItems', id), {
      copyCount: increment(1),
    });
  } catch {
    // Non-fatal counter bump
  }
}

/**
 * Copies a Community/Shared Notes, Flashcard Deck, or Full Subject cleanly into the user's workspace.
 */
export function copySharedItemIntoWorkspace(
  ws: WorkspaceData,
  item: SharedStudyItem
): { workspace: WorkspaceData; summary: string; subjectId?: string; topicId?: string } {
  const next: WorkspaceData = {
    ...ws,
    subjects: [...ws.subjects],
    topics: [...ws.topics],
    flashcards: [...ws.flashcards],
    updatedAt: new Date().toISOString(),
  };

  const ensureSubj = (name: string, board?: string, color?: string, hasTimeline?: boolean): StudySubject => {
    const clean = (name || 'Shared Subject').trim();
    const found = next.subjects.find((s) => s.name.toLowerCase() === clean.toLowerCase());
    if (found) return found;
    const created: StudySubject = {
      id: makeId('subj'),
      name: clean,
      examBoard: board || item.examBoard || 'GCSE / Revision',
      color: color || '#2F5F8A',
      examDate: '',
      weight: 2,
      hasTimeline: Boolean(hasTimeline),
      createdAt: new Date().toISOString(),
    };
    next.subjects.push(created);
    return created;
  };

  if (item.type === 'notes' && item.notesPayload) {
    const subj = ensureSubj(item.subjectName, item.examBoard);
    const topicName = item.notesPayload.topicName || item.title;
    const uniqueName = next.topics.some(
      (t) => t.subjectId === subj.id && t.name.toLowerCase() === topicName.toLowerCase()
    )
      ? `${topicName} (Shared)`
      : topicName;

    const nowIso = new Date().toISOString();
    const newTopic: StudyTopic = {
      id: makeId('top'),
      subjectId: subj.id,
      name: uniqueName,
      specCode: item.notesPayload.specCode,
      notes: {
        ...createEmptyStructuredNote(),
        ...item.notesPayload.notes,
        sections: (item.notesPayload.notes.sections || []).map((sec) => ({
          ...sec,
          id: makeNoteId('sec'),
        })),
        keyTerms: (item.notesPayload.notes.keyTerms || []).map((kt) => ({
          ...kt,
          id: makeNoteId('term'),
        })),
        updatedAt: nowIso,
      },
      timelineEvents: item.notesPayload.timelineEvents?.map((ev) => ({
        ...ev,
        id: makeId('tl'),
      })),
      createdAt: nowIso,
    };
    next.topics.push(newTopic);

    const bundledSubs = Array.isArray(item.notesPayload.subTopics)
      ? item.notesPayload.subTopics
      : [];
    if (bundledSubs.length > 0) {
      const idMap = new Map<string, string>();
      if (item.notesPayload.topicOldId) {
        idMap.set(item.notesPayload.topicOldId, newTopic.id);
      }
      for (const st of bundledSubs) {
        if (st.oldId) idMap.set(st.oldId, makeId('top'));
      }
      for (const st of bundledSubs) {
        const subId = (st.oldId && idMap.get(st.oldId)) || makeId('top');
        const resolvedParentId =
          (st.parentOldId && idMap.get(st.parentOldId)) || newTopic.id;
        next.topics.push({
          id: subId,
          subjectId: subj.id,
          parentTopicId: resolvedParentId,
          name: st.topicName || 'Sub-topic',
          specCode: st.specCode,
          tags: st.tags ? [...st.tags] : undefined,
          notes: {
            ...createEmptyStructuredNote(),
            ...st.notes,
            sections: (st.notes.sections || []).map((sec) => ({
              ...sec,
              id: makeNoteId('sec'),
            })),
            keyTerms: (st.notes.keyTerms || []).map((kt) => ({
              ...kt,
              id: makeNoteId('term'),
            })),
            updatedAt: nowIso,
          },
          timelineEvents: st.timelineEvents?.map((ev) => ({
            ...ev,
            id: makeId('tl'),
          })),
          createdAt: nowIso,
        });
      }
    }

    const subCount = bundledSubs.length;
    return {
      workspace: next,
      summary:
        subCount > 0
          ? `Copied "${uniqueName}" + ${subCount} sub-topic${
              subCount === 1 ? '' : 's'
            } into ${subj.name}`
          : `Copied notes "${uniqueName}" into ${subj.name}`,
      subjectId: subj.id,
      topicId: newTopic.id,
    };
  }

  if (item.type === 'flashcards' && item.flashcardsPayload) {
    const subj = ensureSubj(item.subjectName, item.examBoard);
    const fallbackSection =
      (item.flashcardsPayload.sectionName || item.title || 'Shared Deck')
        .replace(/\s+Flashcards$/i, '')
        .trim() || 'Shared Deck';
    const existingQ = new Set(next.flashcards.map((c) => `${c.subjectId}::${c.q.toLowerCase()}`));
    let added = 0;
    for (const c of item.flashcardsPayload.cards) {
      const key = `${subj.id}::${c.q.trim().toLowerCase()}`;
      if (!c.q.trim() || !c.a.trim() || existingQ.has(key)) continue;
      existingQ.add(key);
      const card: StudyFlashcard = {
        id: makeId('fc'),
        subjectId: subj.id,
        sectionName: (c.sectionName || fallbackSection).trim() || 'Shared Deck',
        q: c.q.trim(),
        a: c.a.trim(),
        box: 1,
        dueAt: Date.now(),
        flagged: false,
        createdAt: new Date().toISOString(),
      };
      next.flashcards.push(card);
      added++;
    }
    return {
      workspace: next,
      summary: `Added ${added} flashcard${added === 1 ? '' : 's'} into ${subj.name}`,
      subjectId: subj.id,
    };
  }

  if (item.type === 'subject' && item.subjectPayload) {
    const sp = item.subjectPayload;
    const subj = ensureSubj(
      sp.subject.name,
      sp.subject.examBoard,
      sp.subject.color,
      sp.subject.hasTimeline
    );
    const topicMap = new Map<string, StudyTopic>();
    let topicsAdded = 0;
    let firstTopicId: string | undefined;
    for (const tp of sp.topics) {
      const existing = next.topics.find(
        (x) => x.subjectId === subj.id && x.name.toLowerCase() === tp.name.toLowerCase()
      );
      if (existing) {
        topicMap.set(tp.name.toLowerCase(), existing);
        if (!firstTopicId) firstTopicId = existing.id;
      } else {
        const created: StudyTopic = {
          id: makeId('top'),
          subjectId: subj.id,
          name: tp.name,
          specCode: tp.specCode,
          notes: {
            ...createEmptyStructuredNote(),
            ...tp.notes,
            sections: (tp.notes?.sections || []).map((sec) => ({
              ...sec,
              id: makeNoteId('sec'),
            })),
            keyTerms: (tp.notes?.keyTerms || []).map((kt) => ({
              ...kt,
              id: makeNoteId('term'),
            })),
            updatedAt: new Date().toISOString(),
          },
          timelineEvents: tp.timelineEvents?.map((ev) => ({ ...ev, id: makeId('tl') })),
          createdAt: new Date().toISOString(),
        };
        next.topics.push(created);
        topicMap.set(tp.name.toLowerCase(), created);
        if (!firstTopicId) firstTopicId = created.id;
        topicsAdded++;
      }
    }

    // Re-link any sub-topics whose parentTopicName was shared
    for (const tp of sp.topics) {
      if (!tp.parentTopicName) continue;
      const child = topicMap.get(tp.name.toLowerCase());
      const parent = topicMap.get(tp.parentTopicName.toLowerCase());
      if (child && parent && child.id !== parent.id && !child.parentTopicId) {
        const idx = next.topics.findIndex((x) => x.id === child.id);
        if (idx >= 0) {
          next.topics[idx] = { ...next.topics[idx], parentTopicId: parent.id };
        }
      }
    }

    let cardsAdded = 0;
    const existingQ = new Set(next.flashcards.map((c) => `${c.subjectId}::${c.q.toLowerCase()}`));
    for (const c of sp.cards) {
      const key = `${subj.id}::${c.q.trim().toLowerCase()}`;
      if (!c.q.trim() || !c.a.trim() || existingQ.has(key)) continue;
      existingQ.add(key);
      const t = c.topicName ? topicMap.get(c.topicName.toLowerCase()) : undefined;
      next.flashcards.push({
        id: makeId('fc'),
        subjectId: subj.id,
        ...(t ? { topicId: t.id } : {}),
        sectionName: c.sectionName || c.topicName || 'Core Deck',
        q: c.q.trim(),
        a: c.a.trim(),
        box: 1,
        dueAt: Date.now(),
        flagged: false,
        createdAt: new Date().toISOString(),
      });
      cardsAdded++;
    }

    return {
      workspace: next,
      summary: `Copied ${subj.name} (${topicsAdded} topics, ${cardsAdded} flashcards)`,
      subjectId: subj.id,
      topicId: firstTopicId,
    };
  }

  return { workspace: next, summary: 'Nothing new to copy.' };
}

/**
 * Copies a single topic's notes (and any matching cards) from a shared Full Subject into workspace.
 */
export function copySharedSubjectTopicIntoWorkspace(
  ws: WorkspaceData,
  item: SharedStudyItem,
  topicIndex: number
): { workspace: WorkspaceData; summary: string; subjectId?: string; topicId?: string } {
  if (item.type !== 'subject' || !item.subjectPayload) {
    return copySharedItemIntoWorkspace(ws, item);
  }
  const tp = item.subjectPayload.topics[topicIndex];
  if (!tp) {
    return copySharedItemIntoWorkspace(ws, item);
  }
  const next: WorkspaceData = {
    ...ws,
    subjects: [...ws.subjects],
    topics: [...ws.topics],
    flashcards: [...ws.flashcards],
    updatedAt: new Date().toISOString(),
  };

  const sp = item.subjectPayload;
  let subj = next.subjects.find(
    (s) => s.name.toLowerCase() === (sp.subject.name || item.subjectName).trim().toLowerCase()
  );
  if (!subj) {
    subj = {
      id: makeId('subj'),
      name: (sp.subject.name || item.subjectName || 'Shared Subject').trim(),
      examBoard: sp.subject.examBoard || item.examBoard || 'GCSE / Revision',
      color: sp.subject.color || '#2F5F8A',
      examDate: '',
      weight: 2,
      hasTimeline: Boolean(sp.subject.hasTimeline),
      createdAt: new Date().toISOString(),
    };
    next.subjects.push(subj);
  }

  const uniqueName = next.topics.some(
    (t) => t.subjectId === subj!.id && t.name.toLowerCase() === tp.name.toLowerCase()
  )
    ? `${tp.name} (Shared)`
    : tp.name;

  const createdTopic: StudyTopic = {
    id: makeId('top'),
    subjectId: subj.id,
    name: uniqueName,
    specCode: tp.specCode,
    notes: {
      ...createEmptyStructuredNote(),
      ...tp.notes,
      sections: (tp.notes?.sections || []).map((sec) => ({
        ...sec,
        id: makeNoteId('sec'),
      })),
      keyTerms: (tp.notes?.keyTerms || []).map((kt) => ({
        ...kt,
        id: makeNoteId('term'),
      })),
      updatedAt: new Date().toISOString(),
    },
    timelineEvents: tp.timelineEvents?.map((ev) => ({ ...ev, id: makeId('tl') })),
    createdAt: new Date().toISOString(),
  };
  next.topics.push(createdTopic);

  const matchingCards = sp.cards.filter(
    (c) => (c.topicName || '').toLowerCase() === tp.name.toLowerCase()
  );
  const existingQ = new Set(next.flashcards.map((c) => `${c.subjectId}::${c.q.toLowerCase()}`));
  let cardsAdded = 0;
  for (const c of matchingCards) {
    const key = `${subj.id}::${c.q.trim().toLowerCase()}`;
    if (!c.q.trim() || !c.a.trim() || existingQ.has(key)) continue;
    existingQ.add(key);
    next.flashcards.push({
      id: makeId('fc'),
      subjectId: subj.id,
      topicId: createdTopic.id,
      sectionName: c.sectionName || createdTopic.name,
      q: c.q.trim(),
      a: c.a.trim(),
      box: 1,
      dueAt: Date.now(),
      flagged: false,
      createdAt: new Date().toISOString(),
    });
    cardsAdded++;
  }

  return {
    workspace: next,
    summary: `Copied topic "${uniqueName}"${cardsAdded ? ` + ${cardsAdded} cards` : ''} into ${subj.name}`,
    subjectId: subj.id,
    topicId: createdTopic.id,
  };
}

export async function updateCommunityAuthorName(uid: string, newAuthorName: string): Promise<void> {
  try {
    const q = query(collection(db, 'sharedItems'), where('ownerId', '==', uid), limit(200));
    const snap = await getDocs(q);
    await Promise.all(
      snap.docs.map((d) =>
        updateDoc(d.ref, {
          ownerName: newAuthorName,
          updatedAt: serverTimestamp(),
        })
      )
    );
    clearCommunityCache();
  } catch {
    // ignore
  }
}
