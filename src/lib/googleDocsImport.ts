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

interface DocsTextStyle {
  bold?: boolean;
  italic?: boolean;
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

  for (const block of content) {
    if (block.paragraph) {
      const formatted = formatParagraphRuns(block.paragraph.elements);
      if (!formatted) continue;

      const styleType = block.paragraph.paragraphStyle?.namedStyleType || 'NORMAL_TEXT';
      const bullet = block.paragraph.bullet;
      const plain = formatted.replace(/\*\*/g, '').trim();

      if (styleType === 'TITLE' || styleType === 'HEADING_1') {
        lines.push(`# ${plain}`);
        continue;
      }
      if (styleType === 'SUBTITLE' || styleType === 'HEADING_2') {
        lines.push(`## ${plain}`);
        continue;
      }
      if (
        styleType === 'HEADING_3' ||
        styleType === 'HEADING_4' ||
        styleType === 'HEADING_5' ||
        styleType === 'HEADING_6'
      ) {
        lines.push(`### ${plain}`);
        continue;
      }

      if (bullet) {
        const level = Math.min(3, Math.max(0, Number(bullet.nestingLevel || 0)));
        const listDef = bullet.listId ? lists[bullet.listId] : undefined;
        const glyphType =
          listDef?.listProperties?.nestingLevels?.[level]?.glyphType || '';
        const isOrdered = /DECIMAL|ALPHA|ROMAN/i.test(glyphType);
        const indent = level > 0 ? '  '.repeat(level) : '';
        const prefix = isOrdered ? '1. ' : '- ';
        lines.push(`${indent}${prefix}${formatted}`);
        continue;
      }

      lines.push(formatted);
    } else if (block.table?.tableRows?.length) {
      const rows: string[][] = [];
      for (const tr of block.table.tableRows) {
        const cells = (tr.tableCells || []).map((tc) => {
          const cellTexts = (tc.content || [])
            .map((el) => (el.paragraph ? formatParagraphRuns(el.paragraph.elements) : ''))
            .filter(Boolean);
          return cellTexts.join('; ').replace(/\|/g, '/').trim();
        });
        if (cells.some(Boolean)) rows.push(cells);
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
      }
    }
  }

  return {
    docId: String(docJson.documentId || ''),
    title,
    markdown: lines.join('\n'),
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
