import {
  KeyTermPair,
  NoteSectionBlock,
  StructuredNoteData,
  TimelineEventItem,
} from '../types';

export type NoteFormatPreset =
  | 'save-my-exams'
  | 'cornell'
  | 'timeline-causal'
  | 'compact';

export interface AutoFormatOptions {
  preset?: NoteFormatPreset;
  extractKeyTerms?: boolean;
  detectFlowDiagrams?: boolean;
  autoTables?: boolean;
  splitDenseParagraphs?: boolean;
  strictHeadings?: boolean;
}

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
  sectionHeading: string,
  allowExtraction = true
) {
  if (!allowExtraction) return;
  const cleanTerm = term.replace(/\*\*/g, '').replace(/[{}]/g, '').trim();
  const cleanDef = definition.replace(/\{\{([^}]+)\}\}/g, '$1').trim();
  if (!cleanTerm || !cleanDef || cleanTerm.length < 2 || cleanDef.length < 2) return;
  if (/^(?:page|fig(?:ure)?|table|source|http|step\s*\d+)\b/i.test(cleanTerm)) return;
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

function splitRespectingAbbreviations(paragraph: string): string[] {
  const placeholderMap: Array<[string, string]> = [];
  let protectedTxt = paragraph.replace(
    /\b(e\.g\.|i\.e\.|etc\.|vs\.|c\.|dr\.|mr\.|mrs\.|ms\.|prof\.|fig\.|no\.|st\.|approx\.)/gi,
    (m) => {
      const token = `__ABBR_${placeholderMap.length}__`;
      placeholderMap.push([token, m]);
      return token;
    }
  );
  protectedTxt = protectedTxt.replace(/(\d)\.(\d)/g, '$1__DEC__$2');

  const rawSentences = protectedTxt.match(/[^.!?]+[.!?]+(?:\s+|$)|[^.!?]+$/g);
  if (!rawSentences) return [paragraph];

  return rawSentences
    .map((s) => {
      let restored = s.replace(/__DEC__/g, '.');
      for (const [token, orig] of placeholderMap) {
        restored = restored.replace(token, orig);
      }
      return restored.trim();
    })
    .filter(Boolean);
}

function isBoilerplateNoiseLine(line: string): boolean {
  const clean = line.replace(/\*\*/g, '').trim();
  if (!clean) return true;
  if (/^(?:={3,}|-{3,}|_{3,}|\*{3,})$/.test(clean)) return true;
  if (
    /^(?:advertisement|sponsored|did this page help you\??|yes\s*no|test yourself|join now|sign up|log in|cookie preferences|next topic|previous topic|back to top|download pdf|view all topics|jump to|table of contents|skip to (?:main )?content|\[edit\]|share this page|print this page)$/i.test(
      clean
    )
  ) {
    return true;
  }
  if (/^(?:page\s*)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?$/i.test(clean)) return true;
  return false;
}

/**
 * Normalizes Setext headings, strips web/PDF boilerplate, detects multi-space tables,
 * preserves bullet hierarchy, and splits dense walls of text safely.
 */
function preprocessPlainStudyText(
  rawInput: string,
  opts: AutoFormatOptions
): string {
  const normalized = String(rawInput || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .trim();
  if (!normalized) return '';

  const rawLines = normalized.split('\n');
  const outLines: string[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i].trimEnd();
    const trimmed = line.trim();

    // Handle Setext headings ("Title\n====" or "Subheading\n----")
    const nextTrimmed = (rawLines[i + 1] || '').trim();
    if (trimmed && /^={3,}$/.test(nextTrimmed)) {
      outLines.push(`# ${trimmed.replace(/\*\*/g, '')}`);
      i++;
      continue;
    }
    if (trimmed && /^-{3,}$/.test(nextTrimmed) && !trimmed.startsWith('|')) {
      outLines.push(`## ${trimmed.replace(/\*\*/g, '')}`);
      i++;
      continue;
    }

    if (!trimmed) continue;
    if (isBoilerplateNoiseLine(trimmed)) continue;

    // Preserve indentation before bullet markers so sub-bullets keep hierarchy
    const indentLead = line.match(/^(\s{2,}|\t+)(.*)$/);
    if (indentLead && /^(?:[-*•▪◦‣–—]|\d+[.)])\s+/.test(indentLead[2])) {
      outLines.push(`  ${indentLead[2].trim()}`);
      continue;
    }

    // Convert multi-space column lines ("Term    Value    Impact") into pipe tables if autoTables is active
    if (
      opts.autoTables !== false &&
      !/^[-*•#\d|]/.test(trimmed) &&
      /\S\s{3,}\S/.test(trimmed)
    ) {
      const cols = trimmed.split(/\s{3,}/).map((c) => c.trim()).filter(Boolean);
      if (cols.length >= 2 && cols.length <= 5) {
        outLines.push(`| ${cols.join(' | ')} |`);
        continue;
      }
    }

    // Split dense prose paragraphs (> 240 chars or 3+ sentences) when splitDenseParagraphs is enabled
    if (
      opts.splitDenseParagraphs !== false &&
      trimmed.length > 230 &&
      !trimmed.startsWith('|') &&
      !trimmed.startsWith('#') &&
      !/^(?:[-*•▪◦‣]|\d+[.)])\s+/.test(trimmed)
    ) {
      const sentences = splitRespectingAbbreviations(trimmed);
      if (sentences.length >= 2) {
        sentences.forEach((s) => outLines.push(s));
        continue;
      }
    }
    outLines.push(trimmed);
  }
  return outLines.join('\n');
}

function tryBuildSequentialFlow(line: string): string | null {
  const clean = line.replace(/\*\*/g, '').trim();
  // Explicit arrows (A -> B -> C or A => B => C or A → B → C)
  const arrowParts = clean.split(/\s*(?:->|=>|→)\s*/).filter(Boolean);
  if (arrowParts.length >= 3 && arrowParts.every((p) => p.length <= 90)) {
    return `⇒ ${arrowParts.join(' → ')}`;
  }

  // Step 1: ... Step 2: ... Step 3: ...
  const stepMatches = clean.match(
    /(?:step\s*\d+\s*[:–-]\s*|^\s*first(?:ly)?,\s*|(?<=[\.;]\s*)(?:next|then|after\s+that|subsequently|finally),\s*)/gi
  );
  if (stepMatches && stepMatches.length >= 2) {
    const parts = clean
      .split(
        /(?:^|\.\s*|;\s*)(?:step\s*\d+\s*[:–-]\s*|first(?:ly)?,\s*|next,\s*|then,\s*|after\s+that,\s*|subsequently,\s*|finally,\s*)/i
      )
      .map((p) => p.replace(/[.;]+$/, '').trim())
      .filter((p) => p.length >= 3);
    if (parts.length >= 3 && parts.length <= 7 && parts.every((p) => p.length <= 95)) {
      return `⇒ ${parts.join(' → ')}`;
    }
  }
  return null;
}

function convertBalancedProsConsToTables(sections: NoteSectionBlock[]): void {
  const pairHeads: Array<[RegExp, RegExp, [string, string]]> = [
    [/^advantages|pros|strengths|benefits/i, /^disadvantages|cons|weaknesses|limitations|drawbacks/i, ['Advantages / Strengths', 'Disadvantages / Limitations']],
    [/^causes|reasons/i, /^effects|consequences|impacts/i, ['Causes', 'Effects / Consequences']],
  ];

  for (const sec of sections) {
    const pts = sec.points;
    for (let i = 0; i < pts.length; i++) {
      if (!pts[i].startsWith('### ')) continue;
      const h1 = pts[i].slice(4).trim();

      // Find end of block 1 and start of next ### heading
      let nextSubIdx = -1;
      for (let j = i + 1; j < pts.length; j++) {
        if (pts[j].startsWith('### ')) {
          nextSubIdx = j;
          break;
        }
      }
      if (nextSubIdx === -1) continue;
      const h2 = pts[nextSubIdx].slice(4).trim();
      const matchedPair = pairHeads.find(([r1, r2]) => r1.test(h1) && r2.test(h2));
      if (!matchedPair) continue;

      let endBlock2 = pts.length;
      for (let j = nextSubIdx + 1; j < pts.length; j++) {
        if (pts[j].startsWith('### ') || /^\|.+\|$/.test(pts[j])) {
          endBlock2 = j;
          break;
        }
      }

      const list1 = pts
        .slice(i + 1, nextSubIdx)
        .map((p) => p.replace(/^↳\s*/, '').replace(/^¶\s*/, '').replace(/\|/g, '/').trim())
        .filter(Boolean);
      const list2 = pts
        .slice(nextSubIdx + 1, endBlock2)
        .map((p) => p.replace(/^↳\s*/, '').replace(/^¶\s*/, '').replace(/\|/g, '/').trim())
        .filter(Boolean);

      if (list1.length >= 2 && list2.length >= 2 && list1.length <= 7 && list2.length <= 7) {
        const rowsCount = Math.max(list1.length, list2.length);
        const tableLines: string[] = [`| ${matchedPair[2][0]} | ${matchedPair[2][1]} |`];
        for (let r = 0; r < rowsCount; r++) {
          tableLines.push(`| ${list1[r] || '—'} | ${list2[r] || '—'} |`);
        }
        pts.splice(i, endBlock2 - i, ...tableLines);
        i += tableLines.length - 1;
      }
    }
  }
}

/**
 * Converts pasted notes / Word text / PDF / Web articles / Markdown / tables into cleanly structured
 * study sections according to the user's chosen formatting preset and options.
 */
export function parseTextIntoStructuredNote(
  rawInput: string,
  options: AutoFormatOptions = {}
): {
  note: StructuredNoteData;
  extractedCards: Array<{ q: string; a: string; sectionName: string }>;
} {
  const preset: NoteFormatPreset = options.preset || 'save-my-exams';
  const allowKeyTerms = options.extractKeyTerms !== false;
  const detectFlows = options.detectFlowDiagrams !== false || preset === 'timeline-causal';
  const buildAutoTables = options.autoTables !== false;
  const strictHeadings = Boolean(options.strictHeadings);

  const text = preprocessPlainStudyText(rawInput, options);
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

  const SUBHEADING_CUES =
    /^(?:causes|effects|consequences|impacts|advantages|disadvantages|pros|cons|strengths|weaknesses|limitations|benefits|drawbacks|key features|evaluation|evidence|methods|factors|solutions|significance|outcomes)$/i;

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const isNestedBullet = /^\s{2,}(?:[-*•▪◦‣–—]|\d+[.)])\s+/.test(rawLine);
    let line = rawLine.trim();
    if (!line) continue;

    // Extract Gizmo / revision cloze deletions `{{answer}}` or `==answer==` into flashcards
    if (/\{\{[^}]+\}\}|==[^=]+==/.test(line)) {
      const cleanStatement = line
        .replace(/^(?:[-*•▪◦‣–—]|\d+[.)])\s+/, '')
        .replace(/\{\{([^}]+)\}\}/g, '**$1**')
        .replace(/==([^=]+)==/g, '**$1**')
        .trim();

      const clozeRegex = /\{\{([^}]+)\}\}|==([^=]+)==/g;
      let match: RegExpExecArray | null;
      while ((match = clozeRegex.exec(line)) !== null) {
        const answer = (match[1] || match[2] || '').trim();
        if (answer) {
          const prompt = line
            .replace(/^(?:[-*•▪◦‣–—]|\d+[.)])\s+/, '')
            .replace(match[0], '[____]')
            .replace(/\{\{([^}]+)\}\}/g, '$1')
            .replace(/==([^=]+)==/g, '$1')
            .trim();
          if (allowKeyTerms && prompt && answer) {
            extractedCards.push({
              q: prompt,
              a: answer,
              sectionName: currentSec.heading || 'Cloze Recall',
            });
          }
        }
      }
      line = isNestedBullet ? `  - ${cleanStatement}` : `- ${cleanStatement}`;
    }

    // Markdown table row handling: keep `| col1 | col2 |` lines intact (skip separator lines `| --- | --- |`)
    if (/^\|.+\|$/.test(line)) {
      if (/^\|\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|$/.test(line)) {
        continue;
      }
      currentSec.points.push(line);
      continue;
    }

    // Exam tip / Key Takeaway / Misconception detection
    const tipMatch = line.match(
      /^(?:[-*•]\s*)?(?:\*\*)?(?:exam(?:iner)?\s*tip|top\s*tip|pro\s*tip|exam\s*alert|key\s*takeaway|common\s*mistake|important|remember|warning)(?:\*\*)?\s*[:–—-]\s*(.+)$/i
    );
    if (tipMatch) {
      const val = tipMatch[1].trim();
      examTip = examTip ? `${examTip}\n${val}` : val;
      continue;
    }

    // Worked example / Model answer detection
    const exMatch = line.match(
      /^(?:[-*•]\s*)?(?:\*\*)?(?:worked\s*example|model\s*answer|sample\s*answer)(?:\*\*)?\s*[:–—-]\s*(.+)$/i
    );
    if (exMatch) {
      const val = exMatch[1].trim();
      workedExample = workedExample ? `${workedExample}\n${val}` : val;
      continue;
    }

    // Summary detection
    const sumMatch = line.match(
      /^(?:[-*•]\s*)?(?:\*\*)?(?:summary|overview|introduction|key\s*idea)(?:\*\*)?\s*[:–—-]\s*(.+)$/i
    );
    if (sumMatch) {
      summary = summary ? `${summary} ${sumMatch[1].trim()}` : sumMatch[1].trim();
      continue;
    }

    // Markdown headings (#, ##, ###, ####)
    const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const headingText = hMatch[2].replace(/\*\*/g, '').trim();
      if (level <= 2) {
        // Avoid leaving an empty initial H1-title-only section before an H2 if there are no points yet
        if (
          level === 2 &&
          sections.length === 0 &&
          currentSec.points.length === 0 &&
          currentSec.heading !== 'Key Points' &&
          !summary
        ) {
          summary = `Study notes on ${currentSec.heading}.`;
        } else {
          pushCurrentSection();
        }
        currentSec = {
          id: makeNoteId('sec'),
          heading: headingText,
          points: [],
        };
      } else {
        currentSec.points.push(`### ${headingText}`);
      }
      continue;
    }

    if (!strictHeadings) {
      // Whole-line bold heading e.g. **Causes of Urban Growth**
      const boldHeading = line.match(/^\*\*([^*]{3,80})\*\*$/);
      if (boldHeading) {
        const headingTxt = boldHeading[1].replace(/:$/, '').trim();
        if (SUBHEADING_CUES.test(headingTxt)) {
          currentSec.points.push(`### ${headingTxt}`);
        } else {
          pushCurrentSection();
          currentSec = {
            id: makeNoteId('sec'),
            heading: headingTxt,
            points: [],
          };
        }
        continue;
      }

      // Hierarchical numbered/Part/Topic/Case Study headings ("1.1 Economic Factors", "Part B: Effects", "Case Study – Nairobi")
      const structSec = line.match(
        /^(?:(?:\d+(?:\.\d+)*[.)]\s+)|(?:Part|Topic|Section|Unit|Chapter)\s+[A-Z0-9]+\s*[:–—-]\s*|(?:Case\s+Study\s*[–—:-]\s*))(.{3,80})$/i
      );
      if (
        structSec &&
        !/[.!?]$/.test(line) &&
        line.split(/\s+/).length <= 12 &&
        !/^\d{3,4}\s/.test(line)
      ) {
        const cleanHead = /^case\s+study/i.test(line)
          ? line.trim()
          : structSec[1].replace(/:$/, '').trim();
        if (/^\d+\.\d+/.test(line)) {
          currentSec.points.push(`### ${cleanHead}`);
        } else {
          pushCurrentSection();
          currentSec = {
            id: makeNoteId('sec'),
            heading: cleanHead,
            points: [],
          };
        }
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
        const headingTxt = line.slice(0, -1).replace(/\*\*/g, '').trim();
        if (SUBHEADING_CUES.test(headingTxt)) {
          currentSec.points.push(`### ${headingTxt}`);
        } else {
          pushCurrentSection();
          currentSec = {
            id: makeNoteId('sec'),
            heading: headingTxt,
            points: [],
          };
        }
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
    }

    const isExplicitBullet = /^(?:[-*•▪◦‣–—]|\d+[.)])\s+/.test(line);
    const cleanBullet = line.replace(/^(?:[-*•▪◦‣–—]|\d+[.)])\s+/, '').trim();
    if (!cleanBullet) continue;

    // Detect sequential process / cause-effect flows when enabled
    if (detectFlows && !isNestedBullet) {
      const flowLine = tryBuildSequentialFlow(cleanBullet);
      if (flowLine) {
        currentSec.points.push(flowLine);
        continue;
      }
    }

    // Tab / Pipe / :: definitions (Term | Definition or Term \t Definition)
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
      addTermAndCard(
        keyTerms,
        extractedCards,
        seenTerms,
        cleanT,
        cleanD,
        currentSec.heading,
        allowKeyTerms
      );
      currentSec.points.push(isNestedBullet ? `↳ **${cleanT}**: ${cleanD}` : `**${cleanT}**: ${cleanD}`);
      continue;
    }

    // Formula / Equation highlighting
    const formulaMatch = cleanBullet.match(/^(?:\*\*)?(formula|equation|rule)(?:\*\*)?\s*[:–—=]\s*(.+)$/i);
    if (formulaMatch) {
      const label = formulaMatch[1].charAt(0).toUpperCase() + formulaMatch[1].slice(1).toLowerCase();
      const expr = formulaMatch[2].trim();
      addTermAndCard(
        keyTerms,
        extractedCards,
        seenTerms,
        `${currentSec.heading} ${label}`,
        expr,
        currentSec.heading,
        allowKeyTerms
      );
      currentSec.points.push(`**${label}**: ${expr}`);
      continue;
    }

    // **Term**: Definition or **Term** - Definition
    const boldDef = cleanBullet.match(/^\*\*(.+?)\*\*\s*[:–—-]\s*(.+)$/);
    if (boldDef && boldDef[1].length <= 80) {
      const term = boldDef[1].trim();
      const def = boldDef[2].trim();
      addTermAndCard(
        keyTerms,
        extractedCards,
        seenTerms,
        term,
        def,
        currentSec.heading,
        allowKeyTerms
      );
      const formatted = `**${term}**: ${def}`;
      currentSec.points.push(isNestedBullet ? `↳ ${formatted}` : formatted);
      continue;
    }

    // Term: Definition (when term is crisp & descriptive and not a date prefix)
    const colonDef = cleanBullet.match(/^([A-Za-z0-9 ()/%'’&-]{2,52}):\s+(.{6,})$/);
    if (
      colonDef &&
      !/^http/i.test(colonDef[1]) &&
      !/^(?:in|on|by|at|during)\s+\d{3,4}/i.test(colonDef[1]) &&
      !/^\d{3,4}$/.test(colonDef[1].trim())
    ) {
      const term = colonDef[1].trim();
      const def = colonDef[2].trim();
      addTermAndCard(
        keyTerms,
        extractedCards,
        seenTerms,
        term,
        def,
        currentSec.heading,
        allowKeyTerms
      );
      const formatted = `**${term}**: ${def}`;
      currentSec.points.push(isNestedBullet ? `↳ ${formatted}` : formatted);
      continue;
    }

    // Natural lecture prose definitions: "X is defined as Y" / "X refers to Y" / "X means Y" / "X is the process..."
    const proseDef = cleanBullet.match(
      /^(?:\*\*)?([A-Za-z][A-Za-z0-9 ()/'’&-]{1,50}?)(?:\*\*)?\s+(?:is defined as|refers to|is the process (?:by|in) which|means|describes)\s+(.{12,})$/i
    );
    if (proseDef) {
      const term = proseDef[1].replace(/\*\*/g, '').trim();
      const def = proseDef[2].trim();
      if (term.split(/\s+/).length <= 6) {
        addTermAndCard(
          keyTerms,
          extractedCards,
          seenTerms,
          term,
          def,
          currentSec.heading,
          allowKeyTerms
        );
      }
    } else {
      // Bolded key concept in sentence: "**The Dawes Plan** was a 1924 agreement..."
      const boldConcept = cleanBullet.match(
        /^\*\*([^*]{2,55})\*\*\s+(?:is|are|was|were|caused|enabled|allowed|reduced|created|established)\s+(.{14,})$/i
      );
      if (boldConcept) {
        const term = boldConcept[1].trim();
        addTermAndCard(
          keyTerms,
          extractedCards,
          seenTerms,
          term,
          cleanBullet.replace(/\*\*/g, ''),
          currentSec.heading,
          allowKeyTerms
        );
      }
    }

    // Highlight historical dates in timeline-causal preset
    const formattedPoint =
      preset === 'timeline-causal'
        ? cleanBullet.replace(
            /\b((?:\d{1,2}\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)?\s*(?:1\d{3}|20\d{2})(?:\s*[–-]\s*\d{2,4})?)\b/g,
            (m) => (cleanBullet.includes(`**${m}`) ? m : `**${m.trim()}**`)
          )
        : cleanBullet;

    // First clean prose sentence becomes Topic Overview if none specified yet
    if (
      !summary &&
      currentSec.points.length === 0 &&
      sections.length === 0 &&
      !isExplicitBullet &&
      cleanBullet.length >= 35
    ) {
      summary = cleanBullet.replace(/\*\*/g, '');
    } else if (isNestedBullet) {
      currentSec.points.push(`↳ ${formattedPoint}`);
    } else if (isExplicitBullet || preset === 'compact') {
      currentSec.points.push(formattedPoint);
    } else {
      currentSec.points.push(
        formattedPoint.length > 135 ? `¶ ${formattedPoint}` : formattedPoint
      );
    }
  }

  pushCurrentSection();

  // Prune empty placeholder sections & merge duplicate adjacent section headings
  let cleanedSections = sections.filter(
    (s) => s.points.length > 0 || (sections.length === 1 && s.heading.trim().length > 0)
  );

  // Merge sections with identical normalized headings
  const mergedByHeading: NoteSectionBlock[] = [];
  for (const sec of cleanedSections) {
    const existing = mergedByHeading.find(
      (x) => x.heading.toLowerCase() === sec.heading.toLowerCase()
    );
    if (existing) {
      existing.points.push(...sec.points);
    } else {
      mergedByHeading.push(sec);
    }
  }
  cleanedSections = mergedByHeading;

  // Compact preset: merge tiny 1-point orphan sections into previous section as H3 subheading
  if (preset === 'compact' && cleanedSections.length > 2) {
    const compacted: NoteSectionBlock[] = [];
    for (const sec of cleanedSections) {
      if (
        compacted.length > 0 &&
        sec.points.length === 1 &&
        !sec.points[0].startsWith('|') &&
        !/^case\s+study/i.test(sec.heading)
      ) {
        compacted[compacted.length - 1].points.push(`### ${sec.heading}`);
        compacted[compacted.length - 1].points.push(sec.points[0]);
      } else {
        compacted.push(sec);
      }
    }
    cleanedSections = compacted;
  }

  // Cornell preset: auto-generate crisp Topic Overview if missing
  if (preset === 'cornell' && !summary && cleanedSections.length > 0) {
    const topHeadings = cleanedSections.slice(0, 4).map((s) => s.heading).join(', ');
    summary = `Covers ${topHeadings} with ${keyTerms.length} key terms extracted for active recall.`;
  }

  if (buildAutoTables) {
    convertBalancedProsConsToTables(cleanedSections);
  }

  if (cleanedSections.length === 0) {
    cleanedSections.push({
      id: makeNoteId('sec'),
      heading: 'Key Points',
      points: summary ? [] : text ? [text] : [],
    });
  }

  return {
    note: {
      summary,
      sections: cleanedSections,
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
    if (cls.includes('flow')) {
      const flowSteps: string[] = [];
      Array.from(elem.children).forEach((ch) => {
        const chCls = (ch.getAttribute('class') || '').toLowerCase();
        if (chCls.includes('st')) {
          const stepParts: string[] = [];
          Array.from(ch.childNodes).forEach((sub) => {
            if (sub.nodeType === 1 && (sub as Element).tagName.toLowerCase() === 'em') {
              return; // Step number is rendered cleanly by flow diagram UI
            }
            stepParts.push(sub.textContent || '');
          });
          const stepTxt = stepParts.join('').replace(/\s+/g, ' ').trim();
          if (stepTxt) flowSteps.push(stepTxt);
        }
      });
      if (flowSteps.length > 0) {
        parts.push(`⇒ ${flowSteps.join(' → ')}`);
        return;
      }
    }

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

    // Highlighted figures/stats (<span class="fg">5.5 million</span>)
    if (cls.includes('fg')) {
      const val = (elem.textContent || '').replace(/\s+/g, ' ').trim();
      if (val) parts.push(`**${val}**`);
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
      }).join('').replace(/\*\*/g, '').trim();
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

      // Preserve flow sequences intact without mis-splitting as key-value terms
      if (clean.includes('⇒ ') || (clean.match(/\s*→\s*/g) || []).length >= 2) {
        current.points.push(clean);
        return;
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
      parts.push(
        `<ul>${sec.points
          .map((p) => `<li>${fmt(p.replace(/^↳\s*/, '').replace(/^¶\s*/, ''))}</li>`)
          .join('')}</ul>`
      );
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
  | { kind: 'bullet'; text: string; indent?: number }
  | { kind: 'flow'; label?: string; steps: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] };

function splitPipeRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

function parseFlowLine(raw: string): { label?: string; steps: string[] } | null {
  const arrowCount = (raw.match(/\s*→\s*/g) || []).length;
  if (!raw.includes('⇒ ') && arrowCount < 2) return null;

  let label: string | undefined;
  let body = raw;
  const flowMarkerIdx = raw.indexOf('⇒ ');
  if (flowMarkerIdx >= 0) {
    const prefix = raw.slice(0, flowMarkerIdx).replace(/\*\*/g, '').replace(/:\s*$/, '').trim();
    if (prefix) label = prefix;
    body = raw.slice(flowMarkerIdx + 2).trim();
  } else {
    const colonSplit = raw.match(/^(?:\*\*)?([^:*→]{2,48})(?:\*\*)?:\s*(.+)$/);
    if (colonSplit && (colonSplit[2].match(/\s*→\s*/g) || []).length >= 2) {
      label = colonSplit[1].trim();
      body = colonSplit[2].trim();
    }
  }

  const steps = body
    .split(/\s*→\s*/)
    .map((s) => s.replace(/^\d+\)\s*/, '').trim())
    .filter(Boolean);

  if (steps.length < 2) return null;
  return { label, steps };
}

/**
 * Groups raw section point strings into semantic blocks (tables, process flows, H3 subheadings, prose paragraphs, bullets)
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

    const flow = parseFlowLine(raw.startsWith('¶ ') ? raw.slice(2).trim() : raw);
    if (flow) {
      blocks.push({ kind: 'flow', label: flow.label, steps: flow.steps });
      i++;
      continue;
    }

    if (raw.startsWith('¶ ')) {
      blocks.push({ kind: 'paragraph', text: raw.slice(2).trim() });
      i++;
      continue;
    }

    if (raw.startsWith('↳ ')) {
      blocks.push({ kind: 'bullet', text: raw.slice(2).trim(), indent: 1 });
      i++;
      continue;
    }

    blocks.push({ kind: 'bullet', text: raw });
    i++;
  }

  return blocks;
}

const DATE_PREFIX_REGEX =
  /^(?:\*\*)?((?:c\.\s*)?(?:\d{1,2}\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)?\.?\s*\d{3,4}(?:\s*[–-]\s*\d{2,4})?(?:\s*(?:BC|BCE|AD))?)(?:\*\*)?\s*(?:[:–—-]|\s-\s)\s*(.+)$/i;

const NARRATIVE_DATE_REGEX =
  /\b(?:In|On|By|During|From)\s+((?:\d{1,2}\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?\.?\s+)?\d{3,4}(?:\s*[–-]\s*\d{2,4})?(?:\s*(?:BC|BCE|AD))?)\s*[,:]?\s+(.{12,})/i;

function splitClauseAndSignificance(rawBody: string): {
  title: string;
  detail: string;
  significance?: string;
} {
  const clean = rawBody.replace(/\*\*/g, '').trim();
  const sigSplit = clean.match(
    /^(.+?)\s*(?:;|\.|,)?\s*(?:which\s+(?:meant|led to|caused|triggered|resulted in)|leading to|significance\s*:|impact\s*:|—)\s*(.{8,})$/i
  );
  const main = sigSplit ? sigSplit[1].trim() : clean;
  const significance = sigSplit ? sigSplit[2].trim() : undefined;

  const titleColon = main.match(/^([^:]{3,65}):\s+(.+)$/);
  if (titleColon) {
    return {
      title: titleColon[1].trim(),
      detail: titleColon[2].trim(),
      significance,
    };
  }

  // Extract concise title (first ~7 words or up to comma)
  const commaIdx = main.indexOf(',');
  const shortLead =
    commaIdx >= 8 && commaIdx <= 58
      ? main.slice(0, commaIdx).trim()
      : main.split(/\s+/).slice(0, 7).join(' ').replace(/[.;:]+$/, '');

  return {
    title: shortLead || main.slice(0, 55),
    detail: main,
    significance,
  };
}

/**
 * Entity Extractor: scans structured note sections + raw text for dated historical events,
 * preserving parent section as Era and extracting What Happened vs Significance.
 */
export function extractTimelineEventsFromNote(
  note: StructuredNoteData,
  rawText = ''
): TimelineEventItem[] {
  const events: TimelineEventItem[] = [];
  const seen = new Set<string>();

  const pushCandidate = (
    date: string,
    body: string,
    era?: string,
    wasBolded = false
  ) => {
    const cleanDate = date.replace(/\*\*/g, '').trim();
    const yearMatch = cleanDate.match(/\d{3,4}/);
    if (!yearMatch) return;
    const yearNum = Number(yearMatch[0]);
    if (yearNum > 2100 && !/BC|BCE/i.test(cleanDate)) return;

    const { title, detail, significance } = splitClauseAndSignificance(body);
    if (!title || title.length < 3) return;
    const key = `${cleanDate.toLowerCase()}::${title.toLowerCase().slice(0, 32)}`;
    if (seen.has(key)) return;
    seen.add(key);

    const isKey =
      wasBolded ||
      /\b(?:turning point|landmark|crucial|key event|vital)\b/i.test(`${body} ${significance || ''}`);

    events.push({
      id: makeNoteId('ev'),
      date: cleanDate,
      title,
      detail,
      significance,
      era: era && !/^(?:key points|study notes|core concepts)$/i.test(era) ? era : undefined,
      keyEvent: isKey || undefined,
    });
  };

  const scanLine = (rawLine: string, era?: string) => {
    const line = rawLine.replace(/^(?:↳|¶)\s*/, '').trim();
    if (!line || line.startsWith('### ') || line.startsWith('|')) return;

    const boldInLine = /\*\*/.test(line);

    const prefixMatch = line.match(DATE_PREFIX_REGEX);
    if (prefixMatch && prefixMatch[1].trim().length <= 30) {
      pushCandidate(prefixMatch[1], prefixMatch[2], era, boldInLine);
      return;
    }

    // Check sentences inside longer prose/bullet lines
    const sentences = line.split(/(?<=[.!?])\s+/);
    for (const sentence of sentences) {
      const sPrefix = sentence.match(DATE_PREFIX_REGEX);
      if (sPrefix && sPrefix[1].trim().length <= 30) {
        pushCandidate(sPrefix[1], sPrefix[2], era, /\*\*/.test(sentence));
        continue;
      }
      const narMatch = sentence.match(NARRATIVE_DATE_REGEX);
      if (narMatch && narMatch[1].trim().length <= 30) {
        pushCandidate(narMatch[1], narMatch[2], era, /\*\*/.test(sentence));
      }
    }
  };

  for (const sec of note.sections) {
    const secEra = sec.heading.replace(/^\d+[.)]\s*/, '').trim();
    for (const pt of sec.points) {
      scanLine(pt, secEra);
    }
  }

  if (events.length === 0 && rawText.trim()) {
    for (const line of rawText.split('\n')) {
      scanLine(line);
    }
  }

  return events;
}


