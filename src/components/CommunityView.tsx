import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  BookMarked,
  BookOpen,
  Calendar,
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Layers,
  Link2,
  Lock,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import {
  copySharedItemIntoWorkspace,
  copySharedSubjectTopicIntoWorkspace,
  deleteSharedItem,
  fetchAllSharedItemsForAdmin,
  fetchPublicSharedItems,
  fetchUserSharedItems,
  incrementSharedCopyCount,
  lookupSharedItemByCode,
} from '../lib/communityService';
import { getTableSurfaceStyles, renderRichInline } from '../lib/inlineRichText';
import { renderDocumentHtmlWithLatex, renderKatexToHtml } from '../lib/latexRenderer';
import { NOTE_PART_ROLE_MAP, normalizeNoteColor } from '../lib/noteColors';
import { groupSectionPoints } from '../lib/noteFormat';
import { FlowchartBlock } from './FlowchartBlock';
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
  isAdmin?: boolean;
  initialShareCode?: string | null;
  initialTypeFilter?: CommunityTypeFilter | null;
  onUpdateWorkspace: (updater: (prev: WorkspaceData) => WorkspaceData) => void;
  onOpenAuth: () => void;
  onRequestClearInitialShareCode?: () => void;
  onRequestClearInitialTypeFilter?: () => void;
  onDeletedSharedItem?: (id: string) => void;
  onOpenCopiedNotes?: (subjectId: string, topicId?: string) => void;
  onOpenCopiedFlashcards?: (subjectId: string) => void;
}

function formatLastUpdated(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Recently';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

function formatFullDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractCommunityError(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message : fallback;
  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed?.error) return parsed.error;
  } catch {
    // not JSON
  }
  return raw || fallback;
}



function StructuredNoteReader({
  notes,
  timelineEvents,
}: {
  notes: StructuredNoteData;
  timelineEvents?: TimelineEventItem[];
}) {
  const hasSections = notes.sections.some((s) => s.points.length > 0 || s.heading.trim());
  const docHtml = (notes.originalHtml || notes.legacyHtml || '').trim();
  const hasAnyContent =
    Boolean(notes.summary.trim()) ||
    hasSections ||
    notes.keyTerms.length > 0 ||
    Boolean(notes.workedExample.trim()) ||
    Boolean(notes.examTip.trim()) ||
    Boolean(timelineEvents && timelineEvents.length > 0) ||
    Boolean(docHtml);

  if (!hasAnyContent) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--bg)] p-8 text-center text-sm text-[var(--mute)]">
        This topic does not have written notes yet.
      </div>
    );
  }

  return (
    <div
      className="sd-note-scope space-y-8 text-[16px] leading-[1.72] text-[var(--ink)]"
      data-note-color={normalizeNoteColor(notes.accentColor)}
    >
      {docHtml && notes.preferOriginalFormat && (
        <div className="sd-doc-canvas">
          <div
            className="sd-doc-sheet"
            dangerouslySetInnerHTML={{ __html: renderDocumentHtmlWithLatex(docHtml) }}
          />
        </div>
      )}

      {notes.summary.trim() && (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--note-accent)_28%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_7%,var(--card))] px-5 py-4">
          <div className="text-sm font-bold text-[var(--note-accent)]">Topic Overview</div>
          <p className="mt-1.5 text-[16px] leading-[1.72] text-[var(--ink)]">
            {renderRichInline(notes.summary)}
          </p>
        </div>
      )}

      {notes.sections.map((sec) => {
        if (!sec.heading.trim() && sec.points.length === 0) return null;
        const secAccent = normalizeNoteColor(sec.accentColor);
        const roleInfo = sec.partRole ? NOTE_PART_ROLE_MAP[sec.partRole] : undefined;
        return (
          <section
            key={sec.id}
            data-note-color={secAccent !== 'default' ? secAccent : undefined}
            className="space-y-3.5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-[color-mix(in_srgb,var(--note-accent)_34%,var(--line))] pb-2.5">
              <h3 className="min-w-0 flex-1 font-display text-xl font-extrabold tracking-tight text-[var(--ink)] sm:text-2xl">
                {sec.heading || 'Key Points'}
              </h3>
              {roleInfo && (
                <span className="shrink-0 whitespace-nowrap text-xs font-bold text-[var(--note-accent)]">
                  {roleInfo.label}
                </span>
              )}
            </div>
            {sec.points.length > 0 && (
              <div className="space-y-3 text-[15.5px] leading-[1.7] text-[var(--ink)] sm:text-[16px]">
                {groupSectionPoints(sec.points).map((blk, i) => {
                  if (blk.kind === 'subheading') {
                    return (
                      <h4
                        key={i}
                        className={`font-display text-lg font-bold text-[var(--note-accent)] ${
                          i > 0 ? 'pt-3' : ''
                        }`}
                      >
                        {renderRichInline(blk.text)}
                      </h4>
                    );
                  }
                  if (blk.kind === 'factbox') {
                    const boxSurface = getTableSurfaceStyles(blk.color);
                    return (
                      <div
                        key={i}
                        className="my-3 rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_30%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_7%,var(--card))] px-4 py-3.5"
                        style={boxSurface.boxStyle}
                      >
                        <div
                          className="text-sm font-bold text-[var(--note-accent)]"
                          style={boxSurface.boxTitleStyle}
                        >
                          {blk.title || 'Key Fact'}
                        </div>
                        <div className="mt-1 text-[15.5px] leading-[1.68] text-[var(--ink)]">
                          {renderRichInline(blk.text)}
                        </div>
                      </div>
                    );
                  }
                  if (blk.kind === 'table') {
                    const tblSurface = getTableSurfaceStyles(blk.color);
                    return (
                      <div
                        key={i}
                        className="my-4 overflow-x-auto rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_26%,var(--line))] bg-[var(--card)]"
                        style={tblSurface.wrapperStyle}
                      >
                        <table className="w-full border-collapse text-left text-[15px]">
                          <thead
                            className="border-b-2 border-[color-mix(in_srgb,var(--note-accent)_38%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_12%,var(--card))]"
                            style={tblSurface.theadStyle}
                          >
                            <tr>
                              {blk.headers.map((h, hi) => (
                                <th key={hi} className="px-4 py-3 font-bold text-[var(--ink)]">
                                  {renderRichInline(h)}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[var(--line)]">
                            {blk.rows.map((row, ri) => (
                              <tr
                                key={ri}
                                className={
                                  !tblSurface.isCustom && ri % 2 === 1
                                    ? 'bg-[color-mix(in_srgb,var(--note-accent)_4%,var(--card))]'
                                    : ''
                                }
                                style={ri % 2 === 1 ? tblSurface.zebraStyle : undefined}
                              >
                                {row.map((cell, ci) => (
                                  <td
                                    key={ci}
                                    className={`px-4 py-3 align-top leading-relaxed text-[var(--ink)] ${
                                      ci === 0 ? 'font-semibold' : ''
                                    }`}
                                    style={ci === 0 ? tblSurface.firstColStyle : undefined}
                                  >
                                    {renderRichInline(cell)}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  }
                  if (blk.kind === 'flow') {
                    return (
                      <FlowchartBlock
                        key={i}
                        label={blk.label}
                        steps={blk.steps}
                      />
                    );
                  }
                  if (blk.kind === 'image') {
                    const widthCls =
                      blk.width === 'compact'
                        ? 'max-w-sm mx-auto'
                        : blk.width === 'medium'
                        ? 'max-w-lg mx-auto'
                        : blk.width === 'full'
                        ? 'w-full'
                        : 'max-w-3xl mx-auto';
                    return (
                      <figure key={i} className={`my-3 ${widthCls}`}>
                        <img
                          src={blk.src}
                          alt={blk.caption || 'Study note diagram'}
                          className="w-full h-auto rounded-xl border border-[var(--line)] bg-[var(--card)] object-contain"
                        />
                        {blk.caption && (
                          <figcaption className="mt-1.5 text-center text-xs text-[var(--mute)]">
                            {blk.caption}
                          </figcaption>
                        )}
                      </figure>
                    );
                  }
                  if (blk.kind === 'math') {
                    return (
                      <div
                        key={i}
                        className="my-4 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--card)] p-4 text-center shadow-xs"
                      >
                        <div
                          dangerouslySetInnerHTML={{
                            __html: renderKatexToHtml(blk.latex, true),
                          }}
                        />
                      </div>
                    );
                  }
                  if (blk.kind === 'code') {
                    return (
                      <div
                        key={i}
                        className="my-4 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-xs"
                      >
                        <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--bg)] px-4 py-2 text-xs font-semibold text-[var(--mute)]">
                          <span>{blk.lang || 'code'}</span>
                        </div>
                        <pre className="overflow-x-auto p-4 font-mono text-sm text-[var(--ink)]">
                          <code>{blk.code}</code>
                        </pre>
                      </div>
                    );
                  }
                  if (blk.kind === 'callout') {
                    return (
                      <div
                        key={i}
                        className={`my-4 rounded-xl border px-4 py-3.5 shadow-xs sd-callout-${blk.type}`}
                      >
                        <div className="text-sm font-bold text-[var(--note-accent)] uppercase tracking-wider">
                          {blk.title || blk.type}
                        </div>
                        <div className="mt-1 text-[15.5px] leading-[1.68] text-[var(--ink)]">
                          {renderRichInline(blk.text)}
                        </div>
                      </div>
                    );
                  }
                  if (blk.kind === 'divider') {
                    return <hr key={i} className="my-5 border-t border-[var(--line)]" />;
                  }
                  if (blk.kind === 'ordered') {
                    return (
                      <ol key={i} className="my-3 list-decimal space-y-1.5 pl-6 text-[15.5px] leading-[1.7] text-[var(--ink)]">
                        {blk.items.map((it, ii) => (
                          <li key={ii} value={it.num}>
                            {renderRichInline(it.text)}
                          </li>
                        ))}
                      </ol>
                    );
                  }
                  if (blk.kind === 'checklist') {
                    return (
                      <div key={i} className="my-3 space-y-2">
                        {blk.items.map((it, ii) => (
                          <div key={ii} className="flex items-start gap-2.5 text-[15.5px] text-[var(--ink)]">
                            <input
                              type="checkbox"
                              defaultChecked={it.checked}
                              className="mt-1 h-4 w-4 rounded border-[var(--line)] text-[var(--note-accent)]"
                            />
                            <span className={it.checked ? 'line-through opacity-70' : ''}>
                              {renderRichInline(it.text)}
                            </span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (blk.kind === 'paragraph') {
                    return (
                      <p key={i} className="whitespace-pre-line leading-[1.75]">
                        {renderRichInline(blk.text)}
                      </p>
                    );
                  }
                  const isSubBullet = Boolean(blk.indent && blk.indent > 0);
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-3 ${isSubBullet ? 'pl-7' : 'pl-1'}`}
                    >
                      <span
                        className={`mt-[11px] h-2 w-2 shrink-0 rounded-full ${
                          isSubBullet
                            ? 'border-[1.5px] border-[var(--note-accent)] bg-transparent'
                            : 'bg-[var(--note-accent)]'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1">{renderRichInline(blk.text)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      {notes.keyTerms.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-display border-b-2 border-[color-mix(in_srgb,var(--note-accent)_32%,var(--line))] pb-2 text-lg font-extrabold text-[var(--ink)] sm:text-xl">
            Key Terms &amp; Definitions ({notes.keyTerms.length})
          </h3>
          <div className="overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--note-accent)_26%,var(--line))] bg-[var(--card)]">
            <table className="w-full border-collapse text-left text-[15px]">
              <thead className="border-b-2 border-[color-mix(in_srgb,var(--note-accent)_35%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent)_11%,var(--card))]">
                <tr>
                  <th className="w-1/3 px-4 py-2.5 font-bold text-[var(--ink)]">Term</th>
                  <th className="px-4 py-2.5 font-bold text-[var(--ink)]">Definition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)]">
                {notes.keyTerms.map((kt, idx) => (
                  <tr
                    key={kt.id}
                    className={
                      idx % 2 === 1
                        ? 'bg-[color-mix(in_srgb,var(--note-accent)_4%,var(--card))]'
                        : ''
                    }
                  >
                    <td className="px-4 py-3 align-top font-bold text-[color-mix(in_srgb,var(--note-accent)_55%,var(--ink))]">
                      {kt.term}
                    </td>
                    <td className="px-4 py-3 align-top text-[var(--ink)]/92">{kt.definition}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {notes.workedExample.trim() && (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--ok)_32%,var(--line))] bg-[color-mix(in_srgb,var(--ok)_5%,var(--card))] p-5">
          <div className="text-sm font-bold text-[var(--ok)]">Worked Example</div>
          <p className="mt-1.5 whitespace-pre-line text-[15.5px] leading-[1.7] text-[var(--ink)]">
            {renderRichInline(notes.workedExample)}
          </p>
        </div>
      )}

      {notes.examTip.trim() && (
        <div className="rounded-2xl border border-[color-mix(in_srgb,var(--e2)_38%,var(--line))] bg-[color-mix(in_srgb,var(--e2)_6%,var(--card))] p-5">
          <div className="text-sm font-bold text-[var(--e2)]">Examiner Tip</div>
          <p className="mt-1.5 whitespace-pre-line text-[15.5px] leading-[1.7] text-[var(--ink)]">
            {renderRichInline(notes.examTip)}
          </p>
        </div>
      )}

      {timelineEvents && timelineEvents.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
          <div className="flex items-center gap-2 text-sm font-bold text-[var(--e3)]">
            <Calendar className="h-4 w-4" aria-hidden="true" />
            <span>Timeline Events ({timelineEvents.length})</span>
          </div>
          <div className="space-y-2.5">
            {timelineEvents.map((ev) => (
              <div key={ev.id} className="flex items-start gap-3 text-[15px]">
                <span className="font-mono-num shrink-0 rounded-md border border-[var(--line)] bg-[var(--bg)] px-2.5 py-0.5 text-xs font-bold text-[var(--e3)]">
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
  isAdmin = false,
  initialShareCode,
  initialTypeFilter,
  onUpdateWorkspace,
  onOpenAuth,
  onRequestClearInitialShareCode,
  onRequestClearInitialTypeFilter,
  onDeletedSharedItem,
  onOpenCopiedNotes,
  onOpenCopiedFlashcards,
}: CommunityViewProps) {
  const [publicItems, setPublicItems] = useState<SharedStudyItem[]>([]);
  const [myItems, setMyItems] = useState<SharedStudyItem[]>([]);
  const [allSharedItems, setAllSharedItems] = useState<SharedStudyItem[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(true);
  const [loadingMine, setLoadingMine] = useState(false);
  const [loadingAllShared, setLoadingAllShared] = useState(false);
  const [viewMode, setViewMode] = useState<'community' | 'admin_all' | 'mine'>('community');
  const [typeFilter, setTypeFilter] = useState<CommunityTypeFilter>(initialTypeFilter || 'all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchScope, setSearchScope] = useState<'all' | 'title' | 'author' | 'subject' | 'code'>('all');
  const [subjectFilter, setSubjectFilter] = useState<string>('ALL');
  const [boardFilter, setBoardFilter] = useState<string>('ALL');
  const [authorFilter, setAuthorFilter] = useState<string>('ALL');
  const [sizeFilter, setSizeFilter] = useState<'all' | 'small' | 'medium' | 'large'>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'unlisted'>('all');
  const [subtopicsOnlyFilter, setSubtopicsOnlyFilter] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'recent' | 'popular' | 'largest' | 'title' | 'author'>('recent');
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(true);

  const [codeInput, setCodeInput] = useState(initialShareCode || '');
  const [codeSearching, setCodeSearching] = useState(false);
  const [previewItem, setPreviewItem] = useState<SharedStudyItem | null>(null);
  const [previewTopicIdx, setPreviewTopicIdx] = useState<number>(0);
  const [previewSubTopicIdx, setPreviewSubTopicIdx] = useState<number>(-1);
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
    setPreviewSubTopicIdx(-1);
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
        msg: extractCommunityError(err, 'Could not load community library.'),
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
        msg: extractCommunityError(err, 'Could not load your shared links.'),
      });
    } finally {
      setLoadingMine(false);
    }
  }, [firebaseUser]);

  const loadAllShared = useCallback(async () => {
    if (!isAdmin) return;
    setLoadingAllShared(true);
    try {
      const list = await fetchAllSharedItemsForAdmin();
      setAllSharedItems(list);
    } catch (err) {
      setStatusBanner({
        ok: false,
        msg: extractCommunityError(err, 'Could not load all shared items.'),
      });
    } finally {
      setLoadingAllShared(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadPublic(true);
  }, [loadPublic]);

  useEffect(() => {
    if (viewMode === 'mine') {
      void loadMine();
    } else if (viewMode === 'admin_all' && isAdmin) {
      void loadAllShared();
    }
  }, [viewMode, isAdmin, loadMine, loadAllShared]);

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
          msg: extractCommunityError(err, 'Lookup failed.'),
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
        msg: extractCommunityError(err, 'Code lookup failed.'),
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
    setAllSharedItems((prev) =>
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
    setAllSharedItems((prev) =>
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
      setAllSharedItems((prev) => prev.filter((x) => x.id !== id));
      onDeletedSharedItem?.(id);
      if (previewItem?.id === id) setPreviewItem(null);
      setStatusBanner({ ok: true, msg: 'Removed shared link.' });
    } catch (err) {
      setStatusBanner({
        ok: false,
        msg: extractCommunityError(err, 'Could not delete shared link.'),
      });
    }
  };

  const currentBaseList = useMemo(
    () =>
      viewMode === 'mine'
        ? myItems
        : viewMode === 'admin_all'
        ? allSharedItems
        : publicItems,
    [viewMode, myItems, allSharedItems, publicItems]
  );

  const filterFacets = useMemo(() => {
    const subjects = new Set<string>();
    const boards = new Set<string>();
    const authorCounts = new Map<string, number>();

    for (const item of currentBaseList) {
      if (item.subjectName.trim()) subjects.add(item.subjectName.trim());
      if (item.examBoard.trim()) boards.add(item.examBoard.trim());
      const author = item.ownerName.trim() || 'Student';
      authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
    }

    return {
      subjects: Array.from(subjects).sort((a, b) => a.localeCompare(b)),
      boards: Array.from(boards).sort((a, b) => a.localeCompare(b)),
      authors: Array.from(authorCounts.entries()).sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [currentBaseList]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (typeFilter !== 'all') count += 1;
    if (subjectFilter !== 'ALL') count += 1;
    if (boardFilter !== 'ALL') count += 1;
    if (authorFilter !== 'ALL') count += 1;
    if (sizeFilter !== 'all') count += 1;
    if (visibilityFilter !== 'all' && viewMode !== 'community') count += 1;
    if (subtopicsOnlyFilter) count += 1;
    if (searchQuery.trim()) count += 1;
    return count;
  }, [
    typeFilter,
    subjectFilter,
    boardFilter,
    authorFilter,
    sizeFilter,
    visibilityFilter,
    viewMode,
    subtopicsOnlyFilter,
    searchQuery,
  ]);

  const clearAllFilters = () => {
    setTypeFilter('all');
    setSubjectFilter('ALL');
    setBoardFilter('ALL');
    setAuthorFilter('ALL');
    setSizeFilter('all');
    setVisibilityFilter('all');
    setSubtopicsOnlyFilter(false);
    setSearchQuery('');
    setSearchScope('all');
  };

  const activeList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = currentBaseList.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false;
      if (subjectFilter !== 'ALL' && item.subjectName.trim() !== subjectFilter) return false;
      if (boardFilter !== 'ALL' && item.examBoard.trim() !== boardFilter) return false;
      if (authorFilter !== 'ALL' && (item.ownerName.trim() || 'Student') !== authorFilter) {
        return false;
      }
      if (viewMode !== 'community' && visibilityFilter !== 'all' && item.visibility !== visibilityFilter) {
        return false;
      }
      if (sizeFilter === 'small' && item.itemCount > 15) return false;
      if (sizeFilter === 'medium' && (item.itemCount < 16 || item.itemCount > 40)) return false;
      if (sizeFilter === 'large' && item.itemCount <= 40) return false;
      if (subtopicsOnlyFilter) {
        const subCount =
          item.type === 'notes'
            ? item.notesPayload?.subTopics?.length || 0
            : item.type === 'subject'
            ? item.subjectPayload?.topics.length || 0
            : 0;
        if (subCount === 0) return false;
      }

      if (!q) return true;
      const titleHay = `${item.title} ${item.summary} ${
        item.notesPayload?.topicName || ''
      } ${item.flashcardsPayload?.sectionName || ''}`.toLowerCase();
      const authorHay = item.ownerName.toLowerCase();
      const subjectHay = `${item.subjectName} ${item.examBoard} ${
        item.notesPayload?.specCode || ''
      }`.toLowerCase();
      const codeHay = item.shareCode.toLowerCase();

      if (searchScope === 'title') return titleHay.includes(q);
      if (searchScope === 'author') return authorHay.includes(q);
      if (searchScope === 'subject') return subjectHay.includes(q);
      if (searchScope === 'code') return codeHay.includes(q.replace(/^#/, ''));

      return (
        titleHay.includes(q) ||
        authorHay.includes(q) ||
        subjectHay.includes(q) ||
        codeHay.includes(q.replace(/^#/, ''))
      );
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortBy === 'popular') {
        return (b.copyCount - a.copyCount) || (Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
      }
      if (sortBy === 'largest') {
        return (b.itemCount - a.itemCount) || (Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
      }
      if (sortBy === 'title') {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === 'author') {
        return a.ownerName.localeCompare(b.ownerName) || a.title.localeCompare(b.title);
      }
      const bMs = Date.parse(b.updatedAt || b.createdAt) || 0;
      const aMs = Date.parse(a.updatedAt || a.createdAt) || 0;
      return bMs - aMs;
    });
    return sorted;
  }, [
    currentBaseList,
    typeFilter,
    subjectFilter,
    boardFilter,
    authorFilter,
    visibilityFilter,
    viewMode,
    sizeFilter,
    subtopicsOnlyFilter,
    searchQuery,
    searchScope,
    sortBy,
  ]);

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
              {isAdmin && (
                <button
                  type="button"
                  aria-pressed={viewMode === 'admin_all'}
                  onClick={() => setViewMode('admin_all')}
                  className="sd-seg-btn"
                >
                  All Shared (Admin)
                </button>
              )}
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
              onClick={() =>
                viewMode === 'mine'
                  ? void loadMine()
                  : viewMode === 'admin_all'
                  ? void loadAllShared()
                  : void loadPublic(true)
              }
              className="sd-btn px-3 py-2 text-xs whitespace-nowrap shrink-0"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${
                  loadingPublic || loadingMine || loadingAllShared ? 'animate-spin' : ''
                }`}
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

        {/* Filter & Targeted Pack/Author Search Bar */}
        <div className="sd-card space-y-3 p-4">
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

            <div className="flex min-w-[260px] flex-1 flex-wrap items-center gap-2 sm:max-w-xl sm:justify-end">
              <select
                aria-label="Search target"
                value={searchScope}
                onChange={(e) =>
                  setSearchScope(
                    e.target.value as 'all' | 'title' | 'author' | 'subject' | 'code'
                  )
                }
                className="sd-input w-auto py-1.5 text-xs font-semibold"
              >
                <option value="all">Search: All</option>
                <option value="title">Pack / Title</option>
                <option value="author">Author</option>
                <option value="subject">Subject / Board</option>
                <option value="code">Share Code</option>
              </select>

              <div className="relative min-w-[200px] flex-1">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--mute)]"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    searchScope === 'author'
                      ? 'Search specific author name…'
                      : searchScope === 'title'
                      ? 'Search specific pack, note, or deck name…'
                      : searchScope === 'subject'
                      ? 'Search subject, exam board, or spec…'
                      : searchScope === 'code'
                      ? 'Search 6-char code…'
                      : 'Search specific pack, note, author, or #code…'
                  }
                  className="sd-input py-1.5 pr-8 pl-8 text-xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer p-0.5 text-[var(--mute)] hover:text-[var(--ink)]"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              <button
                type="button"
                aria-expanded={filtersExpanded}
                onClick={() => setFiltersExpanded((v) => !v)}
                className={`sd-btn px-3 py-1.5 text-xs whitespace-nowrap shrink-0 ${
                  activeFilterCount > 0 ? 'border-[var(--e3)] text-[var(--e3)] font-semibold' : ''
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
              </button>
            </div>
          </div>

          {filtersExpanded && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] pt-3">
              <select
                aria-label="Filter by subject"
                value={subjectFilter}
                onChange={(e) => setSubjectFilter(e.target.value)}
                className="sd-input w-auto max-w-[190px] py-1.5 text-xs"
              >
                <option value="ALL">All Subjects ({filterFacets.subjects.length})</option>
                {filterFacets.subjects.map((subj) => (
                  <option key={subj} value={subj}>
                    {subj}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by exam board"
                value={boardFilter}
                onChange={(e) => setBoardFilter(e.target.value)}
                className="sd-input w-auto max-w-[175px] py-1.5 text-xs"
              >
                <option value="ALL">All Boards</option>
                {filterFacets.boards.map((board) => (
                  <option key={board} value={board}>
                    {board}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by author"
                value={authorFilter}
                onChange={(e) => setAuthorFilter(e.target.value)}
                className="sd-input w-auto max-w-[200px] py-1.5 text-xs"
              >
                <option value="ALL">All Authors ({filterFacets.authors.length})</option>
                {filterFacets.authors.map(([author, cnt]) => (
                  <option key={author} value={author}>
                    {author} ({cnt})
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by pack size"
                value={sizeFilter}
                onChange={(e) =>
                  setSizeFilter(e.target.value as 'all' | 'small' | 'medium' | 'large')
                }
                className="sd-input w-auto py-1.5 text-xs"
              >
                <option value="all">Any Size</option>
                <option value="small">Quick (1–15 items)</option>
                <option value="medium">Standard (16–40 items)</option>
                <option value="large">Deep Pack (40+ items)</option>
              </select>

              {viewMode !== 'community' && (
                <select
                  aria-label="Filter by visibility"
                  value={visibilityFilter}
                  onChange={(e) =>
                    setVisibilityFilter(e.target.value as 'all' | 'public' | 'unlisted')
                  }
                  className="sd-input w-auto py-1.5 text-xs"
                >
                  <option value="all">All Visibility</option>
                  <option value="public">Public Only</option>
                  <option value="unlisted">Code Only</option>
                </select>
              )}

              <button
                type="button"
                aria-pressed={subtopicsOnlyFilter}
                onClick={() => setSubtopicsOnlyFilter((v) => !v)}
                className={`sd-btn px-3 py-1.5 text-xs whitespace-nowrap shrink-0 ${
                  subtopicsOnlyFilter
                    ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--card))] font-semibold text-[var(--e3)]'
                    : 'text-[var(--mute)]'
                }`}
              >
                Multi-topic Packs
              </button>

              <div className="ml-auto flex items-center gap-2">
                <select
                  aria-label="Sort shared items"
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(
                      e.target.value as 'recent' | 'popular' | 'largest' | 'title' | 'author'
                    )
                  }
                  className="sd-input w-auto py-1.5 text-xs font-semibold"
                >
                  <option value="recent">Sort: Newest</option>
                  <option value="popular">Sort: Most Copied</option>
                  <option value="largest">Sort: Most Items</option>
                  <option value="title">Sort: Title A–Z</option>
                  <option value="author">Sort: Author A–Z</option>
                </select>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)]">
            <span className="font-mono-num tabular-nums">
              Showing {activeList.length} of {currentBaseList.length} shared pack
              {currentBaseList.length === 1 ? '' : 's'}
              {authorFilter !== 'ALL' ? ` · Author: ${authorFilter}` : ''}
              {subjectFilter !== 'ALL' ? ` · Subject: ${subjectFilter}` : ''}
            </span>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="cursor-pointer font-semibold text-[var(--e3)] hover:underline whitespace-nowrap"
              >
                Reset filters
              </button>
            )}
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
        ) : (viewMode === 'community' && loadingPublic) ||
          (viewMode === 'admin_all' && loadingAllShared) ||
          (viewMode === 'mine' && loadingMine) ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="sd-card h-44 animate-pulse p-5" />
            ))}
          </div>
        ) : activeList.length === 0 ? (
          <div className="sd-card p-10 text-center">
            <Globe className="mx-auto mb-2 h-6 w-6 text-[var(--mute)]" aria-hidden="true" />
            <h2 className="font-display text-base font-bold text-[var(--ink)]">
              {viewMode === 'mine'
                ? 'You have not shared any items yet'
                : viewMode === 'admin_all'
                ? 'No shared resources found across users'
                : 'No matching shared resources'}
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
                      <div className="flex items-center gap-1.5">
                        {item.visibility === 'unlisted' && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--mute)]"
                            title="Shared via code / link only"
                          >
                            <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>Code Only</span>
                          </span>
                        )}
                        <span className="font-mono-num text-[11px] font-bold text-[var(--mute)]">
                          #{item.shareCode}
                        </span>
                      </div>
                    </div>

                    <h2 className="font-display mt-2 text-base font-bold text-[var(--ink)]">
                      {item.title}
                    </h2>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold text-[var(--mute)]">
                      <span>
                        {item.subjectName} · {item.examBoard}
                      </span>
                      {item.type === 'notes' &&
                        (item.notesPayload?.subTopics?.length || 0) > 0 && (
                          <span className="font-bold text-[var(--e3)]">
                            +{item.notesPayload!.subTopics!.length} sub-topic
                            {item.notesPayload!.subTopics!.length === 1 ? '' : 's'}
                          </span>
                        )}
                    </div>
                    {item.summary && (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-[var(--mute)]">
                        {item.summary}
                      </p>
                    )}
                  </div>

                  <div className="mt-4 space-y-2.5 border-t border-[var(--line)] pt-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--mute)]">
                        <button
                          type="button"
                          onClick={() => {
                            const author = item.ownerName.trim() || 'Student';
                            setAuthorFilter((cur) => (cur === author ? 'ALL' : author));
                          }}
                          title={
                            authorFilter === (item.ownerName.trim() || 'Student')
                              ? 'Show all authors'
                              : `Show all packs by ${item.ownerName}`
                          }
                          className={`truncate text-left cursor-pointer hover:underline ${
                            authorFilter === (item.ownerName.trim() || 'Student')
                              ? 'font-bold text-[var(--e3)]'
                              : ''
                          }`}
                        >
                          By {item.ownerName}
                        </button>
                        <span className="font-mono-num shrink-0 tabular-nums">
                          {item.itemCount} item{item.itemCount === 1 ? '' : 's'} · {item.copyCount} uses
                        </span>
                      </div>
                      <div
                        className="flex items-center gap-1.5 text-[11px] text-[var(--mute)]"
                        title={formatFullDateTime(item.updatedAt || item.createdAt)}
                      >
                        <Clock className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>Updated {formatLastUpdated(item.updatedAt || item.createdAt)}</span>
                      </div>
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
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--mute)]">
                  <span>
                    {previewItem.subjectName} · {previewItem.examBoard} · Shared by{' '}
                    {previewItem.ownerName}
                  </span>
                  {previewItem.type === 'notes' &&
                    (previewItem.notesPayload?.subTopics?.length || 0) > 0 && (
                      <span className="font-bold text-[var(--e3)]">
                        · +{previewItem.notesPayload!.subTopics!.length} sub-topic
                        {previewItem.notesPayload!.subTopics!.length === 1 ? '' : 's'}
                      </span>
                    )}
                  <span
                    className="inline-flex items-center gap-1"
                    title={formatFullDateTime(previewItem.updatedAt || previewItem.createdAt)}
                  >
                    <span>
                      · Last updated {formatFullDateTime(previewItem.updatedAt || previewItem.createdAt)}
                    </span>
                  </span>
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
              {previewItem.type === 'notes' && previewItem.notesPayload && (() => {
                const subTopics = previewItem.notesPayload.subTopics || [];
                const activeSub =
                  previewSubTopicIdx >= 0 && previewSubTopicIdx < subTopics.length
                    ? subTopics[previewSubTopicIdx]
                    : null;
                return (
                  <div className="space-y-4">
                    {subTopics.length > 0 && (
                      <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                          Included Topics ({subTopics.length + 1}) · Preview before copying
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPreviewSubTopicIdx(-1)}
                            className={`sd-btn px-3 py-1.5 text-xs ${
                              previewSubTopicIdx === -1
                                ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] font-bold text-[var(--ink)]'
                                : 'text-[var(--mute)]'
                            }`}
                          >
                            Main: {previewItem.notesPayload.topicName}
                          </button>
                          {subTopics.map((st, idx) => (
                            <button
                              key={st.oldId || idx}
                              type="button"
                              onClick={() => setPreviewSubTopicIdx(idx)}
                              className={`sd-btn px-3 py-1.5 text-xs ${
                                previewSubTopicIdx === idx
                                  ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_12%,var(--card))] font-bold text-[var(--ink)]'
                                  : 'text-[var(--mute)]'
                              }`}
                            >
                              ↳ {st.topicName}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <StructuredNoteReader
                      notes={activeSub ? activeSub.notes : previewItem.notesPayload.notes}
                      timelineEvents={
                        activeSub
                          ? activeSub.timelineEvents
                          : previewItem.notesPayload.timelineEvents
                      }
                    />
                  </div>
                );
              })()}

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
