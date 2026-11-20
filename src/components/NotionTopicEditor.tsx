import {
  ClipboardEvent,
  DragEvent,
  KeyboardEvent,
  TextareaHTMLAttributes,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Bold,
  BookOpen,
  CheckCircle2,
  Code,
  Copy,
  GitBranch,
  GripVertical,
  Heading2,
  Heading3,
  Indent,
  Italic,
  Layers,
  List,
  Outdent,
  Quote,
  Redo2,
  Table2,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
import { NOTE_COLOR_OPTIONS, NOTE_PART_ROLE_MAP, normalizeNoteColor } from '../lib/noteColors';
import { groupSectionPoints, makeNoteId } from '../lib/noteFormat';
import { NoteAccentColor, NotePartRole, NoteSectionBlock, StructuredNoteData } from '../types';

export type NotionBlockType =
  | 'summary'
  | 'heading'
  | 'subheading'
  | 'paragraph'
  | 'bullet'
  | 'factbox'
  | 'flow'
  | 'table'
  | 'key_term'
  | 'worked_example'
  | 'exam_tip';

export interface NotionBlock {
  id: string;
  type: NotionBlockType;
  text: string;
  extra?: string;
  indent?: number;
  steps?: string[];
  rows?: string[][];
  accentColor?: NoteAccentColor;
  partRole?: NotePartRole;
}

const SLASH_OPTIONS: Array<{
  type: NotionBlockType;
  label: string;
  hint: string;
  keywords: string;
}> = [
  {
    type: 'paragraph',
    label: 'Body Text',
    hint: 'Smooth Word-style paragraph (supports **bold**, *italic*)',
    keywords: 'text paragraph body note p',
  },
  {
    type: 'heading',
    label: 'Section Heading',
    hint: 'Major topic heading (shortcut: ## )',
    keywords: 'heading h2 title section h1',
  },
  {
    type: 'subheading',
    label: 'Subheading',
    hint: 'Sub-section title (shortcut: ### )',
    keywords: 'subheading h3 subsection',
  },
  {
    type: 'bullet',
    label: 'Bullet List',
    hint: 'Indented bullet item (shortcut: - , Tab to indent)',
    keywords: 'bullet list point fact item',
  },
  {
    type: 'table',
    label: 'Table',
    hint: 'Multi-column comparison table',
    keywords: 'table grid matrix compare columns',
  },
  {
    type: 'exam_tip',
    label: 'Examiner Tip Box',
    hint: 'Mark-scheme advice or common mistake',
    keywords: 'examiner tip warning mark scheme',
  },
  {
    type: 'worked_example',
    label: 'Worked Example Box',
    hint: 'Step-by-step calculation or model answer',
    keywords: 'worked example model calculation answer',
  },
  {
    type: 'factbox',
    label: 'Fact / Formula Box',
    hint: 'Highlighted key fact, rule, or equation (shortcut: > )',
    keywords: 'fact box callout quote highlight note formula',
  },
  {
    type: 'key_term',
    label: 'Key Term & Definition',
    hint: 'Term + definition (turns into flashcards)',
    keywords: 'term definition vocab glossary flashcard',
  },
  {
    type: 'flow',
    label: 'Flow Diagram Steps',
    hint: 'Sequential cause → effect chain (shortcut: => )',
    keywords: 'flow arrow diagram process steps chain',
  },
  {
    type: 'summary',
    label: 'Topic Overview',
    hint: 'Top syllabus overview box',
    keywords: 'summary overview intro callout',
  },
];

function blockTypeIcon(type: NotionBlockType) {
  switch (type) {
    case 'heading':
      return <Heading2 className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'subheading':
      return <Heading3 className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'bullet':
      return <List className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'paragraph':
      return <Type className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'factbox':
      return <Quote className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'flow':
      return <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />;
    case 'table':
      return <Table2 className="h-3.5 w-3.5" aria-hidden="true" />;
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
        ...(sec.accentColor && sec.accentColor !== 'default' ? { accentColor: sec.accentColor } : {}),
        ...(sec.partRole ? { partRole: sec.partRole } : {}),
      });
    }
    const grouped = groupSectionPoints(sec.points || []);
    for (const item of grouped) {
      if (item.kind === 'subheading') {
        blocks.push({
          id: makeNoteId('blk'),
          type: 'subheading',
          text: item.text,
        });
      } else if (item.kind === 'paragraph') {
        blocks.push({
          id: makeNoteId('blk'),
          type: 'paragraph',
          text: item.text,
        });
      } else if (item.kind === 'bullet') {
        blocks.push({
          id: makeNoteId('blk'),
          type: 'bullet',
          text: item.text,
          indent: item.indent || 0,
        });
      } else if (item.kind === 'factbox') {
        blocks.push({
          id: makeNoteId('blk'),
          type: 'factbox',
          text: item.text,
          extra: item.title || 'Key Point',
        });
      } else if (item.kind === 'flow') {
        blocks.push({
          id: makeNoteId('blk'),
          type: 'flow',
          text: '',
          extra: item.label || '',
          steps: item.steps.length ? [...item.steps] : ['', ''],
        });
      } else if (item.kind === 'table') {
        const rows = [[...item.headers], ...item.rows.map((r) => [...r])];
        blocks.push({
          id: makeNoteId('blk'),
          type: 'table',
          text: '',
          rows: rows.length >= 2 ? rows : [['Column 1', 'Column 2'], ['', '']],
        });
      }
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
      type: 'paragraph',
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

  const ensureSection = (): NoteSectionBlock => {
    if (!currentSection) {
      currentSection = {
        id: makeNoteId('sec'),
        heading: 'Key Notes',
        points: [],
      };
      sections.push(currentSection);
    }
    return currentSection;
  };

  for (const b of blocks) {
    if (b.type === 'summary') {
      summaries.push(b.text);
    } else if (b.type === 'heading') {
      currentSection = {
        id: b.id,
        heading: b.text,
        points: [],
        ...(b.accentColor && b.accentColor !== 'default' ? { accentColor: b.accentColor } : {}),
        ...(b.partRole ? { partRole: b.partRole } : {}),
      };
      sections.push(currentSection);
    } else if (b.type === 'subheading') {
      if (b.text.trim()) {
        ensureSection().points.push(`### ${b.text.trim()}`);
      }
    } else if (b.type === 'paragraph') {
      if (b.text.trim()) {
        ensureSection().points.push(`¶ ${b.text}`);
      }
    } else if (b.type === 'bullet') {
      if (b.text.trim()) {
        const prefix = (b.indent || 0) > 0 ? '↳ ' : '';
        ensureSection().points.push(`${prefix}${b.text}`);
      }
    } else if (b.type === 'factbox') {
      const body = b.text.trim();
      const title = (b.extra || '').trim();
      if (body || title) {
        ensureSection().points.push(`📌 ${title || 'Key Point'} | ${body || title}`);
      }
    } else if (b.type === 'flow') {
      const cleanSteps = (b.steps || []).map((s) => s.trim()).filter(Boolean);
      if (cleanSteps.length >= 2) {
        const label = (b.extra || '').trim();
        ensureSection().points.push(
          `${label ? `${label}: ` : ''}⇒ ${cleanSteps.join(' → ')}`
        );
      } else if (cleanSteps.length === 1) {
        ensureSection().points.push(cleanSteps[0]);
      }
    } else if (b.type === 'table') {
      const rawRows = b.rows || [];
      if (rawRows.length > 0) {
        const colCount = Math.max(1, rawRows.reduce((m, r) => Math.max(m, r.length), 1));
        const normRow = (r: string[]) =>
          `| ${Array.from({ length: colCount }, (_, i) => (r[i] || '').replace(/\|/g, '/').trim() || '—').join(' | ')} |`;
        const sec = ensureSection();
        sec.points.push(normRow(rawRows[0]));
        sec.points.push(`| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`);
        for (let r = 1; r < rawRows.length; r++) {
          if (rawRows[r].some((c) => c.trim())) {
            sec.points.push(normRow(rawRows[r]));
          }
        }
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

function AutoGrowTextarea({
  value,
  inputRef,
  minHeight = 30,
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  minHeight?: number;
  inputRef?: (el: HTMLTextAreaElement | null) => void;
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
  }, [value, minHeight]);

  return (
    <textarea
      {...props}
      ref={(el) => {
        localRef.current = el;
        inputRef?.(el);
      }}
      rows={1}
      value={value}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = 'auto';
        el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
        props.onInput?.(e);
      }}
      className={`w-full resize-none overflow-hidden border-0 bg-transparent outline-none ${className}`}
    />
  );
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

function makeDefaultBlock(type: NotionBlockType, text = ''): NotionBlock {
  return {
    id: makeNoteId(type === 'key_term' ? 'term' : 'blk'),
    type,
    text,
    indent: type === 'bullet' ? 0 : undefined,
    extra: type === 'key_term' || type === 'factbox' || type === 'flow' ? '' : undefined,
    steps: type === 'flow' ? ['', ''] : undefined,
    rows:
      type === 'table'
        ? [
            ['Feature', 'Detail'],
            ['', ''],
            ['', ''],
          ]
        : undefined,
  };
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
  const [dragBlockId, setDragBlockId] = useState<string | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);

  const historyRef = useRef<NotionBlock[][]>([blocks]);
  const historyIdxRef = useRef<number>(0);
  const [historyMeta, setHistoryMeta] = useState({ canUndo: false, canRedo: false });

  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const latestNotesRef = useRef(notes);
  latestNotesRef.current = notes;

  // Resync blocks cleanly only when switching to a different topic
  useEffect(() => {
    const initial = structuredNoteToBlocks(latestNotesRef.current);
    setBlocks(initial);
    historyRef.current = [initial];
    historyIdxRef.current = 0;
    setHistoryMeta({ canUndo: false, canRedo: false });
    setFocusedBlockId(null);
    setOpenMenuBlockId(null);
    setSlashBlockId(null);
    setDragBlockId(null);
    setDropTargetIdx(null);
  }, [topicId]);

  const registerInputRef = (id: string, el: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  };

  const focusBlock = (id: string, caretOffset?: number) => {
    setFocusedBlockId(id);
    requestAnimationFrame(() => {
      const el = inputRefs.current.get(id);
      if (el) {
        el.focus();
        const len = el.value.length;
        const pos = caretOffset !== undefined ? Math.max(0, Math.min(len, caretOffset)) : len;
        try {
          el.setSelectionRange(pos, pos);
        } catch {
          // ignore
        }
      }
    });
  };

  const syncHistoryMeta = () => {
    setHistoryMeta({
      canUndo: historyIdxRef.current > 0,
      canRedo: historyIdxRef.current < historyRef.current.length - 1,
    });
  };

  const commitBlocks = (next: NotionBlock[], recordHistory = true) => {
    const safe = next.length > 0 ? next : [makeDefaultBlock('paragraph', '')];
    setBlocks(safe);
    onChangeNotes(blocksToStructuredNote(safe, notes));

    if (recordHistory) {
      const truncated = historyRef.current.slice(0, historyIdxRef.current + 1);
      truncated.push(safe);
      if (truncated.length > 60) truncated.shift();
      historyRef.current = truncated;
      historyIdxRef.current = truncated.length - 1;
      syncHistoryMeta();
    }
  };

  const handleUndo = () => {
    if (historyIdxRef.current <= 0) return;
    historyIdxRef.current -= 1;
    const snap = historyRef.current[historyIdxRef.current];
    setBlocks(snap);
    onChangeNotes(blocksToStructuredNote(snap, notes));
    syncHistoryMeta();
  };

  const handleRedo = () => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    historyIdxRef.current += 1;
    const snap = historyRef.current[historyIdxRef.current];
    setBlocks(snap);
    onChangeNotes(blocksToStructuredNote(snap, notes));
    syncHistoryMeta();
  };

  const insertBlockAfter = (
    afterIdx: number,
    type: NotionBlockType,
    initialText = '',
    indent = 0
  ): string => {
    const created = makeDefaultBlock(type, initialText);
    if (type === 'bullet') created.indent = indent;
    const next = [...blocks.slice(0, afterIdx + 1), created, ...blocks.slice(afterIdx + 1)];
    commitBlocks(next);
    focusBlock(created.id, initialText ? 0 : undefined);
    return created.id;
  };

  const insertFromRibbon = (type: NotionBlockType) => {
    const focusedIdx = focusedBlockId
      ? blocks.findIndex((b) => b.id === focusedBlockId)
      : -1;
    const targetIdx = focusedIdx >= 0 ? focusedIdx : blocks.length - 1;
    const cur = blocks[targetIdx];
    // If cursor is on an empty plain paragraph, turn it directly into the requested block
    if (
      cur &&
      cur.type === 'paragraph' &&
      !cur.text.trim() &&
      focusedIdx >= 0
    ) {
      changeBlockType(cur.id, type, true);
      return;
    }
    insertBlockAfter(targetIdx, type);
  };

  const updateBlock = (id: string, patch: Partial<NotionBlock>) => {
    const next = blocks.map((b) => (b.id === id ? { ...b, ...patch } : b));
    commitBlocks(next);
  };

  const duplicateBlockAt = (idx: number) => {
    const src = blocks[idx];
    if (!src) return;
    const clone: NotionBlock = {
      ...src,
      id: makeNoteId(src.type === 'key_term' ? 'term' : 'blk'),
      steps: src.steps ? [...src.steps] : undefined,
      rows: src.rows ? src.rows.map((r) => [...r]) : undefined,
    };
    const next = [...blocks.slice(0, idx + 1), clone, ...blocks.slice(idx + 1)];
    commitBlocks(next);
    setOpenMenuBlockId(null);
    focusBlock(clone.id);
  };

  const changeBlockType = (id: string, nextType: NotionBlockType, clearSlash = false) => {
    const next = blocks.map((b) => {
      if (b.id !== id) return b;
      const cleanedText = clearSlash && b.text.startsWith('/') ? '' : b.text;
      const base = makeDefaultBlock(nextType, cleanedText);
      return {
        ...base,
        id: b.id,
        extra:
          nextType === 'key_term' || nextType === 'factbox' || nextType === 'flow'
            ? b.extra ?? ''
            : undefined,
        steps:
          nextType === 'flow'
            ? b.steps?.length
              ? b.steps
              : cleanedText
              ? [cleanedText, '']
              : ['', '']
            : undefined,
        rows: nextType === 'table' ? (b.rows?.length ? b.rows : base.rows) : undefined,
      };
    });
    commitBlocks(next);
    setSlashBlockId(null);
    setOpenMenuBlockId(null);
    if (nextType !== 'table' && nextType !== 'flow') {
      focusBlock(id);
    }
  };

  const deleteBlockAt = (idx: number) => {
    if (blocks.length <= 1) {
      commitBlocks([makeDefaultBlock('paragraph', '')]);
      return;
    }
    const prevBlock = blocks[Math.max(0, idx - 1)];
    const next = blocks.filter((_, i) => i !== idx);
    commitBlocks(next);
    if (prevBlock) focusBlock(prevBlock.id);
  };

  const moveBlock = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= blocks.length || fromIdx === toIdx) return;
    const next = [...blocks];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    commitBlocks(next);
    setOpenMenuBlockId(null);
  };

  const activeBlock = useMemo(
    () => blocks.find((b) => b.id === focusedBlockId) || blocks[0] || null,
    [blocks, focusedBlockId]
  );

  const setActiveBlockStyle = (nextType: NotionBlockType) => {
    if (!activeBlock) return;
    changeBlockType(activeBlock.id, nextType);
  };

  const adjustActiveBulletIndent = (delta: 1 | -1) => {
    if (!activeBlock) return;
    if (activeBlock.type === 'paragraph' && delta === 1) {
      updateBlock(activeBlock.id, { type: 'bullet', indent: 0 });
      focusBlock(activeBlock.id);
      return;
    }
    if (activeBlock.type === 'bullet') {
      const cur = activeBlock.indent || 0;
      const nextIndent = Math.max(0, Math.min(2, cur + delta));
      updateBlock(activeBlock.id, { indent: nextIndent });
      focusBlock(activeBlock.id);
    }
  };

  const applyInlineWrap = (prefix: string, suffix = prefix) => {
    const targetId = focusedBlockId || blocks[0]?.id;
    if (!targetId) return;
    const el = inputRefs.current.get(targetId);
    const blk = blocks.find((b) => b.id === targetId);
    if (!el || !blk) return;

    const start = el.selectionStart ?? blk.text.length;
    const end = el.selectionEnd ?? blk.text.length;
    const selected = blk.text.slice(start, end);
    const wrapped = selected ? `${prefix}${selected}${suffix}` : `${prefix}text${suffix}`;
    const nextText = blk.text.slice(0, start) + wrapped + blk.text.slice(end);
    updateBlock(targetId, { text: nextText });
    requestAnimationFrame(() => {
      const updated = inputRefs.current.get(targetId);
      if (updated) {
        updated.focus();
        const selStart = start + prefix.length;
        const selEnd = selected ? selStart + selected.length : selStart + 4;
        updated.setSelectionRange(selStart, selEnd);
      }
    });
  };

  const insertArrowAtCursor = () => {
    const targetId = focusedBlockId || blocks[0]?.id;
    if (!targetId) return;
    const el = inputRefs.current.get(targetId);
    const blk = blocks.find((b) => b.id === targetId);
    if (!el || !blk) return;
    const pos = el.selectionStart ?? blk.text.length;
    const nextText = blk.text.slice(0, pos) + ' → ' + blk.text.slice(pos);
    updateBlock(targetId, { text: nextText });
    focusBlock(targetId, pos + 3);
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

  const handleTextChangeWithShortcuts = (block: NotionBlock, rawVal: string) => {
    if (block.type === 'paragraph' || block.type === 'bullet') {
      if (rawVal === '## ' || rawVal === '# ') {
        const next = blocks.map((b) =>
          b.id === block.id ? { ...makeDefaultBlock('heading', ''), id: b.id } : b
        );
        commitBlocks(next);
        focusBlock(block.id);
        return;
      }
      if (rawVal === '### ') {
        const next = blocks.map((b) =>
          b.id === block.id ? { ...makeDefaultBlock('subheading', ''), id: b.id } : b
        );
        commitBlocks(next);
        focusBlock(block.id);
        return;
      }
      if (block.type === 'paragraph' && (rawVal === '- ' || rawVal === '* ')) {
        const next = blocks.map((b) =>
          b.id === block.id ? { ...makeDefaultBlock('bullet', ''), id: b.id, indent: 0 } : b
        );
        commitBlocks(next);
        focusBlock(block.id);
        return;
      }
      if (rawVal === '> ') {
        const next = blocks.map((b) =>
          b.id === block.id ? { ...makeDefaultBlock('factbox', ''), id: b.id } : b
        );
        commitBlocks(next);
        focusBlock(block.id);
        return;
      }
      if (rawVal === '=> ' || rawVal === '-> ') {
        const next = blocks.map((b) =>
          b.id === block.id ? { ...makeDefaultBlock('flow', ''), id: b.id } : b
        );
        commitBlocks(next);
        return;
      }
    }

    updateBlock(block.id, { text: rawVal });
    setSlashBlockId(rawVal.startsWith('/') ? block.id : null);
    setSlashHighlightIdx(0);
  };

  const handlePasteMultiLine = (
    e: ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    block: NotionBlock,
    idx: number
  ) => {
    const pasted = e.clipboardData?.getData('text/plain') || '';
    const lines = pasted.replace(/\r/g, '').split('\n');
    if (lines.length <= 1) return;
    if (block.type !== 'paragraph' && block.type !== 'bullet' && block.type !== 'heading') return;

    e.preventDefault();
    const newBlocks: NotionBlock[] = [];
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (/^#{1,2}\s+/.test(trimmed)) {
        newBlocks.push(makeDefaultBlock('heading', trimmed.replace(/^#{1,2}\s+/, '')));
      } else if (/^###\s+/.test(trimmed)) {
        newBlocks.push(makeDefaultBlock('subheading', trimmed.replace(/^###\s+/, '')));
      } else if (/^(?:↳\s*|  [-*•]\s+)/.test(rawLine)) {
        const nb = makeDefaultBlock('bullet', trimmed.replace(/^(?:↳|[-*•])\s*/, ''));
        nb.indent = 1;
        newBlocks.push(nb);
      } else if (/^[-*•]\s+/.test(trimmed)) {
        newBlocks.push(makeDefaultBlock('bullet', trimmed.replace(/^[-*•]\s+/, '')));
      } else {
        newBlocks.push(makeDefaultBlock('paragraph', trimmed.replace(/^¶\s*/, '')));
      }
    }

    if (newBlocks.length === 0) return;

    const currentPrefix = block.text.slice(0, e.currentTarget.selectionStart ?? block.text.length);
    const currentSuffix = block.text.slice(e.currentTarget.selectionEnd ?? block.text.length);
    if (currentPrefix.trim()) {
      newBlocks[0] = {
        ...newBlocks[0],
        text: `${currentPrefix}${newBlocks[0].text}`,
      };
    }
    if (currentSuffix.trim()) {
      const last = newBlocks[newBlocks.length - 1];
      newBlocks[newBlocks.length - 1] = {
        ...last,
        text: `${last.text}${currentSuffix}`,
      };
    }

    const replaced = [
      ...blocks.slice(0, idx),
      ...newBlocks,
      ...blocks.slice(idx + 1),
    ];
    commitBlocks(replaced);
    focusBlock(newBlocks[newBlocks.length - 1].id);
  };

  const handleBlockKeyDown = (
    e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    block: NotionBlock,
    idx: number
  ) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      applyInlineWrap('**');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      applyInlineWrap('*');
      return;
    }

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

    if (e.key === 'Tab' && (block.type === 'bullet' || block.type === 'paragraph')) {
      e.preventDefault();
      if (block.type === 'paragraph' && !e.shiftKey) {
        updateBlock(block.id, { type: 'bullet', indent: 0 });
      } else if (block.type === 'bullet') {
        const cur = block.indent || 0;
        const nextIndent = e.shiftKey ? Math.max(0, cur - 1) : Math.min(2, cur + 1);
        updateBlock(block.id, { indent: nextIndent });
      }
      return;
    }

    const splittableTypes: NotionBlockType[] = [
      'heading',
      'subheading',
      'bullet',
      'paragraph',
      'key_term',
    ];
    if (e.key === 'Enter' && !e.shiftKey && splittableTypes.includes(block.type)) {
      e.preventDefault();

      if ((block.type === 'bullet' || block.type === 'subheading') && !block.text.trim()) {
        if (block.type === 'bullet' && (block.indent || 0) > 0) {
          updateBlock(block.id, { indent: (block.indent || 0) - 1 });
        } else {
          updateBlock(block.id, { type: 'paragraph', indent: undefined });
        }
        return;
      }

      if (block.type === 'key_term') {
        insertBlockAfter(idx, 'key_term');
        return;
      }

      const el = e.currentTarget;
      const selStart = el.selectionStart ?? block.text.length;
      const selEnd = el.selectionEnd ?? selStart;
      const before = block.text.slice(0, selStart);
      const after = block.text.slice(selEnd);

      const nextType: NotionBlockType =
        block.type === 'heading' || block.type === 'subheading'
          ? 'paragraph'
          : block.type;
      const nextIndent = nextType === 'bullet' ? block.indent || 0 : 0;

      const created = makeDefaultBlock(nextType, after);
      if (nextType === 'bullet') created.indent = nextIndent;

      const updatedBlocks = blocks.map((b) =>
        b.id === block.id ? { ...b, text: before } : b
      );
      const nextList = [
        ...updatedBlocks.slice(0, idx + 1),
        created,
        ...updatedBlocks.slice(idx + 1),
      ];
      commitBlocks(nextList);
      focusBlock(created.id, 0);
      return;
    }

    if (e.key === 'Backspace') {
      const el = e.currentTarget;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;

      if (atStart) {
        if (block.type === 'bullet' && (block.indent || 0) > 0) {
          e.preventDefault();
          updateBlock(block.id, { indent: (block.indent || 0) - 1 });
          return;
        }
        if (block.text === '' && (!block.extra || block.extra === '') && blocks.length > 1) {
          e.preventDefault();
          deleteBlockAt(idx);
          return;
        }
        const prev = idx > 0 ? blocks[idx - 1] : null;
        if (
          prev &&
          (prev.type === 'paragraph' ||
            prev.type === 'bullet' ||
            prev.type === 'heading' ||
            prev.type === 'subheading') &&
          (block.type === 'paragraph' ||
            block.type === 'bullet' ||
            block.type === 'heading' ||
            block.type === 'subheading')
        ) {
          e.preventDefault();
          const joinPos = prev.text.length;
          const mergedBlocks = blocks
            .map((b) => (b.id === prev.id ? { ...b, text: prev.text + block.text } : b))
            .filter((b) => b.id !== block.id);
          commitBlocks(mergedBlocks);
          focusBlock(prev.id, joinPos);
          return;
        }
      }
    }

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

  const handleDropOnBlock = (e: DragEvent<HTMLDivElement>, targetIdx: number) => {
    e.preventDefault();
    if (!dragBlockId) return;
    const fromIdx = blocks.findIndex((b) => b.id === dragBlockId);
    if (fromIdx >= 0 && fromIdx !== targetIdx) {
      moveBlock(fromIdx, targetIdx);
    }
    setDragBlockId(null);
    setDropTargetIdx(null);
  };

  const validTermsCount = blocks.filter(
    (b) => b.type === 'key_term' && b.text.trim() && (b.extra || '').trim()
  ).length;

  const wordCount = useMemo(() => {
    const allText = blocks
      .flatMap((b) => [b.text, b.extra || '', ...(b.steps || []), ...(b.rows?.flat() || [])])
      .join(' ')
      .trim();
    return allText ? allText.split(/\s+/).filter(Boolean).length : 0;
  }, [blocks]);

  return (
    <div className="space-y-4">
      {/* Word-Like Top Formatting & 1-Click Study Ribbon */}
      <div className="sd-card sticky top-2 z-20 space-y-2 px-3.5 py-2.5 backdrop-blur">
        {/* Row 1: Text Format, Hierarchy & Inline Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              disabled={!historyMeta.canUndo}
              onClick={handleUndo}
              title="Undo (Ctrl/Cmd+Z)"
              className="sd-btn h-8 w-8 p-0 disabled:opacity-35"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={!historyMeta.canRedo}
              onClick={handleRedo}
              title="Redo (Ctrl/Cmd+Shift+Z)"
              className="sd-btn h-8 w-8 p-0 disabled:opacity-35"
            >
              <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>

            <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applyInlineWrap('**');
              }}
              title="Bold selection (Ctrl/Cmd+B)"
              className="sd-btn h-8 w-8 p-0"
            >
              <Bold className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applyInlineWrap('*');
              }}
              title="Italic selection (Ctrl/Cmd+I)"
              className="sd-btn h-8 w-8 p-0"
            >
              <Italic className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                applyInlineWrap('`');
              }}
              title="Code / Formula Highlight"
              className="sd-btn h-8 w-8 p-0"
            >
              <Code className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertArrowAtCursor();
              }}
              title="Insert arrow →"
              className="sd-btn h-8 px-2.5 text-xs font-semibold"
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Arrow</span>
            </button>

            <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden="true" />

            {/* Style Switcher for Active Paragraph/Heading/Bullet */}
            <div className="sd-seg" role="group" aria-label="Text style">
              {(
                [
                  ['paragraph', 'Text'],
                  ['heading', 'Heading'],
                  ['subheading', 'Subhead'],
                  ['bullet', 'Bullet'],
                ] as const
              ).map(([st, label]) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={activeBlock?.type === st}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setActiveBlockStyle(st);
                  }}
                  className="sd-seg-btn px-2.5 py-1 text-xs"
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                adjustActiveBulletIndent(-1);
              }}
              title="Outdent (Shift+Tab)"
              className="sd-btn h-8 w-8 p-0"
            >
              <Outdent className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                adjustActiveBulletIndent(1);
              }}
              title="Indent (Tab)"
              className="sd-btn h-8 w-8 p-0"
            >
              <Indent className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={onMakeFlashcards}
            className="sd-btn-pri px-3 py-1.5 text-xs whitespace-nowrap"
          >
            <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Make Flashcards{validTermsCount > 0 ? ` (${validTermsCount})` : ''}</span>
          </button>
        </div>

        {/* Row 2: One-Click Word Study Box Inserts */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2">
          <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
            Insert:
          </span>
          {(
            [
              ['table', 'Table', Table2],
              ['exam_tip', 'Examiner Tip', AlertCircle],
              ['worked_example', 'Worked Example', CheckCircle2],
              ['factbox', 'Fact Box', Quote],
              ['key_term', 'Key Term', Layers],
              ['flow', 'Flow Steps', GitBranch],
              ['heading', 'Section', Heading2],
            ] as const
          ).map(([type, label, Icon]) => (
            <button
              key={type}
              type="button"
              onClick={() => insertFromRibbon(type)}
              className="sd-btn px-2.5 py-1 text-xs font-semibold whitespace-nowrap"
            >
              <Icon className="h-3.5 w-3.5 text-[var(--note-accent,var(--e3))]" aria-hidden="true" />
              <span>+ {label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Seamless Flowing Word-Style Document Sheet */}
      <div className="sd-card px-5 py-7 sm:px-12 sm:py-10">
        {/* Document Header */}
        <div className="mb-6 space-y-2.5 border-b border-[var(--line)] pb-5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--mute)]">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5">
                <span>Spec:</span>
                <input
                  type="text"
                  value={specCode || ''}
                  onChange={(e) => onChangeTopicMeta({ specCode: e.target.value })}
                  placeholder="e.g. 4.1.2"
                  className="font-mono-num w-24 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-[var(--ink)] outline-none transition-colors hover:border-[var(--line)] focus:border-[var(--e3)] focus:bg-[var(--bg)]"
                />
              </label>
              {parentTopicOptions && parentTopicOptions.length > 0 && (
                <label className="flex items-center gap-1.5">
                  <span>Parent:</span>
                  <select
                    value={parentTopicId || ''}
                    onChange={(e) => onChangeTopicMeta({ parentTopicId: e.target.value })}
                    className="max-w-[220px] cursor-pointer rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs font-medium text-[var(--ink)] outline-none transition-colors hover:border-[var(--line)] focus:border-[var(--e3)] focus:bg-[var(--bg)]"
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
            <span className="font-mono-num text-[11px] text-[var(--mute)]">
              {wordCount} words
            </span>
          </div>

          <div
            className="h-1 w-14 rounded-full bg-[var(--note-accent,var(--e3))]"
            aria-hidden="true"
          />
          <input
            type="text"
            value={topicName}
            onChange={(e) => onChangeTopicMeta({ name: e.target.value })}
            placeholder="Untitled Document Topic"
            className="font-display w-full border-0 bg-transparent p-0 text-3xl font-extrabold tracking-tight text-[var(--ink)] outline-none sm:text-4xl"
          />
        </div>

        {/* Borderless Fluid Document Body */}
        <div className="space-y-2">
          {(() => {
            let activeSectionAccent: NoteAccentColor = 'default';
            return blocks.map((block, idx) => {
              if (block.type === 'heading') {
                activeSectionAccent = normalizeNoteColor(block.accentColor);
              } else if (
                block.type === 'summary' ||
                block.type === 'key_term' ||
                block.type === 'worked_example' ||
                block.type === 'exam_tip'
              ) {
                activeSectionAccent = 'default';
              }
              const blockAccent =
                block.type === 'heading'
                  ? normalizeNoteColor(block.accentColor)
                  : activeSectionAccent;
              const isFocused = focusedBlockId === block.id || openMenuBlockId === block.id;
              const showSlash =
                slashBlockId === block.id && block.text.startsWith('/') && !block.text.includes('\n');
              const isDropHere = dropTargetIdx === idx;

              return (
                <div
                  key={block.id}
                  data-note-color={blockAccent !== 'default' ? blockAccent : undefined}
                  onDragOver={(e) => {
                    if (!dragBlockId) return;
                    e.preventDefault();
                    setDropTargetIdx(idx);
                  }}
                  onDrop={(e) => handleDropOnBlock(e, idx)}
                  className={`group relative flex items-start gap-2 transition-all ${
                    isDropHere ? 'border-t-2 border-t-[var(--note-accent,var(--e3))] pt-1.5' : ''
                  } ${dragBlockId === block.id ? 'opacity-45' : ''}`}
                >
                {/* Unobtrusive Left Margin Drag/Menu Handle */}
                <div
                  className={`flex w-6 shrink-0 items-center justify-center pt-1.5 transition-opacity ${
                    isFocused
                      ? 'opacity-80'
                      : 'opacity-25 sm:opacity-0 sm:group-hover:opacity-75'
                  }`}
                >
                  <button
                    type="button"
                    draggable
                    onDragStart={() => setDragBlockId(block.id)}
                    onDragEnd={() => {
                      setDragBlockId(null);
                      setDropTargetIdx(null);
                    }}
                    title="Drag to move or click for options"
                    aria-label="Block options"
                    onClick={() =>
                      setOpenMenuBlockId((cur) => (cur === block.id ? null : block.id))
                    }
                    className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-[var(--mute)] hover:bg-[var(--bg)] hover:text-[var(--ink)] active:cursor-grabbing"
                  >
                    <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                {/* Compact Block Context Menu */}
                {openMenuBlockId === block.id && (
                  <div className="absolute left-7 top-8 z-30 max-h-80 w-60 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--card)] p-1.5 shadow-xl">
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
                    {block.type === 'heading' && (
                      <>
                        <div className="my-1 border-t border-[var(--line)]" />
                        <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--mute)]">
                          Section Colour
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 px-2 pb-1.5 pt-0.5">
                          {NOTE_COLOR_OPTIONS.map((opt) => {
                            const selected = normalizeNoteColor(block.accentColor) === opt.id;
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                title={opt.label}
                                aria-label={`Set section colour to ${opt.label}`}
                                onClick={() => {
                                  updateBlock(block.id, {
                                    accentColor: opt.id === 'default' ? undefined : opt.id,
                                  });
                                  setOpenMenuBlockId(null);
                                }}
                                className={`h-5 w-5 cursor-pointer rounded-full border transition-transform hover:scale-110 ${
                                  selected
                                    ? 'border-[var(--ink)] ring-2 ring-[var(--ink)]/25'
                                    : 'border-black/15'
                                }`}
                                style={{ backgroundColor: opt.swatch }}
                              />
                            );
                          })}
                        </div>
                      </>
                    )}
                    <div className="my-1 border-t border-[var(--line)]" />
                    <div className="flex items-center gap-1 px-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveBlock(idx, idx - 1)}
                        className="sd-btn flex-1 py-1 text-[11px] disabled:opacity-40"
                      >
                        <ArrowUp className="h-3 w-3" aria-hidden="true" />
                        <span>Up</span>
                      </button>
                      <button
                        type="button"
                        disabled={idx === blocks.length - 1}
                        onClick={() => moveBlock(idx, idx + 1)}
                        className="sd-btn flex-1 py-1 text-[11px] disabled:opacity-40"
                      >
                        <ArrowDown className="h-3 w-3" aria-hidden="true" />
                        <span>Down</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicateBlockAt(idx)}
                        title="Duplicate"
                        className="sd-btn px-2 py-1 text-[11px]"
                      >
                        <Copy className="h-3 w-3" aria-hidden="true" />
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

                {/* Block Content */}
                <div className="relative min-w-0 flex-1">
                  {block.type === 'summary' && (
                    <div className="my-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--note-accent,var(--e3))_28%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent,var(--e3))_7%,var(--card))] px-5 py-4">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-bold text-[var(--note-accent,var(--e3))]">
                          Topic Overview
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteBlockAt(idx)}
                          aria-label="Remove Topic Overview"
                          className="cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      <AutoGrowTextarea
                        inputRef={(el) => registerInputRef(block.id, el)}
                        value={block.text}
                        minHeight={36}
                        onFocus={() => setFocusedBlockId(block.id)}
                        onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                        onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                        placeholder="Short 1–2 sentence topic summary…"
                        className="text-[16.5px] leading-[1.72] text-[var(--ink)] placeholder:text-[var(--mute)]/55"
                      />
                    </div>
                  )}

                  {block.type === 'heading' && (
                    <div className="mt-6 border-b-2 border-[color-mix(in_srgb,var(--note-accent,var(--e3))_34%,var(--line))] pb-2">
                      {block.partRole && NOTE_PART_ROLE_MAP[block.partRole] && (
                        <div className="mb-0.5 text-[11px] font-bold text-[var(--note-accent,var(--e3))]">
                          {NOTE_PART_ROLE_MAP[block.partRole].label}
                        </div>
                      )}
                      <AutoGrowTextarea
                        inputRef={(el) => registerInputRef(block.id, el)}
                        value={block.text}
                        minHeight={42}
                        onFocus={() => setFocusedBlockId(block.id)}
                        onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                        onPaste={(e) => handlePasteMultiLine(e, block, idx)}
                        onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                        placeholder="Section Heading…"
                        className="font-display text-[24px] font-extrabold leading-tight tracking-tight text-[var(--ink)] placeholder:text-[var(--mute)]/50 sm:text-[28px]"
                      />
                    </div>
                  )}

                  {block.type === 'subheading' && (
                    <AutoGrowTextarea
                      inputRef={(el) => registerInputRef(block.id, el)}
                      value={block.text}
                      minHeight={34}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onPaste={(e) => handlePasteMultiLine(e, block, idx)}
                      onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                      placeholder="Subheading…"
                      className="font-display mt-4 pb-0.5 text-[19px] font-bold leading-snug text-[var(--note-accent,var(--e3))] placeholder:text-[var(--mute)]/50 sm:text-[20px]"
                    />
                  )}

                  {block.type === 'bullet' && (
                    <div
                      className="flex items-start gap-3 py-0.5 transition-all"
                      style={{ paddingLeft: `${(block.indent || 0) * 26 + 4}px` }}
                    >
                      <span
                        className={`mt-[11px] shrink-0 rounded-full ${
                          (block.indent || 0) > 0
                            ? 'h-2 w-2 border-[1.5px] border-[var(--note-accent,var(--e3))] bg-transparent'
                            : 'h-2 w-2 bg-[var(--note-accent,var(--e3))]'
                        }`}
                        aria-hidden="true"
                      />
                      <AutoGrowTextarea
                        inputRef={(el) => registerInputRef(block.id, el)}
                        value={block.text}
                        minHeight={30}
                        onFocus={() => setFocusedBlockId(block.id)}
                        onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                        onPaste={(e) => handlePasteMultiLine(e, block, idx)}
                        onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                        placeholder="List item…"
                        className="text-[16px] leading-[1.7] text-[var(--ink)] placeholder:text-[var(--mute)]/50"
                      />
                    </div>
                  )}

                  {block.type === 'paragraph' && (
                    <AutoGrowTextarea
                      inputRef={(el) => registerInputRef(block.id, el)}
                      value={block.text}
                      minHeight={30}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onPaste={(e) => handlePasteMultiLine(e, block, idx)}
                      onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                      placeholder={
                        idx === 0
                          ? 'Start typing your notes cleanly like a Word document… (or use Insert buttons above)'
                          : 'Continue typing…'
                      }
                      className="py-0.5 text-[16px] leading-[1.72] text-[var(--ink)] placeholder:text-[var(--mute)]/50"
                    />
                  )}

                  {block.type === 'factbox' && (
                    <div className="my-2.5 rounded-xl border border-[color-mix(in_srgb,var(--note-accent,var(--e3))_30%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent,var(--e3))_7%,var(--bg))] px-5 py-4">
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={block.extra || ''}
                          onFocus={() => setFocusedBlockId(block.id)}
                          onChange={(e) => updateBlock(block.id, { extra: e.target.value })}
                          placeholder="Fact Box Title (e.g. Key Formula)"
                          className="flex-1 border-0 bg-transparent text-sm font-bold text-[var(--note-accent,var(--e3))] outline-none placeholder:text-[var(--note-accent,var(--e3))]/60"
                        />
                        <button
                          type="button"
                          onClick={() => deleteBlockAt(idx)}
                          aria-label="Remove Fact Box"
                          className="cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      <AutoGrowTextarea
                        inputRef={(el) => registerInputRef(block.id, el)}
                        value={block.text}
                        minHeight={34}
                        onFocus={() => setFocusedBlockId(block.id)}
                        onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                        onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                        placeholder="Core rule, formula, or key evidence…"
                        className="text-[16px] leading-[1.7] text-[var(--ink)] placeholder:text-[var(--mute)]/55"
                      />
                    </div>
                  )}

                  {block.type === 'flow' && (
                    <div className="my-2 rounded-xl border border-[color-mix(in_srgb,var(--note-accent,var(--e3))_24%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent,var(--e3))_4%,var(--card))] p-4">
                      <div className="mb-2.5 flex items-center justify-between gap-2">
                        <input
                          type="text"
                          value={block.extra || ''}
                          onFocus={() => setFocusedBlockId(block.id)}
                          onChange={(e) => updateBlock(block.id, { extra: e.target.value })}
                          placeholder="Process / Causal Flow Label (optional)"
                          className="flex-1 border-0 bg-transparent text-xs font-bold uppercase tracking-wider text-[var(--note-accent,var(--e3))] outline-none placeholder:text-[var(--mute)]/60"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(block.id, { steps: [...(block.steps || []), ''] })
                            }
                            className="sd-btn px-2.5 py-1 text-xs"
                          >
                            + Step
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteBlockAt(idx)}
                            aria-label="Remove Flow"
                            className="cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {(block.steps || ['', '']).map((stepVal, sIdx, arr) => (
                          <div key={sIdx} className="flex items-center gap-1.5">
                            <div className="flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--card)] px-3 py-1.5">
                              <span className="font-mono-num text-xs font-bold text-[var(--note-accent,var(--e3))]">
                                {sIdx + 1}.
                              </span>
                              <input
                                type="text"
                                value={stepVal}
                                onFocus={() => setFocusedBlockId(block.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    const nextSteps = [...arr];
                                    nextSteps.splice(sIdx + 1, 0, '');
                                    updateBlock(block.id, { steps: nextSteps });
                                  }
                                }}
                                onChange={(e) => {
                                  const nextSteps = arr.map((v, i) =>
                                    i === sIdx ? e.target.value : v
                                  );
                                  updateBlock(block.id, { steps: nextSteps });
                                }}
                                placeholder={`Step ${sIdx + 1}`}
                                className="min-w-[125px] border-0 bg-transparent text-sm font-medium text-[var(--ink)] outline-none"
                              />
                              {arr.length > 2 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateBlock(block.id, {
                                      steps: arr.filter((_, i) => i !== sIdx),
                                    })
                                  }
                                  aria-label="Remove step"
                                  className="cursor-pointer text-xs text-[var(--mute)] hover:text-[var(--bad)]"
                                >
                                  ×
                                </button>
                              )}
                            </div>
                            {sIdx < arr.length - 1 && (
                              <ArrowRight
                                className="h-4 w-4 shrink-0 text-[var(--note-accent,var(--e3))]"
                                aria-hidden="true"
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {block.type === 'table' && (() => {
                    const rows = block.rows?.length
                      ? block.rows
                      : [
                          ['Column 1', 'Column 2'],
                          ['', ''],
                        ];
                    const colCount = Math.max(1, rows[0]?.length || 2);
                    return (
                      <div className="my-2.5 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--note-accent,var(--e3))_26%,var(--line))] bg-[var(--bg)]">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-3.5 py-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-[var(--note-accent,var(--e3))]">
                            Table ({rows.length} × {colCount})
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() =>
                                updateBlock(block.id, {
                                  rows: [...rows, Array.from({ length: colCount }, () => '')],
                                })
                              }
                              className="sd-btn px-2.5 py-0.5 text-xs"
                            >
                              + Row
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateBlock(block.id, {
                                  rows: rows.map((r, ri) => [
                                    ...r,
                                    ri === 0 ? `Col ${colCount + 1}` : '',
                                  ]),
                                })
                              }
                              className="sd-btn px-2.5 py-0.5 text-xs"
                            >
                              + Col
                            </button>
                            {colCount > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, {
                                    rows: rows.map((r) => r.slice(0, -1)),
                                  })
                                }
                                className="sd-btn px-2.5 py-0.5 text-xs"
                              >
                                - Col
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => deleteBlockAt(idx)}
                              aria-label="Remove Table"
                              className="ml-1 cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                            >
                              <X className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                        <div className="overflow-x-auto bg-[var(--card)]">
                          <table className="w-full border-collapse text-[15px]">
                            <tbody>
                              {rows.map((r, ri) => (
                                <tr
                                  key={ri}
                                  className={
                                    ri === 0
                                      ? 'border-b-2 border-[color-mix(in_srgb,var(--note-accent,var(--e3))_38%,var(--line))] bg-[color-mix(in_srgb,var(--note-accent,var(--e3))_12%,var(--card))] font-bold'
                                      : 'border-b border-[var(--line)] last:border-b-0'
                                  }
                                >
                                  {Array.from({ length: colCount }, (_, ci) => (
                                    <td
                                      key={ci}
                                      className="border-r border-[var(--line)] align-top last:border-r-0"
                                    >
                                      <AutoGrowTextarea
                                        value={r[ci] || ''}
                                        minHeight={40}
                                        onFocus={() => setFocusedBlockId(block.id)}
                                        onChange={(e) => {
                                          const nextRows = rows.map((rowItem, rowIdx) =>
                                            rowIdx === ri
                                              ? Array.from({ length: colCount }, (__, cIdx) =>
                                                  cIdx === ci ? e.target.value : rowItem[cIdx] || ''
                                                )
                                              : [...rowItem]
                                          );
                                          updateBlock(block.id, { rows: nextRows });
                                        }}
                                        placeholder={ri === 0 ? `Header ${ci + 1}` : 'Type…'}
                                        className={`min-w-[130px] px-4 py-2.5 text-[15.5px] leading-relaxed focus:bg-[color-mix(in_srgb,var(--e3)_6%,var(--card))] ${
                                          ri === 0 ? 'font-bold text-[var(--ink)]' : 'text-[var(--ink)]'
                                        }`}
                                      />
                                    </td>
                                  ))}
                                  {rows.length > 2 && ri > 0 && (
                                    <td className="w-8 text-center align-middle">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          updateBlock(block.id, {
                                            rows: rows.filter((_, rIndex) => rIndex !== ri),
                                          })
                                        }
                                        title="Delete row"
                                        className="cursor-pointer px-1.5 py-1 text-sm text-[var(--mute)] hover:text-[var(--bad)]"
                                      >
                                        ×
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}

                  {block.type === 'key_term' && (
                    <div className="my-1.5 flex items-start gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5">
                      <div className="grid flex-1 gap-2 sm:grid-cols-12">
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
                          className="rounded-lg border border-transparent bg-[var(--card)] px-3.5 py-2.5 text-[15.5px] font-bold text-[var(--ink)] outline-none focus:border-[var(--e3)] sm:col-span-4"
                        />
                        <AutoGrowTextarea
                          value={block.extra || ''}
                          minHeight={40}
                          onFocus={() => setFocusedBlockId(block.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              insertBlockAfter(idx, 'key_term');
                            }
                          }}
                          onChange={(e) => updateBlock(block.id, { extra: e.target.value })}
                          placeholder="Clear exam definition…"
                          className="rounded-lg border border-transparent bg-[var(--card)] px-3.5 py-2.5 text-[15.5px] leading-relaxed text-[var(--ink)] focus:border-[var(--e3)] sm:col-span-8"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteBlockAt(idx)}
                        aria-label="Remove Key Term"
                        className="mt-2 cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )}

                  {block.type === 'worked_example' && (
                    <div className="my-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--ok)_32%,var(--line))] bg-[color-mix(in_srgb,var(--ok)_5%,var(--bg))] px-5 py-4">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-bold text-[var(--ok)]">
                          Worked Example
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteBlockAt(idx)}
                          aria-label="Remove Worked Example"
                          className="cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      <AutoGrowTextarea
                        inputRef={(el) => registerInputRef(block.id, el)}
                        value={block.text}
                        minHeight={38}
                        onFocus={() => setFocusedBlockId(block.id)}
                        onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                        onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                        placeholder="Step-by-step calculation, quote analysis, or model answer…"
                        className="text-[16px] leading-[1.7] text-[var(--ink)] placeholder:text-[var(--mute)]/55"
                      />
                    </div>
                  )}

                  {block.type === 'exam_tip' && (
                    <div className="my-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--e2)_40%,var(--line))] bg-[color-mix(in_srgb,var(--e2)_6%,var(--bg))] px-5 py-4">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-sm font-bold text-[var(--e2)]">
                          Examiner Tip
                        </span>
                        <button
                          type="button"
                          onClick={() => deleteBlockAt(idx)}
                          aria-label="Remove Examiner Tip"
                          className="cursor-pointer text-[var(--mute)] hover:text-[var(--bad)]"
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      <AutoGrowTextarea
                        inputRef={(el) => registerInputRef(block.id, el)}
                        value={block.text}
                        minHeight={38}
                        onFocus={() => setFocusedBlockId(block.id)}
                        onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                        onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                        placeholder="Common mark-scheme mistake or phrase examiners reward…"
                        className="text-[16px] leading-[1.7] text-[var(--ink)] placeholder:text-[var(--mute)]/55"
                      />
                    </div>
                  )}

                  {/* Inline Slash Command Menu */}
                  {showSlash && (
                    <div className="absolute left-0 top-full z-30 mt-1 max-h-80 w-76 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--card)] p-1.5 shadow-xl">
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
            });
          })()}

          {/* Spacious Word Click-Below-To-Write Area */}
          <div
            onClick={() => {
              const last = blocks[blocks.length - 1];
              if (
                last &&
                (last.type === 'paragraph' || last.type === 'bullet') &&
                !last.text.trim()
              ) {
                focusBlock(last.id);
              } else {
                insertBlockAfter(blocks.length - 1, 'paragraph', '');
              }
            }}
            className="mt-4 flex min-h-[96px] cursor-text items-center justify-center rounded-xl border border-dashed border-transparent px-4 text-sm text-[var(--mute)]/55 transition-colors hover:border-[var(--line)] hover:text-[var(--mute)]"
          >
            Click anywhere below to continue writing…
          </div>
        </div>
      </div>
    </div>
  );
}
