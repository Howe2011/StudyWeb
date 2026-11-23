import { CSSProperties, Fragment, ReactNode } from 'react';
import { normalizeStudySymbols } from './noteSymbols';
import { parseMathSegments, renderKatexToHtml } from './latexRenderer';

export interface ColorSwatchOption {
  id: string;
  label: string;
  value: string;
  preview: string;
}

export const NOTE_TEXT_COLORS: ColorSwatchOption[] = [
  { id: 'default', label: 'Default Ink', value: '', preview: 'var(--ink)' },
  { id: 'blue', label: 'Cobalt Blue', value: '#2563EB', preview: '#2563EB' },
  { id: 'sky', label: 'Sky Blue', value: '#0284C7', preview: '#0284C7' },
  { id: 'green', label: 'Emerald', value: '#16A34A', preview: '#16A34A' },
  { id: 'teal', label: 'Teal', value: '#0D9488', preview: '#0D9488' },
  { id: 'purple', label: 'Violet', value: '#7C3AED', preview: '#7C3AED' },
  { id: 'amber', label: 'Amber', value: '#D97706', preview: '#D97706' },
  { id: 'crimson', label: 'Crimson', value: '#DC2626', preview: '#DC2626' },
  { id: 'rose', label: 'Rose', value: '#E11D48', preview: '#E11D48' },
  { id: 'muted', label: 'Muted Slate', value: '#64748B', preview: '#64748B' },
];

export const NOTE_HIGHLIGHT_COLORS: ColorSwatchOption[] = [
  { id: 'none', label: 'No Highlight', value: '', preview: 'transparent' },
  { id: 'yellow', label: 'Sun Yellow', value: 'rgba(253, 224, 71, 0.78)', preview: '#FDE047' },
  { id: 'green', label: 'Mint Green', value: 'rgba(134, 239, 172, 0.74)', preview: '#86EFAC' },
  { id: 'blue', label: 'Ice Blue', value: 'rgba(125, 211, 252, 0.74)', preview: '#7DD3FC' },
  { id: 'purple', label: 'Soft Lavender', value: 'rgba(216, 180, 254, 0.74)', preview: '#D8B4FE' },
  { id: 'rose', label: 'Warm Rose', value: 'rgba(253, 164, 175, 0.76)', preview: '#FDA4AF' },
  { id: 'orange', label: 'Apricot', value: 'rgba(253, 186, 116, 0.76)', preview: '#FDBA74' },
];

export const NOTE_SURFACE_COLORS: Array<{
  id: string;
  label: string;
  swatch: string;
}> = [
  { id: 'default', label: 'Theme', swatch: 'var(--note-accent, var(--e3))' },
  { id: 'blue', label: 'Blue', swatch: '#2563EB' },
  { id: 'green', label: 'Green', swatch: '#16A34A' },
  { id: 'purple', label: 'Purple', swatch: '#7C3AED' },
  { id: 'amber', label: 'Amber', swatch: '#D97706' },
  { id: 'rose', label: 'Rose', swatch: '#E11D48' },
  { id: 'teal', label: 'Teal', swatch: '#0D9488' },
  { id: 'slate', label: 'Slate', swatch: '#475569' },
];

const SURFACE_HEX_MAP: Record<string, string> = {
  blue: '#2563EB',
  green: '#16A34A',
  purple: '#7C3AED',
  amber: '#D97706',
  rose: '#E11D48',
  teal: '#0D9488',
  slate: '#475569',
};

export function sanitizeCssColor(raw?: string): string | null {
  const val = String(raw || '').trim();
  if (!val) return null;
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(val)) return val;
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(val)) {
    return val;
  }
  return null;
}

export function resolveSurfaceAccentHex(color?: string): string | null {
  const raw = String(color || '').trim().toLowerCase();
  if (!raw || raw === 'default') return null;
  if (SURFACE_HEX_MAP[raw]) return SURFACE_HEX_MAP[raw];
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  return null;
}

export function getTableSurfaceStyles(color?: string): {
  isCustom: boolean;
  accentHex?: string;
  wrapperStyle?: CSSProperties;
  theadStyle?: CSSProperties;
  zebraStyle?: CSSProperties;
  firstColStyle?: CSSProperties;
  boxStyle?: CSSProperties;
  boxTitleStyle?: CSSProperties;
} {
  const hex = resolveSurfaceAccentHex(color);
  if (!hex) return { isCustom: false };

  return {
    isCustom: true,
    accentHex: hex,
    wrapperStyle: {
      borderColor: `color-mix(in srgb, ${hex} 32%, var(--line))`,
    },
    theadStyle: {
      borderBottomColor: `color-mix(in srgb, ${hex} 46%, var(--line))`,
      backgroundColor: `color-mix(in srgb, ${hex} 14%, var(--card))`,
    },
    zebraStyle: {
      backgroundColor: `color-mix(in srgb, ${hex} 5%, var(--card))`,
    },
    firstColStyle: {
      color: `color-mix(in srgb, ${hex} 52%, var(--ink))`,
    },
    boxStyle: {
      borderColor: `color-mix(in srgb, ${hex} 34%, var(--line))`,
      backgroundColor: `color-mix(in srgb, ${hex} 8%, var(--card))`,
    },
    boxTitleStyle: {
      color: hex,
    },
  };
}

function isOpaqueLightColor(color: string): boolean {
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.55;
  }
  const rgba = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (rgba) {
    const r = Number(rgba[1]);
    const g = Number(rgba[2]);
    const b = Number(rgba[3]);
    const a = rgba[4] !== undefined ? Number(rgba[4]) : 1;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.58 && a >= 0.45;
  }
  return false;
}

const INLINE_TOKEN_RE =
  /(<span\s+style="color:\s*([^";]+)\s*">([\s\S]*?)<\/span>|<mark(?:\s+style="background-color:\s*([^";]+)\s*")?>([\s\S]*?)<\/mark>|==([^=\n]+)==|<u>([\s\S]*?)<\/u>|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`|~~([^~\n]+)~~|<(?:del|s)>([\s\S]*?)<\/(?:del|s)>|<sup>([\s\S]*?)<\/sup>|\^([^^ \t\n]+)\^|<sub>([\s\S]*?)<\/sub>|~([^~ \t\n]+)~|\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)|<kbd>([\s\S]*?)<\/kbd>)/i;

function parseInlineNodes(input: string, keyPrefix: string, depth = 0): ReactNode[] {
  if (!input) return [];
  if (depth > 6) return [<Fragment key={`${keyPrefix}_end`}>{input}</Fragment>];

  const out: ReactNode[] = [];
  let remaining = input;
  let idx = 0;

  while (remaining.length > 0) {
    const match = INLINE_TOKEN_RE.exec(remaining);
    if (!match) {
      out.push(<Fragment key={`${keyPrefix}_t_${idx++}`}>{remaining}</Fragment>);
      break;
    }

    if (match.index > 0) {
      out.push(
        <Fragment key={`${keyPrefix}_t_${idx++}`}>
          {remaining.slice(0, match.index)}
        </Fragment>
      );
    }

    const tokenKey = `${keyPrefix}_m_${idx++}`;
    if (match[2] !== undefined && match[3] !== undefined) {
      const safeColor = sanitizeCssColor(match[2]);
      const inner = parseInlineNodes(match[3], tokenKey, depth + 1);
      out.push(
        safeColor ? (
          <span key={tokenKey} style={{ color: safeColor }}>
            {inner}
          </span>
        ) : (
          <Fragment key={tokenKey}>{inner}</Fragment>
        )
      );
    } else if ((match[4] !== undefined && match[5] !== undefined) || match[6] !== undefined) {
      const bgVal = match[4] ? sanitizeCssColor(match[4]) : '#FDE047';
      const rawInner = match[5] ?? match[6] ?? '';
      const inner = parseInlineNodes(rawInner, tokenKey, depth + 1);
      out.push(
        <mark
          key={tokenKey}
          className="sd-mark-term rounded-[5px] px-1.5 py-0.5 font-bold"
          style={{
            backgroundColor: bgVal || '#FDE047',
            color: bgVal && isOpaqueLightColor(bgVal) ? '#111827' : 'inherit',
          }}
        >
          {inner}
        </mark>
      );
    } else if (match[7] !== undefined) {
      out.push(
        <u key={tokenKey} className="decoration-[var(--note-accent,var(--e3))] decoration-2 underline-offset-2">
          {parseInlineNodes(match[7], tokenKey, depth + 1)}
        </u>
      );
    } else if (match[8] !== undefined) {
      out.push(
        <strong key={tokenKey} className="sd-bold-term font-extrabold">
          {parseInlineNodes(match[8], tokenKey, depth + 1)}
        </strong>
      );
    } else if (match[9] !== undefined) {
      out.push(
        <em key={tokenKey} className="italic">
          {parseInlineNodes(match[9], tokenKey, depth + 1)}
        </em>
      );
    } else if (match[10] !== undefined) {
      out.push(
        <code
          key={tokenKey}
          className="font-mono-num rounded bg-[var(--bg)] px-1.5 py-0.5 text-[0.9em] text-[var(--note-accent,var(--e3))]"
        >
          {match[10]}
        </code>
      );
    } else if (match[11] !== undefined || match[12] !== undefined) {
      const content = match[11] ?? match[12] ?? '';
      out.push(
        <del key={tokenKey} className="line-through opacity-75 decoration-current">
          {parseInlineNodes(content, tokenKey, depth + 1)}
        </del>
      );
    } else if (match[13] !== undefined || match[14] !== undefined) {
      const content = match[13] ?? match[14] ?? '';
      out.push(
        <sup key={tokenKey} className="text-[0.78em] font-semibold">
          {parseInlineNodes(content, tokenKey, depth + 1)}
        </sup>
      );
    } else if (match[15] !== undefined || match[16] !== undefined) {
      const content = match[15] ?? match[16] ?? '';
      out.push(
        <sub key={tokenKey} className="text-[0.78em]">
          {parseInlineNodes(content, tokenKey, depth + 1)}
        </sub>
      );
    } else if (match[17] !== undefined && match[18] !== undefined) {
      const label = match[17];
      const url = match[18];
      out.push(
        <a
          key={tokenKey}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-[var(--note-accent,var(--e3))] underline decoration-1 underline-offset-2 hover:opacity-80"
        >
          {parseInlineNodes(label, tokenKey, depth + 1)}
        </a>
      );
    } else if (match[19] !== undefined) {
      out.push(
        <kbd
          key={tokenKey}
          className="font-mono-num rounded border border-[var(--line)] bg-[var(--bg)] px-1.5 py-0.5 text-[0.82em] font-bold shadow-2xs"
        >
          {match[19]}
        </kbd>
      );
    } else {
      out.push(<Fragment key={tokenKey}>{match[0]}</Fragment>);
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return out;
}

/**
 * Safely renders inline study formatting:
 * - LaTeX inline math ($...$, \(...\)) and display math ($$...$$, \[...\]) via KaTeX
 * - **bold**, *italic*, `code`, <u>underline</u>, ~~strike~~, ==highlight==
 * - <sub>/<sup>, [links](url), <kbd>
 * - <span style="color:...">, <mark style="background-color:...">
 */
export function renderRichInline(text: string): ReactNode {
  const src = normalizeStudySymbols(String(text || ''), { preserveLeadingFlowMarker: true });
  if (!src) return null;

  // First tokenize LaTeX math expressions so math syntax ($x$, \frac, ^, _) is never treated as markdown
  const mathSegments = parseMathSegments(src);
  if (mathSegments.length === 1 && mathSegments[0].type === 'text') {
    return parseInlineNodes(src, 'rich');
  }

  return (
    <>
      {mathSegments.map((seg, idx) => {
        if (seg.type === 'text') {
          return (
            <Fragment key={`seg_t_${idx}`}>
              {parseInlineNodes(seg.content, `rich_${idx}`)}
            </Fragment>
          );
        }
        if (seg.type === 'display-math') {
          const renderedHtml = renderKatexToHtml(seg.content, true);
          return (
            <span
              key={`seg_dm_${idx}`}
              className="sd-math-block my-2 block overflow-x-auto text-center"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          );
        }
        const renderedHtml = renderKatexToHtml(seg.content, false);
        return (
          <span
            key={`seg_im_${idx}`}
            className="sd-inline-math inline-block align-baseline"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        );
      })}
    </>
  );
}

/**
 * Strips inline formatting tags/markdown for clean plain-text operations (word counts, HTML export, etc.)
 */
export function stripInlineRichTags(text: string): string {
  return String(text || '')
    .replace(/<span\s+style="color:[^"]*">([\s\S]*?)<\/span>/gi, '$1')
    .replace(/<mark(?:\s+style="[^"]*")?>([\s\S]*?)<\/mark>/gi, '$1')
    .replace(/==([^=\n]+)==/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/<\/?(?:u|del|s|sub|sup|kbd)>/gi, '')
    .replace(/\[([^\]\n]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .trim();
}

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Converts our compact inline markup into HTML suitable for contentEditable initialization.
 */
export function inlineMarkupToHtml(markup: string): string {
  const src = normalizeStudySymbols(String(markup || ''), { preserveLeadingFlowMarker: true });
  if (!src) return '';

  let out = '';
  let remaining = src;

  while (remaining.length > 0) {
    const match = INLINE_TOKEN_RE.exec(remaining);
    if (!match) {
      out += escapeHtmlText(remaining).replace(/\n/g, '<br>');
      break;
    }

    if (match.index > 0) {
      out += escapeHtmlText(remaining.slice(0, match.index)).replace(/\n/g, '<br>');
    }

    if (match[2] !== undefined && match[3] !== undefined) {
      const safe = sanitizeCssColor(match[2]);
      const inner = inlineMarkupToHtml(match[3]);
      out += safe ? `<span style="color:${safe}">${inner}</span>` : inner;
    } else if ((match[4] !== undefined && match[5] !== undefined) || match[6] !== undefined) {
      const safe = match[4] ? sanitizeCssColor(match[4]) : '#FDE047';
      const rawInner = match[5] ?? match[6] ?? '';
      const inner = inlineMarkupToHtml(rawInner);
      out += safe ? `<mark style="background-color:${safe}">${inner}</mark>` : inner;
    } else if (match[7] !== undefined) {
      out += `<u>${inlineMarkupToHtml(match[7])}</u>`;
    } else if (match[8] !== undefined) {
      out += `<strong>${inlineMarkupToHtml(match[8])}</strong>`;
    } else if (match[9] !== undefined) {
      out += `<em>${inlineMarkupToHtml(match[9])}</em>`;
    } else if (match[10] !== undefined) {
      out += `<code>${escapeHtmlText(match[10])}</code>`;
    } else if (match[11] !== undefined || match[12] !== undefined) {
      const raw = match[11] ?? match[12] ?? '';
      out += `<del>${inlineMarkupToHtml(raw)}</del>`;
    } else if (match[13] !== undefined || match[14] !== undefined) {
      const raw = match[13] ?? match[14] ?? '';
      out += `<sup>${inlineMarkupToHtml(raw)}</sup>`;
    } else if (match[15] !== undefined || match[16] !== undefined) {
      const raw = match[15] ?? match[16] ?? '';
      out += `<sub>${inlineMarkupToHtml(raw)}</sub>`;
    } else if (match[17] !== undefined && match[18] !== undefined) {
      out += `<a href="${escapeHtmlText(match[18])}" target="_blank" rel="noopener noreferrer">${inlineMarkupToHtml(match[17])}</a>`;
    } else if (match[19] !== undefined) {
      out += `<kbd>${escapeHtmlText(match[19])}</kbd>`;
    } else {
      out += escapeHtmlText(match[0]);
    }

    remaining = remaining.slice(match.index + match[0].length);
  }

  return out;
}

/**
 * Normalizes a browser RGB/HEX color string to #RRGGBB hex when possible.
 */
function normalizeBrowserColorToHex(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  const shortHex = trimmed.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  if (shortHex) {
    return `#${shortHex[1]}${shortHex[1]}${shortHex[2]}${shortHex[2]}${shortHex[3]}${shortHex[3]}`.toUpperCase();
  }
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
  if (rgbMatch) {
    if (rgbMatch[4] !== undefined && Number(rgbMatch[4]) === 0) return null;
    if (rgbMatch[4] !== undefined && Number(rgbMatch[4]) < 1) {
      return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${rgbMatch[4]})`;
    }
    const toHex = (n: string) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0').toUpperCase();
    return `#${toHex(rgbMatch[1])}${toHex(rgbMatch[2])}${toHex(rgbMatch[3])}`;
  }
  return null;
}

/**
 * Serializes a contentEditable DOM element back into clean StudyDeck inline markup.
 */
export function domNodeToInlineMarkup(root: HTMLElement): string {
  const walk = (node: Node): string => {
    if (node.nodeType === 3) {
      return (node.textContent || '').replace(/\u00A0/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'br') {
      // Ignore trailing <br> inside contentEditable unless followed by content
      return el.nextSibling ? '\n' : '';
    }

    let inner = '';
    el.childNodes.forEach((child) => {
      inner += walk(child);
    });

    if (!inner && tag !== 'div' && tag !== 'p') return '';

    if (tag === 'strong' || tag === 'b') {
      return inner.trim() ? `**${inner}**` : inner;
    }
    if (tag === 'em' || tag === 'i') {
      return inner.trim() ? `*${inner}*` : inner;
    }
    if (tag === 'code') {
      return inner.trim() ? `\`${inner}\`` : inner;
    }
    if (tag === 'u') {
      return inner.trim() ? `<u>${inner}</u>` : inner;
    }
    if (tag === 'del' || tag === 's' || tag === 'strike') {
      return inner.trim() ? `~~${inner}~~` : inner;
    }
    if (tag === 'sup') {
      return inner.trim() ? `^${inner}^` : inner;
    }
    if (tag === 'sub') {
      return inner.trim() ? `~${inner}~` : inner;
    }
    if (tag === 'kbd') {
      return inner.trim() ? `<kbd>${inner}</kbd>` : inner;
    }
    if (tag === 'a') {
      const href = el.getAttribute('href') || '';
      return inner.trim() && href ? `[${inner}](${href})` : inner;
    }
    if (tag === 'mark') {
      const bg = normalizeBrowserColorToHex(el.style.backgroundColor || '');
      return bg && inner.trim() ? `<mark style="background-color:${bg}">${inner}</mark>` : inner;
    }
    if (tag === 'span' || tag === 'font') {
      let result = inner;
      const colorRaw = el.style.color || (el as HTMLFontElement).color || '';
      const bgRaw = el.style.backgroundColor || '';
      const fg = normalizeBrowserColorToHex(colorRaw);
      const bg = normalizeBrowserColorToHex(bgRaw);
      if (el.style.fontWeight === 'bold' || Number(el.style.fontWeight) >= 600) {
        result = `**${result}**`;
      }
      if (el.style.fontStyle === 'italic') {
        result = `*${result}*`;
      }
      if (el.style.textDecorationLine?.includes('underline') || el.style.textDecoration?.includes('underline')) {
        result = `<u>${result}</u>`;
      }
      if (fg && result.trim()) {
        result = `<span style="color:${fg}">${result}</span>`;
      }
      if (bg && bg !== 'transparent' && result.trim()) {
        result = `<mark style="background-color:${bg}">${result}</mark>`;
      }
      return result;
    }
    if (tag === 'div' || tag === 'p') {
      return el.previousSibling ? `\n${inner}` : inner;
    }

    return inner;
  };

  let raw = '';
  root.childNodes.forEach((child) => {
    raw += walk(child);
  });
  return raw.replace(/\n{3,}/g, '\n\n');
}
