import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  CheckCircle2,
  Clock,
  Copy,
  Database,
  FileSpreadsheet,
  Gamepad2,
  Layers,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  SkipForward,
  Sparkles,
  Trash2,
  Trophy,
  Upload,
  Users,
  Volume2,
  VolumeX,
  XCircle,
  Zap,
} from 'lucide-react';
import {
  CloudPlayerDoc,
  CloudQuizCard,
  CloudQuizDeck,
  createCloudRoom,
  deleteCloudDeck,
  gradeAnswerViaVercelOrLocal,
  hostApplyPlayerGrade,
  hostRestartCloudRoom,
  hostRevealCloudRound,
  hostStartCloudQuestion,
  joinCloudRoom,
  leaveCloudRoom,
  loadCloudDecks,
  saveCloudDeck,
  submitCloudAnswer,
  subscribeCloudRoom,
} from '../lib/liveQuizCloud';
import { DeckFlashcard, DeckSnapshot, QuizDeckSummary, QuizRoomState } from '../types';

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

function parseCsvPreview(csvText: string): Array<{ question: string; answer: string; section: string }> {
  const input = String(csvText || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim().length > 0));
  if (!nonEmpty.length) return [];
  const first = nonEmpty[0].map((c) => c.trim().toLowerCase());
  const isHeader =
    (first[0] === 'q' || first[0] === 'question' || first[0] === 'prompt') &&
    (first[1] === 'a' || first[1] === 'answer' || first[1] === 'response');
  const data = isHeader ? nonEmpty.slice(1) : nonEmpty;

  return data
    .map((r) => ({
      question: (r[0] || '').trim(),
      answer: (r[1] || '').trim(),
      section: (r[2] || '').trim() || 'General',
    }))
    .filter((c) => c.question && c.answer);
}

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
  const csvFileRef = useRef<HTMLInputElement | null>(null);

  // Host setup state
  const [hostSource, setHostSource] = useState<HostQuestionSource>('current');
  const [selectedDeckId, setSelectedDeckId] = useState<string>('');
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [selectedCurrentSecIds, setSelectedCurrentSecIds] = useState<string[]>([]);
  const [flashcardFilter, setFlashcardFilter] = useState<FlashcardFilterMode>('all');
  const [currentQuizTitle, setCurrentQuizTitle] = useState('');
  const [saveCurrentToDb, setSaveCurrentToDb] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState<15 | 20 | 30>(20);
  const [hostNickname, setHostNickname] = useState<string>(defaultNickname || 'Host');
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

  const wsRef = useRef<WebSocket | null>(null);
  const clockOffsetRef = useRef<number>(0);
  const lastSoundStatusRef = useRef<string>('');
  const lastRoundIndexRef = useRef<number>(-1);
  const reconnectAttemptedRef = useRef(false);
  const cloudUnsubRef = useRef<(() => void) | null>(null);
  const cloudQuestionsRef = useRef<CloudQuizCard[]>([]);
  const cloudPlayersRef = useRef<CloudPlayerDoc[]>([]);
  const cloudGradingLocksRef = useRef<Set<string>>(new Set());
  const cloudRevealingIndexRef = useRef<number | null>(null);
  const cloudRoundIndexRef = useRef<number>(-1);
  const cloudRoundStatusRef = useRef<string>('lobby');
  const hostActionPendingRef = useRef<boolean>(false);

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
      cloudRevealingIndexRef.current = null;
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
          cloudPlayersRef.current = rawPlayers;
          cloudRoundIndexRef.current = nextRoom.currentIndex;
          cloudRoundStatusRef.current = nextRoom.status;
          clockOffsetRef.current = 0;
          setRoom(nextRoom);

          // Host-authoritative grading on submit & auto-reveal when everyone is done for THIS question
          if (cloudQuestionsRef.current.length > 0 && nextRoom.status === 'question') {
            if (
              cloudRevealingIndexRef.current !== null &&
              cloudRevealingIndexRef.current !== nextRoom.currentIndex
            ) {
              cloudRevealingIndexRef.current = null;
            }
            const qIdx = nextRoom.currentIndex;
            const card = cloudQuestionsRef.current[qIdx];
            if (card) {
              for (const p of rawPlayers) {
                if (
                  p.hasSubmitted &&
                  p.gradingStatus === 'grading' &&
                  p.pendingQuestionIndex === qIdx
                ) {
                  const lockKey = `${qIdx}:${p.id}`;
                  if (!cloudGradingLocksRef.current.has(lockKey)) {
                    cloudGradingLocksRef.current.add(lockKey);
                    void (async () => {
                      const outcome = await gradeAnswerViaVercelOrLocal(
                        card.question,
                        card.answer,
                        p.pendingAnswer || ''
                      );
                      if (cloudRoundIndexRef.current !== qIdx) {
                        return;
                      }
                      await hostApplyPlayerGrade({
                        code: nextRoom.code,
                        player: p,
                        questionIndex: qIdx,
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
              connected.every(
                (p) =>
                  p.hasSubmitted &&
                  p.gradingStatus === 'done' &&
                  p.pendingQuestionIndex === qIdx
              );
            if (allDone && cloudRevealingIndexRef.current !== qIdx) {
              cloudRevealingIndexRef.current = qIdx;
              void hostRevealCloudRound({
                code: nextRoom.code,
                questions: cloudQuestionsRef.current,
                currentIndex: qIdx,
                players: rawPlayers,
              });
            }
          } else if (nextRoom.status !== 'question') {
            cloudRevealingIndexRef.current = null;
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
          };

          if (msg.type === 'quiz:error') {
            setErrorMsg(msg.message || 'Quiz error occurred.');
            return;
          }

          if (msg.type === 'quiz:joined' && msg.room && msg.playerId) {
            clockOffsetRef.current = msg.room.serverNow - Date.now();
            setPlayerId(msg.playerId);
            setRoom(msg.room);
            setErrorMsg(null);
            setInfoMsg(null);
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

  // Clear answer input when advancing to a new question + trigger audio cue on reveal/finish
  useEffect(() => {
    if (!room) {
      lastRoundIndexRef.current = -1;
      lastSoundStatusRef.current = '';
      return;
    }

    if (room.currentIndex !== lastRoundIndexRef.current) {
      lastRoundIndexRef.current = room.currentIndex;
      setAnswerInput('');
    }

    const stateKey = `${room.status}:${room.currentIndex}`;
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

  // Smooth server-synced countdown timer
  useEffect(() => {
    if (!room || room.status !== 'question' || !room.questionEndsAt) {
      setTimeLeftMs(0);
      return;
    }
    const update = () => {
      const estimatedServerNow = Date.now() + clockOffsetRef.current;
      setTimeLeftMs(Math.max(0, (room.questionEndsAt || 0) - estimatedServerNow));
    };
    update();
    const id = window.setInterval(update, 100);
    return () => window.clearInterval(id);
  }, [room]);

  // Host countdown auto-reveal timer when running in Cloud Mode
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
    const msRemaining = Math.max(0, room.questionEndsAt - Date.now());
    let innerTimer: number | null = null;

    const timer = window.setTimeout(() => {
      if (
        cloudRevealingIndexRef.current === qIdx ||
        cloudRoundIndexRef.current !== qIdx ||
        cloudRoundStatusRef.current !== 'question'
      ) {
        return;
      }
      cloudRevealingIndexRef.current = qIdx;
      const hasPendingGrades = cloudPlayersRef.current.some(
        (p) =>
          p.hasSubmitted &&
          p.pendingQuestionIndex === qIdx &&
          p.gradingStatus === 'grading'
      );
      innerTimer = window.setTimeout(
        () => {
          if (
            cloudRoundIndexRef.current !== qIdx ||
            cloudRoundStatusRef.current !== 'question'
          ) {
            return;
          }
          void hostRevealCloudRound({
            code: roomCode,
            questions: cloudQuestionsRef.current,
            currentIndex: qIdx,
            players: cloudPlayersRef.current,
          });
        },
        hasPendingGrades ? 1400 : 0
      );
    }, msRemaining);

    return () => {
      window.clearTimeout(timer);
      if (innerTimer !== null) {
        window.clearTimeout(innerTimer);
      }
    };
  }, [
    backendMode,
    room?.code,
    room?.status,
    room?.currentIndex,
    room?.questionEndsAt,
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
    async (action: 'start' | 'reveal' | 'next' | 'restart') => {
      if (backendMode === 'server') {
        await sendWs({ type: `quiz:${action}` });
        return;
      }
      if (!room || hostActionPendingRef.current) return;
      hostActionPendingRef.current = true;
      setErrorMsg(null);
      try {
        if (action === 'start') {
          cloudRevealingIndexRef.current = null;
          await hostStartCloudQuestion({
            code: room.code,
            questions: cloudQuestionsRef.current,
            index: 0,
            timerSeconds: room.timerSeconds,
            players: cloudPlayersRef.current,
          });
        } else if (action === 'reveal') {
          cloudRevealingIndexRef.current = room.currentIndex;
          await hostRevealCloudRound({
            code: room.code,
            questions: cloudQuestionsRef.current,
            currentIndex: room.currentIndex,
            players: cloudPlayersRef.current,
          });
        } else if (action === 'next') {
          if (room.status === 'question') {
            cloudRevealingIndexRef.current = room.currentIndex;
            await hostRevealCloudRound({
              code: room.code,
              questions: cloudQuestionsRef.current,
              currentIndex: room.currentIndex,
              players: cloudPlayersRef.current,
            });
          } else if (room.status === 'reveal') {
            cloudRevealingIndexRef.current = null;
            await hostStartCloudQuestion({
              code: room.code,
              questions: cloudQuestionsRef.current,
              index: room.currentIndex + 1,
              timerSeconds: room.timerSeconds,
              players: cloudPlayersRef.current,
            });
          }
        } else if (action === 'restart') {
          cloudRevealingIndexRef.current = null;
          const reshuffled = await hostRestartCloudRoom({
            code: room.code,
            questions: cloudQuestionsRef.current,
            players: cloudPlayersRef.current,
          });
          cloudQuestionsRef.current = reshuffled;
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to update Cloud quiz room.');
      } finally {
        hostActionPendingRef.current = false;
      }
    },
    [backendMode, room, sendWs]
  );

  // Parsed CSV live preview
  const csvPreviewCards = useMemo(() => parseCsvPreview(csvText), [csvText]);
  const csvPreviewSections = useMemo(() => {
    const map = new Map<string, number>();
    csvPreviewCards.forEach((c) => {
      map.set(c.section, (map.get(c.section) || 0) + 1);
    });
    return Array.from(map.entries()).map(([name, count]) => ({ name, count }));
  }, [csvPreviewCards]);

  // Current StudyDeck flashcards grouped by Subject -> Section
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
    if (activeSubjects.length === 1) return `StudyDeck · ${activeSubjects[0]}`;
    if (activeSubjects.length === 2) return `StudyDeck · ${activeSubjects.join(' & ')}`;
    if (activeSubjects.length > 2) return `StudyDeck · ${activeSubjects.length} Subjects`;
    return 'StudyDeck Flashcards';
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
    payload: { csvText?: string; cards?: Array<{ question: string; answer: string; section: string }> }
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

    const cards = payload.csvText
      ? parseCsvPreview(payload.csvText)
      : (payload.cards || []);
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
      setErrorMsg('Paste CSV rows or upload a .csv file in format: Question, Answer, Section.');
      return;
    }

    setSavingDeck(true);
    try {
      const deck = await persistQuizDeck(title, { csvText });
      await fetchDecks();
      setSelectedDeckId(deck.id);
      setSelectedSections(deck.sections.map((s) => s.name));
      setHostSource('saved');
      setImportTitle('');
      setCsvText('');
      setInfoMsg(
        `Saved "${deck.title}" permanently (${deck.cardCount} cards across ${deck.sections.length} section${
          deck.sections.length === 1 ? '' : 's'
        }). Ready to host!`
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
      setErrorMsg('Select at least one StudyDeck flashcard section to import.');
      return;
    }
    setSavingDeck(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const uniqueSubjects = Array.from(new Set(sourceCards.map((c) => c.subjName).filter(Boolean)));
      const subjectLabel = uniqueSubjects.slice(0, 2).join(' & ') || 'My Flashcards';
      const title = (customTitle || '').trim() || `StudyDeck · ${subjectLabel}`;
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
        `Saved ${deck.cardCount} StudyDeck flashcards into "${deck.title}".`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to import StudyDeck cards.');
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
        ws.send(
          JSON.stringify(
            inlineCards
              ? {
                  type: 'quiz:create',
                  inlineDeckTitle: deckTitleToUse,
                  inlineCards,
                  timerSeconds,
                  nickname: hostNickname.trim(),
                }
              : {
                  type: 'quiz:create',
                  deckId: deckIdToUse,
                  selectedSections: sectionsToUse,
                  timerSeconds,
                  nickname: hostNickname.trim(),
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
      let cardsForCloud: Array<{ question: string; answer: string; section: string }> =
        inlineCards || [];
      if (!inlineCards && selectedDeck) {
        const cloudDecks = await loadCloudDecks();
        const found = cloudDecks.find((d) => d.id === selectedDeck.id) as CloudQuizDeck | undefined;
        const secSet = new Set(sectionsToUse);
        cardsForCloud = (found?.cards || [])
          .filter((c) => secSet.size === 0 || secSet.has(c.section))
          .map((c) => ({ question: c.question, answer: c.answer, section: c.section }));
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

  const handleSubmitAnswer = async (e: FormEvent) => {
    e.preventDefault();
    if (!room || room.status !== 'question') return;
    const currentMe = playerId ? room.players.find((p) => p.id === playerId) : null;
    if (currentMe?.hasSubmitted) return;
    playQuizTone('submit', muted);
    if (backendMode === 'server') {
      await sendWs({
        type: 'quiz:submit',
        answer: answerInput,
      });
      return;
    }
    if (!playerId) return;
    try {
      await submitCloudAnswer({
        code: room.code,
        playerId,
        questionIndex: room.currentIndex,
        questionStartedAt: room.questionStartedAt,
        answer: answerInput,
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit answer.');
    }
  };

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

  // ============================================================================
  // ACTIVE MULTIPLAYER ARENA VIEW (Lobby / Question / Reveal / Podium)
  // ============================================================================
  if (room) {
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
                  onClick={() => void sendHostAction('start')}
                  className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Start Game ({room.totalQuestions} Qs)</span>
                </button>
              )}
              {isHost && room.status === 'question' && (
                <button
                  type="button"
                  onClick={() => void sendHostAction('reveal')}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  <Zap className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                  <span>Reveal Now</span>
                </button>
              )}
              {isHost && room.status === 'reveal' && (
                <button
                  type="button"
                  onClick={() => void sendHostAction('next')}
                  className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
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
                  onClick={() => void sendHostAction('restart')}
                  className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
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

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-[var(--mute)]">Questions</div>
                    <div className="font-mono-num mt-0.5 text-lg font-bold text-[var(--ink)]">
                      {room.totalQuestions}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-[var(--mute)]">Round Timer</div>
                    <div className="font-mono-num mt-0.5 text-lg font-bold text-[var(--ink)]">
                      {room.timerSeconds}s
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="text-[var(--mute)]">Sections</div>
                    <div className="font-mono-num mt-0.5 text-lg font-bold text-[var(--ink)]">
                      {room.selectedSections.length}
                    </div>
                  </div>
                </div>

                <div className="text-xs text-[var(--mute)]">
                  <strong className="text-[var(--ink)]">Included Sections:</strong>{' '}
                  {room.selectedSections.join(' · ')}
                </div>

                {isHost ? (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => void sendHostAction('start')}
                      className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap"
                    >
                      <Play className="h-4 w-4" aria-hidden="true" />
                      <span>Start Live Quiz Now</span>
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs font-medium text-[var(--mute)]">
                    Waiting for the Host to start the match…
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

                {/* Player / Host Answer Form */}
                {!me?.hasSubmitted ? (
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
                        immediately by Gemini Flash-Lite.
                      </span>
                      <button
                        type="submit"
                        className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap"
                      >
                        Submit Answer
                      </button>
                    </div>
                  </form>
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
                      onClick={() => void sendHostAction('next')}
                      className="sd-btn-pri px-4 py-1.5 text-xs whitespace-nowrap"
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
                          {p.correctCount}/{room.totalQuestions} correct · Best streak {p.bestStreak}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  {isHost && (
                    <button
                      type="button"
                      onClick={() => void sendHostAction('restart')}
                      className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap"
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
                      className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--bg)] px-4 py-2.5 text-xs"
                    >
                      <div className="flex items-center gap-3">
                        <span className="font-mono-num font-bold text-[var(--mute)]">
                          #{idx + 1}
                        </span>
                        <span className="font-bold text-[var(--ink)]">{p.nickname}</span>
                      </div>
                      <div className="font-mono-num flex items-center gap-4 text-[var(--mute)]">
                        <span>
                          {p.correctCount}/{room.totalQuestions} correct
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
              <span>Multiplayer Flashcard Arena · Gemini 2.5 Flash-Lite Grading</span>
            </div>
            <h1 className="font-display mt-1 text-2xl font-extrabold tracking-tight text-[var(--ink)]">
              Live Quiz
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--mute)]">
              Play directly from your current StudyDeck flashcards or import CSV decks into the
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
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                      Import &amp; Auto-Sections (CSV)
                    </h2>
                    <p className="mt-0.5 text-xs text-[var(--mute)]">
                      Format: <code>Question, Answer, Section</code> (handles commas in quotes; blank
                      section defaults to &ldquo;General&rdquo;).
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={csvFileRef}
                      type="file"
                      accept=".csv,text/csv,text/plain"
                      className="hidden"
                      onChange={(e) => void handleCsvFileUpload(e)}
                    />
                    <button
                      type="button"
                      onClick={() => csvFileRef.current?.click()}
                      className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Upload .csv</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!importTitle.trim()) setImportTitle('Weimar Germany Revision');
                        setCsvText(SAMPLE_CSV);
                      }}
                      className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Load Sample CSV</span>
                    </button>
                  </div>
                </div>

                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Deck Title *
                  <input
                    type="text"
                    value={importTitle}
                    onChange={(e) => setImportTitle(e.target.value)}
                    placeholder="e.g. GCSE History Paper 1"
                    className="sd-input mt-1 text-sm"
                  />
                </label>

                <label className="block text-xs font-semibold text-[var(--mute)]">
                  CSV Content (Question, Answer, Section) *
                  <textarea
                    rows={8}
                    value={csvText}
                    onChange={(e) => setCsvText(e.target.value)}
                    placeholder={
                      'Question,Answer,Section\n"When was the Armistice signed?","11 November 1918",World War I\n"Capital of France?",Paris,'
                    }
                    className="sd-input font-mono-num mt-1 text-xs leading-relaxed"
                  />
                </label>

                {/* Live Section Grouping Preview */}
                {csvPreviewCards.length > 0 && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs">
                    <div className="font-bold text-[var(--ink)]">
                      Parsed Preview: {csvPreviewCards.length} cards across{' '}
                      {csvPreviewSections.length} section
                      {csvPreviewSections.length === 1 ? '' : 's'}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-3 text-[var(--mute)]">
                      {csvPreviewSections.map((s) => (
                        <span key={s.name} className="font-mono-num">
                          <strong className="text-[var(--e3)]">{s.name}</strong> ({s.count})
                        </span>
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

              {/* Selective Import from Current StudyDeck Flashcards */}
              <div className="sd-card space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-display text-base font-bold text-[var(--ink)]">
                      Save Current Flashcards as a Quiz Deck
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--mute)]">
                      Pick specific sections from your active StudyDeck flashcards ({validSnapshotCards.length}{' '}
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
                    No current flashcards found in StudyDeck yet. Add cards in Flashcards or apply
                    a Study Pack first.
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
                      <div className="flex gap-3 font-semibold">
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

                    <div className="max-h-60 space-y-2.5 overflow-y-auto pr-1">
                      {snapshotSubjectGroups.map((subj) => (
                        <div key={subj.subjId} className="space-y-1.5">
                          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                            {subj.subjName}
                          </div>
                          <div className="grid gap-1.5 sm:grid-cols-2">
                            {subj.sections.map((sec) => {
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
                            })}
                          </div>
                        </div>
                      ))}
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
                  Select from your current StudyDeck flashcards or pick a saved quiz deck, set your
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
                    title="Sync latest flashcards from StudyDeck"
                    className="sd-btn px-2.5 py-1.5 text-xs whitespace-nowrap"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Refresh Cards</span>
                  </button>
                )}
              </div>
            </div>

            {hostSource === 'current' ? (
              validSnapshotCards.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-6 text-center text-sm text-[var(--mute)]">
                  You don&apos;t have any current flashcards in StudyDeck yet. Add cards in
                  Flashcards, apply a Study Pack, or import a CSV deck.
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

                      <div className="flex items-center gap-3 text-xs font-semibold">
                        <span className="font-mono-num text-[var(--mute)]">
                          <strong className="text-[var(--ink)]">{selectedCurrentCards.length}</strong>{' '}
                          questions selected
                        </span>
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

                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              {subj.sections.map((sec) => {
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
                                        matchingCount === 0
                                          ? 'text-[var(--bad)]'
                                          : 'text-[var(--mute)]'
                                      }`}
                                    >
                                      {matchingCount}
                                      {flashcardFilter !== 'all' ? `/${sec.cards.length}` : ''} cards
                                    </span>
                                  </label>
                                );
                              })}
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
                      AI semantic grading (Gemini 2.5 Flash-Lite) runs live on submit only during
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
