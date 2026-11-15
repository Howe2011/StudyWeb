import { StudyPack, StudyPackCategory } from '../types';

export const STUDY_PACK_TEMPLATE_TEXT = `Title: Biology Paper 1 Study Pack
Exam Board: Edexcel IGCSE
Subtitle: Cell biology, transport, and core recall flashcards

[Subject: Biology]
Topics: Cells & Organisation, Movement in & out of Cells, Enzymes & Digestion
Exam Date: 2026-11-26

[Flashcards | Biology > Cells & Organisation | Core Definitions]
What is the function of mitochondria? | Site of aerobic respiration releasing ATP energy
Define osmosis | Net movement of water molecules from high to low water potential across a partially permeable membrane
What is active transport? | Movement of molecules against a concentration gradient using ATP energy
Why do enzymes denature above their optimum temperature? | Hydrogen bonds break and the active site changes shape so the substrate no longer fits

[Notes | Biology > Cells & Organisation]
## Cell Structure
- Nucleus: contains genetic material (DNA) and controls cell activities
- Cytoplasm: jelly-like fluid where chemical reactions occur
- Cell membrane: partially permeable barrier controlling movement in and out
- Ribosomes: site of protein synthesis

## Transport Across Membranes
- Diffusion: passive movement down a concentration gradient
- Osmosis: water diffusion across a partially permeable membrane
- Active transport: requires energy from respiration to move substances against gradient

[Subject: Chemistry]
Topics: Atomic Structure, Bonding & Lattices
Exam Date: 2026-12-02

[Flashcards | Chemistry > Atomic Structure | Basics]
What are isotopes? | Atoms of the same element with the same number of protons but different numbers of neutrons
State the mass and charge of a proton | Relative mass 1, relative charge +1

[Notes | Chemistry > Atomic Structure]
## Atomic Model
- Protons and neutrons reside in the central nucleus
- Electrons orbit in energy shells (2, 8, 8)

[Todos | Biology]
Complete 20-minute past paper drill on enzyme graphs | pri: 2
`;

export interface ParsedPackTopic {
  subjectName: string;
  label: string;
  notesLines: string[];
  notesHtml?: string;
}

export interface ParsedPackSubject {
  name: string;
  examDate?: string;
  topics: string[];
}

export interface ParsedPackCard {
  subjectName: string;
  topicLabel: string;
  sectionName: string;
  q: string;
  a: string;
}

export interface ParsedPackTodo {
  title: string;
  subjectName?: string;
  due?: string;
  pri?: number;
}

export interface ParsedStudyPackDraft {
  title: string;
  subtitle: string;
  examBoard: string;
  subjects: ParsedPackSubject[];
  notesByTopic: ParsedPackTopic[];
  cards: ParsedPackCard[];
  todos: ParsedPackTodo[];
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineMarkdownToHtml(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(>])\*(?!\s)([^*<]+?)\*(?=[\s).,;:!?<]|$)/g, '$1<i>$2</i>');
}

export function markdownLinesToHtml(lines: string[]): string {
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const h3 = trimmed.match(/^###\s+(.+)$/);
    const h2 = trimmed.match(/^##\s+(.+)$/);
    const h1 = trimmed.match(/^#\s+(.+)$/);
    const bullet = trimmed.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);

    if (h1) {
      closeList();
      out.push(`<h1>${inlineMarkdownToHtml(h1[1])}</h1>`);
    } else if (h2) {
      closeList();
      out.push(`<h2>${inlineMarkdownToHtml(h2[1])}</h2>`);
    } else if (h3) {
      closeList();
      out.push(`<h3>${inlineMarkdownToHtml(h3[1])}</h3>`);
    } else if (bullet) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineMarkdownToHtml(bullet[1])}</li>`);
    } else {
      closeList();
      out.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

function parseCsvPair(line: string): [string, string, string] | null {
  const row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ',') {
      row.push(field.trim());
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.length >= 2 && row[0] && row[1]) {
    return [row[0], row[1], row[2] || ''];
  }
  return null;
}

/**
 * Pure-browser Word (.docx) OOXML reader returning formatted HTML and extracted text lines.
 */
export async function parseDocxFile(
  arrayBuffer: ArrayBuffer
): Promise<{ html: string; text: string }> {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error('Not a valid .docx Word document.');
  }

  const count = dv.getUint16(eocd + 10, true);
  let cd = dv.getUint32(eocd + 16, true);
  const td = new TextDecoder('utf-8');
  const entries = new Map<string, Uint8Array>();

  for (let k = 0; k < count && cd + 46 <= u8.length; k++) {
    if (dv.getUint32(cd, true) !== 0x02014b50) break;
    const comp = dv.getUint16(cd + 10, true);
    const csz = dv.getUint32(cd + 20, true);
    const fnLen = dv.getUint16(cd + 28, true);
    const exLen = dv.getUint16(cd + 30, true);
    const cmLen = dv.getUint16(cd + 32, true);
    const lfh = dv.getUint32(cd + 42, true);
    const name = td.decode(u8.subarray(cd + 46, cd + 46 + fnLen));
    cd += 46 + fnLen + exLen + cmLen;
    if (lfh + 30 > u8.length || dv.getUint32(lfh, true) !== 0x04034b50) continue;
    const lfn = dv.getUint16(lfh + 26, true);
    const lex = dv.getUint16(lfh + 28, true);
    const start = lfh + 30 + lfn + lex;
    const raw = u8.subarray(start, start + csz);

    if (comp === 0) {
      entries.set(name, raw);
    } else if (comp === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Your browser does not support .docx decompression.');
      }
      const streamBuf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
      const ab = await new Response(
        new Blob([streamBuf]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      ).arrayBuffer();
      entries.set(name, new Uint8Array(ab));
    }
  }

  const docBytes = entries.get('word/document.xml');
  if (!docBytes) {
    throw new Error('Could not find document body inside this .docx file.');
  }

  const xml = new DOMParser().parseFromString(td.decode(docBytes), 'application/xml');
  const body = Array.from(xml.getElementsByTagName('*')).find((n) => n.localName === 'body');
  if (!body) {
    throw new Error('Could not read Word document body.');
  }

  const attr = (el: Element | null, local: string): string | null => {
    if (!el) return null;
    for (const a of Array.from(el.attributes)) {
      if (a.localName === local || a.name === local || a.name === `w:${local}`) {
        return a.value;
      }
    }
    return null;
  };
  const child = (el: Element | null, local: string): Element | null => {
    if (!el) return null;
    for (const n of Array.from(el.children)) {
      if (n.localName === local) return n;
    }
    return null;
  };

  const textLines: string[] = [];
  const htmlParts: string[] = [];

  for (const node of Array.from(body.children)) {
    if (node.localName === 'p') {
      const pPr = child(node, 'pPr');
      const pStyle = attr(child(pPr, 'pStyle'), 'val') || '';
      const hasNum = Boolean(child(pPr, 'numPr'));
      let lineHtml = '';
      let lineText = '';

      for (const ch of Array.from(node.children)) {
        if (ch.localName === 'r') {
          const rPr = child(ch, 'rPr');
          const isBold = Boolean(child(rPr, 'b'));
          const isItal = Boolean(child(rPr, 'i'));
          let runTxt = '';
          for (const rn of Array.from(ch.children)) {
            if (rn.localName === 't') runTxt += rn.textContent || '';
            else if (rn.localName === 'tab') runTxt += '  ';
            else if (rn.localName === 'br') runTxt += '\n';
          }
          if (runTxt) {
            lineText += runTxt;
            let safe = escapeHtml(runTxt);
            if (isBold) safe = `<b>${safe}</b>`;
            if (isItal) safe = `<i>${safe}</i>`;
            lineHtml += safe;
          }
        }
      }

      const cleanTxt = lineText.trim();
      if (!cleanTxt) continue;
      textLines.push(hasNum && !cleanTxt.startsWith('-') ? `- ${cleanTxt}` : cleanTxt);

      const hm = pStyle.match(/heading\s*([1-6])/i);
      if (hm) {
        const lvl = Math.min(3, Math.max(1, Number(hm[1])));
        htmlParts.push(`<h${lvl}>${lineHtml}</h${lvl}>`);
      } else if (hasNum) {
        htmlParts.push(`<p>• ${lineHtml}</p>`);
      } else {
        htmlParts.push(`<p>${lineHtml}</p>`);
      }
    } else if (node.localName === 'tbl') {
      const rows: string[] = [];
      for (const tr of Array.from(node.children)) {
        if (tr.localName !== 'tr') continue;
        const cells: string[] = [];
        for (const tc of Array.from(tr.children)) {
          if (tc.localName !== 'tc') continue;
          const cellText = Array.from(tc.getElementsByTagName('*'))
            .filter((el) => el.localName === 't')
            .map((el) => el.textContent || '')
            .join('')
            .trim();
          cells.push(cellText);
        }
        if (cells.length >= 2 && cells[0] && cells[1]) {
          textLines.push(`${cells[0]} | ${cells[1]}${cells[2] ? ` | ${cells[2]}` : ''}`);
        } else if (cells.some(Boolean)) {
          textLines.push(cells.filter(Boolean).join(' — '));
        }
        rows.push(`<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`);
      }
      if (rows.length) {
        htmlParts.push(`<table><tbody>${rows.join('')}</tbody></table>`);
      }
    }
  }

  return {
    html: `<div class="word-doc" data-word="1">${htmlParts.join('')}</div>`,
    text: textLines.join('\n'),
  };
}

/**
 * Parses either structured template text or general notes/flashcard files into a unified draft.
 */
export function parseStudyPackInput(
  rawText: string,
  opts?: { fallbackTitle?: string; rawWordHtml?: string }
): ParsedStudyPackDraft {
  const lines = String(rawText || '')
    .replace(/\r/g, '')
    .split('\n');

  let title = (opts?.fallbackTitle || '').trim();
  let subtitle = '';
  let examBoard = 'Custom Study Pack';

  const subjectsMap = new Map<string, ParsedPackSubject>();
  const notesMap = new Map<string, ParsedPackTopic>();
  const cards: ParsedPackCard[] = [];
  const todos: ParsedPackTodo[] = [];

  const ensureSubject = (name: string): ParsedPackSubject => {
    const cleanName = name.trim() || title || 'General Studies';
    const key = cleanName.toLowerCase();
    let existing = subjectsMap.get(key);
    if (!existing) {
      existing = { name: cleanName, topics: [] };
      subjectsMap.set(key, existing);
    }
    return existing;
  };

  const ensureTopic = (subjName: string, topicLabel: string) => {
    const subj = ensureSubject(subjName);
    const cleanTopic = topicLabel.trim() || 'Core Topic';
    if (!subj.topics.some((t) => t.toLowerCase() === cleanTopic.toLowerCase())) {
      subj.topics.push(cleanTopic);
    }
    const nKey = `${subj.name.toLowerCase()}::${cleanTopic.toLowerCase()}`;
    if (!notesMap.has(nKey)) {
      notesMap.set(nKey, {
        subjectName: subj.name,
        label: cleanTopic,
        notesLines: [],
      });
    }
    return { subjName: subj.name, topicLabel: cleanTopic, nKey };
  };

  type Mode = 'none' | 'subject' | 'flashcards' | 'notes' | 'todos';
  let mode: Mode = 'none';
  let curSubject = '';
  let curTopic = '';
  let curSection = 'Core Deck';
  let pendingQuestion = '';
  let hasExplicitBlocks = false;

  const fallbackNotesLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    // Header tags: [Subject: ...], [Flashcards | ...], [Notes | ...], [Todos | ...]
    const subjTag = trimmed.match(/^\[Subject:\s*(.+?)\]$/i);
    if (subjTag) {
      hasExplicitBlocks = true;
      mode = 'subject';
      curSubject = subjTag[1].trim();
      curTopic = '';
      ensureSubject(curSubject);
      pendingQuestion = '';
      continue;
    }

    const fcTag = trimmed.match(/^\[(?:Flashcards|Cards)(?:\s*\|\s*(.+?))?\]$/i);
    if (fcTag) {
      hasExplicitBlocks = true;
      mode = 'flashcards';
      pendingQuestion = '';
      const meta = (fcTag[1] || '').split('|').map((x) => x.trim());
      if (meta[0]) {
        const gt = meta[0].split('>').map((x) => x.trim());
        if (gt.length >= 2) {
          curSubject = gt[0] || curSubject || title || 'General';
          curTopic = gt[1] || curTopic || 'Core Topic';
        } else {
          curTopic = gt[0];
        }
      }
      curSection = meta[1] || curTopic || 'Core Flashcards';
      ensureTopic(curSubject || title || 'General', curTopic || 'Core Topic');
      continue;
    }

    const notesTag = trimmed.match(/^\[Notes(?:\s*\|\s*(.+?))?\]$/i);
    if (notesTag) {
      hasExplicitBlocks = true;
      mode = 'notes';
      pendingQuestion = '';
      if (notesTag[1]) {
        const gt = notesTag[1].split('>').map((x) => x.trim());
        if (gt.length >= 2) {
          curSubject = gt[0] || curSubject || title || 'General';
          curTopic = gt[1] || curTopic || 'Core Notes';
        } else {
          curTopic = gt[0];
        }
      }
      ensureTopic(curSubject || title || 'General', curTopic || 'Core Notes');
      continue;
    }

    const todosTag = trimmed.match(/^\[(?:Todos|To-dos|Tasks)(?:\s*\|\s*(.+?))?\]$/i);
    if (todosTag) {
      hasExplicitBlocks = true;
      mode = 'todos';
      pendingQuestion = '';
      if (todosTag[1]) {
        curSubject = todosTag[1].trim();
        ensureSubject(curSubject);
      }
      continue;
    }

    // Metadata key: value when outside notes or at top
    if (mode === 'none' || mode === 'subject') {
      const mTitle = trimmed.match(/^Title:\s*(.+)$/i);
      if (mTitle && !title) {
        title = mTitle[1].trim();
        continue;
      }
      if (mTitle && mode === 'none') {
        title = mTitle[1].trim();
        continue;
      }
      const mSub = trimmed.match(/^Subtitle:\s*(.+)$/i);
      if (mSub) {
        subtitle = mSub[1].trim();
        continue;
      }
      const mBoard = trimmed.match(/^(?:Exam Board|Board):\s*(.+)$/i);
      if (mBoard) {
        examBoard = mBoard[1].trim();
        continue;
      }
    }

    if (mode === 'subject') {
      const mTopics = trimmed.match(/^Topics:\s*(.+)$/i);
      if (mTopics) {
        const items = mTopics[1]
          .split(/[,;]+/)
          .map((x) => x.trim())
          .filter(Boolean);
        items.forEach((tp) => {
          ensureTopic(curSubject, tp);
          if (!curTopic) curTopic = tp;
        });
        continue;
      }
      const mDate = trimmed.match(/^(?:Exam Date|Date):\s*(\d{4}-\d{2}-\d{2})/i);
      if (mDate) {
        ensureSubject(curSubject).examDate = mDate[1];
        continue;
      }
      const bulletTopic = trimmed.match(/^[-*•]\s+(.+)$/);
      if (bulletTopic) {
        const tp = bulletTopic[1].trim();
        ensureTopic(curSubject, tp);
        if (!curTopic) curTopic = tp;
        continue;
      }
    }

    if (mode === 'flashcards') {
      if (!trimmed) continue;
      // Ignore optional CSV header
      if (/^(?:q|question)\s*[,|]\s*(?:a|answer)/i.test(trimmed)) continue;

      const ensured = ensureTopic(
        curSubject || title || 'General',
        curTopic || 'Core Flashcards'
      );

      // Q: ... / A: ... single or multi-line
      const qaInline = trimmed.match(/^Q:\s*(.+?)\s*(?:\||::|->)\s*A:\s*(.+)$/i);
      if (qaInline) {
        cards.push({
          subjectName: ensured.subjName,
          topicLabel: ensured.topicLabel,
          sectionName: curSection || ensured.topicLabel,
          q: qaInline[1].trim(),
          a: qaInline[2].trim(),
        });
        pendingQuestion = '';
        continue;
      }
      const qLine = trimmed.match(/^Q:\s*(.+)$/i);
      if (qLine) {
        pendingQuestion = qLine[1].trim();
        continue;
      }
      const aLine = trimmed.match(/^A:\s*(.+)$/i);
      if (aLine && pendingQuestion) {
        cards.push({
          subjectName: ensured.subjName,
          topicLabel: ensured.topicLabel,
          sectionName: curSection || ensured.topicLabel,
          q: pendingQuestion,
          a: aLine[1].trim(),
        });
        pendingQuestion = '';
        continue;
      }

      // Pipe or double-colon separated: Question | Answer | optional Section
      const sepParts = trimmed.includes('|')
        ? trimmed.split('|').map((x) => x.trim())
        : trimmed.includes('::')
        ? trimmed.split('::').map((x) => x.trim())
        : null;

      if (sepParts && sepParts.length >= 2 && sepParts[0] && sepParts[1]) {
        cards.push({
          subjectName: ensured.subjName,
          topicLabel: ensured.topicLabel,
          sectionName: sepParts[2] || curSection || ensured.topicLabel,
          q: sepParts[0],
          a: sepParts[1],
        });
        continue;
      }

      // Quoted/plain CSV fallback
      const csvRow = parseCsvPair(trimmed);
      if (csvRow) {
        cards.push({
          subjectName: ensured.subjName,
          topicLabel: ensured.topicLabel,
          sectionName: csvRow[2] || curSection || ensured.topicLabel,
          q: csvRow[0],
          a: csvRow[1],
        });
      }
      continue;
    }

    if (mode === 'notes') {
      const ensured = ensureTopic(curSubject || title || 'General', curTopic || 'Study Notes');
      notesMap.get(ensured.nKey)?.notesLines.push(line);
      continue;
    }

    if (mode === 'todos') {
      if (!trimmed) continue;
      const cleanLine = trimmed.replace(/^[-*•]\s+/, '');
      const parts = cleanLine.split('|').map((x) => x.trim());
      const taskTitle = parts[0];
      if (!taskTitle) continue;
      let due = '';
      let pri = 1;
      for (const extra of parts.slice(1)) {
        const dm = extra.match(/^(?:due:)?\s*(\d{4}-\d{2}-\d{2})$/i);
        if (dm) due = dm[1];
        const pm = extra.match(/^pri(?:ority)?:\s*([123])$/i);
        if (pm) pri = Number(pm[1]);
      }
      todos.push({
        title: taskTitle,
        subjectName: curSubject || undefined,
        due: due || undefined,
        pri,
      });
      continue;
    }

    // Mode === 'none' fallback (untagged plain text / Word doc / markdown)
    fallbackNotesLines.push(line);
    const pipeCheck = trimmed.includes('|') ? trimmed.split('|').map((x) => x.trim()) : null;
    if (pipeCheck && pipeCheck.length >= 2 && pipeCheck[0] && pipeCheck[1]) {
      const ensured = ensureTopic(title || 'General', 'Extracted Flashcards');
      cards.push({
        subjectName: ensured.subjName,
        topicLabel: ensured.topicLabel,
        sectionName: pipeCheck[2] || 'Imported Cards',
        q: pipeCheck[0],
        a: pipeCheck[1],
      });
    } else if (/^#{1,2}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,2}\s+/, '').trim();
      if (heading) ensureTopic(title || 'Study Notes', heading);
    }
  }

  // Handle pure untagged document upload (e.g. .docx or .txt notes without [Subject] blocks)
  if (!hasExplicitBlocks && (fallbackNotesLines.some((l) => l.trim()) || opts?.rawWordHtml)) {
    const subjName = title || 'Imported Study Pack';
    const existingTopics = ensureSubject(subjName).topics;
    const topicLabel = existingTopics[0] || 'Core Notes';
    const ensured = ensureTopic(subjName, topicLabel);
    const entry = notesMap.get(ensured.nKey);
    if (entry) {
      if (opts?.rawWordHtml) entry.notesHtml = opts.rawWordHtml;
      else entry.notesLines.push(...fallbackNotesLines);
    }
  }

  const resolvedTitle =
    title ||
    (Array.from(subjectsMap.values())[0]?.name
      ? `${Array.from(subjectsMap.values())[0].name} Study Pack`
      : 'Custom Study Pack');

  const notesByTopic = Array.from(notesMap.values()).filter(
    (n) => Boolean(n.notesHtml) || n.notesLines.some((l) => l.trim().length > 0)
  );

  const subjects = Array.from(subjectsMap.values());
  const resolvedSubtitle =
    subtitle ||
    `${subjects.length} subject${subjects.length === 1 ? '' : 's'} · ${cards.length} flashcard${
      cards.length === 1 ? '' : 's'
    }`;

  return {
    title: resolvedTitle,
    subtitle: resolvedSubtitle,
    examBoard,
    subjects,
    notesByTopic,
    cards,
    todos,
  };
}

export function buildStudyPackFromDraft(
  draft: ParsedStudyPackDraft,
  options: {
    title: string;
    subtitle: string;
    examBoard: string;
    category: StudyPackCategory;
    includeSubjects: boolean;
    includeFlashcards: boolean;
    includeNotes: boolean;
    includeTodos: boolean;
  }
): StudyPack {
  const packId = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'item';

  const notesLookup = new Map<string, string>();
  if (options.includeNotes) {
    for (const nt of draft.notesByTopic) {
      const key = `${nt.subjectName.toLowerCase()}::${nt.label.toLowerCase()}`;
      notesLookup.set(key, nt.notesHtml || markdownLinesToHtml(nt.notesLines));
    }
  }

  // Ensure revision subjects exist if notes or flashcards are included
  const revisionSubjects: NonNullable<StudyPack['revision']['subjects']> = [];
  const topicIdLookup = new Map<string, string>();

  const sourceSubjects = draft.subjects.length
    ? draft.subjects
    : [{ name: options.title || 'General Study Pack', topics: ['Core Topic'] }];

  if (options.includeSubjects || options.includeNotes || options.includeFlashcards) {
    sourceSubjects.forEach((subj, si) => {
      const sid = `pack_s_${slug(subj.name)}_${si}_${Date.now().toString(36).slice(-3)}`;
      const topicsList = subj.topics.length ? subj.topics : ['Core Topic'];
      const revTopics = topicsList.map((tp, ti) => {
        const tid = `pack_t_${slug(subj.name)}_${slug(tp)}_${si}_${ti}_${Date.now()
          .toString(36)
          .slice(-3)}`;
        const key = `${subj.name.toLowerCase()}::${tp.toLowerCase()}`;
        topicIdLookup.set(key, tid);
        const notesHtml = options.includeNotes ? notesLookup.get(key) || '' : '';
        return {
          id: tid,
          label: tp,
          title: `${subj.name}: ${tp}`,
          sections: ['Key concepts & notes'],
          notesHtml,
        };
      });

      revisionSubjects.push({
        id: sid,
        name: subj.name,
        kind: 'doc',
        views: {
          notes: options.includeNotes || options.includeSubjects,
          timeline: false,
          mindmap: options.includeNotes || options.includeSubjects,
        },
        topics: revTopics,
      });
    });
  }

  const sectionIdMap = new Map<string, string>();
  const sections: NonNullable<StudyPack['revision']['sections']> = [];
  const cards: NonNullable<StudyPack['revision']['cards']> = [];

  if (options.includeFlashcards && draft.cards.length > 0) {
    draft.cards.forEach((card, idx) => {
      const key = `${card.subjectName.toLowerCase()}::${card.topicLabel.toLowerCase()}`;
      const matchedTopicId =
        topicIdLookup.get(key) || revisionSubjects[0]?.topics[0]?.id || undefined;
      const secKey = `${key}::${card.sectionName.toLowerCase()}`;
      let secId = sectionIdMap.get(secKey);
      if (!secId) {
        secId = `sec_${slug(card.sectionName)}_${idx}_${Date.now().toString(36).slice(-3)}`;
        sectionIdMap.set(secKey, secId);
        sections.push({
          id: secId,
          topicId: matchedTopicId,
          topicLabel: card.topicLabel,
          subjectName: card.subjectName,
          name: card.sectionName || 'Core Flashcards',
        });
      }
      cards.push({
        sectionId: secId,
        sectionName: card.sectionName,
        topicId: matchedTopicId,
        topicLabel: card.topicLabel,
        subjectName: card.subjectName,
        q: card.q,
        a: card.a,
      });
    });
  }

  const plannerSubjects: NonNullable<StudyPack['planner']['subjects']> = options.includeSubjects
    ? sourceSubjects.map((s) => ({
        name: s.name,
        weight: 2,
        date: s.examDate || '',
        topics: s.topics,
        exams: s.examDate ? [{ d: s.examDate, t: '09:00', n: `${s.name} Exam` }] : [],
      }))
    : [];

  const plannerTodos: NonNullable<StudyPack['planner']['todos']> = options.includeTodos
    ? draft.todos.map((td) => ({
        title: td.title,
        due: td.due || '',
        pri: td.pri || 1,
        cat: 'hw',
        subjectName: td.subjectName,
      }))
    : [];

  const totalTopics = sourceSubjects.reduce((sum, s) => sum + s.topics.length, 0);
  const highlights: string[] = [];
  if (options.includeSubjects) {
    highlights.push(
      `${sourceSubjects.length} subject${sourceSubjects.length === 1 ? '' : 's'} with ${totalTopics} topic${totalTopics === 1 ? '' : 's'}`
    );
  }
  if (options.includeFlashcards && cards.length > 0) {
    highlights.push(`${cards.length} active-recall flashcard${cards.length === 1 ? '' : 's'}`);
  }
  if (options.includeNotes && notesLookup.size > 0) {
    highlights.push(`Formatted study notes for ${notesLookup.size} topic${notesLookup.size === 1 ? '' : 's'}`);
  }
  if (options.includeTodos && plannerTodos.length > 0) {
    highlights.push(`${plannerTodos.length} planner study task${plannerTodos.length === 1 ? '' : 's'}`);
  }

  return {
    id: packId,
    title: options.title.trim() || draft.title,
    subtitle:
      options.subtitle.trim() ||
      draft.subtitle ||
      `${sourceSubjects.length} subjects · ${cards.length} flashcards`,
    category: options.category,
    examBoard: options.examBoard.trim() || draft.examBoard || 'Custom Study Pack',
    isCustom: true,
    createdAt: new Date().toISOString(),
    subjectCountPreview: options.includeSubjects ? sourceSubjects.length : 0,
    topicCountPreview: options.includeSubjects || options.includeNotes ? totalTopics : 0,
    cardCountPreview: cards.length,
    tags: ['Template Pack', ...sourceSubjects.slice(0, 3).map((s) => s.name)],
    highlights: highlights.length ? highlights : ['Custom imported Study Pack'],
    revision: {
      subjects: revisionSubjects,
      sections,
      cards,
    },
    planner: {
      subjects: plannerSubjects,
      todos: plannerTodos,
    },
  };
}
