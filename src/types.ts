import { Timestamp } from 'firebase/firestore';

export type UserRole = 'student' | 'educator' | 'admin';
export type EncryptionMode = 'passphrase' | 'device-wrapped';
export type AppModule = 'revision' | 'planner';
export type WorkspaceTab = 'revision' | 'planner' | 'packs' | 'quiz' | 'vault' | 'admin';

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

export type ColorPalette = '' | 'paper' | 'sage' | 'contrast';

export interface AppearanceSettings {
  th: '' | 'light' | 'dark';
  pal?: ColorPalette;
  zm: number;
  lh: number;
  mw: string;
  ff: string;
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

export type StudyPackCategory = 'combo' | 'flashcards' | 'notes';

export interface StudyPackRevisionPayload {
  baseTopics?: string[];
  subjects?: Array<{
    id?: string;
    name: string;
    kind?: 'tl' | 'doc';
    views?: { notes?: boolean; timeline?: boolean; mindmap?: boolean };
    topics: Array<{
      id?: string;
      label: string;
      title?: string;
      sections?: string[];
      notesHtml?: string;
    }>;
  }>;
  sections?: Array<{
    id: string;
    topicId?: string;
    topicLabel?: string;
    subjectName?: string;
    name: string;
  }>;
  cards?: Array<{
    sectionId?: string;
    sectionName?: string;
    topicId?: string;
    topicLabel?: string;
    subjectName?: string;
    q: string;
    a: string;
  }>;
}

export interface StudyPackPlannerPayload {
  start?: string;
  subjects?: Array<{
    name: string;
    weight?: number;
    date?: string;
    topics: string[];
    exams?: Array<{ d: string; t: string; n: string }>;
  }>;
  todos?: Array<{
    title: string;
    due?: string;
    pri?: number;
    cat?: string;
    subjectName?: string;
    note?: string;
  }>;
}

export interface StudyPack {
  id: string;
  title: string;
  subtitle: string;
  category: StudyPackCategory;
  examBoard: string;
  highlights: string[];
  tags: string[];
  author?: string;
  isStandard?: boolean;
  isCustom?: boolean;
  visibility?: 'private' | 'public';
  ownerId?: string;
  ownerName?: string;
  createdAt?: string;
  cardCountPreview: number;
  topicCountPreview: number;
  subjectCountPreview: number;
  revision: StudyPackRevisionPayload;
  planner: StudyPackPlannerPayload;
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
