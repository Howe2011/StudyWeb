import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  CheckCircle2,
  GripVertical,
  Heading2,
  Layers,
  List,
  Plus,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react';
import { makeNoteId } from '../lib/noteFormat';
import { NoteSectionBlock, StructuredNoteData } from '../types';

export type NotionBlockType =
  | 'summary'
  | 'heading'
  | 'bullet'
  | 'paragraph'
  | 'key_term'
  | 'worked_example'
  | 'exam_tip';

export interface NotionBlock {
  id: string;
  type: NotionBlockType;
  text: string;
  extra?: string;
}

const SLASH_OPTIONS: Array<{
  type: NotionBlockType;
  label: string;
  hint: string;
  keywords: string;
}> = [
  {
    type: 'heading',
    label: 'Heading',
    hint: 'Major specification sub-heading',
    keywords: 'heading h2 title section',
  },
  {
    type: 'bullet',
    label: 'Bullet Point',
    hint: 'Concise exam fact (use **bold** for emphasis)',
    keywords: 'bullet list point fact',
  },
  {
    type: 'paragraph',
    label: 'Text Paragraph',
    hint: 'Plain explanatory text block',
    keywords: 'text paragraph body note',
  },
  {
    type: 'key_term',
    label: 'Key Term & Definition',
    hint: '2-column glossary row (can turn into flashcards)',
    keywords: 'term definition vocab glossary flashcard',
  },
  {
    type: 'summary',
    label: 'Topic Overview',
    hint: 'Top syllabus summary callout box',
    keywords: 'summary overview intro callout',
  },
  {
    type: 'worked_example',
    label: 'Worked Example',
    hint: 'Step-by-step calculation or model answer',
    keywords: 'worked example model calculation answer',
  },
  {
    type: 'exam_tip',
    label: 'Examiner Tip',
    hint: 'Mark-scheme trap or common mistake',
    keywords: 'examiner tip warning mark scheme',
  },
];

function blockTypeIcon(type: NotionBlockType) {
  switch (type) {
    case 'heading':
      return <Heading2 className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'bullet':
      return <List className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'paragraph':
      return <Type className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'key_term':
      return <Layers className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'summary':
      return <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'worked_example':
      return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'exam_tip':
      return <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
}

export function structuredNoteToBlocks(note: StructuredNoteData): NotionBlock[] {
  const blocks: NotionBlock[] = [];

  if (note.summary && note.summary.trim()) {
    blocks.push({
      id: makeNoteId('blk'),
      type: 'summary',
      text: note.summary,
    });
  }

  for (const sec of note.sections || []) {
    if (sec.heading.trim() || (sec.points && sec.points.length > 0)) {
      blocks.push({
        id: sec.id || makeNoteId('blk'),
        type: 'heading',
        text: sec.heading,
      });
    }
    for (const pt of sec.points || []) {
      const isParagraph = pt.startsWith('¶ ');
      blocks.push({
        id: makeNoteId('blk'),
        type: isParagraph ? 'paragraph' : 'bullet',
        text: isParagraph ? pt.slice(2) : pt,
      });
    }
  }

  for (const kt of note.keyTerms || []) {
    blocks.push({
      id: kt.id || makeNoteId('term'),
      type: 'key_term',
      text: kt.term,
      extra: kt.definition,
    });
  }

  if (note.workedExample && note.workedExample.trim()) {
    blocks.push({
      id: makeNoteId('blk'),
      type: 'worked_example',
      text: note.workedExample,
    });
  }

  if (note.examTip && note.examTip.trim()) {
    blocks.push({
      id: makeNoteId('blk'),
      type: 'exam_tip',
      text: note.examTip,
    });
  }

  if (blocks.length === 0) {
    blocks.push({
      id: makeNoteId('blk'),
      type: 'bullet',
      text: '',
    });
  }

  return blocks;
}

export function blocksToStructuredNote(
  blocks: NotionBlock[],
  prevNote: StructuredNoteData
): StructuredNoteData {
  const summaries: string[] = [];
  const sections: NoteSectionBlock[] = [];
  const keyTerms: Array<{ id: string; term: string; definition: string }> = [];
  const examples: string[] = [];
  const tips: string[] = [];

  let currentSection: NoteSectionBlock | null = null;

  for (const b of blocks) {
    if (b.type === 'summary') {
      summaries.push(b.text);
    } else if (b.type === 'heading') {
      currentSection = {
        id: b.id,
        heading: b.text,
        points: [],
      };
      sections.push(currentSection);
    } else if (b.type === 'bullet' || b.type === 'paragraph') {
      const clean = b.text;
      if (!currentSection) {
        currentSection = {
          id: makeNoteId('sec'),
          heading: 'Key Notes',
          points: [],
        };
        sections.push(currentSection);
      }
      if (clean.trim().length > 0) {
        currentSection.points.push(b.type === 'paragraph' ? `¶ ${clean}` : clean);
      }
    } else if (b.type === 'key_term') {
      if (b.text.trim() || (b.extra || '').trim()) {
        keyTerms.push({
          id: b.id,
          term: b.text,
          definition: b.extra || '',
        });
      }
    } else if (b.type === 'worked_example') {
      examples.push(b.text);
    } else if (b.type === 'exam_tip') {
      tips.push(b.text);
    }
  }

  return {
    ...prevNote,
    summary: summaries.join('\n\n').trim(),
    sections: sections.filter((s) => s.heading.trim() || s.points.length > 0),
    keyTerms,
    workedExample: examples.join('\n\n').trim(),
    examTip: tips.join('\n\n').trim(),
    updatedAt: new Date().toISOString(),
  };
}

interface NotionTopicEditorProps {
  topicId: string;
  topicName: string;
  specCode?: string;
  parentTopicId?: string;
  parentTopicOptions?: Array<{ id: string; label: string }>;
  notes: StructuredNoteData;
  onChangeTopicMeta: (fields: {
    name?: string;
    specCode?: string;
    parentTopicId?: string;
  }) => void;
  onChangeNotes: (nextNotes: StructuredNoteData) => void;
  onMakeFlashcards: () => void;
}

export function NotionTopicEditor({
  topicId,
  topicName,
  specCode,
  parentTopicId,
  parentTopicOptions,
  notes,
  onChangeTopicMeta,
  onChangeNotes,
  onMakeFlashcards,
}: NotionTopicEditorProps) {
  const [blocks, setBlocks] = useState<NotionBlock[]>(() => structuredNoteToBlocks(notes));
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [openMenuBlockId, setOpenMenuBlockId] = useState<string | null>(null);
  const [slashBlockId, setSlashBlockId] = useState<string | null>(null);
  const [slashHighlightIdx, setSlashHighlightIdx] = useState(0);

  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const latestNotesRef = useRef(notes);
  latestNotesRef.current = notes;

  // Resync blocks cleanly only when switching to a different topic
  useEffect(() => {
    setBlocks(structuredNoteToBlocks(latestNotesRef.current));
    setFocusedBlockId(null);
    setOpenMenuBlockId(null);
    setSlashBlockId(null);
  }, [topicId]);

  const registerInputRef = (id: string, el: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  };

  const focusBlock = (id: string) => {
    setFocusedBlockId(id);
    requestAnimationFrame(() => {
      const el = inputRefs.current.get(id);
      if (el) {
        el.focus();
        const len = el.value.length;
        try {
          el.setSelectionRange(len, len);
        } catch {
          // ignore
        }
      }
    });
  };

  const commitBlocks = (next: NotionBlock[]) => {
    const safe =
      next.length > 0 ? next : [{ id: makeNoteId('blk'), type: 'bullet' as const, text: '' }];
    setBlocks(safe);
    onChangeNotes(blocksToStructuredNote(safe, notes));
  };

  const insertBlockAfter = (
    afterIdx: number,
    type: NotionBlockType,
    initialText = ''
  ): string => {
    const created: NotionBlock = {
      id: makeNoteId(type === 'key_term' ? 'term' : 'blk'),
      type,
      text: initialText,
      extra: type === 'key_term' ? '' : undefined,
    };
    const next = [...blocks.slice(0, afterIdx + 1), created, ...blocks.slice(afterIdx + 1)];
    commitBlocks(next);
    focusBlock(created.id);
    return created.id;
  };

  const updateBlock = (id: string, patch: Partial<NotionBlock>) => {
    const next = blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    commitBlocks(next);
  };

  const changeBlockType = (id: string, nextType: NotionBlockType, clearSlash = false) => {
    const next = blocks.map((b) => {
      if (b.id !== id) return b;
      const cleanedText = clearSlash && b.text.startsWith('/') ? '' : b.text;
      return {
        ...b,
        type: nextType,
        text: cleanedText,
        extra: nextType === 'key_term' ? b.extra ?? '' : undefined,
      };
    });
    commitBlocks(next);
    setSlashBlockId(null);
    setOpenMenuBlockId(null);
    focusBlock(id);
  };

  const deleteBlockAt = (idx: number) => {
    if (blocks.length <= 1) {
      commitBlocks([{ id: makeNoteId('blk'), type: 'bullet', text: '' }]);
      return;
    }
    const prevBlock = blocks[Math.max(0, idx - 1)];
    const next = blocks.filter((_, i) => i !== idx);
    commitBlocks(next);
    if (prevBlock) focusBlock(prevBlock.id);
  };

  const moveBlock = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(idx, 1);
    next.splice(target, 0, moved);
    commitBlocks(next);
    setOpenMenuBlockId(null);
  };

  const activeSlashBlock = useMemo(
    () => blocks.find((b) => b.id === slashBlockId) || null,
    [blocks, slashBlockId]
  );

  const filteredSlashOptions = useMemo(() => {
    if (!activeSlashBlock || !activeSlashBlock.text.startsWith('/')) return SLASH_OPTIONS;
    const query = activeSlashBlock.text.slice(1).trim().toLowerCase();
    if (!query) return SLASH_OPTIONS;
    return SLASH_OPTIONS.filter(
      (opt) =>
        opt.label.toLowerCase().includes(query) || opt.keywords.includes(query)
    );
  }, [activeSlashBlock]);

  const handleBlockKeyDown = (
    e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    block: NotionBlock,
    idx: number
  ) => {
    const slashVisible = slashBlockId === block.id && block.text.startsWith('/');

    if (slashVisible && filteredSlashOptions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashHighlightIdx((i) => (i + 1) % filteredSlashOptions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashHighlightIdx(
          (i) => (i - 1 + filteredSlashOptions.length) % filteredSlashOptions.length
        );
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const chosen = filteredSlashOptions[slashHighlightIdx] || filteredSlashOptions[0];
        if (chosen) changeBlockType(block.id, chosen.type, true);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashBlockId(null);
        return;
      }
    }

    // Enter creates next block smoothly for single-line Notion blocks (Shift+Enter allows newline in multiline)
    if (
      e.key === 'Enter' &&
      !e.shiftKey &&
      (block.type === 'heading' ||
        block.type === 'bullet' ||
        block.type === 'paragraph' ||
        block.type === 'key_term')
    ) {
      e.preventDefault();
      const nextType: NotionBlockType =
        block.type === 'heading'
          ? 'bullet'
          : block.type === 'key_term'
          ? 'key_term'
          : block.type;
      insertBlockAfter(idx, nextType);
      return;
    }

    // Backspace on empty block deletes it and returns focus to previous block
    if (
      e.key === 'Backspace' &&
      block.text === '' &&
      (!block.extra || block.extra === '') &&
      blocks.length > 1
    ) {
      e.preventDefault();
      deleteBlockAt(idx);
      return;
    }

    // ArrowUp / ArrowDown navigation on empty or single-line inputs
    if (e.key === 'ArrowUp' && !e.shiftKey && idx > 0) {
      const el = e.currentTarget;
      if (el.selectionStart === 0 && el.selectionEnd === 0) {
        e.preventDefault();
        focusBlock(blocks[idx - 1].id);
      }
    } else if (e.key === 'ArrowDown' && !e.shiftKey && idx < blocks.length - 1) {
      const el = e.currentTarget;
      if (el.selectionStart === el.value.length) {
        e.preventDefault();
        focusBlock(blocks[idx + 1].id);
      }
    }
  };

  const validTermsCount = blocks.filter(
    (b) => b.type === 'key_term' && b.text.trim() && (b.extra || '').trim()
  ).length;

  return (
    <div className="sd-card px-5 py-6 sm:px-9 sm:py-8">
      {/* Notion-style Borderless Page Header */}
      <div className="space-y-2 border-b border-[var(--line)] pb-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)]">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span>Spec Code:</span>
              <input
                type="text"
                value={specCode || ''}
                onChange={(e) => onChangeTopicMeta({ specCode: e.target.value })}
                placeholder="e.g. 4.1.2"
                className="font-mono-num w-24 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-[var(--ink)] outline-none transition-colors hover:border-[var(--line)] focus:border-[var(--e3)] focus:bg-[var(--bg)]"
              />
            </div>
            {parentTopicOptions && parentTopicOptions.length > 0 && (
              <label className="flex items-center gap-1.5">
                <span>Parent:</span>
                <select
                  value={parentTopicId || ''}
                  onChange={(e) => onChangeTopicMeta({ parentTopicId: e.target.value })}
                  className="max-w-[200px] cursor-pointer rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-medium text-[var(--ink)] outline-none transition-colors hover:border-[var(--line)] focus:border-[var(--e3)] focus:bg-[var(--bg)]"
                >
                  <option value="">Top-level topic</option>
                  {parentTopicOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <span className="text-[11px] text-[var(--mute)]">
            Type <kbd className="rounded border border-[var(--line)] px-1 font-mono-num">/</kbd> for
            blocks · <kbd className="rounded border border-[var(--line)] px-1 font-mono-num">Enter</kbd>{' '}
            for next line · <span className="font-semibold">**bold**</span>
          </span>
        </div>

        <input
          type="text"
          value={topicName}
          onChange={(e) => onChangeTopicMeta({ name: e.target.value })}
          placeholder="Untitled Topic"
          className="font-display w-full border-0 bg-transparent p-0 text-2xl font-extrabold tracking-tight text-[var(--ink)] outline-none sm:text-3xl"
        />
      </div>

      {/* Notion Block Canvas */}
      <div className="mt-5 space-y-1.5">
        {blocks.map((block, idx) => {
          const isFocused = focusedBlockId === block.id || openMenuBlockId === block.id;
          const showSlash =
            slashBlockId === block.id && block.text.startsWith('/') && !block.text.includes('\n');

          return (
            <div
              key={block.id}
              className="group relative flex items-start gap-1.5 rounded-lg py-0.5 transition-colors"
            >
              {/* Left Notion Hover Gutter */}
              <div
                className={`flex w-12 shrink-0 items-center justify-end gap-0.5 pt-1.5 transition-opacity ${
                  isFocused ? 'opacity-100' : 'opacity-40 sm:opacity-0 sm:group-hover:opacity-100'
                }`}
              >
                <button
                  type="button"
                  title="Add block below"
                  aria-label="Add block below"
                  onClick={() => insertBlockAfter(idx, 'bullet', '/')}
                  className="flex h-6 w-5 cursor-pointer items-center justify-center rounded text-[var(--mute)] hover:bg-[var(--bg)] hover:text-[var(--ink)]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="Block options"
                  aria-label="Block options"
                  onClick={() =>
                    setOpenMenuBlockId((cur) => (cur === block.id ? null : block.id))
                  }
                  className="flex h-6 w-5 cursor-pointer items-center justify-center rounded text-[var(--mute)] hover:bg-[var(--bg)] hover:text-[var(--ink)]"
                >
                  <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* Block Context Popover Menu */}
              {openMenuBlockId === block.id && (
                <div className="absolute left-12 top-8 z-30 w-56 rounded-xl border border-[var(--line)] bg-[var(--card)] p-1.5 shadow-lg">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--mute)]">
                    Turn into
                  </div>
                  {SLASH_OPTIONS.map((opt) => (
                    <button
                      key={opt.type}
                      type="button"
                      onClick={() => changeBlockType(block.id, opt.type)}
                      className={`flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                        block.type === opt.type
                          ? 'bg-[color-mix(in_srgb,var(--e3)_14%,var(--bg))] font-bold text-[var(--ink)]'
                          : 'text-[var(--ink)] hover:bg-[var(--bg)]'
                      }`}
                    >
                      <span className="text-[var(--mute)]">{blockTypeIcon(opt.type)}</span>
                      <span>{opt.label}</span>
                    </button>
                  ))}
                  <div className="my-1 border-t border-[var(--line)]" />
                  <div className="flex items-center gap-1 px-1">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveBlock(idx, -1)}
                      className="sd-btn flex-1 py-1 text-[11px] disabled:opacity-40"
                    >
                      <ArrowUp className="h-3 w-3" aria-hidden="true" />
                      <span>Up</span>
                    </button>
                    <button
                      type="button"
                      disabled={idx === blocks.length - 1}
                      onClick={() => moveBlock(idx, 1)}
                      className="sd-btn flex-1 py-1 text-[11px] disabled:opacity-40"
                    >
                      <ArrowDown className="h-3 w-3" aria-hidden="true" />
                      <span>Down</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenMenuBlockId(null);
                        deleteBlockAt(idx);
                      }}
                      className="sd-btn px-2 py-1 text-[11px] text-[var(--bad)]"
                      aria-label="Delete block"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )}

              {/* Block Body */}
              <div className="relative min-w-0 flex-1">
                {block.type === 'summary' && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--e3)]">
                      Topic Overview
                    </div>
                    <textarea
                      ref={(el) => registerInputRef(block.id, el)}
                      rows={Math.max(2, Math.min(6, block.text.split('\n').length))}
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateBlock(block.id, { text: val });
                        setSlashBlockId(val.startsWith('/') ? block.id : null);
                        setSlashHighlightIdx(0);
                      }}
                      placeholder="1–2 sentence core overview of this syllabus topic…"
                      className="w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--mute)]/60"
                    />
                  </div>
                )}

                {block.type === 'heading' && (
                  <input
                    ref={(el) => registerInputRef(block.id, el)}
                    type="text"
                    value={block.text}
                    onFocus={() => setFocusedBlockId(block.id)}
                    onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateBlock(block.id, { text: val });
                      setSlashBlockId(val.startsWith('/') ? block.id : null);
                      setSlashHighlightIdx(0);
                    }}
                    placeholder="Section heading… (type '/' for block types)"
                    className="font-display mt-3 w-full border-0 bg-transparent py-1 text-lg font-bold text-[var(--ink)] outline-none placeholder:text-[var(--mute)]/60 sm:text-xl"
                  />
                )}

                {block.type === 'bullet' && (
                  <div className="flex items-start gap-2.5 py-1">
                    <span
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--ink)]"
                      aria-hidden="true"
                    />
                    <input
                      ref={(el) => registerInputRef(block.id, el)}
                      type="text"
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateBlock(block.id, { text: val });
                        setSlashBlockId(val.startsWith('/') ? block.id : null);
                        setSlashHighlightIdx(0);
                      }}
                      placeholder="Write a bullet point, or type '/' for commands…"
                      className="w-full border-0 bg-transparent text-[15px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--mute)]/60"
                    />
                  </div>
                )}

                {block.type === 'paragraph' && (
                  <textarea
                    ref={(el) => registerInputRef(block.id, el)}
                    rows={Math.max(1, Math.min(8, block.text.split('\n').length))}
                    value={block.text}
                    onFocus={() => setFocusedBlockId(block.id)}
                    onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateBlock(block.id, { text: val });
                      setSlashBlockId(val.startsWith('/') ? block.id : null);
                      setSlashHighlightIdx(0);
                    }}
                    placeholder="Write explanation text, or type '/' for commands…"
                    className="w-full resize-none border-0 bg-transparent py-1 text-[15px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--mute)]/60"
                  />
                )}

                {block.type === 'key_term' && (
                  <div className="grid gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5 sm:grid-cols-12">
                    <input
                      ref={(el) => registerInputRef(block.id, el)}
                      type="text"
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateBlock(block.id, { text: val });
                        setSlashBlockId(val.startsWith('/') ? block.id : null);
                      }}
                      placeholder="Key Term"
                      className="rounded-lg border border-transparent bg-[var(--card)] px-2.5 py-1.5 text-xs font-bold text-[var(--ink)] outline-none focus:border-[var(--e3)] sm:col-span-4"
                    />
                    <input
                      type="text"
                      value={block.extra || ''}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          insertBlockAfter(idx, 'key_term');
                        }
                      }}
                      onChange={(e) => updateBlock(block.id, { extra: e.target.value })}
                      placeholder="Clear exam definition…"
                      className="rounded-lg border border-transparent bg-[var(--card)] px-2.5 py-1.5 text-xs text-[var(--ink)] outline-none focus:border-[var(--e3)] sm:col-span-8"
                    />
                  </div>
                )}

                {block.type === 'worked_example' && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--ok)]">
                      Worked Example
                    </div>
                    <textarea
                      ref={(el) => registerInputRef(block.id, el)}
                      rows={Math.max(2, Math.min(8, block.text.split('\n').length))}
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateBlock(block.id, { text: val });
                        setSlashBlockId(val.startsWith('/') ? block.id : null);
                      }}
                      placeholder="Step-by-step calculation, quote analysis, or model answer…"
                      className="w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--mute)]/60"
                    />
                  </div>
                )}

                {block.type === 'exam_tip' && (
                  <div className="rounded-xl border border-[var(--e2)] bg-[var(--bg)] p-3.5">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--e2)]">
                      Examiner Tip
                    </div>
                    <textarea
                      ref={(el) => registerInputRef(block.id, el)}
                      rows={Math.max(2, Math.min(6, block.text.split('\n').length))}
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateBlock(block.id, { text: val });
                        setSlashBlockId(val.startsWith('/') ? block.id : null);
                      }}
                      placeholder="Common mark-scheme mistake or phrase to remember…"
                      className="w-full resize-y border-0 bg-transparent text-sm leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--mute)]/60"
                    />
                  </div>
                )}

                {/* Inline Slash Command Menu */}
                {showSlash && (
                  <div className="absolute left-0 top-full z-30 mt-1 w-72 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] p-1.5 shadow-xl">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--mute)]">
                      Insert Block
                    </div>
                    {filteredSlashOptions.length === 0 ? (
                      <div className="px-2.5 py-2 text-xs text-[var(--mute)]">
                        No matching block
                      </div>
                    ) : (
                      filteredSlashOptions.map((opt, optIdx) => (
                        <button
                          key={opt.type}
                          type="button"
                          onClick={() => changeBlockType(block.id, opt.type, true)}
                          className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                            optIdx === slashHighlightIdx
                              ? 'bg-[color-mix(in_srgb,var(--e3)_14%,var(--bg))]'
                              : 'hover:bg-[var(--bg)]'
                          }`}
                        >
                          <span className="mt-0.5 text-[var(--e3)]">
                            {blockTypeIcon(opt.type)}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-[var(--ink)]">{opt.label}</div>
                            <div className="truncate text-[11px] text-[var(--mute)]">
                              {opt.hint}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom Quick-Insert Bar & Manual Make Flashcards CTA */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--mute)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
            <span>Add block:</span>
          </span>
          {(
            [
              ['heading', 'Heading'],
              ['bullet', 'Bullet'],
              ['paragraph', 'Text'],
              ['key_term', 'Key Term'],
              ['worked_example', 'Example'],
              ['exam_tip', 'Examiner Tip'],
            ] as const
          ).map(([type, label]) => (
            <button
              key={type}
              type="button"
              onClick={() => insertBlockAfter(blocks.length - 1, type)}
              className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {validTermsCount > 0 && (
          <button
            type="button"
            onClick={onMakeFlashcards}
            className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap shrink-0"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Make Flashcards ({validTermsCount})</span>
          </button>
        )}
      </div>
    </div>
  );
}
