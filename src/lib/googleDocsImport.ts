import {
  GoogleAuthProvider,
  onAuthStateChanged,
  reauthenticateWithPopup,
  signInWithPopup,
  User,
} from 'firebase/auth';
import { auth, GOOGLE_DOCS_SCOPES, googleDocsProvider } from '../firebase';

export interface GoogleDocListItem {
  id: string;
  name: string;
  modifiedTime: string;
  webViewLink?: string;
}

export interface ImportedGoogleDocResult {
  docId: string;
  title: string;
  markdown: string;
  html: string;
}

// In-memory access token cache ONLY (never stored in localStorage/sessionStorage)
let cachedGoogleDocsToken: string | null = null;
let isSigningIn = false;

export function initGoogleDocsAuth(
  onStatusChange?: (state: { user: User | null; hasToken: boolean }) => void
): () => void {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedGoogleDocsToken = null;
      onStatusChange?.({ user: null, hasToken: false });
      return;
    }
    if (cachedGoogleDocsToken) {
      onStatusChange?.({ user, hasToken: true });
    } else if (!isSigningIn) {
      cachedGoogleDocsToken = null;
      onStatusChange?.({ user, hasToken: false });
    }
  });
}

export function getGoogleDocsAccessToken(): string | null {
  return cachedGoogleDocsToken;
}

export function clearGoogleDocsAccessToken(): void {
  cachedGoogleDocsToken = null;
}

function buildGoogleDocsAuthProvider(loginHint?: string | null): GoogleAuthProvider {
  if (!loginHint) return googleDocsProvider;
  const scoped = new GoogleAuthProvider();
  for (const scope of GOOGLE_DOCS_SCOPES) {
    scoped.addScope(scope);
  }
  scoped.setCustomParameters({
    login_hint: loginHint,
    prompt: 'consent select_account',
  });
  return scoped;
}

function formatGoogleDocsOAuthError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code || '';
  const msg = err instanceof Error ? err.message : String(err || '');

  if (code === 'auth/popup-blocked') {
    return 'Browser blocked the Google sign-in popup. Allow popups for this site, or paste a link-shared Google Docs URL directly below!';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google Docs sign-in was cancelled. You can also paste a link-shared Google Docs URL directly without signing in.';
  }
  if (code === 'auth/user-mismatch') {
    return 'You chose a different Google account than the one currently signed into StudyDeck. Pick your StudyDeck Google account, or share the doc ("Anyone with the link") and paste its URL below.';
  }
  if (code === 'auth/unauthorized-domain' || /unauthorized-domain|redirect_uri_mismatch/i.test(msg)) {
    return 'Google Docs OAuth is not authorized on this preview domain. Workaround: set your Doc to "Anyone with the link" and paste its URL below, or download it as .docx / .md and use Upload File.';
  }
  if (/access_denied|unverified|403|disabled|not enabled/i.test(msg)) {
    return 'Google Docs / Drive OAuth permission was declined or not enabled on this project. Workaround: paste a link-shared Google Docs URL below, or download as .docx / .md!';
  }
  return msg || 'Google Docs sign-in failed. You can still paste a link-shared Google Docs URL below.';
}

export async function signInWithGoogleDocs(): Promise<{
  user: User;
  accessToken: string;
}> {
  isSigningIn = true;
  try {
    const existingUser =
      auth.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser : null;
    const provider = buildGoogleDocsAuthProvider(existingUser?.email);
    const result = existingUser
      ? await reauthenticateWithPopup(existingUser, provider)
      : await signInWithPopup(auth, provider);

    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error(
        'Could not obtain Google Docs read permission. Make sure you ticked the Docs/Drive checkboxes, or paste a link-shared Doc URL below.'
      );
    }
    cachedGoogleDocsToken = credential.accessToken;
    return {
      user: result.user,
      accessToken: cachedGoogleDocsToken,
    };
  } catch (err) {
    throw new Error(formatGoogleDocsOAuthError(err));
  } finally {
    isSigningIn = false;
  }
}

export function extractGoogleDocId(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const urlMatch = raw.match(/\/document\/d\/([a-zA-Z0-9_-]{15,})/);
  if (urlMatch) return urlMatch[1];
  const openMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]{15,})/);
  if (openMatch) return openMatch[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(raw)) return raw;
  return null;
}

export async function listGoogleDocsFiles(searchQuery = ''): Promise<GoogleDocListItem[]> {
  const token = cachedGoogleDocsToken;
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  const escaped = searchQuery.trim().replace(/'/g, "\\'");
  const qParts = [
    "mimeType='application/vnd.google-apps.document'",
    'trashed=false',
  ];
  if (escaped) {
    qParts.push(`name contains '${escaped}'`);
  }

  const params = new URLSearchParams({
    q: qParts.join(' and '),
    fields: 'files(id,name,modifiedTime,webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: '25',
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401 || res.status === 403) {
    cachedGoogleDocsToken = null;
    throw new Error('AUTH_REQUIRED');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Google Drive request failed (${res.status}).`);
  }

  const data = (await res.json()) as { files?: GoogleDocListItem[] };
  return Array.isArray(data.files) ? data.files : [];
}

interface DocsRgbColor {
  red?: number;
  green?: number;
  blue?: number;
}

interface DocsOptionalColor {
  color?: {
    rgbColor?: DocsRgbColor;
  };
}

interface DocsTextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  baselineOffset?: string;
  foregroundColor?: DocsOptionalColor;
  backgroundColor?: DocsOptionalColor;
  fontSize?: { magnitude?: number; unit?: string };
  weightedFontFamily?: { fontFamily?: string };
  link?: { url?: string };
}

interface DocsParagraphElement {
  textRun?: {
    content?: string;
    textStyle?: DocsTextStyle;
  };
}

interface DocsStructuralElement {
  paragraph?: {
    elements?: DocsParagraphElement[];
    paragraphStyle?: {
      namedStyleType?: string;
      alignment?: string;
      indentStart?: { magnitude?: number; unit?: string };
      shading?: { backgroundColor?: DocsOptionalColor };
    };
    bullet?: {
      listId?: string;
      nestingLevel?: number;
    };
  };
  table?: {
    tableRows?: Array<{
      tableCells?: Array<{
        content?: DocsStructuralElement[];
        tableCellStyle?: {
          backgroundColor?: DocsOptionalColor;
          contentAlignment?: string;
        };
      }>;
    }>;
  };
}

interface DocsListDefinition {
  listProperties?: {
    nestingLevels?: Array<{
      glyphType?: string;
    }>;
  };
}

function escapeDocsHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function docsColorToCss(opt?: DocsOptionalColor): string | null {
  const rgb = opt?.color?.rgbColor;
  if (!rgb) return null;
  const r = Math.round((rgb.red || 0) * 255);
  const g = Math.round((rgb.green || 0) * 255);
  const b = Math.round((rgb.blue || 0) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function formatParagraphRunsHtml(elements: DocsParagraphElement[] | undefined): string {
  if (!elements?.length) return '';
  let out = '';
  for (const el of elements) {
    const raw = el.textRun?.content;
    if (!raw) continue;
    const cleaned = raw.replace(/\n$/, '');
    if (!cleaned) continue;
    const st = el.textRun?.textStyle;
    let piece = escapeDocsHtml(cleaned).replace(/\u000b/g, '<br/>');
    if (st?.bold) piece = `<strong>${piece}</strong>`;
    if (st?.italic) piece = `<em>${piece}</em>`;
    if (st?.underline && !st?.link?.url) piece = `<u>${piece}</u>`;
    if (st?.strikethrough) piece = `<s>${piece}</s>`;
    if (st?.baselineOffset === 'SUPERSCRIPT') piece = `<sup>${piece}</sup>`;
    else if (st?.baselineOffset === 'SUBSCRIPT') piece = `<sub>${piece}</sub>`;

    const css: string[] = [];
    const fg = docsColorToCss(st?.foregroundColor);
    const bg = docsColorToCss(st?.backgroundColor);
    if (fg) css.push(`color: ${fg}`);
    if (bg) css.push(`background-color: ${bg}; padding: 0 2px; border-radius: 2px`);
    if (st?.fontSize?.magnitude && st.fontSize.magnitude !== 11) {
      css.push(`font-size: ${st.fontSize.magnitude}pt`);
    }
    if (st?.weightedFontFamily?.fontFamily && !/^(?:arial|roboto)$/i.test(st.weightedFontFamily.fontFamily)) {
      css.push(`font-family: "${escapeDocsHtml(st.weightedFontFamily.fontFamily)}", sans-serif`);
    }
    if (css.length > 0) {
      piece = `<span style="${css.join('; ')}">${piece}</span>`;
    }
    if (st?.link?.url && /^https?:\/\//i.test(st.link.url)) {
      piece = `<a href="${escapeDocsHtml(st.link.url)}" target="_blank" rel="noopener noreferrer">${piece}</a>`;
    }
    out += piece;
  }
  return out;
}

function formatParagraphRuns(elements: DocsParagraphElement[] | undefined): string {
  if (!elements?.length) return '';
  const merged: Array<{ text: string; bold: boolean; italic: boolean }> = [];

  for (const el of elements) {
    const raw = el.textRun?.content;
    if (!raw) continue;
    const text = raw.replace(/\u000b/g, ' ').replace(/\n/g, '');
    if (!text) continue;
    const bold = Boolean(el.textRun?.textStyle?.bold);
    const italic = Boolean(el.textRun?.textStyle?.italic);
    const prev = merged[merged.length - 1];
    if (prev && prev.bold === bold && prev.italic === italic) {
      prev.text += text;
    } else {
      merged.push({ text, bold, italic });
    }
  }

  return merged
    .map((seg) => {
      if (!seg.text.trim()) return seg.text;
      const lead = seg.text.match(/^\s*/)?.[0] || '';
      const trail = seg.text.match(/\s*$/)?.[0] || '';
      const core = seg.text.trim();
      if (seg.bold && seg.italic) return `${lead}***${core}***${trail}`;
      if (seg.bold) return `${lead}**${core}**${trail}`;
      if (seg.italic) return `${lead}*${core}*${trail}`;
      return seg.text;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function convertGoogleDocJsonToMarkdown(docJson: {
  documentId?: string;
  title?: string;
  body?: { content?: DocsStructuralElement[] };
  lists?: Record<string, DocsListDefinition>;
}): ImportedGoogleDocResult {
  const title = String(docJson.title || 'Google Doc').trim();
  const content = docJson.body?.content || [];
  const lists = docJson.lists || {};
  const lines: string[] = [];
  const htmlParts: string[] = [];
  let activeListTag: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (activeListTag) {
      htmlParts.push(`</${activeListTag}>`);
      activeListTag = null;
    }
  };

  const buildParaStyleAttr = (ps?: NonNullable<DocsStructuralElement['paragraph']>['paragraphStyle'], isList = false): string => {
    if (!ps) return '';
    const css: string[] = [];
    if (ps.alignment === 'CENTER') css.push('text-align: center');
    else if (ps.alignment === 'END') css.push('text-align: right');
    else if (ps.alignment === 'JUSTIFIED') css.push('text-align: justify');
    if (!isList && ps.indentStart?.magnitude && ps.indentStart.magnitude > 0) {
      css.push(`margin-left: ${Math.min(160, Math.round(ps.indentStart.magnitude * 1.3))}px`);
    }
    const bg = docsColorToCss(ps.shading?.backgroundColor);
    if (bg) css.push(`background-color: ${bg}; padding: 8px 12px; border-radius: 6px`);
    return css.length > 0 ? ` style="${css.join('; ')}"` : '';
  };

  for (const block of content) {
    if (block.paragraph) {
      const formatted = formatParagraphRuns(block.paragraph.elements);
      const htmlInner = formatParagraphRunsHtml(block.paragraph.elements);
      if (!formatted && !htmlInner.trim()) continue;

      const ps = block.paragraph.paragraphStyle;
      const styleType = ps?.namedStyleType || 'NORMAL_TEXT';
      const bullet = block.paragraph.bullet;
      const plain = formatted.replace(/\*\*/g, '').trim();
      const pStyleAttr = buildParaStyleAttr(ps, Boolean(bullet));

      if (styleType === 'TITLE' || styleType === 'HEADING_1') {
        closeList();
        lines.push(`# ${plain}`);
        htmlParts.push(`<h1${pStyleAttr}>${htmlInner}</h1>`);
        continue;
      }
      if (styleType === 'SUBTITLE' || styleType === 'HEADING_2') {
        closeList();
        lines.push(`## ${plain}`);
        htmlParts.push(`<h2${pStyleAttr}>${htmlInner}</h2>`);
        continue;
      }
      if (
        styleType === 'HEADING_3' ||
        styleType === 'HEADING_4' ||
        styleType === 'HEADING_5' ||
        styleType === 'HEADING_6'
      ) {
        closeList();
        lines.push(`### ${plain}`);
        const lvl = styleType === 'HEADING_3' ? 3 : 4;
        htmlParts.push(`<h${lvl}${pStyleAttr}>${htmlInner}</h${lvl}>`);
        continue;
      }

      if (bullet) {
        const level = Math.min(3, Math.max(0, Number(bullet.nestingLevel || 0)));
        const listDef = bullet.listId ? lists[bullet.listId] : undefined;
        const glyphType =
          listDef?.listProperties?.nestingLevels?.[level]?.glyphType || '';
        const isOrdered = /DECIMAL|ALPHA|ROMAN/i.test(glyphType);
        const listTag: 'ul' | 'ol' = isOrdered ? 'ol' : 'ul';
        if (activeListTag && activeListTag !== listTag) {
          closeList();
        }
        if (!activeListTag) {
          htmlParts.push(`<${listTag}>`);
          activeListTag = listTag;
        }
        const indent = level > 0 ? '  '.repeat(level) : '';
        const prefix = isOrdered ? '1. ' : '- ';
        lines.push(`${indent}${prefix}${formatted}`);
        const liStyle = level > 0 ? ` style="margin-left: ${level * 22}px"` : '';
        htmlParts.push(`<li${liStyle}>${htmlInner}</li>`);
        continue;
      }

      closeList();
      lines.push(formatted);
      htmlParts.push(`<p${pStyleAttr}>${htmlInner}</p>`);
    } else if (block.table?.tableRows?.length) {
      closeList();
      const rows: string[][] = [];
      const htmlRows: string[] = [];

      for (let rIdx = 0; rIdx < block.table.tableRows.length; rIdx++) {
        const tr = block.table.tableRows[rIdx];
        const cellPlainRow: string[] = [];
        const cellHtmlPieces: string[] = [];
        const tag = rIdx === 0 ? 'th' : 'td';

        for (const tc of tr.tableCells || []) {
          const cellBg = docsColorToCss(tc.tableCellStyle?.backgroundColor);
          const vAlign =
            tc.tableCellStyle?.contentAlignment === 'MIDDLE'
              ? 'middle'
              : tc.tableCellStyle?.contentAlignment === 'BOTTOM'
              ? 'bottom'
              : '';
          const tcCss: string[] = [];
          if (cellBg) tcCss.push(`background-color: ${cellBg}`);
          if (vAlign) tcCss.push(`vertical-align: ${vAlign}`);
          const tcStyleAttr = tcCss.length > 0 ? ` style="${tcCss.join('; ')}"` : '';

          const cellTexts = (tc.content || [])
            .map((el) => (el.paragraph ? formatParagraphRuns(el.paragraph.elements) : ''))
            .filter(Boolean);
          const cellParasHtml = (tc.content || [])
            .map((el) => {
              if (!el.paragraph) return '';
              const h = formatParagraphRunsHtml(el.paragraph.elements);
              if (!h.trim()) return '';
              const sAttr = buildParaStyleAttr(el.paragraph.paragraphStyle, false);
              return `<p${sAttr}>${h}</p>`;
            })
            .filter(Boolean);

          cellPlainRow.push(cellTexts.join('; ').replace(/\|/g, '/').trim());
          cellHtmlPieces.push(`<${tag}${tcStyleAttr}>${cellParasHtml.join('') || '&nbsp;'}</${tag}>`);
        }

        if (cellPlainRow.some(Boolean) || cellHtmlPieces.length > 0) {
          rows.push(cellPlainRow);
          htmlRows.push(`<tr>${cellHtmlPieces.join('')}</tr>`);
        }
      }

      if (rows.length > 0) {
        const colCount = rows.reduce((m, r) => Math.max(m, r.length), 1);
        if (colCount >= 2) {
          const pad = (r: string[]) =>
            `| ${Array.from({ length: colCount }, (_, i) => r[i] || '').join(' | ')} |`;
          lines.push(pad(rows[0]));
          lines.push(`| ${Array.from({ length: colCount }, () => '---').join(' | ')} |`);
          for (let i = 1; i < rows.length; i++) {
            lines.push(pad(rows[i]));
          }
        } else {
          rows.forEach((r) => {
            if (r[0]) lines.push(`- ${r[0]}`);
          });
        }
        htmlParts.push(`<table><tbody>${htmlRows.join('')}</tbody></table>`);
      }
    }
  }
  closeList();

  return {
    docId: String(docJson.documentId || ''),
    title,
    markdown: lines.join('\n'),
    html: htmlParts.length > 0 ? `<div class="word-doc">${htmlParts.join('')}</div>` : '',
  };
}

export async function fetchGoogleDocById(docIdOrUrl: string): Promise<ImportedGoogleDocResult> {
  const token = cachedGoogleDocsToken;
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  const docId = extractGoogleDocId(docIdOrUrl);
  if (!docId) {
    throw new Error('Enter a valid Google Docs URL or document ID.');
  }

  const res = await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    cachedGoogleDocsToken = null;
    throw new Error('AUTH_REQUIRED');
  }
  if (res.status === 403) {
    throw new Error('Permission denied. Re-connect Google Docs or make sure your account has view access.');
  }
  if (res.status === 404) {
    throw new Error('Google Doc not found.');
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || `Google Docs API returned ${res.status}.`);
  }

  const json = (await res.json()) as Parameters<typeof convertGoogleDocJsonToMarkdown>[0];
  return convertGoogleDocJsonToMarkdown(json);
}
