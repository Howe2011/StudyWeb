/**
 * Safe HTML sanitization and scoped style preservation for Exact Original Document rendering.
 * Keeps colors, highlights, fonts, sizes, alignments, borders, tables, and PDF page coordinates
 * while stripping scripts/handlers and scoping embedded stylesheet rules inside `.sd-doc-sheet`.
 */

const ALLOWED_TAGS = new Set([
  'a',
  'b',
  'blockquote',
  'br',
  'caption',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'mark',
  'math',
  'annotation',
  'semantics',
  'mrow',
  'mi',
  'mn',
  'mo',
  'msup',
  'msub',
  'msubsup',
  'mfrac',
  'msqrt',
  'mroot',
  'mtable',
  'mtr',
  'mtd',
  'ol',
  'p',
  'pre',
  's',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);
export { renderDocumentHtmlWithLatex } from './latexRenderer';

const ALLOWED_CSS_PROPS = new Set([
  'align-items',
  'aspect-ratio',
  'background',
  'background-color',
  'border',
  'border-bottom',
  'border-collapse',
  'border-color',
  'border-left',
  'border-radius',
  'border-right',
  'border-spacing',
  'border-top',
  'bottom',
  'box-sizing',
  'color',
  'direction',
  'display',
  'flex',
  'flex-wrap',
  'font',
  'font-family',
  'font-size',
  'font-style',
  'font-variant',
  'font-weight',
  'gap',
  'height',
  'left',
  'letter-spacing',
  'line-height',
  'list-style',
  'list-style-type',
  'margin',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-width',
  'min-height',
  'min-width',
  'opacity',
  'overflow',
  'padding',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'text-align',
  'text-decoration',
  'text-decoration-line',
  'text-indent',
  'text-transform',
  'top',
  'vertical-align',
  'white-space',
  'width',
]);

const ALLOWED_CLASSES = new Set([
  'word-doc',
  'sd-pdf-stack',
  'sd-pdf-page-wrap',
  'sd-pdf-page-label',
  'sd-pdf-page',
  'sd-pdf-page-card',
  'sd-pdf-page-img',
  'sd-pdf-span',
  'sd-note-figure',
  'sd-note-img',
  'sd-note-figcaption',
]);

function sanitizeInlineStyle(rawStyle: string, isPdfElement: boolean): string {
  const declarations = rawStyle.split(';');
  const safe: string[] = [];

  for (const decl of declarations) {
    const colon = decl.indexOf(':');
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const val = decl.slice(colon + 1).trim();
    if (!prop || !val) continue;
    if (!ALLOWED_CSS_PROPS.has(prop)) continue;
    if (/expression\s*\(|javascript:|vbscript:|url\s*\(/i.test(val)) continue;
    if ((prop === 'position' || prop === 'left' || prop === 'top' || prop === 'right' || prop === 'bottom') && !isPdfElement) {
      continue;
    }
    safe.push(`${prop}: ${val}`);
  }

  return safe.join('; ');
}

function scopeStylesheetText(css: string): string {
  // Strip @import, comments, expression(), javascript: urls
  const cleaned = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@import[^;]+;/gi, '')
    .replace(/@charset[^;]+;/gi, '');

  const out: string[] = [];
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(cleaned)) !== null) {
    const selectorRaw = match[1].trim();
    const bodyRaw = match[2].trim();
    if (!selectorRaw || !bodyRaw || selectorRaw.startsWith('@')) continue;

    const safeBody = sanitizeInlineStyle(bodyRaw, false);
    if (!safeBody) continue;

    const scopedSelectors = selectorRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && !/^(?:html|body|\*|:root)$/i.test(s))
      .map((s) => {
        const cleanSel = s.replace(/^(?:html|body)\s+/i, '');
        return `.sd-doc-sheet ${cleanSel}`;
      });

    if (scopedSelectors.length > 0) {
      out.push(`${scopedSelectors.join(', ')} { ${safeBody} }`);
    }
  }

  return out.join('\n');
}

function isSafeUrl(url: string, allowDataImage = false): boolean {
  const clean = url.trim();
  if (!clean) return false;
  if (/^https?:\/\//i.test(clean) || /^mailto:/i.test(clean)) return true;
  if (allowDataImage && /^data:image\/[a-z0-9.+-]+;base64,/i.test(clean)) {
    return true;
  }
  return false;
}

/**
 * Sanitizes document HTML on the client using DOMParser while preserving exact visual styles.
 */
export function sanitizeDocumentHtml(rawHtml: string, baseUrl?: string): string {
  const input = String(rawHtml || '').trim();
  if (!input) return '';

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(input, 'text/html');

    // Collect and scope safe <style> blocks (e.g. from Google Docs export HTML)
    const styleChunks: string[] = [];
    doc.querySelectorAll('style').forEach((styleEl) => {
      const scoped = scopeStylesheetText(styleEl.textContent || '');
      if (scoped) styleChunks.push(scoped);
      styleEl.remove();
    });

    // Remove dangerous or non-content elements
    doc
      .querySelectorAll('script, noscript, iframe, object, embed, applet, link, meta, title, form, button, input, select, textarea, svg')
      .forEach((el) => el.remove());

    // Convert <font color="..."> from contentEditable execCommand into safe <span style="color:...">
    doc.querySelectorAll('font').forEach((fontEl) => {
      const span = doc.createElement('span');
      const col = fontEl.getAttribute('color');
      const existingStyle = fontEl.getAttribute('style') || '';
      const combinedStyle = col ? `color: ${col}; ${existingStyle}` : existingStyle;
      if (combinedStyle.trim()) span.setAttribute('style', combinedStyle.trim());
      while (fontEl.firstChild) span.appendChild(fontEl.firstChild);
      fontEl.replaceWith(span);
    });

    const resolveUrl = (raw: string): string => {
      const trimmed = raw.trim();
      if (!baseUrl || /^https?:|^mailto:|^data:/i.test(trimmed)) return trimmed;
      try {
        return new URL(trimmed, baseUrl).toString();
      } catch {
        return trimmed;
      }
    };

    const cleanElement = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        // Unwrap unknown containers cleanly while preserving child nodes
        const parent = el.parentNode;
        if (parent) {
          while (el.firstChild) {
            const child = el.firstChild;
            parent.insertBefore(child, el);
            if (child.nodeType === Node.ELEMENT_NODE) {
              cleanElement(child as Element);
            }
          }
          parent.removeChild(el);
        }
        return;
      }

      const clsList = (el.getAttribute('class') || '')
        .split(/\s+/)
        .map((c) => c.trim())
        .filter(Boolean);
      const isPdfEl =
        clsList.includes('sd-pdf-page') ||
        clsList.includes('sd-pdf-span');

      // Preserve class names that match scoped stylesheet rules or known safe classes
      const hasScopedStyles = styleChunks.length > 0;
      const keptClasses = hasScopedStyles
        ? clsList.filter((c) => /^[a-zA-Z0-9_-]{1,32}$/.test(c))
        : clsList.filter((c) => ALLOWED_CLASSES.has(c));

      const rawStyle = el.getAttribute('style') || '';
      const safeStyle = rawStyle ? sanitizeInlineStyle(rawStyle, isPdfEl) : '';
      const colspan = tag === 'td' || tag === 'th' ? el.getAttribute('colspan') : null;
      const rowspan = tag === 'td' || tag === 'th' ? el.getAttribute('rowspan') : null;
      const align = el.getAttribute('align');
      const href = tag === 'a' ? resolveUrl(el.getAttribute('href') || '') : '';
      const src = tag === 'img' ? resolveUrl(el.getAttribute('src') || '') : '';
      const alt = tag === 'img' ? el.getAttribute('alt') || '' : '';

      // Wipe all existing attributes (including on* event handlers)
      for (const attr of Array.from(el.attributes)) {
        el.removeAttribute(attr.name);
      }

      if (keptClasses.length > 0) el.setAttribute('class', keptClasses.join(' '));
      if (safeStyle) el.setAttribute('style', safeStyle);
      if (colspan && /^\d{1,2}$/.test(colspan)) el.setAttribute('colspan', colspan);
      if (rowspan && /^\d{1,2}$/.test(rowspan)) el.setAttribute('rowspan', rowspan);
      if (align && /^(left|center|right|justify)$/i.test(align) && !safeStyle.includes('text-align')) {
        el.setAttribute('style', `${safeStyle ? `${safeStyle}; ` : ''}text-align: ${align.toLowerCase()}`);
      }
      if (tag === 'a' && isSafeUrl(href, false)) {
        el.setAttribute('href', href);
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      if (tag === 'img') {
        if (isSafeUrl(src, true)) {
          el.setAttribute('src', src);
          if (alt) el.setAttribute('alt', alt);
        } else {
          el.remove();
          return;
        }
      }

      for (const child of Array.from(el.children)) {
        cleanElement(child);
      }
    };

    for (const child of Array.from(doc.body.children)) {
      cleanElement(child);
    }

    const bodyHtml = doc.body.innerHTML.trim();
    if (!bodyHtml) return '';
    return styleChunks.length > 0
      ? `<style>${styleChunks.join('\n')}</style>\n${bodyHtml}`
      : bodyHtml;
  } catch {
    return '';
  }
}

/**
 * Checks whether clipboard or uploaded HTML actually carries meaningful visual formatting
 * (headings, tables, lists, bold/italic/underline, colors, highlights, alignment) vs plain editor wrappers.
 */
export function isRichFormattedHtml(html: string): boolean {
  const s = String(html || '').trim();
  if (!s) return false;
  return /<(?:h[1-6]|table|thead|tbody|tr|th|td|ul|ol|li|blockquote|b|strong|i|em|u|s|mark|img)\b|style\s*=\s*["'][^"']*(?:color|background|font-size|font-weight|font-style|text-align|text-decoration)/i.test(
    s
  );
}
