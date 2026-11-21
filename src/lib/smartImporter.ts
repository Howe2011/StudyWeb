import { sanitizeDocumentHtml } from './documentRenderer';
import {
  AutoFormatOptions,
  extractTimelineEventsFromNote,
  isNoteEmpty,
  parseTextIntoStructuredNote,
} from './noteFormat';
import { normalizeStudySymbols } from './noteSymbols';
import { convertLegacyEntriesToWorkspace, normalizeWorkspace } from './workspaceStore';
import { StructuredNoteData, TimelineEventItem, WorkspaceData } from '../types';

export type QuizletDelimiterMode =
  | 'auto'
  | 'tab'
  | 'alternating'
  | 'blank-line'
  | 'cloze'
  | 'semicolon'
  | 'pipe';

export interface SmartImportEntityStats {
  headings: number;
  subheadings: number;
  bullets: number;
  subBullets: number;
  tables: number;
  boldTerms: number;
  timelineEvents: number;
  cards: number;
}

export interface SmartImportPreview {
  sourceLabel: string;
  suggestedTitle: string;
  mode: 'notes-and-cards' | 'flashcards-only';
  note: StructuredNoteData;
  cards: Array<{ q: string; a: string; sectionName: string }>;
  timelineEvents: TimelineEventItem[];
  entityStats: SmartImportEntityStats;
  legacyHtml?: string;
  originalHtml?: string;
}

export interface BackupImportCounts {
  subjects: number;
  topics: number;
  notes: number;
  flashcards: number;
  timelines: number;
  timelineTopics: number;
  planner: number;
}

export interface ParsedBackupBundle {
  formatLabel: string;
  workspace: WorkspaceData;
  counts: BackupImportCounts;
}

export interface ParsedBulkTimelineNode {
  date: string;
  title: string;
  detail: string;
  significance?: string;
  era?: string;
  keyEvent?: boolean;
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

const WORD_HIGHLIGHT_HEX: Record<string, string> = {
  yellow: '#fef08a',
  green: '#bbf7d0',
  cyan: '#a5f3fc',
  magenta: '#f5d0fe',
  blue: '#bfdbfe',
  red: '#fecaca',
  darkblue: '#93c5fd',
  darkcyan: '#67e8f9',
  darkgreen: '#86efac',
  darkmagenta: '#e9d5ff',
  darkred: '#fca5a5',
  darkyellow: '#fde047',
  lightgray: '#e5e7eb',
  darkgray: '#d1d5db',
  black: '#1f2937',
  white: '#ffffff',
};

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function normalizeWordHex(val: string | null): string | null {
  if (!val) return null;
  const clean = val.replace(/^#/, '').trim();
  if (!clean || /^auto$/i.test(clean) || !/^[0-9a-fA-F]{6}$/.test(clean)) return null;
  return `#${clean.toLowerCase()}`;
}

/**
 * Pure-browser Word (.docx) OOXML reader returning rich formatted HTML (preserving fonts, colors,
 * highlights, alignments, lists, hyperlinks, styled tables, and embedded images) + Markdown text.
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

  const parser = new DOMParser();
  const xml = parser.parseFromString(td.decode(docBytes), 'application/xml');
  const body = Array.from(xml.getElementsByTagName('*')).find((n) => n.localName === 'body');
  if (!body) {
    throw new Error('Could not read Word document body.');
  }

  const attr = (el: Element | null, local: string): string | null => {
    if (!el) return null;
    for (const a of Array.from(el.attributes)) {
      if (a.localName === local || a.name === local || a.name === `w:${local}` || a.name === `r:${local}`) {
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
  const isFlagEnabled = (prEl: Element | null, tagLocal: string): boolean => {
    const flag = child(prEl, tagLocal);
    if (!flag) return false;
    const val = attr(flag, 'val');
    return val !== '0' && val !== 'false';
  };

  // Parse word/styles.xml for paragraph/heading style inheritance (color, size, font, jc)
  interface DocxStyleDef {
    name: string;
    basedOn?: string;
    jc?: string;
    color?: string;
    fontSizePt?: number;
    fontFamily?: string;
    bold?: boolean;
    italic?: boolean;
  }
  const styleMap = new Map<string, DocxStyleDef>();
  const stylesBytes = entries.get('word/styles.xml');
  if (stylesBytes) {
    try {
      const stylesXml = parser.parseFromString(td.decode(stylesBytes), 'application/xml');
      for (const st of Array.from(stylesXml.getElementsByTagName('*'))) {
        if (st.localName !== 'style') continue;
        const styleId = attr(st, 'styleId');
        if (!styleId) continue;
        const nameVal = attr(child(st, 'name'), 'val') || styleId;
        const basedOn = attr(child(st, 'basedOn'), 'val') || undefined;
        const pPr = child(st, 'pPr');
        const rPr = child(st, 'rPr');
        const jcRaw = attr(child(pPr, 'jc'), 'val');
        const jc = jcRaw === 'both' ? 'justify' : jcRaw || undefined;
        const color = normalizeWordHex(attr(child(rPr, 'color'), 'val')) || undefined;
        const szHalf = Number(attr(child(rPr, 'sz'), 'val') || 0);
        const fontSizePt = szHalf > 0 ? Math.round((szHalf / 2) * 10) / 10 : undefined;
        const rFonts = child(rPr, 'rFonts');
        const fontFamily = attr(rFonts, 'ascii') || attr(rFonts, 'hAnsi') || undefined;
        styleMap.set(styleId, {
          name: nameVal,
          basedOn,
          jc,
          color,
          fontSizePt,
          fontFamily,
          bold: child(rPr, 'b') ? isFlagEnabled(rPr, 'b') : undefined,
          italic: child(rPr, 'i') ? isFlagEnabled(rPr, 'i') : undefined,
        });
      }
    } catch {
      // Ignore malformed optional styles
    }
  }

  const resolveStyle = (styleId: string): DocxStyleDef => {
    const chain: DocxStyleDef[] = [];
    let curId: string | undefined = styleId;
    let guard = 0;
    while (curId && guard++ < 6) {
      const def = styleMap.get(curId);
      if (!def) break;
      chain.unshift(def);
      curId = def.basedOn;
    }
    const merged: DocxStyleDef = { name: styleId };
    for (const d of chain) {
      if (d.name) merged.name = d.name;
      if (d.jc) merged.jc = d.jc;
      if (d.color) merged.color = d.color;
      if (d.fontSizePt) merged.fontSizePt = d.fontSizePt;
      if (d.fontFamily) merged.fontFamily = d.fontFamily;
      if (d.bold !== undefined) merged.bold = d.bold;
      if (d.italic !== undefined) merged.italic = d.italic;
    }
    return merged;
  };

  // Parse word/numbering.xml to distinguish ordered vs unordered lists
  const numIdToAbstract = new Map<string, string>();
  const abstractLevelFmt = new Map<string, Map<number, string>>();
  const numberingBytes = entries.get('word/numbering.xml');
  if (numberingBytes) {
    try {
      const numXml = parser.parseFromString(td.decode(numberingBytes), 'application/xml');
      for (const el of Array.from(numXml.getElementsByTagName('*'))) {
        if (el.localName === 'abstractNum') {
          const absId = attr(el, 'abstractNumId');
          if (!absId) continue;
          const lvlMap = new Map<number, string>();
          for (const ch of Array.from(el.children)) {
            if (ch.localName !== 'lvl') continue;
            const ilvl = Number(attr(ch, 'ilvl') || 0);
            const fmt = attr(child(ch, 'numFmt'), 'val') || 'bullet';
            lvlMap.set(ilvl, fmt);
          }
          abstractLevelFmt.set(absId, lvlMap);
        } else if (el.localName === 'num') {
          const numId = attr(el, 'numId');
          const absId = attr(child(el, 'abstractNumId'), 'val');
          if (numId && absId) numIdToAbstract.set(numId, absId);
        }
      }
    } catch {
      // Ignore malformed numbering
    }
  }

  // Parse word/_rels/document.xml.rels for hyperlinks & bounded media images
  const relMap = new Map<string, { target: string; type: string; external: boolean }>();
  const relsBytes = entries.get('word/_rels/document.xml.rels');
  if (relsBytes) {
    try {
      const relsXml = parser.parseFromString(td.decode(relsBytes), 'application/xml');
      for (const el of Array.from(relsXml.getElementsByTagName('*'))) {
        if (el.localName !== 'Relationship') continue;
        const id = el.getAttribute('Id') || '';
        const target = el.getAttribute('Target') || '';
        const type = el.getAttribute('Type') || '';
        const mode = el.getAttribute('TargetMode') || '';
        if (id && target) {
          relMap.set(id, { target, type, external: mode.toLowerCase() === 'external' });
        }
      }
    } catch {
      // Ignore malformed rels
    }
  }

  let embeddedImageBytesTotal = 0;
  const mediaDataUriCache = new Map<string, string>();
  const resolveEmbeddedImageDataUri = (rId: string): string | null => {
    if (mediaDataUriCache.has(rId)) return mediaDataUriCache.get(rId)!;
    const rel = relMap.get(rId);
    if (!rel) return null;
    if (rel.external && /^https?:\/\//i.test(rel.target)) {
      return rel.target;
    }
    const cleanPath = rel.target.replace(/^\/+/, '');
    const zipKey = cleanPath.startsWith('word/') ? cleanPath : `word/${cleanPath}`;
    const bytes = entries.get(zipKey);
    if (!bytes) return null;
    if (bytes.byteLength > 120_000 || embeddedImageBytesTotal + bytes.byteLength > 350_000) {
      return null;
    }
    const ext = zipKey.split('.').pop()?.toLowerCase() || '';
    const mime =
      ext === 'png'
        ? 'image/png'
        : ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'gif'
        ? 'image/gif'
        : ext === 'webp'
        ? 'image/webp'
        : ext === 'svg'
        ? 'image/svg+xml'
        : '';
    if (!mime) return null;
    embeddedImageBytesTotal += bytes.byteLength;
    const dataUri = `data:${mime};base64,${uint8ToBase64(bytes)}`;
    mediaDataUriCache.set(rId, dataUri);
    return dataUri;
  };

  const renderRunElement = (
    rEl: Element,
    inheritedStyle?: DocxStyleDef
  ): { html: string; text: string; md: string; isBold: boolean; hasText: boolean } => {
    const rPr = child(rEl, 'rPr');
    const isBold = child(rPr, 'b') ? isFlagEnabled(rPr, 'b') : Boolean(inheritedStyle?.bold);
    const isItal = child(rPr, 'i') ? isFlagEnabled(rPr, 'i') : Boolean(inheritedStyle?.italic);
    const uVal = attr(child(rPr, 'u'), 'val');
    const isUnderline = Boolean(uVal && uVal !== 'none');
    const isStrike = isFlagEnabled(rPr, 'strike') || isFlagEnabled(rPr, 'dstrike');
    const vertAlign = attr(child(rPr, 'vertAlign'), 'val') || '';
    const colorHex = normalizeWordHex(attr(child(rPr, 'color'), 'val'));
    const hlKey = (attr(child(rPr, 'highlight'), 'val') || '').toLowerCase();
    const hlHex = WORD_HIGHLIGHT_HEX[hlKey] || null;
    const shdHex = normalizeWordHex(attr(child(rPr, 'shd'), 'fill'));
    const szHalf = Number(attr(child(rPr, 'sz'), 'val') || 0);
    const szPt = szHalf > 0 ? Math.round((szHalf / 2) * 10) / 10 : undefined;
    const rFonts = child(rPr, 'rFonts');
    const fontFamily = attr(rFonts, 'ascii') || attr(rFonts, 'hAnsi');

    let runTxt = '';
    let embeddedImgsHtml = '';

    for (const rn of Array.from(rEl.children)) {
      if (rn.localName === 't') runTxt += rn.textContent || '';
      else if (rn.localName === 'tab') runTxt += '  ';
      else if (rn.localName === 'br') runTxt += '\n';
      else if (rn.localName === 'drawing' || rn.localName === 'pict') {
        const blips = Array.from(rn.getElementsByTagName('*')).filter(
          (el) => el.localName === 'blip' || el.localName === 'imagedata'
        );
        for (const blip of blips) {
          const rId = attr(blip, 'embed') || attr(blip, 'id');
          if (!rId) continue;
          const uri = resolveEmbeddedImageDataUri(rId);
          if (uri) {
            embeddedImgsHtml += `<img src="${escapeHtml(uri)}" alt="" style="max-width: 100%; height: auto; margin: 6px 0;" />`;
          }
        }
      }
    }

    if (!runTxt && !embeddedImgsHtml) {
      return { html: '', text: '', md: '', isBold, hasText: false };
    }

    let md = runTxt;
    if (runTxt && isBold && runTxt.trim()) {
      const leading = runTxt.match(/^\s*/)?.[0] || '';
      const trailing = runTxt.match(/\s*$/)?.[0] || '';
      md = `${leading}**${runTxt.trim()}**${trailing}`;
    }

    let safeHtml = escapeHtml(runTxt).replace(/\n/g, '<br/>');
    if (isBold && !inheritedStyle?.bold) safeHtml = `<strong>${safeHtml}</strong>`;
    if (isItal) safeHtml = `<em>${safeHtml}</em>`;
    if (isUnderline) safeHtml = `<u>${safeHtml}</u>`;
    if (isStrike) safeHtml = `<s>${safeHtml}</s>`;
    if (vertAlign === 'superscript') safeHtml = `<sup>${safeHtml}</sup>`;
    else if (vertAlign === 'subscript') safeHtml = `<sub>${safeHtml}</sub>`;

    const styles: string[] = [];
    if (colorHex) styles.push(`color: ${colorHex}`);
    if (hlHex || shdHex) {
      styles.push(`background-color: ${hlHex || shdHex}; padding: 0 2px; border-radius: 2px`);
    }
    if (szPt && (!inheritedStyle?.fontSizePt || Math.abs(szPt - inheritedStyle.fontSizePt) > 0.5)) {
      styles.push(`font-size: ${szPt}pt`);
    }
    if (fontFamily && !/^(calibri|aptos|arial|times new roman)$/i.test(fontFamily)) {
      styles.push(`font-family: "${escapeHtml(fontFamily)}", sans-serif`);
    }
    if (styles.length > 0 && safeHtml) {
      safeHtml = `<span style="${styles.join('; ')}">${safeHtml}</span>`;
    }

    return {
      html: `${safeHtml}${embeddedImgsHtml}`,
      text: runTxt,
      md,
      isBold,
      hasText: Boolean(runTxt.trim()),
    };
  };

  const renderParagraph = (pNode: Element) => {
    const pPr = child(pNode, 'pPr');
    const pStyleId = attr(child(pPr, 'pStyle'), 'val') || '';
    const resolved = resolveStyle(pStyleId);
    const styleNameOrId = `${pStyleId} ${resolved.name}`.trim();

    const numPr = child(pPr, 'numPr');
    const numId = attr(child(numPr, 'numId'), 'val') || '';
    const ilvlVal = Number(attr(child(numPr, 'ilvl'), 'val') || 0);
    const hasNum = Boolean(numPr) || /list|bullet|number/i.test(styleNameOrId);
    let isOrderedList = false;
    if (numId && numIdToAbstract.has(numId)) {
      const absId = numIdToAbstract.get(numId)!;
      const fmt = abstractLevelFmt.get(absId)?.get(ilvlVal) || '';
      isOrderedList = /^(?:decimal|lowerLetter|upperLetter|lowerRoman|upperRoman)/i.test(fmt);
    } else if (/number/i.test(styleNameOrId)) {
      isOrderedList = true;
    }

    const jcRaw = attr(child(pPr, 'jc'), 'val') || resolved.jc;
    const textAlign = jcRaw === 'both' ? 'justify' : jcRaw;
    const indEl = child(pPr, 'ind');
    const leftTwips = Number(attr(indEl, 'left') || attr(indEl, 'start') || 0);
    const leftPt = !hasNum && leftTwips > 0 ? Math.round((leftTwips / 20) * 10) / 10 : 0;
    const pShdHex = normalizeWordHex(attr(child(pPr, 'shd'), 'fill'));
    const pBdrEl = child(pPr, 'pBdr');
    const leftBdrEl = child(pBdrEl, 'left');
    const leftBdrColor = normalizeWordHex(attr(leftBdrEl, 'color')) || '#94a3b8';

    let lineHtml = '';
    let lineText = '';
    let markdownLine = '';
    let allRunsBold = true;
    let hasTextRun = false;

    const processNodeChild = (ch: Element) => {
      if (ch.localName === 'r') {
        const res = renderRunElement(ch, resolved);
        lineHtml += res.html;
        lineText += res.text;
        markdownLine += res.md;
        if (res.hasText) {
          hasTextRun = true;
          if (!res.isBold) allRunsBold = false;
        }
      } else if (ch.localName === 'hyperlink') {
        const rId = attr(ch, 'id');
        const rel = rId ? relMap.get(rId) : undefined;
        let innerHtml = '';
        for (const sub of Array.from(ch.children)) {
          if (sub.localName === 'r') {
            const res = renderRunElement(sub, resolved);
            innerHtml += res.html;
            lineText += res.text;
            markdownLine += res.md;
            if (res.hasText) {
              hasTextRun = true;
              if (!res.isBold) allRunsBold = false;
            }
          }
        }
        if (rel && /^https?:\/\//i.test(rel.target)) {
          lineHtml += `<a href="${escapeHtml(rel.target)}" target="_blank" rel="noopener noreferrer">${innerHtml || escapeHtml(rel.target)}</a>`;
        } else {
          lineHtml += innerHtml;
        }
      }
    };

    for (const ch of Array.from(pNode.children)) {
      processNodeChild(ch);
    }

    const pStyles: string[] = [];
    if (textAlign && textAlign !== 'left') pStyles.push(`text-align: ${textAlign}`);
    if (leftPt > 0) pStyles.push(`margin-left: ${Math.min(140, Math.round(leftPt * 1.25))}px`);
    if (pShdHex) pStyles.push(`background-color: ${pShdHex}; padding: 8px 12px; border-radius: 6px`);
    if (leftBdrEl) pStyles.push(`border-left: 3px solid ${leftBdrColor}; padding-left: 12px`);
    if (resolved.color) pStyles.push(`color: ${resolved.color}`);
    if (resolved.fontSizePt) pStyles.push(`font-size: ${resolved.fontSizePt}pt`);

    return {
      lineHtml,
      cleanTxt: lineText.replace(/\*\*/g, '').trim(),
      cleanMd: markdownLine.replace(/\*\*\s*\*\*/g, ' ').trim(),
      styleNameOrId,
      hasNum,
      isOrderedList,
      ilvlVal,
      hasTextRun,
      allRunsBold,
      pStyleAttr: pStyles.length > 0 ? ` style="${pStyles.join('; ')}"` : '',
    };
  };

  const textLines: string[] = [];
  const htmlParts: string[] = [];
  let activeListTag: 'ul' | 'ol' | null = null;

  const closeActiveList = () => {
    if (activeListTag) {
      htmlParts.push(`</${activeListTag}>`);
      activeListTag = null;
    }
  };

  for (const node of Array.from(body.children)) {
    if (node.localName === 'p') {
      const p = renderParagraph(node);
      if (!p.cleanTxt && !p.lineHtml.includes('<img')) continue;

      const hm = p.styleNameOrId.match(/heading\s*([1-6])/i);
      const isTitleStyle = /^(?:title|subtitle)$/i.test(p.styleNameOrId.split(/\s+/)[0] || '');
      const isStandaloneBoldHeading =
        !hm &&
        !p.hasNum &&
        p.hasTextRun &&
        p.allRunsBold &&
        p.cleanTxt.length >= 3 &&
        p.cleanTxt.length <= 75 &&
        !/[.!?]$/.test(p.cleanTxt);

      if (hm || isTitleStyle) {
        closeActiveList();
        const lvl = isTitleStyle ? (/subtitle/i.test(p.styleNameOrId) ? 2 : 1) : Math.min(4, Math.max(1, Number(hm?.[1] || 2)));
        textLines.push(`${'#'.repeat(Math.min(3, lvl))} ${p.cleanTxt}`);
        htmlParts.push(`<h${lvl}${p.pStyleAttr}>${p.lineHtml}</h${lvl}>`);
      } else if (isStandaloneBoldHeading) {
        closeActiveList();
        textLines.push(`## ${p.cleanTxt}`);
        htmlParts.push(`<h2${p.pStyleAttr}>${p.lineHtml}</h2>`);
      } else if (p.hasNum) {
        const listTag: 'ul' | 'ol' = p.isOrderedList ? 'ol' : 'ul';
        if (activeListTag && activeListTag !== listTag) {
          closeActiveList();
        }
        if (!activeListTag) {
          htmlParts.push(`<${listTag}>`);
          activeListTag = listTag;
        }
        const prefix = p.ilvlVal >= 1 ? '  - ' : '- ';
        textLines.push(
          p.cleanMd.startsWith('-') ? `${p.ilvlVal >= 1 ? '  ' : ''}${p.cleanMd}` : `${prefix}${p.cleanMd}`
        );
        const liStyle = p.ilvlVal >= 1 ? ` style="margin-left: ${p.ilvlVal * 20}px"` : '';
        htmlParts.push(`<li${liStyle}>${p.lineHtml}</li>`);
      } else {
        closeActiveList();
        if (p.cleanMd) textLines.push(p.cleanMd);
        htmlParts.push(`<p${p.pStyleAttr}>${p.lineHtml}</p>`);
      }
    } else if (node.localName === 'tbl') {
      closeActiveList();
      const htmlRows: string[] = [];
      const tableCells: string[][] = [];
      let rowIdx = 0;

      for (const tr of Array.from(node.children)) {
        if (tr.localName !== 'tr') continue;
        const cells: string[] = [];
        const cellHtmlPieces: string[] = [];
        const trPr = child(tr, 'trPr');
        const isExplicitHeader = Boolean(child(trPr, 'tblHeader')) || rowIdx === 0;

        for (const tc of Array.from(tr.children)) {
          if (tc.localName !== 'tc') continue;
          const tcPr = child(tc, 'tcPr');
          const gridSpan = Number(attr(child(tcPr, 'gridSpan'), 'val') || 1);
          const tcShdHex = normalizeWordHex(attr(child(tcPr, 'shd'), 'fill'));
          const vAlign = attr(child(tcPr, 'vAlign'), 'val');

          const tcStyles: string[] = [];
          if (tcShdHex) tcStyles.push(`background-color: ${tcShdHex}`);
          if (vAlign === 'center' || vAlign === 'bottom' || vAlign === 'top') {
            tcStyles.push(`vertical-align: ${vAlign}`);
          }

          const paraParts: string[] = [];
          const paraTexts: string[] = [];
          for (const tcChild of Array.from(tc.children)) {
            if (tcChild.localName === 'p') {
              const cp = renderParagraph(tcChild);
              if (cp.cleanTxt || cp.lineHtml.includes('<img')) {
                paraTexts.push(cp.cleanTxt);
                paraParts.push(`<p style="margin: 2px 0${cp.pStyleAttr ? `; ${cp.pStyleAttr.replace(/^\s*style="/, '').replace(/"$/, '')}` : ''}">${cp.lineHtml}</p>`);
              }
            }
          }

          const cellText = paraTexts.filter(Boolean).join('; ').replace(/\|/g, '/').trim();
          cells.push(cellText);
          const tag = isExplicitHeader ? 'th' : 'td';
          const spanAttr = gridSpan > 1 ? ` colspan="${gridSpan}"` : '';
          const styleAttr = tcStyles.length > 0 ? ` style="${tcStyles.join('; ')}"` : '';
          cellHtmlPieces.push(`<${tag}${spanAttr}${styleAttr}>${paraParts.join('') || '&nbsp;'}</${tag}>`);
        }

        if (cells.some(Boolean) || cellHtmlPieces.length > 0) {
          tableCells.push(cells);
          htmlRows.push(`<tr>${cellHtmlPieces.join('')}</tr>`);
          rowIdx++;
        }
      }

      if (tableCells.length > 0) {
        const colCount = tableCells.reduce((m, r) => Math.max(m, r.length), 1);
        const arrowCellRe = /^(?:[→⇒⟶⟹➜➔➝➞➟➠➡➤►▶▸▹▻▷]|->|-->|=>|==>)$/;
        const isSingleArrowRow =
          tableCells.length === 1 &&
          colCount >= 3 &&
          tableCells[0].some((c) => arrowCellRe.test(c.trim()));

        if (isSingleArrowRow) {
          const steps = tableCells[0].filter((c) => c.trim() && !arrowCellRe.test(c.trim()));
          if (steps.length >= 2) {
            textLines.push(`⇒ ${steps.join(' → ')}`);
          }
        } else if (colCount >= 2) {
          const pad = (r: string[]) =>
            `| ${Array.from({ length: colCount }, (_, i) => r[i] || '').join(' | ')} |`;
          textLines.push(pad(tableCells[0]));
          textLines.push(`| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`);
          for (let r = 1; r < tableCells.length; r++) {
            textLines.push(pad(tableCells[r]));
          }
        } else {
          for (const r of tableCells) {
            if (r[0]) textLines.push(`- ${r[0]}`);
          }
        }
        htmlParts.push(`<table><tbody>${htmlRows.join('')}</tbody></table>`);
      }
    }
  }
  closeActiveList();

  return {
    html: `<div class="word-doc">${htmlParts.join('')}</div>`,
    text: textLines.join('\n'),
  };
}

/**
 * Dedicated parser for Quizlet Exports, Gizmo decks/cloze deletions, and alternating term-definition copies.
 */
export function parseQuizletOrGizmoCards(
  rawText: string,
  mode: QuizletDelimiterMode = 'auto',
  defaultSection = 'Imported Deck'
): Array<{ q: string; a: string; sectionName: string }> {
  const clean = normalizeStudySymbols(String(rawText || ''), {
    preserveLeadingFlowMarker: false,
  })
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  if (!clean) return [];

  const cards: Array<{ q: string; a: string; sectionName: string }> = [];
  const seen = new Set<string>();

  const pushCard = (q: string, a: string, sec = defaultSection) => {
    const cq = normalizeStudySymbols(q, { preserveLeadingFlowMarker: false })
      .replace(/\*\*/g, '')
      .trim();
    const ca = normalizeStudySymbols(a, { preserveLeadingFlowMarker: false })
      .replace(/\*\*/g, '')
      .trim();
    if (!cq || !ca) return;
    const key = `${cq.toLowerCase()}::${ca.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({ q: cq, a: ca, sectionName: sec.trim() || defaultSection });
  };

  // Explicit Blank-Line Separated Pairs: "Term\nDefinition\n\nTerm 2\nDefinition 2"
  if (mode === 'blank-line') {
    const blocks = clean.split(/\n\s*\n+/).map((b) =>
      b
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    );
    for (const blk of blocks) {
      if (blk.length >= 2) {
        pushCard(blk[0], blk.slice(1).join(' '));
      }
    }
    return cards;
  }

  // Explicit Alternating Lines: Line 1 = Question, Line 2 = Answer
  if (mode === 'alternating') {
    const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i + 1 < lines.length; i += 2) {
      pushCard(lines[i], lines[i + 1]);
    }
    return cards;
  }

  // Explicit Gizmo Cloze Mode: {{answer}} or ==answer==
  if (mode === 'cloze') {
    for (const rawLine of clean.split('\n')) {
      const line = rawLine.replace(/^(?:[-*•]\s*|\d+[.)]\s*)/, '').trim();
      if (!line) continue;
      const re = /\{\{([^}]+)\}\}|==([^=]+)==/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) {
        const ans = (m[1] || m[2] || '').trim();
        const q = line
          .replace(m[0], '[____]')
          .replace(/\{\{([^}]+)\}\}/g, '$1')
          .replace(/==([^=]+)==/g, '$1')
          .trim();
        if (q && ans) pushCard(q, ans, 'Gizmo Cloze');
      }
    }
    return cards;
  }

  // Explicit Delimiters (tab, semicolon, pipe)
  if (mode === 'tab' || mode === 'semicolon' || mode === 'pipe') {
    const sep = mode === 'tab' ? '\t' : mode === 'semicolon' ? ';' : '|';
    for (const rawLine of clean.split('\n')) {
      const line = rawLine.trim();
      if (!line || /^\|.+\|$/.test(line)) continue;
      const parts = line.split(sep).map((x) => x.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        pushCard(parts[0], parts[1], parts[2] || defaultSection);
      }
    }
    return cards;
  }

  // Auto-detect mode
  const blocks = clean.split(/\n\s*\n+/).map((b) =>
    b
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
  );
  const looksLikeBlankLinePairs =
    blocks.length >= 2 &&
    blocks.every((b) => b.length === 2 && !b[0].includes('\t') && !b[0].includes('::') && !/^Q:/i.test(b[0]));

  if (looksLikeBlankLinePairs) {
    for (const b of blocks) {
      pushCard(b[0], b[1]);
    }
    return cards;
  }

  let pendingQ = '';
  for (const rawLine of clean.split('\n')) {
    const t = rawLine.trim();
    if (!t || /^\|.+\|$/.test(t)) continue;

    // Cloze line inside auto mode
    if (/\{\{[^}]+\}\}|==[^=]+==/.test(t)) {
      const noBullet = t.replace(/^(?:[-*•]\s*|\d+[.)]\s*)/, '').trim();
      const re = /\{\{([^}]+)\}\}|==([^=]+)==/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(noBullet)) !== null) {
        const ans = (m[1] || m[2] || '').trim();
        const q = noBullet
          .replace(m[0], '[____]')
          .replace(/\{\{([^}]+)\}\}/g, '$1')
          .replace(/==([^=]+)==/g, '$1')
          .trim();
        if (q && ans) pushCard(q, ans, 'Gizmo Cloze');
      }
      continue;
    }

    const qaInline = t.match(/^Q:\s*(.+?)\s*(?:\||::|->|-->|=>|==>|[→⟶⟹➜➔➤➡↦])\s*A:\s*(.+)$/i);
    if (qaInline) {
      pushCard(qaInline[1], qaInline[2]);
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
      pushCard(pendingQ, aOnly[1]);
      pendingQ = '';
      continue;
    }

    if (t.includes('\t')) {
      const parts = t.split('\t').map((x) => x.trim()).filter(Boolean);
      if (parts.length >= 2) {
        pushCard(parts[0], parts[1], parts[2] || defaultSection);
        continue;
      }
    }

    if (t.includes('::') || t.includes('→') || t.includes('|')) {
      const sep = t.includes('::') ? '::' : t.includes('→') ? '→' : '|';
      const parts = t.split(sep).map((x) => x.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        pushCard(parts[0], parts[1], parts[2] || defaultSection);
        continue;
      }
    }

    const dashPair = t.match(/^([^–—-]{2,80})\s+[–—-]\s+(.{2,})$/);
    if (dashPair && !/^\d{3,4}$/.test(dashPair[1].trim())) {
      pushCard(dashPair[1], dashPair[2]);
    }
  }

  return cards;
}

/**
 * Zero-AI smart importer: turns Quizlet, Gizmo, Web URLs, PDFs, Word docs, Markdown, or plain class notes
 * into cleanly structured notes, timeline nodes, and active-recall flashcards in 0ms.
 */
export function parseUniversalStudyImport(
  rawText: string,
  opts?: {
    sourceLabel?: string;
    legacyHtml?: string;
    originalHtml?: string;
    preferOriginalFormat?: boolean;
    formatOptions?: AutoFormatOptions;
    deckDelimiter?: QuizletDelimiterMode;
    preExtractedCards?: Array<{ q: string; a: string; sectionName: string }>;
  }
): SmartImportPreview {
  const cleanText = normalizeStudySymbols(String(rawText || ''), {
    preserveLeadingFlowMarker: true,
  })
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .trim();
  const lines = cleanText.split('\n');
  const cards: Array<{ q: string; a: string; sectionName: string }> = [];
  let detectedPureFlashcards = 0;

  if (opts?.preExtractedCards?.length) {
    for (const c of opts.preExtractedCards) {
      if (c.q.trim() && c.a.trim()) {
        cards.push(c);
        detectedPureFlashcards++;
      }
    }
  }

  // If explicit Quizlet/Gizmo delimiter mode chosen (alternating / blank-line / semicolon / etc.)
  if (opts?.deckDelimiter && opts.deckDelimiter !== 'auto') {
    const deckCards = parseQuizletOrGizmoCards(cleanText, opts.deckDelimiter, 'Imported Deck');
    const seen = new Set(cards.map((c) => c.q.toLowerCase()));
    for (const c of deckCards) {
      if (!seen.has(c.q.toLowerCase())) {
        cards.push(c);
        seen.add(c.q.toLowerCase());
        detectedPureFlashcards++;
      }
    }
  } else {
    // 1. Scan explicitly for Q:/A: blocks, Quizlet tab-separated, pipe, ::, Gizmo cloze, or pure CSV flashcard rows
    let pendingQ = '';
    for (let idx = 0; idx < lines.length; idx++) {
      const t = lines[idx].trim();
      if (!t) continue;

      if (/^\|.+\|$/.test(t)) {
        continue;
      }

      if (idx === 0 && /^(?:question|q|term|front)\s*[,|\t]\s*(?:answer|a|definition|back)/i.test(t)) {
        continue;
      }

      const qaInline = t.match(/^Q:\s*(.+?)\s*(?:\||::|->|-->|=>|==>|[→⟶⟹➜➔➤➡↦])\s*A:\s*(.+)$/i);
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
        if (parts.length === 2) {
          cards.push({
            q: parts[0],
            a: parts[1],
            sectionName: 'Imported Deck',
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

      if (/\.csv$/i.test(opts?.sourceLabel || '') || (t.startsWith('"') && t.includes('","'))) {
        const csvRow = parseCsvLine(t);
        if (csvRow) {
          cards.push({ q: csvRow[0], a: csvRow[1], sectionName: csvRow[2] });
          detectedPureFlashcards++;
        }
      }
    }

    // Check blank-line Quizlet copy-paste pairs if no explicit delimiter matched
    if (cards.length === 0) {
      const blocks = cleanText.split(/\n\s*\n+/).map((b) =>
        b
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      );
      if (
        blocks.length >= 2 &&
        blocks.every((b) => b.length === 2 && !b[0].startsWith('#') && !b[0].startsWith('-'))
      ) {
        for (const b of blocks) {
          cards.push({ q: b[0], a: b[1], sectionName: 'Imported Deck' });
          detectedPureFlashcards += 2;
        }
      }
    }
  }

  // 2. Structure the text into cleanly formatted study sections according to user's chosen preset & options
  const { note, extractedCards } = parseTextIntoStructuredNote(cleanText, opts?.formatOptions);
  const rawOrig = opts?.originalHtml || opts?.legacyHtml || '';
  const cleanOriginalHtml = rawOrig
    ? typeof DOMParser !== 'undefined'
      ? sanitizeDocumentHtml(rawOrig)
      : rawOrig.trim()
    : '';
  if (cleanOriginalHtml) {
    note.originalHtml = cleanOriginalHtml;
    note.preferOriginalFormat = opts?.preferOriginalFormat ?? true;
  }
  if (opts?.legacyHtml && /<table[\s>]/i.test(opts.legacyHtml)) {
    note.legacyHtml = opts.legacyHtml;
  }

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
    (baseFileName && !/pasted|text|quizlet|gizmo/i.test(baseFileName) ? baseFileName : '') ||
    'Imported Study Topic';

  const nonEmptyLines = lines.filter((l) => l.trim().length > 0).length;
  const isPureFlashcards =
    Boolean(opts?.preExtractedCards?.length) ||
    (opts?.deckDelimiter !== undefined && opts.deckDelimiter !== 'auto' && cards.length > 0) ||
    (cards.length > 0 && detectedPureFlashcards >= Math.max(1, Math.floor(nonEmptyLines * 0.65)));

  const timelineEvents = isPureFlashcards
    ? []
    : extractTimelineEventsFromNote(note, cleanText);

  let subheadings = 0;
  let bullets = 0;
  let subBullets = 0;
  let tables = 0;
  let inTable = false;
  for (const sec of note.sections) {
    for (const pt of sec.points) {
      const t = pt.trim();
      if (/^\|.+\|$/.test(t)) {
        if (!inTable) {
          tables++;
          inTable = true;
        }
        continue;
      }
      inTable = false;
      if (t.startsWith('### ')) subheadings++;
      else if (t.startsWith('↳ ')) subBullets++;
      else if (!t.startsWith('¶ ')) bullets++;
    }
    inTable = false;
  }

  return {
    sourceLabel: opts?.sourceLabel || 'Pasted Notes',
    suggestedTitle,
    mode: isPureFlashcards ? 'flashcards-only' : 'notes-and-cards',
    note,
    cards,
    timelineEvents,
    entityStats: {
      headings: note.sections.length,
      subheadings,
      bullets,
      subBullets,
      tables,
      boldTerms: note.keyTerms.length,
      timelineEvents: timelineEvents.length,
      cards: cards.length,
    },
    legacyHtml: opts?.legacyHtml,
    originalHtml: cleanOriginalHtml || undefined,
  };
}

/**
 * Parses StudyDeck v2, Revision Site v1 (`app: "revision-site", v: 1`), legacy v1, or Planner JSON backups
 * into a unified WorkspaceData bundle with exact item counts.
 */
export function parseBackupJsonToWorkspace(rawJson: string): ParsedBackupBundle | null {
  const trimmed = String(rawJson || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
    return null;
  }

  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

    let formatLabel = 'StudyWeb Backup (.json)';
    let parsedWs: WorkspaceData | null = null;

    if ((obj.app === 'studydeck' || obj.app === 'studyweb') && obj.v === 2 && obj.workspace) {
      formatLabel = 'StudyWeb v2 Full Backup';
      parsedWs = normalizeWorkspace(obj.workspace);
    } else if (obj.version === 2 && Array.isArray(obj.subjects)) {
      formatLabel = 'StudyWeb Workspace Backup';
      parsedWs = normalizeWorkspace(obj);
    } else {
      const rev: Record<string, string> = {};
      const pln: Record<string, string> = {};

      if (obj.app === 'studydeck' || obj.app === 'studyweb') {
        formatLabel = 'StudyWeb v1 Legacy Backup';
        const rObj = (
          obj.revision && typeof obj.revision === 'object' ? obj.revision : {}
        ) as Record<string, unknown>;
        const pObj = (
          obj.planner && typeof obj.planner === 'object' ? obj.planner : {}
        ) as Record<string, unknown>;
        for (const [k, v] of Object.entries(rObj)) if (typeof v === 'string') rev[k] = v;
        for (const [k, v] of Object.entries(pObj)) if (typeof v === 'string') pln[k] = v;
      } else if (obj.app === 'revision-site' && obj.data && typeof obj.data === 'object') {
        formatLabel = `Revision Site v${String(obj.v || 1)} Backup`;
        for (const [k, v] of Object.entries(obj.data as Record<string, unknown>)) {
          if (typeof v === 'string') rev[k] = v;
          else if (v && typeof v === 'object') rev[k] = JSON.stringify(v);
        }
      } else if (
        obj.app === 'mock-revision-planner' &&
        obj.data &&
        typeof obj.data === 'object'
      ) {
        formatLabel = 'Revision Planner Backup';
        pln['mockplanner.v1'] = JSON.stringify(obj.data);
      } else if (
        Array.isArray(obj.subs) ||
        Array.isArray(obj.todos) ||
        Array.isArray(obj.blocks) ||
        (obj.td && typeof obj.td === 'object')
      ) {
        formatLabel = 'Planner Backup';
        pln['mockplanner.v1'] = JSON.stringify(obj);
      }

      const conv = convertLegacyEntriesToWorkspace(rev, pln);
      if (conv.hadLegacyData) parsedWs = conv.workspace;
    }

    if (!parsedWs) return null;

    const notesCount = parsedWs.topics.filter((t) => !isNoteEmpty(t.notes)).length;
    const timelineTopics = parsedWs.topics.filter(
      (t) => t.timelineEvents && t.timelineEvents.length > 0
    ).length;
    const timelinesCount = parsedWs.topics.reduce(
      (acc, t) => acc + (t.timelineEvents?.length || 0),
      0
    );

    return {
      formatLabel,
      workspace: parsedWs,
      counts: {
        subjects: parsedWs.subjects.length,
        topics: parsedWs.topics.length,
        notes: notesCount,
        flashcards: parsedWs.flashcards.length,
        timelines: timelinesCount,
        timelineTopics,
        planner: parsedWs.todos.length + parsedWs.calendarBlocks.length,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Parses multiple History timeline nodes from text (`Date | Title | Detail | Era`, `Date — Title: Detail`, TSV)
 * or JSON (`edits-*`, array of event objects, or full backup timeline nodes).
 */
export function parseBulkTimelineNodes(rawText: string): ParsedBulkTimelineNode[] {
  const trimmed = String(rawText || '').replace(/\r/g, '').trim();
  if (!trimmed) return [];

  // 1. JSON support (array or legacy edits-* object)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const results: ParsedBulkTimelineNode[] = [];
      const pushObj = (item: Record<string, unknown>, fallbackTitle?: string) => {
        const date = String(item.date ?? item.d ?? '').trim();
        const title = String(item.title ?? item.e ?? item.t ?? fallbackTitle ?? '').trim();
        const detail = String(item.detail ?? item.x ?? '').trim();
        const significance = String(item.significance ?? item.w ?? '').trim() || undefined;
        const era = String(item.era ?? '').trim() || undefined;
        const keyEvent = Boolean(item.keyEvent ?? item.key);
        if (title || detail) {
          results.push({
            date: date || 'Undated',
            title: title || 'Historical Event',
            detail,
            significance,
            era,
            keyEvent: keyEvent || undefined,
          });
        }
      };

      if (Array.isArray(parsed)) {
        for (const el of parsed) {
          if (el && typeof el === 'object') pushObj(el as Record<string, unknown>);
        }
        return results;
      }

      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (obj.mod && typeof obj.mod === 'object') {
          for (const [k, v] of Object.entries(obj.mod as Record<string, unknown>)) {
            if (v && typeof v === 'object') pushObj(v as Record<string, unknown>, k);
          }
        }
        if (Array.isArray(obj.add)) {
          for (const el of obj.add) {
            if (el && typeof el === 'object') pushObj(el as Record<string, unknown>);
          }
        }
        if (Array.isArray(obj.ne)) {
          for (const el of obj.ne) {
            if (el && typeof el === 'object') pushObj(el as Record<string, unknown>);
          }
        }
        if (results.length > 0) return results;
      }
    } catch {
      // Fall through to text parser
    }
  }

  // 2. Multi-line text parser
  const nodes: ParsedBulkTimelineNode[] = [];
  for (const rawLine of trimmed.split('\n')) {
    const line = rawLine.replace(/^(?:[-*•]\s*)/, '').trim();
    if (!line) continue;
    if (/^(?:date|year)\s*[\t|,]\s*(?:title|event)/i.test(line)) continue;

    // Pipe or Tab separated: Date | Title | Detail | Era  OR  Date | Title | Detail | Significance | Era
    if (line.includes('\t') || line.includes('|')) {
      const parts = (line.includes('\t') ? line.split('\t') : line.split('|')).map((p) =>
        p.trim()
      );
      if (parts.length >= 2 && (parts[0] || parts[1])) {
        nodes.push({
          date: parts[0] || 'Undated',
          title: parts[1] || parts[0],
          detail: parts[2] || '',
          significance: parts.length >= 5 ? parts[3] || undefined : undefined,
          era: parts.length >= 5 ? parts[4] || undefined : parts[3] || undefined,
        });
        continue;
      }
    }

    const normalizedLine = normalizeStudySymbols(line, { preserveLeadingFlowMarker: false });
    // "1923 — Hyperinflation: Value dropped" or "3 Oct 1929 - Stresemann Dies — Lost key statesman"
    const dashMatch = normalizedLine.match(
      /^([A-Za-z0-9 ,./'-]{2,28}?)\s*(?:—|–|->|→|::|\s-\s|:\s+)\s*(.+)$/
    );
    if (dashMatch) {
      const date = dashMatch[1].trim();
      const rest = dashMatch[2].trim();
      const splitDetail = rest.match(/^(.+?)\s*(?::\s+|—|–|\s-\s)\s*(.+)$/);
      nodes.push({
        date,
        title: splitDetail ? splitDetail[1].trim() : rest,
        detail: splitDetail ? splitDetail[2].trim() : '',
      });
      continue;
    }

    // Year prefix e.g. "1918 Armistice Signed"
    const yearStart = line.match(/^((?:c\.\s*)?(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)?\.?\s*\d{3,4}(?:\s*(?:BC|BCE|AD))?)\s+(.+)$/i);
    if (yearStart) {
      const rest = yearStart[2].trim();
      const splitDetail = rest.match(/^(.+?)\s*(?::\s+|—|–|\s-\s)\s*(.+)$/);
      nodes.push({
        date: yearStart[1].trim(),
        title: splitDetail ? splitDetail[1].trim() : rest,
        detail: splitDetail ? splitDetail[2].trim() : '',
      });
    }
  }

  return nodes;
}
