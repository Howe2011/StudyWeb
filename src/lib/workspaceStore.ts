import { QUICK_ADD_SUBJECT_CATALOG } from './subjectCatalog';
import {
  createEmptyStructuredNote,
  legacyHtmlToStructuredNote,
  makeNoteId,
} from './noteFormat';
import {
  CalendarStudyBlock,
  DeckFlashcard,
  DeckSection,
  DeckSnapshot,
  DeckSubject,
  DeckTopic,
  HomeWidgetId,
  HomeWidgetLayoutItem,
  HomeWidgetPrefs,
  PlannerSchedulePrefs,
  StudyFlashcard,
  StudySubject,
  StudyTopic,
  TimelineEventItem,
  TodoTaskItem,
  WorkspaceData,
} from '../types';

export const WORKSPACE_LOCAL_KEY = 'studydeck_workspace_v2';

export const DEFAULT_HOME_WIDGETS: HomeWidgetPrefs = {
  dueCards: true,
  schedule: true,
  timer: true,
  todos: true,
  mastery: true,
};

export const DEFAULT_HOME_LAYOUT: HomeWidgetLayoutItem[] = [
  { id: 'dueCards', cols: 7, h: null },
  { id: 'timer', cols: 5, h: null },
  { id: 'schedule', cols: 6, h: null },
  { id: 'todos', cols: 6, h: null },
  { id: 'mastery', cols: 12, h: null },
];

const VALID_HOME_WIDGET_IDS = new Set<HomeWidgetId>([
  'dueCards',
  'timer',
  'schedule',
  'todos',
  'mastery',
  'dailyGoal',
  'examCountdowns',
  'scratchpad',
  'flashcardBreakdown',
  'liveQuiz',
]);

export function homeWidgetsFromLayout(layout: HomeWidgetLayoutItem[]): HomeWidgetPrefs {
  const ids = new Set(layout.map((w) => w.id));
  return {
    dueCards: ids.has('dueCards'),
    schedule: ids.has('schedule'),
    timer: ids.has('timer'),
    todos: ids.has('todos'),
    mastery: ids.has('mastery'),
  };
}

function normalizeHomeLayout(
  rawLayout: unknown,
  legacyPrefs: HomeWidgetPrefs
): HomeWidgetLayoutItem[] {
  if (Array.isArray(rawLayout)) {
    const seen = new Set<HomeWidgetId>();
    const out: HomeWidgetLayoutItem[] = [];
    for (const item of rawLayout) {
      if (!item || typeof item !== 'object') continue;
      const obj = item as { id?: unknown; cols?: unknown; h?: unknown };
      const id = String(obj.id || '') as HomeWidgetId;
      if (!VALID_HOME_WIDGET_IDS.has(id) || seen.has(id)) continue;
      seen.add(id);
      const rawCols = Number(obj.cols);
      const cols = Number.isFinite(rawCols)
        ? Math.max(3, Math.min(12, Math.round(rawCols)))
        : 6;
      const rawH = obj.h === null || obj.h === undefined ? null : Number(obj.h);
      const h =
        rawH !== null && Number.isFinite(rawH) && rawH > 0
          ? Math.max(180, Math.min(760, Math.round(rawH)))
          : null;
      out.push({ id, cols, h });
    }
    return out;
  }

  return DEFAULT_HOME_LAYOUT.filter((w) => {
    if (w.id in legacyPrefs) {
      return legacyPrefs[w.id as keyof HomeWidgetPrefs] !== false;
    }
    return true;
  }).map((w) => ({ ...w }));
}

export const DEFAULT_PLANNER_PREFS: PlannerSchedulePrefs = {
  weekdayStart: '16:30',
  weekendStart: '09:30',
  availHours: [2, 2, 2, 2, 2, 3, 3],
};

export function createEmptyWorkspace(): WorkspaceData {
  return {
    version: 2,
    subjects: [],
    topics: [],
    flashcards: [],
    todos: [],
    calendarBlocks: [],
    plannerPrefs: {
      ...DEFAULT_PLANNER_PREFS,
      availHours: [...DEFAULT_PLANNER_PREFS.availHours],
    },
    studyMinutesLogged: 0,
    studyStreakDays: 0,
    lastStudyDate: '',
    dailyGoalMinutes: 60,
    scratchpad: '',
    homeWidgets: { ...DEFAULT_HOME_WIDGETS },
    homeLayout: DEFAULT_HOME_LAYOUT.map((w) => ({ ...w })),
    updatedAt: new Date().toISOString(),
  };
}

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function getLocalWorkspaceStorageKey(uid?: string | null): string {
  return uid ? `${WORKSPACE_LOCAL_KEY}:${uid}` : WORKSPACE_LOCAL_KEY;
}

export function normalizeWorkspace(raw: unknown): WorkspaceData {
  const empty = createEmptyWorkspace();
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as Partial<WorkspaceData>;
  const rawPrefs = r.plannerPrefs;
  const availHours =
    rawPrefs && Array.isArray(rawPrefs.availHours) && rawPrefs.availHours.length === 7
      ? rawPrefs.availHours.map((n) => Math.max(0, Math.min(12, Number(n) || 0)))
      : [...DEFAULT_PLANNER_PREFS.availHours];
  const mergedLegacyWidgets: HomeWidgetPrefs = {
    ...DEFAULT_HOME_WIDGETS,
    ...(r.homeWidgets && typeof r.homeWidgets === 'object' ? r.homeWidgets : {}),
  };
  const homeLayout = normalizeHomeLayout(r.homeLayout, mergedLegacyWidgets);
  return {
    version: 2,
    subjects: Array.isArray(r.subjects) ? r.subjects : [],
    topics: Array.isArray(r.topics) ? r.topics : [],
    flashcards: Array.isArray(r.flashcards) ? r.flashcards : [],
    todos: Array.isArray(r.todos) ? r.todos : [],
    calendarBlocks: Array.isArray(r.calendarBlocks) ? r.calendarBlocks : [],
    plannerPrefs: {
      weekdayStart:
        rawPrefs && typeof rawPrefs.weekdayStart === 'string' && rawPrefs.weekdayStart
          ? rawPrefs.weekdayStart
          : DEFAULT_PLANNER_PREFS.weekdayStart,
      weekendStart:
        rawPrefs && typeof rawPrefs.weekendStart === 'string' && rawPrefs.weekendStart
          ? rawPrefs.weekendStart
          : DEFAULT_PLANNER_PREFS.weekendStart,
      availHours,
    },
    studyMinutesLogged: Number(r.studyMinutesLogged) || 0,
    studyStreakDays: Number(r.studyStreakDays) || 0,
    lastStudyDate: typeof r.lastStudyDate === 'string' ? r.lastStudyDate : '',
    dailyGoalMinutes: Math.max(15, Math.min(480, Number(r.dailyGoalMinutes) || 60)),
    scratchpad: typeof r.scratchpad === 'string' ? r.scratchpad : '',
    homeWidgets: Array.isArray(r.homeLayout)
      ? homeWidgetsFromLayout(homeLayout)
      : mergedLegacyWidgets,
    homeLayout,
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  };
}

export function loadWorkspaceFromLocal(uid?: string | null): WorkspaceData | null {
  try {
    const raw = localStorage.getItem(getLocalWorkspaceStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && (parsed as { version?: number }).version === 2) {
      return normalizeWorkspace(parsed);
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

export function saveWorkspaceToLocal(workspace: WorkspaceData, uid?: string | null): void {
  try {
    localStorage.setItem(
      getLocalWorkspaceStorageKey(uid),
      JSON.stringify({ ...workspace, version: 2 })
    );
  } catch {
    // ignore quota exceeded
  }
}

export function clearWorkspaceLocal(uid?: string | null): void {
  try {
    localStorage.removeItem(getLocalWorkspaceStorageKey(uid));
  } catch {
    // ignore
  }
}

const LEGACY_SUBJECT_LABELS: Record<string, { name: string; color: string; hasTimeline?: boolean }> = {
  h: { name: 'History', color: '#A8750C', hasTimeline: true },
  g: { name: 'Geography', color: '#4D6B2A' },
  weimar: { name: 'History', color: '#A8750C', hasTimeline: true },
  geo1: { name: 'Geography', color: '#4D6B2A' },
  geo2: { name: 'Geography', color: '#4D6B2A' },
};

function findOrAddSubject(
  ws: WorkspaceData,
  name: string,
  opts?: { color?: string; examDate?: string; weight?: 1 | 2 | 3; examBoard?: string; hasTimeline?: boolean }
): StudySubject {
  const cleanName = (name || 'General').trim();
  const existing = ws.subjects.find(
    (s) => s.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (existing) {
    if (opts?.examDate && !existing.examDate) existing.examDate = opts.examDate;
    if (opts?.hasTimeline) existing.hasTimeline = true;
    return existing;
  }
  const catMatch = QUICK_ADD_SUBJECT_CATALOG.find(
    (c) => c.name.toLowerCase() === cleanName.toLowerCase()
  );
  const subj: StudySubject = {
    id: makeId('subj'),
    name: cleanName,
    examBoard: opts?.examBoard || catMatch?.examBoard || 'GCSE / Revision',
    color: opts?.color || catMatch?.color || '#2F5F8A',
    examDate: opts?.examDate || '',
    weight: opts?.weight || 2,
    hasTimeline: opts?.hasTimeline ?? catMatch?.hasTimeline ?? false,
    createdAt: new Date().toISOString(),
  };
  ws.subjects.push(subj);
  return subj;
}

function findOrAddTopic(
  ws: WorkspaceData,
  subjectId: string,
  name: string,
  specCode?: string
): StudyTopic {
  const cleanName = (name || 'Core Topic').trim();
  const existing = ws.topics.find(
    (t) => t.subjectId === subjectId && t.name.toLowerCase() === cleanName.toLowerCase()
  );
  if (existing) return existing;
  const topic: StudyTopic = {
    id: makeId('top'),
    subjectId,
    name: cleanName,
    specCode,
    completed: false,
    notes: createEmptyStructuredNote(),
    createdAt: new Date().toISOString(),
  };
  ws.topics.push(topic);
  return topic;
}

/**
 * Converts legacy revision + planner key-value entries into WorkspaceData v2 cleanly.
 */
export function convertLegacyEntriesToWorkspace(
  revision: Record<string, string>,
  planner: Record<string, string>,
  seedWorkspace?: WorkspaceData | null
): { workspace: WorkspaceData; hadLegacyData: boolean } {
  const ws = seedWorkspace ? normalizeWorkspace(seedWorkspace) : createEmptyWorkspace();
  let hadLegacyData = false;
  const topicAliasMap = new Map<string, { subjectId: string; topicId: string }>();

  // 1. Parse planner ('mockplanner.v1')
  const rawPlanner = planner['mockplanner.v1'];
  if (rawPlanner) {
    try {
      const pl = JSON.parse(rawPlanner) as {
        subs?: Array<{
          n?: string;
          on?: boolean;
          date?: string;
          w?: number;
          col?: string;
          topics?: string[];
          ex?: Array<{ d?: string; t?: string; n?: string }>;
        }>;
        td?: {
          items?: Array<{
            t?: string;
            i?: number | null;
            d?: string;
            pri?: number;
            done?: boolean | number;
          }>;
        };
        todos?: Array<{ text?: string; subj?: string; due?: string; pri?: number; done?: boolean }>;
        blocks?: Array<{
          d?: string;
          date?: string;
          t?: string;
          start?: string;
          dur?: number;
          n?: string;
          title?: string;
          subj?: string;
          done?: boolean;
        }>;
        sess?: { mins?: number };
        hist?: Record<string, { mins?: number }>;
      };

      const indexToSubjId = new Map<number, string>();
      if (Array.isArray(pl.subs)) {
        pl.subs.forEach((s, idx) => {
          if (!s || !s.n || s.on === false) return;
          hadLegacyData = true;
          const firstExam = s.date || s.ex?.[0]?.d || '';
          const weightNum = s.w === 3 ? 3 : s.w === 1 ? 1 : 2;
          const subj = findOrAddSubject(ws, s.n, {
            color: s.col,
            examDate: firstExam,
            weight: weightNum,
          });
          indexToSubjId.set(idx, subj.id);
          if (Array.isArray(s.topics)) {
            s.topics.forEach((tp) => {
              if (tp && tp.trim()) {
                const t = findOrAddTopic(ws, subj.id, tp.trim());
                topicAliasMap.set(tp.trim().toLowerCase(), { subjectId: subj.id, topicId: t.id });
              }
            });
          }
          if (Array.isArray(s.ex)) {
            s.ex.forEach((ex) => {
              if (!ex.d) return;
              const dup = ws.calendarBlocks.some(
                (b) => b.kind === 'exam' && b.date === ex.d && b.subjectId === subj.id
              );
              if (!dup) {
                ws.calendarBlocks.push({
                  id: makeId('blk'),
                  date: ex.d,
                  startTime: ex.t || '09:00',
                  durationMins: 90,
                  title: ex.n || `${subj.name} Exam`,
                  subjectId: subj.id,
                  kind: 'exam',
                  done: false,
                });
              }
            });
          }
        });
      }

      const tdItems = Array.isArray(pl.td?.items) ? pl.td!.items! : [];
      tdItems.forEach((it) => {
        if (!it.t) return;
        hadLegacyData = true;
        const subjId = it.i != null ? indexToSubjId.get(it.i) : undefined;
        const dup = ws.todos.some((td) => td.title === it.t && td.dueDate === (it.d || ''));
        if (!dup) {
          ws.todos.push({
            id: makeId('todo'),
            title: it.t,
            subjectId: subjId,
            dueDate: it.d || '',
            priority: it.pri === 3 ? 3 : it.pri === 1 ? 1 : 2,
            done: Boolean(it.done),
            createdAt: new Date().toISOString(),
          });
        }
      });

      if (Array.isArray(pl.todos)) {
        pl.todos.forEach((it) => {
          if (!it.text) return;
          hadLegacyData = true;
          const subj = it.subj ? findOrAddSubject(ws, it.subj) : undefined;
          const dup = ws.todos.some((td) => td.title === it.text);
          if (!dup) {
            ws.todos.push({
              id: makeId('todo'),
              title: it.text,
              subjectId: subj?.id,
              dueDate: it.due || '',
              priority: it.pri === 3 ? 3 : it.pri === 1 ? 1 : 2,
              done: Boolean(it.done),
              createdAt: new Date().toISOString(),
            });
          }
        });
      }

      if (Array.isArray(pl.blocks)) {
        pl.blocks.forEach((b) => {
          const dt = b.date || b.d;
          const title = b.title || b.n;
          if (!dt || !title || !/^\d{4}-\d{2}-\d{2}$/.test(dt)) return;
          hadLegacyData = true;
          const subj = b.subj ? findOrAddSubject(ws, b.subj) : undefined;
          const dup = ws.calendarBlocks.some((x) => x.date === dt && x.title === title);
          if (!dup) {
            ws.calendarBlocks.push({
              id: makeId('blk'),
              date: dt,
              startTime: b.start || b.t || '16:00',
              durationMins: Number(b.dur) || 45,
              title,
              subjectId: subj?.id,
              kind: 'revision',
              done: Boolean(b.done),
            });
          }
        });
      }

      if (pl.hist && typeof pl.hist === 'object') {
        let mins = 0;
        Object.values(pl.hist).forEach((entry) => {
          mins += Number(entry?.mins || 0);
        });
        if (mins > ws.studyMinutesLogged) ws.studyMinutesLogged = mins;
      }
    } catch {
      // ignore invalid planner JSON
    }
  }

  // 2. Parse user-subjects registry from revision.html
  const rawUserSubs = revision['user-subjects'];
  if (rawUserSubs) {
    try {
      const reg = JSON.parse(rawUserSubs) as {
        subs?: Array<{ id?: string; n?: string; kind?: string }>;
        extraTopics?: Array<{ id?: string; s?: string; label?: string }>;
      };
      const legacySubIdToNew = new Map<string, string>();
      if (Array.isArray(reg.subs)) {
        reg.subs.forEach((s) => {
          if (!s?.n) return;
          hadLegacyData = true;
          const created = findOrAddSubject(ws, s.n, { hasTimeline: s.kind === 'tl' });
          if (s.id) legacySubIdToNew.set(s.id, created.id);
        });
      }
      if (Array.isArray(reg.extraTopics)) {
        reg.extraTopics.forEach((t) => {
          if (!t?.label || !t.id) return;
          hadLegacyData = true;
          const mappedSubId =
            (t.s && legacySubIdToNew.get(t.s)) ||
            (t.s && LEGACY_SUBJECT_LABELS[t.s]
              ? findOrAddSubject(ws, LEGACY_SUBJECT_LABELS[t.s].name, LEGACY_SUBJECT_LABELS[t.s]).id
              : ws.subjects[0]?.id || findOrAddSubject(ws, 'General').id);
          const createdTopic = findOrAddTopic(ws, mappedSubId, t.label);
          topicAliasMap.set(t.id, { subjectId: mappedSubId, topicId: createdTopic.id });
        });
      }
    } catch {
      // ignore
    }
  }

  // 3. Parse legacy gdoc-* notes & edits-* timelines
  for (const [k, v] of Object.entries(revision)) {
    if (!v) continue;
    if (/^gdoc-/.test(k) && !/-cfg$/.test(k)) {
      const tid = k.replace(/^gdoc-/, '');
      const stripped = v.replace(/<[^>]+>/g, '').trim();
      if (!stripped) continue;
      hadLegacyData = true;
      let link = topicAliasMap.get(tid);
      if (!link) {
        const prefixMeta = LEGACY_SUBJECT_LABELS[tid] ||
          (tid.startsWith('geo') ? LEGACY_SUBJECT_LABELS.g : tid.startsWith('weim') || tid.startsWith('hist') ? LEGACY_SUBJECT_LABELS.h : undefined);
        const subj = findOrAddSubject(ws, prefixMeta?.name || 'Study Notes', prefixMeta);
        const topic = findOrAddTopic(ws, subj.id, tid);
        link = { subjectId: subj.id, topicId: topic.id };
        topicAliasMap.set(tid, link);
      }
      const targetTopic = ws.topics.find((t) => t.id === link!.topicId);
      if (targetTopic) {
        targetTopic.notes = legacyHtmlToStructuredNote(v);
      }
    } else if (/^edits-/.test(k)) {
      const tid = k.replace(/^edits-/, '');
      try {
        const ed = JSON.parse(v) as {
          add?: Array<{ d?: string; t?: string; x?: string; era?: string }>;
        };
        if (Array.isArray(ed.add) && ed.add.length > 0) {
          hadLegacyData = true;
          let link = topicAliasMap.get(tid);
          if (!link) {
            const subj = findOrAddSubject(ws, 'History', { color: '#A8750C', hasTimeline: true });
            const topic = findOrAddTopic(ws, subj.id, tid);
            link = { subjectId: subj.id, topicId: topic.id };
            topicAliasMap.set(tid, link);
          }
          const targetTopic = ws.topics.find((t) => t.id === link!.topicId);
          if (targetTopic) {
            const existing = targetTopic.timelineEvents || [];
            const converted: TimelineEventItem[] = ed.add
              .filter((ev) => ev.t || ev.x)
              .map((ev) => ({
                id: makeId('tl'),
                date: String(ev.d || ''),
                title: String(ev.t || ''),
                detail: String(ev.x || ''),
                era: ev.era,
              }));
            targetTopic.timelineEvents = [...existing, ...converted];
          }
        }
      } catch {
        // ignore
      }
    }
  }

  // 4. Parse legacy fc-state flashcards
  const rawFc = revision['fc-state'];
  if (rawFc) {
    try {
      const fc = JSON.parse(rawFc) as {
        secs?: Array<{ id?: string; n?: string; topic?: string }>;
        add?: Array<{ id?: string; q?: string; a?: string; s?: string }>;
        prog?: Record<string, { b?: number; d?: number }>;
        fl?: Record<string, boolean>;
      };
      const secMetaMap = new Map((fc.secs || []).map((s) => [s.id || '', s]));
      if (Array.isArray(fc.add) && fc.add.length > 0) {
        hadLegacyData = true;
        fc.add.forEach((c) => {
          if (!c.q || !c.a) return;
          const dup = ws.flashcards.some(
            (existing) => existing.q.trim() === c.q!.trim() && existing.a.trim() === c.a!.trim()
          );
          if (dup) return;
          const secMeta = secMetaMap.get(c.s || '');
          const tLink = secMeta?.topic ? topicAliasMap.get(secMeta.topic) : undefined;
          const fallbackSubj = ws.subjects[0] || findOrAddSubject(ws, 'Imported Flashcards');
          const subjectId = tLink?.subjectId || fallbackSubj.id;
          const fallbackTopic =
            ws.topics.find((t) => t.subjectId === subjectId) ||
            findOrAddTopic(ws, subjectId, 'Core Topic');
          const topicId = tLink?.topicId || fallbackTopic.id;
          const p = c.id ? fc.prog?.[c.id] : undefined;
          const box = p?.b && p.b >= 1 && p.b <= 5 ? (p.b as 1 | 2 | 3 | 4 | 5) : 1;
          ws.flashcards.push({
            id: makeId('fc'),
            subjectId,
            topicId,
            sectionName: secMeta?.n || 'Core Deck',
            q: c.q.trim(),
            a: c.a.trim(),
            box,
            dueAt: p?.d ? Number(p.d) : Date.now(),
            flagged: Boolean(c.id && fc.fl?.[c.id]),
            createdAt: new Date().toISOString(),
          });
        });
      }
    } catch {
      // ignore
    }
  }

  return { workspace: ws, hadLegacyData };
}

export function migrateLegacyBrowserStorage(): {
  workspace: WorkspaceData;
  migrated: boolean;
} {
  const existingV2 = loadWorkspaceFromLocal(null);
  if (existingV2) {
    return { workspace: existingV2, migrated: false };
  }
  const revision: Record<string, string> = {};
  const planner: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const val = localStorage.getItem(k);
      if (!val) continue;
      if (k === 'mockplanner.v1') {
        planner[k] = val;
      } else if (/^(fc-state|user-subjects|gdoc-|edits-)/.test(k)) {
        revision[k] = val;
      }
    }
  } catch {
    // ignore
  }

  const { workspace, hadLegacyData } = convertLegacyEntriesToWorkspace(revision, planner);
  if (hadLegacyData) {
    saveWorkspaceToLocal(workspace, null);
  }
  return { workspace, migrated: hadLegacyData };
}

export function detectHasGuestWorkspaceData(): boolean {
  const localV2 = loadWorkspaceFromLocal(null);
  if (
    localV2 &&
    (localV2.subjects.length > 0 ||
      localV2.flashcards.length > 0 ||
      localV2.todos.length > 0 ||
      localV2.topics.length > 0)
  ) {
    return true;
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k === 'mockplanner.v1' || /^(edits-|gdoc-|fc-state|user-subjects)/.test(k)) {
        return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

export function mergeWorkspaces(base: WorkspaceData, incoming: WorkspaceData): WorkspaceData {
  const next = normalizeWorkspace(base);
  const subjIdRemap = new Map<string, string>();
  const topicIdRemap = new Map<string, string>();

  for (const s of incoming.subjects) {
    const match = next.subjects.find((x) => x.name.toLowerCase() === s.name.toLowerCase());
    if (match) {
      subjIdRemap.set(s.id, match.id);
      if (!match.examDate && s.examDate) match.examDate = s.examDate;
      if (s.hasTimeline) match.hasTimeline = true;
    } else {
      const cloned: StudySubject = { ...s };
      next.subjects.push(cloned);
      subjIdRemap.set(s.id, cloned.id);
    }
  }

  for (const t of incoming.topics) {
    const mappedSubjId = subjIdRemap.get(t.subjectId) || t.subjectId;
    const match = next.topics.find(
      (x) => x.subjectId === mappedSubjId && x.name.toLowerCase() === t.name.toLowerCase()
    );
    if (match) {
      topicIdRemap.set(t.id, match.id);
      if (!match.notes.summary && t.notes.summary) match.notes.summary = t.notes.summary;
      if (t.notes.sections.some((sec) => sec.points.length > 0)) {
        const existingHeadings = new Set(match.notes.sections.map((sec) => sec.heading.toLowerCase()));
        for (const sec of t.notes.sections) {
          if (sec.points.length > 0 && !existingHeadings.has(sec.heading.toLowerCase())) {
            match.notes.sections.push({ ...sec, id: makeNoteId('sec') });
          }
        }
      }
      if (t.notes.keyTerms.length > 0) {
        const existingTerms = new Set(match.notes.keyTerms.map((k) => k.term.toLowerCase()));
        for (const kt of t.notes.keyTerms) {
          if (!existingTerms.has(kt.term.toLowerCase())) {
            match.notes.keyTerms.push({ ...kt, id: makeNoteId('term') });
          }
        }
      }
    } else {
      const cloned: StudyTopic = { ...t, subjectId: mappedSubjId };
      next.topics.push(cloned);
      topicIdRemap.set(t.id, cloned.id);
    }
  }

  for (const c of incoming.flashcards) {
    const mappedSubjId = subjIdRemap.get(c.subjectId) || c.subjectId;
    const mappedTopicId = topicIdRemap.get(c.topicId) || c.topicId;
    const dup = next.flashcards.some(
      (x) => x.q.trim().toLowerCase() === c.q.trim().toLowerCase() && x.subjectId === mappedSubjId
    );
    if (!dup) {
      next.flashcards.push({
        ...c,
        id: makeId('fc'),
        subjectId: mappedSubjId,
        topicId: mappedTopicId,
      });
    }
  }

  for (const td of incoming.todos) {
    const mappedSubjId = td.subjectId ? subjIdRemap.get(td.subjectId) || td.subjectId : undefined;
    const dup = next.todos.some(
      (x) => x.title.trim().toLowerCase() === td.title.trim().toLowerCase() && x.dueDate === td.dueDate
    );
    if (!dup) {
      next.todos.push({ ...td, id: makeId('todo'), subjectId: mappedSubjId });
    }
  }

  for (const blk of incoming.calendarBlocks) {
    const mappedSubjId = blk.subjectId ? subjIdRemap.get(blk.subjectId) || blk.subjectId : undefined;
    const mappedTopicId = blk.topicId ? topicIdRemap.get(blk.topicId) || blk.topicId : undefined;
    const dup = next.calendarBlocks.some(
      (x) => x.date === blk.date && x.startTime === blk.startTime && x.title === blk.title
    );
    if (!dup) {
      next.calendarBlocks.push({
        ...blk,
        id: makeId('blk'),
        subjectId: mappedSubjId,
        topicId: mappedTopicId,
      });
    }
  }

  next.studyMinutesLogged = Math.max(next.studyMinutesLogged, incoming.studyMinutesLogged);
  next.studyStreakDays = Math.max(next.studyStreakDays, incoming.studyStreakDays);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function buildDeckSnapshot(ws: WorkspaceData): DeckSnapshot {
  const now = Date.now();
  const subjMap = new Map(ws.subjects.map((s) => [s.id, s]));
  const topicMap = new Map(ws.topics.map((t) => [t.id, t]));

  const subjects: DeckSubject[] = ws.subjects.map((s) => ({
    id: s.id,
    n: s.name,
    kind: s.hasTimeline ? 'tl' : 'doc',
    custom: true,
  }));

  const topics: DeckTopic[] = ws.topics.map((t) => {
    const s = subjMap.get(t.subjectId);
    return {
      id: t.id,
      name: t.name,
      label: t.name,
      subjId: t.subjectId,
      subjName: s?.name || 'General',
      views: {
        notes: true,
        timeline: Boolean(s?.hasTimeline || (t.timelineEvents && t.timelineEvents.length > 0)),
        mindmap: false,
      },
    };
  });

  const secMap = new Map<string, DeckSection>();
  const cards: DeckFlashcard[] = ws.flashcards.map((c) => {
    const s = subjMap.get(c.subjectId);
    const t = topicMap.get(c.topicId);
    const secName = (c.sectionName || t?.name || 'Core Deck').trim() || 'Core Deck';
    const secId = `${c.subjectId}__${c.topicId}__${secName}`;
    if (!secMap.has(secId)) {
      secMap.set(secId, {
        id: secId,
        topicId: c.topicId,
        name: secName,
        subjId: c.subjectId,
      });
    }
    return {
      id: c.id,
      secId,
      secName,
      topicId: c.topicId,
      topicName: t?.name || 'Core Topic',
      subjId: c.subjectId,
      subjName: s?.name || 'General',
      q: c.q,
      a: c.a,
      box: c.box,
      flagged: c.flagged,
      due: c.dueAt <= now,
    };
  });

  return {
    subjects,
    topics,
    sections: Array.from(secMap.values()),
    cards,
  };
}

/**
 * Clean SM-2 / Leitner spaced repetition updater.
 * Rating: 1=Again, 2=Hard, 3=Good, 4=Easy
 */
export function applyFlashcardReview(
  card: StudyFlashcard,
  rating: 1 | 2 | 3 | 4
): StudyFlashcard {
  const now = Date.now();
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;
  let nextBox: 1 | 2 | 3 | 4 | 5 = card.box;
  let nextDueAt = now;

  if (rating === 1) {
    nextBox = 1;
    nextDueAt = now; // Immediately due / stay in session queue
  } else if (rating === 2) {
    nextBox = Math.max(1, card.box) as 1 | 2 | 3 | 4 | 5;
    nextDueAt = now + 12 * HOUR;
  } else if (rating === 3) {
    nextBox = Math.min(5, card.box + 1) as 1 | 2 | 3 | 4 | 5;
    const days = [1, 2, 4, 8, 16][nextBox - 1] || 2;
    nextDueAt = now + days * DAY;
  } else {
    nextBox = Math.min(5, card.box + 2) as 1 | 2 | 3 | 4 | 5;
    const days = [2, 4, 7, 14, 30][nextBox - 1] || 7;
    nextDueAt = now + days * DAY;
  }

  return {
    ...card,
    box: nextBox,
    dueAt: nextDueAt,
    lastReviewedAt: now,
  };
}

function timeToMinutes(hhmm: string, fallback: number): number {
  const [h, m] = (hhmm || '').split(':').map(Number);
  if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
  return fallback;
}

function minutesToTime(totalMins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 55, Math.round(totalMins)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, '0');
  const mm = String(clamped % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Builds a balanced spaced-repetition revision timetable ahead of upcoming exams or across active subjects,
 * respecting busy blocks, manual sessions, weekday/weekend start times, and daily study hours.
 */
export function autoGenerateStudySchedule(
  ws: WorkspaceData,
  opts?: {
    sessionsPerDay?: number;
    durationMins?: number;
    daysAhead?: number;
    preferredStartTime?: string;
    weekdayStart?: string;
    weekendStart?: string;
    availHours?: number[];
  }
): CalendarStudyBlock[] {
  if (ws.subjects.length === 0) return ws.calendarBlocks;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  // Preserve done, exam, busy, manually moved/added, or past blocks
  const keepBlocks = ws.calendarBlocks.filter(
    (b) =>
      b.done ||
      b.kind === 'exam' ||
      b.kind === 'busy' ||
      b.manual ||
      b.date < todayIso
  );

  const prefs = ws.plannerPrefs || DEFAULT_PLANNER_PREFS;
  const weekdayStartStr = opts?.weekdayStart || opts?.preferredStartTime || prefs.weekdayStart || '16:30';
  const weekendStartStr = opts?.weekendStart || prefs.weekendStart || '09:30';
  const availHours =
    opts?.availHours && opts.availHours.length === 7 ? opts.availHours : prefs.availHours;
  const durationMins = opts?.durationMins || 25;
  const daysAhead = opts?.daysAhead || 14;

  // Build weighted rotation pool prioritized by proximity of exam date & subject weight
  const pool: Array<{ subject: StudySubject; topic?: StudyTopic; score: number }> = [];
  for (const subj of ws.subjects) {
    let urgency = subj.weight * 2;
    if (subj.examDate) {
      const exTime = new Date(subj.examDate + 'T09:00:00').getTime();
      const daysUntil = Math.max(1, Math.ceil((exTime - today.getTime()) / (24 * 3600 * 1000)));
      if (daysUntil <= 45) {
        urgency += Math.max(1, Math.round(30 / daysUntil));
      }
    }
    const subjTopics = ws.topics.filter((t) => t.subjectId === subj.id && !t.completed);
    const repeatCount = Math.max(1, Math.min(6, urgency));
    for (let r = 0; r < repeatCount; r++) {
      const topic = subjTopics.length > 0 ? subjTopics[r % subjTopics.length] : undefined;
      pool.push({ subject: subj, topic, score: urgency });
    }
  }
  pool.sort((a, b) => b.score - a.score);

  const generated: CalendarStudyBlock[] = [];
  let cursor = 0;

  for (let d = 0; d < daysAhead; d++) {
    const dt = new Date(today.getTime() + d * 24 * 3600 * 1000);
    const dateStr = dt.toISOString().slice(0, 10);
    const dowMon0 = (dt.getDay() + 6) % 7; // Mon=0 .. Sun=6
    const dayHours = availHours[dowMon0] ?? 2;
    const capMins = opts?.sessionsPerDay
      ? opts.sessionsPerDay * durationMins
      : Math.floor(dayHours * 60);

    if (capMins < durationMins) continue;

    // Busy/manual intervals on that day
    const occupied = keepBlocks
      .filter((b) => b.date === dateStr && (b.kind === 'busy' || b.manual || b.kind === 'exam'))
      .map((b) => {
        const s = timeToMinutes(b.startTime, 9 * 60);
        const e = b.endTime ? timeToMinutes(b.endTime, s + b.durationMins) : s + b.durationMins;
        return { s, e };
      })
      .sort((a, b) => a.s - b.s);

    let cursorMin = timeToMinutes(dowMon0 >= 5 ? weekendStartStr : weekdayStartStr, 16 * 60 + 30);
    let usedMins = 0;
    let sessionIdx = 0;
    let lastSubjId = '';

    while (usedMins + durationMins <= capMins && cursorMin + durationMins <= 21 * 60 + 30) {
      // Shift past any busy/manual overlap
      for (const iv of occupied) {
        if (cursorMin < iv.e && cursorMin + durationMins > iv.s) {
          cursorMin = iv.e + 5;
        }
      }
      if (cursorMin + durationMins > 21 * 60 + 30) break;

      // Interleave subjects when possible
      let pick = pool[cursor % pool.length];
      if (ws.subjects.length > 1 && pick.subject.id === lastSubjId) {
        const altIdx = pool.findIndex((p, idx) => idx >= cursor % pool.length && p.subject.id !== lastSubjId);
        if (altIdx >= 0) pick = pool[altIdx];
      }
      cursor += 1;
      lastSubjId = pick.subject.id;

      // Check exam proximity for past-paper blocks in final 9 days
      let isExamClose = false;
      if (pick.subject.examDate) {
        const exTime = new Date(pick.subject.examDate + 'T09:00:00').getTime();
        const daysLeft = Math.ceil((exTime - dt.getTime()) / (24 * 3600 * 1000));
        if (daysLeft >= 0 && daysLeft <= 9) isExamClose = true;
      }

      const kind: CalendarStudyBlock['kind'] =
        isExamClose && sessionIdx % 2 === 0
          ? 'past-paper'
          : sessionIdx % 3 === 1
          ? 'flashcards'
          : 'revision';

      generated.push({
        id: makeId('blk'),
        date: dateStr,
        startTime: minutesToTime(cursorMin),
        durationMins,
        title:
          kind === 'past-paper'
            ? `${pick.subject.name}: Exam questions`
            : pick.topic
            ? `${pick.subject.name}: ${pick.topic.name}`
            : `${pick.subject.name} ${kind === 'flashcards' ? 'Flashcards' : 'Revision'}`,
        subjectId: pick.subject.id,
        topicId: pick.topic?.id,
        kind,
        done: false,
      });

      sessionIdx += 1;
      usedMins += durationMins;
      cursorMin += durationMins + (sessionIdx % 4 === 0 ? 15 : 5);
    }
  }

  return [...keepBlocks, ...generated];
}

export function addLoggedStudyMinutes(ws: WorkspaceData, minutes: number): WorkspaceData {
  if (minutes <= 0) return ws;
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
  let nextStreak = ws.studyStreakDays || 0;
  if (ws.lastStudyDate === today) {
    nextStreak = Math.max(1, nextStreak);
  } else if (ws.lastStudyDate === yesterday) {
    nextStreak += 1;
  } else {
    nextStreak = 1;
  }
  return {
    ...ws,
    studyMinutesLogged: ws.studyMinutesLogged + minutes,
    studyStreakDays: nextStreak,
    lastStudyDate: today,
    updatedAt: new Date().toISOString(),
  };
}
