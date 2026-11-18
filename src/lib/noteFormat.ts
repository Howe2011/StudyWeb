import {
  KeyTermPair,
  NoteSectionBlock,
  StructuredNoteData,
} from '../types';

export function makeNoteId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createEmptyStructuredNote(summary = ''): StructuredNoteData {
  return {
    summary,
    sections: [
      {
        id: makeNoteId('sec'),
        heading: 'Core Concepts',
        points: [],
      },
    ],
    keyTerms: [],
    examTip: '',
    workedExample: '',
    updatedAt: new Date().toISOString(),
  };
}

export function estimateNoteReadingMinutes(note: StructuredNoteData): number {
  const words = [
    note.summary,
    note.examTip,
    note.workedExample,
    ...note.sections.flatMap((s) => [s.heading, ...s.points]),
    ...note.keyTerms.flatMap((k) => [k.term, k.definition]),
    note.legacyHtml ? note.legacyHtml.replace(/<[^>]+>/g, ' ') : '',
  ]
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 180));
}

export function isNoteEmpty(note: StructuredNoteData): boolean {
  const hasSummary = note.summary.trim().length > 0;
  const hasSections = note.sections.some(
    (s) =>
      s.points.some((p) => p.trim().length > 0) ||
      (s.heading.trim().length > 0 && note.sections.length > 1)
  );
  const hasTerms = note.keyTerms.some((k) => k.term.trim() && k.definition.trim());
  const hasTip = note.examTip.trim().length > 0;
  const hasEx = note.workedExample.trim().length > 0;
  const hasLegacy = Boolean(
    note.legacyHtml && note.legacyHtml.replace(/<[^>]+>/g, '').trim().length > 0
  );
  return !hasSummary && !hasSections && !hasTerms && !hasTip && !hasEx && !hasLegacy;
}

function addTermAndCard(
  keyTerms: KeyTermPair[],
  extractedCards: Array<{ q: string; a: string; sectionName: string }>,
  seenTerms: Set<string>,
  term: string,
  definition: string,
  sectionHeading: string
) {
  const cleanTerm = term.replace(/\*\*/g, '').trim();
  const cleanDef = definition.trim();
  if (!cleanTerm || !cleanDef) return;
  const key = cleanTerm.toLowerCase();
  if (!seenTerms.has(key)) {
    seenTerms.add(key);
    keyTerms.push({
      id: makeNoteId('term'),
      term: cleanTerm,
      definition: cleanDef,
    });
    extractedCards.push({
      q: cleanTerm,
      a: cleanDef,
      sectionName: sectionHeading || 'Key Terms',
    });
  }
}

/**
 * Splits dense plain prose into clean readable bullets/paragraphs when pasting large unformatted blocks.
 */
function preprocessPlainStudyText(rawInput: string): string {
  const normalized = String(rawInput || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .trim();
  if (!normalized) return '';

  const outLines: string[] = [];
  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    // If a single line is a giant paragraph (> 320 chars) with multiple sentences and no pipes/markdown headings, break into crisp sentences/clauses
    if (
      trimmed.length > 320 &&
      !trimmed.startsWith('|') &&
      !trimmed.startsWith('#') &&
      !trimmed.startsWith('-') &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('•')
    ) {
      const sentences = trimmed.match(/[^.!?]+[.!?]+(?:\s+|$)/g);
      if (sentences && sentences.length >= 3) {
        sentences.forEach((s) => outLines.push(s.trim()));
        continue;
      }
    }
    outLines.push(trimmed);
  }
  return outLines.join('\n');
}

/**
 * Converts pasted notes / Word text / Markdown / tables into beautifully structured Save My Exams-style sections.
 */
export function parseTextIntoStructuredNote(rawInput: string): {
  note: StructuredNoteData;
  extractedCards: Array<{ q: string; a: string; sectionName: string }>;
} {
  const text = preprocessPlainStudyText(rawInput);
  const sections: NoteSectionBlock[] = [];
  const keyTerms: KeyTermPair[] = [];
  const extractedCards: Array<{ q: string; a: string; sectionName: string }> = [];
  const seenTerms = new Set<string>();
  let summary = '';
  let examTip = '';
  let workedExample = '';

  let currentSec: NoteSectionBlock = {
    id: makeNoteId('sec'),
    heading: 'Key Points',
    points: [],
  };

  const pushCurrentSection = () => {
    if (currentSec.points.length > 0 || currentSec.heading !== 'Key Points') {
      sections.push(currentSec);
    }
  };

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Markdown table row handling: keep `| col1 | col2 |` lines intact (skip separator lines `| --- | --- |`)
    if (/^\|.+\|$/.test(line)) {
      if (/^\|\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|$/.test(line)) {
        continue;
      }
      currentSec.points.push(line);
      continue;
    }

    // Exam tip detection
    const tipMatch = line.match(
      /^(?:[-*•]\s*)?(?:\*\*)?(?:exam(?:iner)?\s*tip|top\s*tip|pro\s*tip|exam\s*alert|important|remember|warning)(?:\*\*)?\s*[:–—-]\s*(.+)$/i
    );
    if (tipMatch) {
      const val = tipMatch[1].trim();
      examTip = examTip ? `${examTip}\n${val}` : val;
      continue;
    }

    // Worked example / Case study line detection
    const exMatch = line.match(
      /^(?:[-*•]\s*)?(?:\*\*)?(?:worked\s*example|model\s*answer|sample\s*answer)(?:\*\*)?\s*[:–—-]\s*(.+)$/i
    );
    if (exMatch) {
      const val = exMatch[1].trim();
      workedExample = workedExample ? `${workedExample}\n${val}` : val;
      continue;
    }

    // Summary detection
    const sumMatch = line.match(/^(?:[-*•]\s*)?(?:\*\*)?(?:summary|overview|introduction)(?:\*\*)?\s*[:–—-]\s*(.+)$/i);
    if (sumMatch) {
      summary = summary ? `${summary} ${sumMatch[1].trim()}` : sumMatch[1].trim();
      continue;
    }

    // Markdown headings (#, ##, ###)
    const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const headingText = hMatch[2].replace(/\*\*/g, '').trim();
      if (level <= 2) {
        pushCurrentSection();
        currentSec = {
          id: makeNoteId('sec'),
          heading: headingText,
          points: [],
        };
      } else {
        // Subheading H3 / H4 renders cleanly inside section
        currentSec.points.push(`### ${headingText}`);
      }
      continue;
    }

    // Whole-line bold heading e.g. **Causes of Urban Growth**
    const boldHeading = line.match(/^\*\*([^*]{3,75})\*\*$/);
    if (boldHeading) {
      pushCurrentSection();
      currentSec = {
        id: makeNoteId('sec'),
        heading: boldHeading[1].trim(),
        points: [],
      };
      continue;
    }

    // Case Study / numbered section line e.g. "1. Coastal Processes" or "Case Study – Nairobi, Kenya"
    const numberedSec = line.match(/^(?:\d+[.)]\s+|Case\s+Study\s*[–—:-]\s*)(.{3,75})$/i);
    if (
      numberedSec &&
      !/[.!?]$/.test(line) &&
      !line.includes(':') &&
      line.split(/\s+/).length <= 10
    ) {
      pushCurrentSection();
      currentSec = {
        id: makeNoteId('sec'),
        heading: line.replace(/^\d+[.)]\s+/, '').trim(),
        points: [],
      };
      continue;
    }

    // Heading ending with ":" (standalone short line)
    if (
      line.length <= 68 &&
      line.endsWith(':') &&
      !line.startsWith('-') &&
      !line.startsWith('*') &&
      !line.startsWith('•') &&
      !line.includes('|')
    ) {
      pushCurrentSection();
      currentSec = {
        id: makeNoteId('sec'),
        heading: line.slice(0, -1).replace(/\*\*/g, '').trim(),
        points: [],
      };
      continue;
    }

    // Short standalone ALL-CAPS heading
    if (
      line.length >= 4 &&
      line.length <= 60 &&
      /^[A-Z0-9\s&/()-]+$/.test(line) &&
      /[A-Z]{3}/.test(line)
    ) {
      pushCurrentSection();
      currentSec = {
        id: makeNoteId('sec'),
        heading: line
          .toLowerCase()
          .replace(/\b\w/g, (ch) => ch.toUpperCase()),
        points: [],
      };
      continue;
    }

    const isExplicitBullet = /^(?:[-*•–—]|\d+[.)])\s+/.test(line);
    const cleanBullet = line.replace(/^(?:[-*•–—]|\d+[.)])\s+/, '').trim();
    if (!cleanBullet) continue;

    // Tab / Pipe / :: / Arrow definitions (Term | Definition or Term \t Definition)
    const tabOrPipe = cleanBullet.includes('\t')
      ? cleanBullet.split('\t').map((s) => s.trim()).filter(Boolean)
      : cleanBullet.includes('|')
      ? cleanBullet.split('|').map((s) => s.trim()).filter(Boolean)
      : cleanBullet.includes('::')
      ? cleanBullet.split('::').map((s) => s.trim()).filter(Boolean)
      : null;

    if (tabOrPipe && tabOrPipe.length >= 2 && tabOrPipe[0] && tabOrPipe[1]) {
      const cleanT = tabOrPipe[0].replace(/\*\*/g, '').trim();
      const cleanD = tabOrPipe.slice(1).join(' — ').trim();
      addTermAndCard(keyTerms, extractedCards, seenTerms, cleanT, cleanD, currentSec.heading);
      currentSec.points.push(`**${cleanT}**: ${cleanD}`);
      continue;
    }

    // **Term**: Definition or **Term** - Definition
    const boldDef = cleanBullet.match(/^\*\*(.+?)\*\*\s*[:–—-]\s*(.+)$/);
    if (boldDef && boldDef[1].length <= 80) {
      const term = boldDef[1].trim();
      const def = boldDef[2].trim();
      addTermAndCard(keyTerms, extractedCards, seenTerms, term, def, currentSec.heading);
      currentSec.points.push(`**${term}**: ${def}`);
      continue;
    }

    // Term: Definition (when term is crisp & descriptive)
    const colonDef = cleanBullet.match(/^([A-Za-z0-9 ()/%'’&-]{2,52}):\s+(.{6,})$/);
    if (colonDef && !/^http/i.test(colonDef[1])) {
      const term = colonDef[1].trim();
      const def = colonDef[2].trim();
      addTermAndCard(keyTerms, extractedCards, seenTerms, term, def, currentSec.heading);
      currentSec.points.push(`**${term}**: ${def}`);
      continue;
    }

    // First clean prose sentence becomes Topic Overview if none specified yet
    if (
      !summary &&
      currentSec.points.length === 0 &&
      sections.length === 0 &&
      !isExplicitBullet &&
      cleanBullet.length >= 35
    ) {
      summary = cleanBullet;
    } else if (isExplicitBullet) {
      currentSec.points.push(cleanBullet);
    } else {
      // Preserve prose sentence cleanly as paragraph or concise bullet depending on length
      currentSec.points.push(cleanBullet.length > 115 ? `¶ ${cleanBullet}` : cleanBullet);
    }
  }

  pushCurrentSection();

  if (sections.length === 0) {
    sections.push({
      id: makeNoteId('sec'),
      heading: 'Key Points',
      points: summary ? [] : text ? [text] : [],
    });
  }

  return {
    note: {
      summary,
      sections,
      keyTerms,
      examTip,
      workedExample,
      updatedAt: new Date().toISOString(),
    },
    extractedCards,
  };
}

function extractInlineFormattedText(el: Element): string {
  const parts: string[] = [];
  const walkNode = (node: Node) => {
    if (node.nodeType === 3) {
      parts.push(node.textContent || '');
      return;
    }
    if (node.nodeType !== 1) return;
    const elem = node as Element;
    const tag = elem.tagName.toLowerCase();
    const cls = (elem.getAttribute('class') || '').toLowerCase();

    // Handle flowcharts: <span class="flow"><span class="st"><em>1</em>Step</span><span class="ar">→</span></span>
    if (cls.includes('st')) {
      const stepParts: string[] = [];
      Array.from(elem.childNodes).forEach((ch) => {
        if (ch.nodeType === 1 && (ch as Element).tagName.toLowerCase() === 'em') {
          const num = (ch.textContent || '').trim();
          if (num) stepParts.push(`${num}) `);
        } else {
          stepParts.push(ch.textContent || '');
        }
      });
      parts.push(stepParts.join('').trim());
      return;
    }
    if (cls.includes('ar')) {
      parts.push(' → ');
      return;
    }

    // Skip section badge inside h2 when extracting heading separately, or add space
    if (cls.includes('nb')) {
      const n = (elem.textContent || '').trim();
      if (n) parts.push(`${n}. `);
      return;
    }

    if (cls.includes('bd')) {
      const badge = (elem.textContent || '').trim();
      if (badge) parts.push(` [${badge}]`);
      return;
    }

    if (tag === 'b' || tag === 'strong') {
      const inner = Array.from(elem.childNodes).map((c) => {
        const prevLen = parts.length;
        walkNode(c);
        return parts.splice(prevLen).join('');
      }).join('').trim();
      if (inner) {
        parts.push(`**${inner}**`);
      }
      return;
    }

    if (tag === 'br') {
      parts.push(' ');
      return;
    }

    Array.from(elem.childNodes).forEach(walkNode);
  };

  Array.from(el.childNodes).forEach(walkNode);
  return parts
    .join('')
    .replace(/\s+/g, ' ')
    .replace(/\*\*([^*]+?):\*\*/g, '**$1**:')
    .trim();
}

/**
 * Converts rich HTML notes (`gdoc-*` or `.docx` HTML) into cleanly formatted Save My Exams StructuredNoteData
 * preserving headings, subheadings, bold terms, flow diagrams, and Markdown tables inline!
 */
export function legacyHtmlToStructuredNote(html: string): StructuredNoteData {
  const cleanHtml = String(html || '').trim();
  if (!cleanHtml) return createEmptyStructuredNote();
  const hasTable = /<table[\s>]/i.test(cleanHtml);

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    const sections: NoteSectionBlock[] = [];
    const keyTerms: KeyTermPair[] = [];
    const seenTerms = new Set<string>();
    let summary = '';

    let current: NoteSectionBlock = {
      id: makeNoteId('sec'),
      heading: 'Study Notes',
      points: [],
    };

    const pushCur = () => {
      if (current.points.length > 0 || (current.heading !== 'Study Notes' && sections.length > 0)) {
        sections.push(current);
      }
    };

    const addFormattedLine = (txt: string, asParagraph = false) => {
      const clean = txt.trim();
      if (!clean) return;

      // Tab-separated fallback rows inside HTML paragraphs (seen in gdoc-geo8)
      if (clean.includes('\t')) {
        const cols = clean.split('\t').map((c) => c.trim()).filter(Boolean);
        if (cols.length >= 2) {
          current.points.push(`| ${cols.join(' | ')} |`);
          return;
        }
      }

      const boldKv = clean.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
      const plainKv = clean.match(/^([A-Za-z0-9 ()/%'’&-]{2,48}):\s+(.{6,})$/);
      if (boldKv) {
        const term = boldKv[1].replace(/\*\*/g, '').trim();
        const def = boldKv[2].trim();
        if (!seenTerms.has(term.toLowerCase())) {
          seenTerms.add(term.toLowerCase());
          keyTerms.push({ id: makeNoteId('term'), term, definition: def });
        }
        current.points.push(`**${term}**: ${def}`);
      } else if (plainKv && !/^http/i.test(plainKv[1])) {
        const term = plainKv[1].trim();
        const def = plainKv[2].trim();
        if (!seenTerms.has(term.toLowerCase())) {
          seenTerms.add(term.toLowerCase());
          keyTerms.push({ id: makeNoteId('term'), term, definition: def });
        }
        current.points.push(`**${term}**: ${def}`);
      } else {
        if (!summary && current.points.length === 0 && sections.length === 0 && asParagraph && clean.length >= 35) {
          summary = clean.replace(/\*\*/g, '');
        } else {
          current.points.push(asParagraph && clean.length > 120 ? `¶ ${clean}` : clean);
        }
      }
    };

    const walk = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2') {
        if (current.points.length > 0 || current.heading !== 'Study Notes') {
          pushCur();
        }
        const headingTxt = extractInlineFormattedText(el).replace(/\*\*/g, '').trim() || 'Section';
        current = {
          id: makeNoteId('sec'),
          heading: headingTxt,
          points: [],
        };
      } else if (tag === 'h3' || tag === 'h4') {
        const subTxt = extractInlineFormattedText(el).replace(/\*\*/g, '').trim();
        if (subTxt) {
          current.points.push(`### ${subTxt}`);
        }
      } else if (tag === 'table') {
        const rows = Array.from(el.querySelectorAll('tr'));
        for (const tr of rows) {
          const cells = Array.from(tr.children).map((cell) =>
            extractInlineFormattedText(cell).replace(/\|/g, '/').trim()
          );
          if (cells.some(Boolean)) {
            current.points.push(`| ${cells.join(' | ')} |`);
          }
        }
      } else if (tag === 'li') {
        addFormattedLine(extractInlineFormattedText(el), false);
      } else if (tag === 'p') {
        addFormattedLine(extractInlineFormattedText(el), true);
      } else if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'body' || tag === 'section') {
        Array.from(el.children).forEach(walk);
      }
    };

    Array.from(doc.body.children).forEach(walk);
    pushCur();

    const populatedSections = sections.filter(
      (s) => s.points.length > 0 || s.heading.trim().length > 0
    );

    return {
      summary,
      sections: populatedSections.length
        ? populatedSections
        : [{ id: makeNoteId('sec'), heading: 'Study Notes', points: [] }],
      keyTerms,
      examTip: '',
      workedExample: '',
      legacyHtml: hasTable ? cleanHtml : undefined,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return {
      ...createEmptyStructuredNote(),
      legacyHtml: cleanHtml,
    };
  }
}

export function structuredNoteToHtml(title: string, note: StructuredNoteData): string {
  const esc = (s: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  const fmt = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  const parts: string[] = [`<h1>${esc(title)}</h1>`];
  if (note.summary.trim()) {
    parts.push(`<p><strong>Summary:</strong> ${fmt(note.summary)}</p>`);
  }
  for (const sec of note.sections) {
    if (!sec.heading.trim() && sec.points.length === 0) continue;
    parts.push(`<h2>${esc(sec.heading)}</h2>`);
    if (sec.points.length > 0) {
      parts.push(`<ul>${sec.points.map((p) => `<li>${fmt(p)}</li>`).join('')}</ul>`);
    }
  }
  if (note.keyTerms.length > 0) {
    parts.push(
      `<h2>Key Terms</h2><table><thead><tr><th>Term</th><th>Definition</th></tr></thead><tbody>${note.keyTerms
        .map((k) => `<tr><td><strong>${esc(k.term)}</strong></td><td>${esc(k.definition)}</td></tr>`)
        .join('')}</tbody></table>`
    );
  }
  if (note.workedExample.trim()) {
    parts.push(`<blockquote><strong>Worked Example:</strong> ${fmt(note.workedExample)}</blockquote>`);
  }
  if (note.examTip.trim()) {
    parts.push(`<blockquote><strong>Examiner Tip:</strong> ${fmt(note.examTip)}</blockquote>`);
  }
  return parts.join('\n');
}

export type SectionRenderBlock =
  | { kind: 'subheading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'table'; headers: string[]; rows: string[][] };

function splitPipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * Groups raw section point strings into semantic blocks (tables, H3 subheadings, prose paragraphs, bullets)
 * for clean Save My Exams-style rendering.
 */
export function groupSectionPoints(points: string[]): SectionRenderBlock[] {
  const blocks: SectionRenderBlock[] = [];
  let i = 0;

  while (i < points.length) {
    const raw = (points[i] || '').trim();
    if (!raw) {
      i++;
      continue;
    }

    if (/^\|.+\|$/.test(raw)) {
      const tableRows: string[][] = [];
      while (i < points.length && /^\|.+\|$/.test((points[i] || '').trim())) {
        const line = points[i].trim();
        if (!/^\|\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|$/.test(line)) {
          tableRows.push(splitPipeRow(line));
        }
        i++;
      }
      if (tableRows.length > 0) {
        const maxCols = tableRows.reduce((m, r) => Math.max(m, r.length), 1);
        const padRow = (r: string[]) =>
          Array.from({ length: maxCols }, (_, idx) => r[idx] || '');
        const headers = padRow(tableRows[0]);
        const rows = tableRows.slice(1).map(padRow);
        blocks.push({ kind: 'table', headers, rows });
      }
      continue;
    }

    if (raw.startsWith('### ')) {
      blocks.push({ kind: 'subheading', text: raw.slice(4).trim() });
      i++;
      continue;
    }

    if (raw.startsWith('¶ ')) {
      blocks.push({ kind: 'paragraph', text: raw.slice(2).trim() });
      i++;
      continue;
    }

    blocks.push({ kind: 'bullet', text: raw });
    i++;
  }

  return blocks;
}

