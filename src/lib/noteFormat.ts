import {
  KeyTermPair,
  NoteSectionBlock,
  StructuredNoteData,
  TimelineEventItem,
} from '../types';
import {
  countRightArrows,
  normalizeStudySymbols,
  splitRightArrowSteps,
} from './noteSymbols';
import {
  isNoteImagePoint,
  NoteImageWidth,
  parseNoteImagePoint,
} from './imageUtils';
import { parseLatexDocumentToMarkdown } from './latexRenderer';

export function isMathPoint(point: string): boolean {
  const p = point.trim();
  return /^@math:\{/i.test(p) || (p.startsWith('$$') && p.endsWith('$$') && p.length > 4);
}

export function parseMathPoint(point: string): { latex: string; label?: string } | null {
  const p = point.trim();
  if (/^@math:\{/i.test(p)) {
    try {
      const data = JSON.parse(p.slice(6));
      return { latex: data.latex || '', label: data.label };
    } catch {
      return null;
    }
  }
  if (p.startsWith('$$') && p.endsWith('$$') && p.length > 4) {
    return { latex: p.slice(2, -2).trim() };
  }
  return null;
}

export function encodeMathPoint(latex: string, label?: string): string {
  return `@math:${JSON.stringify({ latex: latex.trim(), ...(label ? { label: label.trim() } : {}) })}`;
}

export function isCodePoint(point: string): boolean {
  return /^@code:\{/i.test(point.trim());
}

export function parseCodePoint(point: string): { code: string; lang?: string } | null {
  const p = point.trim();
  if (/^@code:\{/i.test(p)) {
    try {
      const data = JSON.parse(p.slice(6));
      return { code: data.code || '', lang: data.lang || 'text' };
    } catch {
      return null;
    }
  }
  return null;
}

export function encodeCodePoint(code: string, lang = 'text'): string {
  return `@code:${JSON.stringify({ code, lang })}`;
}

export function isCalloutPoint(point: string): boolean {
  return /^@callout:\{/i.test(point.trim());
}

export function parseCalloutPoint(point: string): {
  type: 'note' | 'tip' | 'warning' | 'important' | 'example' | 'formula' | 'quote';
  title?: string;
  body: string;
} | null {
  const p = point.trim();
  if (/^@callout:\{/i.test(p)) {
    try {
      const data = JSON.parse(p.slice(9));
      return {
        type: data.type || 'note',
        title: data.title,
        body: data.body || data.text || '',
      };
    } catch {
      return null;
    }
  }
  return null;
}

export function encodeCalloutPoint(
  type: 'note' | 'tip' | 'warning' | 'important' | 'example' | 'formula' | 'quote',
  body: string,
  title?: string
): string {
  return `@callout:${JSON.stringify({ type, body, ...(title ? { title } : {}) })}`;
}

export type NoteFormatPreset =
  | 'balanced-visual'
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
  colorCodeParts?: boolean;
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
    ...note.sections.flatMap((s) => [
      s.heading,
      ...s.points.filter(
        (p) =>
          !/^@(?:table-color|code|math|callout|divider):?/i.test(p.trim()) &&
          !isNoteImagePoint(p)
      ),
    ]),
    ...note.keyTerms.flatMap((k) => [k.term, k.definition]),
    note.originalHtml
      ? note.originalHtml.replace(/<img\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ')
      : note.legacyHtml
      ? note.legacyHtml.replace(/<img\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ' ')
      : '',
  ]
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 180));
}

export function isNoteEmpty(note: StructuredNoteData | null | undefined): boolean {
  if (!note || typeof note !== 'object') return true;
  const hasSummary = typeof note.summary === 'string' && note.summary.trim().length > 0;
  const sections = Array.isArray(note.sections) ? note.sections : [];
  const hasSections = sections.some(
    (s) =>
      s &&
      ((Array.isArray(s.points) &&
        s.points.some((p) => typeof p === 'string' && p.trim().length > 0)) ||
        (typeof s.heading === 'string' && s.heading.trim().length > 0 && sections.length > 1))
  );
  const keyTerms = Array.isArray(note.keyTerms) ? note.keyTerms : [];
  const hasTerms = keyTerms.some(
    (k) =>
      k &&
      typeof k.term === 'string' &&
      k.term.trim() &&
      typeof k.definition === 'string' &&
      k.definition.trim()
  );
  const hasTip = typeof note.examTip === 'string' && note.examTip.trim().length > 0;
  const hasEx = typeof note.workedExample === 'string' && note.workedExample.trim().length > 0;
  const docHtml = note.originalHtml || note.legacyHtml;
  const hasLegacy = Boolean(
    typeof docHtml === 'string' &&
      docHtml &&
      (/<img\b/i.test(docHtml) || docHtml.replace(/<[^>]+>/g, '').trim().length > 0)
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

export interface FormattingQualityReport {
  isGood: boolean;
  reason: string;
  headingsCount: number;
  structuredPointsCount: number;
  hasTablesOrFlows: boolean;
}

/**
 * Checks whether pasted/imported notes ALREADY have clean, readable revision structure
 * (clear headings, balanced bullets/sub-bullets, tables/flows/fact boxes, and no massive prose walls
 * or raw webpage chrome). If true, autoformatting should keep the existing structure intact!
 */
export function assessExistingFormattingQuality(rawInput: string): FormattingQualityReport {
  const normalized = normalizeStudySymbols(rawInput, { preserveLeadingFlowMarker: true }).trim();
  if (!normalized) {
    return {
      isGood: false,
      reason: 'Empty text',
      headingsCount: 0,
      structuredPointsCount: 0,
      hasTablesOrFlows: false,
    };
  }

  const lines = normalized
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length < 4) {
    return {
      isGood: false,
      reason: 'Too few lines to evaluate',
      headingsCount: 0,
      structuredPointsCount: 0,
      hasTablesOrFlows: false,
    };
  }

  let headingsCount = 0;
  let subheadingsCount = 0;
  let bulletsCount = 0;
  let tablesOrFlows = 0;
  let noiseCount = 0;
  let denseBlobCount = 0;
  let nonEmptyChars = 0;

  for (const rawLine of lines) {
    const t = rawLine.trim();
    if (isNoteImagePoint(t)) {
      tablesOrFlows++;
      continue;
    }
    nonEmptyChars += t.length;

    if (isBoilerplateNoiseLine(t)) {
      noiseCount++;
      continue;
    }

    if (/^@table-color:/i.test(t)) {
      continue;
    }
    if (/^#{1,2}\s+\S/.test(t)) {
      headingsCount++;
      continue;
    }
    if (/^###\s+\S/.test(t)) {
      subheadingsCount++;
      continue;
    }
    if (/^\|.+\|$/.test(t) || /^⇒\s+/.test(t) || /^📌\s+/.test(t)) {
      tablesOrFlows++;
      continue;
    }
    if (/^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣↳]|[☐☑✓✔✅]|\[[ xX✓✔]?\]|\d+[.)])\s+\S/.test(t)) {
      bulletsCount++;
      continue;
    }
    if (t.length > 360) {
      denseBlobCount++;
    }
  }

  const totalHeadings = headingsCount + subheadingsCount;
  const structuredPointsCount = bulletsCount + tablesOrFlows;
  const avgLineLen = nonEmptyChars / Math.max(1, lines.length);
  const hasGoodDensity = denseBlobCount === 0 && avgLineLen <= 165;
  const cleanRatio = noiseCount / Math.max(1, lines.length) <= 0.12;

  const isShortClean =
    normalized.length < 900 &&
    totalHeadings >= 1 &&
    structuredPointsCount >= 3 &&
    hasGoodDensity &&
    cleanRatio;

  const isMultiSectionClean =
    totalHeadings >= 2 &&
    structuredPointsCount >= 4 &&
    hasGoodDensity &&
    cleanRatio;

  const isGood = isShortClean || isMultiSectionClean;

  return {
    isGood,
    reason: isGood
      ? `Already cleanly formatted (${totalHeadings} headings, ${bulletsCount} bullets${tablesOrFlows ? `, ${tablesOrFlows} tables/visuals` : ''})`
      : denseBlobCount > 0
      ? 'Contains dense prose walls that benefit from structuring'
      : 'Needs headings and structured layout',
    headingsCount: totalHeadings,
    structuredPointsCount,
    hasTablesOrFlows: tablesOrFlows > 0,
  };
}

const ARROW_ONLY_CELL_RE =
  /^(?:[→⇒⟶⟹➜➔➝➞➟➠➡➤➥➦↦⇢⇥⇾►▶▸▹▻▷➣➢]|--->|-->|->|===>|==>|=>)$/;

function tryConvertArrowCellsToFlow(cells: string[]): string | null {
  if (cells.length < 3) return null;
  const arrowCount = cells.filter((c) => ARROW_ONLY_CELL_RE.test(c.trim())).length;
  if (arrowCount === 0) return null;
  const steps = cells.filter((c) => c.trim() && !ARROW_ONLY_CELL_RE.test(c.trim()));
  if (steps.length >= 2 && arrowCount >= Math.max(1, steps.length - 1)) {
    return `⇒ ${steps.map((s) => s.trim()).join(' → ')}`;
  }
  return null;
}

function splitAlignedColumns(line: string): string[] | null {
  if (line.includes('\t')) {
    const tabCols = line.split(/\t+/).map((c) => c.trim()).filter(Boolean);
    if (tabCols.length >= 2 && tabCols.length <= 7) return tabCols;
  }
  if (/\S\s{2,}\S/.test(line)) {
    const spaceCols = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (spaceCols.length >= 2 && spaceCols.length <= 7) return spaceCols;
  }
  return null;
}

/**
 * Normalizes Setext headings, strips web/PDF boilerplate, detects tab & multi-space tables,
 * converts arrow-separator rows into flowchains, preserves blank-line section cues, and splits dense prose walls safely.
 */
function preprocessPlainStudyText(
  rawInput: string,
  opts: AutoFormatOptions
): string {
  const normalized = normalizeStudySymbols(rawInput, { preserveLeadingFlowMarker: true }).trim();
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

    if (!trimmed) {
      if (outLines.length > 0 && outLines[outLines.length - 1] !== '') {
        outLines.push('');
      }
      continue;
    }
    if (isBoilerplateNoiseLine(trimmed)) continue;

    // Preserve indentation before bullet markers so sub-bullets keep hierarchy
    const indentLead = line.match(/^(\s{2,}|\t+)(.*)$/);
    if (indentLead && /^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣–—]|\d+[.)])\s+/.test(indentLead[2])) {
      outLines.push(`  ${indentLead[2].trim()}`);
      continue;
    }

    // Detect tab/multi-space arrow flows (e.g. `Israel attacks \t ► \t Britain & France invade \t ► \t Goal`)
    if (opts.detectFlowDiagrams !== false && !/^(?:[-*•#|]|\d+[.)]\s+)/.test(trimmed)) {
      const aligned = splitAlignedColumns(trimmed);
      if (aligned) {
        const flow = tryConvertArrowCellsToFlow(aligned);
        if (flow) {
          outLines.push(flow);
          continue;
        }
      }
    }

    // Convert tab-separated rows AND multi-space aligned column lines into pipe tables
    if (
      opts.autoTables !== false &&
      !/^(?:[-*•#|⇒]|\d+[.)]\s+)/.test(trimmed)
    ) {
      if (trimmed.includes('\t')) {
        const tabCols = trimmed.split(/\t+/).map((c) => c.trim()).filter(Boolean);
        const prevHasTab = i > 0 && rawLines[i - 1].trim().includes('\t');
        const nextHasTab = i + 1 < rawLines.length && rawLines[i + 1].trim().includes('\t');
        if (
          (tabCols.length >= 3 && tabCols.length <= 6) ||
          (tabCols.length === 2 && (prevHasTab || nextHasTab))
        ) {
          outLines.push(`| ${tabCols.map((c) => c.replace(/\|/g, '/')).join(' | ')} |`);
          continue;
        }
      }
      if (/\S\s{2,}\S/.test(trimmed)) {
        const cols = trimmed.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
        const has3Spaces = /\S\s{3,}\S/.test(trimmed);
        const prevCols = i > 0 ? splitAlignedColumns(rawLines[i - 1].trim()) : null;
        const nextCols = i + 1 < rawLines.length ? splitAlignedColumns(rawLines[i + 1].trim()) : null;
        const matchesNeighborCols =
          (prevCols && prevCols.length === cols.length) ||
          (nextCols && nextCols.length === cols.length);
        if (cols.length >= 2 && cols.length <= 6 && (has3Spaces || matchesNeighborCols)) {
          outLines.push(`| ${cols.map((c) => c.replace(/\|/g, '/')).join(' | ')} |`);
          continue;
        }
      }
    }

    // Split dense prose paragraphs (> 260 chars with 2+ sentences) when splitDenseParagraphs is enabled (never split flow chains)
    if (
      opts.splitDenseParagraphs !== false &&
      trimmed.length > 260 &&
      !trimmed.startsWith('|') &&
      !trimmed.startsWith('#') &&
      !/^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣↳⇒📌¶]|[☐☑✓✔✅]|\d+[.)])\s+/.test(trimmed) &&
      countRightArrows(trimmed) < 2
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
  const normalized = normalizeStudySymbols(line, { preserveLeadingFlowMarker: true }).trim();
  const hasExplicitFlowLead = /^⇒\s+/.test(normalized);
  const clean = normalized.replace(/\*\*/g, '').replace(/^⇒\s*/, '').trim();
  // Explicit arrows (A -> B -> C or A => B => C or A → B → C or A ► B ► C)
  const arrowParts = splitRightArrowSteps(clean);
  const minParts = hasExplicitFlowLead ? 2 : 3;
  if (arrowParts.length >= minParts && arrowParts.every((p) => p.length <= 240)) {
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

const DATE_ROW_RE =
  /^(?:\*\*)?((?:c\.\s*)?(?:\d{1,2}\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)?\.?\s*\d{3,4}(?:\s*[–—-]\s*(?:\d{2,4}|present|today))?(?:\s*(?:BC|BCE|AD))?)(?:\*\*)?\s*(?:[:–—-]|\s-\s)\s*(.{6,})$/i;

function upgradeStructuredRunsToTables(sections: NoteSectionBlock[]): void {
  const pairHeads: Array<[RegExp, RegExp, [string, string]]> = [
    [
      /^(?:advantages|pros|strengths|benefits|arguments\s+for)/i,
      /^(?:disadvantages|cons|weaknesses|limitations|drawbacks|arguments\s+against)/i,
      ['Advantages / Strengths', 'Disadvantages / Limitations'],
    ],
    [/^(?:causes|reasons|factors)/i, /^(?:effects|consequences|impacts|outcomes|results)/i, ['Causes', 'Effects / Consequences']],
    [/^short[- ]term/i, /^long[- ]term/i, ['Short-Term', 'Long-Term']],
    [/^before/i, /^after/i, ['Before', 'After']],
    [/^similarities/i, /^differences/i, ['Similarities', 'Differences']],
  ];

  // 1. Convert paired contrasting ### subheadings inside sections (Pros/Cons, Causes/Effects, etc.)
  for (const sec of sections) {
    const pts = sec.points;
    for (let i = 0; i < pts.length; i++) {
      if (!pts[i].startsWith('### ')) continue;
      const h1 = pts[i].slice(4).trim();

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

      let endBlock2 = pts.length;
      for (let j = nextSubIdx + 1; j < pts.length; j++) {
        if (pts[j].startsWith('### ') || /^\|.+\|$/.test(pts[j])) {
          endBlock2 = j;
          break;
        }
      }

      if (matchedPair) {
        const list1 = pts
          .slice(i + 1, nextSubIdx)
          .map((p) => p.replace(/^↳\s*/, '').replace(/^¶\s*/, '').replace(/\|/g, '/').trim())
          .filter(Boolean);
        const list2 = pts
          .slice(nextSubIdx + 1, endBlock2)
          .map((p) => p.replace(/^↳\s*/, '').replace(/^¶\s*/, '').replace(/\|/g, '/').trim())
          .filter(Boolean);

        if (list1.length >= 2 && list2.length >= 2 && list1.length <= 8 && list2.length <= 8) {
          const rowsCount = Math.max(list1.length, list2.length);
          const tableLines: string[] = [`| ${matchedPair[2][0]} | ${matchedPair[2][1]} |`];
          for (let r = 0; r < rowsCount; r++) {
            tableLines.push(`| ${list1[r] || '—'} | ${list2[r] || '—'} |`);
          }
          pts.splice(i, endBlock2 - i, ...tableLines);
          i += tableLines.length - 1;
          continue;
        }
      }

      // 2. Pivot 2 consecutive ### entity subheadings that share >= 2 **Attribute**: Value keys into comparison table
      const extractKvMap = (slice: string[]) => {
        const map = new Map<string, string>();
        for (const item of slice) {
          const m = item.replace(/^↳\s*/, '').match(/^\*\*(.+?)\*\*:\s*(.+)$/);
          if (m && m[1].length <= 36) {
            map.set(m[1].trim(), m[2].replace(/\|/g, '/').trim());
          }
        }
        return map;
      };
      const slice1 = pts.slice(i + 1, nextSubIdx);
      const slice2 = pts.slice(nextSubIdx + 1, endBlock2);
      if (slice1.length >= 2 && slice2.length >= 2 && slice1.length <= 6 && slice2.length <= 6) {
        const map1 = extractKvMap(slice1);
        const map2 = extractKvMap(slice2);
        const map2Lower = new Map<string, string>();
        map2.forEach((v, k) => map2Lower.set(k.toLowerCase(), v));
        const sharedKeys = Array.from(map1.keys()).filter((k) => map2Lower.has(k.toLowerCase()));
        if (sharedKeys.length >= 2 && sharedKeys.length >= Math.min(slice1.length, slice2.length) - 1) {
          const allKeys = Array.from(new Set([...map1.keys(), ...map2.keys()]));
          const tableLines: string[] = [
            `| Feature | ${h1.replace(/\|/g, '/')} | ${h2.replace(/\|/g, '/')} |`,
          ];
          for (const key of allKeys) {
            const v1 = map1.get(key) || '—';
            const v2 = map2Lower.get(key.toLowerCase()) || '—';
            tableLines.push(`| **${key}** | ${v1} | ${v2} |`);
          }
          pts.splice(i, endBlock2 - i, ...tableLines);
          i += tableLines.length - 1;
        }
      }
    }

    // 3. Convert runs of 3+ consecutive `Date: Event` items into a crisp timeline table
    for (let i = 0; i < pts.length; i++) {
      const runDates: Array<{ date: string; event: string }> = [];
      let j = i;
      while (j < pts.length) {
        const p = pts[j].trim();
        if (!p || p.startsWith('### ') || p.startsWith('|') || p.startsWith('⇒ ') || p.startsWith('📌 ')) {
          break;
        }
        const m = p.replace(/^↳\s*/, '').replace(/^¶\s*/, '').match(DATE_ROW_RE);
        if (!m || m[1].trim().length > 26) break;
        runDates.push({
          date: m[1].replace(/\*\*/g, '').trim(),
          event: m[2].replace(/\|/g, '/').trim(),
        });
        j++;
      }
      if (runDates.length >= 3) {
        const tableLines = [
          '| Date | Event / Key Detail |',
          ...runDates.map((d) => `| ${d.date} | ${d.event} |`),
        ];
        pts.splice(i, j - i, ...tableLines);
        i += tableLines.length - 1;
      }
    }
  }

  // 4. Merge consecutive contrasting top-level sections (e.g. `Advantages` + `Disadvantages`) into a comparison table
  for (let sIdx = 0; sIdx + 1 < sections.length; sIdx++) {
    const a = sections[sIdx];
    const b = sections[sIdx + 1];
    const matchedPair = pairHeads.find(([r1, r2]) => r1.test(a.heading) && r2.test(b.heading));
    if (!matchedPair) continue;
    const hasExistingTable =
      a.points.some((p) => p.startsWith('|')) || b.points.some((p) => p.startsWith('|'));
    if (hasExistingTable) continue;
    if (a.points.length >= 2 && b.points.length >= 2 && a.points.length <= 8 && b.points.length <= 8) {
      const rowsCount = Math.max(a.points.length, b.points.length);
      const tableLines: string[] = [`| ${matchedPair[2][0]} | ${matchedPair[2][1]} |`];
      for (let r = 0; r < rowsCount; r++) {
        const left = (a.points[r] || '—').replace(/^↳\s*/, '').replace(/^¶\s*/, '').replace(/\|/g, '/').trim();
        const right = (b.points[r] || '—').replace(/^↳\s*/, '').replace(/^¶\s*/, '').replace(/\|/g, '/').trim();
        tableLines.push(`| ${left} | ${right} |`);
      }
      sections.splice(sIdx, 2, {
        id: a.id,
        heading: `${matchedPair[2][0]} vs ${matchedPair[2][1]}`,
        points: tableLines,
      });
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
  const preset: NoteFormatPreset = options.preset || 'balanced-visual';
  const allowKeyTerms = options.extractKeyTerms !== false;
  const detectFlows = options.detectFlowDiagrams !== false || preset === 'timeline-causal';
  const buildAutoTables = options.autoTables !== false;
  const strictHeadings = Boolean(options.strictHeadings);
  const existingQuality = assessExistingFormattingQuality(rawInput);

  let normalizedInput = rawInput;
  if (/\\documentclass\b|\\begin\{document\}|\\section\*?\{/.test(normalizedInput)) {
    normalizedInput = parseLatexDocumentToMarkdown(normalizedInput).markdown;
  }

  const preservedBlocks: string[] = [];
  const makeToken = (pt: string) => {
    const idx = preservedBlocks.length;
    preservedBlocks.push(pt);
    return `__SD_BLOCK_POINT_${idx}__`;
  };

  // 1. Fenced code blocks ```lang\n...```
  normalizedInput = normalizedInput.replace(/```([a-zA-Z0-9_-]+)?\r?\n([\s\S]*?)\r?\n```/g, (_m, lang, code) => {
    return `\n${makeToken(encodeCodePoint(code, (lang || 'text').trim()))}\n`;
  });

  // 2. Display math $$...$$
  normalizedInput = normalizedInput.replace(/\$\$([\s\S]*?)\$\$/g, (_m, latex) => {
    return `\n${makeToken(encodeMathPoint(latex.trim()))}\n`;
  });

  // 3. Display math \[...\]
  normalizedInput = normalizedInput.replace(/\\\[([\s\S]*?)\\\]/g, (_m, latex) => {
    return `\n${makeToken(encodeMathPoint(latex.trim()))}\n`;
  });

  // 4. LaTeX display environments
  normalizedInput = normalizedInput.replace(/\\begin\{(equation\*?|align\*?|gather\*?|cases|matrix|pmatrix|bmatrix)\}([\s\S]*?)\\end\{\1\}/g, (_m, env, inner) => {
    return `\n${makeToken(encodeMathPoint(`\\begin{${env}}${inner}\\end{${env}}`))}\n`;
  });

  // 5. Obsidian / GitHub callouts
  normalizedInput = normalizedInput.replace(
    /(?:^|\n)>\s*\[!([a-zA-Z]+)\]\s*([^\n]*)(?:\n(?:>[^\n]*\n?)+)/g,
    (_m, type, title, rawLines) => {
      const body = rawLines
        .split('\n')
        .map((l: string) => l.replace(/^>\s*/, '').trim())
        .filter(Boolean)
        .join(' ');
      const cleanType = (type || 'note').toLowerCase() as any;
      return `\n${makeToken(encodeCalloutPoint(cleanType, body, (title || '').trim() || undefined))}\n`;
    }
  );

  const text = preprocessPlainStudyText(normalizedInput, {
    ...options,
    splitDenseParagraphs: existingQuality.isGood ? false : options.splitDenseParagraphs,
  });
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
    /^(?:causes|effects|consequences|impacts|advantages|disadvantages|pros|cons|strengths|weaknesses|limitations|benefits|drawbacks|key features|evaluation|evidence|methods|factors|solutions|significance|outcomes|short[- ]term|long[- ]term|similarities|differences|arguments\s+for|arguments\s+against)$/i;

  const lines = text.split('\n');
  const getNextNonEmptyLine = (startIdx: number): string => {
    for (let k = startIdx + 1; k < lines.length; k++) {
      const t = lines[k].trim();
      if (t) return t;
    }
    return '';
  };

  let prevWasBlank = true;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const isNestedBullet = /^\s{2,}(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣–—]|\d+[.)])\s+/.test(rawLine);
    let line = rawLine.trim();
    if (!line) {
      prevWasBlank = true;
      continue;
    }
    const precededByBlank = prevWasBlank;
    prevWasBlank = false;

    // Embedded image token (@image:{...} or ![caption](src)): preserve verbatim without text/colon splitting
    if (isNoteImagePoint(line)) {
      currentSec.points.push(line);
      continue;
    }

    // Preserved multi-line code/math/callout block tokens
    const tokenMatch = line.match(/^__SD_BLOCK_POINT_(\d+)__$/);
    if (tokenMatch) {
      const idx = Number(tokenMatch[1]);
      if (preservedBlocks[idx]) {
        currentSec.points.push(preservedBlocks[idx]);
      }
      continue;
    }

    // Horizontal divider
    if (/^(?:---|\*\*\*|___)$/.test(line)) {
      currentSec.points.push('@divider');
      continue;
    }

    // Checklist item: - [ ] text, - [x] text, ☐ text, ✓ text
    const checklistMatch =
      line.match(/^(?:[-*•]\s+)?\[([ xX✓✔])\]\s+(.+)$/i) ||
      line.match(/^([☐☑✓✔✅])\s+(.+)$/);
    if (checklistMatch) {
      const isChecked = /[xX✓✔☑✅]/.test(checklistMatch[1]);
      const itemText = checklistMatch[2].trim();
      currentSec.points.push(
        isNestedBullet
          ? `↳ @check:${isChecked ? 1 : 0}|${itemText}`
          : `@check:${isChecked ? 1 : 0}|${itemText}`
      );
      continue;
    }

    // Ordered list item: 1. text
    const orderedMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedMatch && !/^19\d{2}|20\d{2}/.test(line) && !line.includes('|')) {
      const num = parseInt(orderedMatch[1], 10) || 1;
      const itemText = orderedMatch[2].trim();
      currentSec.points.push(
        isNestedBullet ? `↳ @ol:${num}|${itemText}` : `@ol:${num}|${itemText}`
      );
      continue;
    }

    // Extract Gizmo / revision cloze deletions `{{answer}}` or `==answer==` into flashcards
    if (/\{\{[^}]+\}\}|==[^=]+==/.test(line)) {
      const cleanStatement = line
        .replace(/^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣–—]|\d+[.)])\s+/, '')
        .replace(/\{\{([^}]+)\}\}/g, '**$1**')
        .replace(/==([^=]+)==/g, '**$1**')
        .trim();

      const clozeRegex = /\{\{([^}]+)\}\}|==([^=]+)==/g;
      let match: RegExpExecArray | null;
      while ((match = clozeRegex.exec(line)) !== null) {
        const answer = (match[1] || match[2] || '').trim();
        if (answer) {
          const prompt = line
            .replace(/^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣–—]|\d+[.)])\s+/, '')
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

    // Inline Fact Box detection (`📌 Title | Fact`, `> Fact: ...`, `Key Fact: ...`)
    const factBoxMatch =
      line.match(/^📌\s*(.+)$/) ||
      line.match(/^(?:>\s*)?(?:\*\*)?(key\s*fact|quick\s*fact|did\s*you\s*know|fact\s*box|formula\s*box)(?:\*\*)?\s*[:–—-]\s*(.+)$/i);
    if (factBoxMatch) {
      if (line.startsWith('📌')) {
        currentSec.points.push(`📌 ${factBoxMatch[1].trim()}`);
      } else {
        currentSec.points.push(`📌 ${factBoxMatch[1].trim()} | ${factBoxMatch[2].trim()}`);
      }
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

      // Roman numeral section headings ("I. Causes", "II. Developments") & lettered sub-headings ("A. Economic impact")
      const romanSec = line.match(/^(I{1,3}|IV|VI{0,3}|IX|X)\.\s+(.{3,75})$/);
      if (romanSec && !/[.;]$/.test(line) && line.split(/\s+/).length <= 12) {
        pushCurrentSection();
        currentSec = {
          id: makeNoteId('sec'),
          heading: romanSec[2].replace(/:$/, '').trim(),
          points: [],
        };
        continue;
      }

      const letterSub = line.match(/^[A-Z]\.\s+([A-Z][^.;]{2,65})$/);
      if (letterSub && line.split(/\s+/).length <= 10 && currentSec.points.length > 0) {
        currentSec.points.push(`### ${letterSub[1].replace(/:$/, '').trim()}`);
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

      // Standalone short unpunctuated title or topic question preceded by a blank line or at top of raw text
      const nextLine = getNextNonEmptyLine(i);
      const wordCount = line.split(/\s+/).filter(Boolean).length;
      const looksLikePlainHeading =
        precededByBlank &&
        Boolean(nextLine) &&
        line.length >= 3 &&
        line.length <= 74 &&
        wordCount <= 10 &&
        /^[A-Z0-9"'(]/.test(line) &&
        !/^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣↳⇒📌¶|]|[☐☑✓✔✅]|<|\d+[.)]\s)/.test(line) &&
        !/[.;,!]$/.test(line) &&
        (!line.includes(':') || /^[^:]{2,40}:\s+\S.{0,35}$/.test(line)) &&
        !DATE_ROW_RE.test(line) &&
        countRightArrows(line) < 2 &&
        !/\b(?:was|were|are|is|had|have|became|caused|led to|resulting)\b/i.test(
          line.endsWith('?') ? '' : line
        );

      if (looksLikePlainHeading) {
        const cleanHead = line.replace(/\*\*/g, '').replace(/:$/, '').trim();
        if (SUBHEADING_CUES.test(cleanHead) || (line.endsWith('?') && currentSec.points.length > 0)) {
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
    }

    const isExplicitBullet =
      /^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣–—]|\[[ xX✓✔]?\]|[☐☑✓✔✅]|\d+[.)])\s+/.test(line);
    const cleanBullet = line
      .replace(/^(?:[-*•▪▫◦‣●○■□◆◇❖⁃∙▸▹►▻➢➣–—]|\d+[.)])\s+/, '')
      .replace(/^\[[ ]\]\s+/, '☐ ')
      .replace(/^\[[xX✓✔]\]\s+/, '✓ ')
      .trim();
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
      : cleanBullet.includes('|') && !cleanBullet.includes('$') && !cleanBullet.includes('`')
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

    // Term: Definition (when term is crisp & descriptive and not a date prefix or math expression)
    const colonDef = cleanBullet.match(/^([A-Za-z0-9 ()/%'’&-]{2,52}):\s+(.{6,})$/);
    if (
      colonDef &&
      !/^http/i.test(colonDef[1]) &&
      !colonDef[1].includes('$') &&
      !colonDef[1].includes('\\') &&
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
    let boldedProsePoint: string | null = null;
    const proseDef = cleanBullet.match(
      /^(?:\*\*)?([A-Za-z][A-Za-z0-9 ()/'’&-]{1,50}?)(?:\*\*)?\s+(is defined as|refers to|is the process (?:by|in) which|means|describes)\s+(.{12,})$/i
    );
    if (proseDef) {
      const term = proseDef[1].replace(/\*\*/g, '').trim();
      const verb = proseDef[2];
      const def = proseDef[3].trim();
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
        if (!/\*\*/.test(cleanBullet) && !/<(?:strong|b|mark|span)\b/i.test(cleanBullet)) {
          boldedProsePoint = `**${term}** ${verb} ${def}`;
        }
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
    const basePoint = boldedProsePoint || cleanBullet;
    const formattedPoint =
      preset === 'timeline-causal'
        ? basePoint.replace(
            /\b((?:\d{1,2}\s+)?(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)?\s*(?:1\d{3}|20\d{2})(?:\s*[–-]\s*\d{2,4})?)\b/g,
            (m) => (basePoint.includes(`**${m}`) ? m : `**${m.trim()}**`)
          )
        : basePoint;

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
    } else if (preset === 'balanced-visual') {
      currentSec.points.push(
        formattedPoint.length >= 90 ? `¶ ${formattedPoint}` : formattedPoint
      );
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
    upgradeStructuredRunsToTables(cleanedSections);
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
  return normalizeStudySymbols(
    parts
      .join('')
      .replace(/\s+/g, ' ')
      .replace(/\*\*([^*]+?):\*\*/g, '**$1**:')
      .trim(),
    { preserveLeadingFlowMarker: true }
  );
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
      if (clean.includes('⇒ ') || countRightArrows(clean) >= 2) {
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
        const extractedRows = rows
          .map((tr) =>
            Array.from(tr.children).map((cell) =>
              extractInlineFormattedText(cell).replace(/\|/g, '/').trim()
            )
          )
          .filter((cells) => cells.some(Boolean));
        const arrowCellRe = /^(?:[→⇒⟶⟹➜➔➝➞➟➠➡➤►▶▸▹▻▷]|->|-->|=>|==>)$/;
        const isSingleArrowFlowTable =
          extractedRows.length === 1 &&
          extractedRows[0].length >= 3 &&
          extractedRows[0].some((c) => arrowCellRe.test(c));
        if (isSingleArrowFlowTable) {
          const steps = extractedRows[0].filter((c) => c && !arrowCellRe.test(c));
          if (steps.length >= 2) {
            current.points.push(`⇒ ${steps.join(' → ')}`);
          }
        } else {
          for (const cells of extractedRows) {
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
    const visiblePoints = sec.points.filter((p) => !/^@table-color:/i.test(p.trim()));
    if (visiblePoints.length > 0) {
      const listBuf: string[] = [];
      const flushList = () => {
        if (listBuf.length > 0) {
          parts.push(`<ul>${listBuf.join('')}</ul>`);
          listBuf.length = 0;
        }
      };
      for (const p of visiblePoints) {
        const img = parseNoteImagePoint(p);
        if (img) {
          flushList();
          const cap = img.caption
            ? `<figcaption class="sd-note-figcaption">${esc(img.caption)}</figcaption>`
            : '';
          parts.push(
            `<figure class="sd-note-figure"><img src="${img.src.replace(/"/g, '&quot;')}" alt="${esc(
              img.caption || 'Study note image'
            )}" class="sd-note-img" />${cap}</figure>`
          );
          continue;
        }
        const mathPt = parseMathPoint(p);
        if (mathPt) {
          flushList();
          parts.push(`<div class="sd-math-block">$$${esc(mathPt.latex)}$$</div>`);
          continue;
        }
        const codePt = parseCodePoint(p);
        if (codePt) {
          flushList();
          parts.push(`<pre><code class="language-${esc(codePt.lang || 'text')}">${esc(codePt.code)}</code></pre>`);
          continue;
        }
        const calloutPt = parseCalloutPoint(p);
        if (calloutPt) {
          flushList();
          parts.push(`<div class="sd-callout-card sd-callout-${esc(calloutPt.type)}"><strong>${esc(calloutPt.title || calloutPt.type)}:</strong> ${fmt(calloutPt.body)}</div>`);
          continue;
        }
        if (p === '@divider') {
          flushList();
          parts.push('<hr />');
          continue;
        }
        listBuf.push(
          p.startsWith('📌 ')
            ? `<li><strong>Fact:</strong> ${fmt(
                p
                  .slice(2)
                  .replace(/^\s*\[color:[^\]]+\]\s*/i, '')
                  .replace('|', ' — ')
                  .trim()
              )}</li>`
            : `<li>${fmt(p.replace(/^↳\s*/, '').replace(/^¶\s*/, ''))}</li>`
        );
      }
      flushList();
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
  | { kind: 'factbox'; title?: string; text: string; color?: string }
  | { kind: 'flow'; label?: string; steps: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][]; color?: string }
  | { kind: 'image'; src: string; caption?: string; width?: NoteImageWidth }
  | { kind: 'math'; latex: string; label?: string }
  | { kind: 'code'; code: string; lang?: string }
  | {
      kind: 'callout';
      type: 'note' | 'tip' | 'warning' | 'important' | 'example' | 'formula' | 'quote';
      title?: string;
      text: string;
    }
  | { kind: 'ordered'; items: Array<{ num: number; text: string }> }
  | { kind: 'checklist'; items: Array<{ checked: boolean; text: string; rawPointIndex?: number }> }
  | { kind: 'divider' };

function splitPipeRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let current = '';
  let inMath = false;
  let inCode = false;
  for (let idx = 0; idx < trimmed.length; idx++) {
    const ch = trimmed[idx];
    if (ch === '`') inCode = !inCode;
    else if (ch === '$' && !inCode) inMath = !inMath;

    if (ch === '|' && !inMath && !inCode) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseFlowLine(raw: string): { label?: string; steps: string[] } | null {
  const normalized = normalizeStudySymbols(raw, { preserveLeadingFlowMarker: true });
  const arrowCount = (normalized.match(/\s*→\s*/g) || []).length;
  if (!normalized.includes('⇒ ') && arrowCount < 2) return null;

  let label: string | undefined;
  let body = normalized;
  const flowMarkerIdx = normalized.indexOf('⇒ ');
  if (flowMarkerIdx >= 0) {
    const prefix = normalized
      .slice(0, flowMarkerIdx)
      .replace(/\*\*/g, '')
      .replace(/:\s*$/, '')
      .trim();
    if (prefix) label = prefix;
    body = normalized.slice(flowMarkerIdx + 2).trim();
  } else {
    const colonSplit = normalized.match(/^(?:\*\*)?([^:*→]{2,48})(?:\*\*)?:\s*(.+)$/);
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
 * for clean visual rendering.
 */
export function groupSectionPoints(points: string[]): SectionRenderBlock[] {
  const blocks: SectionRenderBlock[] = [];
  let i = 0;
  let pendingTableColor: string | undefined;

  while (i < points.length) {
    const raw = (points[i] || '').trim();
    if (!raw) {
      i++;
      continue;
    }

    const mathPt = parseMathPoint(raw);
    if (mathPt) {
      pendingTableColor = undefined;
      blocks.push({ kind: 'math', latex: mathPt.latex, label: mathPt.label });
      i++;
      continue;
    }

    const codePt = parseCodePoint(raw);
    if (codePt) {
      pendingTableColor = undefined;
      blocks.push({ kind: 'code', code: codePt.code, lang: codePt.lang });
      i++;
      continue;
    }

    const calloutPt = parseCalloutPoint(raw);
    if (calloutPt) {
      pendingTableColor = undefined;
      blocks.push({
        kind: 'callout',
        type: calloutPt.type,
        title: calloutPt.title,
        text: calloutPt.body,
      });
      i++;
      continue;
    }

    if (raw === '@divider' || /^---{1,}$/.test(raw) || /^\*{3,}$/.test(raw)) {
      pendingTableColor = undefined;
      blocks.push({ kind: 'divider' });
      i++;
      continue;
    }

    if (raw.startsWith('@ol:') || /^\d+[.)]\s+/.test(raw)) {
      pendingTableColor = undefined;
      const items: Array<{ num: number; text: string }> = [];
      while (
        i < points.length &&
        ((points[i] || '').trim().startsWith('@ol:') || /^\d+[.)]\s+/.test((points[i] || '').trim()))
      ) {
        const pt = (points[i] || '').trim();
        const olMatch = pt.match(/^@ol:(\d+)\|(.*)$/);
        if (olMatch) {
          items.push({ num: parseInt(olMatch[1], 10) || 1, text: olMatch[2] });
        } else {
          const numMatch = pt.match(/^(\d+)[.)]\s+(.*)$/);
          if (numMatch) {
            items.push({ num: parseInt(numMatch[1], 10) || 1, text: numMatch[2] });
          }
        }
        i++;
      }
      if (items.length > 0) {
        blocks.push({ kind: 'ordered', items });
        continue;
      }
    }

    const isChecklistPt = (pt: string) =>
      pt.startsWith('@check:') || /^(?:☐|☑|✓|✔|✅|\[[ xX✓✔]\])\s+/.test(pt);
    if (isChecklistPt(raw)) {
      pendingTableColor = undefined;
      const items: Array<{ checked: boolean; text: string; rawPointIndex?: number }> = [];
      while (i < points.length && isChecklistPt((points[i] || '').trim())) {
        const pt = (points[i] || '').trim();
        let checked = false;
        let itemText = '';
        if (pt.startsWith('@check:')) {
          checked = pt.startsWith('@check:1|');
          itemText = pt.replace(/^@check:[01]\|/, '');
        } else {
          checked = /^(?:☑|✓|✔|✅|\[[xX✓✔]\])\s+/.test(pt);
          itemText = pt.replace(/^(?:☐|☑|✓|✔|✅|\[[ xX✓✔]\])\s+/, '');
        }
        items.push({ checked, text: itemText, rawPointIndex: i });
        i++;
      }
      if (items.length > 0) {
        blocks.push({ kind: 'checklist', items });
        continue;
      }
    }

    const tableColorMatch = raw.match(/^@table-color:\s*([#A-Za-z0-9_-]+)$/i);
    if (tableColorMatch) {
      pendingTableColor = tableColorMatch[1].trim();
      i++;
      continue;
    }

    const parsedImage = parseNoteImagePoint(raw);
    if (parsedImage) {
      pendingTableColor = undefined;
      blocks.push({
        kind: 'image',
        src: parsedImage.src,
        caption: parsedImage.caption,
        width: parsedImage.width || 'wide',
      });
      i++;
      continue;
    }

    if (/^\|.+\|$/.test(raw)) {
      const tableColor = pendingTableColor;
      pendingTableColor = undefined;
      const tableRows: string[][] = [];
      while (i < points.length && /^\|.+\|$/.test((points[i] || '').trim())) {
        const line = points[i].trim();
        if (!/^\|\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|$/.test(line)) {
          tableRows.push(splitPipeRow(line));
        }
        i++;
      }
      if (tableRows.length > 0) {
        // If a single-row table has alternating arrow cells (`[Step 1, '►', Step 2, '►', Step 3]`), render as a flow diagram
        if (tableRows.length === 1) {
          const flowConverted = tryConvertArrowCellsToFlow(tableRows[0]);
          if (flowConverted) {
            const parsedFlow = parseFlowLine(flowConverted);
            if (parsedFlow) {
              blocks.push({ kind: 'flow', label: parsedFlow.label, steps: parsedFlow.steps });
              continue;
            }
          }
        }

        const maxCols = tableRows.reduce((m, r) => Math.max(m, r.length), 1);
        const padRow = (r: string[]) =>
          Array.from({ length: maxCols }, (_, idx) => r[idx] || '');

        const row0 = padRow(tableRows[0]);
        const row1 = tableRows.length >= 2 ? padRow(tableRows[1]) : null;
        const looksLikeDateCell = (s: string) =>
          /^(?:c\.\s*)?(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*\d{3,4}(?:\s*[–—-]\s*(?:\d{2,4}|present|today))?(?:\s*(?:BC|BCE|AD))?$/i.test(
            s.replace(/\*\*/g, '').trim()
          );
        const row0Col0IsDate = looksLikeDateCell(row0[0]);
        const row1Col0IsDate = Boolean(row1 && looksLikeDateCell(row1[0]));
        const row0LooksLikeLongData =
          Boolean(row1) &&
          row0.some((c) => c.length > 48 && /[.;]/.test(c)) &&
          !/^(?:date|year|period|term|concept|topic|feature|item|factor|cause|effect|stage|step|advantage|disadvantage)/i.test(
            row0[0].replace(/\*\*/g, '').trim()
          );

        if (row0Col0IsDate && row1Col0IsDate) {
          const inferredHeaders =
            maxCols === 2
              ? ['Date', 'Event / Key Detail']
              : maxCols === 3
              ? ['Date', 'Event', 'Significance / Details']
              : Array.from({ length: maxCols }, (_, idx) =>
                  idx === 0 ? 'Date' : `Detail ${idx}`
                );
          blocks.push({
            kind: 'table',
            headers: inferredHeaders,
            rows: tableRows.map(padRow),
            ...(tableColor && tableColor !== 'default' ? { color: tableColor } : {}),
          });
        } else if (row0LooksLikeLongData && row1) {
          const inferredHeaders = Array.from({ length: maxCols }, (_, idx) =>
            idx === 0 ? 'Item' : maxCols === 2 ? 'Details' : `Column ${idx + 1}`
          );
          blocks.push({
            kind: 'table',
            headers: inferredHeaders,
            rows: tableRows.map(padRow),
            ...(tableColor && tableColor !== 'default' ? { color: tableColor } : {}),
          });
        } else {
          const headers = row0;
          const rows = tableRows.slice(1).map(padRow);
          blocks.push({
            kind: 'table',
            headers,
            rows,
            ...(tableColor && tableColor !== 'default' ? { color: tableColor } : {}),
          });
        }
      }
      continue;
    }

    pendingTableColor = undefined;

    if (raw.startsWith('📌 ') || /^>\s*fact\s*:/i.test(raw)) {
      let cleaned = raw.startsWith('📌 ')
        ? raw.slice(2).trim()
        : raw.replace(/^>\s*fact\s*:\s*/i, '').trim();
      let boxColor: string | undefined;
      const colorPrefix = cleaned.match(/^\[color:\s*([#A-Za-z0-9_-]+)\]\s*(.*)$/i);
      if (colorPrefix) {
        boxColor = colorPrefix[1].trim();
        cleaned = colorPrefix[2].trim();
      }
      const pipeIdx = cleaned.indexOf('|');
      if (pipeIdx > 0 && pipeIdx < 42) {
        blocks.push({
          kind: 'factbox',
          title: cleaned.slice(0, pipeIdx).replace(/\*\*/g, '').trim() || 'Key Fact',
          text: cleaned.slice(pipeIdx + 1).trim(),
          ...(boxColor && boxColor !== 'default' ? { color: boxColor } : {}),
        });
      } else {
        blocks.push({
          kind: 'factbox',
          title: 'Key Fact',
          text: cleaned,
          ...(boxColor && boxColor !== 'default' ? { color: boxColor } : {}),
        });
      }
      i++;
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
    if (!line || line.startsWith('### ') || line.startsWith('@table-color:') || isNoteImagePoint(line)) return;

    if (line.startsWith('|')) {
      if (/^\|\s*[-:]+(?:\s*\|\s*[-:]+)+\s*\|$/.test(line)) return;
      const cells = splitPipeRow(line);
      if (cells.length >= 2) {
        const dateCell = cells[0].replace(/\*\*/g, '').trim();
        const rest = cells.slice(1).filter(Boolean).join(' — ');
        if (
          rest &&
          /^(?:c\.\s*)?(?:\d{1,2}\s+)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*\d{3,4}(?:\s*[–—-]\s*\d{2,4})?(?:\s*(?:BC|BCE|AD))?$/i.test(
            dateCell
          )
        ) {
          pushCandidate(dateCell, rest, era, /\*\*/.test(line));
        }
      }
      return;
    }

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


