import { fastLocalQuizCheck, normalizeForFastCheck } from './quizGrader';

export type QuizGameMode = 'classic' | 'monster-brawl';
export type QuizQuestionFormat = 'typed' | 'mcq';

export interface ParsedQuizCardInput {
  question: string;
  answer: string;
  section: string;
  options?: string[];
}

export interface QuizParseResult {
  cards: ParsedQuizCardInput[];
  formatDetected: 'mcq-text' | 'mcq-csv' | 'csv' | 'empty';
  mcqCount: number;
}

export const SAMPLE_MCQ_TEXT = `Section: Cell Biology
Q: Which organelle is the main site of ATP synthesis via aerobic respiration?
A) Golgi apparatus
B) Mitochondrion *
C) Lysosome
D) Smooth endoplasmic reticulum

Q: What type of transport moves water molecules across a partially permeable membrane from high to low water potential?
A) Active transport
B) Exocytosis
C) Osmosis
D) Phagocytosis
Answer: C

Section: Weimar Germany
Q: Which currency replaced the worthless mark in November 1923?
A) Reichsmark
B) Rentenmark [correct]
C) Goldmark
D) Euro

Q: In which year did Kaiser Wilhelm II abdicate?
A) 1914
B) 1917
C) 1918 *
D) 1923`;

export const SAMPLE_MCQ_CSV = `Question,A,B,C,D,Correct,Section
"Which gas makes up roughly 78% of Earth's atmosphere?","Oxygen","Nitrogen","Carbon Dioxide","Argon","B","Chemistry"
"What is the SI unit of electrical resistance?","Volt","Ampere","Ohm","Watt","C","Physics"
"Which article allowed the Weimar President to rule by decree?","Article 21","Article 48","Article 79","Article 231","B","History"
"What is the powerhouse organelle of eukaryotic cells?","Ribosome","Mitochondrion","Nucleolus","Vacuole","B","Biology"`;

/**
 * RFC-4180 CSV parser handling quotes, escaped quotes (""), and multi-line fields.
 */
export function parseRawCsvRows(rawText: string): string[][] {
  const input = String(rawText || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

function dedupeOptions(rawOptions: string[], officialAnswer?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const pushUnique = (opt: string) => {
    const clean = String(opt || '').trim();
    if (!clean) return;
    const key = normalizeForFastCheck(clean) || clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  for (const opt of rawOptions) {
    pushUnique(opt);
  }
  if (officialAnswer) {
    pushUnique(officialAnswer);
  }
  return out;
}

function stripCorrectMarker(text: string): { cleanText: string; markedCorrect: boolean } {
  let clean = text.trim();
  let marked = false;

  const patterns = [
    /^\*\s*/,
    /\s*\*$/,
    /^\[x\]\s*/i,
    /^✓\s*/,
    /\s*✓$/,
    /\s*\[(correct|ans|answer)\]\s*$/i,
    /\s*\((correct|ans|answer)\)\s*$/i,
  ];
  for (const re of patterns) {
    if (re.test(clean)) {
      marked = true;
      clean = clean.replace(re, '').trim();
    }
  }
  return { cleanText: clean, markedCorrect: marked };
}

function parseMcqTextBlocks(rawText: string): ParsedQuizCardInput[] {
  const lines = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');

  let currentSection = 'General';
  let currentQuestion = '';
  let currentOptions: Array<{ label: string; text: string; marked: boolean }> = [];
  let explicitAnswer = '';
  let blockSection = '';
  const cards: ParsedQuizCardInput[] = [];

  const flushBlock = () => {
    const q = currentQuestion.trim();
    if (!q) {
      currentQuestion = '';
      currentOptions = [];
      explicitAnswer = '';
      blockSection = '';
      return;
    }

    const sec = (blockSection || currentSection || 'General').trim() || 'General';
    let resolvedAnswer = '';

    if (currentOptions.length >= 2) {
      const markedOpt = currentOptions.find((o) => o.marked);
      if (markedOpt) {
        resolvedAnswer = markedOpt.text;
      } else if (explicitAnswer) {
        const cleanAns = explicitAnswer.trim();
        const letterMatch = cleanAns.match(/^([A-F])(?:[.):\s]|$)/i);
        if (letterMatch && cleanAns.length <= 3) {
          const idx = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
          resolvedAnswer = currentOptions[idx]?.text || '';
        }
        if (!resolvedAnswer) {
          const numMatch = cleanAns.match(/^([1-6])$/);
          if (numMatch) {
            resolvedAnswer = currentOptions[Number(numMatch[1]) - 1]?.text || '';
          }
        }
        if (!resolvedAnswer) {
          const byExact = currentOptions.find(
            (o) =>
              o.label.toUpperCase() === cleanAns.toUpperCase() ||
              fastLocalQuizCheck(cleanAns, o.text)
          );
          resolvedAnswer = byExact ? byExact.text : cleanAns;
        }
      }

      const uniqueOpts = dedupeOptions(
        currentOptions.map((o) => o.text),
        resolvedAnswer || currentOptions[0].text
      );
      cards.push({
        question: q,
        answer: resolvedAnswer || uniqueOpts[0],
        section: sec,
        options: uniqueOpts,
      });
    } else if (explicitAnswer) {
      cards.push({
        question: q,
        answer: explicitAnswer.trim(),
        section: sec,
      });
    }

    currentQuestion = '';
    currentOptions = [];
    explicitAnswer = '';
    blockSection = '';
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      if (currentQuestion && (currentOptions.length > 0 || explicitAnswer)) {
        flushBlock();
      }
      continue;
    }

    // Section directive: "Section: ...", "Topic: ...", "## Section"
    const secMatch = line.match(/^(?:section|topic|deck|category)\s*:\s*(.+)$/i);
    if (secMatch) {
      const secVal = secMatch[1].trim();
      if (currentQuestion && currentOptions.length === 0 && !explicitAnswer) {
        blockSection = secVal;
      } else if (currentQuestion && (currentOptions.length > 0 || explicitAnswer)) {
        blockSection = secVal;
      } else {
        currentSection = secVal || 'General';
      }
      continue;
    }
    const mdHeading = line.match(/^#{1,4}\s+(.+)$/);
    if (mdHeading && !currentQuestion) {
      currentSection = mdHeading[1].trim() || 'General';
      continue;
    }

    // Answer line: "Answer: B", "Ans: Mitochondrion", "Correct: C"
    const ansMatch = line.match(/^(?:answer|ans|correct(?:\s+answer)?|a)\s*[:=-]\s*(.+)$/i);
    if (ansMatch && currentQuestion) {
      explicitAnswer = ansMatch[1].trim();
      continue;
    }

    // Option line: "A) foo", "A. bar", "(B) baz", "- [x] qux", "* C) foo"
    const optMatch = line.match(
      /^(?:(\*|✓|\[x\]|\[ \])\s*)?(?:\(([A-F])\)|([A-F])[.):])\s+(.+)$/i
    );
    if (optMatch && currentQuestion) {
      const prefixMarked = Boolean(optMatch[1] && optMatch[1] !== '[ ]');
      const label = (optMatch[2] || optMatch[3] || '').toUpperCase();
      const { cleanText, markedCorrect } = stripCorrectMarker(optMatch[4]);
      if (cleanText) {
        currentOptions.push({
          label,
          text: cleanText,
          marked: prefixMarked || markedCorrect,
        });
      }
      continue;
    }

    // Explicit bullet checkbox option "- [x] Text" or "- [ ] Text"
    const checkOptMatch = line.match(/^[-*]\s*\[(x| )\]\s+(.+)$/i);
    if (checkOptMatch && currentQuestion) {
      const { cleanText, markedCorrect } = stripCorrectMarker(checkOptMatch[2]);
      if (cleanText) {
        const label = String.fromCharCode(65 + currentOptions.length);
        currentOptions.push({
          label,
          text: cleanText,
          marked: checkOptMatch[1].toLowerCase() === 'x' || markedCorrect,
        });
      }
      continue;
    }

    // Question starter: "Q:", "Q1:", "1.", "1)"
    const qPrefixMatch = line.match(/^(?:q(?:uestion)?\s*\d*\s*[:.)-]|\d{1,3}[.)])\s+(.+)$/i);
    if (qPrefixMatch) {
      if (currentQuestion && (currentOptions.length > 0 || explicitAnswer)) {
        flushBlock();
      } else if (currentQuestion) {
        flushBlock();
      }
      currentQuestion = qPrefixMatch[1].trim();
      continue;
    }

    // Plain line starting a new question if previous block already had options/answer
    if (currentQuestion && (currentOptions.length > 0 || explicitAnswer)) {
      flushBlock();
      currentQuestion = line;
    } else if (!currentQuestion) {
      currentQuestion = line;
    } else if (currentOptions.length === 0) {
      currentQuestion = `${currentQuestion} ${line}`.trim();
    }
  }

  flushBlock();
  return cards;
}

function parseMcqOrStandardCsv(rawText: string): {
  cards: ParsedQuizCardInput[];
  isMcqCsv: boolean;
} {
  const rows = parseRawCsvRows(rawText);
  if (!rows.length) return { cards: [], isMcqCsv: false };

  const header = rows[0].map((c) => c.trim().toLowerCase());
  const isHeaderRow =
    /^(q|question|prompt)$/.test(header[0] || '') ||
    header.some((h) => /^(a|answer|option\s*a|correct|choices|options)$/.test(h));

  const dataRows = isHeaderRow ? rows.slice(1) : rows;
  if (!dataRows.length) return { cards: [], isMcqCsv: false };

  // Pattern 1: Header has Question, A, B, C, D, Correct, [Section]
  const colIdx = {
    q: header.findIndex((h) => /^(q|question|prompt)$/.test(h)),
    optA: header.findIndex((h) => /^(a|opt\s*a|option\s*a|option1|choice\s*a)$/.test(h)),
    optB: header.findIndex((h) => /^(b|opt\s*b|option\s*b|option2|choice\s*b)$/.test(h)),
    optC: header.findIndex((h) => /^(c|opt\s*c|option\s*c|option3|choice\s*c)$/.test(h)),
    optD: header.findIndex((h) => /^(d|opt\s*d|option\s*d|option4|choice\s*d)$/.test(h)),
    correct: header.findIndex((h) => /^(correct|correct\s*answer|ans|key)$/.test(h)),
    answer: header.findIndex((h) => /^(a|answer|response|correct\s*answer)$/.test(h)),
    options: header.findIndex((h) => /^(options|choices)$/.test(h)),
    section: header.findIndex((h) => /^(section|topic|category|subject)$/.test(h)),
  };

  if (isHeaderRow && colIdx.optA >= 0 && colIdx.optB >= 0) {
    const qCol = colIdx.q >= 0 ? colIdx.q : 0;
    const cards: ParsedQuizCardInput[] = [];
    for (const r of dataRows) {
      const question = (r[qCol] || '').trim();
      const opts = [r[colIdx.optA], r[colIdx.optB], r[colIdx.optC], r[colIdx.optD]]
        .map((x) => String(x || '').trim())
        .filter(Boolean);
      const sec = colIdx.section >= 0 ? (r[colIdx.section] || '').trim() || 'General' : 'General';
      const corrRaw =
        (colIdx.correct >= 0 ? r[colIdx.correct] : r[colIdx.optD + 1])?.trim() || '';
      if (!question || opts.length < 2) continue;

      let resolvedAns = '';
      const letterM = corrRaw.match(/^([A-D])$/i);
      if (letterM) {
        resolvedAns = opts[letterM[1].toUpperCase().charCodeAt(0) - 65] || '';
      } else if (/^[1-4]$/.test(corrRaw)) {
        resolvedAns = opts[Number(corrRaw) - 1] || '';
      } else if (corrRaw) {
        resolvedAns = opts.find((o) => fastLocalQuizCheck(corrRaw, o)) || corrRaw;
      }
      if (!resolvedAns) resolvedAns = opts[0];

      cards.push({
        question,
        answer: resolvedAns,
        section: sec,
        options: dedupeOptions(opts, resolvedAns),
      });
    }
    return { cards, isMcqCsv: cards.length > 0 };
  }

  // Pattern 2: Header or rows with pipe-separated Options column (Question, Answer, Options, Section)
  if (isHeaderRow && colIdx.options >= 0) {
    const qCol = colIdx.q >= 0 ? colIdx.q : 0;
    const aCol = colIdx.answer >= 0 ? colIdx.answer : 1;
    const cards: ParsedQuizCardInput[] = [];
    for (const r of dataRows) {
      const question = (r[qCol] || '').trim();
      const answer = (r[aCol] || '').trim();
      const rawOpts = (r[colIdx.options] || '')
        .split(/\s*[|;]\s*/)
        .map((s) => s.trim())
        .filter(Boolean);
      const sec = colIdx.section >= 0 ? (r[colIdx.section] || '').trim() || 'General' : 'General';
      if (!question || !answer) continue;
      cards.push({
        question,
        answer,
        section: sec,
        options: rawOpts.length >= 2 ? dedupeOptions(rawOpts, answer) : undefined,
      });
    }
    return { cards, isMcqCsv: cards.some((c) => (c.options?.length || 0) >= 2) };
  }

  // Pattern 3: 6 or 7 column MCQ CSV without matching A/B/C/D header names:
  // Either Question, A, B, C, D, Correct [, Section] (when col 5 is A-D or 1-4)
  // OR Question, CorrectAnswer, Distractor1, Distractor2, Distractor3 [, Section]
  const looksLikeSixCol = dataRows.some((r) => r.length >= 5);
  if (looksLikeSixCol && (!isHeaderRow || header.length >= 5)) {
    const cards: ParsedQuizCardInput[] = [];
    for (const r of dataRows) {
      const question = (r[0] || '').trim();
      if (!question) continue;
      const c1 = (r[1] || '').trim();
      const c2 = (r[2] || '').trim();
      const c3 = (r[3] || '').trim();
      const c4 = (r[4] || '').trim();
      const c5 = (r[5] || '').trim();
      const c6 = (r[6] || '').trim();

      // Check if c5 is an A-D / 1-4 answer key for choices c1..c4
      if (r.length >= 6 && /^[A-D1-4]$/i.test(c5) && c1 && c2) {
        const opts = [c1, c2, c3, c4].filter(Boolean);
        const idx = /^[A-D]$/i.test(c5) ? c5.toUpperCase().charCodeAt(0) - 65 : Number(c5) - 1;
        const ans = opts[idx] || opts[0];
        cards.push({
          question,
          answer: ans,
          section: c6 || 'General',
          options: dedupeOptions(opts, ans),
        });
        continue;
      }

      // Check if col 2 has pipe-separated choices
      if (c2.includes('|') && c1) {
        const opts = c2
          .split('|')
          .map((s) => s.trim())
          .filter(Boolean);
        cards.push({
          question,
          answer: c1,
          section: c3 || 'General',
          options: dedupeOptions(opts, c1),
        });
        continue;
      }

      // Question, CorrectAnswer, Distractor1, Distractor2, Distractor3 [, Section]
      if (r.length >= 5 && c1 && c2 && c3) {
        const opts = [c1, c2, c3, c4].filter(Boolean);
        cards.push({
          question,
          answer: c1,
          section: c5 || 'General',
          options: dedupeOptions(opts, c1),
        });
        continue;
      }

      if (c1) {
        cards.push({
          question,
          answer: c1,
          section: c2 || 'General',
        });
      }
    }
    const mcqCount = cards.filter((c) => (c.options?.length || 0) >= 2).length;
    if (cards.length > 0) {
      return { cards, isMcqCsv: mcqCount > 0 };
    }
  }

  // Standard 2 or 3 column CSV: Question, Answer, Section
  const standardCards: ParsedQuizCardInput[] = dataRows
    .map((r) => ({
      question: (r[0] || '').trim(),
      answer: (r[1] || '').trim(),
      section: (r[2] || '').trim() || 'General',
    }))
    .filter((c) => c.question && c.answer);

  return { cards: standardCards, isMcqCsv: false };
}

/**
 * Unified parser supporting:
 * 1) Structured pasted MCQ blocks (`Q: ...`, `A) ... *`, `B) ...`, `Answer: B`, `Section: ...`)
 * 2) Multiple-choice CSV (`Question, A, B, C, D, Correct, Section` or `Question, CorrectAnswer, D1, D2, D3, Section` or pipe-delimited `Options`)
 * 3) Standard flashcard CSV (`Question, Answer, Section`)
 */
export function parseQuizInputText(rawText: string): QuizParseResult {
  const input = String(rawText || '').trim();
  if (!input) {
    return { cards: [], formatDetected: 'empty', mcqCount: 0 };
  }

  // Detect whether pasted input looks like structured MCQ text blocks
  const hasMcqTextMarkers =
    /^(?:q(?:uestion)?\s*\d*\s*[:.)-]|\d{1,3}[.)])\s+/im.test(input) ||
    /^(?:\*\s*)?(?:\([A-F]\)|[A-F][.):])\s+/im.test(input) ||
    /^(?:answer|ans|correct(?:\s+answer)?)\s*[:=-]\s+/im.test(input);

  if (hasMcqTextMarkers) {
    const textCards = parseMcqTextBlocks(input);
    if (textCards.length > 0) {
      const mcqCount = textCards.filter((c) => (c.options?.length || 0) >= 2).length;
      return {
        cards: textCards,
        formatDetected: mcqCount > 0 ? 'mcq-text' : 'csv',
        mcqCount,
      };
    }
  }

  const csvRes = parseMcqOrStandardCsv(input);
  if (csvRes.cards.length > 0) {
    const mcqCount = csvRes.cards.filter((c) => (c.options?.length || 0) >= 2).length;
    return {
      cards: csvRes.cards,
      formatDetected: csvRes.isMcqCsv ? 'mcq-csv' : 'csv',
      mcqCount,
    };
  }

  return { cards: [], formatDetected: 'empty', mcqCount: 0 };
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function deterministicShuffle<T>(arr: T[], seed?: string): T[] {
  const copy = [...arr];
  let s = seed ? hashSeed(seed) : Math.floor(Math.random() * 0xffffffff);
  const nextRand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildFallbackDistractors(officialAnswer: string): string[] {
  const trimmed = officialAnswer.trim();
  const distractors: string[] = [];

  // Year distractors
  const yearMatch = trimmed.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  if (yearMatch) {
    const yr = Number(yearMatch[1]);
    for (const delta of [-4, 3, 10, -10]) {
      distractors.push(trimmed.replace(yearMatch[1], String(yr + delta)));
    }
  }

  // Numeric distractors
  const numMatch = trimmed.match(/(-?\d+(?:\.\d+)?)/);
  if (numMatch && !yearMatch) {
    const num = Number(numMatch[1]);
    if (Number.isFinite(num)) {
      const deltas = num >= 20 ? [-10, 10, 25, -5] : [1, 2, -1, 4];
      for (const d of deltas) {
        const nextVal = Math.max(0, Math.round((num + d) * 100) / 100);
        if (nextVal !== num) {
          distractors.push(trimmed.replace(numMatch[1], String(nextVal)));
        }
      }
    }
  }

  const generic = [
    'None of the above',
    'Both A and B',
    'Not directly related',
    'Reverse process',
    'External equilibrium factor',
  ];
  for (const g of generic) {
    distractors.push(g);
  }

  return distractors;
}

/**
 * Generates up to 4 shuffled unique multiple-choice options for a flashcard or explicit MCQ card.
 * Prioritizes explicit `card.options`, then answers from the same section, then other cards in the deck.
 */
export function buildMcqChoices(
  cards: Array<{ question: string; answer: string; section?: string; options?: string[] }>,
  cardIndex: number,
  seed?: string
): string[] {
  const card = cards[cardIndex];
  if (!card) return [];

  const official = String(card.answer || '').trim();
  if (!official) return [];

  const usedKeys = new Set<string>([normalizeForFastCheck(official) || official.toLowerCase()]);
  const distractors: string[] = [];

  const tryAddDistractor = (candidate: string) => {
    const clean = String(candidate || '').trim();
    if (!clean) return;
    const key = normalizeForFastCheck(clean) || clean.toLowerCase();
    if (usedKeys.has(key)) return;
    if (fastLocalQuizCheck(clean, official)) return;
    usedKeys.add(key);
    distractors.push(clean);
  };

  // 1. Explicit authored MCQ choices take highest priority
  if (Array.isArray(card.options) && card.options.length > 0) {
    for (const opt of card.options) {
      tryAddDistractor(opt);
      if (distractors.length >= 3) break;
    }
  }

  // 2. Pull plausible distractors from other cards in the same section first
  const cardSec = (card.section || '').trim().toLowerCase();
  if (distractors.length < 3) {
    const sameSectionPool = cards
      .filter((c, i) => i !== cardIndex && (c.section || '').trim().toLowerCase() === cardSec)
      .map((c) => c.answer);
    for (const cand of deterministicShuffle(sameSectionPool, `${seed || card.question}:sec`)) {
      tryAddDistractor(cand);
      if (distractors.length >= 3) break;
    }
  }

  // 3. Pull from anywhere else in the deck
  if (distractors.length < 3) {
    const otherPool = cards.filter((_, i) => i !== cardIndex).map((c) => c.answer);
    for (const cand of deterministicShuffle(otherPool, `${seed || card.question}:deck`)) {
      tryAddDistractor(cand);
      if (distractors.length >= 3) break;
    }
  }

  // 4. Clean fallback distractors if the deck has fewer than 4 cards
  if (distractors.length < 3) {
    for (const cand of buildFallbackDistractors(official)) {
      tryAddDistractor(cand);
      if (distractors.length >= 3) break;
    }
  }

  const finalChoices = [official, ...distractors.slice(0, 3)];
  return deterministicShuffle(finalChoices, seed || `${cardIndex}:${card.question}`);
}

export function isMcqSelectionCorrect(selectedAnswer: string, officialAnswer: string): boolean {
  const s = String(selectedAnswer || '').trim();
  const o = String(officialAnswer || '').trim();
  if (!s || !o) return false;
  if (s === o) return true;
  if (s.toLowerCase() === o.toLowerCase()) return true;
  return fastLocalQuizCheck(s, o);
}
