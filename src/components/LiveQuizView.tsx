import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Database,
  FileSpreadsheet,
  Folder,
  FolderOpen,
  Gamepad2,
  HelpCircle,
  Layers,
  ListChecks,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SkipForward,
  Sparkles,
  Swords,
  Trash2,
  Trophy,
  Upload,
  Users,
  Volume2,
  VolumeX,
  XCircle,
  Zap,
} from 'lucide-react';
import { getByokConfig, useByokConfig } from '../lib/byokStore';
import {
  CloudPlayerDoc,
  CloudQuizCard,
  CloudQuizDeck,
  createCloudRoom,
  deleteCloudDeck,
  gradeBrawlAnswerLocalOrCloud,
  hostApplyPlayerGrade,
  hostFinishCloudBrawl,
  hostRestartCloudRoom,
  hostRevealCloudRound,
  hostStartCloudBrawl,
  hostStartCloudQuestion,
  joinCloudRoom,
  leaveCloudRoom,
  loadCloudDecks,
  saveCloudDeck,
  submitCloudAnswer,
  submitCloudBrawlProgress,
  subscribeCloudRoom,
} from '../lib/liveQuizCloud';
import { BRAWL_DIFFICULTIES, BRAWL_DIFFICULTY_ORDER } from '../lib/brawlDifficulty';
import { ARENA_MAP_URL, MONSTER_ARCHETYPES } from '../lib/monsterAssets';
import {
  parseQuizInputText,
  QuizGameMode,
  QuizQuestionFormat,
  SAMPLE_MCQ_CSV,
  SAMPLE_MCQ_TEXT,
} from '../lib/quizMcq';
import {
  BrawlCoopActionPacket,
  BrawlDifficulty,
  BrawlHeroPacket,
  BrawlWorldSnapshot,
  DeckFlashcard,
  DeckGroup,
  DeckSnapshot,
  QuizBrawlQuestion,
  QuizBrawlStats,
  QuizDeckSummary,
  QuizRoomState,
} from '../types';
import {
  BrawlAnswerFeedback,
  BrawlCoopChannel,
  MonsterBrawlArena,
} from './MonsterBrawlArena';

interface LiveQuizViewProps {
  deckSnapshot: DeckSnapshot;
  defaultNickname: string;
  onRequestDecks: () => void;
}

type QuizSubTab = 'decks' | 'host' | 'join';
type HostQuestionSource = 'current' | 'saved';
type FlashcardFilterMode = 'all' | 'due' | 'flagged' | 'weak';

interface SnapshotSectionGroup {
  secId: string;
  secName: string;
  topicId: string;
  topicName: string;
  subjId: string;
  subjName: string;
  cards: DeckFlashcard[];
}

interface SnapshotSubjectGroup {
  subjId: string;
  subjName: string;
  sections: SnapshotSectionGroup[];
  totalCards: number;
}

const SAMPLE_CSV = `Question,Answer,Section
"What triggered the Kiel Mutiny on 25 October 1918?","Sailors refused to fight Britain in a final suicidal naval battle",Weimar Germany
"When did Kaiser Wilhelm II abdicate?","9 November 1918",Weimar Germany
"What was the capital limit on Germany's army under the Treaty of Versailles?","100,000 men",Treaty of Versailles
"Which article of the Weimar Constitution allowed the President to rule by decree in an emergency?","Article 48",Weimar Constitution
"Which currency replaced the worthless mark in November 1923?","The Rentenmark",
`;

const SESSION_STORAGE_KEY = 'studydeck_live_quiz_session';

function playQuizTone(kind: 'submit' | 'correct' | 'wrong' | 'finish', muted: boolean) {
  if (muted) return;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const playNote = (freq: number, startOffset: number, duration: number, type: OscillatorType = 'sine') => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0.06, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };
    if (kind === 'submit') {
      playNote(520, 0, 0.09);
    } else if (kind === 'correct') {
      playNote(587.33, 0, 0.12);
      playNote(880, 0.09, 0.18);
    } else if (kind === 'wrong') {
      playNote(240, 0, 0.16, 'triangle');
      playNote(195, 0.11, 0.2, 'triangle');
    } else if (kind === 'finish') {
      playNote(523.25, 0, 0.14);
      playNote(659.25, 0.12, 0.14);
      playNote(783.99, 0.24, 0.28);
    }
    window.setTimeout(() => {
      void ctx.close().catch(() => {});
    }, 800);
  } catch {
    // ignore Web Audio failures
  }
}

export function LiveQuizView({
  deckSnapshot,
  defaultNickname,
  onRequestDecks,
}: LiveQuizViewProps) {
  const byokConfig = useByokConfig();
  const [subTab, setSubTab] = useState<QuizSubTab>('host');
  const [decks, setDecks] = useState<QuizDeckSummary[]>([]);
  const [loadingDecks, setLoadingDecks] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Import CSV form state
  const [importTitle, setImportTitle] = useState('');
  const [csvText, setCsvText] = useState('');
  const [savingDeck, setSavingDeck] = useState(false);
  const [confirmDeleteDeckId, setConfirmDeleteDeckId] = useState<string | null>(null);
  const [showCurrentImporter, setShowCurrentImporter] = useState(false);
  const [importDeckTitle, setImportDeckTitle] = useState('');
  const [importSecIds, setImportSecIds] = useState<string[]>([]);
  const [showFormatGuide, setShowFormatGuide] = useState(true);
  const csvFileRef = useRef<HTMLInputElement | null>(null);

  // Host setup state
  const [hostSource, setHostSource] = useState<HostQuestionSource>('current');
  const [gameMode, setGameMode] = useState<QuizGameMode>('classic');
  const [questionFormat, setQuestionFormat] = useState<QuizQuestionFormat>('mcq');
  const [brawlDifficulty, setBrawlDifficulty] = useState<BrawlDifficulty>('easy');
  const [selectedDeckId, setSelectedDeckId] = useState<string>('');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [selectedCurrentSecIds, setSelectedCurrentSecIds] = useState<string[]>([]);
  const [flashcardFilter, setFlashcardFilter] = useState<FlashcardFilterMode>('all');
  const [currentQuizTitle, setCurrentQuizTitle] = useState('');
  const [saveCurrentToDb, setSaveCurrentToDb] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState<15 | 20 | 30>(20);
  const [hostNickname, setHostNickname] = useState<string>(defaultNickname || 'Host');
  const [expandedQuizFolders, setExpandedQuizFolders] = useState<Set<string>>(() => new Set());
  const hostSourceInitializedRef = useRef(false);
  const seenSecIdsRef = useRef<Set<string>>(new Set());

  // Join setup state
  const [joinCode, setJoinCode] = useState('');
  const [joinNickname, setJoinNickname] = useState<string>(defaultNickname || '');

  // Live WebSocket room state
  const [wsConnected, setWsConnected] = useState(false);
  const [room, setRoom] = useState<QuizRoomState | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [answerInput, setAnswerInput] = useState('');
  const [timeLeftMs, setTimeLeftMs] = useState(0);
  const [copiedCode, setCopiedCode] = useState(false);
  const [muted, setMuted] = useState(false);

  const [backendMode, setBackendMode] = useState<'server' | 'cloud'>('server');
  const [hostActionBusy, setHostActionBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const clockOffsetRef = useRef<number>(0);
  const lastSoundStatusRef = useRef<string>('');
  const lastRoundKeyRef = useRef<string>('');
  const localDeadlineRef = useRef<{ key: string; endsAt: number }>({ key: '', endsAt: 0 });
  const reconnectAttemptedRef = useRef(false);
  const cloudUnsubRef = useRef<(() => void) | null>(null);
  const cloudQuestionsRef = useRef<CloudQuizCard[]>([]);
  const cloudPlayersRef = useRef<CloudPlayerDoc[]>([]);
  const cloudGradingLocksRef = useRef<Set<string>>(new Set());
  const cloudRevealingRoundRef = useRef<string | null>(null);
  const cloudRoundIndexRef = useRef<number>(-1);
  const cloudRoundIdRef = useRef<string>('');
  const cloudRoundStatusRef = useRef<string>('lobby');
  const hostActionPendingRef = useRef<boolean>(false);
  const brawlPendingResolversRef = useRef<Map<string, (res: BrawlAnswerFeedback) => void>>(
    new Map()
  );
  const brawlStatsTrackRef = useRef({
    correctCount: 0,
    streak: 0,
    bestStreak: 0,
    bonusPoints: 0,
  });
  const brawlCoopListenersRef = useRef<{
    onWorld?: (world: BrawlWorldSnapshot) => void;
    onHero?: (hero: BrawlHeroPacket) => void;
    onAction?: (action: BrawlCoopActionPacket) => void;
  }>({});

  useEffect(() => {
    onRequestDecks();
  }, [onRequestDecks]);

  useEffect(() => {
    if (defaultNickname && defaultNickname !== 'Guest Student') {
      setHostNickname((prev) => (prev === 'Host' || !prev ? defaultNickname : prev));
      setJoinNickname((prev) => (!prev ? defaultNickname : prev));
    }
  }, [defaultNickname]);

  const applyFetchedDecks = useCallback(
    (list: QuizDeckSummary[]) => {
      setDecks(list);
      if (list.length > 0 && (!selectedDeckId || !list.some((d) => d.id === selectedDeckId))) {
        setSelectedDeckId(list[0].id);
        setSelectedSections(list[0].sections.map((s) => s.name));
      }
      if (!hostSourceInitializedRef.current) {
        hostSourceInitializedRef.current = true;
        if (deckSnapshot.cards.length > 0) {
          setHostSource('current');
        } else if (list.length > 0) {
          setHostSource('saved');
        }
      }
    },
    [selectedDeckId, deckSnapshot.cards.length]
  );

  const fetchDecks = useCallback(async () => {
    setLoadingDecks(true);
    try {
      if (backendMode === 'cloud') {
        const cloudList = await loadCloudDecks();
        applyFetchedDecks(cloudList);
        return;
      }

      const res = await fetch('/api/quiz/decks');
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) {
        // Static deployment (e.g. Vercel without Express/SQLite server) -> switch to Cloud Mode silently
        setBackendMode('cloud');
        const cloudList = await loadCloudDecks();
        applyFetchedDecks(cloudList);
        return;
      }

      const data = (await res.json()) as { decks?: QuizDeckSummary[]; error?: string };
      if (!res.ok) throw new Error(data.error || 'Could not load decks.');
      const list = Array.isArray(data.decks) ? data.decks : [];
      applyFetchedDecks(list);
    } catch (err) {
      if (backendMode === 'server') {
        try {
          setBackendMode('cloud');
          const cloudList = await loadCloudDecks();
          applyFetchedDecks(cloudList);
          setErrorMsg(null);
          return;
        } catch {
          // fall through to show error if both failed
        }
      }
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch saved decks.');
    } finally {
      setLoadingDecks(false);
    }
  }, [backendMode, applyFetchedDecks]);

  useEffect(() => {
    void fetchDecks();
  }, [fetchDecks]);

  const attachCloudSubscription = useCallback(
    (code: string, pId: string, hostQuestions?: CloudQuizCard[]) => {
      if (cloudUnsubRef.current) {
        cloudUnsubRef.current();
        cloudUnsubRef.current = null;
      }
      if (hostQuestions) {
        cloudQuestionsRef.current = hostQuestions;
      }
      cloudGradingLocksRef.current.clear();
      cloudRevealingRoundRef.current = null;
      setPlayerId(pId);
      setWsConnected(true);
      setErrorMsg(null);
      setInfoMsg(null);

      try {
        sessionStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify({
            mode: 'cloud',
            code,
            playerId: pId,
            questions: hostQuestions || undefined,
          })
        );
      } catch {
        // ignore
      }

      cloudUnsubRef.current = subscribeCloudRoom(
        code,
        pId,
        (nextRoom, rawPlayers) => {
          const roundId = nextRoom.roundId || `r_${nextRoom.currentIndex}`;
          cloudPlayersRef.current = rawPlayers;
          cloudRoundIndexRef.current = nextRoom.currentIndex;
          cloudRoundIdRef.current = roundId;
          cloudRoundStatusRef.current = nextRoom.status;
          clockOffsetRef.current = 0;
          setRoom(nextRoom);

          // Host-authoritative grading on submit & auto-reveal when everyone is done for THIS roundId
          if (cloudQuestionsRef.current.length > 0 && nextRoom.status === 'question') {
            if (cloudRevealingRoundRef.current && cloudRevealingRoundRef.current !== roundId) {
              cloudRevealingRoundRef.current = null;
            }
            const qIdx = nextRoom.currentIndex;
            const card = cloudQuestionsRef.current[qIdx];
            if (card) {
              for (const p of rawPlayers) {
                const submittedForRound = p.pendingRoundId
                  ? p.pendingRoundId === roundId
                  : p.pendingQuestionIndex === qIdx;
                if (p.hasSubmitted && p.gradingStatus === 'grading' && submittedForRound) {
                  const lockKey = `${roundId}:${p.id}`;
                  if (!cloudGradingLocksRef.current.has(lockKey)) {
                    cloudGradingLocksRef.current.add(lockKey);
                    void (async () => {
                      const outcome = await gradeBrawlAnswerLocalOrCloud({
                        question: card.question,
                        officialAnswer: card.answer,
                        studentAnswer: p.pendingAnswer || '',
                        isMcq: nextRoom.questionFormat === 'mcq',
                      });
                      if (cloudRoundIdRef.current !== roundId) {
                        return;
                      }
                      await hostApplyPlayerGrade({
                        code: nextRoom.code,
                        player: p,
                        questionIndex: qIdx,
                        roundId,
                        questionStartedAt: nextRoom.questionStartedAt,
                        timerSeconds: nextRoom.timerSeconds,
                        correct: outcome.correct,
                        source: outcome.source,
                      });
                    })().catch(() => {
                      cloudGradingLocksRef.current.delete(lockKey);
                    });
                  }
                }
              }
            }

            const connected = rawPlayers.filter((p) => p.connected);
            const allDone =
              connected.length > 0 &&
              connected.every((p) => {
                const forRound = p.pendingRoundId
                  ? p.pendingRoundId === roundId
                  : p.pendingQuestionIndex === qIdx;
                return p.hasSubmitted && p.gradingStatus === 'done' && forRound;
              });
            if (allDone && cloudRevealingRoundRef.current !== roundId) {
              cloudRevealingRoundRef.current = roundId;
              void hostRevealCloudRound({
                code: nextRoom.code,
                questions: cloudQuestionsRef.current,
                currentIndex: qIdx,
                expectedRoundId: roundId,
                players: rawPlayers,
              });
            }
          } else if (nextRoom.status !== 'question') {
            cloudRevealingRoundRef.current = null;
          }
        },
        () => {
          if (cloudUnsubRef.current) {
            cloudUnsubRef.current();
            cloudUnsubRef.current = null;
          }
          cloudQuestionsRef.current = [];
          try {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
          } catch {
            // ignore
          }
          setRoom(null);
          setPlayerId(null);
          setErrorMsg('Quiz room closed by host.');
        },
        (msg) => {
          setErrorMsg(msg);
        }
      );
    },
    []
  );

  // Connect WebSocket once and keep clean heartbeat/reconnect awareness
  const connectWebSocket = useCallback((): Promise<WebSocket> => {
    const existing = wsRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/quiz`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      const timeout = window.setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) {
          reject(new Error('Timed out connecting to Live Quiz server.'));
        }
      }, 6000);

      ws.onopen = () => {
        window.clearTimeout(timeout);
        setWsConnected(true);
        resolve(ws);
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as {
            type: string;
            code?: string;
            playerId?: string;
            room?: QuizRoomState;
            message?: string;
            requestId?: string;
            correct?: boolean;
            officialAnswer?: string;
            pointsAwarded?: number;
            streak?: number;
            world?: BrawlWorldSnapshot;
            hero?: BrawlHeroPacket;
            action?: BrawlCoopActionPacket;
          };

          if (msg.type === 'quiz:error') {
            setErrorMsg(msg.message || 'Quiz error occurred.');
            return;
          }

          if (msg.type === 'quiz:brawl-world' && msg.world) {
            brawlCoopListenersRef.current.onWorld?.(msg.world);
            return;
          }

          if (msg.type === 'quiz:brawl-hero' && msg.hero) {
            brawlCoopListenersRef.current.onHero?.(msg.hero);
            return;
          }

          if (msg.type === 'quiz:brawl-action' && msg.action) {
            brawlCoopListenersRef.current.onAction?.(msg.action);
            return;
          }

          if (msg.type === 'quiz:brawl-graded' && msg.requestId) {
            const resolver = brawlPendingResolversRef.current.get(msg.requestId);
            if (resolver) {
              brawlPendingResolversRef.current.delete(msg.requestId);
              resolver({
                correct: Boolean(msg.correct),
                officialAnswer: String(msg.officialAnswer || ''),
                pointsAwarded: Number(msg.pointsAwarded || 0),
                streak: Number(msg.streak || 0),
              });
            }
            return;
          }

          if (msg.type === 'quiz:joined' && msg.room && msg.playerId) {
            clockOffsetRef.current = msg.room.serverNow - Date.now();
            setPlayerId(msg.playerId);
            setRoom(msg.room);
            setErrorMsg(null);
            setInfoMsg(null);
            brawlStatsTrackRef.current = {
              correctCount: 0,
              streak: 0,
              bestStreak: 0,
              bonusPoints: 0,
            };
            try {
              sessionStorage.setItem(
                SESSION_STORAGE_KEY,
                JSON.stringify({ code: msg.room.code, playerId: msg.playerId })
              );
            } catch {
              // ignore
            }
            return;
          }

          if (msg.type === 'quiz:state' && msg.room) {
            clockOffsetRef.current = msg.room.serverNow - Date.now();
            setRoom(msg.room);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
      };

      ws.onerror = () => {
        window.clearTimeout(timeout);
        setWsConnected(false);
        reject(new Error('WebSocket connection error.'));
      };
    });
  }, []);

  // Reconnect if user refreshed inside an active room
  useEffect(() => {
    if (reconnectAttemptedRef.current) return;
    reconnectAttemptedRef.current = true;
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as {
        mode?: 'server' | 'cloud';
        code?: string;
        playerId?: string;
        questions?: CloudQuizCard[];
      };
      if (!saved.code || !saved.playerId) return;

      if (saved.mode === 'cloud') {
        setBackendMode('cloud');
        void joinCloudRoom({ code: saved.code, prevPlayerId: saved.playerId })
          .then((res) => {
            attachCloudSubscription(
              res.code,
              res.playerId,
              Array.isArray(saved.questions) ? saved.questions : undefined
            );
          })
          .catch(() => {
            sessionStorage.removeItem(SESSION_STORAGE_KEY);
          });
        return;
      }

      void connectWebSocket()
        .then((ws) => {
          ws.send(
            JSON.stringify({
              type: 'quiz:join',
              code: saved.code,
              playerId: saved.playerId,
            })
          );
        })
        .catch(() => {
          sessionStorage.removeItem(SESSION_STORAGE_KEY);
        });
    } catch {
      // ignore
    }
  }, [connectWebSocket, attachCloudSubscription]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (cloudUnsubRef.current) {
        cloudUnsubRef.current();
        cloudUnsubRef.current = null;
      }
    };
  }, []);

  // Clear answer input when advancing to a new round + trigger audio cue on reveal/finish
  useEffect(() => {
    if (!room) {
      lastRoundKeyRef.current = '';
      lastSoundStatusRef.current = '';
      return;
    }

    const roundKey = `${room.code}:${room.roundId || room.currentIndex}`;
    if (roundKey !== lastRoundKeyRef.current) {
      lastRoundKeyRef.current = roundKey;
      setAnswerInput('');
    }

    const stateKey = `${room.status}:${room.roundId || room.currentIndex}`;
    if (stateKey !== lastSoundStatusRef.current) {
      lastSoundStatusRef.current = stateKey;
      if (room.status === 'reveal' && playerId) {
        const me = room.players.find((p) => p.id === playerId);
        if (me?.lastSubmission) {
          playQuizTone(me.lastSubmission.correct ? 'correct' : 'wrong', muted);
        }
      } else if (room.status === 'finished') {
        playQuizTone('finish', muted);
      }
    }
  }, [room, playerId, muted]);

  // Clock-skew resilient countdown timer anchored per round
  useEffect(() => {
    if (!room || room.status !== 'question' || !room.questionEndsAt) {
      setTimeLeftMs(0);
      return;
    }

    const anchorKey = `${room.code}:${room.roundId || room.currentIndex}:question`;
    const timerMs = room.timerSeconds * 1000;
    if (localDeadlineRef.current.key !== anchorKey) {
      const estimatedNow = Date.now() + clockOffsetRef.current;
      const rawRemaining = room.questionEndsAt - estimatedNow;
      // If cross-device clock skew makes rawRemaining negative or way past timerMs, anchor cleanly to full timerMs from receipt
      const safeRemaining =
        rawRemaining > timerMs + 2500 || rawRemaining < 500
          ? timerMs
          : Math.min(timerMs, Math.max(1000, rawRemaining));
      localDeadlineRef.current = {
        key: anchorKey,
        endsAt: Date.now() + safeRemaining,
      };
    }

    const update = () => {
      setTimeLeftMs(Math.max(0, localDeadlineRef.current.endsAt - Date.now()));
    };
    update();
    const id = window.setInterval(update, 100);
    return () => window.clearInterval(id);
  }, [room?.code, room?.status, room?.currentIndex, room?.roundId, room?.questionEndsAt, room?.timerSeconds]);

  // Host countdown auto-reveal timer when running in Cloud Mode (anchored by roundId, waits up to 6s for in-flight grades)
  useEffect(() => {
    if (
      backendMode !== 'cloud' ||
      !room ||
      room.status !== 'question' ||
      !room.questionEndsAt ||
      cloudQuestionsRef.current.length === 0
    ) {
      return;
    }

    const roomCode = room.code;
    const qIdx = room.currentIndex;
    const expectedRoundId = room.roundId || `r_${qIdx}`;
    const timerMs = room.timerSeconds * 1000;
    const rawRemaining = room.questionEndsAt - Date.now();
    const msRemaining =
      rawRemaining > timerMs + 2500 || rawRemaining < 1000
        ? timerMs
        : Math.min(timerMs, rawRemaining);

    let cancelled = false;
    let pollInterval: number | null = null;

    const timer = window.setTimeout(() => {
      if (
        cancelled ||
        cloudRevealingRoundRef.current === expectedRoundId ||
        cloudRoundIdRef.current !== expectedRoundId ||
        cloudRoundStatusRef.current !== 'question'
      ) {
        return;
      }
      cloudRevealingRoundRef.current = expectedRoundId;

      const waitStarted = Date.now();
      const attemptReveal = () => {
        if (
          cancelled ||
          cloudRoundIdRef.current !== expectedRoundId ||
          cloudRoundStatusRef.current !== 'question'
        ) {
          if (pollInterval !== null) {
            window.clearInterval(pollInterval);
            pollInterval = null;
          }
          return;
        }

        const hasPendingGrades = cloudPlayersRef.current.some((p) => {
          const forRound = p.pendingRoundId
            ? p.pendingRoundId === expectedRoundId
            : p.pendingQuestionIndex === qIdx;
          return p.hasSubmitted && forRound && p.gradingStatus === 'grading';
        });

        if (!hasPendingGrades || Date.now() - waitStarted >= 6000) {
          if (pollInterval !== null) {
            window.clearInterval(pollInterval);
            pollInterval = null;
          }
          void hostRevealCloudRound({
            code: roomCode,
            questions: cloudQuestionsRef.current,
            currentIndex: qIdx,
            expectedRoundId,
            players: cloudPlayersRef.current,
          });
        }
      };

      const hasPendingAtExpiry = cloudPlayersRef.current.some((p) => {
        const forRound = p.pendingRoundId
          ? p.pendingRoundId === expectedRoundId
          : p.pendingQuestionIndex === qIdx;
        return p.hasSubmitted && forRound && p.gradingStatus === 'grading';
      });

      if (!hasPendingAtExpiry) {
        attemptReveal();
      } else {
        pollInterval = window.setInterval(attemptReveal, 200);
      }
    }, msRemaining);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (pollInterval !== null) {
        window.clearInterval(pollInterval);
      }
    };
  }, [
    backendMode,
    room?.code,
    room?.status,
    room?.currentIndex,
    room?.roundId,
    room?.questionEndsAt,
    room?.timerSeconds,
  ]);

  const sendWs = useCallback(
    async (payload: Record<string, unknown>) => {
      setErrorMsg(null);
      try {
        const ws = await connectWebSocket();
        ws.send(JSON.stringify(payload));
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to reach Live Quiz server.');
      }
    },
    [connectWebSocket]
  );

  const sendHostAction = useCallback(
    async (action: 'start' | 'reveal' | 'next' | 'restart' | 'finish-brawl') => {
      if (!room || hostActionPendingRef.current) return;
      hostActionPendingRef.current = true;
      setHostActionBusy(true);
      setErrorMsg(null);
      const currentRoundId = room.roundId || `r_${room.currentIndex}`;
      try {
        if (backendMode === 'server') {
          await sendWs({ type: `quiz:${action}`, roundId: room.roundId });
          window.setTimeout(() => {
            hostActionPendingRef.current = false;
            setHostActionBusy(false);
          }, 350);
          return;
        }
        if (action === 'start') {
          cloudRevealingRoundRef.current = null;
          if (room.gameMode === 'monster-brawl') {
            await hostStartCloudBrawl(room.code);
          } else {
            await hostStartCloudQuestion({
              code: room.code,
              questions: cloudQuestionsRef.current,
              index: 0,
              expectedRoundId: currentRoundId,
              timerSeconds: room.timerSeconds,
              players: cloudPlayersRef.current,
            });
          }
        } else if (action === 'finish-brawl') {
          await hostFinishCloudBrawl(room.code);
        } else if (action === 'reveal') {
          cloudRevealingRoundRef.current = currentRoundId;
          await hostRevealCloudRound({
            code: room.code,
            questions: cloudQuestionsRef.current,
            currentIndex: room.currentIndex,
            expectedRoundId: currentRoundId,
            players: cloudPlayersRef.current,
          });
        } else if (action === 'next') {
          if (room.status === 'question') {
            cloudRevealingRoundRef.current = currentRoundId;
            await hostRevealCloudRound({
              code: room.code,
              questions: cloudQuestionsRef.current,
              currentIndex: room.currentIndex,
              expectedRoundId: currentRoundId,
              players: cloudPlayersRef.current,
            });
          } else if (room.status === 'reveal') {
            cloudRevealingRoundRef.current = null;
            await hostStartCloudQuestion({
              code: room.code,
              questions: cloudQuestionsRef.current,
              index: room.currentIndex + 1,
              expectedRoundId: currentRoundId,
              timerSeconds: room.timerSeconds,
              players: cloudPlayersRef.current,
            });
          }
        } else if (action === 'restart') {
          cloudRevealingRoundRef.current = null;
          brawlStatsTrackRef.current = {
            correctCount: 0,
            streak: 0,
            bestStreak: 0,
            bonusPoints: 0,
          };
          const reshuffled = await hostRestartCloudRoom({
            code: room.code,
            questions: cloudQuestionsRef.current,
            players: cloudPlayersRef.current,
          });
          cloudQuestionsRef.current = reshuffled;
        }
        hostActionPendingRef.current = false;
        setHostActionBusy(false);
      } catch (err) {
        hostActionPendingRef.current = false;
        setHostActionBusy(false);
        setErrorMsg(err instanceof Error ? err.message : 'Failed to update Cloud quiz room.');
      }
    },
    [backendMode, room, sendWs]
  );

  // Parsed MCQ/CSV live preview
  const parsedImport = useMemo(() => parseQuizInputText(csvText), [csvText]);
  const csvPreviewCards = parsedImport.cards;
  const csvPreviewSections = useMemo(() => {
    const map = new Map<string, number>();
    csvPreviewCards.forEach((c) => {
      map.set(c.section, (map.get(c.section) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [csvPreviewCards]);

  // Current StudyWeb flashcards grouped by Subject -> Section
  const validSnapshotCards = useMemo(
    () => deckSnapshot.cards.filter((c) => c.q.trim().length > 0 && c.a.trim().length > 0),
    [deckSnapshot.cards]
  );

  const snapshotSubjectGroups = useMemo<SnapshotSubjectGroup[]>(() => {
    const subjMap = new Map<string, SnapshotSubjectGroup>();
    const secMap = new Map<string, SnapshotSectionGroup>();

    validSnapshotCards.forEach((card) => {
      const subjId = card.subjId || 'general_subj';
      const subjName = card.subjName || 'General';
      const secId = card.secId || `${subjId}__${card.topicId || 'topic'}__${card.secName || 'General'}`;
      const secName = card.secName || card.topicName || 'General';
      const topicId = card.topicId || '';
      const topicName = card.topicName || '';

      let subj = subjMap.get(subjId);
      if (!subj) {
        subj = { subjId, subjName, sections: [], totalCards: 0 };
        subjMap.set(subjId, subj);
      }

      let sec = secMap.get(secId);
      if (!sec) {
        sec = { secId, secName, topicId, topicName, subjId, subjName, cards: [] };
        secMap.set(secId, sec);
        subj.sections.push(sec);
      }
      sec.cards.push(card);
      subj.totalCards += 1;
    });

    return Array.from(subjMap.values());
  }, [validSnapshotCards]);

  const allSnapshotSecIds = useMemo(
    () => snapshotSubjectGroups.flatMap((g) => g.sections.map((s) => s.secId)),
    [snapshotSubjectGroups]
  );

  const deckGroupsBySubject = useMemo(() => {
    const map = new Map<string, DeckGroup[]>();
    (deckSnapshot.deckGroups || []).forEach((g) => {
      const arr = map.get(g.subjectId) || [];
      arr.push(g);
      map.set(g.subjectId, arr);
    });
    return map;
  }, [deckSnapshot.deckGroups]);

  const allQuizFolderKeys = useMemo(
    () =>
      snapshotSubjectGroups.flatMap((subj) => {
        const groups = deckGroupsBySubject.get(subj.subjId) || [];
        const keys = groups.map((g) => `folder:${g.id}`);
        const folderedSecNames = new Set(groups.flatMap((g) => g.sectionNames));
        const hasOther = subj.sections.some((s) => !folderedSecNames.has(s.secName));
        if (groups.length > 0 && hasOther) {
          keys.push(`other:${subj.subjId}`);
        }
        return keys;
      }),
    [snapshotSubjectGroups, deckGroupsBySubject]
  );

  const toggleQuizFolder = useCallback((folderKey: string) => {
    setExpandedQuizFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderKey)) next.delete(folderKey);
      else next.add(folderKey);
      return next;
    });
  }, []);

  // Auto-select newly appearing sections (without overriding manual unchecks)
  useEffect(() => {
    const newIds = allSnapshotSecIds.filter((id) => !seenSecIdsRef.current.has(id));
    if (newIds.length > 0) {
      newIds.forEach((id) => seenSecIdsRef.current.add(id));
      setSelectedCurrentSecIds((prev) => Array.from(new Set([...prev, ...newIds])));
      setImportSecIds((prev) => Array.from(new Set([...prev, ...newIds])));
    }
    const validSet = new Set(allSnapshotSecIds);
    setSelectedCurrentSecIds((prev) => prev.filter((id) => validSet.has(id)));
    setImportSecIds((prev) => prev.filter((id) => validSet.has(id)));
  }, [allSnapshotSecIds]);

  const snapshotFilterCounts = useMemo(() => {
    let due = 0;
    let flagged = 0;
    let weak = 0;
    validSnapshotCards.forEach((c) => {
      if (c.due) due++;
      if (c.flagged) flagged++;
      if (c.box <= 2) weak++;
    });
    return { all: validSnapshotCards.length, due, flagged, weak };
  }, [validSnapshotCards]);

  const cardMatchesFilter = useCallback(
    (card: DeckFlashcard) => {
      if (flashcardFilter === 'due') return card.due;
      if (flashcardFilter === 'flagged') return card.flagged;
      if (flashcardFilter === 'weak') return card.box <= 2;
      return true;
    },
    [flashcardFilter]
  );

  const selectedCurrentCards = useMemo(() => {
    const secSet = new Set(selectedCurrentSecIds);
    return validSnapshotCards.filter((c) => {
      const secId = c.secId || `${c.subjId || 'general_subj'}__${c.topicId || 'topic'}__${c.secName || 'General'}`;
      return secSet.has(secId) && cardMatchesFilter(c);
    });
  }, [validSnapshotCards, selectedCurrentSecIds, cardMatchesFilter]);

  const derivedCurrentQuizTitle = useMemo(() => {
    if (currentQuizTitle.trim()) return currentQuizTitle.trim();
    const secSet = new Set(selectedCurrentSecIds);
    const activeSubjects = snapshotSubjectGroups
      .filter((g) => g.sections.some((s) => secSet.has(s.secId)))
      .map((g) => g.subjName);
    if (activeSubjects.length === 1) return `StudyWeb · ${activeSubjects[0]}`;
    if (activeSubjects.length === 2) return `StudyWeb · ${activeSubjects.join(' & ')}`;
    if (activeSubjects.length > 2) return `StudyWeb · ${activeSubjects.length} Subjects`;
    return 'StudyWeb Flashcards';
  }, [currentQuizTitle, selectedCurrentSecIds, snapshotSubjectGroups]);

  const selectedImportCards = useMemo(() => {
    const secSet = new Set(importSecIds);
    return validSnapshotCards.filter((c) => {
      const secId = c.secId || `${c.subjId || 'general_subj'}__${c.topicId || 'topic'}__${c.secName || 'General'}`;
      return secSet.has(secId);
    });
  }, [validSnapshotCards, importSecIds]);

  const buildQuizCardsFromFlashcards = useCallback((cards: DeckFlashcard[]) => {
    // Disambiguate section labels if the same section name exists under multiple subjects/topics
    const secNameOrigins = new Map<string, Set<string>>();
    cards.forEach((c) => {
      const base = (c.secName || c.topicName || 'General').trim();
      const origin = `${c.subjName || ''}::${c.topicName || ''}`;
      if (!secNameOrigins.has(base)) secNameOrigins.set(base, new Set());
      secNameOrigins.get(base)?.add(origin);
    });

    return cards.map((c) => {
      const base = (c.secName || c.topicName || 'General').trim();
      const multi = (secNameOrigins.get(base)?.size || 0) > 1;
      const prefix = c.topicName && c.topicName !== base ? c.topicName : c.subjName;
      const section = multi && prefix ? `${prefix} · ${base}` : base;
      return {
        question: c.q.trim(),
        answer: c.a.trim(),
        section,
      };
    });
  }, []);

  const selectedDeck = useMemo(
    () => decks.find((d) => d.id === selectedDeckId) || null,
    [decks, selectedDeckId]
  );

  const selectedSectionCardCount = useMemo(() => {
    if (!selectedDeck) return 0;
    const set = new Set(selectedSections);
    return selectedDeck.sections
      .filter((s) => set.has(s.name))
      .reduce((sum, s) => sum + s.count, 0);
  }, [selectedDeck, selectedSections]);

  const handleCsvFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      setCsvText(text);
      if (!importTitle.trim()) {
        setImportTitle(file.name.replace(/\.[^.]+$/, ''));
      }
      setErrorMsg(null);
    } catch {
      setErrorMsg('Could not read the selected CSV file.');
    }
  };

  const persistQuizDeck = async (
    title: string,
    payload: {
      csvText?: string;
      rawText?: string;
      cards?: Array<{ question: string; answer: string; section: string; options?: string[] }>;
    }
  ): Promise<QuizDeckSummary> => {
    if (backendMode === 'server') {
      const res = await fetch('/api/quiz/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, ...payload }),
      });
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = (await res.json()) as { deck?: QuizDeckSummary; error?: string };
        if (!res.ok || !data.deck) throw new Error(data.error || 'Failed to save deck.');
        return data.deck;
      }
      setBackendMode('cloud');
    }

    const rawSource = payload.rawText ?? payload.csvText;
    const cards = rawSource ? parseQuizInputText(rawSource).cards : payload.cards || [];
    return await saveCloudDeck(title, cards);
  };

  const handleSaveDeck = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);
    const title = importTitle.trim();
    if (!title) {
      setErrorMsg('Enter a Deck Title before saving.');
      return;
    }
    if (!csvPreviewCards.length) {
      setErrorMsg(
        'Paste MCQ text blocks (Q: / A) * / B) ...), MCQ CSV, or Question, Answer, Section CSV first.'
      );
      return;
    }

    setSavingDeck(true);
    try {
      const deck = await persistQuizDeck(title, {
        rawText: csvText,
        cards: csvPreviewCards,
      });
      await fetchDecks();
      setSelectedDeckId(deck.id);
      setSelectedSections(deck.sections.map((s) => s.name));
      setHostSource('saved');
      setImportTitle('');
      setCsvText('');
      setInfoMsg(
        `Saved "${deck.title}" permanently (${deck.cardCount} cards across ${deck.sections.length} section${
          deck.sections.length === 1 ? '' : 's'
        }${parsedImport.mcqCount > 0 ? `, including ${parsedImport.mcqCount} MCQ cards` : ''}). Ready to host!`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save deck.');
    } finally {
      setSavingDeck(false);
    }
  };

  const handleImportWorkspaceFlashcards = async (cardsToImport?: DeckFlashcard[], customTitle?: string) => {
    const sourceCards = cardsToImport ?? validSnapshotCards;
    if (!sourceCards.length) {
      setErrorMsg('Select at least one StudyWeb flashcard section to import.');
      return;
    }
    setSavingDeck(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const uniqueSubjects = Array.from(new Set(sourceCards.map((c) => c.subjName).filter(Boolean)));
      const subjectLabel = uniqueSubjects.slice(0, 2).join(' & ') || 'My Flashcards';
      const title = (customTitle || '').trim() || `StudyWeb · ${subjectLabel}`;
      const deck = await persistQuizDeck(title, {
        cards: buildQuizCardsFromFlashcards(sourceCards),
      });
      await fetchDecks();
      setSelectedDeckId(deck.id);
      setSelectedSections(deck.sections.map((s) => s.name));
      setHostSource('saved');
      setShowCurrentImporter(false);
      setImportDeckTitle('');
      setInfoMsg(
        `Saved ${deck.cardCount} StudyWeb flashcards into "${deck.title}".`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import StudyWeb cards.');
    } finally {
      setSavingDeck(false);
    }
  };

  const handleDeleteDeck = async (id: string) => {
    try {
      if (backendMode === 'server') {
        const res = await fetch(`/api/quiz/decks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          if (!res.ok) throw new Error('Delete failed.');
        } else {
          setBackendMode('cloud');
          await deleteCloudDeck(id);
        }
      } else {
        await deleteCloudDeck(id);
      }
      setConfirmDeleteDeckId(null);
      await fetchDecks();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not delete deck.');
    }
  };

  const handleSelectDeckForHost = (deck: QuizDeckSummary) => {
    setHostSource('saved');
    setSelectedDeckId(deck.id);
    setSelectedSections(deck.sections.map((s) => s.name));
    setSubTab('host');
    setErrorMsg(null);
  };

  const handleCreateRoom = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!hostNickname.trim()) {
      setErrorMsg('Enter your nickname so you can play alongside friends.');
      return;
    }

    let deckIdToUse = selectedDeck?.id || '';
    let deckTitleToUse = selectedDeck?.title || '';
    let sectionsToUse = selectedSections;
    let inlineCards: Array<{ question: string; answer: string; section: string }> | null = null;

    if (hostSource === 'current') {
      if (!selectedCurrentCards.length) {
        setErrorMsg('Select at least one flashcard section with matching cards to play.');
        return;
      }
      inlineCards = buildQuizCardsFromFlashcards(selectedCurrentCards);
      deckTitleToUse = derivedCurrentQuizTitle;
      deckIdToUse = `live_${Date.now().toString(36)}`;
      sectionsToUse = Array.from(new Set(inlineCards.map((c) => c.section)));

      if (saveCurrentToDb) {
        try {
          await persistQuizDeck(deckTitleToUse, { cards: inlineCards });
          void fetchDecks();
        } catch {
          // Non-fatal: still launch live quiz with inline cards
        }
      }
    } else {
      if (!selectedDeck) {
        setErrorMsg('Create or pick a saved deck first, or switch to My Current Flashcards.');
        return;
      }
      if (!selectedSections.length) {
        setErrorMsg('Select at least one Section to include in the quiz.');
        return;
      }
    }

    if (backendMode === 'server') {
      try {
        const ws = await connectWebSocket();
        const byok = getByokConfig();
        ws.send(
          JSON.stringify(
            inlineCards
              ? {
                  type: 'quiz:create',
                  inlineDeckTitle: deckTitleToUse,
                  inlineCards,
                  timerSeconds,
                  gameMode,
                  questionFormat,
                  brawlDifficulty,
                  nickname: hostNickname.trim(),
                  ...(byok ? { byok } : {}),
                }
              : {
                  type: 'quiz:create',
                  deckId: deckIdToUse,
                  selectedSections: sectionsToUse,
                  timerSeconds,
                  gameMode,
                  questionFormat,
                  brawlDifficulty,
                  nickname: hostNickname.trim(),
                  ...(byok ? { byok } : {}),
                }
          )
        );
        return;
      } catch {
        // Fallback transparently to Cloud Mode if WebSocket server isn't running
        setBackendMode('cloud');
      }
    }

    try {
      let cardsForCloud: Array<{
        question: string;
        answer: string;
        section: string;
        options?: string[];
      }> = inlineCards || [];
      if (!inlineCards && selectedDeck) {
        const cloudDecks = await loadCloudDecks();
        const found = cloudDecks.find((d) => d.id === selectedDeck.id) as CloudQuizDeck | undefined;
        const secSet = new Set(sectionsToUse);
        cardsForCloud = (found?.cards || [])
          .filter((c) => secSet.size === 0 || secSet.has(c.section))
          .map((c) => ({
            question: c.question,
            answer: c.answer,
            section: c.section,
            ...(c.options?.length ? { options: c.options } : {}),
          }));
      }
      if (!cardsForCloud.length) {
        setErrorMsg('No flashcards found in the selected deck/sections.');
        return;
      }
      const created = await createCloudRoom({
        deckId: deckIdToUse,
        deckTitle: deckTitleToUse,
        selectedSections: sectionsToUse,
        timerSeconds,
        gameMode,
        questionFormat,
        brawlDifficulty,
        nickname: hostNickname.trim(),
        cards: cardsForCloud,
      });
      attachCloudSubscription(created.code, created.playerId, created.questions);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to create Live Quiz room.');
    }
  };

  const handleJoinRoom = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const cleanCode = joinCode.trim().toUpperCase();
    if (cleanCode.length < 4) {
      setErrorMsg('Enter the 4-letter room code.');
      return;
    }
    if (!joinNickname.trim()) {
      setErrorMsg('Enter your nickname to join.');
      return;
    }

    if (backendMode === 'server') {
      try {
        const ws = await connectWebSocket();
        ws.send(
          JSON.stringify({
            type: 'quiz:join',
            code: cleanCode,
            nickname: joinNickname.trim(),
          })
        );
        return;
      } catch {
        setBackendMode('cloud');
      }
    }

    try {
      const joined = await joinCloudRoom({
        code: cleanCode,
        nickname: joinNickname.trim(),
      });
      cloudQuestionsRef.current = [];
      attachCloudSubscription(joined.code, joined.playerId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not join quiz room.');
    }
  };

  const submitAnswerValue = useCallback(
    async (answerText: string) => {
      if (!room || room.status !== 'question') return;
      const currentMe = playerId ? room.players.find((p) => p.id === playerId) : null;
      if (currentMe?.hasSubmitted) return;
      playQuizTone('submit', muted);
      if (backendMode === 'server') {
        const byok = getByokConfig();
        await sendWs({
          type: 'quiz:submit',
          answer: answerText,
          ...(byok ? { byok } : {}),
        });
        return;
      }
      if (!playerId) return;
      try {
        await submitCloudAnswer({
          code: room.code,
          playerId,
          questionIndex: room.currentIndex,
          roundId: room.roundId || `r_${room.currentIndex}`,
          questionStartedAt: room.questionStartedAt,
          answer: answerText,
        });
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to submit answer.');
      }
    },
    [room, playerId, muted, backendMode, sendWs]
  );

  const handleSubmitAnswer = async (e: FormEvent) => {
    e.preventDefault();
    await submitAnswerValue(answerInput);
  };

  const handleReportBrawlProgress = useCallback(
    (stats: QuizBrawlStats) => {
      if (!room || room.status !== 'question') return;
      if (backendMode === 'server') {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'quiz:brawl-progress', stats }));
        }
        return;
      }
      if (!playerId) return;
      const track = brawlStatsTrackRef.current;
      const computedScore = stats.xp + stats.kills * 25 + track.bonusPoints;
      void submitCloudBrawlProgress({
        code: room.code,
        playerId,
        stats,
        score: computedScore,
        correctCount: track.correctCount,
        streak: track.streak,
        bestStreak: track.bestStreak,
      });
    },
    [room, backendMode, playerId]
  );

  const handleSubmitBrawlAnswer = useCallback(
    async (question: QuizBrawlQuestion, answerText: string): Promise<BrawlAnswerFeedback> => {
      if (backendMode === 'server' && room) {
        const requestId = `br_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        const byok = getByokConfig();
        return await new Promise<BrawlAnswerFeedback>((resolve) => {
          const timeoutId = window.setTimeout(() => {
            brawlPendingResolversRef.current.delete(requestId);
            resolve({
              correct: false,
              officialAnswer: question.answer || '',
              pointsAwarded: 0,
              streak: 0,
            });
          }, 8000);

          brawlPendingResolversRef.current.set(requestId, (res) => {
            window.clearTimeout(timeoutId);
            resolve(res);
          });

          void sendWs({
            type: 'quiz:brawl-answer',
            requestId,
            questionId: question.id,
            answer: answerText,
            ...(byok ? { byok } : {}),
          });
        });
      }

      const official =
        question.answer ||
        cloudQuestionsRef.current.find((c) => c.id === question.id)?.answer ||
        '';
      const outcome = await gradeBrawlAnswerLocalOrCloud({
        question: question.question,
        officialAnswer: official,
        studentAnswer: answerText,
        isMcq: room?.questionFormat === 'mcq',
      });

      const track = brawlStatsTrackRef.current;
      let pointsAwarded = 0;
      if (outcome.correct) {
        track.correctCount += 1;
        track.streak += 1;
        track.bestStreak = Math.max(track.bestStreak, track.streak);
        pointsAwarded = 150 + Math.min(200, (track.streak - 1) * 50);
        track.bonusPoints += pointsAwarded;
      } else {
        track.streak = 0;
      }

      return {
        correct: outcome.correct,
        officialAnswer: official,
        pointsAwarded,
        streak: track.streak,
      };
    },
    [backendMode, room, sendWs]
  );

  // Keyboard shortcuts 1-4 / A-D for Classic MCQ questions
  useEffect(() => {
    if (
      !room ||
      room.gameMode === 'monster-brawl' ||
      room.status !== 'question' ||
      !room.currentQuestion?.choices?.length
    ) {
      return;
    }
    const choices = room.currentQuestion.choices;
    const currentMe = playerId ? room.players.find((p) => p.id === playerId) : null;
    if (currentMe?.hasSubmitted) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const lower = e.key.toLowerCase();
      const idx =
        lower === '1' || lower === 'a'
          ? 0
          : lower === '2' || lower === 'b'
          ? 1
          : lower === '3' || lower === 'c'
          ? 2
          : lower === '4' || lower === 'd'
          ? 3
          : -1;
      if (idx >= 0 && choices[idx]) {
        e.preventDefault();
        void submitAnswerValue(choices[idx]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [room, playerId, submitAnswerValue]);

  const handleLeaveRoom = async () => {
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // ignore
    }
    if (backendMode === 'server') {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'quiz:leave' }));
      }
    } else {
      if (cloudUnsubRef.current) {
        cloudUnsubRef.current();
        cloudUnsubRef.current = null;
      }
      if (room && playerId) {
        await leaveCloudRoom(room.code, playerId, Boolean(me?.isHost));
      }
      cloudQuestionsRef.current = [];
    }
    setRoom(null);
    setPlayerId(null);
  };

  const copyRoomCode = () => {
    if (!room) return;
    void navigator.clipboard.writeText(room.code);
    setCopiedCode(true);
    window.setTimeout(() => setCopiedCode(false), 1800);
  };

  const me = useMemo(
    () => (room && playerId ? room.players.find((p) => p.id === playerId) || null : null),
    [room, playerId]
  );
  const isHost = Boolean(me?.isHost);

  const brawlCoopChannel = useMemo<BrawlCoopChannel>(
    () => ({
      isRealtimeServer: backendMode === 'server',
      sendWorld: (world) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'quiz:brawl-world', world }));
        }
      },
      sendHero: (hero) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'quiz:brawl-hero', hero }));
        }
      },
      sendAction: (action) => {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'quiz:brawl-action', action }));
        }
      },
      subscribe: (handlers) => {
        brawlCoopListenersRef.current = handlers;
        return () => {
          brawlCoopListenersRef.current = {};
        };
      },
    }),
    [backendMode]
  );

  // ============================================================================
  // ACTIVE MULTIPLAYER ARENA VIEW (Lobby / Question / Reveal / Podium)
  // ============================================================================
  if (room) {
    if (room.gameMode === 'monster-brawl' && room.status === 'question') {
      return (
        <MonsterBrawlArena
          room={room}
          playerId={playerId}
          isHost={isHost}
          muted={muted}
          coopChannel={brawlCoopChannel}
          onToggleMute={() => setMuted((m) => !m)}
          onReportProgress={(stats) => void handleReportBrawlProgress(stats)}
          onSubmitBrawlAnswer={handleSubmitBrawlAnswer}
          onFinishMatch={() => void sendHostAction('finish-brawl')}
          onLeaveRoom={() => void handleLeaveRoom()}
        />
      );
    }

    const connectedCount = room.players.filter((p) => p.connected).length;
    const answeredCount = room.players.filter((p) => p.hasSubmitted).length;
    const totalMs = room.timerSeconds * 1000;
    const timerRatio = totalMs > 0 ? Math.max(0, Math.min(1, timeLeftMs / totalMs)) : 0;
    const secondsRemaining = Math.ceil(timeLeftMs / 1000);

    return (
      <div className="h-full overflow-y-auto bg-[var(--bg)]">
        {/* Pinned Host & Arena Control Bar */}
        <div className="sticky top-0 z-20 border-b border-[var(--line)] bg-[var(--card)]/95 px-4 py-2.5 backdrop-blur sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold uppercase tracking-wider text-[var(--mute)]">
                  Room
                </span>
                <button
                  type="button"
                  onClick={copyRoomCode}
                  title="Copy 4-letter room code"
                  className="sd-btn font-mono-num px-2.5 py-1 text-sm font-extrabold tracking-widest text-[var(--e3)] whitespace-nowrap"
                >
                  <span>{room.code}</span>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {copiedCode && (
                  <span className="text-[11px] font-semibold text-[var(--ok)]">Copied</span>
                )}
              </div>

              <span className="text-[var(--line)]">|</span>
              <span className="truncate font-semibold text-[var(--ink)]">{room.deckTitle}</span>
              <span className="font-mono-num text-[var(--mute)]">
                {connectedCount} player{connectedCount === 1 ? '' : 's'}
              </span>
              {!wsConnected && (
                <span className="font-semibold text-[var(--bad)]">Reconnecting…</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {isHost && room.status === 'lobby' && (
                <button
                  type="button"
                  disabled={hostActionBusy}
                  onClick={() => void sendHostAction('start')}
                  className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap disabled:opacity-60"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Start Game ({room.totalQuestions} Qs)</span>
                </button>
              )}
              {isHost && room.status === 'question' && (
                <button
                  type="button"
                  disabled={hostActionBusy}
                  onClick={() => void sendHostAction('reveal')}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap disabled:opacity-60"
                >
                  <Zap className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                  <span>Reveal Now</span>
                </button>
              )}
              {isHost && room.status === 'reveal' && (
                <button
                  type="button"
                  disabled={hostActionBusy}
                  onClick={() => void sendHostAction('next')}
                  className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap disabled:opacity-60"
                >
                  <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {room.currentIndex + 1 >= room.totalQuestions
                      ? 'Show Final Podium'
                      : 'Next Question'}
                  </span>
                </button>
              )}
              {isHost && room.status === 'finished' && (
                <button
                  type="button"
                  disabled={hostActionBusy}
                  onClick={() => void sendHostAction('restart')}
                  className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap disabled:opacity-60"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Play Again</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? 'Unmute quiz sound effects' : 'Mute quiz sound effects'}
                title={muted ? 'Unmute sounds' : 'Mute sounds'}
                className="sd-btn h-8 w-8 p-0"
              >
                {muted ? (
                  <VolumeX className="h-3.5 w-3.5 text-[var(--mute)]" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-3.5 w-3.5 text-[var(--ink)]" aria-hidden="true" />
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleLeaveRoom()}
                className="sd-btn px-3 py-1.5 text-xs text-[var(--bad)] whitespace-nowrap"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Leave</span>
              </button>
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
          {errorMsg && (
            <div className="sd-card border-[var(--bad)] p-3 text-sm font-medium text-[var(--bad)]">
              {errorMsg}
            </div>
          )}

          {/* STAGE 1: LOBBY */}
          {room.status === 'lobby' && (
            <div className="grid gap-5 lg:grid-cols-5">
              <div className="sd-card space-y-4 p-6 lg:col-span-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--e3)]">
                  Multiplayer Lobby
                </div>
                <div>
                  <h1 className="font-display text-2xl font-extrabold text-[var(--ink)]">
                    {room.deckTitle}
                  </h1>
                  <p className="mt-1 text-sm text-[var(--mute)]">
                    Share this 4-letter room code with friends so they can join from the Live Quiz
                    tab on any device.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-5">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--mute)]">
                      4-Letter Room Code
                    </div>
                    <div className="font-mono-num mt-1 text-4xl font-extrabold tracking-[0.22em] text-[var(--e3)]">
                      {room.code}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={copyRoomCode}
                    className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{copiedCode ? 'Copied Code' : 'Copy Code'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-[var(--mute)]">Game Mode</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-[var(--ink)]">
                      {room.gameMode === 'monster-brawl' ? (
                        <>
                          <Swords className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                          <span>Monster Brawl</span>
                        </>
                      ) : (
                        <>
                          <Gamepad2 className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                          <span>Classic Quiz</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-[var(--mute)]">Question Format</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-sm font-bold text-[var(--ink)]">
                      {room.questionFormat === 'mcq' ? (
                        <>
                          <ListChecks className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                          <span>Multiple Choice</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                          <span>Typed Recall</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-[var(--mute)]">Questions</div>
                    <div className="font-mono-num mt-0.5 text-lg font-bold text-[var(--ink)]">
                      {room.totalQuestions}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-[var(--mute)]">
                      {room.gameMode === 'monster-brawl' ? 'Difficulty' : 'Round Timer'}
                    </div>
                    <div className="font-mono-num mt-0.5 text-lg font-bold text-[var(--ink)]">
                      {room.gameMode === 'monster-brawl'
                        ? BRAWL_DIFFICULTIES[room.brawlDifficulty || 'easy'].label
                        : `${room.timerSeconds}s`}
                    </div>
                  </div>
                </div>

                {room.gameMode === 'monster-brawl' && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-[var(--ink)]">
                    <strong>Co-op Arena Scaling:</strong> All {connectedCount} connected player
                    {connectedCount === 1 ? '' : 's'} fight together on the expanded arena map.
                    Monster HP &amp; spawn intensity scale automatically with team size.
                  </div>
                )}

                <div className="text-xs text-[var(--mute)]">
                  <strong className="text-[var(--ink)]">Included Sections:</strong>{' '}
                  {room.selectedSections.join(' · ')}
                </div>

                {isHost ? (
                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={hostActionBusy}
                      onClick={() => void sendHostAction('start')}
                      className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap disabled:opacity-60"
                    >
                      {room.gameMode === 'monster-brawl' ? (
                        <Swords className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Play className="h-4 w-4" aria-hidden="true" />
                      )}
                      <span>
                        {room.gameMode === 'monster-brawl'
                          ? 'Start Monster Brawl Now'
                          : 'Start Live Quiz Now'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs font-medium text-[var(--mute)]">
                    Waiting for the Host to launch {room.gameMode === 'monster-brawl' ? 'Monster Brawl' : 'the match'}…
                  </div>
                )}
              </div>

              <div className="sd-card flex flex-col p-5 lg:col-span-2">
                <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                  <div className="flex items-center gap-2 font-display text-base font-bold text-[var(--ink)]">
                    <Users className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                    <span>Players ({room.players.length})</span>
                  </div>
                </div>
                <ul className="mt-3 flex-1 space-y-2">
                  {room.players.map((p) => (
                    <li
                      key={p.id}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2.5 text-sm ${
                        p.id === playerId
                          ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_8%,var(--bg))]'
                          : 'border-[var(--line)] bg-[var(--bg)]'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2 font-semibold text-[var(--ink)]">
                        <span
                          className={`h-2 w-2 shrink-0 rounded-full ${
                            p.connected ? 'bg-[var(--ok)]' : 'bg-[var(--mute)]'
                          }`}
                        />
                        <span className="truncate">{p.nickname}</span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-[var(--mute)]">
                        {p.isHost ? 'Host & Player' : p.id === playerId ? 'You' : 'Ready'}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* STAGE 2: ACTIVE QUESTION */}
          {room.status === 'question' && room.currentQuestion && (
            <div className="space-y-4">
              {/* Progress & Timer Header */}
              <div className="sd-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--mute)]">
                    <span className="font-mono-num font-bold text-[var(--ink)]">
                      Question {room.currentIndex + 1} / {room.totalQuestions}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-[var(--e3)]">
                      Section: {room.currentQuestion.section}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="font-mono-num text-xs font-semibold text-[var(--mute)]">
                      {answeredCount}/{connectedCount} answered
                    </span>
                    <div
                      className={`font-mono-num flex items-center gap-1.5 text-lg font-extrabold ${
                        secondsRemaining <= 5 ? 'text-[var(--bad)]' : 'text-[var(--ink)]'
                      }`}
                    >
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      <span>{secondsRemaining}s</span>
                    </div>
                  </div>
                </div>

                {/* Countdown Progress Bar */}
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--bg)]">
                  <div
                    className={`h-full transition-[width] duration-100 ${
                      secondsRemaining <= 5 ? 'bg-[var(--bad)]' : 'bg-[var(--e3)]'
                    }`}
                    style={{ width: `${Math.round(timerRatio * 100)}%` }}
                  />
                </div>

                {/* Question Prompt */}
                <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-6">
                  <h2 className="font-display text-xl font-bold leading-snug text-[var(--ink)] sm:text-2xl">
                    {room.currentQuestion.question}
                  </h2>
                </div>

                {/* Player / Host Answer Input (MCQ Buttons or Typed Recall) */}
                {!me?.hasSubmitted ? (
                  room.currentQuestion.choices && room.currentQuestion.choices.length >= 2 ? (
                    <div className="mt-5 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)]">
                        <span className="font-semibold">
                          Pick the correct option (press keys 1–4 or A–D)
                        </span>
                        <span className="font-mono-num">Up to 1,000 pts + streak bonus</span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {room.currentQuestion.choices.map((choice, idx) => {
                          const letter = String.fromCharCode(65 + idx);
                          const accentClasses = [
                            'hover:border-emerald-500/70 hover:bg-emerald-500/10',
                            'hover:border-sky-500/70 hover:bg-sky-500/10',
                            'hover:border-amber-500/70 hover:bg-amber-500/10',
                            'hover:border-violet-500/70 hover:bg-violet-500/10',
                          ][idx % 4];
                          const badgeClasses = [
                            'bg-emerald-500/15 text-emerald-500 border-emerald-500/30',
                            'bg-sky-500/15 text-sky-500 border-sky-500/30',
                            'bg-amber-500/15 text-amber-500 border-amber-500/30',
                            'bg-violet-500/15 text-violet-500 border-violet-500/30',
                          ][idx % 4];
                          return (
                            <button
                              key={`${idx}_${choice}`}
                              type="button"
                              onClick={() => void submitAnswerValue(choice)}
                              className={`group flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-left transition-all ${accentClasses}`}
                            >
                              <span
                                className={`font-mono-num flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-sm font-extrabold ${badgeClasses}`}
                              >
                                {letter}
                              </span>
                              <span className="min-w-0 flex-1 text-sm font-semibold leading-snug text-[var(--ink)] sm:text-base">
                                {choice}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <form onSubmit={(e) => void handleSubmitAnswer(e)} className="mt-5 space-y-3">
                      <label className="block text-xs font-semibold text-[var(--mute)]">
                        Your Answer (speed counts — up to 1,000 pts + streak bonus)
                        <input
                          type="text"
                          autoFocus
                          value={answerInput}
                          onChange={(e) => setAnswerInput(e.target.value)}
                          placeholder="Type your answer and press Enter…"
                          className="sd-input mt-1.5 py-3 text-base"
                        />
                      </label>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-[var(--mute)]">
                          Exact answers pass in 0ms; close phrasings &amp; dates are checked
                          immediately by Smart + Gemini Flash-Lite Grading.
                        </span>
                        <button
                          type="submit"
                          className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap"
                        >
                          Submit Answer
                        </button>
                      </div>
                    </form>
                  )
                ) : (
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_8%,var(--bg))] p-4 text-sm">
                    <div>
                      <div className="font-semibold text-[var(--ink)]">
                        Answer submitted:{' '}
                        <span className="text-[var(--e3)]">
                          {me.lastSubmission?.answer || '(Blank)'}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--mute)]">
                        {me.gradingStatus === 'grading'
                          ? 'Checking factual meaning in the background…'
                          : 'Graded! Waiting for remaining players or timer to reveal results.'}
                      </div>
                    </div>
                    <div className="font-mono-num text-xs font-bold text-[var(--mute)]">
                      {((me.lastSubmission?.elapsedMs || 0) / 1000).toFixed(2)}s
                    </div>
                  </div>
                )}
              </div>

              {/* Compact Live Status Strip */}
              <div className="sd-card p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--mute)]">
                  Live Table Status
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {room.players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-xs"
                    >
                      <span className="truncate font-semibold text-[var(--ink)]">
                        {p.nickname}
                        {p.isHost ? ' (Host)' : ''}
                      </span>
                      <span className="font-mono-num shrink-0 font-semibold">
                        {!p.hasSubmitted ? (
                          <span className="text-[var(--mute)]">Typing…</span>
                        ) : p.gradingStatus === 'grading' ? (
                          <span className="text-[var(--e2)]">Grading…</span>
                        ) : (
                          <span className="text-[var(--ok)]">Locked ✓</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STAGE 3: ROUND REVEAL & LEADERBOARD */}
          {room.status === 'reveal' && room.currentQuestion && (
            <div className="space-y-4">
              <div className="sd-card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-[var(--mute)]">
                  <span>
                    Round {room.currentIndex + 1} of {room.totalQuestions} ·{' '}
                    {room.currentQuestion.section}
                  </span>
                  {isHost && (
                    <button
                      type="button"
                      disabled={hostActionBusy}
                      onClick={() => void sendHostAction('next')}
                      className="sd-btn-pri px-4 py-1.5 text-xs whitespace-nowrap disabled:opacity-60"
                    >
                      <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {room.currentIndex + 1 >= room.totalQuestions
                          ? 'Final Podium'
                          : 'Next Question'}
                      </span>
                    </button>
                  )}
                </div>

                <h2 className="font-display mt-2 text-lg font-bold text-[var(--ink)]">
                  {room.currentQuestion.question}
                </h2>

                <div className="mt-4 rounded-xl border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_9%,var(--bg))] p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ok)]">
                    Official Answer
                  </div>
                  <div className="mt-1 text-base font-bold text-[var(--ink)]">
                    {room.currentQuestion.officialAnswer}
                  </div>
                </div>

                {me && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
                    {me.lastSubmission?.correct ? (
                      <div className="flex items-center gap-2 font-semibold text-[var(--ok)]">
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>
                          Correct! +{me.lastSubmission.pointsAwarded} pts
                          {me.lastSubmission.streakBonus > 0
                            ? ` (includes +${me.lastSubmission.streakBonus} streak bonus)`
                            : ''}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 font-semibold text-[var(--bad)]">
                        <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>
                          {me.lastSubmission
                            ? `Marked incorrect ("${me.lastSubmission.answer}")`
                            : 'No answer submitted in time'}
                        </span>
                      </div>
                    )}
                    <div className="font-mono-num text-[var(--mute)]">
                      Your Total: <strong className="text-[var(--ink)]">{me.score} pts</strong> ·
                      Streak: <strong className="text-[var(--ink)]">{me.streak}</strong>
                    </div>
                  </div>
                )}
              </div>

              {/* Round Answers + Live Leaderboard */}
              <div className="sd-card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-display flex items-center gap-2 text-base font-bold text-[var(--ink)]">
                    <Trophy className="h-4 w-4 text-[var(--e2)]" aria-hidden="true" />
                    <span>Live Leaderboard &amp; Round Results</span>
                  </h3>
                  <span className="text-xs text-[var(--mute)]">Sorted by points</span>
                </div>

                <div className="space-y-2">
                  {room.players.map((p, idx) => {
                    const sub = p.lastSubmission;
                    return (
                      <div
                        key={p.id}
                        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 text-xs ${
                          p.id === playerId
                            ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_7%,var(--bg))]'
                            : 'border-[var(--line)] bg-[var(--bg)]'
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <span className="font-mono-num w-6 shrink-0 text-sm font-extrabold text-[var(--mute)]">
                            #{idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 font-bold text-[var(--ink)]">
                              <span className="truncate">{p.nickname}</span>
                              {p.streak >= 2 && (
                                <span className="font-mono-num text-[11px] font-semibold text-[var(--e2)]">
                                  🔥 {p.streak} streak
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate text-[var(--mute)]">
                              {sub
                                ? `Answered: "${sub.answer}" (${(sub.elapsedMs / 1000).toFixed(1)}s)`
                                : 'No submission'}
                            </div>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-3">
                          {sub ? (
                            sub.correct ? (
                              <span className="flex items-center gap-1 font-semibold text-[var(--ok)]">
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>
                                  {sub.gradingSource === 'local' ? '0ms Match' : 'AI Match'} +
                                  {sub.pointsAwarded}
                                </span>
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 font-semibold text-[var(--bad)]">
                                <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                                <span>Incorrect +0</span>
                              </span>
                            )
                          ) : (
                            <span className="text-[var(--mute)]">Timed out +0</span>
                          )}

                          <span className="font-mono-num min-w-[70px] text-right text-sm font-extrabold text-[var(--ink)]">
                            {p.score.toLocaleString()} pts
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* STAGE 4: FINAL PODIUM */}
          {room.status === 'finished' && (
            <div className="space-y-5">
              <div className="sd-card p-6 text-center">
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--e2)]">
                  <Award className="h-4 w-4" aria-hidden="true" />
                  <span>Final Podium</span>
                </div>
                <h1 className="font-display mt-1 text-2xl font-extrabold text-[var(--ink)]">
                  {room.deckTitle} — Match Complete
                </h1>
                <p className="mt-1 text-sm text-[var(--mute)]">
                  {room.totalQuestions} questions played · {room.players.length} participant
                  {room.players.length === 1 ? '' : 's'}
                </p>

                {/* Top 3 Podium Cards */}
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {[1, 0, 2].map((rankIdx) => {
                    const p = room.players[rankIdx];
                    if (!p) {
                      return (
                        <div
                          key={rankIdx}
                          className="hidden rounded-2xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 sm:block"
                        />
                      );
                    }
                    const place = rankIdx + 1;
                    const isFirst = place === 1;
                    return (
                      <div
                        key={p.id}
                        className={`rounded-2xl border p-5 ${
                          isFirst
                            ? 'border-[var(--e2)] bg-[color-mix(in_srgb,var(--e2)_10%,var(--bg))] sm:-mt-2'
                            : 'border-[var(--line)] bg-[var(--bg)]'
                        }`}
                      >
                        <div className="font-mono-num text-xs font-extrabold uppercase tracking-wider text-[var(--mute)]">
                          {place === 1 ? '1st Place' : place === 2 ? '2nd Place' : '3rd Place'}
                        </div>
                        <div className="font-display mt-1 truncate text-xl font-extrabold text-[var(--ink)]">
                          {p.nickname}
                        </div>
                        <div className="font-mono-num mt-2 text-2xl font-extrabold text-[var(--e3)]">
                          {p.score.toLocaleString()} pts
                        </div>
                        <div className="font-mono-num mt-1 text-xs text-[var(--mute)]">
                          {p.correctCount}
                          {room.gameMode === 'monster-brawl' ? '' : `/${room.totalQuestions}`} correct ·
                          Best streak {p.bestStreak}
                        </div>
                        {room.gameMode === 'monster-brawl' && p.brawlStats && (
                          <div className="font-mono-num mt-1 text-[11px] font-semibold text-[var(--e2)]">
                            Lv. {p.brawlStats.level} · Wave {p.brawlStats.wave} ·{' '}
                            {p.brawlStats.kills} kills
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  {isHost && (
                    <button
                      type="button"
                      disabled={hostActionBusy}
                      onClick={() => void sendHostAction('restart')}
                      className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap disabled:opacity-60"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      <span>Play Again</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleLeaveRoom()}
                    className="sd-btn px-5 py-2.5 text-sm whitespace-nowrap"
                  >
                    Back to Live Quiz Decks
                  </button>
                </div>
              </div>

              {/* Full Standings */}
              <div className="sd-card p-5">
                <h2 className="font-display mb-3 text-base font-bold text-[var(--ink)]">
                  Full Standings
                </h2>
                <div className="space-y-2">
                  {room.players.map((p, idx) => (
                    <div
                      key={p.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] px-4 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono-num font-bold text-[var(--mute)]">
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-[var(--ink)]">{p.nickname}</span>
                      </div>
                      <div className="font-mono-num flex flex-wrap items-center gap-4 text-[var(--mute)]">
                        {room.gameMode === 'monster-brawl' && p.brawlStats && (
                          <span className="text-[var(--e2)]">
                            Lv.{p.brawlStats.level} · W{p.brawlStats.wave} · {p.brawlStats.kills}{' '}
                            kills
                          </span>
                        )}
                        <span>
                          {p.correctCount}
                          {room.gameMode === 'monster-brawl' ? '' : `/${room.totalQuestions}`} correct
                        </span>
                        <span>Best streak {p.bestStreak}</span>
                        <strong className="text-sm text-[var(--ink)]">
                          {p.score.toLocaleString()} pts
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================================
  // PRE-GAME VIEW: Decks & CSV Import | Host Game | Join Game
  // ============================================================================
  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
        {/* Header & Mode Switch */}
        <div className="sd-card flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--e3)]">
              <Gamepad2 className="h-4 w-4" aria-hidden="true" />
              <span>
                Multiplayer Flashcard Arena ·{' '}
                {byokConfig
                  ? `Marking with Your ${
                      byokConfig.provider === 'gemini'
                        ? 'Gemini'
                        : byokConfig.provider === 'grok'
                        ? 'Grok (xAI)'
                        : 'Custom'
                    } API Key`
                  : 'Site Live Quiz Grading'}
              </span>
            </div>
            <h1 className="font-display mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink)]">
              Live Quiz
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--mute)]">
              Play directly from your current StudyWeb flashcards or import CSV decks into the
              built-in database, launch a 4-letter lobby alongside friends, and score speed + streak
              points with instant semantic grading.
            </p>
          </div>

          <div className="sd-seg shrink-0">
            <button
              type="button"
              aria-pressed={subTab === 'host'}
              onClick={() => setSubTab('host')}
              className="sd-seg-btn"
            >
              Host Game
            </button>
            <button
              type="button"
              aria-pressed={subTab === 'join'}
              onClick={() => setSubTab('join')}
              className="sd-seg-btn"
            >
              Join Code
            </button>
            <button
              type="button"
              aria-pressed={subTab === 'decks'}
              onClick={() => setSubTab('decks')}
              className="sd-seg-btn"
            >
              Decks &amp; CSV ({decks.length})
            </button>
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="sd-card border-[var(--bad)] bg-[color-mix(in_srgb,var(--bad)_9%,var(--card))] p-3.5 text-sm font-medium text-[var(--bad)]"
          >
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div
            role="status"
            className="sd-card flex flex-wrap items-center justify-between gap-3 border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_9%,var(--card))] p-3.5 text-sm"
          >
            <span className="font-medium text-[var(--ink)]">{infoMsg}</span>
            <button
              type="button"
              onClick={() => {
                setHostSource('saved');
                setSubTab('host');
              }}
              className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
            >
              Host This Deck
            </button>
          </div>
        )}

        {/* TAB 1: DECKS & CSV IMPORT */}
        {subTab === 'decks' && (
          <div className="grid gap-5 lg:grid-cols-5">
            {/* Import & Auto-Sections Form */}
            <div className="space-y-5 lg:col-span-3">
              <form onSubmit={(e) => void handleSaveDeck(e)} className="sd-card space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                      Import MCQ Text or CSV Decks
                    </h2>
                    <p className="mt-0.5 text-xs text-[var(--mute)]">
                      Paste formatted Multiple Choice question blocks, MCQ CSV files, or standard
                      <code> Question, Answer, Section</code> flashcard CSVs.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      ref={csvFileRef}
                      type="file"
                      accept=".csv,.txt,text/csv,text/plain"
                      className="hidden"
                      onChange={(e) => void handleCsvFileUpload(e)}
                    />
                    <button
                      type="button"
                      onClick={() => csvFileRef.current?.click()}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Upload .csv / .txt</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!importTitle.trim()) setImportTitle('MCQ Revision Pack');
                        setCsvText(SAMPLE_MCQ_TEXT);
                      }}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <ListChecks className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Sample MCQ Text</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!importTitle.trim()) setImportTitle('STEM & History MCQ CSV');
                        setCsvText(SAMPLE_MCQ_CSV);
                      }}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                      <span>Sample MCQ CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!importTitle.trim()) setImportTitle('Weimar Germany Revision');
                        setCsvText(SAMPLE_CSV);
                      }}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Sample CSV</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFormatGuide((v) => !v)}
                      aria-expanded={showFormatGuide}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                    >
                      <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Format Guide</span>
                    </button>
                  </div>
                </div>

                {showFormatGuide && (
                  <div className="grid gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-[11px] sm:grid-cols-2">
                    <div>
                      <div className="font-bold text-[var(--ink)]">
                        1. Pasted MCQ Text Block Format
                      </div>
                      <pre className="font-mono-num mt-1 whitespace-pre-wrap text-[var(--mute)]">
{`Section: Biology
Q: Which organelle produces ATP?
A) Ribosome
B) Mitochondrion *
C) Lysosome
D) Vacuole
(Or put "Answer: B" below options)`}
                      </pre>
                    </div>
                    <div>
                      <div className="font-bold text-[var(--ink)]">
                        2. Multiple Choice CSV Headers
                      </div>
                      <pre className="font-mono-num mt-1 whitespace-pre-wrap text-[var(--mute)]">
{`Question,A,B,C,D,Correct,Section
"Gas ~78% of air?","O2","N2","CO2","Ar",B,Chem
Also supports Question,CorrectAnswer,
Distractor1,Distractor2,Distractor3,Section`}
                      </pre>
                    </div>
                  </div>
                )}

                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Deck Title *
                  <input
                    type="text"
                    value={importTitle}
                    onChange={(e) => setImportTitle(e.target.value)}
                    placeholder="e.g. GCSE Biology Multiple Choice"
                    className="sd-input mt-1 text-sm"
                  />
                </label>

                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Paste MCQ Text, MCQ CSV, or Question/Answer CSV *
                  <textarea
                    rows={9}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder={
                      'Section: History\nQ: When was the Armistice signed?\nA) 11 November 1918 *\nB) 28 June 1919\nC) 4 August 1914\nD) 9 November 1918'
                    }
                    className="sd-input font-mono-num mt-1 text-xs leading-relaxed"
                  />
                </label>

                {/* Live Section & MCQ Grouping Preview */}
                {csvPreviewCards.length > 0 && (
                  <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-bold text-[var(--ink)]">
                        Parsed Preview: {csvPreviewCards.length} cards across{' '}
                        {csvPreviewSections.length} section
                        {csvPreviewSections.length === 1 ? '' : 's'}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono-num rounded-md border border-[var(--line)] bg-[var(--card)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink)]">
                          {parsedImport.formatDetected === 'mcq-text'
                            ? 'MCQ Text Blocks'
                            : parsedImport.formatDetected === 'mcq-csv'
                              ? 'MCQ CSV'
                              : 'Standard Q&A CSV'}
                        </span>
                        {parsedImport.mcqCount > 0 && (
                          <span className="font-mono-num rounded-md border border-[var(--e3)]/40 bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))] px-2 py-0.5 text-[11px] font-bold text-[var(--e3)]">
                            {parsedImport.mcqCount} MCQ cards
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-3 text-[var(--mute)]">
                      {csvPreviewSections.map((s) => (
                        <span key={s.name} className="font-mono-num">
                          <strong className="text-[var(--e3)]">{s.name}</strong> ({s.count})
                        </span>
                      ))}
                    </div>

                    <div className="space-y-2 border-t border-[var(--line)] pt-2.5">
                      {csvPreviewCards.slice(0, 3).map((card, idx) => (
                        <div
                          key={`${idx}_${card.question.slice(0, 20)}`}
                          className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-2.5"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-[var(--ink)]">
                              {idx + 1}. {card.question}
                            </span>
                            <span className="shrink-0 text-[11px] text-[var(--mute)]">
                              {card.section}
                            </span>
                          </div>
                          {card.options && card.options.length > 0 ? (
                            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                              {card.options.map((opt, optIdx) => {
                                const isAns =
                                  opt.trim().toLowerCase() === card.answer.trim().toLowerCase();
                                return (
                                  <div
                                    key={`${optIdx}_${opt}`}
                                    className={`rounded-md border px-2 py-1 text-[11px] ${
                                      isAns
                                        ? 'border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_10%,var(--bg))] font-bold text-[var(--ok)]'
                                        : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)]'
                                    }`}
                                  >
                                    {String.fromCharCode(65 + optIdx)}) {opt}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="mt-1 text-[11px] text-[var(--ok)]">
                              Answer: {card.answer}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-xs text-[var(--mute)]">
                    {backendMode === 'cloud'
                      ? 'Saved permanently in your Cloud Quiz library & browser.'
                      : 'Saved permanently in the built-in SQLite database.'}
                  </span>

                  <button
                    type="submit"
                    disabled={savingDeck}
                    className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                  >
                    <Database className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {savingDeck
                        ? 'Saving Deck…'
                        : backendMode === 'cloud'
                        ? 'Save Cloud Deck'
                        : 'Save Deck to Database'}
                    </span>
                  </button>
                </div>
              </form>

              {/* Selective Import from Current StudyWeb Flashcards */}
              <div className="sd-card space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold text-[var(--ink)]">
                      Save Current Flashcards as a Quiz Deck
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--mute)]">
                      Pick specific sections from your active StudyWeb flashcards ({validSnapshotCards.length}{' '}
                      available) to save permanently into the quiz database.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onRequestDecks()}
                      className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                      title="Refresh flashcards from workspace"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Refresh</span>
                    </button>
                    {validSnapshotCards.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowCurrentImporter((v) => !v)}
                        className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{showCurrentImporter ? 'Hide Picker' : 'Choose Sections'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {validSnapshotCards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-4 text-xs text-[var(--mute)]">
                    No current flashcards found in StudyWeb yet. Add cards in Flashcards, use Universal Import, or copy a shared deck from Community.
                  </div>
                ) : showCurrentImporter ? (
                  <div className="space-y-3 border-t border-[var(--line)] pt-3">
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Saved Deck Title
                      <input
                        type="text"
                        value={importDeckTitle}
                        onChange={(e) => setImportDeckTitle(e.target.value)}
                        placeholder="Leave blank to auto-name from selected subjects"
                        className="sd-input mt-1 text-sm"
                      />
                    </label>

                    <div className="flex items-center justify-between text-xs text-[var(--mute)]">
                      <span>
                        Selected <strong className="text-[var(--ink)]">{selectedImportCards.length}</strong>{' '}
                        of {validSnapshotCards.length} cards
                      </span>
                      <div className="flex flex-wrap items-center gap-3 font-semibold">
                        {allQuizFolderKeys.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setExpandedQuizFolders(new Set(allQuizFolderKeys))}
                              className="cursor-pointer text-[var(--mute)] hover:text-[var(--ink)] hover:underline"
                            >
                              Expand all
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedQuizFolders(new Set())}
                              className="cursor-pointer text-[var(--mute)] hover:text-[var(--ink)] hover:underline"
                            >
                              Collapse all
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setImportSecIds(allSnapshotSecIds)}
                          className="cursor-pointer text-[var(--e3)] hover:underline"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setImportSecIds([])}
                          className="cursor-pointer text-[var(--mute)] hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                      {snapshotSubjectGroups.map((subj) => {
                        const subjFolders = deckGroupsBySubject.get(subj.subjId) || [];
                        const folderedNames = new Set(subjFolders.flatMap((f) => f.sectionNames));
                        const unfolderedSections = subj.sections.filter(
                          (s) => !folderedNames.has(s.secName)
                        );
                        const renderImportSecCard = (sec: SnapshotSectionGroup) => {
                          const checked = importSecIds.includes(sec.secId);
                          return (
                            <label
                              key={sec.secId}
                              className={`flex cursor-pointer items-center justify-between rounded-lg border px-2.5 py-2 text-xs transition-colors ${
                                checked
                                  ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_8%,var(--bg))]'
                                  : 'border-[var(--line)] bg-[var(--bg)]'
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setImportSecIds((prev) =>
                                      checked
                                        ? prev.filter((id) => id !== sec.secId)
                                        : [...prev, sec.secId]
                                    )
                                  }
                                />
                                <span className="truncate font-semibold text-[var(--ink)]">
                                  {sec.secName}
                                </span>
                              </span>
                              <span className="font-mono-num shrink-0 text-[11px] text-[var(--mute)]">
                                {sec.cards.length}
                              </span>
                            </label>
                          );
                        };

                        return (
                          <div key={subj.subjId} className="space-y-1.5">
                            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                              {subj.subjName}
                            </div>

                            {subjFolders.map((folder) => {
                              const folderSections = subj.sections.filter((s) =>
                                folder.sectionNames.includes(s.secName)
                              );
                              if (folderSections.length === 0) return null;
                              const folderSecIds = folderSections.map((s) => s.secId);
                              const selectedCount = folderSecIds.filter((id) =>
                                importSecIds.includes(id)
                              ).length;
                              const allSelected =
                                folderSecIds.length > 0 && selectedCount === folderSecIds.length;
                              const totalCards = folderSections.reduce(
                                (sum, s) => sum + s.cards.length,
                                0
                              );
                              const folderKey = `folder:${folder.id}`;
                              const isOpen = expandedQuizFolders.has(folderKey);
                              return (
                                <div
                                  key={folder.id}
                                  className="rounded-lg border border-[var(--line)] bg-[var(--bg)]"
                                >
                                  <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                                    <button
                                      type="button"
                                      onClick={() => toggleQuizFolder(folderKey)}
                                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                                    >
                                      {isOpen ? (
                                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--mute)]" />
                                      ) : (
                                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--mute)]" />
                                      )}
                                      {isOpen ? (
                                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[var(--e3)]" />
                                      ) : (
                                        <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--e3)]" />
                                      )}
                                      <span className="truncate text-xs font-bold text-[var(--ink)]">
                                        {folder.name}
                                      </span>
                                      <span className="font-mono-num shrink-0 text-[11px] text-[var(--mute)]">
                                        {folderSections.length} decks · {totalCards} cards
                                      </span>
                                    </button>
                                    <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[var(--e3)]">
                                      <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={() =>
                                          setImportSecIds((prev) =>
                                            allSelected
                                              ? prev.filter((id) => !folderSecIds.includes(id))
                                              : Array.from(new Set([...prev, ...folderSecIds]))
                                          )
                                        }
                                      />
                                      <span>
                                        {allSelected
                                          ? 'Folder Selected'
                                          : selectedCount > 0
                                            ? `${selectedCount}/${folderSecIds.length}`
                                            : 'Select Folder'}
                                      </span>
                                    </label>
                                  </div>
                                  {isOpen && (
                                    <div className="grid gap-1.5 border-t border-[var(--line)] p-2 sm:grid-cols-2">
                                      {folderSections.map(renderImportSecCard)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {unfolderedSections.length > 0 &&
                              (subjFolders.length > 0 ? (
                                (() => {
                                  const otherKey = `other:${subj.subjId}`;
                                  const isOpen = expandedQuizFolders.has(otherKey);
                                  const otherIds = unfolderedSections.map((s) => s.secId);
                                  const selectedCount = otherIds.filter((id) =>
                                    importSecIds.includes(id)
                                  ).length;
                                  const allSelected =
                                    otherIds.length > 0 && selectedCount === otherIds.length;
                                  const totalCards = unfolderedSections.reduce(
                                    (sum, s) => sum + s.cards.length,
                                    0
                                  );
                                  return (
                                    <div className="rounded-lg border border-dashed border-[var(--line)] bg-[var(--bg)]">
                                      <div className="flex items-center justify-between gap-2 px-2.5 py-2">
                                        <button
                                          type="button"
                                          onClick={() => toggleQuizFolder(otherKey)}
                                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                                        >
                                          {isOpen ? (
                                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--mute)]" />
                                          ) : (
                                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--mute)]" />
                                          )}
                                          <Layers className="h-3.5 w-3.5 shrink-0 text-[var(--mute)]" />
                                          <span className="truncate text-xs font-semibold text-[var(--ink)]">
                                            Other Decks
                                          </span>
                                          <span className="font-mono-num shrink-0 text-[11px] text-[var(--mute)]">
                                            {unfolderedSections.length} decks · {totalCards} cards
                                          </span>
                                        </button>
                                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[var(--e3)]">
                                          <input
                                            type="checkbox"
                                            checked={allSelected}
                                            onChange={() =>
                                              setImportSecIds((prev) =>
                                                allSelected
                                                  ? prev.filter((id) => !otherIds.includes(id))
                                                  : Array.from(new Set([...prev, ...otherIds]))
                                              )
                                            }
                                          />
                                          <span>{allSelected ? 'Selected' : 'Select'}</span>
                                        </label>
                                      </div>
                                      {isOpen && (
                                        <div className="grid gap-1.5 border-t border-[var(--line)] p-2 sm:grid-cols-2">
                                          {unfolderedSections.map(renderImportSecCard)}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })()
                              ) : (
                                <div className="grid gap-1.5 sm:grid-cols-2">
                                  {unfolderedSections.map(renderImportSecCard)}
                                </div>
                              ))}
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={savingDeck || selectedImportCards.length === 0}
                        onClick={() =>
                          void handleImportWorkspaceFlashcards(selectedImportCards, importDeckTitle)
                        }
                        className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap"
                      >
                        <Database className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>
                          {savingDeck
                            ? 'Saving…'
                            : `Save Selected (${selectedImportCards.length} cards)`}
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-[var(--mute)]">
                      Quick-import all {validSnapshotCards.length} cards or click &ldquo;Choose
                      Sections&rdquo; to pick specific topics.
                    </span>
                    <button
                      type="button"
                      disabled={savingDeck}
                      onClick={() => void handleImportWorkspaceFlashcards()}
                      className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      <Database className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Import All ({validSnapshotCards.length})</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Saved Decks List */}
            <div className="sd-card flex flex-col p-5 lg:col-span-2">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Saved Decks
                </h2>
                <span className="font-mono-num text-xs font-semibold text-[var(--mute)]">
                  {decks.length} total
                </span>
              </div>

              {loadingDecks ? (
                <div className="py-8 text-center text-xs text-[var(--mute)]">
                  Loading saved decks…
                </div>
              ) : decks.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--mute)]">
                  No quiz decks saved yet. Paste CSV rows on the left, upload a <code>.csv</code>,
                  or save sections from your current flashcards.
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {decks.map((deck) => (
                    <div
                      key={deck.id}
                      className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate font-display text-sm font-bold text-[var(--ink)]">
                            {deck.title}
                          </div>
                          <div className="font-mono-num mt-0.5 text-xs text-[var(--mute)]">
                            {deck.cardCount} cards · {deck.sections.length} section
                            {deck.sections.length === 1 ? '' : 's'}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleSelectDeckForHost(deck)}
                            className="sd-btn-pri px-2.5 py-1.5 text-xs whitespace-nowrap"
                          >
                            Host
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (confirmDeleteDeckId === deck.id) {
                                void handleDeleteDeck(deck.id);
                              } else {
                                setConfirmDeleteDeckId(deck.id);
                              }
                            }}
                            title="Delete deck"
                            aria-label={`Delete ${deck.title}`}
                            className="sd-btn px-2 py-1.5 text-xs text-[var(--bad)] whitespace-nowrap"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {confirmDeleteDeckId === deck.id && <span>Confirm</span>}
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--mute)]">
                        {deck.sections.map((s) => (
                          <span key={s.name} className="font-mono-num">
                            {s.name} ({s.count})
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: HOST GAME */}
        {subTab === 'host' && (
          <form onSubmit={(e) => void handleCreateRoom(e)} className="sd-card space-y-5 p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Host a Multiplayer Live Quiz
                </h2>
                <p className="mt-0.5 text-xs text-[var(--mute)]">
                  Select from your current StudyWeb flashcards or pick a saved quiz deck, set your
                  round timer, and play alongside friends.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="sd-seg">
                  <button
                    type="button"
                    aria-pressed={hostSource === 'current'}
                    onClick={() => setHostSource('current')}
                    className="sd-seg-btn"
                  >
                    <Layers className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>My Flashcards ({validSnapshotCards.length})</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={hostSource === 'saved'}
                    onClick={() => setHostSource('saved')}
                    className="sd-seg-btn"
                  >
                    <Database className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Saved Decks ({decks.length})</span>
                  </button>
                </div>

                {hostSource === 'current' && (
                  <button
                    type="button"
                    onClick={() => onRequestDecks()}
                    title="Sync latest flashcards from StudyWeb"
                    className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Refresh Cards</span>
                  </button>
                )}
              </div>
            </div>

            {/* Game Mode & Question Format Selection */}
            <div className="grid gap-4 rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-4 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-7">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--mute)]">
                  Game Mode
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={gameMode === 'classic'}
                    onClick={() => setGameMode('classic')}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                      gameMode === 'classic'
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--card))] shadow-sm'
                        : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--mute)]'
                    }`}
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--bg)] text-[var(--e3)]">
                      <Gamepad2 className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-display text-sm font-bold text-[var(--ink)]">
                          Classic Live Quiz
                        </span>
                        {gameMode === 'classic' && (
                          <span className="text-[11px] font-bold text-[var(--e3)]">Selected</span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs leading-snug text-[var(--mute)]">
                        Round-by-round speed &amp; streak leaderboard with instant grading.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    aria-pressed={gameMode === 'monster-brawl'}
                    onClick={() => setGameMode('monster-brawl')}
                    className={`relative flex cursor-pointer items-start gap-3 overflow-hidden rounded-xl border p-3.5 text-left transition-all ${
                      gameMode === 'monster-brawl'
                        ? 'border-emerald-500 bg-slate-950 text-slate-100 shadow-sm'
                        : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--mute)]'
                    }`}
                  >
                    <img
                      src={ARENA_MAP_URL}
                      alt=""
                      aria-hidden="true"
                      referrerPolicy="no-referrer"
                      className={`pointer-events-none absolute inset-0 h-full w-full object-cover ${
                        gameMode === 'monster-brawl' ? 'opacity-25' : 'opacity-10'
                      }`}
                    />
                    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-emerald-400/35 bg-slate-900">
                      <img
                        src={MONSTER_ARCHETYPES.slime.imageUrl}
                        alt="Emerald Slime monster preview"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="relative min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`font-display flex items-center gap-1.5 text-sm font-bold ${
                            gameMode === 'monster-brawl' ? 'text-white' : 'text-[var(--ink)]'
                          }`}
                        >
                          <Swords className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                          <span>Monster Brawl</span>
                        </span>
                        <div className="flex h-6 w-6 shrink-0 overflow-hidden rounded-md border border-amber-400/35 bg-slate-900">
                          <img
                            src={MONSTER_ARCHETYPES.drake.imageUrl}
                            alt="Magma Drake monster preview"
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        </div>
                      </div>
                      <p
                        className={`mt-0.5 text-xs leading-snug ${
                          gameMode === 'monster-brawl' ? 'text-slate-300' : 'text-[var(--mute)]'
                        }`}
                      >
                        2D survival arena with waves, bosses, XP upgrades &amp; quiz power-ups.
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              <div className="space-y-2 lg:col-span-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-[var(--mute)]">
                  Question Format
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  <button
                    type="button"
                    aria-pressed={questionFormat === 'mcq'}
                    onClick={() => setQuestionFormat('mcq')}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                      questionFormat === 'mcq'
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--card))]'
                        : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--mute)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ink)]">
                        <ListChecks className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                        <span>Multiple Choice (4 Options)</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                        Auto-converts flashcards into 4-choice A/B/C/D options or uses imported MCQ choices.
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    aria-pressed={questionFormat === 'typed'}
                    onClick={() => setQuestionFormat('typed')}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                      questionFormat === 'typed'
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--card))]'
                        : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--mute)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ink)]">
                        <Sparkles className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                        <span>Typed Recall (AI Graded)</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[var(--mute)]">
                        Players type free-text answers checked by Smart + Gemini grading.
                      </div>
                    </div>
                  </button>
                </div>
                {gameMode === 'monster-brawl' && (
                  <p className="text-[11px] text-[var(--mute)]">
                    In Monster Brawl, players fight side-by-side on a shared arena map and difficulty
                    scales with player count.
                  </p>
                )}
              </div>

              {gameMode === 'monster-brawl' && (
                <div className="space-y-2 border-t border-[var(--line)] pt-3 lg:col-span-12">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-[var(--mute)]">
                      Monster Brawl Difficulty (Co-op Scaled by Players)
                    </span>
                    <span className="text-[11px] text-[var(--mute)]">
                      More players = stronger monsters &amp; larger waves
                    </span>
                  </div>
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    {BRAWL_DIFFICULTY_ORDER.map((diffId) => {
                      const prof = BRAWL_DIFFICULTIES[diffId];
                      const active = brawlDifficulty === diffId;
                      return (
                        <button
                          key={diffId}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setBrawlDifficulty(diffId)}
                          className={`flex cursor-pointer flex-col justify-between rounded-xl border p-3 text-left transition-all ${
                            active
                              ? 'border-[var(--ink)] bg-[var(--card)] shadow-sm'
                              : 'border-[var(--line)] bg-[var(--card)]/70 hover:border-[var(--mute)]'
                          }`}
                          style={
                            active
                              ? {
                                  borderColor: prof.badgeColor,
                                  boxShadow: `0 0 0 1px ${prof.badgeColor}40`,
                                }
                              : undefined
                          }
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="font-display text-sm font-extrabold"
                                style={{ color: prof.badgeColor }}
                              >
                                {prof.label}
                              </span>
                              <span className="font-mono-num text-[10px] font-bold uppercase text-[var(--mute)]">
                                {prof.shortTag}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] leading-snug text-[var(--mute)]">
                              {prof.description}
                            </p>
                          </div>
                          <div className="font-mono-num mt-2 text-[10px] font-semibold text-[var(--ink)]">
                            {prof.hpMult}x HP · {prof.damageMult}x DMG · Boss q{prof.bossWaveInterval}W
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {hostSource === 'current' ? (
              validSnapshotCards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-6 text-center text-sm text-[var(--mute)]">
                  You don&apos;t have any current flashcards in StudyWeb yet. Add cards in
                  Flashcards, copy from Community, use Universal Import, or import a CSV deck.
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => onRequestDecks()}
                      className="sd-btn px-3.5 py-2 text-xs"
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Check Again</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubTab('decks')}
                      className="sd-btn-pri px-4 py-2 text-xs"
                    >
                      Go to Decks &amp; CSV Import
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Lobby Title (Optional)
                      <input
                        type="text"
                        maxLength={60}
                        value={currentQuizTitle}
                        onChange={(e) => setCurrentQuizTitle(e.target.value)}
                        placeholder={derivedCurrentQuizTitle}
                        className="sd-input mt-1 text-sm"
                      />
                    </label>

                    <label className="block text-xs font-semibold text-[var(--mute)]">
                      Your Host Nickname *
                      <input
                        type="text"
                        maxLength={24}
                        value={hostNickname}
                        onChange={(e) => setHostNickname(e.target.value)}
                        placeholder="Enter nickname"
                        className="sd-input mt-1 text-sm"
                      />
                    </label>

                    <div>
                      <div className="text-xs font-semibold text-[var(--mute)]">Round Timer</div>
                      <div className="mt-1 grid grid-cols-3 gap-2">
                        {([15, 20, 30] as const).map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => setTimerSeconds(sec)}
                            className={`font-mono-num cursor-pointer rounded-lg border py-2 text-sm font-bold transition-colors ${
                              timerSeconds === sec
                                ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]'
                                : 'border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] hover:border-[var(--mute)]'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Card Filter & Section Selection Controls */}
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(
                          [
                            { id: 'all', label: `All cards (${snapshotFilterCounts.all})` },
                            { id: 'due', label: `Due (${snapshotFilterCounts.due})` },
                            { id: 'flagged', label: `Flagged (${snapshotFilterCounts.flagged})` },
                            { id: 'weak', label: `Box 1–2 (${snapshotFilterCounts.weak})` },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFlashcardFilter(opt.id)}
                            className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                              flashcardFilter === opt.id
                                ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))] text-[var(--e3)]'
                                : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                        <span className="font-mono-num text-[var(--mute)]">
                          <strong className="text-[var(--ink)]">{selectedCurrentCards.length}</strong>{' '}
                          questions selected
                        </span>
                        {allQuizFolderKeys.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setExpandedQuizFolders(new Set(allQuizFolderKeys))}
                              className="cursor-pointer text-[var(--mute)] hover:text-[var(--ink)] hover:underline"
                            >
                              Expand all
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedQuizFolders(new Set())}
                              className="cursor-pointer text-[var(--mute)] hover:text-[var(--ink)] hover:underline"
                            >
                              Collapse all
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedCurrentSecIds(allSnapshotSecIds)}
                          className="cursor-pointer text-[var(--e3)] hover:underline"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedCurrentSecIds([])}
                          className="cursor-pointer text-[var(--mute)] hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      {snapshotSubjectGroups.map((subj) => {
                        const subjSecIds = subj.sections.map((s) => s.secId);
                        const allSubjSelected = subjSecIds.every((id) =>
                          selectedCurrentSecIds.includes(id)
                        );
                        const subjFolders = deckGroupsBySubject.get(subj.subjId) || [];
                        const folderedNames = new Set(subjFolders.flatMap((f) => f.sectionNames));
                        const unfolderedSections = subj.sections.filter(
                          (s) => !folderedNames.has(s.secName)
                        );

                        const renderHostSecCard = (sec: SnapshotSectionGroup) => {
                          const checked = selectedCurrentSecIds.includes(sec.secId);
                          const matchingCount = sec.cards.filter(cardMatchesFilter).length;
                          return (
                            <label
                              key={sec.secId}
                              className={`flex cursor-pointer items-center justify-between gap-2 rounded-xl border p-3 text-xs transition-colors ${
                                checked
                                  ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_9%,var(--card))]'
                                  : 'border-[var(--line)] bg-[var(--card)]'
                              }`}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() =>
                                    setSelectedCurrentSecIds((prev) =>
                                      checked
                                        ? prev.filter((id) => id !== sec.secId)
                                        : [...prev, sec.secId]
                                    )
                                  }
                                />
                                <span className="min-w-0">
                                  <span className="block truncate font-semibold text-[var(--ink)]">
                                    {sec.secName}
                                  </span>
                                  {sec.topicName && sec.topicName !== sec.secName && (
                                    <span className="block truncate text-[11px] text-[var(--mute)]">
                                      {sec.topicName}
                                    </span>
                                  )}
                                </span>
                              </span>
                              <span
                                className={`font-mono-num shrink-0 ${
                                  matchingCount === 0 ? 'text-[var(--bad)]' : 'text-[var(--mute)]'
                                }`}
                              >
                                {matchingCount}
                                {flashcardFilter !== 'all' ? `/${sec.cards.length}` : ''} cards
                              </span>
                            </label>
                          );
                        };

                        return (
                          <div
                            key={subj.subjId}
                            className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5"
                          >
                            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-display text-sm font-bold text-[var(--ink)]">
                                  {subj.subjName}
                                </span>
                                <span className="font-mono-num text-xs text-[var(--mute)]">
                                  ({subj.sections.length} section
                                  {subj.sections.length === 1 ? '' : 's'} · {subj.totalCards} cards)
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedCurrentSecIds((prev) =>
                                    allSubjSelected
                                      ? prev.filter((id) => !subjSecIds.includes(id))
                                      : Array.from(new Set([...prev, ...subjSecIds]))
                                  )
                                }
                                className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline"
                              >
                                {allSubjSelected ? 'Uncheck subject' : 'Select subject'}
                              </button>
                            </div>

                            <div className="space-y-2">
                              {subjFolders.map((folder) => {
                                const folderSections = subj.sections.filter((s) =>
                                  folder.sectionNames.includes(s.secName)
                                );
                                if (folderSections.length === 0) return null;
                                const folderSecIds = folderSections.map((s) => s.secId);
                                const selectedCount = folderSecIds.filter((id) =>
                                  selectedCurrentSecIds.includes(id)
                                ).length;
                                const allFolderSelected =
                                  folderSecIds.length > 0 && selectedCount === folderSecIds.length;
                                const totalMatching = folderSections.reduce(
                                  (sum, s) => sum + s.cards.filter(cardMatchesFilter).length,
                                  0
                                );
                                const totalInFolder = folderSections.reduce(
                                  (sum, s) => sum + s.cards.length,
                                  0
                                );
                                const folderKey = `folder:${folder.id}`;
                                const isOpen = expandedQuizFolders.has(folderKey);

                                return (
                                  <div
                                    key={folder.id}
                                    className="rounded-xl border border-[var(--line)] bg-[var(--card)]"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                                      <button
                                        type="button"
                                        onClick={() => toggleQuizFolder(folderKey)}
                                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                                      >
                                        {isOpen ? (
                                          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--mute)]" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--mute)]" />
                                        )}
                                        {isOpen ? (
                                          <FolderOpen className="h-4 w-4 shrink-0 text-[var(--e3)]" />
                                        ) : (
                                          <Folder className="h-4 w-4 shrink-0 text-[var(--e3)]" />
                                        )}
                                        <span className="truncate text-xs font-bold text-[var(--ink)]">
                                          {folder.name}
                                        </span>
                                        <span className="font-mono-num shrink-0 text-[11px] text-[var(--mute)]">
                                          {folderSections.length} deck
                                          {folderSections.length === 1 ? '' : 's'} · {totalMatching}
                                          {flashcardFilter !== 'all' ? `/${totalInFolder}` : ''} cards
                                        </span>
                                      </button>

                                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1 text-xs font-semibold text-[var(--e3)]">
                                        <input
                                          type="checkbox"
                                          checked={allFolderSelected}
                                          onChange={() =>
                                            setSelectedCurrentSecIds((prev) =>
                                              allFolderSelected
                                                ? prev.filter((id) => !folderSecIds.includes(id))
                                                : Array.from(new Set([...prev, ...folderSecIds]))
                                            )
                                          }
                                        />
                                        <span>
                                          {allFolderSelected
                                            ? 'Folder Selected'
                                            : selectedCount > 0
                                              ? `${selectedCount}/${folderSecIds.length} Decks`
                                              : 'Select Folder'}
                                        </span>
                                      </label>
                                    </div>

                                    {isOpen && (
                                      <div className="grid gap-2 border-t border-[var(--line)] bg-[var(--bg)] p-2.5 sm:grid-cols-2 lg:grid-cols-3">
                                        {folderSections.map(renderHostSecCard)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              {unfolderedSections.length > 0 &&
                                (subjFolders.length > 0 ? (
                                  (() => {
                                    const otherKey = `other:${subj.subjId}`;
                                    const isOpen = expandedQuizFolders.has(otherKey);
                                    const otherIds = unfolderedSections.map((s) => s.secId);
                                    const selectedCount = otherIds.filter((id) =>
                                      selectedCurrentSecIds.includes(id)
                                    ).length;
                                    const allOtherSelected =
                                      otherIds.length > 0 && selectedCount === otherIds.length;
                                    const totalMatching = unfolderedSections.reduce(
                                      (sum, s) => sum + s.cards.filter(cardMatchesFilter).length,
                                      0
                                    );
                                    const totalInOther = unfolderedSections.reduce(
                                      (sum, s) => sum + s.cards.length,
                                      0
                                    );

                                    return (
                                      <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--card)]">
                                        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                                          <button
                                            type="button"
                                            onClick={() => toggleQuizFolder(otherKey)}
                                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                                          >
                                            {isOpen ? (
                                              <ChevronDown className="h-4 w-4 shrink-0 text-[var(--mute)]" />
                                            ) : (
                                              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--mute)]" />
                                            )}
                                            <Layers className="h-4 w-4 shrink-0 text-[var(--mute)]" />
                                            <span className="truncate text-xs font-bold text-[var(--ink)]">
                                              Other Decks
                                            </span>
                                            <span className="font-mono-num shrink-0 text-[11px] text-[var(--mute)]">
                                              {unfolderedSections.length} deck
                                              {unfolderedSections.length === 1 ? '' : 's'} ·{' '}
                                              {totalMatching}
                                              {flashcardFilter !== 'all'
                                                ? `/${totalInOther}`
                                                : ''}{' '}
                                              cards
                                            </span>
                                          </button>

                                          <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1 text-xs font-semibold text-[var(--e3)]">
                                            <input
                                              type="checkbox"
                                              checked={allOtherSelected}
                                              onChange={() =>
                                                setSelectedCurrentSecIds((prev) =>
                                                  allOtherSelected
                                                    ? prev.filter((id) => !otherIds.includes(id))
                                                    : Array.from(new Set([...prev, ...otherIds]))
                                                )
                                              }
                                            />
                                            <span>
                                              {allOtherSelected
                                                ? 'All Selected'
                                                : selectedCount > 0
                                                  ? `${selectedCount}/${otherIds.length} Decks`
                                                  : 'Select All'}
                                            </span>
                                          </label>
                                        </div>

                                        {isOpen && (
                                          <div className="grid gap-2 border-t border-[var(--line)] bg-[var(--bg)] p-2.5 sm:grid-cols-2 lg:grid-cols-3">
                                            {unfolderedSections.map(renderHostSecCard)}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()
                                ) : (
                                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {unfolderedSections.map(renderHostSecCard)}
                                  </div>
                                ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--mute)]">
                      <input
                        type="checkbox"
                        checked={saveCurrentToDb}
                        onChange={(e) => setSaveCurrentToDb(e.target.checked)}
                      />
                      <span>Also save selected cards permanently to Saved Decks</span>
                    </label>
                    <button
                      type="submit"
                      disabled={selectedCurrentCards.length === 0}
                      className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap"
                    >
                      Create Lobby ({selectedCurrentCards.length} Qs)
                    </button>
                  </div>
                </>
              )
            ) : decks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-6 text-center text-sm text-[var(--mute)]">
                You don&apos;t have any saved quiz decks yet. Switch to{' '}
                <strong>My Flashcards</strong> above to play directly, or import a CSV deck.
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {validSnapshotCards.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHostSource('current')}
                      className="sd-btn-pri px-4 py-2 text-xs"
                    >
                      Use My Current Flashcards ({validSnapshotCards.length})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSubTab('decks')}
                    className="sd-btn px-4 py-2 text-xs"
                  >
                    Go to Decks &amp; CSV Import
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    Saved Deck
                    <select
                      value={selectedDeckId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setSelectedDeckId(nextId);
                        const found = decks.find((d) => d.id === nextId);
                        setSelectedSections(found ? found.sections.map((s) => s.name) : []);
                      }}
                      className="sd-input mt-1 text-sm"
                    >
                      {decks.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.title} ({d.cardCount} cards)
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-semibold text-[var(--mute)]">
                    Your Host Nickname *
                    <input
                      type="text"
                      maxLength={24}
                      value={hostNickname}
                      onChange={(e) => setHostNickname(e.target.value)}
                      placeholder="Enter nickname"
                      className="sd-input mt-1 text-sm"
                    />
                  </label>

                  <div>
                    <div className="text-xs font-semibold text-[var(--mute)]">Round Timer</div>
                    <div className="mt-1 grid grid-cols-3 gap-2">
                      {([15, 20, 30] as const).map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setTimerSeconds(sec)}
                          className={`font-mono-num cursor-pointer rounded-lg border py-2 text-sm font-bold transition-colors ${
                            timerSeconds === sec
                              ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]'
                              : 'border-[var(--line)] bg-[var(--bg)] text-[var(--ink)] hover:border-[var(--mute)]'
                          }`}
                        >
                          {sec}s
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {selectedDeck && (
                  <div>
                    <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--mute)]">
                      <span>
                        Sections to Play ({selectedSections.length}/{selectedDeck.sections.length} ·{' '}
                        {selectedSectionCardCount} questions)
                      </span>
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedSections(selectedDeck.sections.map((s) => s.name))
                          }
                          className="cursor-pointer text-[var(--e3)] hover:underline"
                        >
                          Select all
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedSections([])}
                          className="cursor-pointer text-[var(--mute)] hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {selectedDeck.sections.map((sec) => {
                        const checked = selectedSections.includes(sec.name);
                        return (
                          <label
                            key={sec.name}
                            className={`flex cursor-pointer items-center justify-between rounded-xl border p-3 text-xs transition-colors ${
                              checked
                                ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_8%,var(--bg))]'
                                : 'border-[var(--line)] bg-[var(--bg)]'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setSelectedSections((prev) =>
                                    checked
                                      ? prev.filter((x) => x !== sec.name)
                                      : [...prev, sec.name]
                                  )
                                }
                              />
                              <span className="truncate font-semibold text-[var(--ink)]">
                                {sec.name}
                              </span>
                            </span>
                            <span className="font-mono-num shrink-0 text-[var(--mute)]">
                              {sec.count} cards
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
                  <div className="flex items-center gap-2 text-xs text-[var(--mute)]">
                    <Sparkles className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                    <span>
                      Smart local + Gemini Flash-Lite semantic grading runs live on submit only during
                      matches.
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap"
                  >
                    Create Lobby &amp; Get 4-Letter Code
                  </button>
                </div>
              </>
            )}
          </form>
        )}

        {/* TAB 3: JOIN BY CODE */}
        {subTab === 'join' && (
          <form
            onSubmit={(e) => void handleJoinRoom(e)}
            className="sd-card mx-auto max-w-lg space-y-4 p-6"
          >
            <div>
              <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                Join a Friend&apos;s Live Quiz
              </h2>
              <p className="mt-0.5 text-xs text-[var(--mute)]">
                Enter the 4-letter room code shown on the Host&apos;s screen and pick your nickname.
              </p>
            </div>

            <label className="block text-xs font-semibold text-[var(--mute)]">
              4-Letter Room Code *
              <input
                type="text"
                maxLength={4}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
                placeholder="ABCD"
                className="sd-input font-mono-num mt-1 py-3 text-center text-2xl font-extrabold tracking-[0.3em] uppercase"
              />
            </label>

            <label className="block text-xs font-semibold text-[var(--mute)]">
              Your Nickname *
              <input
                type="text"
                maxLength={24}
                value={joinNickname}
                onChange={(e) => setJoinNickname(e.target.value)}
                placeholder="e.g. Alex"
                className="sd-input mt-1 text-sm"
              />
            </label>

            <button type="submit" className="sd-btn-pri w-full py-2.5 text-sm">
              Join Room Lobby
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
