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
    (s) => s.points.some((p) => p.trim().length > 0) || (s.heading.trim().length > 0 && note.sections.length > 1)
  );
  const hasTerms = note.keyTerms.some((k) => k.term.trim() && k.definition.trim());
  const hasTip = note.examTip.trim().length > 0;
  const hasEx = note.workedExample.trim().length > 0;
  const hasLegacy = Boolean(note.legacyHtml && note.legacyHtml.replace(/<[^>]+>/g, '').trim().length > 0);
  return !hasSummary && !hasSections && !hasTerms && !hasTip && !hasEx && !hasLegacy;
}

/**
 * Converts messy pasted notes / Markdown / HTML from Save My Exams or Word docs into clean Save My Exams structure.
 */
export function parseTextIntoStructuredNote(rawInput: string): {
  note: StructuredNoteData;
  extractedCards: Array<{ q: string; a: string; sectionName: string }>;
} {
  const text = String(rawInput || '').replace(/\r/g, '').trim();
  const sections: NoteSectionBlock[] = [];
  const keyTerms: KeyTermPair[] = [];
  const extractedCards: Array<{ q: string; a: string; sectionName: string }> = [];
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
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Exam tip detection
    const tipMatch = line.match(/^(?:exam(?:iner)?\s*tip|top\s*tip|tip|warning)\s*:\s*(.+)$/i);
    if (tipMatch) {
      examTip = examTip ? `${examTip}\n${tipMatch[1].trim()}` : tipMatch[1].trim();
      continue;
    }

    // Worked example detection
    const exMatch = line.match(/^(?:worked\s*example|example|case\s*study)\s*:\s*(.+)$/i);
    if (exMatch) {
      workedExample = workedExample
        ? `${workedExample}\n${exMatch[1].trim()}`
        : exMatch[1].trim();
      continue;
    }

    // Summary detection
    const sumMatch = line.match(/^(?:summary|overview)\s*:\s*(.+)$/i);
    if (sumMatch) {
      summary = sumMatch[1].trim();
      continue;
    }

    // Heading detection (# Heading, ## Heading, ### Heading, or ALL CAPS / ends with : standalone)
    const hMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (hMatch) {
      pushCurrentSection();
      currentSec = {
        id: makeNoteId('sec'),
        heading: hMatch[1].trim(),
        points: [],
      };
      continue;
    }

    if (
      line.length <= 64 &&
      line.endsWith(':') &&
      !line.startsWith('-') &&
      !line.startsWith('*') &&
      !line.includes('|')
    ) {
      pushCurrentSection();
      currentSec = {
        id: makeNoteId('sec'),
        heading: line.slice(0, -1).trim(),
        points: [],
      };
      continue;
    }

    const cleanBullet = line.replace(/^(?:[-*•–—]|\d+[.)])\s+/, '').trim();

    // Detect flashcards / key-term pairs:
    // 1. **Term**: Definition  or  Term: Definition (short term <= 60 chars)
    // 2. Term | Definition or Term :: Definition or Term \t Definition
    const tabOrPipe = cleanBullet.includes('\t')
      ? cleanBullet.split('\t').map((s) => s.trim())
      : cleanBullet.includes('|')
      ? cleanBullet.split('|').map((s) => s.trim())
      : cleanBullet.includes('::')
      ? cleanBullet.split('::').map((s) => s.trim())
      : null;

    if (tabOrPipe && tabOrPipe.length >= 2 && tabOrPipe[0] && tabOrPipe[1]) {
      keyTerms.push({
        id: makeNoteId('term'),
        term: tabOrPipe[0].replace(/\*\*/g, ''),
        definition: tabOrPipe[1],
      });
      extractedCards.push({
        q: tabOrPipe[0].replace(/\*\*/g, ''),
        a: tabOrPipe[1],
        sectionName: currentSec.heading || 'Key Terms',
      });
      currentSec.points.push(`**${tabOrPipe[0].replace(/\*\*/g, '')}**: ${tabOrPipe[1]}`);
      continue;
    }

    const boldDef = cleanBullet.match(/^\*\*(.+?)\*\*\s*[:–—-]\s*(.+)$/);
    if (boldDef && boldDef[1].length <= 80) {
      const term = boldDef[1].trim();
      const def = boldDef[2].trim();
      keyTerms.push({ id: makeNoteId('term'), term, definition: def });
      extractedCards.push({
        q: term,
        a: def,
        sectionName: currentSec.heading || 'Key Terms',
      });
      currentSec.points.push(`**${term}**: ${def}`);
      continue;
    }

    const colonDef = cleanBullet.match(/^([A-Za-z0-9 ()/%'-]{2,48}):\s+(.{8,})$/);
    if (colonDef && !/^http/i.test(colonDef[1])) {
      const term = colonDef[1].trim();
      const def = colonDef[2].trim();
      keyTerms.push({ id: makeNoteId('term'), term, definition: def });
      extractedCards.push({
        q: term,
        a: def,
        sectionName: currentSec.heading || 'Key Terms',
      });
      currentSec.points.push(`**${term}**: ${def}`);
      continue;
    }

    // Regular bullet or paragraph sentence
    if (!summary && currentSec.points.length === 0 && sections.length === 0 && !line.startsWith('-') && !line.startsWith('*') && line.length >= 40) {
      summary = cleanBullet;
    } else {
      currentSec.points.push(cleanBullet);
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

/**
 * Converts legacy HTML (`gdoc-*` or `.docx` HTML) safely into StructuredNoteData while keeping a fallback preview if tables/complex markup exist.
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
    let current: NoteSectionBlock = {
      id: makeNoteId('sec'),
      heading: 'Study Notes',
      points: [],
    };
    const pushCur = () => {
      if (current.points.length > 0 || sections.length === 0) {
        sections.push(current);
      }
    };

    const walk = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
        if (current.points.length > 0) sections.push(current);
        current = {
          id: makeNoteId('sec'),
          heading: (el.textContent || '').trim() || 'Section',
          points: [],
        };
      } else if (tag === 'li' || tag === 'p') {
        const txt = (el.textContent || '').trim();
        if (txt) {
          const kv = txt.match(/^([A-Za-z0-9 ()/%'-]{2,45}):\s+(.{6,})$/);
          if (kv) {
            keyTerms.push({
              id: makeNoteId('term'),
              term: kv[1].trim(),
              definition: kv[2].trim(),
            });
            current.points.push(`**${kv[1].trim()}**: ${kv[2].trim()}`);
          } else {
            current.points.push(txt);
          }
        }
      } else if (tag === 'ul' || tag === 'ol' || tag === 'div' || tag === 'body' || tag === 'section') {
        Array.from(el.children).forEach(walk);
      }
    };

    Array.from(doc.body.children).forEach(walk);
    pushCur();

    return {
      summary: '',
      sections: sections.filter((s) => s.points.length > 0).length
        ? sections.filter((s) => s.points.length > 0)
        : [{ id: makeNoteId('sec'), heading: 'Study Notes', points: [] }],
      keyTerms,
      examTip: '',
      workedExample: '',
      legacyHtml: hasTable || !sections.some((s) => s.points.length > 0) ? cleanHtml : undefined,
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
