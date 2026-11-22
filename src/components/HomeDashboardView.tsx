import {
  FormEvent,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Globe,
  GraduationCap,
  GripVertical,
  HelpCircle,
  Layers,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  StickyNote,
  Target,
  Timer,
  Trash2,
  TrendingUp,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { isNoteEmpty } from '../lib/noteFormat';
import { parseBackupJsonToWorkspace } from '../lib/smartImporter';
import {
  addLoggedStudyMinutes,
  DEFAULT_HOME_LAYOUT,
  getUnifiedExamsForWorkspace,
  homeWidgetsFromLayout,
  makeId,
  mergeWorkspaces,
  UnifiedExamItem,
} from '../lib/workspaceStore';
import {
  CalendarStudyBlock,
  DailyStudyTaskItem,
  HomeWidgetId,
  HomeWidgetLayoutItem,
  LiveTimerState,
  PlannerSubTab,
  TodoTaskItem,
  WorkspaceData,
  WorkspaceTab,
} from '../types';

interface HomeDashboardViewProps {
  workspace: WorkspaceData;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onNavigate: (
    tab: WorkspaceTab,
    opts?: {
      subjectId?: string;
      topicId?: string;
      plannerTab?: PlannerSubTab;
      openQuickAdd?: boolean;
      communityTypeFilter?: 'all' | 'notes' | 'flashcards' | 'subject';
      shareCode?: string;
    }
  ) => void;
  onOpenImport: () => void;
  liveTimer: LiveTimerState;
  timerRemainingSec: number;
  timerDurationMins: number;
  onToggleTimer: () => void;
  onResetTimer: (mins?: number) => void;
}

type WidgetCategory =
  | 'Home & Tasks'
  | 'Progress & Charts'
  | 'Flashcards & Notes'
  | 'Subjects & Calendar';

interface WidgetMeta {
  id: HomeWidgetId;
  label: string;
  desc: string;
  category: WidgetCategory;
  defaultCols: number;
}

const WIDGET_CATALOG: WidgetMeta[] = [
  // Home & Tasks
  {
    id: 'todayOverview',
    label: "Today's Overview",
    desc: 'Daily revision progress bar, mins studied today, exam countdown & streak.',
    category: 'Home & Tasks',
    defaultCols: 12,
  },
  {
    id: 'todayTasks',
    label: "Today's Revision Tasks",
    desc: 'Auto-picked weakest topics to recall + confidence rating buttons & past papers.',
    category: 'Home & Tasks',
    defaultCols: 8,
  },
  {
    id: 'timer',
    label: 'Quick Session & Focus Timer',
    desc: 'Live countdown timer with 25m / 50m focus presets and Pomodoro launch.',
    category: 'Home & Tasks',
    defaultCols: 4,
  },
  {
    id: 'todos',
    label: 'To-Do List',
    desc: 'Quick-add homework, exam & revision tasks with subject links.',
    category: 'Home & Tasks',
    defaultCols: 6,
  },
  {
    id: 'scratchpad',
    label: 'Quick Scratchpad',
    desc: 'Auto-saving notes pad for formulas, quotes, dates & quick recall points.',
    category: 'Home & Tasks',
    defaultCols: 6,
  },
  {
    id: 'studyGuide',
    label: 'How to Revise Guide',
    desc: 'Evidence-based spaced retrieval, interleaving & Pomodoro tips.',
    category: 'Home & Tasks',
    defaultCols: 6,
  },

  // Progress & Charts
  {
    id: 'dailyGoal',
    label: 'Daily Study Target',
    desc: 'Selectable daily minutes goal, streak tracker & +15m/+25m quick-log buttons.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'progOverview',
    label: 'Readiness Overview',
    desc: 'Next exam countdown, syllabus readiness % & total revision hours KPIs.',
    category: 'Progress & Charts',
    defaultCols: 12,
  },
  {
    id: 'progWeek',
    label: 'This Week Study Chart',
    desc: 'Mon–Sun bar chart comparing logged minutes against your daily planned hours.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'progHeatmap',
    label: '10-Week Consistency Heatmap',
    desc: '70-day revision consistency grid showing daily study intensity.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'progPace',
    label: 'Revision Pace Check',
    desc: 'Topics left to master vs days to earliest exam + daily topics/day target.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'progTodo',
    label: 'To-Do List Progress',
    desc: 'Completion %, overdue alerts & Exam / Homework / Other category breakdown.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'progNumbers',
    label: 'Study Numbers & Streaks',
    desc: 'Total sessions, average & longest session, current streak & total hours.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'pastPapers',
    label: 'Past Paper Scores',
    desc: 'Log timed mock/past-paper marks and track percentage scores by subject.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'sessionLog',
    label: 'Study Session Log',
    desc: 'Quick-log custom revision sessions and review your recent study history.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'progHours',
    label: 'Daily Study Hours Budget',
    desc: 'Edit Mon–Sun target hours used by the smart Auto-Plan calendar.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'subjectBreakdown',
    label: 'Revision Time by Subject',
    desc: 'Proportional breakdown of logged minutes per subject with 1-click +25m logging.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },
  {
    id: 'gradeTargetTracker',
    label: 'Target Grades & Mock Readiness',
    desc: 'Compare syllabus readiness %, mock paper averages, and editable target grades.',
    category: 'Progress & Charts',
    defaultCols: 6,
  },

  // Flashcards & Notes
  {
    id: 'dueCards',
    label: 'Flashcards Snapshot',
    desc: 'Due now, mastered, weak & flagged cards count with mastery bar.',
    category: 'Flashcards & Notes',
    defaultCols: 6,
  },
  {
    id: 'flashcardBreakdown',
    label: 'Flashcards Progress & Boxes',
    desc: 'Leitner Box 1–5 counts plus per-subject deck mastery rows.',
    category: 'Flashcards & Notes',
    defaultCols: 6,
  },
  {
    id: 'quickFlashcards',
    label: 'Quick Flashcard Review',
    desc: 'Flip & rate Leitner flashcards directly on Home without switching tabs.',
    category: 'Flashcards & Notes',
    defaultCols: 6,
  },
  {
    id: 'quickNotes',
    label: 'Study Notes Finder & Recents',
    desc: 'Search structured notes across subjects and jump straight into editing.',
    category: 'Flashcards & Notes',
    defaultCols: 6,
  },
  {
    id: 'liveQuiz',
    label: 'Live Quiz Arena',
    desc: 'Host or join real-time multiplayer flashcard battles with semantic AI grading.',
    category: 'Flashcards & Notes',
    defaultCols: 6,
  },
  {
    id: 'communityNotes',
    label: 'Community & Shared Notes',
    desc: 'Open a 6-character share code or browse Save My Exams-style shared notes.',
    category: 'Flashcards & Notes',
    defaultCols: 6,
  },

  // Subjects & Calendar
  {
    id: 'mastery',
    label: 'Subjects (Weakest First)',
    desc: 'Stacked confidence breakdown per subject sorted weakest-first.',
    category: 'Subjects & Calendar',
    defaultCols: 12,
  },
  {
    id: 'weakTopics',
    label: 'Weakest Topics Radar',
    desc: 'Top unstarted & weak subtopics with 1-click confidence cycle & Notes jump.',
    category: 'Subjects & Calendar',
    defaultCols: 6,
  },
  {
    id: 'topicChecklist',
    label: 'Syllabus Confidence Checklist',
    desc: 'Filter topics by subject & confidence rating with instant 0–3 updates.',
    category: 'Subjects & Calendar',
    defaultCols: 6,
  },
  {
    id: 'examCountdowns',
    label: 'Exam & Goal Countdowns',
    desc: 'Subject exam countdowns plus custom mock, coursework, or test deadlines.',
    category: 'Subjects & Calendar',
    defaultCols: 6,
  },
  {
    id: 'examTimetable',
    label: 'Exam Timetable & Readiness',
    desc: 'Full chronological exam papers schedule with subject readiness & start-focus action.',
    category: 'Subjects & Calendar',
    defaultCols: 6,
  },
  {
    id: 'schedule',
    label: "Today's Schedule",
    desc: 'Planned revision blocks & exams for today with 1-click completion checkboxes.',
    category: 'Subjects & Calendar',
    defaultCols: 6,
  },
  {
    id: 'miniCalendar',
    label: '7-Day Mini Calendar',
    desc: 'Week-ahead strip showing upcoming exams and planned study sessions.',
    category: 'Subjects & Calendar',
    defaultCols: 6,
  },
  {
    id: 'fullCalendar',
    label: 'Full-Size Interactive Calendar',
    desc: 'Complete Month & Week calendar with yellow/black exam boxes, due tasks, day inspector & quick-add.',
    category: 'Subjects & Calendar',
    defaultCols: 12,
  },
];

const CATEGORY_TABS: Array<'All' | WidgetCategory> = [
  'All',
  'Home & Tasks',
  'Progress & Charts',
  'Flashcards & Notes',
  'Subjects & Calendar',
];

const COL_SPAN_CLASS: Record<number, string> = {
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
  7: 'lg:col-span-7',
  8: 'lg:col-span-8',
  9: 'lg:col-span-9',
  10: 'lg:col-span-10',
  11: 'lg:col-span-11',
  12: 'lg:col-span-12',
};

const WEEK_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function isoOffset(daysDelta: number): string {
  const dt = new Date();
  dt.setHours(12, 0, 0, 0);
  dt.setDate(dt.getDate() + daysDelta);
  return dt.toISOString().slice(0, 10);
}

function daysUntilDate(dateStr: string): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const target = new Date(`${dateStr}T09:00:00`).getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target - now.getTime()) / (24 * 3600 * 1000));
}

function formatShortDate(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function buildSmartDailyTasks(ws: WorkspaceData, limit = 4): DailyStudyTaskItem[] {
  const candidates: Array<{
    subjectId: string;
    topicId: string;
    score: number;
  }> = [];

  for (const subj of ws.subjects) {
    const subjDays = daysUntilDate(subj.examDate);
    const urgency = subjDays !== null && subjDays >= 0 && subjDays <= 14 ? 1.5 : 1;
    const topics = ws.topics.filter((t) => t.subjectId === subj.id && !t.completed && (t.confidence ?? 0) < 3);
    for (const tp of topics) {
      const conf = tp.confidence ?? 0;
      const sc = ((3 - conf) * 2 + (conf === 0 ? 1.5 : 0)) * (subj.weight || 2) * urgency;
      candidates.push({ subjectId: subj.id, topicId: tp.id, score: sc });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  // Interleave across subjects
  const picked: DailyStudyTaskItem[] = [];
  const usedTopics = new Set<string>();
  let lastSubjId = '';

  while (picked.length < limit && candidates.length > usedTopics.size) {
    let next = candidates.find(
      (c) => !usedTopics.has(c.topicId) && c.subjectId !== lastSubjId
    );
    if (!next) {
      next = candidates.find((c) => !usedTopics.has(c.topicId));
    }
    if (!next) break;
    usedTopics.add(next.topicId);
    lastSubjId = next.subjectId;
    picked.push({
      id: makeId('dt'),
      subjectId: next.subjectId,
      topicId: next.topicId,
      kind: 'recall',
      done: 0,
    });
  }

  // Add 1 exam-paper practice task if user has subjects and >= 3 items
  if (ws.subjects.length > 0 && picked.length >= 2) {
    const targetSubj = ws.subjects[0];
    picked.splice(Math.min(2, picked.length), 0, {
      id: makeId('dt'),
      subjectId: targetSubj.id,
      kind: 'paper',
      done: 0,
    });
  }

  return picked;
}

export function HomeDashboardView({
  workspace,
  onUpdateWorkspace,
  onNavigate,
  onOpenImport,
  liveTimer,
  timerRemainingSec,
  timerDurationMins,
  onToggleTimer,
  onResetTimer,
}: HomeDashboardViewProps) {
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [trayCategory, setTrayCategory] = useState<'All' | WidgetCategory>('All');
  const [dragWidgetId, setDragWidgetId] = useState<HomeWidgetId | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<HomeWidgetId | null>(null);

  // Widget interactive states
  const [quickTodoText, setQuickTodoText] = useState('');
  const [quickTodoSubj, setQuickTodoSubj] = useState('');

  const [deadlineTitle, setDeadlineTitle] = useState('');
  const [deadlineDate, setDeadlineDate] = useState(() => isoOffset(14));

  const [paperSubjId, setPaperSubjId] = useState('');
  const [paperName, setPaperName] = useState('Past Paper 1');
  const [paperMark, setPaperMark] = useState('');
  const [paperTotal, setPaperTotal] = useState('100');

  const [logSubjId, setLogSubjId] = useState('');
  const [logMins, setLogMins] = useState('25');
  const [logNote, setLogNote] = useState('');

  const [dailyPaperMarks, setDailyPaperMarks] = useState<Record<string, { mark: string; total: string }>>({});
  const [addDailySubjId, setAddDailySubjId] = useState('');
  const [addDailyTopicId, setAddDailyTopicId] = useState('');

  const [shareCodeInput, setShareCodeInput] = useState('');
  const [widgetSearch, setWidgetSearch] = useState('');

  // Full-size calendar widget state
  const [fullCalMode, setFullCalMode] = useState<'month' | 'week'>('month');
  const [fullCalRefDate, setFullCalRefDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fullCalSelectedDay, setFullCalSelectedDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [fullCalQuickTitle, setFullCalQuickTitle] = useState('');
  const [fullCalQuickSubjId, setFullCalQuickSubjId] = useState('');
  const [fullCalQuickTime, setFullCalQuickTime] = useState('16:30');
  const [fullCalQuickMins, setFullCalQuickMins] = useState(25);

  // Quick flashcard widget state
  const [fcWidgetSubjId, setFcWidgetSubjId] = useState('ALL');
  const [fcWidgetDueOnly, setFcWidgetDueOnly] = useState(true);
  const [fcWidgetIdx, setFcWidgetIdx] = useState(0);
  const [fcWidgetFlipped, setFcWidgetFlipped] = useState(false);

  // Quick notes & syllabus checklist widget states
  const [notesWidgetQuery, setNotesWidgetQuery] = useState('');
  const [notesWidgetSubjId, setNotesWidgetSubjId] = useState('ALL');
  const [checklistSubjId, setChecklistSubjId] = useState('');
  const [checklistFilter, setChecklistFilter] = useState<'all' | '0' | '1' | '2' | '3'>('all');

  const [importingHowes, setImportingHowes] = useState(false);
  const [howesImportMsg, setHowesImportMsg] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleImportHowesNotes = async () => {
    setImportingHowes(true);
    setHowesImportMsg(null);
    try {
      const resp = await fetch('/assets/aistudio/revision-backup-2026-11-17_b59c0c72.json');
      if (!resp.ok) {
        throw new Error(`Could not load backup file (HTTP ${resp.status}).`);
      }
      const raw = await resp.text();
      const bundle = parseBackupJsonToWorkspace(raw);
      if (!bundle) {
        throw new Error('Failed to parse backup file.');
      }
      onUpdateWorkspace((prev) => mergeWorkspaces(prev, bundle.workspace));
      setHowesImportMsg({
        ok: true,
        msg: `Imported Howe's notes: ${bundle.counts.notes} structured notes, ${bundle.counts.flashcards} flashcards, and ${bundle.counts.timelines} timeline nodes.`,
      });
    } catch (err) {
      setHowesImportMsg({
        ok: false,
        msg: err instanceof Error ? err.message : "Failed to import Howe's notes.",
      });
    } finally {
      setImportingHowes(false);
    }
  };

  const gridRef = useRef<HTMLDivElement | null>(null);
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const nowMs = Date.now();

  // Keep default selectors synced when subjects change
  useEffect(() => {
    if (!paperSubjId && workspace.subjects[0]) setPaperSubjId(workspace.subjects[0].id);
    if (!addDailySubjId && workspace.subjects[0]) setAddDailySubjId(workspace.subjects[0].id);
    if (!checklistSubjId && workspace.subjects[0]) setChecklistSubjId(workspace.subjects[0].id);
  }, [workspace.subjects, paperSubjId, addDailySubjId, checklistSubjId]);

  const layout: HomeWidgetLayoutItem[] = useMemo(
    () =>
      workspace.homeLayout && workspace.homeLayout.length >= 0
        ? workspace.homeLayout
        : DEFAULT_HOME_LAYOUT.map((w) => ({ ...w })),
    [workspace.homeLayout]
  );

  const activeWidgetIds = useMemo(() => new Set(layout.map((w) => w.id)), [layout]);

  const subjectMap = useMemo(
    () => new Map(workspace.subjects.map((s) => [s.id, s])),
    [workspace.subjects]
  );
  const topicMap = useMemo(
    () => new Map(workspace.topics.map((t) => [t.id, t])),
    [workspace.topics]
  );

  const dueCount = useMemo(
    () => workspace.flashcards.filter((c) => c.dueAt <= nowMs).length,
    [workspace.flashcards, nowMs]
  );
  const masteredCardsCount = useMemo(
    () => workspace.flashcards.filter((c) => c.box >= 4).length,
    [workspace.flashcards]
  );
  const weakCardsCount = useMemo(
    () => workspace.flashcards.filter((c) => c.box === 1).length,
    [workspace.flashcards]
  );
  const learningCardsCount = useMemo(
    () => workspace.flashcards.filter((c) => c.box === 2 || c.box === 3).length,
    [workspace.flashcards]
  );
  const flaggedCount = useMemo(
    () => workspace.flashcards.filter((c) => c.flagged).length,
    [workspace.flashcards]
  );

  const boxCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    workspace.flashcards.forEach((c) => {
      const idx = Math.max(0, Math.min(4, (c.box || 1) - 1));
      counts[idx] += 1;
    });
    return counts;
  }, [workspace.flashcards]);

  const unifiedExams = useMemo(
    () => getUnifiedExamsForWorkspace(workspace.subjects, workspace.calendarBlocks),
    [workspace.subjects, workspace.calendarBlocks]
  );

  const examsByDate = useMemo(() => {
    const map = new Map<string, UnifiedExamItem[]>();
    for (const ex of unifiedExams) {
      const list = map.get(ex.date) || [];
      list.push(ex);
      map.set(ex.date, list);
    }
    return map;
  }, [unifiedExams]);

  const nonExamBlocksByDate = useMemo(() => {
    const map = new Map<string, CalendarStudyBlock[]>();
    for (const b of workspace.calendarBlocks) {
      if (b.kind === 'exam') continue;
      const list = map.get(b.date) || [];
      list.push(b);
      map.set(b.date, list);
    }
    map.forEach((arr) => arr.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    return map;
  }, [workspace.calendarBlocks]);

  const todosByDate = useMemo(() => {
    const map = new Map<string, TodoTaskItem[]>();
    for (const t of workspace.todos) {
      if (!t.dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate)) continue;
      const list = map.get(t.dueDate) || [];
      list.push(t);
      map.set(t.dueDate, list);
    }
    map.forEach((arr) =>
      arr.sort((a, b) => Number(a.done) - Number(b.done) || b.priority - a.priority)
    );
    return map;
  }, [workspace.todos]);

  const todaysBlocks = useMemo(
    () =>
      workspace.calendarBlocks
        .filter((b) => b.date === todayStr && b.kind !== 'exam')
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [workspace.calendarBlocks, todayStr]
  );

  const studyLog = useMemo(() => workspace.studyLog || [], [workspace.studyLog]);

  const minsByDate = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of studyLog) {
      map.set(entry.date, (map.get(entry.date) || 0) + (entry.mins || 0));
    }
    return map;
  }, [studyLog]);

  const todayLoggedMins = useMemo(() => {
    const loggedToday = minsByDate.get(todayStr) || 0;
    const blockDoneMins = todaysBlocks
      .filter((b) => b.done)
      .reduce((acc, b) => acc + (b.durationMins || 25), 0);
    if (loggedToday > 0) return loggedToday;
    if (blockDoneMins > 0) return blockDoneMins;
    return workspace.lastStudyDate === todayStr
      ? Math.min(240, workspace.studyMinutesLogged)
      : 0;
  }, [minsByDate, todayStr, todaysBlocks, workspace.lastStudyDate, workspace.studyMinutesLogged]);

  // All upcoming countdowns (unified deduplicated exams + custom deadlines)
  const allCountdowns = useMemo(() => {
    const list: Array<{
      id: string;
      title: string;
      date: string;
      days: number;
      color?: string;
      custom: boolean;
    }> = [];

    for (const ex of unifiedExams) {
      const d = daysUntilDate(ex.date);
      if (d !== null && d >= 0) {
        list.push({
          id: ex.id,
          title: ex.displayLabel,
          date: ex.date,
          days: d,
          color: ex.subjectColor,
          custom: false,
        });
      }
    }

    for (const cd of workspace.customCountdowns || []) {
      const d = daysUntilDate(cd.date);
      if (d !== null && d >= 0) {
        list.push({
          id: cd.id,
          title: cd.title,
          date: cd.date,
          days: d,
          custom: true,
        });
      }
    }

    return list.sort((a, b) => a.days - b.days);
  }, [unifiedExams, workspace.customCountdowns]);

  const activeTodos = useMemo(
    () =>
      workspace.todos
        .filter((t) => !t.done)
        .sort(
          (a, b) =>
            b.priority - a.priority ||
            (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
        )
        .slice(0, 6),
    [workspace.todos]
  );

  // Topics & confidence metrics
  const topicMetrics = useMemo(() => {
    let total = 0;
    let mastered = 0;
    let alright = 0;
    let weak = 0;
    let unstarted = 0;
    let sumConf = 0;

    for (const t of workspace.topics) {
      total += 1;
      const conf = t.confidence ?? (t.completed ? 3 : 0);
      sumConf += conf;
      if (conf === 3) mastered += 1;
      else if (conf === 2) alright += 1;
      else if (conf === 1) weak += 1;
      else unstarted += 1;
    }
    const readinessPct = total > 0 ? Math.round((sumConf / (total * 3)) * 100) : 0;
    const remaining = total - mastered;
    return { total, mastered, alright, weak, unstarted, readinessPct, remaining };
  }, [workspace.topics]);

  const subjectStats = useMemo(() => {
    return workspace.subjects
      .map((subj) => {
        const topics = workspace.topics.filter((t) => t.subjectId === subj.id);
        let c3 = 0;
        let c2 = 0;
        let c1 = 0;
        let c0 = 0;
        let sum = 0;
        for (const t of topics) {
          const conf = t.confidence ?? (t.completed ? 3 : 0);
          sum += conf;
          if (conf === 3) c3 += 1;
          else if (conf === 2) c2 += 1;
          else if (conf === 1) c1 += 1;
          else c0 += 1;
        }
        const readiness = topics.length > 0 ? Math.round((sum / (topics.length * 3)) * 100) : 0;
        const cards = workspace.flashcards.filter((c) => c.subjectId === subj.id);
        const masteredCards = cards.filter((c) => c.box >= 4).length;
        const learningCards = cards.filter((c) => c.box === 2 || c.box === 3).length;
        return {
          subj,
          topicCount: topics.length,
          c3,
          c2,
          c1,
          c0,
          readiness,
          cardCount: cards.length,
          masteredCards,
          learningCards,
        };
      })
      .sort((a, b) => a.readiness - b.readiness);
  }, [workspace.subjects, workspace.topics, workspace.flashcards]);

  // Daily study tasks (auto-generate cleanly if none yet for today and user has subjects)
  const dailyTaskItems: DailyStudyTaskItem[] = useMemo(() => {
    if (
      workspace.dailyStudyTasks &&
      workspace.dailyStudyTasks.date === todayStr
    ) {
      return workspace.dailyStudyTasks.items.filter((it) => subjectMap.has(it.subjectId));
    }
    return buildSmartDailyTasks(workspace, 4);
  }, [workspace, todayStr, subjectMap]);

  // Helper setters
  const setHomeLayout = (updater: (prev: HomeWidgetLayoutItem[]) => HomeWidgetLayoutItem[]) => {
    onUpdateWorkspace((prev) => {
      const current = prev.homeLayout ?? DEFAULT_HOME_LAYOUT.map((w) => ({ ...w }));
      const nextLayout = updater(current);
      return {
        ...prev,
        homeLayout: nextLayout,
        homeWidgets: homeWidgetsFromLayout(nextLayout),
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const addWidget = (id: HomeWidgetId) => {
    const meta = WIDGET_CATALOG.find((m) => m.id === id);
    setHomeLayout((prev) => {
      if (prev.some((w) => w.id === id)) return prev;
      return [...prev, { id, cols: meta?.defaultCols || 6, h: null }];
    });
  };

  const removeWidget = (id: HomeWidgetId) => {
    setHomeLayout((prev) => prev.filter((w) => w.id !== id));
  };

  const moveWidget = (index: number, delta: -1 | 1) => {
    setHomeLayout((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const reorderWidgets = (fromId: HomeWidgetId, toId: HomeWidgetId) => {
    if (fromId === toId) return;
    setHomeLayout((prev) => {
      const fromIdx = prev.findIndex((w) => w.id === fromId);
      const toIdx = prev.findIndex((w) => w.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, moved);
      return copy;
    });
  };

  const updateWidgetSize = (
    id: HomeWidgetId,
    patch: { cols?: number; h?: number | null }
  ) => {
    setHomeLayout((prev) =>
      prev.map((w) =>
        w.id === id
          ? {
              ...w,
              cols:
                patch.cols !== undefined
                  ? Math.max(3, Math.min(12, Math.round(patch.cols)))
                  : w.cols,
              h:
                patch.h !== undefined
                  ? patch.h === null
                    ? null
                    : Math.max(180, Math.min(1100, Math.round(patch.h)))
                  : w.h,
            }
          : w
      )
    );
  };

  const handleResetWidgets = () => {
    setHomeLayout(() => DEFAULT_HOME_LAYOUT.map((w) => ({ ...w })));
  };

  // Edge / corner resize handler
  const startResize = (
    e: ReactPointerEvent<HTMLDivElement>,
    item: HomeWidgetLayoutItem,
    mode: 'width' | 'both' | 'height'
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const cardEl = (e.currentTarget as HTMLElement).closest('section') as HTMLElement | null;
    const gridEl = gridRef.current;
    if (!cardEl || !gridEl) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const startCols = item.cols;
    const startH = cardEl.getBoundingClientRect().height;
    const gridWidth = gridEl.getBoundingClientRect().width || 1100;
    const colWidth = gridWidth / 12;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const nextCols =
        mode === 'height'
          ? item.cols
          : Math.max(3, Math.min(12, Math.round(startCols + dx / colWidth)));
      const nextH =
        mode === 'both' || mode === 'height'
          ? Math.max(190, Math.min(1100, Math.round(startH + dy)))
          : item.h;
      updateWidgetSize(item.id, {
        cols: nextCols,
        ...(mode === 'both' || mode === 'height' ? { h: nextH } : {}),
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // Workspace mutations from widgets
  const handleQuickAddTodo = (e: FormEvent) => {
    e.preventDefault();
    const title = quickTodoText.trim();
    if (!title) return;
    onUpdateWorkspace((prev) => ({
      ...prev,
      todos: [
        {
          id: makeId('todo'),
          title,
          subjectId: quickTodoSubj || undefined,
          dueDate: todayStr,
          priority: 2,
          done: false,
          category: /\b(exam|mock|test|quiz|paper)\b/i.test(title)
            ? 'exam'
            : /\b(hw|homework|essay|sheet|assignment)\b/i.test(title)
            ? 'hw'
            : 'oth',
          createdAt: new Date().toISOString(),
        },
        ...prev.todos,
      ],
      updatedAt: new Date().toISOString(),
    }));
    setQuickTodoText('');
  };

  const toggleTodoDone = (todoId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      todos: prev.todos.map((t) =>
        t.id === todoId
          ? {
              ...t,
              done: !t.done,
              doneAt: !t.done ? new Date().toISOString() : undefined,
            }
          : t
      ),
      updatedAt: new Date().toISOString(),
    }));
  };

  const toggleBlockDone = (blockId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      calendarBlocks: prev.calendarBlocks.map((b) =>
        b.id === blockId ? { ...b, done: !b.done } : b
      ),
      updatedAt: new Date().toISOString(),
    }));
  };

  const handleRateDailyTask = (item: DailyStudyTaskItem, rating: 1 | 2 | 3) => {
    onUpdateWorkspace((prev) => {
      const currentItems =
        prev.dailyStudyTasks?.date === todayStr
          ? prev.dailyStudyTasks.items
          : buildSmartDailyTasks(prev, 4);
      const nextItems = currentItems.map((it) =>
        it.id === item.id ? { ...it, done: rating } : it
      );
      const nextTopics = item.topicId
        ? prev.topics.map((tp) =>
            tp.id === item.topicId
              ? { ...tp, confidence: rating, completed: rating === 3 }
              : tp
          )
        : prev.topics;

      const base = {
        ...prev,
        topics: nextTopics,
        dailyStudyTasks: { date: todayStr, items: nextItems },
      };
      return addLoggedStudyMinutes(base, 15, {
        subjectId: item.subjectId,
        kind: 'recall',
        note: item.topicId ? topicMap.get(item.topicId)?.name : 'Daily recall',
      });
    });
  };

  const handleCompleteDailyPaper = (item: DailyStudyTaskItem) => {
    const entry = dailyPaperMarks[item.id];
    const markNum = Number(entry?.mark);
    const totalNum = Number(entry?.total);
    onUpdateWorkspace((prev) => {
      const currentItems =
        prev.dailyStudyTasks?.date === todayStr
          ? prev.dailyStudyTasks.items
          : buildSmartDailyTasks(prev, 4);
      const nextItems = currentItems.map((it) =>
        it.id === item.id ? { ...it, done: 4 } : it
      );
      const nextScores = [...(prev.paperScores || [])];
      if (totalNum > 0 && Number.isFinite(markNum) && markNum >= 0) {
        nextScores.push({
          id: makeId('ps'),
          subjectId: item.subjectId,
          paper: 'Timed exam questions',
          mark: markNum,
          total: totalNum,
          date: todayStr,
        });
      }
      const base = {
        ...prev,
        paperScores: nextScores,
        dailyStudyTasks: { date: todayStr, items: nextItems },
      };
      return addLoggedStudyMinutes(base, 25, {
        subjectId: item.subjectId,
        kind: 'manual',
        note: 'Past-paper questions',
      });
    });
  };

  const handleRemoveDailyTask = (itemId: string) => {
    onUpdateWorkspace((prev) => {
      const currentItems =
        prev.dailyStudyTasks?.date === todayStr
          ? prev.dailyStudyTasks.items
          : buildSmartDailyTasks(prev, 4);
      return {
        ...prev,
        dailyStudyTasks: {
          date: todayStr,
          items: currentItems.filter((it) => it.id !== itemId),
        },
      };
    });
  };

  const handleRefreshDailyTasks = () => {
    onUpdateWorkspace((prev) => {
      const doneItems =
        prev.dailyStudyTasks?.date === todayStr
          ? prev.dailyStudyTasks.items.filter((it) => it.done > 0)
          : [];
      const doneTopics = new Set(doneItems.map((it) => it.topicId).filter(Boolean));
      const fresh = buildSmartDailyTasks(prev, 4).filter(
        (it) => !it.topicId || !doneTopics.has(it.topicId)
      );
      return {
        ...prev,
        dailyStudyTasks: {
          date: todayStr,
          items: [...doneItems, ...fresh],
        },
      };
    });
  };

  const handleAddDailyTask = (e: FormEvent) => {
    e.preventDefault();
    if (!addDailySubjId) return;
    onUpdateWorkspace((prev) => {
      const currentItems =
        prev.dailyStudyTasks?.date === todayStr
          ? prev.dailyStudyTasks.items
          : buildSmartDailyTasks(prev, 4);
      const isPaper = addDailyTopicId === '__paper__';
      const newItem: DailyStudyTaskItem = {
        id: makeId('dt'),
        subjectId: addDailySubjId,
        topicId: !isPaper && addDailyTopicId ? addDailyTopicId : undefined,
        kind: isPaper ? 'paper' : 'recall',
        done: 0,
      };
      return {
        ...prev,
        dailyStudyTasks: {
          date: todayStr,
          items: [...currentItems, newItem],
        },
      };
    });
  };

  const handleAddDeadline = (e: FormEvent) => {
    e.preventDefault();
    const title = deadlineTitle.trim();
    if (!title || !deadlineDate) return;
    onUpdateWorkspace((prev) => ({
      ...prev,
      customCountdowns: [
        ...(prev.customCountdowns || []),
        { id: makeId('cd'), title, date: deadlineDate },
      ],
    }));
    setDeadlineTitle('');
  };

  const handleAddPaperScore = (e: FormEvent) => {
    e.preventDefault();
    const mark = Number(paperMark);
    const total = Number(paperTotal);
    if (!paperName.trim() || !Number.isFinite(mark) || !Number.isFinite(total) || total <= 0) {
      return;
    }
    onUpdateWorkspace((prev) => ({
      ...prev,
      paperScores: [
        ...(prev.paperScores || []),
        {
          id: makeId('ps'),
          subjectId: paperSubjId || undefined,
          paper: paperName.trim(),
          mark: Math.max(0, mark),
          total: Math.max(1, total),
          date: todayStr,
        },
      ],
    }));
    setPaperMark('');
  };

  const handleAddManualSession = (e: FormEvent) => {
    e.preventDefault();
    const mins = Math.max(1, Math.min(480, Math.round(Number(logMins) || 0)));
    if (!mins) return;
    onUpdateWorkspace((prev) =>
      addLoggedStudyMinutes(prev, mins, {
        subjectId: logSubjId || undefined,
        kind: 'manual',
        note: logNote.trim() || undefined,
      })
    );
    setLogNote('');
  };

  const cycleTopicConfidence = (topicId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      topics: prev.topics.map((tp) => {
        if (tp.id !== topicId) return tp;
        const curr = tp.confidence ?? (tp.completed ? 3 : 0);
        const next = ((curr + 1) % 4) as 0 | 1 | 2 | 3;
        return { ...tp, confidence: next, completed: next === 3 };
      }),
    }));
  };

  const mm = String(Math.floor(timerRemainingSec / 60)).padStart(2, '0');
  const ss = String(timerRemainingSec % 60).padStart(2, '0');
  const dailyGoalMins = workspace.dailyGoalMinutes || 60;
  const dailyGoalPct = Math.min(100, Math.round((todayLoggedMins / dailyGoalMins) * 100));

  const unusedCatalog = useMemo(() => {
    const q = widgetSearch.trim().toLowerCase();
    return WIDGET_CATALOG.filter((m) => {
      if (activeWidgetIds.has(m.id)) return false;
      if (trayCategory !== 'All' && m.category !== trayCategory) return false;
      if (q && !m.label.toLowerCase().includes(q) && !m.desc.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [activeWidgetIds, trayCategory, widgetSearch]);

  const handleAddQuickCalendarSession = (e: FormEvent) => {
    e.preventDefault();
    if (!fullCalSelectedDay) return;
    const subj = fullCalQuickSubjId ? subjectMap.get(fullCalQuickSubjId) : undefined;
    const title = fullCalQuickTitle.trim() || (subj ? `${subj.name}: Active recall` : 'Revision session');
    const newBlock: CalendarStudyBlock = {
      id: makeId('blk'),
      date: fullCalSelectedDay,
      startTime: fullCalQuickTime || '16:30',
      durationMins: Math.max(10, Math.min(240, Number(fullCalQuickMins) || 25)),
      title,
      ...(subj ? { subjectId: subj.id } : {}),
      kind: 'revision',
      done: false,
      manual: true,
    };
    onUpdateWorkspace((prev) => ({
      ...prev,
      calendarBlocks: [...prev.calendarBlocks, newBlock],
      updatedAt: new Date().toISOString(),
    }));
    setFullCalQuickTitle('');
  };

  const handleRateQuickFlashcard = (cardId: string, grade: 'again' | 'hard' | 'good' | 'easy') => {
    const DAY = 24 * 3600 * 1000;
    onUpdateWorkspace((prev) => ({
      ...prev,
      flashcards: prev.flashcards.map((c) => {
        if (c.id !== cardId) return c;
        const currBox = c.box || 1;
        const nextBox: 1 | 2 | 3 | 4 | 5 =
          grade === 'again'
            ? 1
            : grade === 'hard'
            ? 2
            : grade === 'easy'
            ? 5
            : (Math.min(5, currBox + 1) as 1 | 2 | 3 | 4 | 5);
        const daysGap =
          grade === 'again' ? 0 : nextBox === 2 ? 1 : nextBox === 3 ? 3 : nextBox === 4 ? 7 : 14;
        return {
          ...c,
          box: nextBox,
          lastReviewedAt: Date.now(),
          dueAt: grade === 'again' ? Date.now() + 10 * 60 * 1000 : Date.now() + daysGap * DAY,
        };
      }),
      updatedAt: new Date().toISOString(),
    }));
    setFcWidgetFlipped(false);
    setFcWidgetIdx((i) => i + 1);
  };

  // Renderer for every single widget in catalog
  const renderWidgetBody = (id: HomeWidgetId) => {
    switch (id) {
      case 'todayOverview': {
        const doneTasksCount = dailyTaskItems.filter((it) => it.done > 0).length;
        const totalTasksCount = dailyTaskItems.length;
        const pctDone =
          totalTasksCount > 0 ? Math.round((doneTasksCount / totalTasksCount) * 100) : 0;
        const nextExam = allCountdowns[0];
        return (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Today&apos;s Overview</span>
                </div>
                <p className="mt-1 text-sm text-[var(--mute)]">
                  <strong className="font-mono-num text-[var(--ink)]">{doneTasksCount}</strong> of{' '}
                  <strong className="font-mono-num text-[var(--ink)]">{totalTasksCount}</strong>{' '}
                  daily tasks done ·{' '}
                  <strong className="font-mono-num text-[var(--ink)]">{todayLoggedMins}m</strong>{' '}
                  revised today
                  {nextExam && (
                    <>
                      {' '}
                      · Next:{' '}
                      <strong className="text-[var(--e2)]">
                        {nextExam.title} ({nextExam.days === 0 ? 'Today' : `${nextExam.days}d`})
                      </strong>
                    </>
                  )}
                  {workspace.studyStreakDays > 0 && (
                    <>
                      {' '}
                      ·{' '}
                      <strong className="text-[var(--ok)]">
                        {workspace.studyStreakDays}d streak
                      </strong>
                    </>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('subjects', { openQuickAdd: true })}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Quick-Add Subjects</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenImport}
                  className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Import Notes</span>
                </button>
              </div>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
              <div
                className="h-full rounded-full bg-[var(--e3)] transition-all"
                style={{ width: `${pctDone}%` }}
              />
            </div>
          </div>
        );
      }

      case 'todayTasks': {
        const subjTopicsForPicker = workspace.topics.filter(
          (t) => t.subjectId === addDailySubjId
        );
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                <div>
                  <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                    <Flame className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
                    <span>Today&apos;s Revision Tasks</span>
                  </h2>
                  <p className="text-xs text-[var(--mute)]">
                    Prioritized weakest topics first — rate confidence after recalling to log 15m.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRefreshDailyTasks}
                  className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Suggest different list</span>
                </button>
              </div>

              {workspace.subjects.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-center text-xs text-[var(--mute)]">
                  No subjects added yet.{' '}
                  <button
                    type="button"
                    onClick={() => onNavigate('subjects', { openQuickAdd: true })}
                    className="cursor-pointer font-semibold text-[var(--e3)] hover:underline"
                  >
                    Quick-Add GCSE subjects
                  </button>{' '}
                  to generate your daily recall checklist automatically.
                </div>
              ) : dailyTaskItems.length === 0 ? (
                <div className="mt-4 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-center text-xs text-[var(--mute)]">
                  All scheduled topics are mastered or cleared for today! Add a custom topic below or refresh.
                </div>
              ) : (
                <div className="mt-3 space-y-2.5">
                  {dailyTaskItems.map((it) => {
                    const subj = subjectMap.get(it.subjectId);
                    const topic = it.topicId ? topicMap.get(it.topicId) : undefined;
                    const isDone = it.done > 0;
                    const pm = dailyPaperMarks[it.id] || { mark: '', total: '' };
                    return (
                      <div
                        key={it.id}
                        className={`rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs ${
                          isDone ? 'opacity-65' : ''
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {subj && (
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: subj.color }}
                                />
                              )}
                              <span
                                className={`font-semibold text-[var(--ink)] ${
                                  isDone ? 'line-through' : ''
                                }`}
                              >
                                {it.kind === 'paper'
                                  ? `Exam questions: ${subj?.name || 'Subject'}`
                                  : `Recall: ${topic?.name || `${subj?.name || 'General'} revision`}`}
                              </span>
                            </div>
                            <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                              {subj?.name}
                              {it.done > 0 &&
                                ` · marked ${
                                  ['', 'Touched on', 'Kinda alright', 'Mastered', 'Done'][it.done] ||
                                  'Done'
                                }`}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {!isDone && it.kind === 'recall' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleRateDailyTask(it, 1)}
                                  className="cursor-pointer rounded-lg border border-[var(--bad)] bg-[var(--card)] px-2 py-1 text-[11px] font-semibold text-[var(--bad)] hover:opacity-85 whitespace-nowrap"
                                >
                                  Touched on
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRateDailyTask(it, 2)}
                                  className="cursor-pointer rounded-lg border border-[var(--e2)] bg-[var(--card)] px-2 py-1 text-[11px] font-semibold text-[var(--e2)] hover:opacity-85 whitespace-nowrap"
                                >
                                  Alright
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRateDailyTask(it, 3)}
                                  className="cursor-pointer rounded-lg border border-[var(--ok)] bg-[var(--card)] px-2 py-1 text-[11px] font-semibold text-[var(--ok)] hover:opacity-85 whitespace-nowrap"
                                >
                                  Mastered
                                </button>
                              </>
                            )}
                            {!isDone && it.kind === 'paper' && (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  placeholder="Mark"
                                  value={pm.mark}
                                  onChange={(e) =>
                                    setDailyPaperMarks((prev) => ({
                                      ...prev,
                                      [it.id]: { ...pm, mark: e.target.value },
                                    }))
                                  }
                                  className="sd-input w-14 py-1 text-center text-[11px]"
                                />
                                <input
                                  type="number"
                                  min={1}
                                  placeholder="Out of"
                                  value={pm.total}
                                  onChange={(e) =>
                                    setDailyPaperMarks((prev) => ({
                                      ...prev,
                                      [it.id]: { ...pm, total: e.target.value },
                                    }))
                                  }
                                  className="sd-input w-14 py-1 text-center text-[11px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleCompleteDailyPaper(it)}
                                  className="sd-btn-pri px-2.5 py-1 text-[11px] whitespace-nowrap"
                                >
                                  Done
                                </button>
                              </div>
                            )}
                            {topic && (
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigate('notes', {
                                    subjectId: it.subjectId,
                                    topicId: topic.id,
                                  })
                                }
                                className="sd-btn px-2 py-1 text-[11px] whitespace-nowrap"
                                title="Open notes"
                              >
                                Notes
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRemoveDailyTask(it.id)}
                              aria-label="Remove daily task"
                              className="cursor-pointer rounded-lg p-1 text-[var(--mute)] hover:text-[var(--bad)]"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {workspace.subjects.length > 0 && (
              <form
                onSubmit={handleAddDailyTask}
                className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3"
              >
                <select
                  aria-label="Pick subject for task"
                  value={addDailySubjId}
                  onChange={(e) => {
                    setAddDailySubjId(e.target.value);
                    setAddDailyTopicId('');
                  }}
                  className="sd-input w-auto max-w-[160px] py-1.5 text-xs"
                >
                  {workspace.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Pick topic or exam questions"
                  value={addDailyTopicId}
                  onChange={(e) => setAddDailyTopicId(e.target.value)}
                  className="sd-input min-w-0 flex-1 py-1.5 text-xs"
                >
                  <option value="">General revision session</option>
                  <option value="__paper__">Exam paper questions</option>
                  {subjTopicsForPicker.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.confidence === 3 ? '(Mastered)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add task</span>
                </button>
              </form>
            )}
          </div>
        );
      }

      case 'timer':
        return (
          <div className="flex h-full flex-col justify-between">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                <Timer className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                <span>Quick Session &amp; Timer</span>
              </div>
              <span className="font-mono-num text-xs text-[var(--mute)]">
                {timerDurationMins}m session
              </span>
            </div>

            <div className="my-3 flex items-baseline justify-between gap-3">
              <div className="font-mono-num text-4xl font-extrabold tracking-tight text-[var(--ink)]">
                {mm}:{ss}
              </div>
              <div className="text-xs text-[var(--mute)]">
                {liveTimer.running ? 'Running' : 'Ready'}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onToggleTimer}
                className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap shrink-0"
              >
                {liveTimer.running ? (
                  <>
                    <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Start Focus</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onResetTimer(25)}
                className="sd-btn px-3 py-2 text-xs whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>25m</span>
              </button>
              <button
                type="button"
                onClick={() => onResetTimer(50)}
                className="sd-btn px-3 py-2 text-xs whitespace-nowrap shrink-0"
              >
                <span>50m</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('planner', { plannerTab: 'timer' })}
                className="sd-btn px-3 py-2 text-xs whitespace-nowrap shrink-0"
              >
                <span>Full Timer</span>
              </button>
            </div>
          </div>
        );

      case 'schedule': {
        const todaysExams = examsByDate.get(todayStr) || [];
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                  <CalendarDays className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Today&apos;s Schedule</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('calendar')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Open Calendar →
                </button>
              </div>

              <div className="mt-4 space-y-2.5">
                {todaysExams.length > 0 && (
                  <div className="space-y-1.5">
                    {todaysExams.map((ex) => (
                      <div
                        key={ex.id}
                        className="flex items-center justify-between gap-2 rounded-xl border-2 border-[#111827] bg-[#FDE047] px-3 py-2 text-xs font-extrabold text-[#111827]"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 rounded bg-[#111827] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#FDE047]">
                            EXAM
                          </span>
                          <span className="truncate">{ex.displayLabel}</span>
                        </span>
                        <span className="font-mono-num shrink-0 text-[#111827]/85">
                          {ex.startTime} · {ex.durationMins}m
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  Scheduled Sessions Today ({todaysBlocks.length})
                </div>
                {todaysBlocks.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                    No blocks planned for today. Use{' '}
                    <button
                      type="button"
                      onClick={() => onNavigate('calendar')}
                      className="cursor-pointer font-semibold text-[var(--e3)] hover:underline"
                    >
                      Auto-Plan Week
                    </button>{' '}
                    to schedule revision around your exams.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {todaysBlocks.map((blk) => (
                      <button
                        key={blk.id}
                        type="button"
                        onClick={() => toggleBlockDone(blk.id)}
                        className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2.5 text-left text-xs transition-colors hover:border-[var(--e3)]"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              blk.done
                                ? 'border-[var(--ok)] bg-[var(--ok)] text-white'
                                : 'border-[var(--mute)]'
                            }`}
                          >
                            {blk.done && <Check className="h-3 w-3" aria-hidden="true" />}
                          </span>
                          <span
                            className={`truncate font-semibold ${
                              blk.done ? 'line-through text-[var(--mute)]' : 'text-[var(--ink)]'
                            }`}
                          >
                            {blk.title}
                          </span>
                        </span>
                        <span className="font-mono-num shrink-0 text-[var(--mute)]">
                          {blk.startTime} · {blk.durationMins}m
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      }

      case 'todos':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                  <CheckSquare className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
                  <span>Quick To-Do</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('planner', { plannerTab: 'todo' })}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Open To-Do ({workspace.todos.length}) →
                </button>
              </div>

              <form onSubmit={handleQuickAddTodo} className="mt-4 flex flex-wrap gap-2">
                <input
                  type="text"
                  value={quickTodoText}
                  onChange={(e) => setQuickTodoText(e.target.value)}
                  placeholder="Add a to-do for today…"
                  className="sd-input min-w-0 flex-1 py-1.5 text-sm"
                />
                {workspace.subjects.length > 0 && (
                  <select
                    aria-label="Task subject"
                    value={quickTodoSubj}
                    onChange={(e) => setQuickTodoSubj(e.target.value)}
                    className="sd-input w-auto max-w-[140px] py-1.5 text-xs"
                  >
                    <option value="">General</option>
                    {workspace.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="submit"
                  className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add</span>
                </button>
              </form>

              <div className="mt-3 space-y-2">
                {activeTodos.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                    No open to-do tasks. Add one above or open To-Do for smart dates &amp; priorities.
                  </p>
                ) : (
                  activeTodos.map((td) => {
                    const subj = td.subjectId ? subjectMap.get(td.subjectId) : null;
                    return (
                      <button
                        key={td.id}
                        type="button"
                        onClick={() => toggleTodoDone(td.id)}
                        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-left text-xs transition-colors hover:border-[var(--e3)]"
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-[var(--mute)]" />
                          <span className="truncate font-semibold text-[var(--ink)]">
                            {td.title}
                          </span>
                        </span>
                        <span className="shrink-0 text-[var(--mute)]">
                          {subj ? `${subj.name} · ` : ''}
                          {td.priority === 3 ? 'High' : td.priority === 1 ? 'Low' : 'Normal'}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );

      case 'scratchpad': {
        const val = workspace.scratchpad || '';
        return (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-2 pb-2">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                <StickyNote className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
                <span>Quick Scratchpad</span>
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono-num text-[11px] text-[var(--mute)]">
                  {val.length} chars saved
                </span>
                {val && (
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateWorkspace((prev) => ({
                        ...prev,
                        scratchpad: '',
                      }))
                    }
                    className="cursor-pointer text-[11px] font-semibold text-[var(--bad)] hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <textarea
              value={val}
              onChange={(e) =>
                onUpdateWorkspace((prev) => ({
                  ...prev,
                  scratchpad: e.target.value,
                }))
              }
              placeholder="Jot down formulas, key essay quotes, dates, or quick recall points…"
              className="sd-input min-h-[125px] flex-1 resize-none text-xs leading-relaxed"
            />
          </div>
        );
      }

      case 'studyGuide':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 border-b border-[var(--line)] pb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                <HelpCircle className="h-4 w-4" aria-hidden="true" />
                <span>How to Revise Effectively</span>
              </div>
              <div className="mt-3 space-y-2.5 text-xs leading-relaxed text-[var(--mute)]">
                <p>
                  <strong className="text-[var(--ink)]">Active Recall First:</strong> Close your notes
                  and write or speak everything you remember from memory — then check what you missed.
                </p>
                <p>
                  <strong className="text-[var(--ink)]">Fix Weak Topics First:</strong> Red and unstarted
                  subtopics give the biggest mark gains when tackled early in a session.
                </p>
                <p>
                  <strong className="text-[var(--ink)]">25/5 Pomodoro &amp; Interleaving:</strong>{' '}
                  Alternate between two subjects across 25-minute Focus Timer blocks rather than cramming
                  one topic all night.
                </p>
              </div>
            </div>
          </div>
        );

      case 'dailyGoal':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--ok)]">
                  <Target className="h-4 w-4" aria-hidden="true" />
                  <span>Daily Study Target</span>
                </span>
                <select
                  aria-label="Daily target minutes"
                  value={dailyGoalMins}
                  onChange={(e) =>
                    onUpdateWorkspace((prev) => ({
                      ...prev,
                      dailyGoalMinutes: Number(e.target.value) || 60,
                    }))
                  }
                  className="sd-input w-auto py-1 text-xs"
                >
                  {[30, 45, 60, 90, 120, 180].map((m) => (
                    <option key={m} value={m}>
                      Goal: {m}m
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-3 flex items-baseline justify-between gap-2">
                <div className="font-mono-num text-3xl font-extrabold text-[var(--ink)]">
                  {todayLoggedMins}m
                  <span className="text-sm font-semibold text-[var(--mute)]">
                    {' '}
                    / {dailyGoalMins}m
                  </span>
                </div>
                <span className="font-mono-num text-xs font-bold text-[var(--ok)]">
                  {dailyGoalPct}% · {workspace.studyStreakDays}d streak
                </span>
              </div>
              <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${dailyGoalPct}%`,
                    backgroundColor: dailyGoalPct >= 100 ? 'var(--ok)' : 'var(--e3)',
                  }}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-3">
              <span className="text-[11px] font-semibold text-[var(--mute)]">
                Quick-log focus time:
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    onUpdateWorkspace((prev) =>
                      addLoggedStudyMinutes(prev, 15, { kind: 'manual', note: 'Quick 15m log' })
                    )
                  }
                  className="sd-btn px-2.5 py-1 text-xs font-semibold"
                >
                  +15m
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateWorkspace((prev) =>
                      addLoggedStudyMinutes(prev, 25, { kind: 'manual', note: 'Quick 25m log' })
                    )
                  }
                  className="sd-btn-pri px-2.5 py-1 text-xs font-semibold"
                >
                  +25m
                </button>
              </div>
            </div>
          </div>
        );

      case 'progOverview': {
        const nextEx = allCountdowns[0];
        const totalHours = ((workspace.studyMinutesLogged || 0) / 60).toFixed(1);
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
              <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                <TrendingUp className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                <span>Readiness Overview</span>
              </h2>
              <button
                type="button"
                onClick={() => onNavigate('progress')}
                className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
              >
                Full Stats →
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  Next Exam
                </div>
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-[var(--e2)]">
                  {nextEx ? (nextEx.days === 0 ? 'Today' : `${nextEx.days}d`) : '—'}
                </div>
                <div className="mt-1 truncate text-xs text-[var(--mute)]">
                  {nextEx ? `${nextEx.title} · ${formatShortDate(nextEx.date)}` : 'Set exam dates in Subjects'}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  Syllabus Readiness
                </div>
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-[var(--ok)]">
                  {topicMetrics.readinessPct}%
                </div>
                <div className="mt-1 text-xs text-[var(--mute)]">
                  {topicMetrics.mastered} mastered · {topicMetrics.alright} alright ·{' '}
                  {topicMetrics.weak} weak
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  Hours Revised
                </div>
                <div className="font-mono-num mt-1 text-2xl font-extrabold text-[var(--ink)]">
                  {totalHours}h
                </div>
                <div className="mt-1 text-xs text-[var(--mute)]">
                  {todayLoggedMins}m today · {workspace.studyStreakDays}d streak
                </div>
              </div>
            </div>
          </div>
        );
      }

      case 'progWeek': {
        const now = new Date();
        const monOffset = (now.getDay() + 6) % 7;
        const avail = workspace.plannerPrefs?.availHours || [2, 2, 2, 2, 2, 3, 3];
        const weekDays = WEEK_LABELS.map((label, i) => {
          const dtStr = isoOffset(i - monOffset);
          const mins = minsByDate.get(dtStr) || 0;
          const targetMins = Math.round((avail[i] ?? 2) * 60);
          return { label, dtStr, mins, targetMins, isToday: dtStr === todayStr };
        });
        const maxBarMins = Math.max(
          60,
          ...weekDays.map((d) => Math.max(d.mins, d.targetMins))
        );
        const totalWeekMins = weekDays.reduce((a, d) => a + d.mins, 0);
        const totalTargetMins = weekDays.reduce((a, d) => a + d.targetMins, 0);

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <BarChart3 className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>This Week Study Chart</span>
                </h2>
                <span className="font-mono-num text-xs text-[var(--mute)]">
                  {(totalWeekMins / 60).toFixed(1)}h / {(totalTargetMins / 60).toFixed(1)}h
                </span>
              </div>

              <div className="mt-4 grid h-36 grid-cols-7 items-end gap-2">
                {weekDays.map((d) => {
                  const pct = Math.min(100, Math.round((d.mins / maxBarMins) * 100));
                  const tgtPct = Math.min(100, Math.round((d.targetMins / maxBarMins) * 100));
                  return (
                    <div key={d.dtStr} className="flex h-full flex-col items-center justify-end gap-1">
                      <span className="font-mono-num text-[10px] font-semibold text-[var(--mute)]">
                        {d.mins > 0 ? `${d.mins}m` : ''}
                      </span>
                      <div className="relative flex h-24 w-full items-end justify-center overflow-hidden rounded-lg bg-[var(--bg)] border border-[var(--line)]">
                        {d.targetMins > 0 && (
                          <div
                            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[var(--mute)] opacity-45"
                            style={{ bottom: `${tgtPct}%` }}
                            title={`Target: ${d.targetMins}m`}
                          />
                        )}
                        <div
                          className="w-full rounded-t transition-all"
                          style={{
                            height: `${d.mins > 0 ? Math.max(8, pct) : 0}%`,
                            backgroundColor:
                              d.mins >= d.targetMins && d.targetMins > 0
                                ? 'var(--ok)'
                                : d.isToday
                                ? 'var(--e2)'
                                : 'var(--e3)',
                          }}
                        />
                      </div>
                      <span
                        className={`text-[11px] font-semibold ${
                          d.isToday ? 'text-[var(--e3)]' : 'text-[var(--mute)]'
                        }`}
                      >
                        {d.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-[var(--mute)]">
              Dashed line shows your daily availability goal from Planner preferences.
            </p>
          </div>
        );
      }

      case 'progHeatmap': {
        const now = new Date();
        const dowMon0 = (now.getDay() + 6) % 7;
        const cells = Array.from({ length: 70 }, (_, idx) => {
          const offset = idx - (63 + dowMon0);
          const dtStr = isoOffset(offset);
          const mins = minsByDate.get(dtStr) || 0;
          const level =
            mins >= 90 ? 4 : mins >= 45 ? 3 : mins >= 20 ? 2 : mins > 0 ? 1 : 0;
          return { dtStr, mins, level, future: offset > 0 };
        });

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <Activity className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
                  <span>10-Week Consistency</span>
                </h2>
                <span className="font-mono-num text-xs font-bold text-[var(--ok)]">
                  {workspace.studyStreakDays}d streak
                </span>
              </div>

              <div className="mt-3 grid grid-cols-10 gap-1.5">
                {cells.map((c) => {
                  const bg = c.future
                    ? 'transparent'
                    : c.level === 4
                    ? 'var(--ok)'
                    : c.level === 3
                    ? 'color-mix(in srgb, var(--ok) 72%, var(--bg))'
                    : c.level === 2
                    ? 'color-mix(in srgb, var(--e3) 55%, var(--bg))'
                    : c.level === 1
                    ? 'color-mix(in srgb, var(--e3) 25%, var(--bg))'
                    : 'var(--bg)';
                  return (
                    <div
                      key={c.dtStr}
                      title={`${c.dtStr}: ${c.mins} mins`}
                      className={`aspect-square rounded-[4px] border ${
                        c.future ? 'border-dashed border-[var(--line)] opacity-35' : 'border-[var(--line)]'
                      }`}
                      style={{ backgroundColor: bg }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-[var(--mute)]">
              <span>Past 10 weeks</span>
              <div className="flex items-center gap-1">
                <span>Less</span>
                <span className="h-2.5 w-2.5 rounded-[2px] border border-[var(--line)] bg-[var(--bg)]" />
                <span
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--e3) 40%, var(--bg))' }}
                />
                <span
                  className="h-2.5 w-2.5 rounded-[2px]"
                  style={{ backgroundColor: 'var(--ok)' }}
                />
                <span>90m+</span>
              </div>
            </div>
          </div>
        );
      }

      case 'progPace': {
        const nextEx = allCountdowns[0];
        const daysLeft = nextEx && nextEx.days > 0 ? nextEx.days : 0;
        const perDay = daysLeft > 0 ? (topicMetrics.remaining / daysLeft).toFixed(1) : null;
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display text-base font-bold text-[var(--ink)]">
                  Revision Pace Check
                </h2>
                <span className="font-mono-num text-xs font-bold text-[var(--e3)]">
                  {topicMetrics.readinessPct}% ready
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-[11px] text-[var(--mute)]">Topics left</div>
                  <div className="font-mono-num text-2xl font-extrabold text-[var(--ink)]">
                    {topicMetrics.remaining}
                  </div>
                  <div className="text-[11px] text-[var(--mute)]">
                    out of {topicMetrics.total} total
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="text-[11px] text-[var(--mute)]">Recommended pace</div>
                  <div className="font-mono-num text-2xl font-extrabold text-[var(--e2)]">
                    {perDay ? `${perDay}/d` : '—'}
                  </div>
                  <div className="text-[11px] text-[var(--mute)]">
                    {daysLeft > 0 ? `over ${daysLeft} days to exam` : 'Set an exam date'}
                  </div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--mute)]">
              {topicMetrics.unstarted} not started · {topicMetrics.weak} weak ·{' '}
              {topicMetrics.alright} alright · {topicMetrics.mastered} mastered
            </p>
          </div>
        );
      }

      case 'progTodo': {
        const all = workspace.todos;
        const done = all.filter((t) => t.done).length;
        const pctDone = all.length > 0 ? Math.round((done / all.length) * 100) : 0;
        const doneToday = all.filter(
          (t) => t.done && (t.doneAt || '').slice(0, 10) === todayStr
        ).length;
        const overdue = all.filter((t) => !t.done && t.dueDate && t.dueDate < todayStr).length;
        const leftToday = all.filter((t) => !t.done && t.dueDate && t.dueDate <= todayStr).length;

        const catDefs: Array<{ id: 'exam' | 'hw' | 'oth'; label: string; color: string }> = [
          { id: 'exam', label: 'Exam & Tests', color: 'var(--bad)' },
          { id: 'hw', label: 'Homework', color: 'var(--e2)' },
          { id: 'oth', label: 'Other Revision', color: 'var(--e3)' },
        ];

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display text-base font-bold text-[var(--ink)]">
                  To-Do List Progress
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('planner', { plannerTab: 'todo' })}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline"
                >
                  Open To-Do →
                </button>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2">
                  <div className="text-[10px] text-[var(--mute)]">Done</div>
                  <div className="font-mono-num text-sm font-bold text-[var(--ok)]">
                    {pctDone}%
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2">
                  <div className="text-[10px] text-[var(--mute)]">Today</div>
                  <div className="font-mono-num text-sm font-bold text-[var(--ink)]">
                    {doneToday}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2">
                  <div className="text-[10px] text-[var(--mute)]">Left</div>
                  <div className="font-mono-num text-sm font-bold text-[var(--ink)]">
                    {leftToday}
                  </div>
                </div>
                <div className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2">
                  <div className="text-[10px] text-[var(--mute)]">Overdue</div>
                  <div
                    className={`font-mono-num text-sm font-bold ${
                      overdue > 0 ? 'text-[var(--bad)]' : 'text-[var(--ink)]'
                    }`}
                  >
                    {overdue}
                  </div>
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                {catDefs.map((cat) => {
                  const catAll = all.filter((t) => (t.category || 'oth') === cat.id);
                  if (catAll.length === 0) return null;
                  const catDone = catAll.filter((t) => t.done).length;
                  const p = Math.round((catDone / catAll.length) * 100);
                  return (
                    <div key={cat.id} className="flex items-center gap-2 text-xs">
                      <span className="w-28 truncate text-[var(--mute)]">{cat.label}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
                        <div
                          className="h-full"
                          style={{ width: `${p}%`, backgroundColor: cat.color }}
                        />
                      </div>
                      <span className="font-mono-num w-10 text-right text-[var(--ink)]">
                        {catDone}/{catAll.length}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      }

      case 'progNumbers': {
        const nSess = studyLog.length;
        const totMins = Math.max(
          workspace.studyMinutesLogged,
          studyLog.reduce((a, l) => a + l.mins, 0)
        );
        const avgMins = nSess > 0 ? Math.round(totMins / nSess) : 0;
        const bestMins = nSess > 0 ? Math.max(...studyLog.map((l) => l.mins)) : 0;

        return (
          <div className="flex h-full flex-col justify-between">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
              <h2 className="font-display text-base font-bold text-[var(--ink)]">
                Study Numbers &amp; Streaks
              </h2>
              <Flame className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                <div className="text-[11px] text-[var(--mute)]">Sessions</div>
                <div className="font-mono-num text-xl font-extrabold text-[var(--ink)]">
                  {nSess}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                <div className="text-[11px] text-[var(--mute)]">Average</div>
                <div className="font-mono-num text-xl font-extrabold text-[var(--ink)]">
                  {avgMins}m
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                <div className="text-[11px] text-[var(--mute)]">Longest</div>
                <div className="font-mono-num text-xl font-extrabold text-[var(--e3)]">
                  {bestMins}m
                </div>
              </div>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                <div className="text-[11px] text-[var(--mute)]">Streak</div>
                <div className="font-mono-num text-xl font-extrabold text-[var(--ok)]">
                  {workspace.studyStreakDays}d
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-[var(--mute)]">
              Total logged: <strong className="text-[var(--ink)]">{(totMins / 60).toFixed(1)}h</strong>{' '}
              across {minsByDate.size || (workspace.studyStreakDays > 0 ? 1 : 0)} study days.
            </p>
          </div>
        );
      }

      case 'pastPapers': {
        const scores = (workspace.paperScores || []).slice().reverse().slice(0, 5);
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <Award className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
                  <span>Past Paper Scores</span>
                </h2>
                <span className="font-mono-num text-xs text-[var(--mute)]">
                  {(workspace.paperScores || []).length} logged
                </span>
              </div>

              <form onSubmit={handleAddPaperScore} className="mt-3 flex flex-wrap gap-2">
                {workspace.subjects.length > 0 && (
                  <select
                    aria-label="Paper subject"
                    value={paperSubjId}
                    onChange={(e) => setPaperSubjId(e.target.value)}
                    className="sd-input w-auto max-w-[130px] py-1.5 text-xs"
                  >
                    {workspace.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  value={paperName}
                  onChange={(e) => setPaperName(e.target.value)}
                  placeholder="Paper name"
                  className="sd-input min-w-0 flex-1 py-1.5 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  value={paperMark}
                  onChange={(e) => setPaperMark(e.target.value)}
                  placeholder="Mark"
                  className="sd-input w-16 py-1.5 text-xs"
                />
                <input
                  type="number"
                  min={1}
                  value={paperTotal}
                  onChange={(e) => setPaperTotal(e.target.value)}
                  placeholder="Total"
                  className="sd-input w-16 py-1.5 text-xs"
                />
                <button type="submit" className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap">
                  Add
                </button>
              </form>

              <div className="mt-3 space-y-1.5">
                {scores.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-3 text-xs text-[var(--mute)]">
                    No past paper marks recorded yet. Log completed papers above to track your grades.
                  </p>
                ) : (
                  scores.map((sc) => {
                    const subj = sc.subjectId ? subjectMap.get(sc.subjectId) : null;
                    const pct = Math.round((sc.mark / Math.max(1, sc.total)) * 100);
                    return (
                      <div
                        key={sc.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[var(--ink)]">
                            {subj ? `${subj.name} · ` : ''}
                            {sc.paper}
                          </div>
                          <div className="text-[11px] text-[var(--mute)]">
                            {formatShortDate(sc.date)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono-num font-bold ${
                              pct >= 80
                                ? 'text-[var(--ok)]'
                                : pct >= 60
                                ? 'text-[var(--e2)]'
                                : 'text-[var(--bad)]'
                            }`}
                          >
                            {sc.mark}/{sc.total} ({pct}%)
                          </span>
                          <button
                            type="button"
                            aria-label="Delete paper score"
                            onClick={() =>
                              onUpdateWorkspace((prev) => ({
                                ...prev,
                                paperScores: (prev.paperScores || []).filter((x) => x.id !== sc.id),
                              }))
                            }
                            className="cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      }

      case 'sessionLog': {
        const recent = studyLog.slice().reverse().slice(0, 5);
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <Clock className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Study Session Log</span>
                </h2>
                <span className="font-mono-num text-xs text-[var(--mute)]">
                  {studyLog.length} logged
                </span>
              </div>

              <form onSubmit={handleAddManualSession} className="mt-3 flex flex-wrap gap-2">
                {workspace.subjects.length > 0 && (
                  <select
                    aria-label="Session subject"
                    value={logSubjId}
                    onChange={(e) => setLogSubjId(e.target.value)}
                    className="sd-input w-auto max-w-[130px] py-1.5 text-xs"
                  >
                    <option value="">General Study</option>
                    {workspace.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="number"
                  min={1}
                  max={480}
                  value={logMins}
                  onChange={(e) => setLogMins(e.target.value)}
                  className="sd-input w-16 py-1.5 text-xs"
                  aria-label="Minutes"
                />
                <input
                  type="text"
                  value={logNote}
                  onChange={(e) => setLogNote(e.target.value)}
                  placeholder="Topic / note (optional)"
                  className="sd-input min-w-0 flex-1 py-1.5 text-xs"
                />
                <button type="submit" className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap">
                  Log
                </button>
              </form>

              <div className="mt-3 space-y-1.5">
                {recent.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-3 text-xs text-[var(--mute)]">
                    Complete a Focus Timer or log a manual revision block above to track sessions.
                  </p>
                ) : (
                  recent.map((l) => {
                    const subj = l.subjectId ? subjectMap.get(l.subjectId) : null;
                    return (
                      <div
                        key={l.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[var(--ink)]">
                            {subj ? subj.name : 'General Study'}
                            {l.note ? ` · ${l.note}` : ''}
                          </div>
                          <div className="text-[11px] text-[var(--mute)]">
                            {formatShortDate(l.date)}
                            {l.time ? ` ${l.time}` : ''}
                          </div>
                        </div>
                        <span className="font-mono-num shrink-0 font-bold text-[var(--e3)]">
                          {l.mins}m
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        );
      }

      case 'progHours': {
        const hours = workspace.plannerPrefs?.availHours || [2, 2, 2, 2, 2, 3, 3];
        const totalHrs = hours.reduce((a, b) => a + b, 0);
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display text-base font-bold text-[var(--ink)]">
                  Daily Study Hours Budget
                </h2>
                <span className="font-mono-num text-xs font-bold text-[var(--e3)]">
                  {totalHrs}h / week
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--mute)]">
                Set how many hours you can revise each day — used automatically by Calendar Auto-Plan.
              </p>
              <div className="mt-3 grid grid-cols-7 gap-1.5">
                {WEEK_LABELS.map((day, idx) => (
                  <label key={day} className="block text-center text-[11px] font-semibold text-[var(--mute)]">
                    {day}
                    <input
                      type="number"
                      min={0}
                      max={12}
                      step={0.5}
                      value={hours[idx] ?? 2}
                      onChange={(e) => {
                        const val = Math.max(0, Math.min(12, Number(e.target.value) || 0));
                        onUpdateWorkspace((prev) => {
                          const curr = [...(prev.plannerPrefs?.availHours || [2, 2, 2, 2, 2, 3, 3])];
                          curr[idx] = val;
                          return {
                            ...prev,
                            plannerPrefs: {
                              weekdayStart: prev.plannerPrefs?.weekdayStart || '16:30',
                              weekendStart: prev.plannerPrefs?.weekendStart || '09:30',
                              availHours: curr,
                            },
                          };
                        });
                      }}
                      className="sd-input mt-1 px-1 py-1 text-center font-mono-num text-xs"
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
      }

      case 'dueCards': {
        const total = workspace.flashcards.length;
        const mPct = total > 0 ? Math.round((masteredCardsCount / total) * 100) : 0;
        const lPct = total > 0 ? Math.round((learningCardsCount / total) * 100) : 0;
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                  <Layers className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Flashcards Snapshot</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('flashcards')}
                  className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  Study Flashcards
                </button>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5">
                  <div className="text-[10px] font-semibold text-[var(--mute)]">Due now</div>
                  <div className="font-mono-num text-lg font-extrabold text-[var(--ink)]">
                    {dueCount}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5">
                  <div className="text-[10px] font-semibold text-[var(--mute)]">Mastered</div>
                  <div className="font-mono-num text-lg font-extrabold text-[var(--ok)]">
                    {masteredCardsCount}/{total}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5">
                  <div className="text-[10px] font-semibold text-[var(--mute)]">Weak</div>
                  <div className="font-mono-num text-lg font-extrabold text-[var(--bad)]">
                    {weakCardsCount}
                  </div>
                </div>
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5">
                  <div className="text-[10px] font-semibold text-[var(--mute)]">Flagged</div>
                  <div className="font-mono-num text-lg font-extrabold text-[var(--e2)]">
                    {flaggedCount}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[var(--line)]">
                <div className="h-full bg-[var(--ok)]" style={{ width: `${mPct}%` }} />
                <div className="h-full bg-[var(--e2)]" style={{ width: `${lPct}%` }} />
              </div>
              <p className="mt-1.5 text-xs text-[var(--mute)]">
                {mPct}% mastered · {learningCardsCount} learning · Flip &amp; Type-to-Recall modes
              </p>
            </div>
          </div>
        );
      }

      case 'flashcardBreakdown': {
        const total = Math.max(1, workspace.flashcards.length);
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                  <Layers className="h-4 w-4" aria-hidden="true" />
                  <span>Flashcards Progress &amp; Boxes</span>
                </span>
                <span className="font-mono-num text-xs text-[var(--mute)]">
                  {flaggedCount} flagged
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {boxCounts.map((count, idx) => {
                  const pct = Math.round((count / total) * 100);
                  return (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="font-mono-num w-12 shrink-0 text-[var(--mute)]">
                        Box {idx + 1}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
                        <div
                          className="h-full transition-all"
                          style={{
                            width: `${workspace.flashcards.length > 0 ? pct : 0}%`,
                            backgroundColor: idx >= 3 ? 'var(--ok)' : 'var(--e3)',
                          }}
                        />
                      </div>
                      <span className="font-mono-num w-8 shrink-0 text-right font-semibold text-[var(--ink)]">
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
              {subjectStats.some((s) => s.cardCount > 0) && (
                <div className="mt-3 space-y-1.5 border-t border-[var(--line)] pt-2.5">
                  {subjectStats
                    .filter((s) => s.cardCount > 0)
                    .slice(0, 4)
                    .map(({ subj, cardCount, masteredCards }) => (
                      <button
                        key={subj.id}
                        type="button"
                        onClick={() => onNavigate('flashcards', { subjectId: subj.id })}
                        className="flex w-full cursor-pointer items-center justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-[var(--bg)]"
                      >
                        <span className="truncate font-semibold text-[var(--ink)]">
                          {subj.name}
                        </span>
                        <span className="font-mono-num text-[var(--mute)]">
                          {masteredCards}/{cardCount} mastered →
                        </span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'liveQuiz':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                <Zap className="h-4 w-4" aria-hidden="true" />
                <span>Live Quiz Arena</span>
              </div>
              <h2 className="font-display mt-1 text-lg font-bold text-[var(--ink)]">
                Multiplayer Flashcard Quiz
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                Host or join fast-paced rooms with 4-letter codes, speed streaks, and smart semantic
                answer grading.
              </p>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-num text-xs text-[var(--mute)]">
                {workspace.flashcards.length} cards ready
              </span>
              <button
                type="button"
                onClick={() => onNavigate('quiz')}
                className="sd-btn-pri px-3.5 py-2 text-xs whitespace-nowrap"
              >
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Play Live Quiz</span>
              </button>
            </div>
          </div>
        );

      case 'communityNotes':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e3)]">
                  <Globe className="h-4 w-4" aria-hidden="true" />
                  <span>Community &amp; Shared Notes</span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('community', { communityTypeFilter: 'notes' })}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Browse All →
                </button>
              </div>
              <p className="mt-2.5 text-xs leading-relaxed text-[var(--mute)]">
                Enter a classmate&apos;s 6-character share code to view or copy their Save My
                Exams-style notes, timelines &amp; flashcards.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const clean = shareCodeInput.trim().toUpperCase();
                  if (!clean) return;
                  onNavigate('community', { shareCode: clean });
                }}
                className="mt-3 flex gap-2"
              >
                <input
                  type="text"
                  maxLength={10}
                  value={shareCodeInput}
                  onChange={(e) => setShareCodeInput(e.target.value.toUpperCase())}
                  placeholder="Share code (e.g. A1B2C3)"
                  className="sd-input min-w-0 flex-1 py-1.5 font-mono-num text-xs uppercase"
                />
                <button type="submit" className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap">
                  Open
                </button>
              </form>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('community', { communityTypeFilter: 'notes' })}
                className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Shared Notes</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('community', { communityTypeFilter: 'flashcards' })}
                className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
              >
                <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Shared Flashcards</span>
              </button>
            </div>
          </div>
        );

      case 'mastery':
        return (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Subjects (Weakest First)
                </h2>
                <p className="text-xs text-[var(--mute)]">
                  Green = mastered, amber = kinda alright, red = weak. Click any subject to open Notes.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onNavigate('subjects', { openQuickAdd: true })}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  + Quick-Add Subjects
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('subjects')}
                  className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)] whitespace-nowrap"
                >
                  Manage Topics →
                </button>
              </div>
            </div>

            {workspace.subjects.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-5 text-center text-xs text-[var(--mute)]">
                No subjects added yet. Click &ldquo;+ Quick-Add Subjects&rdquo; to pick from 22 GCSE
                templates.
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {subjectStats.map(
                  ({ subj, topicCount, c3, c2, c1, readiness, cardCount, masteredCards }) => {
                    const tot = Math.max(1, topicCount);
                    return (
                      <button
                        key={subj.id}
                        type="button"
                        onClick={() => onNavigate('notes', { subjectId: subj.id })}
                        className="flex cursor-pointer flex-col justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-left transition-colors hover:border-[var(--e3)]"
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-[var(--ink)]">
                              <span
                                className="h-3 w-3 shrink-0 rounded-full"
                                style={{ backgroundColor: subj.color }}
                              />
                              <span className="truncate">{subj.name}</span>
                            </span>
                            <span className="font-mono-num text-xs font-bold text-[var(--ink)]">
                              {topicCount > 0 ? `${readiness}%` : '—'}
                            </span>
                          </div>
                          <div className="font-mono-num mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--mute)]">
                            <span>{c3}/{topicCount} topics mastered</span>
                            <span>·</span>
                            <span>{masteredCards}/{cardCount} cards</span>
                          </div>
                        </div>

                        <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[var(--line)]">
                          <div
                            className="h-full bg-[var(--ok)]"
                            style={{ width: `${(c3 / tot) * 100}%` }}
                          />
                          <div
                            className="h-full bg-[var(--e2)]"
                            style={{ width: `${(c2 / tot) * 100}%` }}
                          />
                          <div
                            className="h-full bg-[var(--bad)]"
                            style={{ width: `${(c1 / tot) * 100}%` }}
                          />
                        </div>
                      </button>
                    );
                  }
                )}
              </div>
            )}
          </div>
        );

      case 'weakTopics': {
        const weakest = workspace.topics
          .filter((t) => !t.completed && (t.confidence ?? 0) < 3)
          .sort((a, b) => (a.confidence ?? 0) - (b.confidence ?? 0))
          .slice(0, 6);

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display text-base font-bold text-[var(--ink)]">
                  Weakest Topics Radar
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('subjects')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline"
                >
                  All Topics →
                </button>
              </div>
              {weakest.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                  {workspace.topics.length === 0
                    ? 'Add topics in Subjects to highlight your weakest areas here.'
                    : 'Every topic is mastered! Great work.'}
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {weakest.map((tp) => {
                    const subj = subjectMap.get(tp.subjectId);
                    const conf = tp.confidence ?? 0;
                    const badgeColor =
                      conf === 1 ? 'var(--bad)' : conf === 2 ? 'var(--e2)' : 'var(--mute)';
                    const badgeLabel = conf === 1 ? 'Weak' : conf === 2 ? 'Alright' : 'New';
                    return (
                      <div
                        key={tp.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => cycleTopicConfidence(tp.id)}
                          title="Click to cycle confidence"
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: badgeColor }}
                          />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-[var(--ink)]">{tp.name}</div>
                            <div className="text-[11px] text-[var(--mute)]">
                              {subj?.name || 'Subject'} · {badgeLabel}
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate('notes', { subjectId: tp.subjectId, topicId: tp.id })
                          }
                          className="sd-btn px-2 py-1 text-[11px] whitespace-nowrap"
                        >
                          Notes →
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'examCountdowns':
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  <span>Exam &amp; Goal Countdowns</span>
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('subjects')}
                  className="cursor-pointer text-[11px] font-semibold text-[var(--e3)] hover:underline"
                >
                  Edit exams
                </button>
              </div>

              {allCountdowns.length === 0 ? (
                <p className="mt-3 text-xs leading-relaxed text-[var(--mute)]">
                  No deadlines set yet. Add a mock week, assignment, or test date below.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {allCountdowns.slice(0, 5).map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        {item.color && (
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full"
                            style={{ backgroundColor: item.color }}
                          />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-semibold text-[var(--ink)]">
                            {item.title}
                          </div>
                          <div className="text-[11px] text-[var(--mute)]">
                            {formatShortDate(item.date)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`font-mono-num shrink-0 font-bold ${
                            item.days <= 3
                              ? 'text-[var(--bad)]'
                              : item.days <= 14
                              ? 'text-[var(--e2)]'
                              : 'text-[var(--ok)]'
                          }`}
                        >
                          {item.days === 0
                            ? 'Today'
                            : item.days === 1
                            ? 'Tomorrow'
                            : `${item.days}d`}
                        </span>
                        {item.custom && (
                          <button
                            type="button"
                            aria-label="Remove countdown"
                            onClick={() =>
                              onUpdateWorkspace((prev) => ({
                                ...prev,
                                customCountdowns: (prev.customCountdowns || []).filter(
                                  (x) => x.id !== item.id
                                ),
                              }))
                            }
                            className="cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <form onSubmit={handleAddDeadline} className="mt-3 flex flex-wrap gap-2 border-t border-[var(--line)] pt-3">
              <input
                type="text"
                value={deadlineTitle}
                onChange={(e) => setDeadlineTitle(e.target.value)}
                placeholder="Mock paper / deadline"
                className="sd-input min-w-0 flex-1 py-1.5 text-xs"
              />
              <input
                type="date"
                value={deadlineDate}
                onChange={(e) => setDeadlineDate(e.target.value)}
                className="sd-input w-auto py-1.5 text-xs"
              />
              <button type="submit" className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap">
                Add
              </button>
            </form>
          </div>
        );

      case 'miniCalendar': {
        const weekDays = Array.from({ length: 7 }, (_, i) => {
          const dStr = isoOffset(i);
          const label =
            i === 0
              ? 'Today'
              : new Date(`${dStr}T12:00:00`).toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                });
          const blocks = (nonExamBlocksByDate.get(dStr) || []).filter((b) => b.kind !== 'busy');
          const exams = examsByDate.get(dStr) || [];
          return { dStr, label, blocks, exams };
        });

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <CalendarDays className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>7-Day Mini Calendar</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('calendar')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Full Calendar →
                </button>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1.5">
                {weekDays.map((day, idx) => (
                  <button
                    key={day.dStr}
                    type="button"
                    onClick={() => onNavigate('calendar')}
                    className={`flex cursor-pointer flex-col items-center justify-between rounded-xl border p-2 text-center transition-colors hover:border-[var(--e3)] ${
                      day.exams.length > 0
                        ? 'border-[#111827] bg-[color-mix(in_srgb,#FDE047_18%,var(--bg))]'
                        : idx === 0
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_8%,var(--bg))]'
                        : 'border-[var(--line)] bg-[var(--bg)]'
                    }`}
                  >
                    <span className="text-[10px] font-bold text-[var(--mute)]">{day.label}</span>
                    <span className="font-mono-num my-1 text-base font-extrabold text-[var(--ink)]">
                      {day.blocks.length}
                    </span>
                    <span className="text-[10px] text-[var(--mute)]">
                      {day.exams.length > 0 ? (
                        <span className="inline-block rounded border border-[#111827] bg-[#FDE047] px-1 text-[9px] font-black uppercase tracking-wider text-[#111827]">
                          {day.exams.length > 1 ? `${day.exams.length} EXAMS` : 'EXAM'}
                        </span>
                      ) : (
                        'sess.'
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      }

      case 'fullCalendar': {
        const calDow = (iso: string) => (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
        const addIso = (iso: string, days: number) => {
          const dt = new Date(`${iso}T12:00:00`);
          dt.setDate(dt.getDate() + days);
          return dt.toISOString().slice(0, 10);
        };
        const stepCal = (dir: -1 | 1) => {
          if (fullCalMode === 'month') {
            const dt = new Date(`${fullCalRefDate.slice(0, 8)}01T12:00:00`);
            dt.setMonth(dt.getMonth() + dir);
            setFullCalRefDate(dt.toISOString().slice(0, 10));
          } else {
            setFullCalRefDate(addIso(fullCalRefDate, dir * 7));
          }
        };

        const titleLabel =
          fullCalMode === 'month'
            ? new Date(`${fullCalRefDate}T12:00:00`).toLocaleDateString('en-GB', {
                month: 'long',
                year: 'numeric',
              })
            : (() => {
                const mon = addIso(fullCalRefDate, -calDow(fullCalRefDate));
                const sun = addIso(mon, 6);
                return `${formatShortDate(mon)} – ${formatShortDate(sun)}`;
              })();

        const monthCells: Array<{ iso: string; outside: boolean }> = [];
        if (fullCalMode === 'month') {
          const first = `${fullCalRefDate.slice(0, 8)}01`;
          const startGrid = addIso(first, -calDow(first));
          const curYm = fullCalRefDate.slice(0, 7);
          for (let k = 0; k < 42; k++) {
            const d = addIso(startGrid, k);
            const outside = d.slice(0, 7) !== curYm;
            if (k >= 35 && outside && calDow(d) === 0) break;
            monthCells.push({ iso: d, outside });
          }
        }

        const weekDays = Array.from({ length: 7 }, (_, i) => {
          const mon = addIso(fullCalRefDate, -calDow(fullCalRefDate));
          return addIso(mon, i);
        });

        const dayExams = examsByDate.get(fullCalSelectedDay) || [];
        const dayBlocks = nonExamBlocksByDate.get(fullCalSelectedDay) || [];
        const dayTodos = todosByDate.get(fullCalSelectedDay) || [];

        return (
          <div className="space-y-4">
            {/* Header Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="font-display flex items-center gap-2 text-lg font-bold text-[var(--ink)]">
                  <CalendarDays className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>{titleLabel}</span>
                </h2>
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--mute)]">
                  <span className="rounded border border-[#111827] bg-[#FDE047] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#111827]">
                    EXAM
                  </span>
                  <span>Exam Date</span>
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="sd-seg" role="tablist" aria-label="Dashboard calendar view">
                  <button
                    type="button"
                    aria-pressed={fullCalMode === 'month'}
                    onClick={() => setFullCalMode('month')}
                    className="sd-seg-btn"
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    aria-pressed={fullCalMode === 'week'}
                    onClick={() => setFullCalMode('week')}
                    className="sd-seg-btn"
                  >
                    Week
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepCal(-1)}
                    aria-label="Previous period"
                    className="sd-btn h-7 w-7 p-0"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFullCalRefDate(todayStr);
                      setFullCalSelectedDay(todayStr);
                    }}
                    className="sd-btn px-2.5 py-1 text-xs"
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => stepCal(1)}
                    aria-label="Next period"
                    className="sd-btn h-7 w-7 p-0"
                  >
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('calendar')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Open Calendar Tab →
                </button>
              </div>
            </div>

            {/* Month Grid */}
            {fullCalMode === 'month' ? (
              <div className="grid grid-cols-7 gap-1">
                {WEEK_LABELS.map((d) => (
                  <div
                    key={d}
                    className="py-1 text-center text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]"
                  >
                    {d}
                  </div>
                ))}
                {monthCells.map(({ iso, outside }) => {
                  const isToday = iso === todayStr;
                  const isSel = iso === fullCalSelectedDay;
                  const exs = examsByDate.get(iso) || [];
                  const blks = nonExamBlocksByDate.get(iso) || [];
                  const tds = todosByDate.get(iso) || [];
                  const visibleTds = tds.slice(0, 1);
                  const visibleBlks = blks.slice(0, 2);
                  const hiddenCount = Math.max(0, tds.length - visibleTds.length + blks.length - visibleBlks.length);
                  return (
                    <button
                      key={iso}
                      type="button"
                      onClick={() => setFullCalSelectedDay(iso)}
                      className={`flex min-h-[88px] cursor-pointer flex-col gap-1 rounded-xl border p-1.5 text-left transition-colors ${
                        isSel
                          ? 'border-[var(--e3)] ring-2 ring-[var(--e3)]/40 bg-[color-mix(in_srgb,var(--e3)_6%,var(--bg))]'
                          : isToday
                          ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_4%,var(--bg))]'
                          : 'border-[var(--line)] bg-[var(--bg)] hover:border-[var(--mute)]'
                      } ${outside ? 'opacity-45' : ''}`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span
                          className={`font-mono-num text-xs font-bold ${
                            isToday ? 'text-[var(--e3)]' : 'text-[var(--ink)]'
                          }`}
                        >
                          {Number(iso.slice(8))}
                        </span>
                        {blks.length > 0 && (
                          <span className="font-mono-num text-[10px] text-[var(--mute)]">
                            {blks.filter((b) => b.done).length}/{blks.length}
                          </span>
                        )}
                      </div>

                      {exs.map((ex) => (
                        <div
                          key={ex.id}
                          className="flex w-full items-center gap-1 truncate rounded border border-[#111827] bg-[#FDE047] px-1 py-0.5 text-[10px] font-extrabold text-[#111827]"
                          title={`${ex.displayLabel} · ${ex.startTime} (${ex.durationMins}m)`}
                        >
                          <span className="shrink-0 rounded bg-[#111827] px-1 text-[8px] font-black uppercase text-[#FDE047]">
                            EXAM
                          </span>
                          <span className="truncate">{ex.displayLabel}</span>
                        </div>
                      ))}

                      {visibleTds.map((td) => {
                        const col = (td.subjectId && subjectMap.get(td.subjectId)?.color) || 'var(--ok)';
                        return (
                          <div
                            key={td.id}
                            style={{
                              borderLeftColor: col,
                              backgroundColor: `color-mix(in srgb, ${col} 14%, var(--card))`,
                            }}
                            className={`w-full truncate rounded border-l-[3px] px-1 py-0.5 text-[10px] font-medium ${
                              td.done ? 'line-through opacity-50' : 'text-[var(--ink)]'
                            }`}
                          >
                            ✓ {td.title}
                          </div>
                        );
                      })}

                      {visibleBlks.map((b) => {
                        const col =
                          b.kind === 'busy'
                            ? 'var(--mute)'
                            : (b.subjectId && subjectMap.get(b.subjectId)?.color) || 'var(--e3)';
                        return (
                          <div
                            key={b.id}
                            style={{
                              borderLeftColor: col,
                              backgroundColor: `color-mix(in srgb, ${col} 16%, var(--card))`,
                            }}
                            className={`w-full truncate rounded border-l-[3px] px-1 py-0.5 text-[10px] font-medium ${
                              b.done ? 'line-through opacity-50' : 'text-[var(--ink)]'
                            }`}
                          >
                            {b.kind === 'busy'
                              ? b.title
                              : (b.subjectId && subjectMap.get(b.subjectId)?.name) || b.title}
                          </div>
                        );
                      })}

                      {hiddenCount > 0 && (
                        <span className="text-[10px] text-[var(--mute)]">+{hiddenCount} more</span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              /* Week Grid */
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
                {weekDays.map((iso) => {
                  const isToday = iso === todayStr;
                  const isSel = iso === fullCalSelectedDay;
                  const exs = examsByDate.get(iso) || [];
                  const blks = nonExamBlocksByDate.get(iso) || [];
                  const tds = todosByDate.get(iso) || [];
                  return (
                    <div
                      key={iso}
                      onClick={() => setFullCalSelectedDay(iso)}
                      className={`flex min-h-[175px] cursor-pointer flex-col gap-1.5 rounded-xl border p-2.5 transition-colors ${
                        isSel
                          ? 'border-[var(--e3)] ring-2 ring-[var(--e3)]/40 bg-[color-mix(in_srgb,var(--e3)_6%,var(--bg))]'
                          : isToday
                          ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_4%,var(--bg))]'
                          : 'border-[var(--line)] bg-[var(--bg)]'
                      }`}
                    >
                      <div className="flex items-center justify-between border-b border-[var(--line)] pb-1.5">
                        <span className="text-[11px] font-bold uppercase text-[var(--mute)]">
                          {WEEK_LABELS[calDow(iso)]}
                        </span>
                        <span
                          className={`font-mono-num text-sm font-extrabold ${
                            isToday ? 'text-[var(--e3)]' : 'text-[var(--ink)]'
                          }`}
                        >
                          {Number(iso.slice(8))}
                        </span>
                      </div>

                      {exs.map((ex) => (
                        <div
                          key={ex.id}
                          className="rounded-lg border-2 border-[#111827] bg-[#FDE047] px-2 py-1 text-[10px] font-extrabold text-[#111827]"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="rounded bg-[#111827] px-1 text-[8px] font-black uppercase text-[#FDE047]">
                              EXAM
                            </span>
                            <span className="font-mono-num">{ex.startTime}</span>
                          </div>
                          <div className="mt-0.5 truncate">{ex.displayLabel}</div>
                        </div>
                      ))}

                      {tds.map((td) => (
                        <div
                          key={td.id}
                          className={`truncate rounded-lg border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-[11px] font-semibold ${
                            td.done ? 'line-through opacity-50' : 'text-[var(--ink)]'
                          }`}
                        >
                          ✓ {td.title}
                        </div>
                      ))}

                      {blks.map((b) => {
                        const col =
                          b.kind === 'busy'
                            ? 'var(--mute)'
                            : (b.subjectId && subjectMap.get(b.subjectId)?.color) || 'var(--e3)';
                        return (
                          <div
                            key={b.id}
                            style={{
                              borderLeftColor: col,
                              backgroundColor: `color-mix(in srgb, ${col} 14%, var(--card))`,
                            }}
                            className={`rounded-lg border-l-[3px] px-2 py-1 text-[11px] ${
                              b.done ? 'line-through opacity-50' : 'text-[var(--ink)]'
                            }`}
                          >
                            <div className="font-mono-num text-[10px] text-[var(--mute)]">
                              {b.startTime} · {b.durationMins}m
                            </div>
                            <div className="truncate font-semibold">{b.title}</div>
                          </div>
                        );
                      })}

                      {exs.length === 0 && tds.length === 0 && blks.length === 0 && (
                        <div className="py-4 text-center text-[11px] text-[var(--mute)]">Rest day</div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Selected Day Detail & Quick-Add Drawer */}
            <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2">
                <div className="text-xs font-bold text-[var(--ink)]">
                  {formatShortDate(fullCalSelectedDay)}
                  {fullCalSelectedDay === todayStr ? ' · Today' : ''}
                </div>
                <span className="font-mono-num text-[11px] text-[var(--mute)]">
                  {dayExams.length} exam{dayExams.length === 1 ? '' : 's'} · {dayBlocks.length} session
                  {dayBlocks.length === 1 ? '' : 's'} · {dayTodos.length} task
                  {dayTodos.length === 1 ? '' : 's'}
                </span>
              </div>

              {(dayExams.length > 0 || dayBlocks.length > 0 || dayTodos.length > 0) && (
                <div className="mt-2.5 space-y-1.5">
                  {dayExams.map((ex) => (
                    <div
                      key={ex.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border-2 border-[#111827] bg-[#FDE047] px-3 py-1.5 text-xs font-extrabold text-[#111827]"
                    >
                      <span className="flex items-center gap-2">
                        <span className="rounded bg-[#111827] px-1.5 py-0.5 text-[9px] font-black uppercase text-[#FDE047]">
                          EXAM
                        </span>
                        <span>{ex.displayLabel}</span>
                      </span>
                      <span className="font-mono-num text-[11px]">
                        {ex.startTime} · {ex.durationMins}m
                      </span>
                    </div>
                  ))}

                  {dayTodos.map((td) => (
                    <button
                      key={td.id}
                      type="button"
                      onClick={() => toggleTodoDone(td.id)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 text-left text-xs hover:border-[var(--e3)]"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                            td.done
                              ? 'border-[var(--ok)] bg-[var(--ok)] text-white'
                              : 'border-[var(--mute)]'
                          }`}
                        >
                          {td.done && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                        </span>
                        <span className={`truncate font-semibold ${td.done ? 'line-through opacity-55' : 'text-[var(--ink)]'}`}>
                          {td.title}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-[var(--mute)]">Due Task</span>
                    </button>
                  ))}

                  {dayBlocks.map((b) => {
                    const subj = b.subjectId ? subjectMap.get(b.subjectId) : undefined;
                    return (
                      <div
                        key={b.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-1.5 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => toggleBlockDone(b.id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                        >
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              b.done
                                ? 'border-[var(--ok)] bg-[var(--ok)] text-white'
                                : 'border-[var(--mute)]'
                            }`}
                          >
                            {b.done && <Check className="h-2.5 w-2.5" aria-hidden="true" />}
                          </span>
                          <span className={`truncate font-semibold ${b.done ? 'line-through opacity-55' : 'text-[var(--ink)]'}`}>
                            {b.title}
                          </span>
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="font-mono-num text-[11px] text-[var(--mute)]">
                            {b.startTime} · {b.durationMins}m
                          </span>
                          {b.kind !== 'busy' && (
                            <button
                              type="button"
                              onClick={() =>
                                onNavigate('planner', {
                                  plannerTab: 'timer',
                                  subjectId: subj?.id,
                                })
                              }
                              className="cursor-pointer rounded border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--e3)] hover:border-[var(--e3)]"
                            >
                              Focus
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <form onSubmit={handleAddQuickCalendarSession} className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-2.5">
                <input
                  type="text"
                  value={fullCalQuickTitle}
                  onChange={(e) => setFullCalQuickTitle(e.target.value)}
                  placeholder={`Schedule session on ${formatShortDate(fullCalSelectedDay)}…`}
                  className="sd-input min-w-[170px] flex-1 py-1 text-xs"
                />
                {workspace.subjects.length > 0 && (
                  <select
                    aria-label="Session subject"
                    value={fullCalQuickSubjId}
                    onChange={(e) => setFullCalQuickSubjId(e.target.value)}
                    className="sd-input w-auto max-w-[140px] py-1 text-xs"
                  >
                    <option value="">General</option>
                    {workspace.subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="time"
                  aria-label="Session start time"
                  value={fullCalQuickTime}
                  onChange={(e) => setFullCalQuickTime(e.target.value)}
                  className="sd-input w-auto py-1 text-xs"
                />
                <select
                  aria-label="Session duration"
                  value={fullCalQuickMins}
                  onChange={(e) => setFullCalQuickMins(Number(e.target.value))}
                  className="sd-input w-auto py-1 text-xs"
                >
                  <option value={25}>25m</option>
                  <option value={45}>45m</option>
                  <option value={60}>60m</option>
                </select>
                <button type="submit" className="sd-btn-pri px-3 py-1 text-xs whitespace-nowrap">
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  <span>Add</span>
                </button>
              </form>
            </div>
          </div>
        );
      }

      case 'examTimetable': {
        const upcoming = unifiedExams.filter((ex) => {
          const d = daysUntilDate(ex.date);
          return d !== null && d >= 0;
        });
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <GraduationCap className="h-4 w-4 text-[var(--ink)]" aria-hidden="true" />
                  <span>Exam Timetable ({upcoming.length})</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('calendar')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Open Calendar →
                </button>
              </div>

              {upcoming.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                  No upcoming exams scheduled yet. Add exam dates in Subjects or Calendar.
                </p>
              ) : (
                <div className="mt-3 max-h-[300px] space-y-2 overflow-y-auto pr-1">
                  {upcoming.slice(0, 10).map((ex) => {
                    const days = daysUntilDate(ex.date) ?? 0;
                    const stat = ex.subjectId
                      ? subjectStats.find((st) => st.subj.id === ex.subjectId)
                      : undefined;
                    return (
                      <div
                        key={ex.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="shrink-0 rounded border border-[#111827] bg-[#FDE047] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-[#111827]">
                              EXAM
                            </span>
                            <span className="truncate font-bold text-[var(--ink)]">
                              {ex.displayLabel}
                            </span>
                          </div>
                          <div className="font-mono-num mt-0.5 text-[11px] text-[var(--mute)]">
                            {formatShortDate(ex.date)} · {ex.startTime} ({ex.durationMins}m)
                            {stat ? ` · Readiness ${stat.readiness}%` : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`font-mono-num font-bold ${
                              days <= 3
                                ? 'text-[var(--bad)]'
                                : days <= 14
                                ? 'text-[var(--e2)]'
                                : 'text-[var(--ok)]'
                            }`}
                          >
                            {days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days}d`}
                          </span>
                          {ex.subjectId && (
                            <button
                              type="button"
                              onClick={() => onNavigate('subjects', { subjectId: ex.subjectId })}
                              className="cursor-pointer rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1 text-[11px] font-semibold text-[var(--e3)] hover:border-[var(--e3)]"
                            >
                              Revise
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'quickFlashcards': {
        const pool = workspace.flashcards.filter((c) => {
          if (fcWidgetSubjId !== 'ALL' && c.subjectId !== fcWidgetSubjId) return false;
          if (fcWidgetDueOnly && c.dueAt > nowMs) return false;
          return true;
        });
        const activePool =
          pool.length > 0
            ? pool
            : workspace.flashcards.filter(
                (c) => fcWidgetSubjId === 'ALL' || c.subjectId === fcWidgetSubjId
              );
        const card = activePool.length > 0 ? activePool[fcWidgetIdx % activePool.length] : null;
        const cardSubj = card ? subjectMap.get(card.subjectId) : undefined;

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <Layers className="h-4 w-4 text-[var(--ok)]" aria-hidden="true" />
                  <span>Quick Flashcard Review</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('flashcards')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Full Deck →
                </button>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <select
                  aria-label="Filter deck by subject"
                  value={fcWidgetSubjId}
                  onChange={(e) => {
                    setFcWidgetSubjId(e.target.value);
                    setFcWidgetIdx(0);
                    setFcWidgetFlipped(false);
                  }}
                  className="sd-input w-auto flex-1 py-1 text-xs"
                >
                  <option value="ALL">All Subjects ({workspace.flashcards.length})</option>
                  {workspace.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setFcWidgetDueOnly((v) => !v);
                    setFcWidgetIdx(0);
                    setFcWidgetFlipped(false);
                  }}
                  className={`sd-btn px-2.5 py-1 text-xs whitespace-nowrap ${
                    fcWidgetDueOnly ? 'border-[var(--ok)] text-[var(--ok)]' : ''
                  }`}
                >
                  {fcWidgetDueOnly ? 'Due Only' : 'All Cards'}
                </button>
              </div>

              {!card ? (
                <p className="mt-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                  No flashcards match this filter yet. Create cards in Flashcards or import a Quizlet deck.
                </p>
              ) : (
                <div className="mt-3 space-y-2.5">
                  <div className="flex items-center justify-between text-[11px] text-[var(--mute)]">
                    <span className="truncate font-semibold">
                      {cardSubj?.name || 'Subject'} · {card.sectionName}
                    </span>
                    <span className="font-mono-num shrink-0">
                      Box {card.box} · {(fcWidgetIdx % activePool.length) + 1}/{activePool.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFcWidgetFlipped((v) => !v)}
                    className="flex min-h-[104px] w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-center transition-colors hover:border-[var(--e3)]"
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--mute)]">
                      {fcWidgetFlipped ? 'Answer' : 'Question · Click to flip'}
                    </div>
                    <div className="mt-1.5 text-sm font-semibold leading-snug text-[var(--ink)]">
                      {fcWidgetFlipped ? card.a : card.q}
                    </div>
                  </button>

                  {fcWidgetFlipped ? (
                    <div className="grid grid-cols-4 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleRateQuickFlashcard(card.id, 'again')}
                        className="sd-btn py-1.5 text-xs font-bold text-[var(--bad)]"
                      >
                        Again
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRateQuickFlashcard(card.id, 'hard')}
                        className="sd-btn py-1.5 text-xs font-bold text-[var(--e2)]"
                      >
                        Hard
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRateQuickFlashcard(card.id, 'good')}
                        className="sd-btn py-1.5 text-xs font-bold text-[var(--e3)]"
                      >
                        Good
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRateQuickFlashcard(card.id, 'easy')}
                        className="sd-btn py-1.5 text-xs font-bold text-[var(--ok)]"
                      >
                        Easy
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setFcWidgetFlipped(true)}
                        className="sd-btn-pri flex-1 py-1.5 text-xs"
                      >
                        <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Show Answer</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFcWidgetFlipped(false);
                          setFcWidgetIdx((i) => i + 1);
                        }}
                        className="sd-btn px-3 py-1.5 text-xs"
                      >
                        Skip
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'quickNotes': {
        const q = notesWidgetQuery.trim().toLowerCase();
        const noteTopics = workspace.topics
          .filter((t) => {
            if (notesWidgetSubjId !== 'ALL' && t.subjectId !== notesWidgetSubjId) return false;
            const hasContent = !isNoteEmpty(t.notes) || (t.timelineEvents?.length || 0) > 0;
            if (!hasContent) return false;
            if (!q) return true;
            const subjName = subjectMap.get(t.subjectId)?.name.toLowerCase() || '';
            return (
              t.name.toLowerCase().includes(q) ||
              t.notes.summary.toLowerCase().includes(q) ||
              subjName.includes(q)
            );
          })
          .sort((a, b) => (b.notes.updatedAt || '').localeCompare(a.notes.updatedAt || ''))
          .slice(0, 6);

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <BookOpen className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Study Notes Finder</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('notes')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Open Notes →
                </button>
              </div>

              <div className="mt-2.5 flex flex-wrap gap-2">
                <div className="relative min-w-[150px] flex-1">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={notesWidgetQuery}
                    onChange={(e) => setNotesWidgetQuery(e.target.value)}
                    placeholder="Search notes…"
                    className="sd-input py-1 pl-8 text-xs"
                  />
                </div>
                <select
                  aria-label="Filter notes by subject"
                  value={notesWidgetSubjId}
                  onChange={(e) => setNotesWidgetSubjId(e.target.value)}
                  className="sd-input w-auto max-w-[140px] py-1 text-xs"
                >
                  <option value="ALL">All Subjects</option>
                  {workspace.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>

              {noteTopics.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                  No structured notes match this filter yet.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {noteTopics.map((tp) => {
                    const subj = subjectMap.get(tp.subjectId);
                    return (
                      <button
                        key={tp.id}
                        type="button"
                        onClick={() =>
                          onNavigate('notes', { subjectId: tp.subjectId, topicId: tp.id })
                        }
                        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-left text-xs transition-colors hover:border-[var(--e3)]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-bold text-[var(--ink)]">{tp.name}</div>
                          <div className="truncate text-[11px] text-[var(--mute)]">
                            {subj?.name || 'Subject'}
                            {tp.notes.keyTerms.length > 0
                              ? ` · ${tp.notes.keyTerms.length} key terms`
                              : ''}
                            {tp.timelineEvents && tp.timelineEvents.length > 0
                              ? ` · ${tp.timelineEvents.length} timeline events`
                              : ''}
                          </div>
                        </div>
                        <span className="shrink-0 font-semibold text-[var(--e3)]">Open →</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'subjectBreakdown': {
        const minsBySubj = new Map<string, number>();
        for (const entry of studyLog) {
          if (!entry.subjectId) continue;
          minsBySubj.set(entry.subjectId, (minsBySubj.get(entry.subjectId) || 0) + (entry.mins || 0));
        }
        const rows = workspace.subjects
          .map((s) => ({ subj: s, mins: minsBySubj.get(s.id) || 0 }))
          .sort((a, b) => b.mins - a.mins);
        const maxMins = Math.max(1, ...rows.map((r) => r.mins));
        const totalSubjMins = rows.reduce((acc, r) => acc + r.mins, 0);

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <BarChart3 className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Revision Time by Subject</span>
                </h2>
                <span className="font-mono-num text-xs font-semibold text-[var(--mute)]">
                  {(totalSubjMins / 60).toFixed(1)}h logged
                </span>
              </div>

              {rows.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--mute)]">
                  Add subjects to see revision time per subject.
                </p>
              ) : (
                <div className="mt-3 max-h-[280px] space-y-2.5 overflow-y-auto pr-1">
                  {rows.map(({ subj, mins }) => {
                    const pct = Math.round((mins / maxMins) * 100);
                    return (
                      <div key={subj.id} className="space-y-1 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 items-center gap-2 font-semibold text-[var(--ink)]">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: subj.color }}
                            />
                            <span className="truncate">{subj.name}</span>
                          </span>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-mono-num text-[11px] font-semibold text-[var(--mute)]">
                              {mins}m
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateWorkspace((prev) =>
                                  addLoggedStudyMinutes(prev, 25, {
                                    subjectId: subj.id,
                                    kind: 'manual',
                                    note: 'Quick +25m',
                                  })
                                )
                              }
                              className="cursor-pointer rounded border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 font-mono-num text-[10px] font-semibold text-[var(--e3)] hover:border-[var(--e3)]"
                            >
                              +25m
                            </button>
                          </div>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg)]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: subj.color }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'topicChecklist': {
        const activeSubjId =
          checklistSubjId && subjectMap.has(checklistSubjId)
            ? checklistSubjId
            : workspace.subjects[0]?.id || '';
        const subjTopics = workspace.topics.filter((t) => {
          if (activeSubjId && t.subjectId !== activeSubjId) return false;
          const conf = String(t.confidence ?? (t.completed ? 3 : 0));
          if (checklistFilter !== 'all' && conf !== checklistFilter) return false;
          return true;
        });

        const CONF_LABELS: Record<number, { text: string; cls: string }> = {
          0: { text: 'New', cls: 'border-[var(--line)] text-[var(--mute)]' },
          1: { text: 'Weak', cls: 'border-[var(--bad)] text-[var(--bad)]' },
          2: { text: 'Alright', cls: 'border-[var(--e2)] text-[var(--e2)]' },
          3: { text: 'Mastered', cls: 'border-[var(--ok)] text-[var(--ok)]' },
        };

        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <CheckSquare className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <span>Syllabus Checklist</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('subjects', { subjectId: activeSubjId })}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Open Subjects →
                </button>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <select
                  aria-label="Checklist subject"
                  value={activeSubjId}
                  onChange={(e) => setChecklistSubjId(e.target.value)}
                  className="sd-input w-auto flex-1 py-1 text-xs"
                >
                  {workspace.subjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Filter by confidence"
                  value={checklistFilter}
                  onChange={(e) => setChecklistFilter(e.target.value as 'all' | '0' | '1' | '2' | '3')}
                  className="sd-input w-auto py-1 text-xs"
                >
                  <option value="all">All</option>
                  <option value="0">Unstarted</option>
                  <option value="1">Weak</option>
                  <option value="2">Alright</option>
                  <option value="3">Mastered</option>
                </select>
              </div>

              {subjTopics.length === 0 ? (
                <p className="mt-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                  No topics match this filter yet.
                </p>
              ) : (
                <div className="mt-3 max-h-[250px] space-y-1.5 overflow-y-auto pr-1">
                  {subjTopics.map((tp) => {
                    const conf = tp.confidence ?? (tp.completed ? 3 : 0);
                    const badge = CONF_LABELS[conf] || CONF_LABELS[0];
                    return (
                      <div
                        key={tp.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => cycleTopicConfidence(tp.id)}
                          className={`shrink-0 cursor-pointer rounded border bg-[var(--card)] px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}
                          title="Click to cycle confidence"
                        >
                          {badge.text}
                        </button>
                        <span className="min-w-0 flex-1 truncate font-medium text-[var(--ink)]">
                          {tp.name}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            onNavigate('notes', { subjectId: tp.subjectId, topicId: tp.id })
                          }
                          className="shrink-0 cursor-pointer text-[11px] font-semibold text-[var(--e3)] hover:underline"
                        >
                          Notes →
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      }

      case 'gradeTargetTracker': {
        const scores = workspace.paperScores || [];
        return (
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <h2 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                  <Award className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
                  <span>Target Grades &amp; Readiness</span>
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('progress')}
                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                >
                  Progress →
                </button>
              </div>

              {subjectStats.length === 0 ? (
                <p className="mt-3 text-xs text-[var(--mute)]">
                  Add subjects to set target grades and track exam readiness.
                </p>
              ) : (
                <div className="mt-3 max-h-[280px] overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--line)] text-[11px] text-[var(--mute)]">
                        <th className="py-1.5 font-semibold">Subject</th>
                        <th className="py-1.5 font-semibold">Target</th>
                        <th className="py-1.5 text-right font-semibold">Syllabus</th>
                        <th className="py-1.5 text-right font-semibold">Mock Avg</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {subjectStats.map((row) => {
                        const subjScores = scores.filter((sc) => sc.subjectId === row.subj.id && sc.total > 0);
                        const avgPct =
                          subjScores.length > 0
                            ? Math.round(
                                subjScores.reduce((acc, sc) => acc + (sc.mark / sc.total) * 100, 0) /
                                  subjScores.length
                              )
                            : null;
                        return (
                          <tr key={row.subj.id}>
                            <td className="py-2 pr-2 font-semibold text-[var(--ink)]">
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: row.subj.color }}
                                />
                                <span className="truncate max-w-[140px]">{row.subj.name}</span>
                              </span>
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="text"
                                aria-label={`Target grade for ${row.subj.name}`}
                                value={row.subj.targetGrade || ''}
                                onChange={(e) => {
                                  const nextGrade = e.target.value;
                                  onUpdateWorkspace((prev) => ({
                                    ...prev,
                                    subjects: prev.subjects.map((s) =>
                                      s.id === row.subj.id ? { ...s, targetGrade: nextGrade } : s
                                    ),
                                  }));
                                }}
                                placeholder="e.g. 9 / A*"
                                className="sd-input w-20 py-0.5 text-center font-mono-num text-xs"
                              />
                            </td>
                            <td className="py-2 text-right font-mono-num font-bold text-[var(--ink)]">
                              {row.readiness}%
                            </td>
                            <td className="py-2 text-right font-mono-num font-semibold text-[var(--mute)]">
                              {avgPct !== null ? `${avgPct}%` : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        );
      }
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {/* Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
              Revision Home
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              <span className="font-mono-num font-semibold text-[var(--ink)]">
                {workspace.studyStreakDays} day streak
              </span>{' '}
              ·{' '}
              <span className="font-mono-num">{workspace.studyMinutesLogged} mins logged</span> ·{' '}
              <span className="font-mono-num">{workspace.subjects.length} subjects</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={importingHowes}
              onClick={() => void handleImportHowesNotes()}
              className="sd-btn-pri px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{importingHowes ? "Importing Howe's notes…" : "Import Howe's notes"}</span>
            </button>
            <button
              type="button"
              onClick={onOpenImport}
              className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Import Notes / Quizlet</span>
            </button>
            <button
              type="button"
              onClick={() => setCustomizeOpen((v) => !v)}
              aria-expanded={customizeOpen}
              className={`sd-btn px-3.5 py-2 text-xs whitespace-nowrap shrink-0 ${
                customizeOpen ? 'border-[var(--e3)] text-[var(--e3)]' : ''
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{customizeOpen ? 'Done Customizing' : 'Customize Widgets'}</span>
            </button>
          </div>
        </div>

        {howesImportMsg && (
          <div
            role="status"
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-semibold ${
              howesImportMsg.ok
                ? 'border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_9%,var(--card))] text-[var(--ink)]'
                : 'border-[var(--bad)] bg-[var(--card)] text-[var(--bad)]'
            }`}
          >
            <span>{howesImportMsg.msg}</span>
            <button
              type="button"
              onClick={() => setHowesImportMsg(null)}
              aria-label="Dismiss import message"
              className="cursor-pointer p-1 text-[var(--mute)] hover:text-[var(--ink)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Interactive Widget Customizer Tray with Categories */}
        {customizeOpen && (
          <section className="sd-card space-y-4 border-[var(--e3)] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-display text-base font-bold text-[var(--ink)]">
                  Design your Homepage ({layout.length} of {WIDGET_CATALOG.length} active)
                </h2>
                <p className="text-xs text-[var(--mute)]">
                  Add or remove widgets below · Drag headers or use ↑ ↓ arrows to reorder · Use width
                  presets or drag edges &amp; bottom-right corners to resize.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleResetWidgets}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  Reset Default
                </button>
                <button
                  type="button"
                  onClick={() => setCustomizeOpen(false)}
                  className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  Done
                </button>
              </div>
            </div>

            {/* Category filter & search */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
              <div className="flex flex-wrap gap-1.5">
                {CATEGORY_TABS.map((cat) => {
                  const count =
                    cat === 'All'
                      ? WIDGET_CATALOG.filter((m) => !activeWidgetIds.has(m.id)).length
                      : WIDGET_CATALOG.filter((m) => m.category === cat && !activeWidgetIds.has(m.id))
                          .length;
                  const active = trayCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setTrayCategory(cat)}
                      className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                        active
                          ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))] text-[var(--e3)]'
                          : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {cat} ({count})
                    </button>
                  );
                })}
              </div>
              <div className="relative min-w-[190px]">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={widgetSearch}
                  onChange={(e) => setWidgetSearch(e.target.value)}
                  placeholder="Search widgets…"
                  className="sd-input py-1 pl-8 text-xs"
                />
              </div>
            </div>

            {unusedCatalog.length > 0 ? (
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {unusedCatalog.map((meta) => (
                  <button
                    key={meta.id}
                    type="button"
                    onClick={() => addWidget(meta.id)}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--e3)]"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--ink)]">{meta.label}</div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-[var(--mute)]">
                        {meta.desc}
                      </div>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-[var(--e3)]">+ Add</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--mute)]">
                All widgets in this category are already on your Home page. Remove any card below or
                switch category tabs above to browse more widgets.
              </p>
            )}
          </section>
        )}

        {/* Modular 12-Column Draggable & Resizable Widget Grid */}
        {layout.length === 0 ? (
          <div className="sd-card p-8 text-center">
            <p className="text-sm font-semibold text-[var(--ink)]">No widgets on Home yet.</p>
            <p className="mt-1 text-xs text-[var(--mute)]">
              Click Customize Widgets to add Study Tasks, Focus Timer, Progress Charts, or Exam Countdowns.
            </p>
            <button
              type="button"
              onClick={() => setCustomizeOpen(true)}
              className="sd-btn-pri mt-4 px-4 py-2 text-xs"
            >
              Add Widgets
            </button>
          </div>
        ) : (
          <div ref={gridRef} className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {layout.map((item, idx) => {
              const meta = WIDGET_CATALOG.find((m) => m.id === item.id);
              if (!meta) return null;
              const colClass = COL_SPAN_CLASS[item.cols] || 'lg:col-span-6';
              const isOver = dragOverWidgetId === item.id && dragWidgetId !== item.id;
              return (
                <section
                  key={item.id}
                  draggable={customizeOpen}
                  onDragStart={(e) => {
                    if (!customizeOpen) return;
                    setDragWidgetId(item.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.id);
                  }}
                  onDragOver={(e) => {
                    if (!customizeOpen || !dragWidgetId) return;
                    e.preventDefault();
                    if (dragOverWidgetId !== item.id) setDragOverWidgetId(item.id);
                  }}
                  onDragLeave={() => {
                    if (dragOverWidgetId === item.id) setDragOverWidgetId(null);
                  }}
                  onDrop={(e) => {
                    if (!customizeOpen || !dragWidgetId) return;
                    e.preventDefault();
                    reorderWidgets(dragWidgetId, item.id);
                    setDragWidgetId(null);
                    setDragOverWidgetId(null);
                  }}
                  onDragEnd={() => {
                    setDragWidgetId(null);
                    setDragOverWidgetId(null);
                  }}
                  style={item.h ? { minHeight: `${item.h}px` } : undefined}
                  className={`sd-card relative flex flex-col p-5 transition-all ${colClass} ${
                    customizeOpen ? 'ring-1 ring-[var(--e3)]/40' : ''
                  } ${isOver ? 'ring-2 ring-[var(--e3)]' : ''}`}
                >
                  {customizeOpen && (
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5 text-xs">
                      <span className="flex cursor-grab items-center gap-1.5 font-bold text-[var(--e3)] active:cursor-grabbing">
                        <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{meta.label}</span>
                      </span>

                      <div className="flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => moveWidget(idx, -1)}
                          disabled={idx === 0}
                          aria-label="Move earlier"
                          className="sd-btn h-6 w-6 p-0"
                        >
                          <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveWidget(idx, 1)}
                          disabled={idx === layout.length - 1}
                          aria-label="Move later"
                          className="sd-btn h-6 w-6 p-0"
                        >
                          <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => updateWidgetSize(item.id, { cols: item.cols - 1 })}
                          disabled={item.cols <= 3}
                          aria-label="Narrower"
                          className="sd-btn h-6 w-6 p-0"
                        >
                          <Minus className="h-3 w-3" aria-hidden="true" />
                        </button>
                        <span className="font-mono-num px-1 text-[11px] font-semibold text-[var(--mute)]">
                          {item.cols}/12
                        </span>
                        <button
                          type="button"
                          onClick={() => updateWidgetSize(item.id, { cols: item.cols + 1 })}
                          disabled={item.cols >= 12}
                          aria-label="Wider"
                          className="sd-btn h-6 w-6 p-0"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                        </button>
                        {[
                          [3, '25%'],
                          [6, '50%'],
                          [9, '75%'],
                          [12, '100%'],
                        ].map(([cols, label]) => (
                          <button
                            key={cols}
                            type="button"
                            onClick={() => updateWidgetSize(item.id, { cols: Number(cols) })}
                            className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono-num text-[10px] font-semibold ${
                              item.cols === cols
                                ? 'border-[var(--e3)] bg-[var(--e3)] text-white'
                                : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)]'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                        {item.h && (
                          <button
                            type="button"
                            onClick={() => updateWidgetSize(item.id, { h: null })}
                            className="cursor-pointer rounded border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--mute)]"
                          >
                            Auto H
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeWidget(item.id)}
                          aria-label={`Remove ${meta.label}`}
                          className="sd-btn ml-1 h-6 w-6 p-0 text-[var(--bad)]"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="min-h-0 flex-1">{renderWidgetBody(item.id)}</div>

                  {customizeOpen && (
                    <>
                      <div
                        onPointerDown={(e) => startResize(e, item, 'width')}
                        title="Drag right edge to resize width"
                        className="hidden cursor-ew-resize lg:block absolute inset-y-3 right-0 w-2 opacity-0 transition-opacity hover:bg-[var(--e3)]/40 hover:opacity-100"
                      />
                      <div
                        onPointerDown={(e) => startResize(e, item, 'height')}
                        title="Drag bottom edge to resize height"
                        className="hidden cursor-ns-resize lg:block absolute inset-x-3 bottom-0 h-2 opacity-0 transition-opacity hover:bg-[var(--e3)]/40 hover:opacity-100"
                      />
                      <div
                        onPointerDown={(e) => startResize(e, item, 'both')}
                        title="Drag corner to resize width & height"
                        className="hidden cursor-nwse-resize lg:block absolute right-1 bottom-1 h-3.5 w-3.5 rounded-br border-r-2 border-b-2 border-[var(--e3)]/60"
                      />
                    </>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
