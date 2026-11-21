import { Timestamp } from 'firebase/firestore';

export type UserRole = 'student' | 'educator' | 'admin';
export type EncryptionMode = 'passphrase' | 'device-wrapped';
export type AppModule = 'revision' | 'planner';

export type WorkspaceTab =
  | 'home'
  | 'subjects'
  | 'notes'
  | 'flashcards'
  | 'calendar'
  | 'planner'
  | 'quiz'
  | 'community'
  | 'progress'
  | 'vault'
  | 'admin';

export type PlannerSubTab = 'calendar' | 'todo' | 'timer';

export interface UserAccountDoc {
  uid: string;
  role: UserRole;
  displayName: string;
  encryptionMode: EncryptionMode;
  keySalt: string;
  wrappedDek: string;
  wrappedDekIv: string;
  recoveryWrappedDek?: string;
  recoveryWrappedDekIv?: string;
  keyVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface DecryptedProfile {
  email: string;
  fullName: string;
  school: string;
  yearGroup: string;
  examBoard: string;
  targetGrades: string;
  studyNotes: string;
}

export interface EncryptedSyncDocRecord {
  ownerId: string;
  app: AppModule;
  chunkKey: string;
  chunkIndex: number;
  totalChunks: number;
  ciphertext: string;
  iv: string;
  alg: 'AES-GCM-256';
  checksum: string;
  deviceId: string;
  deviceName: string;
  keyVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface UserDeviceDoc {
  ownerId: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  lastSeenAt: Timestamp;
  createdAt: Timestamp;
}

export interface UserActivityDoc {
  id: string;
  ownerId: string;
  action: string;
  deviceName: string;
  createdAt: Timestamp;
}

export interface LiveTimerState {
  active: boolean;
  running: boolean;
  text: string;
  mode: string;
  subject: string;
}

export interface StopwatchState {
  running: boolean;
  elapsedSec: number;
  text: string;
  subjectId?: string;
  subjectName: string;
  topicId?: string;
  topicName?: string;
  laps: number[];
  dismissed: boolean;
}

export type ColorPalette =
  | ''
  | 'paper'
  | 'sage'
  | 'contrast'
  | 'ocean'
  | 'lavender'
  | 'rose'
  | 'sand'
  | 'nord'
  | 'emerald'
  | 'custom';

export interface CustomThemeTokens {
  bg: string;
  card: string;
  ink: string;
  accent: string;
  line: string;
}

export interface SavedCustomTheme {
  id: string;
  name: string;
  tokens: CustomThemeTokens;
}

export interface AppearanceSettings {
  th: '' | 'light' | 'dark';
  pal?: ColorPalette;
  zm: number;
  lh: number;
  mw: string;
  ff: string;
  customTheme?: CustomThemeTokens;
  savedThemes?: SavedCustomTheme[];
}

export interface PlannerUiSettings {
  acc?: string;
  w?: string;
  dn?: string;
  rad?: number;
  ttl?: string;
  sub?: string;
  hsub?: boolean;
  tc?: number;
  pc?: number;
}

// ============================================================================
// Unified Native Workspace Data Model (v2)
// ============================================================================

export type NotePartRole = 'core' | 'process' | 'compare' | 'example' | 'risk';

export interface NoteSectionBlock {
  id: string;
  heading: string;
  points: string[];
  accentColor?: NoteAccentColor;
  partRole?: NotePartRole;
}

export interface KeyTermPair {
  id: string;
  term: string;
  definition: string;
}

export interface TimelineEventItem {
  id: string;
  date: string;
  title: string;
  detail: string;
  significance?: string;
  era?: string;
  keyEvent?: boolean;
}

export type NoteAccentColor = 'default' | 'blue' | 'green' | 'purple' | 'amber' | 'rose';

export interface StructuredNoteData {
  summary: string;
  sections: NoteSectionBlock[];
  keyTerms: KeyTermPair[];
  examTip: string;
  workedExample: string;
  accentColor?: NoteAccentColor;
  legacyHtml?: string;
  originalHtml?: string;
  preferOriginalFormat?: boolean;
  updatedAt: string;
}

export interface StudyTopic {
  id: string;
  subjectId: string;
  parentTopicId?: string;
  name: string;
  specCode?: string;
  tags?: string[];
  completed?: boolean;
  confidence?: 0 | 1 | 2 | 3; // 0=Not started, 1=Weak/Red, 2=Alright/Amber, 3=Mastered/Green
  notes: StructuredNoteData;
  timelineEvents?: TimelineEventItem[];
  createdAt: string;
}

export interface StudySubject {
  id: string;
  name: string;
  examBoard: string;
  color: string;
  examDate: string;
  weight: 1 | 2 | 3; // 1=Low, 2=Standard, 3=High priority
  targetGrade?: string;
  hasTimeline?: boolean;
  createdAt: string;
}

export interface StudyFlashcard {
  id: string;
  subjectId: string;
  topicId: string;
  sectionName: string;
  q: string;
  a: string;
  box: 1 | 2 | 3 | 4 | 5;
  dueAt: number;
  lastReviewedAt?: number;
  flagged: boolean;
  createdAt: string;
}

export interface TodoStepItem {
  text: string;
  done: boolean;
}

export interface TodoTaskItem {
  id: string;
  title: string;
  subjectId?: string;
  dueDate: string;
  priority: 0 | 1 | 2 | 3; // 0=None, 1=Low, 2=Normal, 3=High
  done: boolean;
  doneAt?: string;
  category?: 'exam' | 'hw' | 'oth';
  starred?: boolean;
  addedToday?: string; // YYYY-MM-DD
  tags?: string[];
  estMins?: number;
  repeat?: '' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
  steps?: TodoStepItem[];
  note?: string;
  createdAt: string;
}

export interface CalendarStudyBlock {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  durationMins: number;
  endTime?: string; // HH:mm optional (used for busy blocks)
  title: string;
  subjectId?: string;
  topicId?: string;
  kind: 'revision' | 'exam' | 'past-paper' | 'flashcards' | 'busy';
  done: boolean;
  manual?: boolean;
}

export interface PlannerSchedulePrefs {
  weekdayStart: string;
  weekendStart: string;
  availHours: number[]; // Mon..Sun 7 numbers
}

export interface HomeWidgetPrefs {
  dueCards: boolean;
  schedule: boolean;
  timer: boolean;
  todos: boolean;
  mastery: boolean;
}

export type HomeWidgetId =
  | 'todayOverview'
  | 'todayTasks'
  | 'dueCards'
  | 'timer'
  | 'schedule'
  | 'todos'
  | 'mastery'
  | 'dailyGoal'
  | 'examCountdowns'
  | 'scratchpad'
  | 'flashcardBreakdown'
  | 'liveQuiz'
  | 'studyGuide'
  | 'progOverview'
  | 'progWeek'
  | 'progHeatmap'
  | 'progPace'
  | 'progTodo'
  | 'progNumbers'
  | 'pastPapers'
  | 'sessionLog'
  | 'progHours'
  | 'weakTopics'
  | 'miniCalendar'
  | 'communityNotes';

export interface HomeWidgetLayoutItem {
  id: HomeWidgetId;
  cols: number; // 3..12 on 12-column desktop grid
  h?: number | null; // Optional custom height in px
}

export interface StudyLogEntry {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  mins: number;
  subjectId?: string;
  kind?: 'timer' | 'pomo' | 'manual' | 'recall';
  note?: string;
}

export interface PastPaperScore {
  id: string;
  subjectId?: string;
  paper: string;
  mark: number;
  total: number;
  date: string;
}

export interface CustomCountdownItem {
  id: string;
  title: string;
  date: string;
}

export interface DailyStudyTaskItem {
  id: string;
  subjectId: string;
  topicId?: string;
  kind: 'recall' | 'paper';
  done: number; // 0=pending, 1=weak, 2=alright, 3=mastered, 4=done
}

export interface WorkspaceData {
  version: 2;
  subjects: StudySubject[];
  topics: StudyTopic[];
  flashcards: StudyFlashcard[];
  todos: TodoTaskItem[];
  calendarBlocks: CalendarStudyBlock[];
  plannerPrefs?: PlannerSchedulePrefs;
  studyMinutesLogged: number;
  studyStreakDays: number;
  lastStudyDate: string;
  dailyGoalMinutes?: number;
  scratchpad?: string;
  studyLog?: StudyLogEntry[];
  paperScores?: PastPaperScore[];
  customCountdowns?: CustomCountdownItem[];
  dailyStudyTasks?: {
    date: string;
    items: DailyStudyTaskItem[];
  };
  homeWidgets: HomeWidgetPrefs;
  homeLayout?: HomeWidgetLayoutItem[];
  updatedAt: string;
}

// ============================================================================
// Community & Direct Sharing Types (Replaces Study Packs)
// ============================================================================

export type SharedItemType = 'notes' | 'flashcards' | 'subject';
export type SharedItemVisibility = 'public' | 'unlisted';

export interface SharedNotesSubTopic {
  oldId: string;
  parentOldId?: string;
  topicName: string;
  specCode?: string;
  tags?: string[];
  notes: StructuredNoteData;
  timelineEvents?: TimelineEventItem[];
}

export interface SharedNotesPayload {
  topicName: string;
  topicOldId?: string;
  specCode?: string;
  notes: StructuredNoteData;
  timelineEvents?: TimelineEventItem[];
  subTopics?: SharedNotesSubTopic[];
}

export interface SharedFlashcardsPayload {
  sectionName: string;
  cards: Array<{ q: string; a: string; sectionName?: string }>;
}

export interface SharedSubjectPayload {
  subject: {
    name: string;
    examBoard: string;
    color: string;
    hasTimeline?: boolean;
  };
  topics: Array<{
    name: string;
    parentTopicName?: string;
    specCode?: string;
    notes: StructuredNoteData;
    timelineEvents?: TimelineEventItem[];
  }>;
  cards: Array<{
    topicName: string;
    sectionName: string;
    q: string;
    a: string;
  }>;
}

export interface SharedStudyItem {
  id: string;
  shareCode: string;
  type: SharedItemType;
  title: string;
  subjectName: string;
  examBoard: string;
  summary: string;
  visibility: SharedItemVisibility;
  ownerId: string;
  ownerName: string;
  itemCount: number;
  copyCount: number;
  createdAt: string;
  updatedAt: string;
  notesPayload?: SharedNotesPayload;
  flashcardsPayload?: SharedFlashcardsPayload;
  subjectPayload?: SharedSubjectPayload;
}

// ============================================================================
// Live Quiz & Compatibility Snapshot Types
// ============================================================================

export interface DeckSubject {
  id: string;
  n: string;
  kind: 'tl' | 'doc';
  custom?: boolean;
}

export interface DeckTopic {
  id: string;
  name: string;
  label: string;
  subjId: string;
  subjName: string;
  views: {
    notes: boolean;
    timeline: boolean;
    mindmap: boolean;
  };
}

export interface DeckSection {
  id: string;
  topicId: string;
  name: string;
  subjId: string;
}

export interface DeckFlashcard {
  id: string;
  secId: string;
  secName: string;
  topicId: string;
  topicName: string;
  subjId: string;
  subjName: string;
  q: string;
  a: string;
  box: number;
  flagged: boolean;
  due: boolean;
}

export interface DeckSnapshot {
  subjects: DeckSubject[];
  topics: DeckTopic[];
  sections: DeckSection[];
  cards: DeckFlashcard[];
}

export interface QuizSectionInfo {
  name: string;
  count: number;
}

export interface QuizDeckSummary {
  id: string;
  title: string;
  cardCount: number;
  sections: QuizSectionInfo[];
  createdAt: string;
}

export interface QuizCardItem {
  id: string;
  deckId: string;
  question: string;
  answer: string;
  section: string;
  position: number;
}

export interface QuizDeckDetail extends QuizDeckSummary {
  cards: QuizCardItem[];
}

export interface QuizSubmissionInfo {
  answer: string;
  correct: boolean;
  gradingSource: 'local' | 'ai' | 'fallback';
  pointsAwarded: number;
  streakBonus: number;
  elapsedMs: number;
}

export interface QuizPlayerState {
  id: string;
  nickname: string;
  isHost: boolean;
  score: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  connected: boolean;
  hasSubmitted: boolean;
  gradingStatus: 'grading' | 'done' | null;
  lastSubmission: QuizSubmissionInfo | null;
}

export interface QuizRoomState {
  code: string;
  deckId: string;
  deckTitle: string;
  selectedSections: string[];
  timerSeconds: 15 | 20 | 30;
  status: 'lobby' | 'question' | 'reveal' | 'finished';
  totalQuestions: number;
  currentIndex: number;
  roundId?: string;
  questionStartedAt: number | null;
  questionEndsAt: number | null;
  serverNow: number;
  currentQuestion: {
    id: string;
    question: string;
    section: string;
    officialAnswer?: string;
  } | null;
  players: QuizPlayerState[];
}
