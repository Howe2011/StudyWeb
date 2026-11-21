import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  Eye,
  Flag,
  Gamepad2,
  Layers,
  MoreHorizontal,
  Play,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Shuffle,
  Square,
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
  onShareDeck: (subjectId: string, sectionName: string, topicId?: string) => void;
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
  const [selectedTopicFilter, setSelectedTopicFilter] = useState<string>('ALL');
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
  const [editTopicId, setEditTopicId] = useState<string>('');
  const [editSectionName, setEditSectionName] = useState<string>('');

  // Manage / Add form state
  const [manageSubTab, setManageSubTab] = useState<'browse' | 'add'>('browse');
  const [manageLayout, setManageLayout] = useState<'grouped' | 'flat'>('grouped');
  const [manageSort, setManageSort] = useState<'orig' | 'box-asc' | 'box-desc' | 'due' | 'az'>('orig');
  const [manageSectionFilter, setManageSectionFilter] = useState<string>('ALL');
  const [collapsedManageGroups, setCollapsedManageGroups] = useState<Set<string>>(new Set());
  const [selectedManageIds, setSelectedManageIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState<boolean>(false);
  const [renamingSectionKey, setRenamingSectionKey] = useState<string | null>(null);
  const [renameSectionDraft, setRenameSectionDraft] = useState<string>('');
  const [newTopicId, setNewTopicId] = useState<string>('');
  const [newTopicCustomName, setNewTopicCustomName] = useState<string>('');
  const [newQ, setNewQ] = useState('');
  const [newA, setNewA] = useState('');
  const [newSec, setNewSec] = useState('Core Deck');
  const [quickBatchRaw, setQuickBatchRaw] = useState('');
  const [manageSearch, setManageSearch] = useState('');
  const [manageTopicFilter, setManageTopicFilter] = useState<string>('ALL');
  const [manageFilter, setManageFilter] = useState<'all' | 'due' | 'weak' | 'mid' | 'flagged' | 'mastered'>('all');
  const [moveTargetTopicId, setMoveTargetTopicId] = useState<string>('');
  const [moveNewTopicName, setMoveNewTopicName] = useState<string>('');
  const [moveTargetSection, setMoveTargetSection] = useState<string>('');
  const [moveFeedback, setMoveFeedback] = useState<string | null>(null);

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

  const topicById = useMemo(
    () => new Map(workspace.topics.map((t) => [t.id, t])),
    [workspace.topics]
  );

  const subjectCards = useMemo(() => {
    if (!selectedSubjectId || selectedSubjectId === 'ALL') return workspace.flashcards;
    return workspace.flashcards.filter((c) => c.subjectId === selectedSubjectId);
  }, [workspace.flashcards, selectedSubjectId]);

  const subjectTopicsList = useMemo(() => {
    if (!selectedSubjectId || selectedSubjectId === 'ALL') return workspace.topics;
    return workspace.topics.filter((t) => t.subjectId === selectedSubjectId);
  }, [workspace.topics, selectedSubjectId]);

  // Reset topic filter when subject changes
  useEffect(() => {
    setSelectedTopicFilter('ALL');
    setManageTopicFilter('ALL');
    setManageSectionFilter('ALL');
    setSelectedManageIds(new Set());
    setConfirmBulkDelete(false);
    setMoveFeedback(null);
  }, [selectedSubjectId]);

  // Keep default topic selection synced for Add Card & Batch Move
  useEffect(() => {
    if (selectedTopicFilter !== 'ALL' && subjectTopicsList.some((t) => t.id === selectedTopicFilter)) {
      setNewTopicId(selectedTopicFilter);
    } else if (!newTopicId || (newTopicId !== '__new__' && !subjectTopicsList.some((t) => t.id === newTopicId))) {
      setNewTopicId(subjectTopicsList[0]?.id || '__new__');
    }
    if (!moveTargetTopicId || (moveTargetTopicId !== '__new__' && !subjectTopicsList.some((t) => t.id === moveTargetTopicId))) {
      setMoveTargetTopicId(subjectTopicsList[0]?.id || '__new__');
    }
  }, [selectedTopicFilter, subjectTopicsList, newTopicId, moveTargetTopicId]);

  const topicCardsSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of subjectCards) {
      const tid = topicById.has(c.topicId) ? c.topicId : '__unassigned__';
      counts.set(tid, (counts.get(tid) || 0) + 1);
    }
    const items = subjectTopicsList
      .map((t) => ({
        topicId: t.id,
        topicName: t.name,
        subjectName: subjById.get(t.subjectId)?.name || 'General',
        color: subjById.get(t.subjectId)?.color || '#2F5F8A',
        count: counts.get(t.id) || 0,
      }))
      .filter((x) => x.count > 0);
    const unassignedCount = counts.get('__unassigned__') || 0;
    if (unassignedCount > 0) {
      items.push({
        topicId: '__unassigned__',
        topicName: 'General / Unassigned',
        subjectName: 'General',
        color: '#6b7280',
        count: unassignedCount,
      });
    }
    return items;
  }, [subjectCards, subjectTopicsList, topicById, subjById]);

  const topicFilteredCards = useMemo(() => {
    if (selectedTopicFilter === 'ALL') return subjectCards;
    if (selectedTopicFilter === '__unassigned__') {
      return subjectCards.filter((c) => !topicById.has(c.topicId));
    }
    return subjectCards.filter((c) => c.topicId === selectedTopicFilter);
  }, [subjectCards, selectedTopicFilter, topicById]);

  const sectionBuckets = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        name: string;
        topicId: string;
        topicName: string;
        subjectId: string;
        subjectName: string;
        color: string;
        cards: StudyFlashcard[];
      }
    >();

    for (const c of topicFilteredCards) {
      const s = subjById.get(c.subjectId);
      const t = topicById.get(c.topicId);
      const tId = t ? t.id : '__unassigned__';
      const tName = t ? t.name : 'General / Unassigned';
      const secName = (c.sectionName || 'Core Deck').trim() || 'Core Deck';
      const key = `${c.subjectId}:::${tId}:::${secName}`;
      const existing = map.get(key);
      if (existing) {
        existing.cards.push(c);
      } else {
        map.set(key, {
          key,
          name: secName,
          topicId: tId,
          topicName: tName,
          subjectId: c.subjectId,
          subjectName: s?.name || 'General',
          color: s?.color || '#2F5F8A',
          cards: [c],
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => a.topicName.localeCompare(b.topicName) || a.name.localeCompare(b.name)
    );
  }, [topicFilteredCards, subjById, topicById]);

  const topicGroupedBuckets = useMemo(() => {
    const groups = new Map<
      string,
      {
        topicId: string;
        topicName: string;
        subjectName: string;
        color: string;
        buckets: typeof sectionBuckets;
        totalCards: number;
      }
    >();
    for (const b of sectionBuckets) {
      const g = groups.get(b.topicId);
      if (g) {
        g.buckets.push(b);
        g.totalCards += b.cards.length;
      } else {
        groups.set(b.topicId, {
          topicId: b.topicId,
          topicName: b.topicName,
          subjectName: b.subjectName,
          color: b.color,
          buckets: [b],
          totalCards: b.cards.length,
        });
      }
    }
    return Array.from(groups.values());
  }, [sectionBuckets]);

  // Auto-select sections cleanly when subject or topic filter changes
  useEffect(() => {
    const validKeys = new Set(sectionBuckets.map((b) => b.key));
    setSelectedSections((prev) => {
      const kept = prev.filter((k) => validKeys.has(k));
      if (kept.length > 0) return kept;
      return sectionBuckets.map((b) => b.key);
    });
  }, [sectionBuckets]);

  // Base pool of cards matching selected topic + sections + filters
  const basePool = useMemo(() => {
    const selSet = new Set(selectedSections);
    return topicFilteredCards.filter((c) => {
      const tId = topicById.has(c.topicId) ? c.topicId : '__unassigned__';
      const secName = (c.sectionName || 'Core Deck').trim() || 'Core Deck';
      const key = `${c.subjectId}:::${tId}:::${secName}`;
      if (selSet.size > 0 && !selSet.has(key)) return false;
      if (optStarredOnly && !c.flagged) return false;
      if (optWeakOnly && c.box > 2) return false;
      if (selectedCategories.length > 0 && !selectedCategories.includes(detectCardCategory(c))) {
        return false;
      }
      return true;
    });
  }, [topicFilteredCards, topicById, selectedSections, optStarredOnly, optWeakOnly, selectedCategories]);

  const categoryCounts = useMemo(() => {
    const selSet = new Set(selectedSections);
    const counts: Record<CardCategory, number> = {
      date: 0,
      stat: 0,
      person: 0,
      cause: 0,
      term: 0,
    };
    topicFilteredCards.forEach((c) => {
      const tId = topicById.has(c.topicId) ? c.topicId : '__unassigned__';
      const secName = (c.sectionName || 'Core Deck').trim() || 'Core Deck';
      const key = `${c.subjectId}:::${tId}:::${secName}`;
      if (selSet.size > 0 && !selSet.has(key)) return;
      counts[detectCardCategory(c)] += 1;
    });
    return counts;
  }, [topicFilteredCards, topicById, selectedSections]);

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
      flashcards: prev.flashcards.map((c) => {
        if (c.id !== editModalCardId) return c;
        const resolvedTopic = editTopicId ? prev.topics.find((t) => t.id === editTopicId) : undefined;
        return {
          ...c,
          q: editQ.trim(),
          a: editA.trim(),
          topicId: resolvedTopic ? resolvedTopic.id : editTopicId || c.topicId,
          subjectId: resolvedTopic ? resolvedTopic.subjectId : c.subjectId,
          sectionName: editSectionName.trim() || c.sectionName,
        };
      }),
      updatedAt: new Date().toISOString(),
    }));
    setEditModalCardId(null);
  };

  const resolveOrCreateTargetTopic = (
    prev: WorkspaceData,
    fallbackSubjId: string,
    chosenTopicId: string,
    customName: string
  ): { nextSubjs: WorkspaceData['subjects']; nextTopics: WorkspaceData['topics']; subjId: string; topicId: string; topicName: string } => {
    let nextSubjs = prev.subjects;
    let nextTopics = prev.topics;
    if (!nextSubjs.some((s) => s.id === fallbackSubjId)) {
      nextSubjs = [
        ...nextSubjs,
        {
          id: fallbackSubjId,
          name: 'General',
          examBoard: 'Revision',
          color: '#2F5F8A',
          examDate: '',
          weight: 2,
          createdAt: new Date().toISOString(),
        },
      ];
    }
    if (chosenTopicId === '__new__' && customName.trim()) {
      const existingByName = nextTopics.find(
        (t) => t.subjectId === fallbackSubjId && t.name.toLowerCase() === customName.trim().toLowerCase()
      );
      if (existingByName) {
        return { nextSubjs, nextTopics, subjId: existingByName.subjectId, topicId: existingByName.id, topicName: existingByName.name };
      }
      const createdId = makeId('top');
      nextTopics = [
        ...nextTopics,
        {
          id: createdId,
          subjectId: fallbackSubjId,
          name: customName.trim(),
          completed: false,
          notes: { summary: '', sections: [], keyTerms: [], examTip: '', workedExample: '', updatedAt: new Date().toISOString() },
          createdAt: new Date().toISOString(),
        },
      ];
      return { nextSubjs, nextTopics, subjId: fallbackSubjId, topicId: createdId, topicName: customName.trim() };
    }
    const found = nextTopics.find((t) => t.id === chosenTopicId) || nextTopics.find((t) => t.subjectId === fallbackSubjId);
    if (found) {
      return { nextSubjs, nextTopics, subjId: found.subjectId, topicId: found.id, topicName: found.name };
    }
    const createdId = makeId('top');
    const fallbackName = customName.trim() || 'Core Topic';
    nextTopics = [
      ...nextTopics,
      {
        id: createdId,
        subjectId: fallbackSubjId,
        name: fallbackName,
        completed: false,
        notes: { summary: '', sections: [], keyTerms: [], examTip: '', workedExample: '', updatedAt: new Date().toISOString() },
        createdAt: new Date().toISOString(),
      },
    ];
    return { nextSubjs, nextTopics, subjId: fallbackSubjId, topicId: createdId, topicName: fallbackName };
  };

  const handleAddSingleCard = (e: FormEvent) => {
    e.preventDefault();
    if (!newQ.trim() || !newA.trim()) return;
    const targetSubjId =
      selectedSubjectId && selectedSubjectId !== 'ALL'
        ? selectedSubjectId
        : workspace.subjects[0]?.id || makeId('subj');

    onUpdateWorkspace((prev) => {
      const resolved = resolveOrCreateTargetTopic(prev, targetSubjId, newTopicId, newTopicCustomName);
      const card: StudyFlashcard = {
        id: makeId('fc'),
        subjectId: resolved.subjId,
        topicId: resolved.topicId,
        sectionName: newSec.trim() || resolved.topicName || 'Core Deck',
        q: newQ.trim(),
        a: newA.trim(),
        box: 1,
        dueAt: Date.now(),
        flagged: false,
        createdAt: new Date().toISOString(),
      };
      return {
        ...prev,
        subjects: resolved.nextSubjs,
        topics: resolved.nextTopics,
        flashcards: [card, ...prev.flashcards],
        updatedAt: new Date().toISOString(),
      };
    });
    setNewQ('');
    setNewA('');
    if (newTopicId === '__new__') setNewTopicCustomName('');
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
      const resolved = resolveOrCreateTargetTopic(prev, targetSubjId, newTopicId, newTopicCustomName);
      const added: StudyFlashcard[] = parsed.map((p) => ({
        id: makeId('fc'),
        subjectId: resolved.subjId,
        topicId: resolved.topicId,
        sectionName: newSec.trim() || resolved.topicName || 'Core Deck',
        q: p.q,
        a: p.a,
        box: 1,
        dueAt: Date.now(),
        flagged: false,
        createdAt: new Date().toISOString(),
      }));
      return {
        ...prev,
        subjects: resolved.nextSubjs,
        topics: resolved.nextTopics,
        flashcards: [...added, ...prev.flashcards],
        updatedAt: new Date().toISOString(),
      };
    });
    setQuickBatchRaw('');
    if (newTopicId === '__new__') setNewTopicCustomName('');
  };

  const deleteCard = (cardId: string) => {
    onUpdateWorkspace((prev) => ({
      ...prev,
      flashcards: prev.flashcards.filter((c) => c.id !== cardId),
      updatedAt: new Date().toISOString(),
    }));
    setQueue((prev) => prev.filter((id) => id !== cardId));
    setSelectedManageIds((prev) => {
      if (!prev.has(cardId)) return prev;
      const next = new Set(prev);
      next.delete(cardId);
      return next;
    });
  };

  const manageAvailableSections = useMemo(() => {
    const set = new Set<string>();
    subjectCards.forEach((c) => {
      if (manageTopicFilter === '__unassigned__' && topicById.has(c.topicId)) return;
      if (manageTopicFilter !== 'ALL' && manageTopicFilter !== '__unassigned__' && c.topicId !== manageTopicFilter) {
        return;
      }
      set.add((c.sectionName || 'Core Deck').trim() || 'Core Deck');
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [subjectCards, manageTopicFilter, topicById]);

  const manageFilteredCards = useMemo(() => {
    const q = manageSearch.trim().toLowerCase();
    const now = Date.now();
    const list = subjectCards.filter((c) => {
      if (manageTopicFilter === '__unassigned__' && topicById.has(c.topicId)) return false;
      if (manageTopicFilter !== 'ALL' && manageTopicFilter !== '__unassigned__' && c.topicId !== manageTopicFilter) {
        return false;
      }
      const sec = (c.sectionName || 'Core Deck').trim() || 'Core Deck';
      if (manageSectionFilter !== 'ALL' && sec !== manageSectionFilter) return false;
      if (manageFilter === 'due' && c.dueAt > now) return false;
      if (manageFilter === 'weak' && c.box > 2) return false;
      if (manageFilter === 'mid' && c.box !== 3) return false;
      if (manageFilter === 'flagged' && !c.flagged) return false;
      if (manageFilter === 'mastered' && c.box < 4) return false;
      if (q) {
        const tName = topicById.get(c.topicId)?.name || '';
        if (!(c.q + ' ' + c.a + ' ' + c.sectionName + ' ' + tName).toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });

    const sorted = [...list];
    if (manageSort === 'box-asc') {
      sorted.sort((a, b) => a.box - b.box || a.dueAt - b.dueAt);
    } else if (manageSort === 'box-desc') {
      sorted.sort((a, b) => b.box - a.box || b.dueAt - a.dueAt);
    } else if (manageSort === 'due') {
      sorted.sort((a, b) => a.dueAt - b.dueAt || a.box - b.box);
    } else if (manageSort === 'az') {
      sorted.sort((a, b) => a.q.localeCompare(b.q));
    } else {
      sorted.sort((a, b) => {
        const ta = topicById.get(a.topicId)?.name || 'General';
        const tb = topicById.get(b.topicId)?.name || 'General';
        return ta.localeCompare(tb) || a.sectionName.localeCompare(b.sectionName);
      });
    }
    return sorted;
  }, [
    subjectCards,
    manageSearch,
    manageTopicFilter,
    manageSectionFilter,
    manageFilter,
    manageSort,
    topicById,
  ]);

  const manageGroupedTree = useMemo(() => {
    const topicMap = new Map<
      string,
      {
        topicId: string;
        topicName: string;
        subjectName: string;
        color: string;
        totalCards: number;
        dueCards: number;
        sections: Map<
          string,
          {
            key: string;
            sectionName: string;
            topicId: string;
            subjectId: string;
            cards: StudyFlashcard[];
          }
        >;
      }
    >();
    const now = Date.now();
    for (const c of manageFilteredCards) {
      const s = subjById.get(c.subjectId);
      const t = topicById.get(c.topicId);
      const tId = t ? t.id : '__unassigned__';
      const tName = t ? t.name : 'General / Unassigned';
      const secName = (c.sectionName || 'Core Deck').trim() || 'Core Deck';
      const secKey = `${c.subjectId}:::${tId}:::${secName}`;

      let tGroup = topicMap.get(tId);
      if (!tGroup) {
        tGroup = {
          topicId: tId,
          topicName: tName,
          subjectName: s?.name || 'General',
          color: s?.color || '#2F5F8A',
          totalCards: 0,
          dueCards: 0,
          sections: new Map(),
        };
        topicMap.set(tId, tGroup);
      }
      tGroup.totalCards += 1;
      if (c.dueAt <= now) tGroup.dueCards += 1;

      let secBucket = tGroup.sections.get(secKey);
      if (!secBucket) {
        secBucket = {
          key: secKey,
          sectionName: secName,
          topicId: tId,
          subjectId: c.subjectId,
          cards: [],
        };
        tGroup.sections.set(secKey, secBucket);
      }
      secBucket.cards.push(c);
    }

    return Array.from(topicMap.values()).map((tg) => ({
      ...tg,
      sectionList: Array.from(tg.sections.values()),
    }));
  }, [manageFilteredCards, subjById, topicById]);

  const targetBulkCardIds = useMemo(() => {
    if (selectedManageIds.size > 0) {
      return manageFilteredCards.filter((c) => selectedManageIds.has(c.id)).map((c) => c.id);
    }
    return manageFilteredCards.map((c) => c.id);
  }, [selectedManageIds, manageFilteredCards]);

  const handleMoveTargetCardsToTopic = () => {
    if (targetBulkCardIds.length === 0) return;
    if (moveTargetTopicId === '__new__' && !moveNewTopicName.trim()) return;
    const idsToMove = new Set(targetBulkCardIds);
    const firstCard = manageFilteredCards.find((c) => idsToMove.has(c.id));
    const fallbackSubjId =
      selectedSubjectId && selectedSubjectId !== 'ALL'
        ? selectedSubjectId
        : firstCard?.subjectId || workspace.subjects[0]?.id || makeId('subj');

    let destTopicLabel = '';
    const cleanNewSec = moveTargetSection.trim();
    onUpdateWorkspace((prev) => {
      const resolved = resolveOrCreateTargetTopic(
        prev,
        fallbackSubjId,
        moveTargetTopicId,
        moveNewTopicName
      );
      destTopicLabel = resolved.topicName;
      return {
        ...prev,
        subjects: resolved.nextSubjs,
        topics: resolved.nextTopics,
        flashcards: prev.flashcards.map((c) =>
          idsToMove.has(c.id)
            ? {
                ...c,
                subjectId: resolved.subjId,
                topicId: resolved.topicId,
                ...(cleanNewSec ? { sectionName: cleanNewSec } : {}),
              }
            : c
        ),
        updatedAt: new Date().toISOString(),
      };
    });
    setMoveFeedback(
      `Moved ${idsToMove.size} card${idsToMove.size === 1 ? '' : 's'} into "${destTopicLabel || 'selected topic'}"${cleanNewSec ? ` · ${cleanNewSec}` : ''}.`
    );
    setSelectedManageIds(new Set());
    if (moveTargetTopicId === '__new__') setMoveNewTopicName('');
    if (cleanNewSec) setMoveTargetSection('');
  };

  const handleBulkBoxUpdate = (action: 'reset' | 'master' | 'flag' | 'unflag' | 'swap') => {
    if (targetBulkCardIds.length === 0) return;
    const ids = new Set(targetBulkCardIds);
    const now = Date.now();
    onUpdateWorkspace((prev) => ({
      ...prev,
      flashcards: prev.flashcards.map((c) => {
        if (!ids.has(c.id)) return c;
        if (action === 'reset') return { ...c, box: 1, dueAt: now };
        if (action === 'master') {
          return { ...c, box: 5, dueAt: now + 16 * 86400000, lastReviewedAt: now };
        }
        if (action === 'flag') return { ...c, flagged: true };
        if (action === 'unflag') return { ...c, flagged: false };
        return { ...c, q: c.a, a: c.q };
      }),
      updatedAt: new Date().toISOString(),
    }));
    const verb =
      action === 'reset'
        ? 'Reset to Box 1 (due now)'
        : action === 'master'
        ? 'Marked mastered (Box 5)'
        : action === 'flag'
        ? 'Flagged'
        : action === 'unflag'
        ? 'Unflagged'
        : 'Swapped Front ↔ Back on';
    setMoveFeedback(`${verb} ${ids.size} card${ids.size === 1 ? '' : 's'}.`);
  };

  const handleBulkDeleteSelected = () => {
    if (selectedManageIds.size === 0) return;
    const ids = new Set(selectedManageIds);
    onUpdateWorkspace((prev) => ({
      ...prev,
      flashcards: prev.flashcards.filter((c) => !ids.has(c.id)),
      updatedAt: new Date().toISOString(),
    }));
    setQueue((prev) => prev.filter((id) => !ids.has(id)));
    setSelectedManageIds(new Set());
    setConfirmBulkDelete(false);
    setMoveFeedback(`Deleted ${ids.size} selected card${ids.size === 1 ? '' : 's'}.`);
  };

  const handleRenameSection = (cardIds: string[], nextName: string) => {
    const clean = nextName.trim();
    if (!clean || cardIds.length === 0) {
      setRenamingSectionKey(null);
      return;
    }
    const idSet = new Set(cardIds);
    onUpdateWorkspace((prev) => ({
      ...prev,
      flashcards: prev.flashcards.map((c) =>
        idSet.has(c.id) ? { ...c, sectionName: clean } : c
      ),
      updatedAt: new Date().toISOString(),
    }));
    setRenamingSectionKey(null);
    setRenameSectionDraft('');
    setMoveFeedback(`Renamed section to "${clean}" (${cardIds.length} cards).`);
  };

  const handleExportVisibleTsv = () => {
    if (manageFilteredCards.length === 0) return;
    const rows = manageFilteredCards.map((c) => {
      const clean = (s: string) => s.replace(/\t|\r?\n/g, ' ').trim();
      return `${clean(c.q)}\t${clean(c.a)}\t${clean(c.sectionName || 'Core Deck')}`;
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `studydeck-cards-${new Date().toISOString().slice(0, 10)}.tsv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setMoveFeedback(`Exported ${manageFilteredCards.length} cards as TSV.`);
  };

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
                {topicCardsSummary.length > 0 && (
                  <select
                    aria-label="Split by topic"
                    value={selectedTopicFilter}
                    onChange={(e) => {
                      setSelectedTopicFilter(e.target.value);
                      setSelectedSections([]);
                    }}
                    className="sd-input w-auto max-w-[230px] py-1.5 text-xs font-semibold"
                  >
                    <option value="ALL">All Topics ({subjectCards.length})</option>
                    {topicCardsSummary.map((tp) => (
                      <option key={tp.topicId} value={tp.topicId}>
                        {tp.topicName} ({tp.count})
                      </option>
                    ))}
                  </select>
                )}
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
                    onClick={() => {
                      const activeTopicObj =
                        selectedTopicFilter !== 'ALL' && selectedTopicFilter !== '__unassigned__'
                          ? topicById.get(selectedTopicFilter)
                          : undefined;
                      const shareSubjId =
                        selectedSubjectId && selectedSubjectId !== 'ALL'
                          ? selectedSubjectId
                          : activeTopicObj?.subjectId ||
                            subjectCards[0]?.subjectId ||
                            workspace.subjects[0]?.id ||
                            '';
                      onShareDeck(
                        shareSubjId,
                        'ALL',
                        selectedTopicFilter !== 'ALL' ? selectedTopicFilter : 'ALL'
                      );
                    }}
                    className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                  >
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>
                      {selectedTopicFilter !== 'ALL' ? 'Share Topic' : 'Share'}
                    </span>
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

                {/* Topic-Split & Sections Grid */}
                <div className="sd-card space-y-4 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="font-display text-base font-bold text-[var(--ink)]">
                        Split by Topic &amp; Deck Sections
                      </h2>
                      <p className="text-xs text-[var(--mute)]">
                        Pick a single topic (e.g. USA 1919–1941 in History) or mix specific sections.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
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

                  {/* Quick Topic Filter Strip */}
                  {topicCardsSummary.length > 1 && (
                    <div className="flex flex-wrap gap-1.5 border-b border-[var(--line)] pb-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTopicFilter('ALL');
                          setSelectedSections([]);
                        }}
                        className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                          selectedTopicFilter === 'ALL'
                            ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] text-[var(--e3)]'
                            : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                        }`}
                      >
                        All Topics ({subjectCards.length})
                      </button>
                      {topicCardsSummary.map((tp) => {
                        const active = selectedTopicFilter === tp.topicId;
                        return (
                          <button
                            key={tp.topicId}
                            type="button"
                            onClick={() => {
                              setSelectedTopicFilter(tp.topicId);
                              setSelectedSections([]);
                            }}
                            className={`cursor-pointer rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                              active
                                ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] text-[var(--e3)]'
                                : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)] hover:text-[var(--ink)]'
                            }`}
                          >
                            {tp.topicName}{' '}
                            <span className="font-mono-num opacity-75">({tp.count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Sections Grouped by Topic */}
                  <div className="space-y-4">
                    {topicGroupedBuckets.map((grp) => {
                      const groupKeys = grp.buckets.map((b) => b.key);
                      const allGroupSelected = groupKeys.every((k) => selectedSections.includes(k));
                      return (
                        <div key={grp.topicId} className="space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: grp.color }}
                                aria-hidden="true"
                              />
                              <span className="font-display text-sm font-bold text-[var(--ink)]">
                                {grp.topicName}
                              </span>
                              <span className="font-mono-num text-xs text-[var(--mute)]">
                                · {grp.subjectName} · {grp.totalCards} cards
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {topicGroupedBuckets.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedSections(groupKeys)}
                                  className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
                                >
                                  Only this topic
                                </button>
                              )}
                              <span className="text-[var(--line)]">·</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedSections((prev) =>
                                    allGroupSelected
                                      ? prev.filter((k) => !groupKeys.includes(k))
                                      : Array.from(new Set([...prev, ...groupKeys]))
                                  )
                                }
                                className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)] whitespace-nowrap"
                              >
                                {allGroupSelected ? 'Deselect' : 'Select'}
                              </button>
                              <span className="text-[var(--line)]">·</span>
                              <button
                                type="button"
                                onClick={() =>
                                  onShareDeck(
                                    grp.buckets[0]?.subjectId ||
                                      (selectedSubjectId !== 'ALL'
                                        ? selectedSubjectId
                                        : workspace.subjects[0]?.id || ''),
                                    'ALL',
                                    grp.topicId
                                  )
                                }
                                className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-[var(--mute)] hover:text-[var(--e3)] whitespace-nowrap"
                              >
                                <Share2 className="h-3 w-3" aria-hidden="true" />
                                <span>Share</span>
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                            {grp.buckets.map((b) => {
                              const active = selectedSections.includes(b.key);
                              const mastered = b.cards.filter((c) => c.box >= 4).length;
                              const pct = Math.round(
                                (mastered / Math.max(1, b.cards.length)) * 100
                              );
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
                                    <span className="text-sm font-bold text-[var(--ink)]">
                                      {b.name}
                                    </span>
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
                                    {b.cards.length} cards · {mastered} mastered
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

        {/* BROWSE & MANAGE SCREEN (Original Tree Browser + Multi-Select + Quick Add) */}
        {screen === 'manage' && (() => {
          const allVisibleSelected =
            manageFilteredCards.length > 0 &&
            manageFilteredCards.every((c) => selectedManageIds.has(c.id));
          const nowMsManage = Date.now();
          const activeSelCount = selectedManageIds.size;

          const renderManageCardRow = (card: StudyFlashcard, showTopicAndSection = true) => {
            const topicName = topicById.get(card.topicId)?.name || 'General';
            const checked = selectedManageIds.has(card.id);
            const isDue = card.dueAt <= nowMsManage;
            const daysUntilDue = Math.max(1, Math.ceil((card.dueAt - nowMsManage) / 86400000));

            return (
              <div
                key={card.id}
                className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm transition-colors ${
                  checked ? 'bg-[color-mix(in_srgb,var(--e3)_7%,var(--card))]' : ''
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedManageIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(card.id)) next.delete(card.id);
                        else next.add(card.id);
                        return next;
                      })
                    }
                    aria-label={checked ? 'Deselect card' : 'Select card'}
                    className="mt-0.5 shrink-0 cursor-pointer text-[var(--mute)] hover:text-[var(--e3)]"
                  >
                    {checked ? (
                      <CheckSquare className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                    ) : (
                      <Square className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-semibold text-[var(--ink)]">{card.q}</div>
                    <div className="text-xs leading-relaxed text-[var(--mute)]">{card.a}</div>
                    <div className="font-mono-num flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--mute)]">
                      {showTopicAndSection && (
                        <>
                          <span className="font-semibold text-[var(--e3)]">{topicName}</span>
                          <span aria-hidden="true">·</span>
                          <span>{card.sectionName}</span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      <span
                        className={
                          card.box >= 4
                            ? 'font-semibold text-[var(--ok)]'
                            : card.box <= 2
                            ? 'font-semibold text-[var(--e2)]'
                            : ''
                        }
                      >
                        Box {card.box}/5
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{isDue ? 'Due now' : `Due in ${daysUntilDue}d`}</span>
                      {card.flagged && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[var(--e2)]">Flagged</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  {card.box > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateWorkspace((prev) => ({
                          ...prev,
                          flashcards: prev.flashcards.map((c) =>
                            c.id === card.id ? { ...c, box: 1, dueAt: Date.now() } : c
                          ),
                          updatedAt: new Date().toISOString(),
                        }))
                      }
                      title="Reset progress to Box 1 (due now)"
                      aria-label="Reset progress to Box 1"
                      className="sd-btn h-8 w-8 p-0 text-[var(--mute)] hover:text-[var(--ink)]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleFlagCard(card.id)}
                    aria-label="Toggle flag"
                    title="Flag card"
                    className={`sd-btn h-8 w-8 p-0 ${
                      card.flagged ? 'border-[var(--e2)] text-[var(--e2)]' : 'text-[var(--mute)]'
                    }`}
                  >
                    <Flag className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditModalCardId(card.id);
                      setEditQ(card.q);
                      setEditA(card.a);
                      setEditTopicId(card.topicId);
                      setEditSectionName(card.sectionName);
                    }}
                    aria-label="Edit card"
                    title="Edit card"
                    className="sd-btn h-8 w-8 p-0"
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCard(card.id)}
                    aria-label="Delete card"
                    title="Delete card"
                    className="sd-btn h-8 w-8 p-0 text-[var(--bad)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          };

          return (
            <div className="space-y-4">
              {/* Top Manage Header */}
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
                      Card Browser &amp; Manager
                    </h1>
                    <p className="text-xs text-[var(--mute)]">
                      Organize cards by Topic &amp; Section, multi-select to split or reset progress, or batch-paste new cards.
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="sd-seg" role="tablist" aria-label="Manage mode">
                    <button
                      type="button"
                      aria-pressed={manageSubTab === 'browse'}
                      onClick={() => setManageSubTab('browse')}
                      className="sd-seg-btn"
                    >
                      Browse ({subjectCards.length})
                    </button>
                    <button
                      type="button"
                      aria-pressed={manageSubTab === 'add'}
                      onClick={() => setManageSubTab('add')}
                      className="sd-seg-btn"
                    >
                      + Add Cards
                    </button>
                  </div>

                  {manageFilteredCards.length > 0 && (
                    <button
                      type="button"
                      onClick={handleExportVisibleTsv}
                      className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Export TSV</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onOpenImport}
                    className="sd-btn px-3.5 py-1.5 text-xs whitespace-nowrap"
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Full Importer</span>
                  </button>
                </div>
              </div>

              {moveFeedback && (
                <div
                  role="status"
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ok)] bg-[color-mix(in_srgb,var(--ok)_9%,var(--card))] px-4 py-2.5 text-xs font-semibold text-[var(--ink)]"
                >
                  <span>{moveFeedback}</span>
                  <button
                    type="button"
                    onClick={() => setMoveFeedback(null)}
                    aria-label="Dismiss message"
                    className="cursor-pointer text-[var(--mute)] hover:text-[var(--ink)]"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}

              {/* ADD CARDS TAB */}
              {manageSubTab === 'add' && (
                <div className="grid gap-5 lg:grid-cols-2">
                  <form onSubmit={handleAddSingleCard} className="sd-card space-y-3 p-5">
                    <h2 className="font-display text-lg font-bold text-[var(--ink)]">
                      Add Single Card
                    </h2>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block text-xs font-semibold text-[var(--mute)]">
                        Topic
                        <select
                          value={newTopicId}
                          onChange={(e) => setNewTopicId(e.target.value)}
                          className="sd-input mt-1 text-xs"
                        >
                          {subjectTopicsList.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                          <option value="__new__">+ New Topic…</option>
                        </select>
                      </label>
                      <label className="block text-xs font-semibold text-[var(--mute)]">
                        Section / Sub-deck
                        <input
                          type="text"
                          value={newSec}
                          onChange={(e) => setNewSec(e.target.value)}
                          placeholder="e.g. Wall Street Crash"
                          className="sd-input mt-1 text-xs"
                        />
                      </label>
                    </div>
                    {newTopicId === '__new__' && (
                      <label className="block text-xs font-semibold text-[var(--mute)]">
                        New Topic Name *
                        <input
                          type="text"
                          required
                          value={newTopicCustomName}
                          onChange={(e) => setNewTopicCustomName(e.target.value)}
                          placeholder="e.g. USA 1919–1941"
                          className="sd-input mt-1 text-xs"
                        />
                      </label>
                    )}
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
                        rows={3}
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
                      Saves into your selected Topic &amp; Section on the left. Paste one card per line
                      separated by <code>|</code>, <code>::</code>, or Tab.
                    </p>
                    <textarea
                      rows={7}
                      value={quickBatchRaw}
                      onChange={(e) => setQuickBatchRaw(e.target.value)}
                      placeholder={
                        'Mitochondria | Site of aerobic respiration\nRibosome | Site of protein synthesis'
                      }
                      className="sd-input font-mono-num text-xs"
                    />
                    <button type="submit" className="sd-btn-pri px-4 py-2 text-xs">
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Add All Lines</span>
                    </button>
                  </form>
                </div>
              )}

              {/* BROWSE & ORGANIZE TAB */}
              {manageSubTab === 'browse' && (
                <div className="space-y-4">
                  {/* Filters, Sort & View Controls */}
                  <div className="sd-card space-y-3 p-4">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
                      <select
                        aria-label="Filter by subject"
                        value={selectedSubjectId || 'ALL'}
                        onChange={(e) => onSelectSubjectId(e.target.value)}
                        className="sd-input py-1.5 text-xs font-semibold"
                      >
                        <option value="ALL">All Subjects ({workspace.flashcards.length})</option>
                        {workspace.subjects.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Filter by topic"
                        value={manageTopicFilter}
                        onChange={(e) => {
                          setManageTopicFilter(e.target.value);
                          setManageSectionFilter('ALL');
                        }}
                        className="sd-input py-1.5 text-xs font-semibold"
                      >
                        <option value="ALL">All Topics</option>
                        {subjectTopicsList.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                        <option value="__unassigned__">General / Unassigned</option>
                      </select>

                      <select
                        aria-label="Filter by section"
                        value={manageSectionFilter}
                        onChange={(e) => setManageSectionFilter(e.target.value)}
                        className="sd-input py-1.5 text-xs"
                      >
                        <option value="ALL">All Sections ({manageAvailableSections.length})</option>
                        {manageAvailableSections.map((sec) => (
                          <option key={sec} value={sec}>
                            {sec}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Filter by card status"
                        value={manageFilter}
                        onChange={(e) =>
                          setManageFilter(
                            e.target.value as 'all' | 'due' | 'weak' | 'mid' | 'flagged' | 'mastered'
                          )
                        }
                        className="sd-input py-1.5 text-xs"
                      >
                        <option value="all">All Statuses</option>
                        <option value="due">Due Now</option>
                        <option value="weak">Learning (Box 1–2)</option>
                        <option value="mid">Reviewing (Box 3)</option>
                        <option value="mastered">Mastered (Box 4–5)</option>
                        <option value="flagged">Flagged Only</option>
                      </select>

                      <select
                        aria-label="Sort cards"
                        value={manageSort}
                        onChange={(e) =>
                          setManageSort(
                            e.target.value as 'orig' | 'box-asc' | 'box-desc' | 'due' | 'az'
                          )
                        }
                        className="sd-input py-1.5 text-xs"
                      >
                        <option value="orig">Sort: Topic &amp; Section</option>
                        <option value="box-asc">Sort: Weakest first (Box ↑)</option>
                        <option value="box-desc">Sort: Strongest first (Box ↓)</option>
                        <option value="due">Sort: Due soonest</option>
                        <option value="az">Sort: A → Z</option>
                      </select>

                      <div className="relative">
                        <Search
                          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                          aria-hidden="true"
                        />
                        <input
                          type="text"
                          value={manageSearch}
                          onChange={(e) => setManageSearch(e.target.value)}
                          placeholder="Search cards…"
                          className="sd-input py-1.5 pl-8 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (allVisibleSelected) {
                              setSelectedManageIds(new Set());
                            } else {
                              setSelectedManageIds(new Set(manageFilteredCards.map((c) => c.id)));
                            }
                          }}
                          className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                        >
                          {allVisibleSelected ? 'Clear Selection' : `Select All (${manageFilteredCards.length})`}
                        </button>
                        {activeSelCount > 0 && !allVisibleSelected && (
                          <button
                            type="button"
                            onClick={() => setSelectedManageIds(new Set())}
                            className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)]"
                          >
                            Deselect ({activeSelCount})
                          </button>
                        )}
                        <span className="font-mono-num text-[var(--mute)]">
                          Showing {manageFilteredCards.length} of {subjectCards.length}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {manageLayout === 'grouped' && manageGroupedTree.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={() => setCollapsedManageGroups(new Set())}
                              className="cursor-pointer text-xs font-semibold text-[var(--e3)] hover:underline"
                            >
                              Expand all
                            </button>
                            <span className="text-[var(--line)]">·</span>
                            <button
                              type="button"
                              onClick={() => {
                                const allKeys = new Set<string>();
                                manageGroupedTree.forEach((tg) =>
                                  tg.sectionList.forEach((sec) => allKeys.add(sec.key))
                                );
                                setCollapsedManageGroups(allKeys);
                              }}
                              className="cursor-pointer text-xs font-semibold text-[var(--mute)] hover:text-[var(--ink)]"
                            >
                              Collapse all
                            </button>
                          </>
                        )}
                        <div className="sd-seg" role="group" aria-label="Browser layout">
                          <button
                            type="button"
                            aria-pressed={manageLayout === 'grouped'}
                            onClick={() => setManageLayout('grouped')}
                            className="sd-seg-btn px-2.5 py-0.5 text-xs"
                          >
                            Grouped
                          </button>
                          <button
                            type="button"
                            aria-pressed={manageLayout === 'flat'}
                            onClick={() => setManageLayout('flat')}
                            className="sd-seg-btn px-2.5 py-0.5 text-xs"
                          >
                            Flat List
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Multi-Select / Split & Bulk Actions Toolbar */}
                  {manageFilteredCards.length > 0 && (
                    <div className="sd-card space-y-2.5 bg-[color-mix(in_srgb,var(--e3)_4%,var(--card))] p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-[var(--ink)]">
                          {activeSelCount > 0
                            ? `${activeSelCount} selected card${activeSelCount === 1 ? '' : 's'}`
                            : `Bulk action on all ${manageFilteredCards.length} matching card${manageFilteredCards.length === 1 ? '' : 's'}`}
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleBulkBoxUpdate('reset')}
                            className="sd-btn px-2.5 py-1 text-[11px] whitespace-nowrap"
                          >
                            <RotateCcw className="h-3 w-3" aria-hidden="true" />
                            <span>Reset to Box 1</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBulkBoxUpdate('master')}
                            className="sd-btn px-2.5 py-1 text-[11px] whitespace-nowrap"
                          >
                            <CheckCircle2 className="h-3 w-3 text-[var(--ok)]" aria-hidden="true" />
                            <span>Mark Mastered</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBulkBoxUpdate('flag')}
                            className="sd-btn px-2.5 py-1 text-[11px] whitespace-nowrap"
                          >
                            <Flag className="h-3 w-3 text-[var(--e2)]" aria-hidden="true" />
                            <span>Flag</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBulkBoxUpdate('swap')}
                            className="sd-btn px-2.5 py-1 text-[11px] whitespace-nowrap"
                          >
                            <ArrowLeftRight className="h-3 w-3" aria-hidden="true" />
                            <span>Swap Q↔A</span>
                          </button>
                          {activeSelCount > 0 && (
                            confirmBulkDelete ? (
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={handleBulkDeleteSelected}
                                  className="sd-btn border-[var(--bad)] bg-[var(--bad)] px-2.5 py-1 text-[11px] text-white whitespace-nowrap"
                                >
                                  Confirm Delete ({activeSelCount})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmBulkDelete(false)}
                                  className="sd-btn px-2 py-1 text-[11px]"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmBulkDelete(true)}
                                className="sd-btn border-[var(--bad)] px-2.5 py-1 text-[11px] text-[var(--bad)] whitespace-nowrap"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                                <span>Delete ({activeSelCount})</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-2.5">
                        <span className="font-semibold text-[var(--mute)]">
                          Split / move into topic:
                        </span>
                        <select
                          aria-label="Destination topic"
                          value={moveTargetTopicId}
                          onChange={(e) => setMoveTargetTopicId(e.target.value)}
                          className="sd-input w-auto max-w-[200px] py-1 text-xs"
                        >
                          {subjectTopicsList.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                          <option value="__new__">+ New Topic…</option>
                        </select>
                        {moveTargetTopicId === '__new__' && (
                          <input
                            type="text"
                            value={moveNewTopicName}
                            onChange={(e) => setMoveNewTopicName(e.target.value)}
                            placeholder="New topic name…"
                            className="sd-input w-40 py-1 text-xs"
                          />
                        )}
                        <input
                          type="text"
                          value={moveTargetSection}
                          onChange={(e) => setMoveTargetSection(e.target.value)}
                          placeholder="Section (optional)…"
                          className="sd-input w-40 py-1 text-xs"
                        />
                        <button
                          type="button"
                          disabled={moveTargetTopicId === '__new__' && !moveNewTopicName.trim()}
                          onClick={handleMoveTargetCardsToTopic}
                          className="sd-btn-pri px-3 py-1 text-xs whitespace-nowrap"
                        >
                          Move {activeSelCount > 0 ? activeSelCount : targetBulkCardIds.length} Card
                          {targetBulkCardIds.length === 1 ? '' : 's'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* GROUPED TREE VIEW (Subject -> Topic -> Collapsible Sections) */}
                  {manageFilteredCards.length === 0 ? (
                    <div className="sd-card p-8 text-center text-xs text-[var(--mute)]">
                      No cards match your current filter. Try clearing search or switching to + Add Cards.
                    </div>
                  ) : manageLayout === 'grouped' ? (
                    <div className="space-y-4">
                      {manageGroupedTree.map((tg) => (
                        <div key={tg.topicId} className="sd-card overflow-hidden">
                          {/* Topic Group Header */}
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] bg-[var(--bg)] px-5 py-3">
                            <div className="flex items-center gap-2.5">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: tg.color }}
                                aria-hidden="true"
                              />
                              <span className="font-display text-base font-bold text-[var(--ink)]">
                                {tg.topicName}
                              </span>
                              <span className="font-mono-num text-xs text-[var(--mute)]">
                                · {tg.subjectName} · {tg.totalCards} cards · {tg.dueCards} due
                              </span>
                            </div>
                          </div>

                          {/* Sections Inside Topic */}
                          <div className="divide-y divide-[var(--line)]">
                            {tg.sectionList.map((sec) => {
                              const isCollapsed = collapsedManageGroups.has(sec.key);
                              const secCardIds = sec.cards.map((c) => c.id);
                              const secAllSelected =
                                secCardIds.length > 0 &&
                                secCardIds.every((id) => selectedManageIds.has(id));
                              const masteredCnt = sec.cards.filter((c) => c.box >= 4).length;
                              const masteryPct = Math.round(
                                (masteredCnt / Math.max(1, sec.cards.length)) * 100
                              );
                              const isRenaming = renamingSectionKey === sec.key;

                              return (
                                <div key={sec.key}>
                                  <div className="flex flex-wrap items-center justify-between gap-2 bg-[color-mix(in_srgb,var(--bg)_45%,var(--card))] px-4 py-2.5">
                                    <div className="flex min-w-0 flex-1 items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setCollapsedManageGroups((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(sec.key)) next.delete(sec.key);
                                            else next.add(sec.key);
                                            return next;
                                          })
                                        }
                                        className="flex min-w-0 cursor-pointer items-center gap-1.5 text-left"
                                      >
                                        {isCollapsed ? (
                                          <ChevronRight className="h-4 w-4 shrink-0 text-[var(--mute)]" aria-hidden="true" />
                                        ) : (
                                          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--mute)]" aria-hidden="true" />
                                        )}
                                        {!isRenaming && (
                                          <span className="truncate text-sm font-bold text-[var(--ink)]">
                                            {sec.sectionName}
                                          </span>
                                        )}
                                      </button>

                                      {isRenaming ? (
                                        <form
                                          onSubmit={(e) => {
                                            e.preventDefault();
                                            handleRenameSection(secCardIds, renameSectionDraft);
                                          }}
                                          className="flex items-center gap-1.5"
                                        >
                                          <input
                                            type="text"
                                            autoFocus
                                            value={renameSectionDraft}
                                            onChange={(e) => setRenameSectionDraft(e.target.value)}
                                            className="sd-input w-48 py-1 text-xs font-bold"
                                          />
                                          <button type="submit" className="sd-btn-pri px-2.5 py-1 text-[11px]">
                                            Save
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => setRenamingSectionKey(null)}
                                            className="sd-btn px-2 py-1 text-[11px]"
                                          >
                                            Cancel
                                          </button>
                                        </form>
                                      ) : (
                                        <span className="font-mono-num text-[11px] text-[var(--mute)] whitespace-nowrap">
                                          {sec.cards.length} cards · {masteryPct}% mastered
                                        </span>
                                      )}
                                    </div>

                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => launchSession(sec.cards)}
                                        className="sd-btn px-2.5 py-1 text-[11px] whitespace-nowrap"
                                      >
                                        <Play className="h-3 w-3 text-[var(--e3)]" aria-hidden="true" />
                                        <span>Study</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (tg.topicId !== '__unassigned__') {
                                            setNewTopicId(tg.topicId);
                                          }
                                          setNewSec(sec.sectionName);
                                          setManageSubTab('add');
                                        }}
                                        className="sd-btn px-2.5 py-1 text-[11px] whitespace-nowrap"
                                      >
                                        <Plus className="h-3 w-3" aria-hidden="true" />
                                        <span>Add</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setRenamingSectionKey(sec.key);
                                          setRenameSectionDraft(sec.sectionName);
                                        }}
                                        className="sd-btn px-2.5 py-1 text-[11px] whitespace-nowrap"
                                      >
                                        Rename
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setSelectedManageIds((prev) => {
                                            const next = new Set(prev);
                                            if (secAllSelected) {
                                              secCardIds.forEach((id) => next.delete(id));
                                            } else {
                                              secCardIds.forEach((id) => next.add(id));
                                            }
                                            return next;
                                          })
                                        }
                                        className="sd-btn px-2.5 py-1 text-[11px] whitespace-nowrap"
                                      >
                                        {secAllSelected ? 'Unselect' : 'Select'}
                                      </button>
                                    </div>
                                  </div>

                                  {!isCollapsed && (
                                    <div className="divide-y divide-[var(--line)]">
                                      {sec.cards.map((card) => renderManageCardRow(card, false))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* FLAT LIST VIEW */
                    <div className="sd-card divide-y divide-[var(--line)] overflow-hidden">
                      {manageFilteredCards.map((card) => renderManageCardRow(card, true))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
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
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Topic
                <select
                  value={editTopicId}
                  onChange={(e) => setEditTopicId(e.target.value)}
                  className="sd-input mt-1 text-xs"
                >
                  {workspace.topics.map((t) => (
                    <option key={t.id} value={t.id}>
                      {subjById.get(t.subjectId)?.name || 'Subject'} — {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold text-[var(--mute)]">
                Section
                <input
                  type="text"
                  value={editSectionName}
                  onChange={(e) => setEditSectionName(e.target.value)}
                  className="sd-input mt-1 text-xs"
                />
              </label>
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
