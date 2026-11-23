export interface FloatingTimerSnapshot {
  modeLabel: string;
  subject: string;
  clockText: string;
  running: boolean;
  progress: number; // 0..1
  modeKind: 'timer' | 'pomo' | 'stopwatch';
}

export interface FloatingTimerCallbacks {
  onToggle: () => void;
  onReset: () => void;
  onAddFiveMins?: () => void;
  onLap?: () => void;
  onStatusChange?: (open: boolean, kind: 'document-pip' | 'video-pip' | null) => void;
}

interface DocumentPictureInPictureApi {
  window: Window | null;
  requestWindow: (opts?: { width?: number; height?: number; disallowReturnToOpener?: boolean }) => Promise<Window>;
}

interface ThemeColors {
  bg: string;
  card: string;
  ink: string;
  mute: string;
  line: string;
  accent: string;
  ok: string;
}

function getDocumentPip(): DocumentPictureInPictureApi | null {
  const win = window as unknown as { documentPictureInPicture?: DocumentPictureInPictureApi };
  return win.documentPictureInPicture && typeof win.documentPictureInPicture.requestWindow === 'function'
    ? win.documentPictureInPicture
    : null;
}

export function isDocumentPipSupported(): boolean {
  return Boolean(getDocumentPip());
}

export function isVideoPipSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const v = document.createElement('video');
  return Boolean(
    document.pictureInPictureEnabled &&
      typeof v.requestPictureInPicture === 'function' &&
      typeof (document.createElement('canvas') as HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream })
        .captureStream === 'function'
  );
}

function readThemeColors(): ThemeColors {
  const cs = getComputedStyle(document.documentElement);
  const pick = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: pick('--bg', '#f8fafc'),
    card: pick('--card', '#ffffff'),
    ink: pick('--ink', '#0f172a'),
    mute: pick('--mute', '#64748b'),
    line: pick('--line', '#e2e8f0'),
    accent: pick('--e3', '#2563eb'),
    ok: pick('--ok', '#16a34a'),
  };
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class FloatingTimerPipController {
  private docPipWin: Window | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private videoPipOpen = false;
  private autoOpenedOnLeave = false;
  private snapshot: FloatingTimerSnapshot = {
    modeLabel: 'Focus Timer',
    subject: 'General Study',
    clockText: '25:00',
    running: false,
    progress: 0,
    modeKind: 'timer',
  };
  private callbacks: FloatingTimerCallbacks;
  private visibilityListener: (() => void) | null = null;
  private autoFloatEnabled = false;

  constructor(callbacks: FloatingTimerCallbacks) {
    this.callbacks = callbacks;
    if (typeof document !== 'undefined') {
      this.visibilityListener = () => {
        if (document.visibilityState === 'visible') {
          if (this.autoOpenedOnLeave && document.pictureInPictureElement === this.video) {
            this.autoOpenedOnLeave = false;
            void document.exitPictureInPicture().catch(() => undefined);
          }
        } else if (
          document.visibilityState === 'hidden' &&
          this.autoFloatEnabled &&
          this.snapshot.running &&
          !this.docPipWin &&
          document.pictureInPictureElement !== this.video
        ) {
          // Ensure canvas video element is playing so browser autoPictureInPicture can engage smoothly
          if (this.video && this.video.paused) {
            void this.video.play().catch(() => undefined);
          }
        }
      };
      document.addEventListener('visibilitychange', this.visibilityListener);
    }
  }

  public setCallbacks(callbacks: FloatingTimerCallbacks) {
    this.callbacks = callbacks;
  }

  public setAutoFloat(enabled: boolean) {
    this.autoFloatEnabled = enabled;
    if (this.video) {
      (this.video as HTMLVideoElement & { autoPictureInPicture?: boolean }).autoPictureInPicture = enabled;
    }
    if (!enabled && this.video && !this.videoPipOpen && !this.video.paused) {
      this.video.pause();
    }
  }

  public isOpen(): boolean {
    return Boolean((this.docPipWin && !this.docPipWin.closed) || this.videoPipOpen);
  }

  /**
   * Call inside a user click (Start / Resume / Toggle auto-float) so Chrome/Edge permits
   * silent autoPictureInPicture playback when switching browser tabs.
   */
  public armAutoPipFromGesture() {
    if (!this.autoFloatEnabled || !isVideoPipSupported()) return;
    this.ensureVideoEngine();
    if (!this.video) return;
    (this.video as HTMLVideoElement & { autoPictureInPicture?: boolean }).autoPictureInPicture = true;
    this.renderCanvas();
    if (this.video.paused) {
      void this.video.play().catch(() => undefined);
    }
    this.bindMediaSession();
  }

  public updateSnapshot(next: FloatingTimerSnapshot) {
    this.snapshot = next;
    this.syncDocumentPipDom();
    if (this.canvas && (this.videoPipOpen || (this.autoFloatEnabled && next.running))) {
      this.renderCanvas();
    }
    if (this.autoFloatEnabled && !next.running && !this.videoPipOpen && this.video && !this.video.paused) {
      this.video.pause();
    }
  }

  public async openFloatingBox(): Promise<'document-pip' | 'video-pip' | 'unsupported'> {
    // 1. Prefer interactive Document Picture-in-Picture (Chromium 116+)
    const docPip = getDocumentPip();
    if (docPip) {
      try {
        if (this.docPipWin && !this.docPipWin.closed) {
          this.docPipWin.focus();
          return 'document-pip';
        }
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture().catch(() => undefined);
        }
        const pipWin = await docPip.requestWindow({
          width: 340,
          height: 215,
          disallowReturnToOpener: false,
        });
        this.docPipWin = pipWin;
        this.mountDocumentPip(pipWin);
        pipWin.addEventListener('pagehide', () => {
          this.docPipWin = null;
          this.callbacks.onStatusChange?.(this.videoPipOpen, this.videoPipOpen ? 'video-pip' : null);
        });
        this.callbacks.onStatusChange?.(true, 'document-pip');
        return 'document-pip';
      } catch {
        // Fall through to Canvas Video PiP
      }
    }

    // 2. Fallback: Canvas + Video Picture-in-Picture
    if (isVideoPipSupported()) {
      this.ensureVideoEngine();
      this.renderCanvas();
      if (this.video) {
        try {
          if (this.video.paused) {
            await this.video.play();
          }
          await this.video.requestPictureInPicture();
          this.videoPipOpen = true;
          this.autoOpenedOnLeave = false;
          this.bindMediaSession();
          this.callbacks.onStatusChange?.(true, 'video-pip');
          return 'video-pip';
        } catch {
          return 'unsupported';
        }
      }
    }

    return 'unsupported';
  }

  public async closeFloatingBox(): Promise<void> {
    if (this.docPipWin && !this.docPipWin.closed) {
      this.docPipWin.close();
      this.docPipWin = null;
    }
    if (typeof document !== 'undefined' && document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => undefined);
    }
    this.videoPipOpen = false;
    this.autoOpenedOnLeave = false;
    this.callbacks.onStatusChange?.(false, null);
  }

  public dispose() {
    if (this.visibilityListener && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }
    if (this.docPipWin && !this.docPipWin.closed) {
      this.docPipWin.close();
      this.docPipWin = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video.remove();
      this.video = null;
    }
    this.canvas = null;
  }

  private bindMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.setActionHandler('play', () => this.callbacks.onToggle());
      navigator.mediaSession.setActionHandler('pause', () => this.callbacks.onToggle());
    } catch {
      // ignore unsupported MediaSession handlers
    }
  }

  private ensureVideoEngine() {
    if (typeof document === 'undefined' || this.video) return;
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 200;
    this.canvas = canvas;
    this.renderCanvas();

    const capture = (
      canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }
    ).captureStream(2);
    this.stream = capture;

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = capture;
    video.style.position = 'fixed';
    video.style.width = '2px';
    video.style.height = '2px';
    video.style.bottom = '0';
    video.style.right = '0';
    video.style.opacity = '0.001';
    video.style.pointerEvents = 'none';
    (video as HTMLVideoElement & { autoPictureInPicture?: boolean }).autoPictureInPicture =
      this.autoFloatEnabled;

    video.addEventListener('enterpictureinpicture', () => {
      this.videoPipOpen = true;
      this.autoOpenedOnLeave = document.visibilityState === 'hidden';
      this.renderCanvas();
      this.callbacks.onStatusChange?.(true, 'video-pip');
    });
    video.addEventListener('leavepictureinpicture', () => {
      this.videoPipOpen = false;
      this.autoOpenedOnLeave = false;
      if (!this.autoFloatEnabled && !video.paused) {
        video.pause();
      }
      this.callbacks.onStatusChange?.(
        Boolean(this.docPipWin && !this.docPipWin.closed),
        this.docPipWin && !this.docPipWin.closed ? 'document-pip' : null
      );
    });

    document.body.appendChild(video);
    this.video = video;
  }

  private renderCanvas() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const c = readThemeColors();
    const { modeLabel, subject, clockText, running, progress } = this.snapshot;
    const W = this.canvas.width;
    const H = this.canvas.height;

    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, W, H);

    // Card surface
    ctx.fillStyle = c.card;
    drawRoundedRect(ctx, 12, 12, W - 24, H - 24, 16);
    ctx.fill();
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Top mode label & status
    ctx.font = '700 13px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = c.accent;
    ctx.textAlign = 'left';
    ctx.fillText(modeLabel.toUpperCase(), 28, 42);

    ctx.font = '700 12px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = running ? c.ok : c.mute;
    ctx.textAlign = 'right';
    ctx.fillText(running ? 'ACTIVE' : 'PAUSED', W - 28, 42);

    // Subject
    ctx.font = '600 14px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = c.mute;
    ctx.textAlign = 'left';
    const trimmedSubj = subject.length > 34 ? `${subject.slice(0, 33)}…` : subject;
    ctx.fillText(trimmedSubj, 28, 66);

    // Main clock
    ctx.font = '800 58px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = c.ink;
    ctx.textAlign = 'center';
    ctx.fillText(clockText, W / 2, 134);

    // Progress bar
    const barX = 28;
    const barY = 160;
    const barW = W - 56;
    const barH = 8;
    ctx.fillStyle = c.line;
    drawRoundedRect(ctx, barX, barY, barW, barH, 4);
    ctx.fill();

    const clamped = Math.max(0, Math.min(1, progress));
    if (clamped > 0) {
      ctx.fillStyle = c.accent;
      drawRoundedRect(ctx, barX, barY, Math.max(8, Math.round(barW * clamped)), barH, 4);
      ctx.fill();
    }
  }

  private mountDocumentPip(pipWin: Window) {
    const c = readThemeColors();
    const doc = pipWin.document;
    doc.title = 'StudyWeb Timer';
    doc.body.innerHTML = '';
    doc.head.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
          background: ${c.bg};
          color: ${c.ink};
          padding: 12px;
          height: 100vh;
          display: flex;
          align-items: stretch;
        }
        .card {
          width: 100%;
          background: ${c.card};
          border: 1px solid ${c.line};
          border-radius: 14px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          gap: 10px;
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .mode { color: ${c.accent}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .subj {
          font-size: 12px;
          color: ${c.mute};
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .clock {
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-variant-numeric: tabular-nums;
          font-size: 40px;
          font-weight: 800;
          line-height: 1.05;
          letter-spacing: -0.02em;
          text-align: center;
        }
        .track {
          height: 5px;
          width: 100%;
          border-radius: 999px;
          background: ${c.line};
          overflow: hidden;
        }
        .fill {
          height: 100%;
          width: 0%;
          background: ${c.accent};
          transition: width 250ms ease;
        }
        .actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        button {
          cursor: pointer;
          border-radius: 8px;
          border: 1px solid ${c.line};
          background: ${c.bg};
          color: ${c.ink};
          padding: 7px 12px;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }
        button.primary {
          border-color: ${c.accent};
          background: ${c.accent};
          color: #ffffff;
        }
        button:hover { opacity: 0.9; }
      </style>
    `;

    const card = doc.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div>
        <div class="head">
          <span class="mode" id="sw-pip-mode"></span>
          <span id="sw-pip-state"></span>
        </div>
        <div class="subj" id="sw-pip-subj"></div>
      </div>
      <div class="clock" id="sw-pip-clock"></div>
      <div class="track"><div class="fill" id="sw-pip-fill"></div></div>
      <div class="actions">
        <button type="button" class="primary" id="sw-pip-toggle"></button>
        <button type="button" id="sw-pip-extra"></button>
        <button type="button" id="sw-pip-reset">Reset</button>
      </div>
    `;
    doc.body.appendChild(card);

    doc.getElementById('sw-pip-toggle')?.addEventListener('click', () => {
      this.callbacks.onToggle();
    });
    doc.getElementById('sw-pip-extra')?.addEventListener('click', () => {
      if (this.snapshot.modeKind === 'stopwatch') {
        this.callbacks.onLap?.();
      } else {
        this.callbacks.onAddFiveMins?.();
      }
    });
    doc.getElementById('sw-pip-reset')?.addEventListener('click', () => {
      this.callbacks.onReset();
    });

    this.syncDocumentPipDom();
  }

  private syncDocumentPipDom() {
    if (!this.docPipWin || this.docPipWin.closed) return;
    const doc = this.docPipWin.document;
    const c = readThemeColors();
    const { modeLabel, subject, clockText, running, progress, modeKind } = this.snapshot;

    const modeEl = doc.getElementById('sw-pip-mode');
    const stateEl = doc.getElementById('sw-pip-state');
    const subjEl = doc.getElementById('sw-pip-subj');
    const clockEl = doc.getElementById('sw-pip-clock');
    const fillEl = doc.getElementById('sw-pip-fill');
    const toggleBtn = doc.getElementById('sw-pip-toggle');
    const extraBtn = doc.getElementById('sw-pip-extra');

    if (modeEl) modeEl.textContent = modeLabel;
    if (stateEl) {
      stateEl.textContent = running ? 'Active' : 'Paused';
      stateEl.style.color = running ? c.ok : c.mute;
    }
    if (subjEl) subjEl.textContent = subject;
    if (clockEl) clockEl.textContent = clockText;
    if (fillEl) {
      fillEl.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
    }
    if (toggleBtn) toggleBtn.textContent = running ? 'Pause' : 'Start';
    if (extraBtn) extraBtn.textContent = modeKind === 'stopwatch' ? 'Lap' : '+5m';
  }
}
