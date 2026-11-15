import { RotateCcw, X } from 'lucide-react';
import { AppearanceSettings, ColorPalette } from '../types';

interface CustomizeModalProps {
  open: boolean;
  onClose: () => void;
  look: AppearanceSettings;
  onChangeLook: (next: AppearanceSettings) => void;
  onResetLook: () => void;
}

const PALETTES: ReadonlyArray<{
  id: ColorPalette;
  label: string;
  desc: string;
  lightBg: string;
  lightCard: string;
  darkBg: string;
  darkCard: string;
}> = [
  {
    id: '',
    label: 'Classic Slate',
    desc: 'Cool slate & crisp white',
    lightBg: '#F2F4F7',
    lightCard: '#FFFFFF',
    darkBg: '#10151D',
    darkCard: '#1A212C',
  },
  {
    id: 'paper',
    label: 'Warm Paper',
    desc: 'Cream paper & warm charcoal',
    lightBg: '#F6F1E7',
    lightCard: '#FFFDF8',
    darkBg: '#171411',
    darkCard: '#221E19',
  },
  {
    id: 'sage',
    label: 'Soft Sage',
    desc: 'Calm green-tinted study surface',
    lightBg: '#EFF4F0',
    lightCard: '#FAFCFA',
    darkBg: '#101713',
    darkCard: '#18221D',
  },
  {
    id: 'contrast',
    label: 'Crisp Contrast',
    desc: 'High-contrast ink & pure surface',
    lightBg: '#FFFFFF',
    lightCard: '#F5F6F8',
    darkBg: '#05070A',
    darkCard: '#10141B',
  },
];

export function CustomizeModal({
  open,
  onClose,
  look,
  onChangeLook,
  onResetLook,
}: CustomizeModalProps) {
  if (!open) return null;

  const updateLook = (patch: Partial<AppearanceSettings>) => {
    onChangeLook({ ...look, ...patch });
  };

  const activePal = look.pal || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customize-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sd-card flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <h2
              id="customize-modal-title"
              className="font-display text-xl font-bold text-[var(--ink)]"
            >
              Website Appearance
            </h2>
            <p className="mt-0.5 text-xs text-[var(--mute)]">
              Global theme, colour palette, and reading typography across the whole workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close appearance settings"
            className="sd-btn h-9 w-9 shrink-0 rounded-full p-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          {/* Theme Mode */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--ink)]">Mode</span>
              <span className="text-xs text-[var(--mute)]">
                {look.th === 'light'
                  ? 'Light'
                  : look.th === 'dark'
                  ? 'Dark'
                  : 'Matches system'}
              </span>
            </div>
            <div className="sd-seg" role="group" aria-label="Theme mode">
              {(
                [
                  ['', 'Auto'],
                  ['light', 'Light'],
                  ['dark', 'Dark'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={look.th === val}
                  onClick={() => updateLook({ th: val })}
                  className="sd-seg-btn"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Website Colour Palette */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--ink)]">Colour Palette</span>
              <span className="text-xs text-[var(--mute)]">Applies to Home, Notes, Flashcards &amp; Shell</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {PALETTES.map((p) => {
                const selected = activePal === p.id;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateLook({ pal: p.id })}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      selected
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--bg))]'
                        : 'border-[var(--line)] bg-[var(--bg)] hover:border-[var(--mute)]'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-9 w-9 shrink-0 grid-cols-2 overflow-hidden rounded-lg border border-[var(--line)]"
                    >
                      <span style={{ background: p.lightBg }} />
                      <span style={{ background: p.darkBg }} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-[var(--ink)]">{p.label}</span>
                      <span className="block truncate text-xs text-[var(--mute)]">{p.desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Reading & Typography */}
          <div className="border-t border-[var(--line)] pt-5">
            <h3 className="font-display text-base font-bold text-[var(--ink)]">
              Typography &amp; Reading Layout
            </h3>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[var(--mute)]">
                  <span>Text size</span>
                  <span className="font-mono-num text-[var(--ink)]">{look.zm}%</span>
                </div>
                <input
                  type="range"
                  min={85}
                  max={150}
                  step={5}
                  value={look.zm}
                  onChange={(e) => updateLook({ zm: Number(e.target.value) })}
                  className="w-full accent-[var(--e3)]"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-[var(--mute)]">
                  <span>Line spacing</span>
                  <span className="font-mono-num text-[var(--ink)]">
                    {(look.lh / 10).toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min={12}
                  max={24}
                  step={1}
                  value={look.lh}
                  onChange={(e) => updateLook({ lh: Number(e.target.value) })}
                  className="w-full accent-[var(--e3)]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Font
                  <select
                    value={look.ff}
                    onChange={(e) => updateLook({ ff: e.target.value })}
                    className="sd-input mt-1.5"
                  >
                    <option value="">Default (Bitter &amp; Source Sans 3)</option>
                    <option value="'Source Sans 3',system-ui,sans-serif">Sans</option>
                    <option value="Bitter,Georgia,serif">Serif</option>
                    <option value="system-ui,sans-serif">System</option>
                    <option value="ui-monospace,Menlo,monospace">Mono</option>
                  </select>
                </label>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Reading page width
                  <select
                    value={look.mw}
                    onChange={(e) => updateLook({ mw: e.target.value })}
                    className="sd-input mt-1.5"
                  >
                    <option value="">Default</option>
                    <option value="620px">Narrow</option>
                    <option value="900px">Wide</option>
                    <option value="1200px">Extra wide</option>
                  </select>
                </label>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4">
            <button
              type="button"
              onClick={onResetLook}
              className="sd-btn px-3.5 py-2 text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Reset styling</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="sd-btn-pri px-4 py-2 text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
