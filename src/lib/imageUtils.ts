export type NoteImageWidth = 'compact' | 'medium' | 'wide' | 'full';

export interface NoteImageData {
  src: string;
  caption?: string;
  width?: NoteImageWidth;
}

const VALID_WIDTHS = new Set<NoteImageWidth>(['compact', 'medium', 'wide', 'full']);

export function isSafeImageSrc(src: string): boolean {
  const s = String(src || '').trim();
  if (!s) return false;
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(s) || /^https?:\/\//i.test(s);
}

export function encodeNoteImagePoint(img: NoteImageData): string {
  const payload: NoteImageData = {
    src: String(img.src || '').trim(),
  };
  const cleanCaption = img.caption?.trim();
  if (cleanCaption) {
    payload.caption = cleanCaption;
  }
  if (img.width && VALID_WIDTHS.has(img.width) && img.width !== 'wide') {
    payload.width = img.width;
  }
  return `@image:${JSON.stringify(payload)}`;
}

export function parseNoteImagePoint(raw: string): NoteImageData | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  if (/^@image:\s*\{/i.test(trimmed)) {
    const jsonPart = trimmed.replace(/^@image:\s*/i, '');
    try {
      const parsed = JSON.parse(jsonPart) as {
        src?: unknown;
        caption?: unknown;
        width?: unknown;
      };
      if (typeof parsed.src !== 'string' || !isSafeImageSrc(parsed.src)) {
        return null;
      }
      const width =
        typeof parsed.width === 'string' && VALID_WIDTHS.has(parsed.width as NoteImageWidth)
          ? (parsed.width as NoteImageWidth)
          : 'wide';
      const caption = typeof parsed.caption === 'string' ? parsed.caption.trim() : undefined;
      return {
        src: parsed.src.trim(),
        ...(caption ? { caption } : {}),
        width,
      };
    } catch {
      return null;
    }
  }

  // Standard Markdown image line: ![caption](src)
  const mdMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
  if (mdMatch && isSafeImageSrc(mdMatch[2])) {
    const caption = mdMatch[1].trim();
    return {
      src: mdMatch[2].trim(),
      ...(caption ? { caption } : {}),
      width: 'wide',
    };
  }

  return null;
}

export function isNoteImagePoint(raw: string): boolean {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return false;
  if (!trimmed.startsWith('@image:') && !trimmed.startsWith('![')) return false;
  return Boolean(parseNoteImagePoint(trimmed));
}

export function extractClipboardImageFiles(dt: DataTransfer | null | undefined): File[] {
  if (!dt) return [];
  const files: File[] = [];
  const seen = new Set<string>();

  const pushFile = (f: File | null) => {
    if (!f) return;
    if (!f.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)) {
      return;
    }
    const sig = `${f.name}::${f.size}::${f.type}`;
    if (seen.has(sig)) return;
    seen.add(sig);
    files.push(f);
  };

  if (dt.items) {
    for (let i = 0; i < dt.items.length; i++) {
      const item = dt.items[i];
      if (item.kind === 'file' && (item.type.startsWith('image/') || !item.type)) {
        pushFile(item.getAsFile());
      }
    }
  }
  if (dt.files) {
    for (let i = 0; i < dt.files.length; i++) {
      pushFile(dt.files[i]);
    }
  }
  return files;
}

export function extractHtmlImageSrcs(html: string): string[] {
  if (!html || !/<img\b/i.test(html)) return [];
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const out: string[] = [];
    doc.querySelectorAll('img').forEach((img) => {
      const src = (img.getAttribute('src') || '').trim();
      if (isSafeImageSrc(src)) {
        out.push(src);
      }
    });
    return out;
  } catch {
    return [];
  }
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(blob);
  });
}

function loadImageDimensions(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = url;
  });
}

export async function fileToOptimizedDataUrl(
  blob: Blob,
  opts?: { maxWidth?: number; maxHeight?: number; quality?: number }
): Promise<{ dataUrl: string; width: number; height: number }> {
  const maxWidth = opts?.maxWidth ?? 1350;
  const maxHeight = opts?.maxHeight ?? 1550;
  const quality = opts?.quality ?? 0.82;

  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await loadImageDimensions(objectUrl);
    const natW = Math.max(1, img.naturalWidth || img.width || 1);
    const natH = Math.max(1, img.naturalHeight || img.height || 1);

    // Keep compact crisp PNG/GIF/WebP files verbatim when already within bounds
    if (
      blob.size <= 110 * 1024 &&
      natW <= maxWidth &&
      natH <= maxHeight &&
      (blob.type === 'image/png' || blob.type === 'image/gif' || blob.type === 'image/webp')
    ) {
      const dataUrl = await readBlobAsDataUrl(blob);
      if (isSafeImageSrc(dataUrl)) {
        return { dataUrl, width: natW, height: natH };
      }
    }

    const ratio = Math.min(1, maxWidth / natW, maxHeight / natH);
    let targetW = Math.max(1, Math.round(natW * ratio));
    let targetH = Math.max(1, Math.round(natH * ratio));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      const fallbackUrl = await readBlobAsDataUrl(blob);
      return { dataUrl: fallbackUrl, width: natW, height: natH };
    }

    ctx.drawImage(img, 0, 0, targetW, targetH);

    // Prefer WebP (preserves alpha + tiny payloads); fallback to JPEG on white if unsupported
    let dataUrl = canvas.toDataURL('image/webp', quality);
    if (!dataUrl.startsWith('data:image/webp')) {
      const jpgCanvas = document.createElement('canvas');
      jpgCanvas.width = targetW;
      jpgCanvas.height = targetH;
      const jpgCtx = jpgCanvas.getContext('2d');
      if (jpgCtx) {
        jpgCtx.fillStyle = '#ffffff';
        jpgCtx.fillRect(0, 0, targetW, targetH);
        jpgCtx.drawImage(img, 0, 0, targetW, targetH);
        dataUrl = jpgCanvas.toDataURL('image/jpeg', quality);
      }
    }

    // Extra pass if output is still unusually large (> 310 KB) so Community Share stays well under 400 KB
    if (dataUrl.length > 310 * 1024) {
      targetW = Math.max(320, Math.round(targetW * 0.72));
      targetH = Math.max(320, Math.round(targetH * 0.72));
      canvas.width = targetW;
      canvas.height = targetH;
      const smallCtx = canvas.getContext('2d');
      if (smallCtx) {
        smallCtx.drawImage(img, 0, 0, targetW, targetH);
        const compressed = canvas.toDataURL('image/webp', 0.74);
        if (compressed.startsWith('data:image/webp')) {
          dataUrl = compressed;
        }
      }
    }

    return { dataUrl, width: targetW, height: targetH };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function stripImageDataFromText(text: string): string {
  return String(text || '')
    .split('\n')
    .filter((line) => !isNoteImagePoint(line))
    .join('\n')
    .replace(/<img\b[^>]*>/gi, ' ')
    .replace(/data:image\/[^"'\s)]+/gi, '');
}
