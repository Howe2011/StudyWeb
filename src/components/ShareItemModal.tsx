import { FormEvent, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import { Check, Copy, Globe, Link2, Lock, Share2, X } from 'lucide-react';
import { publishSharedItem } from '../lib/communityService';
import {
  SharedFlashcardsPayload,
  SharedItemType,
  SharedItemVisibility,
  SharedNotesPayload,
  SharedStudyItem,
  SharedSubjectPayload,
  StudyTopic,
} from '../types';

export interface SubTopicShareOption {
  topic: StudyTopic;
  depth: number;
  itemCount: number;
}

export interface FlashcardTopicShareOption {
  topicId: string;
  topicName: string;
  cards: Array<{ q: string; a: string; sectionName?: string }>;
}

export interface ShareTargetConfig {
  type: SharedItemType;
  defaultTitle: string;
  subjectName: string;
  examBoard: string;
  defaultSummary: string;
  itemCount: number;
  rootTopicOldId?: string;
  subTopicShareOptions?: SubTopicShareOption[];
  initialFlashcardTopicId?: string;
  flashcardTopicOptions?: FlashcardTopicShareOption[];
  notesPayload?: SharedNotesPayload;
  flashcardsPayload?: SharedFlashcardsPayload;
  subjectPayload?: SharedSubjectPayload;
}

interface ShareItemModalProps {
  open: boolean;
  onClose: () => void;
  target: ShareTargetConfig | null;
  firebaseUser: User | null;
  authorName: string;
  onOpenAuth: () => void;
  onPublished: (item: SharedStudyItem) => void;
}

const MAX_SHARE_PAYLOAD_BYTES = 390_000;

export function ShareItemModal({
  open,
  onClose,
  target,
  firebaseUser,
  authorName,
  onOpenAuth,
  onPublished,
}: ShareItemModalProps) {
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [summaryEdited, setSummaryEdited] = useState(false);
  const [visibility, setVisibility] = useState<SharedItemVisibility>('public');
  const [selectedSubTopicIds, setSelectedSubTopicIds] = useState<Set<string>>(() => new Set());
  const [flashcardScopeMode, setFlashcardScopeMode] = useState<'all' | 'topics'>('all');
  const [selectedFlashcardTopicIds, setSelectedFlashcardTopicIds] = useState<Set<string>>(
    () => new Set()
  );
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [publishedItem, setPublishedItem] = useState<SharedStudyItem | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    if (open && target) {
      setTitle(target.defaultTitle);
      setSummary(target.defaultSummary);
      setTitleEdited(false);
      setSummaryEdited(false);
      setVisibility('public');
      setSelectedSubTopicIds(
        new Set((target.subTopicShareOptions || []).map((opt) => opt.topic.id))
      );

      const fcOpts = target.flashcardTopicOptions || [];
      const initTopicId = target.initialFlashcardTopicId;
      if (
        target.type === 'flashcards' &&
        initTopicId &&
        initTopicId !== 'ALL' &&
        fcOpts.some((o) => o.topicId === initTopicId)
      ) {
        setFlashcardScopeMode('topics');
        setSelectedFlashcardTopicIds(new Set([initTopicId]));
      } else {
        setFlashcardScopeMode('all');
        setSelectedFlashcardTopicIds(new Set(fcOpts.map((o) => o.topicId)));
      }

      setPublishedItem(null);
      setErrorMsg(null);
      setCopiedLink(false);
    }
  }, [open, target]);

  const subTopicOptions = target?.subTopicShareOptions || [];
  const flashcardTopicOptions = target?.flashcardTopicOptions || [];

  const selectedSubTopics = useMemo(
    () => subTopicOptions.filter((opt) => selectedSubTopicIds.has(opt.topic.id)),
    [subTopicOptions, selectedSubTopicIds]
  );

  const selectedFlashcardTopics = useMemo(() => {
    if (flashcardScopeMode === 'all') return flashcardTopicOptions;
    return flashcardTopicOptions.filter((opt) => selectedFlashcardTopicIds.has(opt.topicId));
  }, [flashcardScopeMode, flashcardTopicOptions, selectedFlashcardTopicIds]);

  const resolvedFlashcardsPayload = useMemo<SharedFlashcardsPayload | undefined>(() => {
    if (!target || target.type !== 'flashcards') return target?.flashcardsPayload;
    if (flashcardTopicOptions.length === 0) return target.flashcardsPayload;

    const cards = selectedFlashcardTopics.flatMap((opt) => opt.cards);
    const sectionName =
      flashcardScopeMode === 'topics' && selectedFlashcardTopics.length === 1
        ? selectedFlashcardTopics[0].topicName
        : `${target.subjectName} Flashcards`;

    return {
      sectionName,
      cards,
    };
  }, [target, flashcardTopicOptions, selectedFlashcardTopics, flashcardScopeMode]);

  const resolvedItemCount = useMemo(() => {
    if (!target) return 0;
    if (target.type === 'flashcards' && resolvedFlashcardsPayload) {
      return resolvedFlashcardsPayload.cards.length;
    }
    return (
      target.itemCount + selectedSubTopics.reduce((sum, opt) => sum + opt.itemCount, 0)
    );
  }, [target, selectedSubTopics, resolvedFlashcardsPayload]);

  // Keep title & description synced when user switches between All Subject vs Topic flashcards (unless edited manually)
  useEffect(() => {
    if (!open || !target || target.type !== 'flashcards' || flashcardTopicOptions.length === 0) {
      return;
    }
    const cardCount = resolvedFlashcardsPayload?.cards.length || 0;
    const isSingleTopic =
      flashcardScopeMode === 'topics' && selectedFlashcardTopics.length === 1;
    const nextDefaultTitle = isSingleTopic
      ? `${selectedFlashcardTopics[0].topicName} Flashcards`
      : flashcardScopeMode === 'topics' && selectedFlashcardTopics.length > 1
      ? `${target.subjectName} (${selectedFlashcardTopics.length} Decks)`
      : `${target.subjectName} Flashcards`;
    const nextDefaultSummary = isSingleTopic
      ? `${cardCount} active-recall flashcard${cardCount === 1 ? '' : 's'} for ${selectedFlashcardTopics[0].topicName} (${target.subjectName}).`
      : `${cardCount} active-recall flashcard${cardCount === 1 ? '' : 's'} for ${target.subjectName}.`;

    if (!titleEdited) setTitle(nextDefaultTitle);
    if (!summaryEdited) setSummary(nextDefaultSummary);
  }, [
    open,
    target,
    flashcardTopicOptions.length,
    flashcardScopeMode,
    selectedFlashcardTopics,
    resolvedFlashcardsPayload,
    titleEdited,
    summaryEdited,
  ]);

  const resolvedNotesPayload = useMemo<SharedNotesPayload | undefined>(() => {
    if (!target || target.type !== 'notes' || !target.notesPayload) return target?.notesPayload;
    return {
      ...target.notesPayload,
      ...(target.rootTopicOldId ? { topicOldId: target.rootTopicOldId } : {}),
      subTopics:
        selectedSubTopics.length > 0
          ? selectedSubTopics.map((opt) => ({
              oldId: opt.topic.id,
              parentOldId: opt.topic.parentTopicId,
              topicName: opt.topic.name,
              specCode: opt.topic.specCode,
              tags: opt.topic.tags,
              notes: opt.topic.notes,
              timelineEvents: opt.topic.timelineEvents,
            }))
          : undefined,
    };
  }, [target, selectedSubTopics]);

  const estimatedPayloadBytes = useMemo(() => {
    if (!target) return 0;
    try {
      return JSON.stringify({
        notesPayload: resolvedNotesPayload,
        flashcardsPayload: resolvedFlashcardsPayload,
        subjectPayload: target.subjectPayload,
      }).length;
    } catch {
      return 0;
    }
  }, [target, resolvedNotesPayload, resolvedFlashcardsPayload]);

  const isOverSizeLimit = estimatedPayloadBytes > MAX_SHARE_PAYLOAD_BYTES;
  const isEmptyFlashcardsSelection =
    target?.type === 'flashcards' && resolvedItemCount === 0;

  if (!open || !target) return null;

  const shareUrl = publishedItem
    ? `${window.location.origin}/?share=${encodeURIComponent(publishedItem.shareCode)}`
    : '';

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // ignore
    }
  };

  const toggleSubTopic = (id: string) => {
    setSelectedSubTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleFlashcardTopic = (id: string) => {
    setFlashcardScopeMode('topics');
    setSelectedFlashcardTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectSingleFlashcardTopic = (id: string) => {
    setFlashcardScopeMode('topics');
    setSelectedFlashcardTopicIds(new Set([id]));
  };

  const handlePublish = async (e: FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || isOverSizeLimit || isEmptyFlashcardsSelection) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const item = await publishSharedItem({
        uid: firebaseUser.uid,
        ownerName: authorName || firebaseUser.displayName || 'StudyWeb Student',
        type: target.type,
        title: title.trim() || target.defaultTitle,
        subjectName: target.subjectName,
        examBoard: target.examBoard,
        summary: summary.trim() || target.defaultSummary,
        visibility,
        itemCount: resolvedItemCount,
        notesPayload: resolvedNotesPayload,
        flashcardsPayload: resolvedFlashcardsPayload,
        subjectPayload: target.subjectPayload,
      });
      setPublishedItem(item);
      onPublished(item);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to share right now.');
    } finally {
      setBusy(false);
    }
  };

  const totalSubjectFlashcardsCount = flashcardTopicOptions.reduce(
    (sum, opt) => sum + opt.cards.length,
    0
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-item-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sd-card w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <h2
              id="share-item-title"
              className="font-display text-lg font-bold text-[var(--ink)]"
            >
              {publishedItem
                ? 'Ready to Share!'
                : `Share ${
                    target.type === 'notes'
                      ? 'Topic Notes'
                      : target.type === 'flashcards'
                      ? 'Flashcard Deck'
                      : 'Full Subject'
                  }`}
            </h2>
            <p className="mt-0.5 text-xs text-[var(--mute)]">
              {target.subjectName} · {resolvedItemCount}{' '}
              {target.type === 'flashcards'
                ? `card${resolvedItemCount === 1 ? '' : 's'}`
                : 'items'}
              {selectedSubTopics.length > 0
                ? ` (+${selectedSubTopics.length} sub-topic${
                    selectedSubTopics.length === 1 ? '' : 's'
                  })`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share dialog"
            className="sd-btn h-8 w-8 shrink-0 p-0"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[82dvh] overflow-y-auto p-5">
          {!firebaseUser ? (
            <div className="space-y-4 text-sm">
              <p className="leading-relaxed text-[var(--mute)]">
                Sign in with Google to publish notes, flashcard decks, or full subjects and get a
                6-character share code for classmates.
              </p>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAuth();
                }}
                className="sd-btn-pri w-full py-2.5 text-xs"
              >
                Sign in with Google
              </button>
            </div>
          ) : publishedItem ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-center">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  6-Character Share Code
                </div>
                <div className="font-mono-num mt-1 text-3xl font-extrabold tracking-[0.22em] text-[var(--e3)]">
                  {publishedItem.shareCode}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-[var(--mute)]">Direct Share Link</div>
                <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--bg)] p-2">
                  <code className="font-mono-num min-w-0 flex-1 truncate text-xs text-[var(--ink)]">
                    {shareUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copyShareUrl()}
                    className="sd-btn shrink-0 px-2.5 py-1 text-xs"
                  >
                    {copiedLink ? (
                      <Check className="h-3.5 w-3.5 text-[var(--ok)]" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    <span>{copiedLink ? 'Copied' : 'Copy Link'}</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="sd-btn-pri w-full py-2.5 text-xs"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => void handlePublish(e)} className="space-y-4">
              {errorMsg && (
                <div className="rounded-lg border border-[var(--bad)] bg-[var(--bg)] px-3 py-2 text-xs font-semibold text-[var(--bad)]">
                  {errorMsg}
                </div>
              )}

              {isOverSizeLimit && (
                <div className="rounded-lg border border-[var(--bad)] bg-[var(--bg)] px-3 py-2 text-xs font-semibold text-[var(--bad)]">
                  Selected items exceed the 400 KB share limit (~
                  {Math.round(estimatedPayloadBytes / 1024)} KB). Uncheck some topics or remove
                  large embedded images.
                </div>
              )}

              {target.type === 'flashcards' && flashcardTopicOptions.length > 0 && (
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2">
                    <div className="text-xs font-bold text-[var(--ink)]">
                      Flashcards to Share
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setFlashcardScopeMode('all');
                          setSelectedFlashcardTopicIds(
                            new Set(flashcardTopicOptions.map((o) => o.topicId))
                          );
                        }}
                        className={`sd-btn px-2 py-0.5 text-[11px] whitespace-nowrap ${
                          flashcardScopeMode === 'all'
                            ? 'border-[var(--e3)] text-[var(--e3)] font-bold'
                            : ''
                        }`}
                      >
                        All Subject ({totalSubjectFlashcardsCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFlashcardScopeMode('topics');
                          if (
                            selectedFlashcardTopicIds.size === 0 ||
                            selectedFlashcardTopicIds.size === flashcardTopicOptions.length
                          ) {
                            setSelectedFlashcardTopicIds(
                              new Set(
                                flashcardTopicOptions[0]
                                  ? [flashcardTopicOptions[0].topicId]
                                  : []
                              )
                            );
                          }
                        }}
                        className={`sd-btn px-2 py-0.5 text-[11px] whitespace-nowrap ${
                          flashcardScopeMode === 'topics'
                            ? 'border-[var(--e3)] text-[var(--e3)] font-bold'
                            : ''
                        }`}
                      >
                        By Deck / Topic
                      </button>
                    </div>
                  </div>

                  {flashcardScopeMode === 'topics' ? (
                    <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
                      {flashcardTopicOptions.map((opt) => {
                        const checked = selectedFlashcardTopicIds.has(opt.topicId);
                        return (
                          <div
                            key={opt.topicId}
                            className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${
                              checked
                                ? 'bg-[color-mix(in_srgb,var(--e3)_9%,var(--card))] text-[var(--ink)]'
                                : 'text-[var(--mute)] hover:bg-[var(--card)]'
                            }`}
                          >
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleFlashcardTopic(opt.topicId)}
                                className="h-3.5 w-3.5 shrink-0 accent-[var(--e3)]"
                              />
                              <span className="truncate font-medium">{opt.topicName}</span>
                            </label>
                            <div className="flex shrink-0 items-center gap-2">
                              {flashcardTopicOptions.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => selectSingleFlashcardTopic(opt.topicId)}
                                  className="cursor-pointer text-[11px] font-semibold text-[var(--e3)] hover:underline"
                                >
                                  Only
                                </button>
                              )}
                              <span className="font-mono-num text-[11px] text-[var(--mute)]">
                                {opt.cards.length}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                      {isEmptyFlashcardsSelection && (
                        <div className="px-1 pt-1 text-[11px] font-semibold text-[var(--bad)]">
                          Select at least one deck or topic to share.
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="mt-2 text-[11px] text-[var(--mute)]">
                      Sharing all {totalSubjectFlashcardsCount} flashcards across{' '}
                      {flashcardTopicOptions.length} deck
                      {flashcardTopicOptions.length === 1 ? '' : 's'} in {target.subjectName}. Click{' '}
                      <span className="font-semibold text-[var(--ink)]">By Deck / Topic</span> to
                      share a single deck or topic instead.
                    </p>
                  )}
                </div>
              )}

              <label className="block text-xs font-semibold text-[var(--mute)]">
                Title *
                <input
                  type="text"
                  required
                  maxLength={120}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setTitleEdited(true);
                  }}
                  className="sd-input mt-1 text-sm"
                />
              </label>

              <label className="block text-xs font-semibold text-[var(--mute)]">
                Short Description
                <textarea
                  rows={2}
                  maxLength={240}
                  value={summary}
                  onChange={(e) => {
                    setSummary(e.target.value);
                    setSummaryEdited(true);
                  }}
                  placeholder="What does this cover? Exam board, topic, or key definitions..."
                  className="sd-input mt-1 text-sm"
                />
              </label>

              {target.type === 'notes' && subTopicOptions.length > 0 && (
                <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2">
                    <div className="text-xs font-bold text-[var(--ink)]">
                      Sub-topics Included ({selectedSubTopics.length}/{subTopicOptions.length})
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedSubTopicIds(
                            new Set(subTopicOptions.map((opt) => opt.topic.id))
                          )
                        }
                        className={`sd-btn px-2 py-0.5 text-[11px] whitespace-nowrap ${
                          selectedSubTopics.length === subTopicOptions.length
                            ? 'border-[var(--e3)] text-[var(--e3)] font-bold'
                            : ''
                        }`}
                      >
                        All Sub-topics ({subTopicOptions.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedSubTopicIds(new Set())}
                        className={`sd-btn px-2 py-0.5 text-[11px] whitespace-nowrap ${
                          selectedSubTopics.length === 0
                            ? 'border-[var(--e3)] text-[var(--e3)] font-bold'
                            : ''
                        }`}
                      >
                        Parent Only
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 max-h-48 space-y-1 overflow-y-auto pr-1">
                    {subTopicOptions.map((opt) => {
                      const checked = selectedSubTopicIds.has(opt.topic.id);
                      const indentPx = Math.max(0, opt.depth - 1) * 14;
                      return (
                        <label
                          key={opt.topic.id}
                          style={{ paddingLeft: `${indentPx + 6}px` }}
                          className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors ${
                            checked
                              ? 'bg-[color-mix(in_srgb,var(--e3)_9%,var(--card))] text-[var(--ink)]'
                              : 'text-[var(--mute)] hover:bg-[var(--card)]'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSubTopic(opt.topic.id)}
                              className="h-3.5 w-3.5 shrink-0 accent-[var(--e3)]"
                            />
                            <span className="truncate font-medium">
                              {opt.topic.specCode ? `${opt.topic.specCode} · ` : ''}
                              {opt.topic.name}
                            </span>
                          </span>
                          <span className="font-mono-num shrink-0 text-[11px] text-[var(--mute)]">
                            {opt.itemCount}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-1.5 text-xs font-semibold text-[var(--mute)]">Visibility</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVisibility('public')}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-left text-xs transition-colors ${
                      visibility === 'public'
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--bg))] text-[var(--ink)]'
                        : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)]'
                    }`}
                  >
                    <Globe className="h-4 w-4 shrink-0 text-[var(--e3)]" aria-hidden="true" />
                    <div>
                      <div className="font-bold">Public Library</div>
                      <div className="text-[11px] text-[var(--mute)]">Visible to everyone</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisibility('unlisted')}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-left text-xs transition-colors ${
                      visibility === 'unlisted'
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--bg))] text-[var(--ink)]'
                        : 'border-[var(--line)] bg-[var(--bg)] text-[var(--mute)]'
                    }`}
                  >
                    <Lock className="h-4 w-4 shrink-0 text-[var(--e2)]" aria-hidden="true" />
                    <div>
                      <div className="font-bold">Code / Link Only</div>
                      <div className="text-[11px] text-[var(--mute)]">Hidden from search</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={onClose} className="sd-btn px-3.5 py-2 text-xs">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy || isOverSizeLimit || isEmptyFlashcardsSelection}
                  className="sd-btn-pri px-4 py-2 text-xs whitespace-nowrap disabled:opacity-50"
                >
                  {visibility === 'public' ? (
                    <Share2 className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  <span>{busy ? 'Publishing…' : 'Create Share Link'}</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
