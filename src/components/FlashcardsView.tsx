import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Edit3,
  Eye,
  Flag,
  Gamepad2,
  Layers,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Share2,
  Shuffle,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { smartSemanticFallbackCheck } from '../lib/quizGrader';
import { applyFlashcardReview, makeId } from '../lib/workspaceStore';
import { StudyFlashcard, WorkspaceData, WorkspaceTab } from '../types';

interface FlashcardsViewProps {
  workspace: WorkspaceData;
  selectedSubjectId: string;
  onSelectSubjectId: (id: string) => void;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onOpenImport: () => void;
  onShareDeck: (subjectId: string, sectionName: string) => void;
  onNavigate: (tab: WorkspaceTab) => void;
}

type ViewScreen = 'setup' | 'play' | 'summary' | 'manage';
type StudyAlgo = 'smart' | 'cram';
type CardCategory = 'date' | 'stat' | 'person' | 'cause' | 'term';

const CARD_CATEGORIES: Array<[CardCategory, string]> = [
  ['date', 'Dates'],
  ['stat', 'Numbers'],
  ['person', 'People'],
  ['cause', 'Causes'],
  ['term', 'Terms & events'],
];

const CAT_LABEL: Record<CardCategory, string> = {
  date: 'Date',
  stat: 'Numbers',
  person: 'People',
  cause: 'Causes',
  term: 'Term',
};

const STOP_WORDS = new Set(
  'the and with from that this were was for have has had been into over about around more than only their they them then also each which what when where while after before under between across during through other such some many most much very just like even still both either'.split(
    ' '
  )
);

function detectCardCategory(card: StudyFlashcard): CardCategory {
  const q = card.q.trim();
  if (
    /^(how (many|much|large|long|far|big|high)|what (percentage|share|proportion)|by how much|by what (percentage|margin)|(roughly|about|approximately) how|how did [a-z ]+ change)/i.test(
      q
    )
  ) {
    return 'stat';
  }
  if (/^(when|on what (date|day)|in what (year|month)|in which (year|month)|what year|by what year|on which date)/i.test(q)) {
    return 'date';
  }
  if (
    /^who\b|^which ([a-z-]+ ){0,3}(leader|president|politician|senator|general|commander|secretary|minister|teacher|chancellor|king|queen)\b/i.test(
      q
    )
  ) {
    return 'person';
  }
  if (
    /\b(why|trigger(ed)?|spark(ed)?|led to|what led|cause[ds]?|aim of|purpose|effect|results?|resulted|condition)\b/i.test(
      q
    )
  ) {
    return 'cause';
  }
  return 'term';
}

function hintOf(text: string): string {
  return text.replace(/[A-Za-z0-9]+/g, (w) => w[0] + '_'.repeat(Math.min(w.length - 1, 6)));
}

interface ClozePart {
  text: string;
  isBlank: boolean;
}

function buildClozeParts(answer: string): ClozePart[] | null {
  const parts = answer.split(/(\s+)/);
  const cand: Array<{ i: number; sc: number; core: string }> = [];
  let words = 0;

  parts.forEach((p, i) => {
    if (!p.trim()) return;
    words += 1;
    const core = p.replace(/^[("'‘“]+|[.,;:)"'’”!?]+$/g, '');
    if (!core) return;
    const lw = core.toLowerCase();
    let sc = 0;
    if (/\d/.test(core)) sc = 10;
    else if (STOP_WORDS.has(lw)) sc = 0;
    else if (/^[A-ZÀ-Ý]/.test(core) && i > 0) sc = 6;
    else if (core.length >= 7) sc = 3 + core.length / 20;
    if (sc > 0) cand.push({ i, sc, core });
  });

  const caps = parts.filter((p) => /^[A-ZÀ-Ý]/.test(p.replace(/^[("'‘“]+/, ''))).length;
  if (words < 4 || cand.length === 0 || caps * 2 >= words) return null;

  const nums = cand.filter((x) => x.sc === 10).length;
  const n = Math.min(3, Math.max(words <= 7 ? 1 : words <= 14 ? 2 : 3, nums));
  const pickedIndices = new Set(
    cand
      .slice()
      .sort((a, b) => b.sc - a.sc || a.i - b.i)
      .slice(0, n)
      .map((x) => x.i)
  );

  return parts.map((p, i) => ({
    text: p,
    isBlank: pickedIndices.has(i),
  }));
}

function shuffleIds(ids: string[]): string[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function nextIntervalLabel(box: number, rating: 1 | 2 | 3 | 4, mode: StudyAlgo): string {
  if (mode === 'cram') {
    return rating === 1 ? 'repeat soon' : 'covered';
  }
  if (rating === 1) return 'repeat soon';
  if (rating === 2) return '12 hours';
  if (rating === 3) {
    const nb = Math.min(5, box + 1);
    const d = [1, 2, 4, 8, 16][nb - 1] || 2;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  const nb = Math.min(5, box + 2);
  const d = [2, 4, 7, 14, 30][nb - 1] || 7;
  return `${d} days`;
}

export function FlashcardsView({
  workspace,
  selectedSubjectId,
  onSelectSubjectId,
  onUpdateWorkspace,
  onOpenImport,
  onShareDeck,
  onNavigate,
}: FlashcardsViewProps) {
  const [screen, setScreen] = useState<ViewScreen>('setup');

  // Setup filters & study options
  const [selectedSections, setSelectedSections] = useState<string[]>([]);
  const [studyAlgo, setStudyAlgo] = useState<StudyAlgo>('smart');
  const [sessionLimit, setSessionLimit] = useState<number>(0); // 0 = All
  const [selectedCategories, setSelectedCategories] = useState<CardCategory[]>([]);
  const [optShuffle, setOptShuffle] = useState<boolean>(true);
  const [optReverse, setOptReverse] = useState<boolean>(false);
  const [optCloze, setOptCloze] = useState<boolean>(false);
  const [optTypeFirst, setOptTypeFirst] = useState<boolean>(false);
  const [optStarredOnly, setOptStarredOnly] = useState<boolean>(false);
  const [optWeakOnly, setOptWeakOnly] = useState<boolean>(false);
  const [optionsOpen, setOptionsOpen] = useState<boolean>(true);

  // Active player state
  const [queue, setQueue] = useState<string[]>([]);
  const [totalInRound, setTotalInRound] = useState<number>(0);
  const [doneCount, setDoneCount] = useState<number>(0);
  const [goodCount, setGoodCount] = useState<number>(0);
  const [easyCount, setEasyCount] = useState<number>(0);
  const [againIds, setAgainIds] = useState<string[]>([]);
  const [flipped, setFlipped] = useState<boolean>(false);
  const [seenAnswer, setSeenAnswer] = useState<boolean>(false);
  const [showHint, setShowHint] = useState<boolean>(false);
  const [typedAnswer, setTypedAnswer] = useState<string>('');
  const [writtenSnapshot, setWrittenSnapshot] = useState<string>('');
  const [typedCorrect, setTypedCorrect] = useState<boolean | null>(null);
  const [animPhase, setAnimPhase] = useState<'in' | 'out-l' | 'out-r' | 'idle'>('in');
  const [busy, setBusy] = useState<boolean>(false);
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const [shuffleToast, setShuffleToast] = useState<boolean>(false);
  const [hasPausedSession, setHasPausedSession] = useState<boolean>(false);

  // Quick edit card modal inside player or manage
  const [editModalCardId, setEditModalCardId] = useState<string | null>(null);
  const [editQ, setEditQ] = useState<string>('');
  const [editA, setEditA] = useState<string>('');

  // Manage / Add form state
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [newSec, setNewSec] = useState('Core Deck');
  const [quickBatchRaw, setQuickBatchRaw] = useState('');
  const [manageSearch, setManageSearch] = useState('');
  const [manageFilter, setManageFilter] = useState<'all' | 'weak' | 'flagged' | 'mastered'>('all');

  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeLockRef = useRef<boolean>(false);

  const cardById = useMemo(
    () => new Map(workspace.flashcards.map((c) => [c.id, c])),
    [workspace.flashcards]
  );

  const subjById = useMemo(
    () => new Map(workspace.subjects.map((s) => [s.id, s])),
    [workspace.subjects]
  );

  const subjectCards = useMemo(() => {
    if (!selectedSubjectId || selectedSubjectId === 'ALL') return workspace.flashcards;
    return workspace.flashcards.filter((c) => c.subjectId === selectedSubjectId);
  }, [workspace.flashcards, selectedSubjectId]);

  const sectionBuckets = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        subjectId: string;
        subjectName: string;
        color: string;
        cards: StudyFlashcard[];
      }
    >();

    for (const c of subjectCards) {
      const s = subjById.get(c.subjectId);
      const secName = (c.sectionName || 'Core Deck').trim() || 'Core Deck';
      const key = `${c.subjectId}:::${secName}`;
      const existing = map.get(key);
      if (existing) {
        existing.cards.push(c);
      } else {
        map.set(key, {
          key,
          name: secName,
          subjectId: c.subjectId,
          subjectName: s?.name || 'General',
          color: s?.color || '#2F5F8A',
          cards: [c],
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [subjectCards, subjById]);

  // Auto-select sections cleanly when subject changes if none match
  useEffect(() => {
    const validKeys = new Set(sectionBuckets.map((b) => b.key));
    setSelectedSections((prev) => {
      const kept = prev.filter((k) => validKeys.has(k));
      if (kept.length > 0) return kept;
      return sectionBuckets.map((b) => b.key);
    });
  }, [sectionBuckets]);

  // Base pool of cards matching selected sections + filters
  const basePool = useMemo(() => {
    const selSet = new Set(selectedSections);
    return subjectCards.filter((c) => {
      const key = `${c.subjectId}:::${(c.sectionName || 'Core Deck').trim() || 'Core Deck'}`;
      if (selSet.size > 0 && !selSet.has(key)) return false;
      if (optStarredOnly && !c.flagged) return false;
      if (optWeakOnly && c.box > 2) return false;
      if (selectedCategories.length > 0 && !selectedCategories.includes(detectCardCategory(c))) {
        return false;
      }
      return true;
    });
  }, [subjectCards, selectedSections, optStarredOnly, optWeakOnly, selectedCategories]);

  const categoryCounts = useMemo(() => {
    const selSet = new Set(selectedSections);
    const counts: Record<CardCategory, number> = {
      date: 0,
      stat: 0,
      person: 0,
      cause: 0,
      term: 0,
    };
    subjectCards.forEach((c) => {
      const key = `${c.subjectId}:::${(c.sectionName || 'Core Deck').trim() || 'Core Deck'}`;
      if (selSet.size > 0 && !selSet.has(key)) return;
      counts[detectCardCategory(c)] += 1;
    });
    return counts;
  }, [subjectCards, selectedSections]);

  const nowMs = Date.now();
  const duePool = useMemo(() => basePool.filter((c) => c.dueAt <= nowMs), [basePool, nowMs]);
  const effectiveReadyPool = studyAlgo === 'smart' ? duePool : basePool;
  const sessionStartCount =
    sessionLimit > 0 ? Math.min(effectiveReadyPool.length, sessionLimit) : effectiveReadyPool.length;

  const currentCard: StudyFlashcard | null =
    queue.length > 0 ? cardById.get(queue[0]) || null : null;

  // Close dropdown menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const resetCardFaceForCurrent = useCallback(() => {
    setFlipped(false);
    setSeenAnswer(false);
    setShowHint(false);
    setTypedAnswer('');
    setWrittenSnapshot('');
    setTypedCorrect(null);
  }, []);

  const launchSession = useCallback(
    (cards: StudyFlashcard[]) => {
      if (cards.length === 0) return;
      let ids = cards.map((c) => c.id);
      if (optShuffle) {
        ids = shuffleIds(ids);
      } else if (studyAlgo === 'smart') {
        const sorted = [...cards].sort((a, b) => a.box - b.box);
        ids = sorted.map((c) => c.id);
      }
      if (sessionLimit > 0) {
        ids = ids.slice(0, sessionLimit);
      }
      setQueue(ids);
      setTotalInRound(ids.length);
      setDoneCount(0);
      setGoodCount(0);
      setEasyCount(0);
      setAgainIds([]);
      setHasPausedSession(false);
      resetCardFaceForCurrent();
      setAnimPhase('in');
      setBusy(false);
      setScreen('play');
    },
    [optShuffle, studyAlgo, sessionLimit, resetCardFaceForCurrent]
  );

  const flipCard = useCallback(() => {
    if (screen !== 'play' || busy || !currentCard) return;
    setFlipped((prevFlipped) => {
      const next = !prevFlipped;
      if (next && !seenAnswer) {
        setSeenAnswer(true);
        const trimmed = typedAnswer.trim();
        setWrittenSnapshot(trimmed);
        if (optTypeFirst && trimmed) {
          const targetAns = optReverse ? currentCard.q : currentCard.a;
          setTypedCorrect(smartSemanticFallbackCheck(trimmed, targetAns));
        } else {
          setTypedCorrect(null);
        }
      }
      return next;
    });
  }, [screen, busy, currentCard, seenAnswer, typedAnswer, optTypeFirst, optReverse]);

  const stepCard = useCallback(
    (dir: 1 | -1) => {
      if (screen !== 'play' || busy || queue.length < 2) return;
      setBusy(true);
      setAnimPhase(dir > 0 ? 'out-l' : 'out-r');
      window.setTimeout(() => {
        setQueue((prev) => {
          if (prev.length < 2) return prev;
          if (dir > 0) return [...prev.slice(1), prev[0]];
          return [prev[prev.length - 1], ...prev.slice(0, prev.length - 1)];
        });
        resetCardFaceForCurrent();
        setAnimPhase('in');
        setBusy(false);
      }, 240);
    },
    [screen, busy, queue.length, resetCardFaceForCurrent]
  );

  const rateCurrentCard = useCallback(
    (rating: 1 | 2 | 3 | 4) => {
      if (screen !== 'play' || !seenAnswer || busy || !currentCard) return;
      setBusy(true);

      const updated = applyFlashcardReview(currentCard, rating);
      onUpdateWorkspace((prev) => ({
        ...prev,
        flashcards: prev.flashcards.map((c) => (c.id === updated.id ? updated : c)),
        updatedAt: new Date().toISOString(),
      }));

      setAnimPhase(rating === 1 ? 'out-l' : 'out-r');

      window.setTimeout(() => {
        setQueue((prevQueue) => {
          const rest = prevQueue.slice(1);
          if (rating === 1) {
            const insertIdx = Math.min(3, rest.length);
            const nextQ = [...rest];
            nextQ.splice(insertIdx, 0, currentCard.id);
            return nextQ;
          }
          if (rest.length === 0) {
            setHasPausedSession(false);
            setScreen('summary');
          }
          return rest;
        });

        if (rating === 1) {
          setAgainIds((prev) => (prev.includes(currentCard.id) ? prev : [...prev, currentCard.id]));
        } else {
          setDoneCount((d) => d + 1);
          if (rating === 4) setEasyCount((e) => e + 1);
          else setGoodCount((g) => g + 1);
        }

        resetCardFaceForCurrent();
        setAnimPhase('in');
        setBusy(false);
      }, 250);
    },
    [screen, seenAnswer, busy, currentCard, onUpdateWorkspace, resetCardFaceForCurrent]
  );

  // Keyboard shortcuts matching original revision.html
  useEffect(() => {
    if (screen !== 'play' || editModalCardId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flipCard();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepCard(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepCard(-1);
      } else if (seenAnswer && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
        e.preventDefault();
        rateCurrentCard(Number(e.key) as 1 | 2 | 3 | 4);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [screen, editModalCardId, flipCard, stepCard, seenAnswer, rateCurrentCard]);

  const handleShuffleDeckInPlayer = (includeCurrent: boolean) => {
    if (queue.length < 2) return;
    setQueue((prev) => {
      if (includeCurrent) {
        return shuffleIds(prev);
      }
      return [prev[0], ...shuffleIds(prev.slice(1))];
    });
    if (includeCurrent) {
      resetCardFaceForCurrent();
      setAnimPhase('in');
    }
    setMenuOpen(false);
    setShuffleToast(true);
    window.setTimeout(() => setShuffleToast(false), 1100);
  };

  const toggleFlagCard = (cardId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      flashcards: prev.flashcards.map((c) =>
        c.id === cardId ? { ...c, flagged: !c.flagged } : c
      ),
      updatedAt: new Date().toISOString(),
    }));
  };

  const saveEditModal = (e: FormEvent) => {
    e.preventDefault();
    if (!editModalCardId || !editQ.trim() || !editA.trim()) return;
    onUpdateWorkspace((prev) => ({
      ...prev,
      flashcards: prev.flashcards.map((c) =>
        c.id === editModalCardId ? { ...c, q: editQ.trim(), a: editA.trim() } : c
      ),
      updatedAt: new Date().toISOString(),
    }));
    setEditModalCardId(null);
  };

  const handleAddSingleCard = (e: FormEvent) => {
    e.preventDefault();
    if (!newQ.trim() || !newA.trim()) return;
    const targetSubjId =
      selectedSubjectId && selectedSubjectId !== 'ALL'
        ? selectedSubjectId
        : workspace.subjects[0]?.id || makeId('subj');

    onUpdateWorkspace((prev) => {
      let nextSubjs = prev.subjects;
      if (!nextSubjs.some((s) => s.id === targetSubjId)) {
        nextSubjs = [
          ...nextSubjs,
          {
            id: targetSubjId,
            name: 'General',
            examBoard: 'Revision',
            color: '#2F5F8A',
            examDate: '',
            weight: 2,
            createdAt: new Date().toISOString(),
          },
        ];
      }
      const topic = prev.topics.find((t) => t.subjectId === targetSubjId);
      const card: StudyFlashcard = {
        id: makeId('fc'),
        subjectId: targetSubjId,
        topicId: topic?.id || makeId('top'),
        sectionName: newSec.trim() || 'Core Deck',
        q: newQ.trim(),
        a: newA.trim(),
        box: 1,
        dueAt: Date.now(),
        flagged: false,
        createdAt: new Date().toISOString(),
      };
      return {
        ...prev,
        subjects: nextSubjs,
        flashcards: [card, ...prev.flashcards],
        updatedAt: new Date().toISOString(),
      };
    });
    setNewQ('');
    setNewA('');
  };

  const handleQuickBatchPaste = (e: FormEvent) => {
    e.preventDefault();
    const lines = quickBatchRaw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    const targetSubjId =
      selectedSubjectId && selectedSubjectId !== 'ALL'
        ? selectedSubjectId
        : workspace.subjects[0]?.id || makeId('subj');

    const parsed: Array<{ q: string; a: string }> = [];
    for (const line of lines) {
      const sep = line.includes('\t')
        ? line.split('\t')
        : line.includes('|')
        ? line.split('|')
        : line.includes('::')
        ? line.split('::')
        : null;
      if (sep && sep.length >= 2 && sep[0].trim() && sep[1].trim()) {
        parsed.push({ q: sep[0].trim(), a: sep[1].trim() });
      }
    }
    if (!parsed.length) return;

    onUpdateWorkspace((prev) => {
      let nextSubjs = prev.subjects;
      if (!nextSubjs.some((s) => s.id === targetSubjId)) {
        nextSubjs = [
          ...nextSubjs,
          {
            id: targetSubjId,
            name: 'General',
            examBoard: 'Revision',
            color: '#2F5F8A',
            examDate: '',
            weight: 2,
            createdAt: new Date().toISOString(),
          },
        ];
      }
      const topic = prev.topics.find((t) => t.subjectId === targetSubjId);
      const added: StudyFlashcard[] = parsed.map((p) => ({
        id: makeId('fc'),
        subjectId: targetSubjId,
        topicId: topic?.id || makeId('top'),
        sectionName: newSec.trim() || 'Core Deck',
        q: p.q,
        a: p.a,
        box: 1,
        dueAt: Date.now(),
        flagged: false,
        createdAt: new Date().toISOString(),
      }));
      return {
        ...prev,
        subjects: nextSubjs,
        flashcards: [...added, ...prev.flashcards],
        updatedAt: new Date().toISOString(),
      };
    });
    setQuickBatchRaw('');
  };

  const deleteCard = (cardId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      flashcards: prev.flashcards.filter((c) => c.id !== cardId),
      updatedAt: new Date().toISOString(),
    }));
    setQueue((prev) => prev.filter((id) => id !== cardId));
  };

  const manageFilteredCards = useMemo(() => {
    const q = manageSearch.trim().toLowerCase();
    return subjectCards.filter((c) => {
      if (manageFilter === 'weak' && c.box > 2) return false;
      if (manageFilter === 'flagged' && !c.flagged) return false;
      if (manageFilter === 'mastered' && c.box < 4) return false;
      if (q && !(c.q + ' ' + c.a + ' ' + c.sectionName).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [subjectCards, manageSearch, manageFilter]);

  const clozeParts = useMemo(() => {
    if (!currentCard || optReverse || !optCloze) return null;
    return buildClozeParts(currentCard.a);
  }, [currentCard, optReverse, optCloze]);

  const currentSubjectColor = currentCard
    ? subjById.get(currentCard.subjectId)?.color || 'var(--e3)'
    : 'var(--e3)';

  const againCards = useMemo(
    () => againIds.map((id) => cardById.get(id)).filter((c): c is StudyFlashcard => Boolean(c)),
    [againIds, cardById]
  );

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        {/* SETUP SCREEN (Original Deck Bar + Smart/Cram + Section Chips + Study Options) */}
        {screen === 'setup' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
              <div>
                <h1 className="font-display text-2xl font-extrabold tracking-tight text-[var(--ink)] sm:text-3xl">
                  Flashcards
                </h1>
                <p className="mt-1 text-sm text-[var(--mute)]">
                  Pick a subject or deck sections, choose Smart review or Cram, and flip with 3D active recall.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Filter by subject"
                  value={selectedSubjectId || 'ALL'}
                  onChange={(e) => onSelectSubjectId(e.target.value)}
                  className="sd-input w-auto py-1.5 text-xs font-semibold"
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
                  onClick={() => setScreen('manage')}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Browse &amp; Manage</span>
                </button>
                <button
                  type="button"
                  onClick={onOpenImport}
                  className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Import</span>
                </button>
                {subjectCards.length > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      onShareDeck(
                        selectedSubjectId && selectedSubjectId !== 'ALL'
                          ? selectedSubjectId
                          : workspace.subjects[0]?.id || '',
                        'ALL'
                      )
                    }
                    className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                  >
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Share</span>
                  </button>
                )}
              </div>
            </div>

            {subjectCards.length === 0 ? (
              <div className="sd-card p-8 text-center">
                <Layers className="mx-auto h-9 w-9 text-[var(--e3)]" aria-hidden="true" />
                <h2 className="font-display mt-3 text-xl font-bold text-[var(--ink)]">
                  No flashcards yet
                </h2>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-[var(--mute)]">
                  Add cards manually, paste Quizlet TSV/CSV sets in Import, or copy decks from Community Share.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setScreen('manage')}
                    className="sd-btn-pri px-4 py-2 text-xs"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Add Cards</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenImport}
                    className="sd-btn px-4 py-2 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Paste Quizlet / CSV</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigate('quiz')}
                    className="sd-btn px-4 py-2 text-xs"
                  >
                    <Gamepad2 className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                    <span>Live Quiz</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Sticky Deck Launcher Bar */}
                <div className="sd-card flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <div className="font-display text-lg font-extrabold text-[var(--ink)]">
                      {basePool.length} card{basePool.length === 1 ? '' : 's'} in your deck
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--mute)]">
                      {selectedSections.length} section{selectedSections.length === 1 ? '' : 's'} ·{' '}
                      {basePool.filter((c) => c.box === 1 && !c.lastReviewedAt).length} new ·{' '}
                      {basePool.filter((c) => c.box >= 4).length} mastered ·{' '}
                      {studyAlgo === 'smart'
                        ? duePool.length > 0
                          ? `${duePool.length} due now`
                          : 'nothing due — try Cram'
                        : 'cram: every card once'}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {hasPausedSession && queue.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setAnimPhase('in');
                          setScreen('play');
                        }}
                        className="sd-btn px-4 py-2.5 text-xs font-bold whitespace-nowrap"
                      >
                        Resume · {queue.length} left
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={sessionStartCount === 0}
                      onClick={() => launchSession(effectiveReadyPool)}
                      className="sd-btn-pri px-5 py-2.5 text-sm whitespace-nowrap"
                    >
                      {sessionStartCount > 0
                        ? `${studyAlgo === 'smart' ? 'Review' : 'Cram'} · ${sessionStartCount}`
                        : 'Nothing due'}
                    </button>
                  </div>
                </div>

                {/* Smart Review vs Cram Mode Cards */}
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Study mode">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={studyAlgo === 'smart'}
                    onClick={() => setStudyAlgo('smart')}
                    className={`cursor-pointer rounded-2xl border-2 p-4 text-left transition-colors ${
                      studyAlgo === 'smart'
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--card))]'
                        : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--mute)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-base font-bold text-[var(--ink)]">
                        ↻ Smart review {studyAlgo === 'smart' && '✓'}
                      </span>
                      <span className="font-mono-num text-xs font-bold text-[var(--e3)]">
                        {duePool.length} due now
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                      Only cards that are due. Rate Again, Hard, Good, or Easy and each card returns at wider intervals.
                    </p>
                  </button>

                  <button
                    type="button"
                    role="radio"
                    aria-checked={studyAlgo === 'cram'}
                    onClick={() => setStudyAlgo('cram')}
                    className={`cursor-pointer rounded-2xl border-2 p-4 text-left transition-colors ${
                      studyAlgo === 'cram'
                        ? 'border-[var(--e2)] bg-[color-mix(in_srgb,var(--e2)_10%,var(--card))]'
                        : 'border-[var(--line)] bg-[var(--card)] hover:border-[var(--mute)]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-base font-bold text-[var(--ink)]">
                        ⚡ Cram {studyAlgo === 'cram' && '✓'}
                      </span>
                      <span className="font-mono-num text-xs font-bold text-[var(--e2)]">
                        {basePool.length} cards
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--mute)]">
                      Study every selected card once, due or not. Ideal right before a test or live quiz.
                    </p>
                  </button>
                </div>

                {/* Sections Grid */}
                <div className="sd-card p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-display text-base font-bold text-[var(--ink)]">
                        Deck Sections
                      </h2>
                      <p className="text-xs text-[var(--mute)]">
                        Select which sections to include in your next session.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedSections(sectionBuckets.map((b) => b.key))}
                        className="sd-btn px-3 py-1 text-xs"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSections([])}
                        className="sd-btn px-3 py-1 text-xs"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {sectionBuckets.map((b) => {
                      const active = selectedSections.includes(b.key);
                      const mastered = b.cards.filter((c) => c.box >= 4).length;
                      const pct = Math.round((mastered / Math.max(1, b.cards.length)) * 100);
                      return (
                        <button
                          key={b.key}
                          type="button"
                          aria-pressed={active}
                          onClick={() =>
                            setSelectedSections((prev) =>
                              prev.includes(b.key)
                                ? prev.filter((x) => x !== b.key)
                                : [...prev, b.key]
                            )
                          }
                          style={{
                            borderColor: active ? b.color : undefined,
                            backgroundColor: active
                              ? `color-mix(in srgb, ${b.color} 11%, var(--card))`
                              : undefined,
                          }}
                          className="relative cursor-pointer overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3.5 py-3 pb-4 text-left transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-bold text-[var(--ink)]">{b.name}</span>
                            {active && (
                              <span
                                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                                style={{ backgroundColor: b.color }}
                              >
                                ✓
                              </span>
                            )}
                          </div>
                          <div className="font-mono-num mt-1 text-xs text-[var(--mute)]">
                            {b.subjectName} · {b.cards.length} cards · {mastered} mastered
                          </div>
                          <div className="absolute inset-x-0 bottom-0 h-1 bg-[var(--line)]">
                            <div
                              className="h-full bg-[var(--ok)] transition-[width] duration-300"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Study Options Card */}
                <div className="sd-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOptionsOpen((v) => !v)}
                    aria-expanded={optionsOpen}
                    className="flex w-full cursor-pointer items-center justify-between px-5 py-3.5 text-left"
                  >
                    <div>
                      <span className="font-display text-base font-bold text-[var(--ink)]">
                        Study options
                      </span>
                      <span className="ml-2 text-xs text-[var(--mute)]">
                        size, shuffle, reverse, fill-in-the-blank, type answer
                      </span>
                    </div>
                    <span className="text-xs font-bold text-[var(--mute)]">
                      {optionsOpen ? 'Hide' : 'Show'}
                    </span>
                  </button>

                  {optionsOpen && (
                    <div className="space-y-3 border-t border-[var(--line)] px-5 py-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
                        <span className="font-semibold text-[var(--ink)]">Session size</span>
                        <div className="sd-seg">
                          {[10, 20, 30, 0].map((n) => (
                            <button
                              key={n}
                              type="button"
                              aria-pressed={sessionLimit === n}
                              onClick={() => setSessionLimit(n)}
                              className="sd-seg-btn"
                            >
                              {n || 'All'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="border-b border-[var(--line)] pb-3">
                        <div className="mb-2 flex items-center gap-2">
                          <span className="font-semibold text-[var(--ink)]">Question types</span>
                          <span className="text-xs text-[var(--mute)]">
                            none selected means all
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {CARD_CATEGORIES.map(([cat, label]) => {
                            const pressed = selectedCategories.includes(cat);
                            return (
                              <button
                                key={cat}
                                type="button"
                                aria-pressed={pressed}
                                onClick={() =>
                                  setSelectedCategories((prev) =>
                                    prev.includes(cat)
                                      ? prev.filter((x) => x !== cat)
                                      : [...prev, cat]
                                  )
                                }
                                className={`cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                                  pressed
                                    ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--bg)]'
                                    : 'border-[var(--line)] bg-[var(--bg)] text-[var(--ink)]'
                                }`}
                              >
                                {label}{' '}
                                <span className="opacity-70">{categoryCounts[cat]}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        {[
                          { label: 'Shuffle cards', checked: optShuffle, set: setOptShuffle },
                          { label: 'Reverse cards (A → Q)', checked: optReverse, set: setOptReverse },
                          { label: 'Fill in the blank (cloze)', checked: optCloze, set: setOptCloze },
                          { label: 'Type answer first', checked: optTypeFirst, set: setOptTypeFirst },
                          { label: 'Flagged only', checked: optStarredOnly, set: setOptStarredOnly },
                          { label: 'Weak cards only (Box 1–2)', checked: optWeakOnly, set: setOptWeakOnly },
                        ].map((row) => (
                          <label
                            key={row.label}
                            className="sd-sw rounded-xl border border-[var(--line)] bg-[var(--bg)] px-3.5 py-2.5 text-xs font-semibold text-[var(--ink)]"
                          >
                            <span>{row.label}</span>
                            <input
                              type="checkbox"
                              checked={row.checked}
                              onChange={(e) => row.set(e.target.checked)}
                            />
                            <span className="sd-sw-track" aria-hidden="true" />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ACTIVE FLASHCARD PLAYER (Original 3D Flip + Three-dots Menu + Type/Cloze/Shuffle) */}
        {screen === 'play' && currentCard && (
          <div className="space-y-4">
            {/* Top Bar (.ftop) */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label="Back to decks"
                onClick={() => {
                  setHasPausedSession(queue.length > 0);
                  setMenuOpen(false);
                  setScreen('setup');
                }}
                className="sd-btn h-10 w-10 shrink-0 rounded-full p-0"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              </button>

              <span
                className={`rounded-full border px-3 py-1 text-xs font-bold whitespace-nowrap ${
                  studyAlgo === 'cram'
                    ? 'border-[var(--e2)] text-[var(--e2)]'
                    : 'border-[var(--e3)] text-[var(--e3)]'
                }`}
              >
                {studyAlgo === 'smart' ? '↻ Smart review' : '⚡ Cram'}
              </span>

              <div className="font-mono-num flex-1 text-center text-sm font-semibold text-[var(--mute)]">
                {shuffleToast
                  ? 'Shuffled!'
                  : `${Math.min(doneCount + 1, totalInRound)} of ${totalInRound}`}
              </div>

              {/* Three-dots Actions Dropdown (.menuw) */}
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                  aria-label="More actions"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="sd-btn h-10 w-10 shrink-0 rounded-full p-0"
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="sd-card absolute right-0 top-12 z-40 w-64 space-y-1 p-2 shadow-xl"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setFlipped(false);
                        setShowHint(true);
                        setMenuOpen(false);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg)]"
                    >
                      <Eye className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Show hint</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        toggleFlagCard(currentCard.id);
                        setMenuOpen(false);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg)]"
                    >
                      <Flag
                        className={`h-3.5 w-3.5 ${currentCard.flagged ? 'text-[var(--e2)]' : 'text-[var(--mute)]'}`}
                        aria-hidden="true"
                      />
                      <span>{currentCard.flagged ? 'Unflag card' : 'Flag card'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setEditModalCardId(currentCard.id);
                        setEditQ(currentCard.q);
                        setEditA(currentCard.a);
                        setMenuOpen(false);
                      }}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg)]"
                    >
                      <Edit3 className="h-3.5 w-3.5 text-[var(--mute)]" aria-hidden="true" />
                      <span>Edit card</span>
                    </button>

                    <div className="mt-1 border-t border-[var(--line)] px-3 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                      Study options
                    </div>

                    <button
                      type="button"
                      disabled={queue.length < 2}
                      onClick={() => handleShuffleDeckInPlayer(true)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg)] disabled:opacity-40"
                    >
                      <Shuffle className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                      <span>Shuffle all (incl. current)</span>
                    </button>

                    <button
                      type="button"
                      disabled={queue.length < 2}
                      onClick={() => handleShuffleDeckInPlayer(false)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg)] disabled:opacity-40"
                    >
                      <Shuffle className="h-3.5 w-3.5 text-[var(--mute)]" aria-hidden="true" />
                      <span>Shuffle remaining only</span>
                    </button>

                    <label className="sd-sw rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg)]">
                      <span>Reverse cards</span>
                      <input
                        type="checkbox"
                        checked={optReverse}
                        onChange={(e) => setOptReverse(e.target.checked)}
                      />
                      <span className="sd-sw-track" aria-hidden="true" />
                    </label>

                    <label className="sd-sw rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg)]">
                      <span>Type answer first</span>
                      <input
                        type="checkbox"
                        checked={optTypeFirst}
                        onChange={(e) => setOptTypeFirst(e.target.checked)}
                      />
                      <span className="sd-sw-track" aria-hidden="true" />
                    </label>

                    <label className="sd-sw rounded-lg px-3 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--bg)]">
                      <span>Fill in the blank</span>
                      <input
                        type="checkbox"
                        checked={optCloze}
                        onChange={(e) => setOptCloze(e.target.checked)}
                      />
                      <span className="sd-sw-track" aria-hidden="true" />
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* Session Progress Bar (.bar2) */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--line)]">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.round((doneCount / Math.max(1, totalInRound)) * 100)}%`,
                  backgroundColor: studyAlgo === 'cram' ? 'var(--e2)' : 'var(--ok)',
                }}
              />
            </div>

            {/* 3D Flip Card Stage (.fc3) */}
            <div
              ref={cardRef}
              tabIndex={0}
              role="button"
              aria-label="Flashcard. Press Space to flip"
              style={{ '--fc-accent': currentSubjectColor } as React.CSSProperties}
              className={`fc3 ${flipped ? 'fc3-flipped' : ''} ${
                animPhase === 'in'
                  ? 'fc3-in'
                  : animPhase === 'out-l'
                  ? 'fc3-out-l'
                  : animPhase === 'out-r'
                  ? 'fc3-out-r'
                  : ''
              }`}
              onPointerDown={(e) => {
                pointerStartRef.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerUp={(e) => {
                const start = pointerStartRef.current;
                pointerStartRef.current = null;
                if (!start) return;
                const dx = e.clientX - start.x;
                const dy = e.clientY - start.y;
                if (Math.abs(dx) > 50 && Math.abs(dy) < 45 && queue.length >= 2) {
                  swipeLockRef.current = true;
                  window.setTimeout(() => {
                    swipeLockRef.current = false;
                  }, 100);
                  stepCard(dx < 0 ? 1 : -1);
                }
              }}
              onPointerCancel={() => {
                pointerStartRef.current = null;
              }}
              onClick={() => {
                if (swipeLockRef.current) {
                  swipeLockRef.current = false;
                  return;
                }
                flipCard();
              }}
            >
              <div className="fc3-inner">
                {/* Front Face */}
                <div className="fc3-face">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: 'var(--fc-accent)' }}
                    >
                      {currentCard.sectionName || 'Core Deck'} ·{' '}
                      {CAT_LABEL[detectCardCategory(currentCard)]}
                    </span>
                    <span className="font-mono-num text-xs text-[var(--mute)]">
                      {currentCard.flagged ? '⚑ Flagged · ' : ''}Box {currentCard.box}/5
                    </span>
                  </div>

                  {clozeParts ? (
                    <div className="my-auto py-3 text-center">
                      <p className="mb-2 text-sm text-[var(--mute)]">{currentCard.q}</p>
                      <div className="font-display text-lg font-semibold leading-relaxed text-[var(--ink)] sm:text-xl">
                        {clozeParts.map((part, idx) =>
                          part.isBlank ? (
                            <span
                              key={idx}
                              className="sd-cloze-gap"
                              style={{
                                minWidth: `${Math.max(4, Math.min(part.text.length, 12))}ch`,
                              }}
                            >
                              {showHint ? part.text[0] : '\u00a0'}
                            </span>
                          ) : (
                            <span key={idx}>{part.text}</span>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="my-auto py-4 text-center">
                      <div className="font-display text-xl font-bold leading-snug text-[var(--ink)] sm:text-2xl">
                        {optReverse ? currentCard.a : currentCard.q}
                      </div>
                      {showHint && (
                        <p className="mt-3 font-display text-sm tracking-wider text-[var(--mute)]">
                          Hint: {hintOf(optReverse ? currentCard.q : currentCard.a)}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="text-center text-xs text-[var(--mute)]">
                    {showHint
                      ? 'Hint shown · Tap to flip'
                      : clozeParts
                      ? 'Fill in the blank · Tap to flip'
                      : 'Tap or press Space to flip'}
                  </div>
                </div>

                {/* Back Face */}
                <div className="fc3-face fc3-back">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-xs font-bold uppercase tracking-wider"
                      style={{ color: 'var(--fc-accent)' }}
                    >
                      {currentCard.sectionName || 'Core Deck'} · Answer
                    </span>
                    <span className="font-mono-num text-xs text-[var(--mute)]">
                      Box {currentCard.box}/5
                    </span>
                  </div>

                  <p className="mt-3 text-center text-sm text-[var(--mute)]">
                    {optReverse ? currentCard.a : currentCard.q}
                  </p>

                  <div className="my-auto py-3 text-center">
                    {clozeParts ? (
                      <div className="font-display text-lg font-bold leading-relaxed text-[var(--ink)] sm:text-xl">
                        {clozeParts.map((part, idx) =>
                          part.isBlank ? (
                            <mark key={idx} className="sd-cloze-fill">
                              {part.text}
                            </mark>
                          ) : (
                            <span key={idx}>{part.text}</span>
                          )
                        )}
                      </div>
                    ) : (
                      <div className="font-display text-xl font-bold leading-snug text-[var(--ink)] sm:text-2xl">
                        {optReverse ? currentCard.q : currentCard.a}
                      </div>
                    )}

                    {writtenSnapshot && (
                      <div
                        className={`mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                          typedCorrect === true
                            ? 'border-[var(--ok)] text-[var(--ok)]'
                            : typedCorrect === false
                            ? 'border-[var(--bad)] text-[var(--bad)]'
                            : 'border-[var(--line)] text-[var(--mute)]'
                        }`}
                      >
                        {typedCorrect === true ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : typedCorrect === false ? (
                          <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        ) : null}
                        <span>You wrote: {writtenSnapshot}</span>
                      </div>
                    )}
                  </div>

                  <div className="text-center text-xs text-[var(--mute)]">
                    Rate below to schedule next review
                  </div>
                </div>
              </div>
            </div>

            {/* Prev / Next Navigation Row */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={queue.length < 2 || busy}
                onClick={() => stepCard(-1)}
                className="sd-btn rounded-full px-4 py-2 text-xs whitespace-nowrap"
              >
                ‹ Prev
              </button>
              <span className="hidden text-center text-xs text-[var(--mute)] sm:inline">
                Swipe or use ← → to flick through · 1–4 to rate
              </span>
              <button
                type="button"
                disabled={queue.length < 2 || busy}
                onClick={() => stepCard(1)}
                className="sd-btn rounded-full px-4 py-2 text-xs whitespace-nowrap"
              >
                Next ›
              </button>
            </div>

            {/* Type Answer First Input */}
            {optTypeFirst && !seenAnswer && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  flipCard();
                }}
                className="space-y-2"
              >
                <textarea
                  rows={2}
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      flipCard();
                    }
                  }}
                  placeholder={
                    clozeParts
                      ? 'Type the missing word(s), then press Enter to flip'
                      : 'Type your answer from memory, then press Enter to flip'
                  }
                  className="sd-input text-sm"
                />
              </form>
            )}

            {/* Flip / Rating Action Buttons */}
            {!seenAnswer ? (
              <button
                type="button"
                onClick={flipCard}
                className="sd-btn-pri w-full rounded-2xl py-3.5 text-base font-bold"
              >
                Show answer
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => rateCurrentCard(1)}
                  className="sd-btn flex-col rounded-2xl border-[var(--bad)] py-2.5 text-xs"
                >
                  <span className="text-sm font-bold text-[var(--bad)]">1 · Again</span>
                  <span className="text-[11px] font-normal text-[var(--mute)]">
                    {nextIntervalLabel(currentCard.box, 1, studyAlgo)}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => rateCurrentCard(2)}
                  className="sd-btn flex-col rounded-2xl border-[var(--e2)] py-2.5 text-xs"
                >
                  <span className="text-sm font-bold text-[var(--e2)]">2 · Hard</span>
                  <span className="text-[11px] font-normal text-[var(--mute)]">
                    {nextIntervalLabel(currentCard.box, 2, studyAlgo)}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => rateCurrentCard(3)}
                  className="sd-btn flex-col rounded-2xl border-[var(--e3)] py-2.5 text-xs"
                >
                  <span className="text-sm font-bold text-[var(--e3)]">3 · Good</span>
                  <span className="text-[11px] font-normal text-[var(--mute)]">
                    {nextIntervalLabel(currentCard.box, 3, studyAlgo)}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => rateCurrentCard(4)}
                  className="sd-btn flex-col rounded-2xl border-[var(--ok)] py-2.5 text-xs"
                >
                  <span className="text-sm font-bold text-[var(--ok)]">4 · Easy</span>
                  <span className="text-[11px] font-normal text-[var(--mute)]">
                    {nextIntervalLabel(currentCard.box, 4, studyAlgo)}
                  </span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* SESSION COMPLETE SUMMARY SCREEN */}
        {screen === 'summary' && (
          <div className="space-y-5">
            <div className="sd-card p-7 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-[var(--ok)]" aria-hidden="true" />
              <h2 className="font-display mt-3 text-2xl font-extrabold text-[var(--ink)]">
                Session complete
              </h2>
              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-[var(--bg)] p-3">
                  <div className="font-display text-2xl font-extrabold text-[var(--e3)]">
                    {goodCount}
                  </div>
                  <div className="text-xs text-[var(--mute)]">Good / Hard</div>
                </div>
                <div className="rounded-xl bg-[var(--bg)] p-3">
                  <div className="font-display text-2xl font-extrabold text-[var(--ok)]">
                    {easyCount}
                  </div>
                  <div className="text-xs text-[var(--mute)]">Easy</div>
                </div>
                <div className="rounded-xl bg-[var(--bg)] p-3">
                  <div className="font-display text-2xl font-extrabold text-[var(--bad)]">
                    {againCards.length}
                  </div>
                  <div className="text-xs text-[var(--mute)]">Needed retries</div>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                {againCards.length > 0 && (
                  <button
                    type="button"
                    onClick={() => launchSession(againCards)}
                    className="sd-btn-pri px-4 py-2 text-xs"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Redo missed cards ({againCards.length})</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => launchSession(basePool)}
                  className="sd-btn px-4 py-2 text-xs"
                >
                  Study Deck Again
                </button>
                <button
                  type="button"
                  onClick={() => setScreen('setup')}
                  className="sd-btn px-4 py-2 text-xs"
                >
                  Back to decks
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('quiz')}
                  className="sd-btn px-4 py-2 text-xs"
                >
                  <Gamepad2 className="h-3.5 w-3.5 text-[var(--e2)]" aria-hidden="true" />
                  <span>Test in Live Quiz</span>
                </button>
              </div>
            </div>

            {againCards.length > 0 && (
              <div className="sd-card p-5">
                <h3 className="font-display text-base font-bold text-[var(--ink)]">
                  Cards that needed another go
                </h3>
                <div className="mt-3 divide-y divide-[var(--line)]">
                  {againCards.map((c) => (
                    <div key={c.id} className="py-2.5 text-sm">
                      <div className="font-semibold text-[var(--ink)]">{c.q}</div>
                      <div className="text-xs text-[var(--mute)]">{c.a}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* BROWSE & MANAGE SCREEN */}
        {screen === 'manage' && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setScreen('setup')}
                  className="sd-btn h-9 w-9 rounded-full p-0"
                  aria-label="Back to deck setup"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <div>
                  <h1 className="font-display text-xl font-extrabold text-[var(--ink)] sm:text-2xl">
                    Browse &amp; Manage Cards
                  </h1>
                  <p className="text-xs text-[var(--mute)]">
                    Add single cards, quick-paste lines from Quizlet, or edit &amp; flag existing cards.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onOpenImport}
                className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Full Importer</span>
              </button>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <form onSubmit={handleAddSingleCard} className="sd-card space-y-3 p-5">
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Add Single Card
                </h2>
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Section / Topic
                  <input
                    type="text"
                    value={newSec}
                    onChange={(e) => setNewSec(e.target.value)}
                    placeholder="e.g. Cell Biology"
                    className="sd-input mt-1 text-xs"
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Question / Front *
                  <input
                    type="text"
                    required
                    value={newQ}
                    onChange={(e) => setNewQ(e.target.value)}
                    placeholder="Define osmosis"
                    className="sd-input mt-1 text-sm"
                  />
                </label>
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Answer / Back *
                  <textarea
                    rows={2}
                    required
                    value={newA}
                    onChange={(e) => setNewA(e.target.value)}
                    placeholder="Net movement of water molecules..."
                    className="sd-input mt-1 text-sm"
                  />
                </label>
                <button type="submit" className="sd-btn-pri px-4 py-2 text-xs">
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Add Card</span>
                </button>
              </form>

              <form onSubmit={handleQuickBatchPaste} className="sd-card space-y-3 p-5">
                <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                  Quick Batch Add (Quizlet / Pipe / Tab)
                </h2>
                <p className="text-xs text-[var(--mute)]">
                  Paste one card per line separated by <code>|</code>, <code>::</code>, or a Tab
                  character.
                </p>
                <textarea
                  rows={5}
                  value={quickBatchRaw}
                  onChange={(e) => setQuickBatchRaw(e.target.value)}
                  placeholder={
                    'Mitochondria | Site of aerobic respiration\nRibosome | Site of protein synthesis'
                  }
                  className="sd-input font-mono-num text-xs"
                />
                <button type="submit" className="sd-btn px-4 py-2 text-xs">
                  Add All Lines
                </button>
              </form>
            </div>

            <div className="sd-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-5 py-3.5">
                <span className="font-display text-base font-bold text-[var(--ink)]">
                  All Matching Cards ({manageFilteredCards.length})
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={manageSearch}
                    onChange={(e) => setManageSearch(e.target.value)}
                    placeholder="Search cards…"
                    className="sd-input w-44 py-1 text-xs"
                  />
                  <select
                    aria-label="Filter cards"
                    value={manageFilter}
                    onChange={(e) =>
                      setManageFilter(e.target.value as 'all' | 'weak' | 'flagged' | 'mastered')
                    }
                    className="sd-input w-auto py-1 text-xs"
                  >
                    <option value="all">All</option>
                    <option value="weak">Learning (Box 1–2)</option>
                    <option value="flagged">Flagged</option>
                    <option value="mastered">Mastered (Box 4–5)</option>
                  </select>
                </div>
              </div>
              <div className="divide-y divide-[var(--line)]">
                {manageFilteredCards.map((card) => (
                  <div
                    key={card.id}
                    className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-semibold text-[var(--ink)]">{card.q}</div>
                      <div className="text-xs text-[var(--mute)]">{card.a}</div>
                      <div className="font-mono-num text-[11px] text-[var(--mute)]">
                        {card.sectionName} · Box {card.box}/5
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => toggleFlagCard(card.id)}
                        aria-label="Toggle flag"
                        className={`sd-btn h-8 w-8 p-0 ${card.flagged ? 'text-[var(--e2)]' : ''}`}
                      >
                        <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditModalCardId(card.id);
                          setEditQ(card.q);
                          setEditA(card.a);
                        }}
                        aria-label="Edit card"
                        className="sd-btn h-8 w-8 p-0"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteCard(card.id)}
                        aria-label="Delete card"
                        className="sd-btn h-8 w-8 p-0 text-[var(--bad)]"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
                {manageFilteredCards.length === 0 && (
                  <div className="p-6 text-center text-xs text-[var(--mute)]">
                    No cards match this filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Inline Edit Card Modal (works during Play OR Manage without losing session state) */}
      {editModalCardId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Edit flashcard"
        >
          <form onSubmit={saveEditModal} className="sd-card w-full max-w-md space-y-4 p-5">
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
              <h2 className="font-display text-lg font-bold text-[var(--ink)]">Edit flashcard</h2>
              <button
                type="button"
                onClick={() => setEditModalCardId(null)}
                aria-label="Close"
                className="sd-btn h-8 w-8 p-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <label className="block text-xs font-semibold text-[var(--mute)]">
              Question
              <textarea
                rows={2}
                required
                value={editQ}
                onChange={(e) => setEditQ(e.target.value)}
                className="sd-input mt-1 text-sm"
              />
            </label>
            <label className="block text-xs font-semibold text-[var(--mute)]">
              Answer
              <textarea
                rows={3}
                required
                value={editA}
                onChange={(e) => setEditA(e.target.value)}
                className="sd-input mt-1 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditModalCardId(null)}
                className="sd-btn px-4 py-2 text-xs"
              >
                Cancel
              </button>
              <button type="submit" className="sd-btn-pri px-4 py-2 text-xs">
                Save changes
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
