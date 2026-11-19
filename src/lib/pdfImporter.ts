import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfTextSpan {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  bold: boolean;
  italic: boolean;
  fontKind: 'sans' | 'serif' | 'mono';
}

interface PdfLine {
  y: number;
  xStart: number;
  fontSize: number;
  allBold: boolean;
  markdown: string;
  plain: string;
}

function escapePdfHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inspectPdfFont(
  fontName: string,
  styles: Record<string, { fontFamily?: string }>
): { bold: boolean; italic: boolean; fontKind: 'sans' | 'serif' | 'mono' } {
  const family = styles[fontName]?.fontFamily || '';
  const combined = `${fontName} ${family}`;
  const bold = /bold|black|heavy|semibold|demi|medi/i.test(combined);
  const italic = /italic|oblique/i.test(combined);
  const fontKind: 'sans' | 'serif' | 'mono' = /mono|courier|consola/i.test(combined)
    ? 'mono'
    : /serif|times|garamond|georgia|palatino|cambria/i.test(combined) && !/sans/i.test(combined)
    ? 'serif'
    : 'sans';
  return { bold, italic, fontKind };
}

/**
 * Pure-browser PDF ingestion using pdfjs-dist.
 * Reconstructs both responsive exact-layout HTML pages (.sd-pdf-page) and clean Markdown text.
 */
export async function parsePdfFile(
  arrayBuffer: ArrayBuffer
): Promise<{ text: string; html: string; pageCount: number }> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: false,
  });

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const allPageLines: PdfLine[][] = [];
  const pageHtmlBlocks: string[] = [];
  const fontSizeCounts = new Map<number, number>();
  const MAX_VISUAL_PAGES = 35;

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const pageW = Math.max(200, viewport.width || 595);
    const pageH = Math.max(200, viewport.height || 842);
    const content = await page.getTextContent();
    const styles = (content.styles || {}) as Record<string, { fontFamily?: string }>;
    const spans: PdfTextSpan[] = [];

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const rawStr = String(item.str || '');
      if (!rawStr) continue;
      const tr = item.transform as number[];
      const x = Number(tr[4] || 0);
      const y = Number(tr[5] || 0);
      const fontSize = Math.round((Math.hypot(tr[0] || 0, tr[1] || 0) || Math.abs(tr[3] || 11)) * 10) / 10;
      const roundedSize = Math.round(fontSize);
      if (rawStr.trim()) {
        fontSizeCounts.set(roundedSize, (fontSizeCounts.get(roundedSize) || 0) + rawStr.trim().length);
      }
      const fontInfo = inspectPdfFont(String(item.fontName || ''), styles);
      spans.push({
        str: rawStr,
        x,
        y,
        width: Number(item.width || 0),
        height: fontSize,
        bold: fontInfo.bold,
        italic: fontInfo.italic,
        fontKind: fontInfo.fontKind,
      });
    }

    // Group spans into visual lines (top-to-bottom Y descending, then X ascending)
    spans.sort((a, b) => (Math.abs(b.y - a.y) > 3 ? b.y - a.y : a.x - b.x));

    const groupedRows: PdfTextSpan[][] = [];
    for (const span of spans) {
      const lastRow = groupedRows[groupedRows.length - 1];
      if (!lastRow || Math.abs(lastRow[0].y - span.y) > Math.max(2.5, span.height * 0.35)) {
        groupedRows.push([span]);
      } else {
        lastRow.push(span);
      }
    }

    const lines: PdfLine[] = [];
    const visualSpanEls: string[] = [];

    for (const row of groupedRows) {
      row.sort((a, b) => a.x - b.x);
      let plain = '';
      let md = '';
      let maxFont = 0;
      let allBold = true;
      let hasChars = false;
      let prevEndX = row[0].x;

      // Merge adjacent spans with matching bold state cleanly for Markdown
      let activeBold = false;
      let boldBuf = '';

      // Merge contiguous visual spans with matching styling & small X gaps for crisp lightweight HTML
      const mergedVisual: Array<{
        text: string;
        x: number;
        y: number;
        endX: number;
        height: number;
        bold: boolean;
        italic: boolean;
        fontKind: 'sans' | 'serif' | 'mono';
      }> = [];

      const flushBoldBuf = () => {
        if (!boldBuf) return;
        const lead = boldBuf.match(/^\s*/)?.[0] || '';
        const trail = boldBuf.match(/\s*$/)?.[0] || '';
        const core = boldBuf.trim();
        if (core) {
          md += `${lead}**${core}**${trail}`;
        } else {
          md += boldBuf;
        }
        boldBuf = '';
      };

      for (let i = 0; i < row.length; i++) {
        const sp = row[i];
        const gap = i > 0 ? sp.x - prevEndX : 0;
        const spaceNeeded =
          i > 0 &&
          gap > Math.max(1.8, sp.height * 0.22) &&
          !plain.endsWith(' ') &&
          !sp.str.startsWith(' ');

        const chunk = (spaceNeeded ? ' ' : '') + sp.str;
        plain += chunk;

        if (sp.str.trim()) {
          hasChars = true;
          if (!sp.bold) allBold = false;
          if (sp.height > maxFont) maxFont = sp.height;

          const lastVis = mergedVisual[mergedVisual.length - 1];
          const visGap = lastVis ? sp.x - lastVis.endX : 999;
          if (
            lastVis &&
            lastVis.bold === sp.bold &&
            lastVis.italic === sp.italic &&
            lastVis.fontKind === sp.fontKind &&
            Math.abs(lastVis.height - sp.height) < 1.2 &&
            visGap < sp.height * 0.75 &&
            visGap > -sp.height * 0.35
          ) {
            const needGapSpace =
              visGap > Math.max(1.5, sp.height * 0.2) &&
              !lastVis.text.endsWith(' ') &&
              !sp.str.startsWith(' ');
            lastVis.text += (needGapSpace ? ' ' : '') + sp.str;
            lastVis.endX = Math.max(lastVis.endX, sp.x + sp.width);
          } else {
            mergedVisual.push({
              text: sp.str,
              x: sp.x,
              y: sp.y,
              endX: sp.x + sp.width,
              height: sp.height,
              bold: sp.bold,
              italic: sp.italic,
              fontKind: sp.fontKind,
            });
          }
        }

        if (sp.bold) {
          if (!activeBold) activeBold = true;
          boldBuf += chunk;
        } else {
          if (activeBold) {
            flushBoldBuf();
            activeBold = false;
          }
          md += chunk;
        }

        prevEndX = sp.x + sp.width;
      }
      if (activeBold) flushBoldBuf();

      if (p <= MAX_VISUAL_PAGES) {
        for (const mv of mergedVisual) {
          if (!mv.text.trim()) continue;
          const leftPct = Math.max(0, Math.min(97, (mv.x / pageW) * 100)).toFixed(3);
          const topPct = Math.max(
            0,
            Math.min(97, ((pageH - mv.y - mv.height * 0.85) / pageH) * 100)
          ).toFixed(3);
          const fontCqw = Math.max(0.85, Math.min(8.5, (mv.height / pageW) * 100)).toFixed(3);
          const styleParts = [`left:${leftPct}%`, `top:${topPct}%`, `font-size:${fontCqw}cqw`];
          if (mv.bold) styleParts.push('font-weight:700');
          if (mv.italic) styleParts.push('font-style:italic');
          if (mv.fontKind === 'serif') styleParts.push('font-family:Georgia,serif');
          else if (mv.fontKind === 'mono') styleParts.push('font-family:monospace');
          visualSpanEls.push(
            `<span class="sd-pdf-span" style="${styleParts.join(';')}">${escapePdfHtml(mv.text)}</span>`
          );
        }
      }

      const cleanPlain = plain.replace(/\s+/g, ' ').trim();
      const cleanMd = md.replace(/\*\*([^*]+?)\*\*\s*\*\*([^*]+?)\*\*/g, '**$1 $2**').replace(/\s+/g, ' ').trim();
      if (!hasChars || !cleanPlain) continue;
      // Skip bare page numbers like "1" or "Page 2 of 10"
      if (/^(?:page\s*)?\d{1,3}(?:\s*(?:of|\/)\s*\d{1,3})?$/i.test(cleanPlain)) continue;

      lines.push({
        y: row[0].y,
        xStart: row[0].x,
        fontSize: maxFont || 11,
        allBold,
        markdown: cleanMd,
        plain: cleanPlain,
      });
    }

    if (p <= MAX_VISUAL_PAGES && visualSpanEls.length > 0) {
      const aspect = (pageW / pageH).toFixed(4);
      pageHtmlBlocks.push(
        `<div class="sd-pdf-page-wrap"><div class="sd-pdf-page-label">Page ${p} of ${pageCount}</div><div class="sd-pdf-page" style="aspect-ratio:${aspect}">${visualSpanEls.join('')}</div></div>`
      );
    }

    allPageLines.push(lines);
  }

  // Determine modal body font size across document
  let bodyFontSize = 11;
  let bestCount = -1;
  for (const [sz, count] of fontSizeCounts.entries()) {
    if (count > bestCount && sz >= 7 && sz <= 24) {
      bestCount = count;
      bodyFontSize = sz;
    }
  }

  // Determine base left margin from non-heading lines
  const xStarts = allPageLines
    .flat()
    .filter((l) => l.fontSize <= bodyFontSize + 1.5)
    .map((l) => Math.round(l.xStart))
    .sort((a, b) => a - b);
  const baseLeftX = xStarts.length ? xStarts[Math.floor(xStarts.length * 0.1)] : 40;

  const outLines: string[] = [];

  for (const pageLines of allPageLines) {
    for (let i = 0; i < pageLines.length; i++) {
      const ln = pageLines[i];
      const bulletMatch = ln.markdown.match(/^(?:[•▪◦‣–—*-]|\d+[.)])\s+(.+)$/);

      if (ln.fontSize >= bodyFontSize * 1.32 && ln.plain.length <= 120) {
        outLines.push(`# ${ln.plain}`);
        continue;
      }
      if (ln.fontSize >= bodyFontSize * 1.14 && ln.plain.length <= 120 && !/[.!?]$/.test(ln.plain)) {
        outLines.push(`## ${ln.plain}`);
        continue;
      }
      if (
        ln.allBold &&
        !bulletMatch &&
        ln.plain.length >= 3 &&
        ln.plain.length <= 75 &&
        !/[.!?]$/.test(ln.plain) &&
        !ln.plain.includes(':')
      ) {
        outLines.push(`### ${ln.plain}`);
        continue;
      }

      if (bulletMatch) {
        const isNested = ln.xStart >= baseLeftX + 18;
        const body = bulletMatch[1].trim();
        outLines.push(`${isNested ? '  - ' : '- '}${body}`);
        continue;
      }

      // Join wrapped prose lines smoothly when they belong to the same paragraph
      const prevLine = outLines[outLines.length - 1];
      const prevWasRegularText =
        prevLine &&
        !prevLine.startsWith('#') &&
        !prevLine.startsWith('|') &&
        !/[.!?:]$/.test(prevLine) &&
        ln.xStart <= baseLeftX + 36 &&
        i > 0 &&
        Math.abs(pageLines[i - 1].y - ln.y) <= bodyFontSize * 1.75;

      if (prevWasRegularText && !/^[A-Z0-9\s&/()-]{4,50}$/.test(ln.plain)) {
        outLines[outLines.length - 1] = `${prevLine} ${ln.markdown}`;
      } else {
        outLines.push(ln.markdown);
      }
    }
  }

  const extraNotice =
    pageCount > MAX_VISUAL_PAGES
      ? `<p style="font-size:12px;color:#64748b;text-align:center;">Showing exact page layout for first ${MAX_VISUAL_PAGES} of ${pageCount} pages. Switch to Read tab for full document notes.</p>`
      : '';

  return {
    text: outLines.join('\n').trim(),
    html: pageHtmlBlocks.length > 0 ? `<div class="sd-pdf-stack">${pageHtmlBlocks.join('')}${extraNotice}</div>` : '',
    pageCount,
  };
}
