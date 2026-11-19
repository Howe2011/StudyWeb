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
  Italic,
  Layers,
  List,
  Plus,
  Quote,
  Redo2,
  Sparkles,
  Table2,
  Trash2,
  Type,
  Undo2,
} from 'lucide-react';
import { groupSectionPoints, makeNoteId } from '../lib/noteFormat';
import { NoteSectionBlock, StructuredNoteData } from '../types';

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
}

const SLASH_OPTIONS: Array<{
  type: NotionBlockType;
  label: string;
  hint: string;
  keywords: string;
}> = [
  {
    type: 'paragraph',
    label: 'Text Paragraph',
    hint: 'Fluid prose block (supports **bold**, *italic*)',
    keywords: 'text paragraph body note p',
  },
  {
    type: 'heading',
    label: 'Section Heading',
    hint: 'Major specification section (shortcut: ## )',
    keywords: 'heading h2 title section h1',
  },
  {
    type: 'subheading',
    label: 'Subheading',
    hint: 'Sub-section divider (shortcut: ### )',
    keywords: 'subheading h3 subsection',
  },
  {
    type: 'bullet',
    label: 'Bullet Point',
    hint: 'Nested list item — press Tab to indent (shortcut: - )',
    keywords: 'bullet list point fact item',
  },
  {
    type: 'factbox',
    label: 'Fact / Callout Box',
    hint: 'Highlighted formula, rule, or key takeaway (shortcut: > )',
    keywords: 'fact box callout quote highlight note',
  },
  {
    type: 'flow',
    label: 'Arrow Flow Diagram',
    hint: 'Step-by-step causal chain A → B → C (shortcut: => )',
    keywords: 'flow arrow diagram process steps chain',
  },
  {
    type: 'table',
    label: 'Comparison Table',
    hint: 'Interactive multi-column grid with headers',
    keywords: 'table grid matrix compare columns',
  },
  {
    type: 'key_term',
    label: 'Key Term & Definition',
    hint: '2-column glossary row (turns into flashcards)',
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
        const rows = [
          [...item.headers],
          ...item.rows.map((r) => [...r]),
        ];
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
  className = '',
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  inputRef?: (el: HTMLTextAreaElement | null) => void;
}) {
  const localRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(28, el.scrollHeight)}px`;
  }, [value]);

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
        el.style.height = `${Math.max(28, el.scrollHeight)}px`;
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
    // Live Markdown prefixes at start of line
    if (block.type === 'paragraph' || block.type === 'bullet') {
      if (rawVal === '## ' || rawVal === '# ') {
        changeBlockType(block.id, 'heading', true);
        updateBlock(block.id, { type: 'heading', text: '' });
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
        newBlocks.push(makeDefaultBlock('paragraph', trimmed));
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
    // Undo / Redo + Inline Formatting Shortcuts
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

    // Tab / Shift+Tab for smooth bullet indentation
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

    // Fluid Enter: escape empty bullet/subheading OR split block at cursor
    const splittableTypes: NotionBlockType[] = [
      'heading',
      'subheading',
      'bullet',
      'paragraph',
      'key_term',
    ];
    if (e.key === 'Enter' && !e.shiftKey && splittableTypes.includes(block.type)) {
      e.preventDefault();

      // Pressing Enter on an empty bullet/subheading cleanly exits the list into a paragraph
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

    // Fluid Backspace at cursor 0: outdent, merge with previous text block, or delete if empty
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

    // ArrowUp / ArrowDown navigation between blocks
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
    <div className="sd-card px-4 py-5 sm:px-9 sm:py-8">
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
          <span className="font-mono-num text-[11px] text-[var(--mute)]">
            {blocks.length} blocks · {wordCount} words
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

      {/* Compact Sticky Formatting & Shortcut Bar */}
      <div className="sticky top-2 z-20 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--bg)]/95 px-2.5 py-1.5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            disabled={!historyMeta.canUndo}
            onClick={handleUndo}
            title="Undo (Ctrl/Cmd+Z)"
            className="sd-btn h-7 w-7 p-0 disabled:opacity-35"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            disabled={!historyMeta.canRedo}
            onClick={handleRedo}
            title="Redo (Ctrl/Cmd+Shift+Z)"
            className="sd-btn h-7 w-7 p-0 disabled:opacity-35"
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
            className="sd-btn h-7 w-7 p-0"
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
            className="sd-btn h-7 w-7 p-0"
          >
            <Italic className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              applyInlineWrap('`');
            }}
            title="Inline code"
            className="sd-btn h-7 w-7 p-0"
          >
            <Code className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              insertArrowAtCursor();
            }}
            title="Insert causal arrow →"
            className="sd-btn h-7 px-2 text-xs"
          >
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        <div className="hidden items-center gap-2 text-[11px] text-[var(--mute)] md:flex">
          <span>
            <kbd className="rounded border border-[var(--line)] px-1 font-mono-num">/</kbd> menu
          </span>
          <span>
            <kbd className="rounded border border-[var(--line)] px-1 font-mono-num">##</kbd> heading
          </span>
          <span>
            <kbd className="rounded border border-[var(--line)] px-1 font-mono-num">Tab</kbd> indent
          </span>
          <span>Drag <strong className="text-[var(--ink)]">⋮⋮</strong> to reorder</span>
        </div>
      </div>

      {/* Notion Block Canvas */}
      <div className="mt-4 space-y-1.5">
        {blocks.map((block, idx) => {
          const isFocused = focusedBlockId === block.id || openMenuBlockId === block.id;
          const showSlash =
            slashBlockId === block.id && block.text.startsWith('/') && !block.text.includes('\n');
          const isDropHere = dropTargetIdx === idx;

          return (
            <div
              key={block.id}
              onDragOver={(e) => {
                if (!dragBlockId) return;
                e.preventDefault();
                setDropTargetIdx(idx);
              }}
              onDrop={(e) => handleDropOnBlock(e, idx)}
              className={`group relative flex items-start gap-1.5 rounded-lg py-0.5 transition-all ${
                isDropHere ? 'border-t-2 border-t-[var(--e3)] pt-1' : ''
              } ${dragBlockId === block.id ? 'opacity-50' : ''}`}
            >
              {/* Left Notion Hover Gutter */}
              <div
                className={`flex w-12 shrink-0 items-center justify-end gap-0.5 pt-1 transition-opacity ${
                  isFocused ? 'opacity-100' : 'opacity-35 sm:opacity-0 sm:group-hover:opacity-100'
                }`}
              >
                <button
                  type="button"
                  title="Add block below"
                  aria-label="Add block below"
                  onClick={() => insertBlockAfter(idx, 'paragraph', '/')}
                  className="flex h-6 w-5 cursor-pointer items-center justify-center rounded text-[var(--mute)] hover:bg-[var(--bg)] hover:text-[var(--ink)]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  draggable
                  onDragStart={() => setDragBlockId(block.id)}
                  onDragEnd={() => {
                    setDragBlockId(null);
                    setDropTargetIdx(null);
                  }}
                  title="Drag to reorder or click for block menu"
                  aria-label="Block options"
                  onClick={() =>
                    setOpenMenuBlockId((cur) => (cur === block.id ? null : block.id))
                  }
                  className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-[var(--mute)] hover:bg-[var(--bg)] hover:text-[var(--ink)] active:cursor-grabbing"
                >
                  <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* Block Context Popover Menu */}
              {openMenuBlockId === block.id && (
                <div className="absolute left-12 top-8 z-30 max-h-96 w-60 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--card)] p-1.5 shadow-xl">
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
                      title="Duplicate block"
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

              {/* Block Body */}
              <div className="relative min-w-0 flex-1">
                {block.type === 'summary' && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3.5">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--e3)]">
                      Topic Overview
                    </div>
                    <AutoGrowTextarea
                      inputRef={(el) => registerInputRef(block.id, el)}
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                      placeholder="1–2 sentence core overview of this syllabus topic…"
                      className="text-sm leading-relaxed text-[var(--ink)] placeholder:text-[var(--mute)]/60"
                    />
                  </div>
                )}

                {block.type === 'heading' && (
                  <AutoGrowTextarea
                    inputRef={(el) => registerInputRef(block.id, el)}
                    value={block.text}
                    onFocus={() => setFocusedBlockId(block.id)}
                    onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                    onPaste={(e) => handlePasteMultiLine(e, block, idx)}
                    onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                    placeholder="Section heading… (type '/' for block types)"
                    className="font-display mt-3 py-1 text-lg font-bold text-[var(--ink)] placeholder:text-[var(--mute)]/60 sm:text-xl"
                  />
                )}

                {block.type === 'subheading' && (
                  <AutoGrowTextarea
                    inputRef={(el) => registerInputRef(block.id, el)}
                    value={block.text}
                    onFocus={() => setFocusedBlockId(block.id)}
                    onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                    onPaste={(e) => handlePasteMultiLine(e, block, idx)}
                    onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                    placeholder="Subheading…"
                    className="font-display mt-1.5 border-b border-[var(--line)] pb-1 text-sm font-bold text-[var(--e3)] placeholder:text-[var(--mute)]/60"
                  />
                )}

                {block.type === 'bullet' && (
                  <div
                    className="flex items-start gap-2.5 py-0.5 transition-all"
                    style={{ paddingLeft: `${(block.indent || 0) * 22}px` }}
                  >
                    <span
                      className={`mt-2.5 shrink-0 rounded-full ${
                        (block.indent || 0) > 0
                          ? 'h-1.5 w-1.5 border border-[var(--e3)] bg-transparent'
                          : 'h-1.5 w-1.5 bg-[var(--ink)]'
                      }`}
                      aria-hidden="true"
                    />
                    <AutoGrowTextarea
                      inputRef={(el) => registerInputRef(block.id, el)}
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onPaste={(e) => handlePasteMultiLine(e, block, idx)}
                      onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                      placeholder="Write a point (Tab to indent, Enter to split, '/' for commands)…"
                      className="text-[15px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--mute)]/60"
                    />
                  </div>
                )}

                {block.type === 'paragraph' && (
                  <AutoGrowTextarea
                    inputRef={(el) => registerInputRef(block.id, el)}
                    value={block.text}
                    onFocus={() => setFocusedBlockId(block.id)}
                    onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                    onPaste={(e) => handlePasteMultiLine(e, block, idx)}
                    onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                    placeholder="Start writing anywhere, paste notes, or type '/' for commands…"
                    className="py-1 text-[15px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--mute)]/60"
                  />
                )}

                {block.type === 'factbox' && (
                  <div className="rounded-xl border border-[color-mix(in_srgb,var(--e3)_30%,var(--line))] border-l-4 border-l-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_6%,var(--bg))] p-3">
                    <input
                      type="text"
                      value={block.extra || ''}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onChange={(e) => updateBlock(block.id, { extra: e.target.value })}
                      placeholder="Fact Box Title (e.g. Key Formula / Core Rule)"
                      className="mb-1 w-full border-0 bg-transparent text-[11px] font-bold uppercase tracking-wider text-[var(--e3)] outline-none placeholder:text-[var(--e3)]/60"
                    />
                    <AutoGrowTextarea
                      inputRef={(el) => registerInputRef(block.id, el)}
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                      placeholder="Fact box details…"
                      className="text-sm leading-relaxed text-[var(--ink)] placeholder:text-[var(--mute)]/60"
                    />
                  </div>
                )}

                {block.type === 'flow' && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <input
                        type="text"
                        value={block.extra || ''}
                        onFocus={() => setFocusedBlockId(block.id)}
                        onChange={(e) => updateBlock(block.id, { extra: e.target.value })}
                        placeholder="Flow Diagram Label (optional, e.g. Sequence)"
                        className="flex-1 border-0 bg-transparent text-[11px] font-bold uppercase tracking-wider text-[var(--e3)] outline-none placeholder:text-[var(--mute)]/60"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          updateBlock(block.id, { steps: [...(block.steps || []), ''] })
                        }
                        className="sd-btn px-2 py-0.5 text-[11px]"
                      >
                        + Step
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {(block.steps || ['', '']).map((stepVal, sIdx, arr) => (
                        <div key={sIdx} className="flex items-center gap-1.5">
                          <div className="flex items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--card)] px-2 py-1">
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
                              className="min-w-[110px] border-0 bg-transparent text-xs font-medium text-[var(--ink)] outline-none"
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
                                className="cursor-pointer text-[11px] text-[var(--mute)] hover:text-[var(--bad)]"
                              >
                                ×
                              </button>
                            )}
                          </div>
                          {sIdx < arr.length - 1 && (
                            <ArrowRight
                              className="h-3.5 w-3.5 shrink-0 text-[var(--e3)]"
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
                    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg)] p-2.5">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--e3)]">
                          Table ({rows.length} rows × {colCount} cols)
                        </span>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              updateBlock(block.id, {
                                rows: [...rows, Array.from({ length: colCount }, () => '')],
                              })
                            }
                            className="sd-btn px-2 py-0.5 text-[11px]"
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
                            className="sd-btn px-2 py-0.5 text-[11px]"
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
                              className="sd-btn px-2 py-0.5 text-[11px]"
                            >
                              - Col
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--card)]">
                        <table className="w-full border-collapse text-xs">
                          <tbody>
                            {rows.map((r, ri) => (
                              <tr
                                key={ri}
                                className={
                                  ri === 0
                                    ? 'border-b border-[var(--line)] bg-[var(--bg)] font-bold'
                                    : 'border-b border-[var(--line)] last:border-b-0'
                                }
                              >
                                {Array.from({ length: colCount }, (_, ci) => (
                                  <td
                                    key={ci}
                                    className="border-r border-[var(--line)] p-0 last:border-r-0"
                                  >
                                    <input
                                      type="text"
                                      value={r[ci] || ''}
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
                                      placeholder={ri === 0 ? `Header ${ci + 1}` : '…'}
                                      className={`w-full min-w-[100px] border-0 bg-transparent px-2.5 py-1.5 text-xs outline-none focus:bg-[color-mix(in_srgb,var(--e3)_6%,var(--card))] ${
                                        ri === 0 ? 'font-bold text-[var(--ink)]' : 'text-[var(--ink)]'
                                      }`}
                                    />
                                  </td>
                                ))}
                                {rows.length > 2 && ri > 0 && (
                                  <td className="w-7 text-center">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateBlock(block.id, {
                                          rows: rows.filter((_, rIndex) => rIndex !== ri),
                                        })
                                      }
                                      title="Delete row"
                                      className="cursor-pointer px-1 text-xs text-[var(--mute)] hover:text-[var(--bad)]"
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
                    <AutoGrowTextarea
                      inputRef={(el) => registerInputRef(block.id, el)}
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                      placeholder="Step-by-step calculation, quote analysis, or model answer…"
                      className="text-sm leading-relaxed text-[var(--ink)] placeholder:text-[var(--mute)]/60"
                    />
                  </div>
                )}

                {block.type === 'exam_tip' && (
                  <div className="rounded-xl border border-[var(--e2)] bg-[var(--bg)] p-3.5">
                    <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[var(--e2)]">
                      Examiner Tip
                    </div>
                    <AutoGrowTextarea
                      inputRef={(el) => registerInputRef(block.id, el)}
                      value={block.text}
                      onFocus={() => setFocusedBlockId(block.id)}
                      onKeyDown={(e) => handleBlockKeyDown(e, block, idx)}
                      onChange={(e) => handleTextChangeWithShortcuts(block, e.target.value)}
                      placeholder="Common mark-scheme mistake or phrase to remember…"
                      className="text-sm leading-relaxed text-[var(--ink)] placeholder:text-[var(--mute)]/60"
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
        })}

        {/* Notion-style Click-Below-To-Continue Area */}
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
          className="flex min-h-[68px] cursor-text items-center justify-center rounded-xl border border-dashed border-transparent px-4 text-xs text-[var(--mute)]/60 transition-colors hover:border-[var(--line)] hover:text-[var(--mute)]"
        >
          Click anywhere below to continue writing…
        </div>
      </div>

      {/* Bottom Quick-Insert Bar & Manual Make Flashcards CTA */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--mute)]">
            <Sparkles className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
            <span>Add:</span>
          </span>
          {(
            [
              ['heading', 'Heading'],
              ['subheading', 'Subheading'],
              ['bullet', 'Bullet'],
              ['paragraph', 'Text'],
              ['factbox', 'Fact Box'],
              ['flow', 'Flow Diagram'],
              ['table', 'Table'],
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
              + {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onMakeFlashcards}
          className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Make Flashcards{validTermsCount > 0 ? ` (${validTermsCount} terms)` : ''}</span>
        </button>
      </div>
    </div>
  );
}
