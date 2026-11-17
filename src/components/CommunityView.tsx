import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  BookMarked,
  BookOpen,
  Calendar,
  Check,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Layers,
  Link2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  copySharedItemIntoWorkspace,
  copySharedSubjectTopicIntoWorkspace,
  deleteSharedItem,
  fetchPublicSharedItems,
  fetchUserSharedItems,
  incrementSharedCopyCount,
  lookupSharedItemByCode,
} from '../lib/communityService';
import {
  SharedItemType,
  SharedStudyItem,
  StructuredNoteData,
  TimelineEventItem,
  WorkspaceData,
} from '../types';

export type CommunityTypeFilter = 'all' | SharedItemType;

interface CommunityViewProps {
  workspace: WorkspaceData;
  firebaseUser: User | null;
  initialShareCode?: string | null;
  initialTypeFilter?: CommunityTypeFilter | null;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onOpenAuth: () => void;
  onRequestClearInitialShareCode?: () => void;
  onRequestClearInitialTypeFilter?: () => void;
  onOpenCopiedNotes?: (subjectId: string, topicId?: string) => void;
  onOpenCopiedFlashcards?: (subjectId: string) => void;
}

function renderInlineBold(text: string) {
  const parts = String(text || '').split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-[var(--ink)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function StructuredNoteReader({
  notes,
  timelineEvents,
}: {
  notes: StructuredNoteData;
  timelineEvents?: TimelineEventItem[];
}) {
  const hasSections = notes.sections.some((s) => s.points.length > 0 || s.heading.trim());
  const hasAnyContent =
    Boolean(notes.summary.trim()) ||
    hasSections ||
    notes.keyTerms.length > 0 ||
    Boolean(notes.workedExample.trim()) ||
    Boolean(notes.examTip.trim()) ||
    Boolean(timelineEvents && timelineEvents.length > 0) ||
    Boolean(notes.legacyHtml);

  if (!hasAnyContent) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-5 text-center text-xs text-[var(--mute)]">
        This topic does not have written notes yet.
      </div>
    );
  }

  return (
    <div className="space-y-4 text-sm leading-relaxed">
      {notes.summary.trim() && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--e3)]">
            Topic Overview
          </div>
          <p className="mt-1 text-[var(--ink)]">{renderInlineBold(notes.summary)}</p>
        </div>
      )}

      {notes.sections.map((sec) => {
        if (!sec.heading.trim() && sec.points.length === 0) return null;
        return (
          <div
            key={sec.id}
            className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4"
          >
            <h3 className="font-display text-base font-bold text-[var(--ink)]">
              {sec.heading || 'Key Points'}
            </h3>
            {sec.points.length > 0 && (
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[13px] text-[var(--ink)]">
                {sec.points.map((pt, i) => (
                  <li key={i}>{renderInlineBold(pt)}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}

      {notes.keyTerms.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg)]">
          <div className="border-b border-[var(--line)] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
            Key Terms &amp; Definitions ({notes.keyTerms.length})
          </div>
          <div className="divide-y divide-[var(--line)]">
            {notes.keyTerms.map((kt) => (
              <div key={kt.id} className="grid gap-1.5 px-4 py-2.5 text-xs sm:grid-cols-3">
                <div className="font-bold text-[var(--ink)]">{kt.term}</div>
                <div className="text-[var(--mute)] sm:col-span-2">{kt.definition}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {notes.workedExample.trim() && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ok)]">
            Worked Example
          </div>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[var(--ink)]">
            {renderInlineBold(notes.workedExample)}
          </p>
        </div>
      )}

      {notes.examTip.trim() && (
        <div className="rounded-xl border border-[var(--e2)] bg-[var(--bg)] p-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--e2)]">
            Examiner Tip
          </div>
          <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[var(--ink)]">
            {renderInlineBold(notes.examTip)}
          </p>
        </div>
      )}

      {timelineEvents && timelineEvents.length > 0 && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--e3)]">
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Timeline Events ({timelineEvents.length})</span>
          </div>
          <div className="space-y-2">
            {timelineEvents.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 text-xs">
                <span className="font-mono-num shrink-0 rounded border border-[var(--line)] bg-[var(--card)] px-2 py-0.5 font-bold text-[var(--e3)]">
                  {ev.date}
                </span>
                <div>
                  <div className="font-bold text-[var(--ink)]">{ev.title}</div>
                  {ev.detail && <div className="text-[var(--mute)]">{ev.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function CommunityView({
  workspace,
  firebaseUser,
  initialShareCode,
  initialTypeFilter,
  onUpdateWorkspace,
  onOpenAuth,
  onRequestClearInitialShareCode,
  onRequestClearInitialTypeFilter,
  onOpenCopiedNotes,
  onOpenCopiedFlashcards,
}: CommunityViewProps) {
  const [publicItems, setPublicItems] = useState<SharedStudyItem[]>([]);
  const [myItems, setMyItems] = useState<SharedStudyItem[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(true);
  const [loadingMine, setLoadingMine] = useState(false);
  const [viewMode, setViewMode] = useState<'community' | 'mine'>('community');
  const [typeFilter, setTypeFilter] = useState<CommunityTypeFilter>(initialTypeFilter || 'all');
  const [searchQuery, setSearchQuery] = useState('');

  const [codeInput, setCodeInput] = useState(initialShareCode || '');
  const [codeSearching, setCodeSearching] = useState(false);
  const [previewItem, setPreviewItem] = useState<SharedStudyItem | null>(null);
  const [previewTopicIdx, setPreviewTopicIdx] = useState<number>(0);
  const [previewCardSearch, setPreviewCardSearch] = useState('');
  const [statusBanner, setStatusBanner] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (initialTypeFilter) {
      setTypeFilter(initialTypeFilter);
      onRequestClearInitialTypeFilter?.();
    }
  }, [initialTypeFilter, onRequestClearInitialTypeFilter]);

  useEffect(() => {
    setPreviewTopicIdx(0);
    setPreviewCardSearch('');
  }, [previewItem?.id]);

  const loadPublic = useCallback(async (force = false) => {
    setLoadingPublic(true);
    try {
      const list = await fetchPublicSharedItems(force);
      setPublicItems(list);
    } catch (err) {
      setStatusBanner({
        ok: false,
        msg: err instanceof Error ? err.message : 'Could not load community library.',
      });
    } finally {
      setLoadingPublic(false);
    }
  }, []);

  const loadMine = useCallback(async () => {
    if (!firebaseUser) {
      setMyItems([]);
      return;
    }
    setLoadingMine(true);
    try {
      const list = await fetchUserSharedItems(firebaseUser.uid);
      setMyItems(list);
    } catch (err) {
      setStatusBanner({
        ok: false,
        msg: err instanceof Error ? err.message : 'Could not load your shared links.',
      });
    } finally {
      setLoadingMine(false);
    }
  }, [firebaseUser]);

  useEffect(() => {
    void loadPublic(false);
  }, [loadPublic]);

  useEffect(() => {
    if (viewMode === 'mine') {
      void loadMine();
    }
  }, [viewMode, loadMine]);

  useEffect(() => {
    if (!initialShareCode) return;
    setCodeInput(initialShareCode);
    setCodeSearching(true);
    void lookupSharedItemByCode(initialShareCode)
      .then((found) => {
        if (found) {
          setPreviewItem(found);
          setStatusBanner(null);
        } else {
          setStatusBanner({
            ok: false,
            msg: `No shared notes, deck, or subject found for code "${initialShareCode}".`,
          });
        }
      })
      .catch((err) => {
        setStatusBanner({
          ok: false,
          msg: err instanceof Error ? err.message : 'Lookup failed.',
        });
      })
      .finally(() => {
        setCodeSearching(false);
        onRequestClearInitialShareCode?.();
      });
  }, [initialShareCode, onRequestClearInitialShareCode]);

  const handleCodeLookup = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = codeInput.trim().toUpperCase();
    if (!cleaned) return;
    setCodeSearching(true);
    setStatusBanner(null);
    try {
      const found = await lookupSharedItemByCode(cleaned);
      if (found) {
        setPreviewItem(found);
      } else {
        setStatusBanner({
          ok: false,
          msg: `No shared item matches code "${cleaned}". Check the 6-character code and try again.`,
        });
      }
    } catch (err) {
      setStatusBanner({
        ok: false,
        msg: err instanceof Error ? err.message : 'Code lookup failed.',
      });
    } finally {
      setCodeSearching(false);
    }
  };

  const handleCopyToWorkspace = (item: SharedStudyItem, andOpen = false) => {
    const result = copySharedItemIntoWorkspace(workspace, item);
    onUpdateWorkspace((prev) => copySharedItemIntoWorkspace(prev, item).workspace);
    void incrementSharedCopyCount(item.id);
    setPublicItems((prev) =>
      prev.map((x) => (x.id === item.id ? { ...x, copyCount: x.copyCount + 1 } : x))
    );
    setPreviewItem(null);
    setStatusBanner({ ok: true, msg: result.summary });

    if (andOpen && result.subjectId) {
      if (item.type === 'flashcards') {
        onOpenCopiedFlashcards?.(result.subjectId);
      } else {
        onOpenCopiedNotes?.(result.subjectId, result.topicId);
      }
    }
  };

  const handleCopySingleSubjectTopic = (
    item: SharedStudyItem,
    topicIndex: number,
    andOpen = false
  ) => {
    const result = copySharedSubjectTopicIntoWorkspace(workspace, item, topicIndex);
    onUpdateWorkspace((prev) =>
      copySharedSubjectTopicIntoWorkspace(prev, item, topicIndex).workspace
    );
    void incrementSharedCopyCount(item.id);
    setPublicItems((prev) =>
      prev.map((x) => (x.id === item.id ? { ...x, copyCount: x.copyCount + 1 } : x))
    );
    setPreviewItem(null);
    setStatusBanner({ ok: true, msg: result.summary });

    if (andOpen && result.subjectId) {
      onOpenCopiedNotes?.(result.subjectId, result.topicId);
    }
  };

  const handleCopyShareLink = async (item: SharedStudyItem) => {
    const url = `${window.location.origin}/?share=${item.shareCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((cur) => (cur === item.id ? null : cur)), 2000);
    } catch {
      setStatusBanner({ ok: false, msg: `Copy manually: ${url}` });
    }
  };

  const handleDeleteMine = async (id: string) => {
    try {
      await deleteSharedItem(id);
      setMyItems((prev) => prev.filter((x) => x.id !== id));
      setPublicItems((prev) => prev.filter((x) => x.id !== id));
      if (previewItem?.id === id) setPreviewItem(null);
      setStatusBanner({ ok: true, msg: 'Removed shared link.' });
    } catch (err) {
      setStatusBanner({
        ok: false,
        msg: err instanceof Error ? err.message : 'Could not delete shared link.',
      });
    }
  };

  const activeList = useMemo(() => {
    const base = viewMode === 'mine' ? myItems : publicItems;
    const q = searchQuery.trim().toLowerCase();
    return base.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.subjectName.toLowerCase().includes(q) ||
        item.examBoard.toLowerCase().includes(q) ||
        item.ownerName.toLowerCase().includes(q) ||
        item.shareCode.toLowerCase().includes(q)
      );
    });
  }, [viewMode, myItems, publicItems, typeFilter, searchQuery]);

  const typeLabel = (t: SharedItemType) =>
    t === 'notes' ? 'Notes' : t === 'flashcards' ? 'Flashcards' : 'Full Subject';

  const selectedSubjectTopic =
    previewItem?.type === 'subject' && previewItem.subjectPayload
      ? previewItem.subjectPayload.topics[previewTopicIdx] ||
        previewItem.subjectPayload.topics[0] ||
        null
      : null;

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="mx-auto max-w-[1160px] space-y-6 px-4 py-7 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <h1 className="font-display text-2xl font-extrabold text-[var(--ink)] sm:text-3xl">
              Community &amp; Shared Notes
            </h1>
            <p className="mt-1 text-sm text-[var(--mute)]">
              Read other students&apos; notes directly, copy them into your workspace to edit/revise, or open a 6-character share code.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="sd-seg">
              <button
                type="button"
                aria-pressed={viewMode === 'community'}
                onClick={() => setViewMode('community')}
                className="sd-seg-btn"
              >
                Public Library
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'mine'}
                onClick={() => setViewMode('mine')}
                className="sd-seg-btn"
              >
                My Shared Links
              </button>
            </div>
            <button
              type="button"
              onClick={() => (viewMode === 'mine' ? void loadMine() : void loadPublic(true))}
              className="sd-btn px-3 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loadingPublic || loadingMine ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {statusBanner && (
          <div
            role="status"
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs font-semibold ${
              statusBanner.ok
                ? 'border-[var(--ok)] bg-[var(--card)] text-[var(--ok)]'
                : 'border-[var(--bad)] bg-[var(--card)] text-[var(--bad)]'
            }`}
          >
            <span>{statusBanner.msg}</span>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              aria-label="Dismiss status"
              className="cursor-pointer p-1 text-[var(--mute)] hover:text-[var(--ink)]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Open by 6-char Share Code Bar */}
        <form onSubmit={handleCodeLookup} className="sd-card flex flex-wrap items-center gap-3 p-4">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--ink)]">
            <Link2 className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
            <span>Have a friend&apos;s share code?</span>
          </div>
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
            placeholder="Enter 6-char code (e.g. K7M9P2)"
            maxLength={12}
            className="sd-input font-mono-num w-52 py-1.5 text-xs uppercase tracking-wider"
          />
          <button
            type="submit"
            disabled={codeSearching || !codeInput.trim()}
            className="sd-btn-pri px-4 py-1.5 text-xs whitespace-nowrap shrink-0"
          >
            {codeSearching ? 'Looking up…' : 'Read Shared Item'}
          </button>
        </form>

        {/* Filter & Search Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="sd-seg">
            {(
              [
                ['all', 'All'],
                ['notes', 'Notes'],
                ['flashcards', 'Flashcards'],
                ['subject', 'Full Subjects'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                aria-pressed={typeFilter === val}
                onClick={() => setTypeFilter(val)}
                className="sd-seg-btn"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search title, subject, author…"
              className="sd-input pl-8 py-1.5 text-xs"
            />
          </div>
        </div>

        {/* Content Grid */}
        {viewMode === 'mine' && !firebaseUser ? (
          <div className="sd-card p-8 text-center">
            <Globe className="mx-auto mb-2 h-6 w-6 text-[var(--e3)]" aria-hidden="true" />
            <h2 className="font-display text-lg font-bold text-[var(--ink)]">
              Sign in to manage your shared links
            </h2>
            <p className="mt-1 text-xs text-[var(--mute)]">
              You can read and copy anything from the Public Library right away, and sign in with Google whenever you want to publish a share link.
            </p>
            <button
              type="button"
              onClick={onOpenAuth}
              className="sd-btn-pri mt-4 px-5 py-2 text-xs whitespace-nowrap"
            >
              Sign in with Google
            </button>
          </div>
        ) : (viewMode === 'community' && loadingPublic) || (viewMode === 'mine' && loadingMine) ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="sd-card h-44 animate-pulse p-5" />
            ))}
          </div>
        ) : activeList.length === 0 ? (
          <div className="sd-card p-10 text-center">
            <Globe className="mx-auto mb-2 h-6 w-6 text-[var(--mute)]" aria-hidden="true" />
            <h2 className="font-display text-base font-bold text-[var(--ink)]">
              {viewMode === 'mine' ? 'You have not shared any items yet' : 'No matching shared resources'}
            </h2>
            <p className="mt-1 text-xs text-[var(--mute)]">
              {viewMode === 'mine'
                ? 'Open any Subject, Topic Note, or Flashcard Deck and click Share to generate a 6-character code or public listing.'
                : 'Open any Topic in Study Notes and click Share to publish notes for classmates, or enter a friend’s 6-character code above.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeList.map((item) => {
              const Icon =
                item.type === 'notes'
                  ? BookOpen
                  : item.type === 'flashcards'
                  ? Layers
                  : BookMarked;
              const isMine = firebaseUser?.uid === item.ownerId;
              return (
                <article key={item.id} className="sd-card flex flex-col justify-between p-5">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-[var(--e3)]">
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>{typeLabel(item.type)}</span>
                      </div>
                      <span className="font-mono-num text-[11px] font-bold text-[var(--mute)]">
                        #{item.shareCode}
                      </span>
                    </div>

                    <h2 className="font-display mt-2 text-base font-bold text-[var(--ink)]">
                      {item.title}
                    </h2>
                    <div className="mt-0.5 text-xs font-semibold text-[var(--mute)]">
                      {item.subjectName} · {item.examBoard}
                    </div>
                    {item.summary && (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--mute)]">
                        {item.summary}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 space-y-3 border-t border-[var(--line)] pt-3">
                    <div className="flex items-center justify-between text-[11px] text-[var(--mute)]">
                      <span className="truncate">By {item.ownerName}</span>
                      <span className="font-mono-num shrink-0">
                        {item.itemCount} item{item.itemCount === 1 ? '' : 's'} · {item.copyCount} uses
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewItem(item)}
                        className="sd-btn flex-1 px-3 py-1.5 text-xs whitespace-nowrap"
                      >
                        <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Read &amp; View</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyToWorkspace(item, true)}
                        className="sd-btn-pri flex-1 px-3 py-1.5 text-xs whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Use in Mine</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCopyShareLink(item)}
                        title="Copy share link"
                        aria-label="Copy share link"
                        className="sd-btn h-8 w-8 shrink-0 p-0"
                      >
                        {copiedId === item.id ? (
                          <Check className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </button>
                      {isMine && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteMine(item.id)}
                          title="Delete share"
                          aria-label="Delete share"
                          className="sd-btn h-8 w-8 shrink-0 p-0 text-[var(--bad)]"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Full Reader & Use Modal */}
      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5"
          role="dialog"
          aria-modal="true"
          aria-label={`Read ${previewItem.title}`}
        >
          <div className="sd-card flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-5 py-4">
              <div>
                <div className="font-mono-num text-xs font-bold text-[var(--e3)]">
                  {typeLabel(previewItem.type)} · Code {previewItem.shareCode}
                </div>
                <h2 className="font-display mt-0.5 text-lg font-bold text-[var(--ink)] sm:text-xl">
                  {previewItem.title}
                </h2>
                <div className="text-xs text-[var(--mute)]">
                  {previewItem.subjectName} · {previewItem.examBoard} · Shared by {previewItem.ownerName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                aria-label="Close reader"
                className="sd-btn h-8 w-8 p-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {previewItem.type === 'notes' && previewItem.notesPayload && (
                <StructuredNoteReader
                  notes={previewItem.notesPayload.notes}
                  timelineEvents={previewItem.notesPayload.timelineEvents}
                />
              )}

              {previewItem.type === 'flashcards' && previewItem.flashcardsPayload && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                      All Flashcards ({previewItem.flashcardsPayload.cards.length})
                    </div>
                    <input
                      type="text"
                      value={previewCardSearch}
                      onChange={(e) => setPreviewCardSearch(e.target.value)}
                      placeholder="Filter cards…"
                      className="sd-input w-56 py-1 text-xs"
                    />
                  </div>
                  <div className="space-y-2">
                    {previewItem.flashcardsPayload.cards
                      .filter((c) => {
                        if (!previewCardSearch.trim()) return true;
                        const q = previewCardSearch.trim().toLowerCase();
                        return c.q.toLowerCase().includes(q) || c.a.toLowerCase().includes(q);
                      })
                      .map((c, idx) => (
                        <div
                          key={idx}
                          className="grid gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 text-xs sm:grid-cols-2"
                        >
                          <div>
                            <span className="font-bold text-[var(--e3)]">Q: </span>
                            <span className="font-semibold text-[var(--ink)]">{c.q}</span>
                          </div>
                          <div>
                            <span className="font-bold text-[var(--ok)]">A: </span>
                            <span className="text-[var(--mute)]">{c.a}</span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {previewItem.type === 'subject' && previewItem.subjectPayload && (
                <div className="grid gap-5 md:grid-cols-12">
                  {/* Topics Selector Column */}
                  <div className="space-y-2 md:col-span-4">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--mute)]">
                      Topics ({previewItem.subjectPayload.topics.length}) · Click to read
                    </div>
                    <div className="space-y-1.5">
                      {previewItem.subjectPayload.topics.map((tp, idx) => {
                        const active = idx === previewTopicIdx;
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => setPreviewTopicIdx(idx)}
                            className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${
                              active
                                ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--bg))] font-bold text-[var(--ink)]'
                                : 'border-[var(--line)] bg-[var(--bg)] font-semibold text-[var(--mute)] hover:text-[var(--ink)]'
                            }`}
                          >
                            <span className="truncate">
                              {tp.specCode ? `${tp.specCode} · ` : ''}
                              {tp.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Selected Topic Full Notes Reader */}
                  <div className="space-y-4 md:col-span-8">
                    {selectedSubjectTopic ? (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
                          <div>
                            <div className="text-xs font-bold text-[var(--e3)]">
                              Topic Notes Reader
                            </div>
                            <h3 className="font-display text-lg font-bold text-[var(--ink)]">
                              {selectedSubjectTopic.specCode
                                ? `${selectedSubjectTopic.specCode} · `
                                : ''}
                              {selectedSubjectTopic.name}
                            </h3>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleCopySingleSubjectTopic(previewItem, previewTopicIdx, true)
                            }
                            className="sd-btn px-3 py-1.5 text-xs whitespace-nowrap"
                          >
                            <Download className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>Use This Topic Notes</span>
                          </button>
                        </div>

                        <StructuredNoteReader
                          notes={selectedSubjectTopic.notes}
                          timelineEvents={selectedSubjectTopic.timelineEvents}
                        />
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-xs text-[var(--mute)]">
                        This shared subject contains {previewItem.subjectPayload.cards.length} flashcards.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-4">
              <button
                type="button"
                onClick={() => void handleCopyShareLink(previewItem)}
                className="sd-btn px-3.5 py-2 text-xs whitespace-nowrap"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy Share Link</span>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyToWorkspace(previewItem, false)}
                  className="sd-btn px-4 py-2 text-xs whitespace-nowrap"
                >
                  <Download className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy to Workspace</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopyToWorkspace(previewItem, true)}
                  className="sd-btn-pri px-5 py-2 text-xs whitespace-nowrap"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    {previewItem.type === 'flashcards'
                      ? 'Use & Study Cards'
                      : 'Use & Open in My Notes'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
