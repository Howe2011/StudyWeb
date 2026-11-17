import { parseTextIntoStructuredNote } from './noteFormat';
import { StructuredNoteData } from '../types';

export interface SmartImportPreview {
  sourceLabel: string;
  suggestedTitle: string;
  mode: 'notes-and-cards' | 'flashcards-only';
  note: StructuredNoteData;
  cards: Array<{ q: string; a: string; sectionName: string }>;
  legacyHtml?: string;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseCsvLine(line: string): [string, string, string] | null {
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
    return [row[0], row[1], row[2] || 'Imported Deck'];
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
      const hm = pStyle.match(/heading\s*([1-6])/i);
      if (hm) {
        const lvl = Math.min(3, Math.max(1, Number(hm[1])));
        textLines.push(`${'#'.repeat(lvl)} ${cleanTxt}`);
        htmlParts.push(`<h${lvl}>${lineHtml}</h${lvl}>`);
      } else if (hasNum) {
        textLines.push(cleanTxt.startsWith('-') ? cleanTxt : `- ${cleanTxt}`);
        htmlParts.push(`<p>• ${lineHtml}</p>`);
      } else {
        textLines.push(cleanTxt);
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
          textLines.push(`${cells[0]} | ${cells[1]}`);
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
    html: `<div class="word-doc">${htmlParts.join('')}</div>`,
    text: textLines.join('\n'),
  };
}

/**
 * Zero-AI smart importer: turns Quizlet TSV, Anki/CSV, Q:/A:, Markdown, or plain class notes
 * into Save My Exams-style structured notes AND active-recall flashcards in 0ms.
 */
export function parseUniversalStudyImport(
  rawText: string,
  opts?: { sourceLabel?: string; legacyHtml?: string }
): SmartImportPreview {
  const cleanText = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r/g, '').trim();
  const lines = cleanText.split('\n');
  const cards: Array<{ q: string; a: string; sectionName: string }> = [];

  // 1. First scan explicitly for Q:/A: blocks, Quizlet tab-separated, pipe, ::, or pure CSV rows
  let pendingQ = '';
  let detectedPureFlashcards = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const t = lines[idx].trim();
    if (!t) continue;

    // Skip CSV header
    if (idx === 0 && /^(?:question|q|term|front)\s*[,|\t]\s*(?:answer|a|definition|back)/i.test(t)) {
      continue;
    }

    const qaInline = t.match(/^Q:\s*(.+?)\s*(?:\||::|->)\s*A:\s*(.+)$/i);
    if (qaInline) {
      cards.push({ q: qaInline[1].trim(), a: qaInline[2].trim(), sectionName: 'Imported Deck' });
      detectedPureFlashcards++;
      pendingQ = '';
      continue;
    }

    const qOnly = t.match(/^Q:\s*(.+)$/i);
    if (qOnly) {
      pendingQ = qOnly[1].trim();
      continue;
    }

    const aOnly = t.match(/^A:\s*(.+)$/i);
    if (aOnly && pendingQ) {
      cards.push({ q: pendingQ, a: aOnly[1].trim(), sectionName: 'Imported Deck' });
      detectedPureFlashcards++;
      pendingQ = '';
      continue;
    }

    if (t.includes('\t')) {
      const parts = t.split('\t').map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 2) {
        cards.push({
          q: parts[0],
          a: parts[1],
          sectionName: parts[2] || 'Imported Deck',
        });
        detectedPureFlashcards++;
        continue;
      }
    }

    if (t.includes('|') || t.includes('::')) {
      const parts = (t.includes('|') ? t.split('|') : t.split('::')).map((x) => x.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        cards.push({
          q: parts[0],
          a: parts[1],
          sectionName: parts[2] || 'Imported Deck',
        });
        detectedPureFlashcards++;
        continue;
      }
    }

    // Quoted or simple CSV if line looks strongly like CSV and file/label is CSV or >50% of lines have single comma
    if (/\.csv$/i.test(opts?.sourceLabel || '') || (t.startsWith('"') && t.includes('","'))) {
      const csvRow = parseCsvLine(t);
      if (csvRow) {
        cards.push({ q: csvRow[0], a: csvRow[1], sectionName: csvRow[2] });
        detectedPureFlashcards++;
      }
    }
  }

  // 2. Also structure the text as Save My Exams notes (and auto-extract Term: Definition cards!)
  const { note, extractedCards } = parseTextIntoStructuredNote(cleanText);
  if (opts?.legacyHtml && /<table[\s>]/i.test(opts.legacyHtml)) {
    note.legacyHtml = opts.legacyHtml;
  }

  // Merge cards deduplicated by question
  const seenQ = new Set(cards.map((c) => c.q.toLowerCase()));
  for (const ec of extractedCards) {
    if (!seenQ.has(ec.q.toLowerCase())) {
      cards.push(ec);
      seenQ.add(ec.q.toLowerCase());
    }
  }

  const firstHeading = cleanText.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  const baseFileName = (opts?.sourceLabel || '').replace(/\.[^.]+$/, '').trim();
  const suggestedTitle =
    firstHeading ||
    (baseFileName && !/pasted|text/i.test(baseFileName) ? baseFileName : '') ||
    'Imported Study Topic';

  const nonEmptyLines = lines.filter((l) => l.trim().length > 0).length;
  const isPureFlashcards =
    cards.length > 0 && detectedPureFlashcards >= Math.max(1, Math.floor(nonEmptyLines * 0.7));

  return {
    sourceLabel: opts?.sourceLabel || 'Pasted Notes',
    suggestedTitle,
    mode: isPureFlashcards ? 'flashcards-only' : 'notes-and-cards',
    note,
    cards,
    legacyHtml: opts?.legacyHtml,
  };
}
