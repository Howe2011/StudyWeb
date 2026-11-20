import { useMemo, useState } from 'react';
import { Check, Palette, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import {
  AppearanceSettings,
  ColorPalette,
  CustomThemeTokens,
  SavedCustomTheme,
} from '../types';

interface CustomizeModalProps {
  open: boolean;
  onClose: () => void;
  look: AppearanceSettings;
  onChangeLook: (next: AppearanceSettings) => void;
  onResetLook: () => void;
}

const PALETTES: ReadonlyArray<{
  id: Exclude<ColorPalette, 'custom'>;
  label: string;
  desc: string;
  lightBg: string;
  lightCard: string;
  lightAccent: string;
  darkBg: string;
  darkCard: string;
  darkAccent: string;
}> = [
  {
    id: '',
    label: 'Classic Slate',
    desc: 'Cool slate & crisp white',
    lightBg: '#F2F4F7',
    lightCard: '#FFFFFF',
    lightAccent: '#2F5F8A',
    darkBg: '#10151D',
    darkCard: '#1A212C',
    darkAccent: '#6FA4D6',
  },
  {
    id: 'paper',
    label: 'Warm Paper',
    desc: 'Cream paper & warm charcoal',
    lightBg: '#F6F1E7',
    lightCard: '#FFFDF8',
    lightAccent: '#2F5F8A',
    darkBg: '#171411',
    darkCard: '#221E19',
    darkAccent: '#D49B54',
  },
  {
    id: 'sage',
    label: 'Soft Sage',
    desc: 'Calm green-tinted study surface',
    lightBg: '#EFF4F0',
    lightCard: '#FAFCFA',
    lightAccent: '#1F7A4D',
    darkBg: '#101713',
    darkCard: '#18221D',
    darkAccent: '#52C58A',
  },
  {
    id: 'contrast',
    label: 'Crisp Contrast',
    desc: 'High-contrast ink & pure surface',
    lightBg: '#FFFFFF',
    lightCard: '#F5F6F8',
    lightAccent: '#1D4ED8',
    darkBg: '#05070A',
    darkCard: '#10141B',
    darkAccent: '#7CB8FF',
  },
  {
    id: 'ocean',
    label: 'Nordic Ocean',
    desc: 'Coastal sky & deep navy',
    lightBg: '#EEF4FA',
    lightCard: '#FBFDFF',
    lightAccent: '#0369A1',
    darkBg: '#0B1522',
    darkCard: '#122033',
    darkAccent: '#56B4FF',
  },
  {
    id: 'lavender',
    label: 'Dusk Lavender',
    desc: 'Gentle violet & midnight ink',
    lightBg: '#F3F1FA',
    lightCard: '#FCFBFD',
    lightAccent: '#6D28D9',
    darkBg: '#13101F',
    darkCard: '#1D1830',
    darkAccent: '#A78BFA',
  },
  {
    id: 'rose',
    label: 'Blush Terracotta',
    desc: 'Warm clay & espresso dark mode',
    lightBg: '#FAF2F0',
    lightCard: '#FFFBFB',
    lightAccent: '#C2412D',
    darkBg: '#1B1211',
    darkCard: '#271B19',
    darkAccent: '#F0806D',
  },
  {
    id: 'sand',
    label: 'Golden Sand',
    desc: 'Amber parchment & obsidian ink',
    lightBg: '#F9F5EB',
    lightCard: '#FFFDF7',
    lightAccent: '#B45309',
    darkBg: '#18140D',
    darkCard: '#241E14',
    darkAccent: '#F5B041',
  },
  {
    id: 'nord',
    label: 'Arctic Nord',
    desc: 'Frost slate & glacier blue',
    lightBg: '#ECEFF4',
    lightCard: '#F8FAFC',
    lightAccent: '#5E81AC',
    darkBg: '#242933',
    darkCard: '#2E3440',
    darkAccent: '#88C0D0',
  },
  {
    id: 'emerald',
    label: 'Botanical Emerald',
    desc: 'Fresh jade & deep pine',
    lightBg: '#ECF6F2',
    lightCard: '#F9FCFA',
    lightAccent: '#0F766E',
    darkBg: '#0B1914',
    darkCard: '#12261F',
    darkAccent: '#34D399',
  },
];

const CUSTOM_STARTER_PRESETS: Array<{ label: string; tokens: CustomThemeTokens }> = [
  {
    label: 'Studio Daylight',
    tokens: {
      bg: '#F4F6FB',
      card: '#FFFFFF',
      ink: '#151E2E',
      accent: '#2563EB',
      line: '#D4DCE8',
    },
  },
  {
    label: 'Sepia Journal',
    tokens: {
      bg: '#F4ECD8',
      card: '#FCF8EE',
      ink: '#2D2418',
      accent: '#9A4A1C',
      line: '#DDD0B5',
    },
  },
  {
    label: 'Midnight Slate',
    tokens: {
      bg: '#0E141F',
      card: '#161F2E',
      ink: '#EEF2F8',
      accent: '#60A5FA',
      line: '#2B3A52',
    },
  },
  {
    label: 'Deep Forest',
    tokens: {
      bg: '#0C1713',
      card: '#13241D',
      ink: '#E9F4EE',
      accent: '#34D399',
      line: '#254236',
    },
  },
];

const DEFAULT_CUSTOM_TOKENS: CustomThemeTokens = CUSTOM_STARTER_PRESETS[0].tokens;

function hexRelativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const chan = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

function contrastRatio(hexA: string, hexB: string): number {
  const l1 = hexRelativeLuminance(hexA);
  const l2 = hexRelativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function CustomizeModal({
  open,
  onClose,
  look,
  onChangeLook,
  onResetLook,
}: CustomizeModalProps) {
  const [customStudioOpen, setCustomStudioOpen] = useState(look.pal === 'custom');
  const [themeSaveName, setThemeSaveName] = useState('');

  const activeTokens: CustomThemeTokens = look.customTheme || DEFAULT_CUSTOM_TOKENS;
  const savedThemes: SavedCustomTheme[] = look.savedThemes || [];

  const ratio = useMemo(
    () => contrastRatio(activeTokens.ink, activeTokens.card),
    [activeTokens.ink, activeTokens.card]
  );

  if (!open) return null;

  const updateLook = (patch: Partial<AppearanceSettings>) => {
    onChangeLook({ ...look, ...patch });
  };

  const updateCustomToken = (key: keyof CustomThemeTokens, value: string) => {
    const nextTokens: CustomThemeTokens = {
      ...activeTokens,
      [key]: value,
    };
    updateLook({
      pal: 'custom',
      customTheme: nextTokens,
    });
  };

  const applyCustomPreset = (tokens: CustomThemeTokens) => {
    updateLook({
      pal: 'custom',
      customTheme: { ...tokens },
    });
    setCustomStudioOpen(true);
  };

  const handleSaveCustomTheme = () => {
    const cleanName = themeSaveName.trim() || `Custom Theme ${savedThemes.length + 1}`;
    const newEntry: SavedCustomTheme = {
      id: `thm_${Date.now().toString(36)}`,
      name: cleanName,
      tokens: { ...activeTokens },
    };
    updateLook({
      pal: 'custom',
      customTheme: { ...activeTokens },
      savedThemes: [newEntry, ...savedThemes].slice(0, 12),
    });
    setThemeSaveName('');
  };

  const handleDeleteSavedTheme = (id: string) => {
    updateLook({
      savedThemes: savedThemes.filter((t) => t.id !== id),
    });
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
      <div className="sd-card flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <h2
              id="customize-modal-title"
              className="font-display text-xl font-bold text-[var(--ink)]"
            >
              Website Appearance &amp; Themes
            </h2>
            <p className="mt-0.5 text-xs text-[var(--mute)]">
              Pick a curated study theme or design and save your own colour palette across the entire workspace.
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
                {activePal === 'custom'
                  ? 'Controlled by your custom background colour'
                  : look.th === 'light'
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

          {/* Built-In Colour Themes */}
          <div>
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold text-[var(--ink)]">
                Built-In Study Themes ({PALETTES.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  setCustomStudioOpen((v) => !v);
                  if (activePal !== 'custom') {
                    updateLook({
                      pal: 'custom',
                      customTheme: look.customTheme || DEFAULT_CUSTOM_TOKENS,
                    });
                  }
                }}
                className={`sd-btn px-3 py-1 text-xs whitespace-nowrap ${
                  activePal === 'custom'
                    ? 'border-[var(--e3)] text-[var(--e3)]'
                    : ''
                }`}
              >
                <Sparkles className="h-3.5 w-3.5 text-[var(--e3)]" aria-hidden="true" />
                <span>{customStudioOpen ? 'Hide Custom Theme Studio' : 'Create Custom Theme'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PALETTES.map((p) => {
                const selected = activePal === p.id;
                return (
                  <button
                    key={p.label}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      updateLook({ pal: p.id });
                      setCustomStudioOpen(false);
                    }}
                    className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-2.5 text-left transition-colors ${
                      selected
                        ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--bg))]'
                        : 'border-[var(--line)] bg-[var(--bg)] hover:border-[var(--mute)]'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="grid h-9 w-11 shrink-0 grid-cols-3 overflow-hidden rounded-lg border border-[var(--line)]"
                      >
                        <span style={{ background: p.lightBg }} />
                        <span style={{ background: p.darkBg }} />
                        <span style={{ background: p.lightAccent }} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-[var(--ink)]">
                          {p.label}
                        </span>
                        <span className="block truncate text-xs text-[var(--mute)]">{p.desc}</span>
                      </span>
                    </span>
                    {selected && (
                      <Check className="h-4 w-4 shrink-0 text-[var(--e3)]" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Theme Studio */}
          {(customStudioOpen || activePal === 'custom' || savedThemes.length > 0) && (
            <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--bg)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Palette className="h-4 w-4 text-[var(--e3)]" aria-hidden="true" />
                  <h3 className="font-display text-base font-bold text-[var(--ink)]">
                    Custom Theme Studio
                  </h3>
                </div>
                <span
                  className={`font-mono-num text-xs font-bold ${
                    ratio >= 4.5 ? 'text-[var(--ok)]' : 'text-[var(--bad)]'
                  }`}
                >
                  Text Contrast {ratio.toFixed(1)}:1 ·{' '}
                  {ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA Pass' : 'Low Contrast'}
                </span>
              </div>

              {/* Starter Presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  Start from:
                </span>
                {CUSTOM_STARTER_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyCustomPreset(preset.tokens)}
                    className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm border border-black/20"
                      style={{ backgroundColor: preset.tokens.bg }}
                      aria-hidden="true"
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-sm border border-black/20"
                      style={{ backgroundColor: preset.tokens.accent }}
                      aria-hidden="true"
                    />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>

              {/* 5 Color Pickers */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(
                  [
                    ['bg', 'Page BG'],
                    ['card', 'Card / Note'],
                    ['ink', 'Body Ink'],
                    ['accent', 'Accent'],
                    ['line', 'Borders'],
                  ] as const
                ).map(([tokenKey, label]) => (
                  <label
                    key={tokenKey}
                    className="flex cursor-pointer flex-col gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--card)] p-2.5"
                  >
                    <span className="text-[11px] font-bold text-[var(--mute)]">{label}</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={activeTokens[tokenKey]}
                        onChange={(e) => updateCustomToken(tokenKey, e.target.value)}
                        className="h-7 w-8 cursor-pointer rounded border border-[var(--line)] bg-transparent p-0"
                      />
                      <span className="font-mono-num text-[11px] font-semibold uppercase text-[var(--ink)]">
                        {activeTokens[tokenKey]}
                      </span>
                    </div>
                  </label>
                ))}
              </div>

              {/* Live Mini Preview */}
              <div
                className="rounded-xl border p-4 transition-colors"
                style={{
                  backgroundColor: activeTokens.bg,
                  borderColor: activeTokens.line,
                  color: activeTokens.ink,
                }}
              >
                <div
                  className="rounded-lg border p-3.5"
                  style={{
                    backgroundColor: activeTokens.card,
                    borderColor: activeTokens.line,
                  }}
                >
                  <div
                    className="mb-1 text-xs font-bold uppercase tracking-wider"
                    style={{ color: activeTokens.accent }}
                  >
                    Live Note Preview
                  </div>
                  <div className="font-display text-base font-extrabold">
                    Clean Hierarchy &amp; Readable Typography
                  </div>
                  <p className="mt-1 text-xs opacity-85">
                    Tables, flow steps, and key concepts automatically match your custom palette.
                  </p>
                </div>
              </div>

              {/* Save Custom Theme */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={themeSaveName}
                  onChange={(e) => setThemeSaveName(e.target.value)}
                  placeholder="Name your theme (e.g. Midnight Indigo)"
                  className="sd-input flex-1 min-w-[180px] py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={handleSaveCustomTheme}
                  className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Save Custom Theme</span>
                </button>
              </div>

              {/* Saved Custom Themes List */}
              {savedThemes.length > 0 && (
                <div className="space-y-1.5 border-t border-[var(--line)] pt-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                    Saved Custom Themes ({savedThemes.length})
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {savedThemes.map((saved) => {
                      const isMatch =
                        activePal === 'custom' &&
                        activeTokens.bg === saved.tokens.bg &&
                        activeTokens.card === saved.tokens.card &&
                        activeTokens.ink === saved.tokens.ink &&
                        activeTokens.accent === saved.tokens.accent;
                      return (
                        <div
                          key={saved.id}
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 ${
                            isMatch
                              ? 'border-[var(--e3)] bg-[color-mix(in_srgb,var(--e3)_10%,var(--card))]'
                              : 'border-[var(--line)] bg-[var(--card)]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => applyCustomPreset(saved.tokens)}
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
                          >
                            <span className="grid h-6 w-8 shrink-0 grid-cols-3 overflow-hidden rounded border border-[var(--line)]">
                              <span style={{ backgroundColor: saved.tokens.bg }} />
                              <span style={{ backgroundColor: saved.tokens.card }} />
                              <span style={{ backgroundColor: saved.tokens.accent }} />
                            </span>
                            <span className="truncate text-xs font-bold text-[var(--ink)]">
                              {saved.name}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteSavedTheme(saved.id)}
                            aria-label={`Delete ${saved.name}`}
                            className="cursor-pointer p-1 text-[var(--mute)] hover:text-[var(--bad)]"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

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
                    <option value="">Default (Spacious 1200px)</option>
                    <option value="820px">Focused (820px)</option>
                    <option value="1040px">Comfortable (1040px)</option>
                    <option value="1360px">Extra wide (1360px)</option>
                    <option value="100%">Full canvas (100%)</option>
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
