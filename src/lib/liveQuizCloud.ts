import { signInAnonymously } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { fastLocalQuizCheck, smartSemanticFallbackCheck } from './quizGrader';
import { QuizDeckSummary, QuizPlayerState, QuizRoomState } from '../types';

export interface CloudQuizCard {
  id: string;
  question: string;
  answer: string;
  section: string;
  position: number;
}

export interface CloudQuizDeck extends QuizDeckSummary {
  cards: CloudQuizCard[];
}

export interface CloudPlayerDoc {
  id: string;
  uid: string;
  nickname: string;
  isHost: boolean;
  score: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  connected: boolean;
  hasSubmitted: boolean;
  gradingStatus: 'grading' | 'done' | null;
  pendingAnswer?: string;
  pendingSubmittedAt?: number;
  pendingQuestionIndex?: number;
  pendingRoundId?: string;
  lastSubmissionJson?: string | null;
}

const LOCAL_DECKS_KEY = 'studydeck_cloud_quiz_decks_v1';
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeRoundId(index: number): string {
  return `r_${index}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function generateCandidateCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

export function shuffleCards<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function calculateQuizPoints(
  elapsedMs: number,
  timerSeconds: number,
  newStreak: number
): { basePoints: number; streakBonus: number; total: number } {
  const totalMs = Math.max(1000, timerSeconds * 1000);
  const clampedElapsed = Math.max(0, Math.min(totalMs, elapsedMs));
  const remainingRatio = (totalMs - clampedElapsed) / totalMs;
  const basePoints = 500 + Math.round(500 * remainingRatio);
  const streakBonus = newStreak >= 2 ? Math.min(300, (newStreak - 1) * 100) : 0;
  return {
    basePoints,
    streakBonus,
    total: basePoints + streakBonus,
  };
}

export async function gradeAnswerViaVercelOrLocal(
  question: string,
  officialAnswer: string,
  studentAnswer: string
): Promise<{ correct: boolean; source: 'local' | 'ai' | 'fallback' }> {
  const trimmed = String(studentAnswer || '').trim();
  if (!trimmed) {
    return { correct: false, source: 'local' };
  }
  if (fastLocalQuizCheck(trimmed, officialAnswer)) {
    return { correct: true, source: 'local' };
  }

  const controller = new AbortController();
  const abortTimer = window.setTimeout(() => controller.abort(), 5500);
  try {
    const res = await fetch('/api/quiz/grade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, officialAnswer, studentAnswer: trimmed }),
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return {
        correct: smartSemanticFallbackCheck(trimmed, officialAnswer),
        source: 'fallback',
      };
    }
    const data = (await res.json()) as {
      correct?: boolean;
      source?: 'local' | 'ai' | 'fallback';
    };
    return {
      correct: Boolean(data.correct),
      source: data.source || 'ai',
    };
  } catch {
    return {
      correct: smartSemanticFallbackCheck(trimmed, officialAnswer),
      source: 'fallback',
    };
  } finally {
    window.clearTimeout(abortTimer);
  }
}

export async function ensureQuizAuthUid(): Promise<string> {
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }
  try {
    const cred = await signInAnonymously(auth);
    return cred.user.uid;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Sign in with Google (top right) to host or join multiplayer rooms (${msg}).`
    );
  }
}

function readLocalDecks(): CloudQuizDeck[] {
  try {
    const raw = localStorage.getItem(LOCAL_DECKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CloudQuizDeck[]) : [];
  } catch {
    return [];
  }
}

function writeLocalDecks(decks: CloudQuizDeck[]): void {
  try {
    localStorage.setItem(LOCAL_DECKS_KEY, JSON.stringify(decks));
  } catch {
    // ignore storage quota errors
  }
}

function buildSectionsFromCards(cards: CloudQuizCard[]): Array<{ name: string; count: number }> {
  const map = new Map<string, number>();
  cards.forEach((c) => {
    const sec = (c.section || 'General').trim() || 'General';
    map.set(sec, (map.get(sec) || 0) + 1);
  });
  return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
}

export async function loadCloudDecks(): Promise<CloudQuizDeck[]> {
  const byId = new Map<string, CloudQuizDeck>();
  for (const d of readLocalDecks()) {
    if (d && d.id) byId.set(d.id, d);
  }

  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      const q = query(collection(db, 'quizDecks'), where('ownerId', '==', uid));
      const snap = await getDocs(q);
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        try {
          const cards = JSON.parse(String(d.cardsJson || '[]')) as CloudQuizCard[];
          const sections = JSON.parse(String(d.sectionsJson || '[]')) as Array<{
            name: string;
            count: number;
          }>;
          const createdAt =
            d.createdAt && typeof d.createdAt.toDate === 'function'
              ? d.createdAt.toDate().toISOString()
              : new Date().toISOString();
          byId.set(docSnap.id, {
            id: docSnap.id,
            title: String(d.title || 'Untitled Deck'),
            cardCount: Number(d.cardCount || cards.length),
            sections: Array.isArray(sections) ? sections : buildSectionsFromCards(cards),
            cards: Array.isArray(cards) ? cards : [],
            createdAt,
          });
        } catch {
          // ignore malformed doc
        }
      });
    } catch {
      // ignore if offline or unauthenticated
    }
  }

  const merged = Array.from(byId.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
  writeLocalDecks(merged);
  return merged;
}

export async function saveCloudDeck(
  title: string,
  rawCards: Array<{ question: string; answer: string; section: string }>
): Promise<CloudQuizDeck> {
  const cleanTitle = title.trim().slice(0, 140);
  const deckId = makeId('deck');
  const cards: CloudQuizCard[] = rawCards
    .map((c, idx) => ({
      id: makeId('card'),
      question: String(c.question || '').trim(),
      answer: String(c.answer || '').trim(),
      section: String(c.section || '').trim() || 'General',
      position: idx,
    }))
    .filter((c) => c.question && c.answer);

  const sections = buildSectionsFromCards(cards);
  const deck: CloudQuizDeck = {
    id: deckId,
    title: cleanTitle,
    cardCount: cards.length,
    sections,
    cards,
    createdAt: new Date().toISOString(),
  };

  const existing = readLocalDecks();
  writeLocalDecks([deck, ...existing]);

  if (auth.currentUser) {
    try {
      await setDoc(doc(db, 'quizDecks', deckId), {
        id: deckId,
        ownerId: auth.currentUser.uid,
        title: cleanTitle,
        cardCount: cards.length,
        sectionsJson: JSON.stringify(sections),
        cardsJson: JSON.stringify(cards),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch {
      // Keep local deck even if Firestore sync fails
    }
  }

  return deck;
}

export async function deleteCloudDeck(deckId: string): Promise<void> {
  const remaining = readLocalDecks().filter((d) => d.id !== deckId);
  writeLocalDecks(remaining);

  if (auth.currentUser) {
    try {
      await deleteDoc(doc(db, 'quizDecks', deckId));
    } catch {
      // local deletion already succeeded
    }
  }
}

export async function createCloudRoom(params: {
  deckId: string;
  deckTitle: string;
  selectedSections: string[];
  timerSeconds: 15 | 20 | 30;
  nickname: string;
  cards: Array<{ question: string; answer: string; section: string }>;
}): Promise<{
  code: string;
  playerId: string;
  questions: CloudQuizCard[];
}> {
  const uid = await ensureQuizAuthUid();
  const cleanNickname = params.nickname.trim().slice(0, 40);
  if (!cleanNickname) throw new Error('Enter your host nickname first.');
  if (!params.cards.length) throw new Error('Select at least one flashcard to start.');

  let code = '';
  for (let i = 0; i < 15; i++) {
    const candidate = generateCandidateCode();
    const snap = await getDoc(doc(db, 'quizRooms', candidate));
    if (!snap.exists()) {
      code = candidate;
      break;
    }
  }
  if (!code) {
    code = `QZ${Math.floor(10 + Math.random() * 89)}`;
  }

  const questions: CloudQuizCard[] = shuffleCards(
    params.cards.map((c, idx) => ({
      id: makeId('q'),
      question: c.question.trim(),
      answer: c.answer.trim(),
      section: c.section.trim() || 'General',
      position: idx,
    }))
  );

  const playerId = makeId('p');
  const activeSections = Array.from(new Set(questions.map((q) => q.section)));
  const initialRoundId = makeRoundId(-1);

  try {
    await setDoc(doc(db, 'quizRooms', code), {
      code,
      hostUid: uid,
      deckId: (params.deckId || 'inline_deck').slice(0, 128),
      deckTitle: (params.deckTitle || 'Live Flashcards').slice(0, 140),
      selectedSectionsJson: JSON.stringify(activeSections),
      timerSeconds: params.timerSeconds,
      status: 'lobby',
      totalQuestions: questions.length,
      currentIndex: 0,
      roundId: initialRoundId,
      questionStartedAt: null,
      questionEndsAt: null,
      currentQuestionJson: JSON.stringify({
        id: questions[0].id,
        question: questions[0].question,
        section: questions[0].section,
      }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await setDoc(doc(db, 'quizRooms', code, 'players', playerId), {
      id: playerId,
      uid,
      nickname: cleanNickname,
      isHost: true,
      score: 0,
      streak: 0,
      bestStreak: 0,
      correctCount: 0,
      connected: true,
      hasSubmitted: false,
      gradingStatus: null,
      pendingAnswer: '',
      pendingSubmittedAt: 0,
      pendingQuestionIndex: -1,
      pendingRoundId: '',
      lastSubmissionJson: null,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `quizRooms/${code}`);
  }

  return { code, playerId, questions };
}

export async function joinCloudRoom(params: {
  code: string;
  nickname?: string;
  prevPlayerId?: string;
}): Promise<{
  code: string;
  playerId: string;
  isHost: boolean;
}> {
  const uid = await ensureQuizAuthUid();
  const cleanCode = params.code.trim().toUpperCase();
  if (!cleanCode || cleanCode.length < 4) {
    throw new Error('Enter the 4-letter room code.');
  }

  const roomSnap = await getDoc(doc(db, 'quizRooms', cleanCode));
  if (!roomSnap.exists()) {
    throw new Error(`No active quiz room found with code "${cleanCode}".`);
  }

  const playersSnap = await getDocs(collection(db, 'quizRooms', cleanCode, 'players'));
  const players = playersSnap.docs.map((d) => d.data() as CloudPlayerDoc);

  if (params.prevPlayerId) {
    const existing = players.find((p) => p.id === params.prevPlayerId && p.uid === uid);
    if (existing) {
      await updateDoc(doc(db, 'quizRooms', cleanCode, 'players', existing.id), {
        connected: true,
        ...(params.nickname?.trim()
          ? { nickname: params.nickname.trim().slice(0, 40) }
          : {}),
        updatedAt: serverTimestamp(),
      });
      return { code: cleanCode, playerId: existing.id, isHost: existing.isHost };
    }
  }

  const cleanNickname = (params.nickname || '').trim().slice(0, 40);
  if (!cleanNickname) {
    throw new Error('Enter your nickname to join.');
  }

  const sameUidPlayer = players.find((p) => p.uid === uid);
  if (sameUidPlayer) {
    await updateDoc(doc(db, 'quizRooms', cleanCode, 'players', sameUidPlayer.id), {
      nickname: cleanNickname,
      connected: true,
      updatedAt: serverTimestamp(),
    });
    return {
      code: cleanCode,
      playerId: sameUidPlayer.id,
      isHost: sameUidPlayer.isHost,
    };
  }

  const duplicateName = players.some(
    (p) => p.connected && p.nickname.toLowerCase() === cleanNickname.toLowerCase()
  );
  if (duplicateName) {
    throw new Error(`Nickname "${cleanNickname}" is already taken in room ${cleanCode}.`);
  }

  const playerId = makeId('p');
  try {
    await setDoc(doc(db, 'quizRooms', cleanCode, 'players', playerId), {
      id: playerId,
      uid,
      nickname: cleanNickname,
      isHost: false,
      score: 0,
      streak: 0,
      bestStreak: 0,
      correctCount: 0,
      connected: true,
      hasSubmitted: false,
      gradingStatus: null,
      pendingAnswer: '',
      pendingSubmittedAt: 0,
      pendingQuestionIndex: -1,
      pendingRoundId: '',
      lastSubmissionJson: null,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `quizRooms/${cleanCode}/players/${playerId}`);
  }

  return { code: cleanCode, playerId, isHost: false };
}

export function subscribeCloudRoom(
  code: string,
  viewerId: string,
  onUpdate: (room: QuizRoomState, rawPlayers: CloudPlayerDoc[]) => void,
  onMissing: () => void,
  onError: (msg: string) => void
): () => void {
  let latestRoomData: Record<string, unknown> | null = null;
  let latestPlayers: CloudPlayerDoc[] = [];

  const emit = () => {
    if (!latestRoomData) return;
    const status = String(latestRoomData.status || 'lobby') as QuizRoomState['status'];
    const currentIndex = Number(latestRoomData.currentIndex || 0);
    const roundId = String(latestRoomData.roundId || `r_${currentIndex}`);

    let selectedSections: string[] = [];
    try {
      selectedSections = JSON.parse(String(latestRoomData.selectedSectionsJson || '[]')) as string[];
    } catch {
      selectedSections = [];
    }

    let currentQuestion: QuizRoomState['currentQuestion'] = null;
    try {
      const parsed = JSON.parse(String(latestRoomData.currentQuestionJson || 'null'));
      if (parsed && typeof parsed === 'object') {
        currentQuestion = {
          id: String(parsed.id || ''),
          question: String(parsed.question || ''),
          section: String(parsed.section || 'General'),
          officialAnswer:
            status === 'reveal' || status === 'finished'
              ? String(parsed.officialAnswer || '')
              : undefined,
        };
      }
    } catch {
      currentQuestion = null;
    }

    const mappedPlayers: QuizPlayerState[] = latestPlayers
      .map((p) => {
        const forThisRound =
          Boolean(p.pendingRoundId)
            ? p.pendingRoundId === roundId
            : p.pendingQuestionIndex === currentIndex;
        const effectiveHasSubmitted = Boolean(p.hasSubmitted && forThisRound);
        const effectiveGradingStatus = forThisRound ? p.gradingStatus : null;

        let parsedSub: QuizPlayerState['lastSubmission'] = null;
        if (forThisRound && p.lastSubmissionJson) {
          try {
            const rawSub = JSON.parse(p.lastSubmissionJson);
            if (status === 'reveal' || status === 'finished') {
              parsedSub = rawSub;
            } else if (p.id === viewerId) {
              parsedSub = {
                answer: String(rawSub.answer || p.pendingAnswer || ''),
                correct: false,
                gradingSource: rawSub.gradingSource || 'ai',
                pointsAwarded: 0,
                streakBonus: 0,
                elapsedMs: Number(rawSub.elapsedMs || 0),
              };
            }
          } catch {
            parsedSub = null;
          }
        }
        return {
          id: p.id,
          nickname: p.nickname,
          isHost: p.isHost,
          score: p.score,
          streak: p.streak,
          bestStreak: p.bestStreak,
          correctCount: p.correctCount,
          connected: p.connected,
          hasSubmitted: effectiveHasSubmitted,
          gradingStatus: effectiveGradingStatus,
          lastSubmission: parsedSub,
        };
      })
      .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount);

    onUpdate(
      {
        code: String(latestRoomData.code || code),
        deckId: String(latestRoomData.deckId || ''),
        deckTitle: String(latestRoomData.deckTitle || 'Live Quiz'),
        selectedSections,
        timerSeconds: Number(latestRoomData.timerSeconds || 20) as 15 | 20 | 30,
        status,
        totalQuestions: Number(latestRoomData.totalQuestions || 0),
        currentIndex,
        roundId,
        questionStartedAt:
          typeof latestRoomData.questionStartedAt === 'number'
            ? latestRoomData.questionStartedAt
            : null,
        questionEndsAt:
          typeof latestRoomData.questionEndsAt === 'number'
            ? latestRoomData.questionEndsAt
            : null,
        serverNow: Date.now(),
        currentQuestion,
        players: mappedPlayers,
      },
      latestPlayers
    );
  };

  const unsubRoom = onSnapshot(
    doc(db, 'quizRooms', code),
    (snap) => {
      if (!snap.exists()) {
        onMissing();
        return;
      }
      latestRoomData = snap.data() as Record<string, unknown>;
      emit();
    },
    (err) => {
      onError(err instanceof Error ? err.message : 'Room sync failed.');
    }
  );

  const unsubPlayers = onSnapshot(
    collection(db, 'quizRooms', code, 'players'),
    (snap) => {
      latestPlayers = snap.docs.map((d) => d.data() as CloudPlayerDoc);
      emit();
    },
    (err) => {
      onError(err instanceof Error ? err.message : 'Player sync failed.');
    }
  );

  return () => {
    unsubRoom();
    unsubPlayers();
  };
}

export async function submitCloudAnswer(params: {
  code: string;
  playerId: string;
  questionIndex: number;
  roundId: string;
  questionStartedAt: number | null;
  answer: string;
}): Promise<void> {
  const submittedAt = Date.now();
  const elapsedMs = Math.max(0, submittedAt - (params.questionStartedAt || submittedAt));
  const cleanAnswer = params.answer.trim().slice(0, 1000);

  await updateDoc(doc(db, 'quizRooms', params.code, 'players', params.playerId), {
    hasSubmitted: true,
    gradingStatus: 'grading',
    pendingAnswer: cleanAnswer,
    pendingSubmittedAt: submittedAt,
    pendingQuestionIndex: params.questionIndex,
    pendingRoundId: params.roundId,
    lastSubmissionJson: JSON.stringify({
      answer: cleanAnswer,
      correct: false,
      gradingSource: cleanAnswer ? 'ai' : 'local',
      pointsAwarded: 0,
      streakBonus: 0,
      elapsedMs,
    }),
    updatedAt: serverTimestamp(),
  });
}

export async function hostApplyPlayerGrade(params: {
  code: string;
  player: CloudPlayerDoc;
  questionIndex: number;
  roundId: string;
  questionStartedAt: number | null;
  timerSeconds: number;
  correct: boolean;
  source: 'local' | 'ai' | 'fallback';
}): Promise<void> {
  const playerRef = doc(db, 'quizRooms', params.code, 'players', params.player.id);
  const roomRef = doc(db, 'quizRooms', params.code);

  await runTransaction(db, async (tx) => {
    const [roomSnap, playerSnap] = await Promise.all([tx.get(roomRef), tx.get(playerRef)]);
    if (!roomSnap.exists() || !playerSnap.exists()) return;
    const roomData = roomSnap.data() as { status?: string; roundId?: string; currentIndex?: number };
    const latestP = playerSnap.data() as CloudPlayerDoc;

    // Only apply grade if we are still in the exact same round (during question OR final reveal wait)
    if (
      (roomData.roundId && roomData.roundId !== params.roundId) ||
      latestP.pendingQuestionIndex !== params.questionIndex ||
      (latestP.pendingRoundId && latestP.pendingRoundId !== params.roundId)
    ) {
      return;
    }

    const submittedAt = latestP.pendingSubmittedAt || Date.now();
    const elapsedMs = Math.max(0, submittedAt - (params.questionStartedAt || submittedAt));
    const answer = latestP.pendingAnswer || '';

    let nextStreak = 0;
    let nextBestStreak = latestP.bestStreak;
    let nextCorrectCount = latestP.correctCount;
    let nextScore = latestP.score;
    let pointsAwarded = 0;
    let streakBonus = 0;

    if (params.correct) {
      nextStreak = latestP.streak + 1;
      nextBestStreak = Math.max(nextBestStreak, nextStreak);
      nextCorrectCount += 1;
      const pts = calculateQuizPoints(elapsedMs, params.timerSeconds, nextStreak);
      pointsAwarded = pts.total;
      streakBonus = pts.streakBonus;
      nextScore += pts.total;
    }

    tx.update(playerRef, {
      score: nextScore,
      streak: nextStreak,
      bestStreak: nextBestStreak,
      correctCount: nextCorrectCount,
      gradingStatus: 'done',
      lastSubmissionJson: JSON.stringify({
        answer,
        correct: params.correct,
        gradingSource: params.source,
        pointsAwarded,
        streakBonus,
        elapsedMs,
      }),
      updatedAt: serverTimestamp(),
    });
  });
}

export async function hostStartCloudQuestion(params: {
  code: string;
  questions: CloudQuizCard[];
  index: number;
  expectedRoundId?: string;
  timerSeconds: 15 | 20 | 30;
  players: CloudPlayerDoc[];
}): Promise<boolean> {
  const roomRef = doc(db, 'quizRooms', params.code);
  const nextRoundId = makeRoundId(params.index);

  const committed = await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) return false;
    const roomData = roomSnap.data() as {
      status?: string;
      roundId?: string;
      currentIndex?: number;
    };

    // Guard against stale clicks / duplicate transitions:
    // Can only start index 0 from 'lobby', or index N+1 from 'reveal' with matching roundId
    if (params.expectedRoundId && roomData.roundId && roomData.roundId !== params.expectedRoundId) {
      return false;
    }
    if (params.index === 0) {
      if (roomData.status !== 'lobby') return false;
    } else {
      if (roomData.status !== 'reveal' || Number(roomData.currentIndex) !== params.index - 1) {
        return false;
      }
    }

    if (params.index >= params.questions.length) {
      const lastCard = params.questions[params.questions.length - 1];
      tx.update(roomRef, {
        status: 'finished',
        roundId: nextRoundId,
        questionStartedAt: null,
        questionEndsAt: null,
        ...(lastCard
          ? {
              currentQuestionJson: JSON.stringify({
                id: lastCard.id,
                question: lastCard.question,
                section: lastCard.section,
                officialAnswer: lastCard.answer,
              }),
            }
          : {}),
        updatedAt: serverTimestamp(),
      });
      return true;
    }

    const card = params.questions[params.index];
    const now = Date.now();
    for (const p of params.players) {
      tx.update(doc(db, 'quizRooms', params.code, 'players', p.id), {
        hasSubmitted: false,
        gradingStatus: null,
        pendingAnswer: '',
        pendingSubmittedAt: 0,
        pendingQuestionIndex: -1,
        pendingRoundId: '',
        lastSubmissionJson: null,
        updatedAt: serverTimestamp(),
      });
    }

    tx.update(roomRef, {
      status: 'question',
      currentIndex: params.index,
      roundId: nextRoundId,
      questionStartedAt: now,
      questionEndsAt: now + params.timerSeconds * 1000,
      currentQuestionJson: JSON.stringify({
        id: card.id,
        question: card.question,
        section: card.section,
      }),
      updatedAt: serverTimestamp(),
    });
    return true;
  });

  return committed;
}

export async function hostRevealCloudRound(params: {
  code: string;
  questions: CloudQuizCard[];
  currentIndex: number;
  expectedRoundId: string;
  players: CloudPlayerDoc[];
}): Promise<boolean> {
  const roomRef = doc(db, 'quizRooms', params.code);
  const card = params.questions[params.currentIndex];

  const committed = await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    if (!roomSnap.exists()) return false;
    const roomData = roomSnap.data() as {
      status?: string;
      roundId?: string;
      currentIndex?: number;
    };

    // Transactional lock: ONLY reveal if the room is STILL in 'question' state for THIS exact roundId & currentIndex!
    if (
      roomData.status !== 'question' ||
      Number(roomData.currentIndex) !== params.currentIndex ||
      (roomData.roundId && roomData.roundId !== params.expectedRoundId)
    ) {
      return false;
    }

    for (const p of params.players) {
      const submittedThisRound =
        p.hasSubmitted &&
        (p.pendingRoundId ? p.pendingRoundId === params.expectedRoundId : p.pendingQuestionIndex === params.currentIndex);
      if (!submittedThisRound && p.streak !== 0) {
        tx.update(doc(db, 'quizRooms', params.code, 'players', p.id), {
          streak: 0,
          updatedAt: serverTimestamp(),
        });
      }
    }

    tx.update(roomRef, {
      status: 'reveal',
      questionEndsAt: Date.now(),
      ...(card
        ? {
            currentQuestionJson: JSON.stringify({
              id: card.id,
              question: card.question,
              section: card.section,
              officialAnswer: card.answer,
            }),
          }
        : {}),
      updatedAt: serverTimestamp(),
    });
    return true;
  });

  return committed;
}

export async function hostRestartCloudRoom(params: {
  code: string;
  questions: CloudQuizCard[];
  players: CloudPlayerDoc[];
}): Promise<CloudQuizCard[]> {
  const reshuffled = shuffleCards(params.questions);
  const first = reshuffled[0];
  const batch = writeBatch(db);

  for (const p of params.players) {
    batch.update(doc(db, 'quizRooms', params.code, 'players', p.id), {
      score: 0,
      streak: 0,
      bestStreak: 0,
      correctCount: 0,
      hasSubmitted: false,
      gradingStatus: null,
      pendingAnswer: '',
      pendingSubmittedAt: 0,
      pendingQuestionIndex: -1,
      pendingRoundId: '',
      lastSubmissionJson: null,
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'quizRooms', params.code), {
    status: 'lobby',
    currentIndex: 0,
    roundId: makeRoundId(-1),
    questionStartedAt: null,
    questionEndsAt: null,
    currentQuestionJson: first
      ? JSON.stringify({
          id: first.id,
          question: first.question,
          section: first.section,
        })
      : '{}',
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return reshuffled;
}

export async function leaveCloudRoom(
  code: string,
  playerId: string,
  isHost: boolean
): Promise<void> {
  try {
    if (isHost) {
      await deleteDoc(doc(db, 'quizRooms', code));
    } else {
      await updateDoc(doc(db, 'quizRooms', code, 'players', playerId), {
        connected: false,
        updatedAt: serverTimestamp(),
      });
    }
  } catch {
    // ignore cleanup errors on leave
  }
}
