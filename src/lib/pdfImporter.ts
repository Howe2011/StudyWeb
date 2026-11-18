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
}

interface PdfLine {
  y: number;
  xStart: number;
  fontSize: number;
  allBold: boolean;
  markdown: string;
  plain: string;
}

function isFontBold(fontName: string, styles: Record<string, { fontFamily?: string }>): boolean {
  const family = styles[fontName]?.fontFamily || '';
  return /bold|black|heavy|semibold|demi|medi/i.test(`${fontName} ${family}`);
}

/**
 * Pure-browser PDF ingestion using pdfjs-dist.
 * Reconstructs headings by font size, inline bold spans, and nested bullet lists by X indentation.
 */
export async function parsePdfFile(
  arrayBuffer: ArrayBuffer
): Promise<{ text: string; pageCount: number }> {
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(arrayBuffer),
    useWorkerFetch: false,
  });

  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const allPageLines: PdfLine[][] = [];
  const fontSizeCounts = new Map<number, number>();

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
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
      spans.push({
        str: rawStr,
        x,
        y,
        width: Number(item.width || 0),
        height: fontSize,
        bold: isFontBold(String(item.fontName || ''), styles),
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
    for (const row of groupedRows) {
      row.sort((a, b) => a.x - b.x);
      let plain = '';
      let md = '';
      let maxFont = 0;
      let allBold = true;
      let hasChars = false;
      let prevEndX = row[0].x;

      // Merge adjacent spans with matching bold state cleanly
      let activeBold = false;
      let boldBuf = '';

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

  return {
    text: outLines.join('\n').trim(),
    pageCount,
  };
}
