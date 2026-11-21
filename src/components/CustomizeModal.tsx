import { useMemo, useState } from 'react';
import {
  Check,
  Moon,
  Palette,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import {
  AppearanceSettings,
  ColorPalette,
  CustomThemeTokens,
  SavedCustomTheme,
  ThemeColorSet,
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

const DEFAULT_LIGHT_SET: ThemeColorSet = {
  bg: '#F4F6FB',
  card: '#FFFFFF',
  ink: '#151E2E',
  accent: '#2563EB',
  line: '#D4DCE8',
};

const DEFAULT_DARK_SET: ThemeColorSet = {
  bg: '#0E141F',
  card: '#161F2E',
  ink: '#EEF2F8',
  accent: '#60A5FA',
  line: '#2B3A52',
};

const CUSTOM_STARTER_PRESETS: Array<{
  label: string;
  light: ThemeColorSet;
  dark: ThemeColorSet;
}> = [
  {
    label: 'Daylight & Midnight',
    light: {
      bg: '#F4F6FB',
      card: '#FFFFFF',
      ink: '#151E2E',
      accent: '#2563EB',
      line: '#D4DCE8',
    },
    dark: {
      bg: '#0E141F',
      card: '#161F2E',
      ink: '#EEF2F8',
      accent: '#60A5FA',
      line: '#2B3A52',
    },
  },
  {
    label: 'Sepia & Espresso',
    light: {
      bg: '#F4ECD8',
      card: '#FCF8EE',
      ink: '#2D2418',
      accent: '#9A4A1C',
      line: '#DDD0B5',
    },
    dark: {
      bg: '#1A1510',
      card: '#262019',
      ink: '#F5ECE1',
      accent: '#E09F5A',
      line: '#3B3228',
    },
  },
  {
    label: 'Sage & Deep Forest',
    light: {
      bg: '#EDF5F0',
      card: '#F8FCF9',
      ink: '#13281E',
      accent: '#16A34A',
      line: '#C6DDD0',
    },
    dark: {
      bg: '#0B1612',
      card: '#12221C',
      ink: '#E8F5EE',
      accent: '#34D399',
      line: '#233C31',
    },
  },
  {
    label: 'Violet Dusk & Aurora',
    light: {
      bg: '#F4F1FB',
      card: '#FAF8FD',
      ink: '#201636',
      accent: '#7C3AED',
      line: '#DCD4EE',
    },
    dark: {
      bg: '#120F20',
      card: '#1A162D',
      ink: '#F0ECFA',
      accent: '#A78BFA',
      line: '#2E2749',
    },
  },
];

const FONT_OPTIONS: Array<{ value: string; label: string; sample: string }> = [
  { value: '', label: 'Default (Bitter & Source Sans 3)', sample: 'Editorial balance' },
  { value: "'Inter', system-ui, sans-serif", label: 'Inter', sample: 'Modern high-clarity UI' },
  { value: "'Plus Jakarta Sans', system-ui, sans-serif", label: 'Plus Jakarta Sans', sample: 'Geometric tech' },
  { value: "'Poppins', system-ui, sans-serif", label: 'Poppins', sample: 'Friendly rounded sans' },
  { value: "'Lexend', system-ui, sans-serif", label: 'Lexend', sample: 'Effortless reading' },
  { value: "'Roboto', system-ui, sans-serif", label: 'Roboto', sample: 'Classic Google Neo-grotesque' },
  { value: "'Source Sans 3', system-ui, sans-serif", label: 'Source Sans 3', sample: 'Clean documentation sans' },
  { value: 'Bitter, Georgia, serif', label: 'Bitter Serif', sample: 'Sturdy reading slab serif' },
  { value: "'Merriweather', Georgia, serif", label: 'Merriweather Serif', sample: 'Warm literary serif' },
  { value: "'Playfair Display', Georgia, serif", label: 'Playfair Display', sample: 'Classic elegance' },
  { value: "'Lora', Georgia, serif", label: 'Lora Serif', sample: 'Contemporary calligraphic' },
  { value: "'JetBrains Mono', ui-monospace, monospace", label: 'JetBrains Mono', sample: 'Developer code monospace' },
  { value: "'Comic Neue', cursive, sans-serif", label: 'Comic Neue', sample: 'Casual & friendly' },
  { value: 'system-ui, -apple-system, sans-serif', label: 'System UI', sample: 'Native OS font' },
  { value: 'ui-monospace, Menlo, monospace', label: 'System Monospace', sample: 'Terminal typewriter' },
];

const QUICK_SWATCHES = {
  bg: {
    light: ['#FFFFFF', '#F8FAFC', '#F4F6FB', '#F4ECD8', '#EDF5F0', '#F4F1FB', '#FAF2F0'],
    dark: ['#090D14', '#0E141F', '#121620', '#1A1510', '#0B1612', '#120F20', '#1A1111'],
  },
  card: {
    light: ['#FFFFFF', '#FAFAFA', '#F8FAFC', '#FCF8EE', '#F8FCF9', '#FAF8FD', '#FFFBFB'],
    dark: ['#161F2E', '#1B2433', '#202938', '#262019', '#12221C', '#1A162D', '#241616'],
  },
  ink: {
    light: ['#0F172A', '#151E2E', '#1E293B', '#2D2418', '#13281E', '#201636', '#261214'],
    dark: ['#FFFFFF', '#F8FAFC', '#EEF2F8', '#F5ECE1', '#E8F5EE', '#F0ECFA', '#FCEAEA'],
  },
  accent: [
    '#2563EB', // Blue
    '#0284C7', // Sky
    '#0D9488', // Teal
    '#16A34A', // Emerald
    '#D97706', // Amber
    '#EA580C', // Orange
    '#DC2626', // Red
    '#7C3AED', // Violet
    '#DB2777', // Pink
  ],
  line: {
    light: ['#D4DCE8', '#CBD5E1', '#E2E8F0', '#DDD0B5', '#C6DDD0', '#DCD4EE', '#ECCECE'],
    dark: ['#2B3A52', '#334155', '#3A4860', '#3B3228', '#233C31', '#2E2749', '#3E2525'],
  },
};

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

function normalizeHex(input: string): string | null {
  let val = input.trim();
  if (!val.startsWith('#')) val = '#' + val;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    return val.toUpperCase();
  }
  return null;
}

export function CustomizeModal({
  open,
  onClose,
  look,
  onChangeLook,
  onResetLook,
}: CustomizeModalProps) {
  const [customStudioOpen, setCustomStudioOpen] = useState(look.pal === 'custom');
  const [activeCustomModeTab, setActiveCustomModeTab] = useState<'light' | 'dark'>(
    look.th === 'dark' ? 'dark' : 'light'
  );
  const [themeSaveName, setThemeSaveName] = useState('');

  // Resolve current custom theme structures
  const customTheme = look.customTheme;
  const currentLight: ThemeColorSet = useMemo(() => {
    if (customTheme?.light) return customTheme.light;
    if (customTheme && hexRelativeLuminance(customTheme.bg) > 0.4) {
      return {
        bg: customTheme.bg,
        card: customTheme.card,
        ink: customTheme.ink,
        accent: customTheme.accent,
        line: customTheme.line,
      };
    }
    return DEFAULT_LIGHT_SET;
  }, [customTheme]);

  const currentDark: ThemeColorSet = useMemo(() => {
    if (customTheme?.dark) return customTheme.dark;
    if (customTheme && hexRelativeLuminance(customTheme.bg) <= 0.4) {
      return {
        bg: customTheme.bg,
        card: customTheme.card,
        ink: customTheme.ink,
        accent: customTheme.accent,
        line: customTheme.line,
      };
    }
    return DEFAULT_DARK_SET;
  }, [customTheme]);

  const currentActiveSet: ThemeColorSet =
    activeCustomModeTab === 'light' ? currentLight : currentDark;

  const ratio = useMemo(
    () => contrastRatio(currentActiveSet.ink, currentActiveSet.card),
    [currentActiveSet.ink, currentActiveSet.card]
  );

  const savedThemes: SavedCustomTheme[] = look.savedThemes || [];

  if (!open) return null;

  const updateLook = (patch: Partial<AppearanceSettings>) => {
    onChangeLook({ ...look, ...patch });
  };

  const handleUpdateToken = (key: keyof ThemeColorSet, value: string) => {
    const cleanHex = normalizeHex(value) || value;
    if (activeCustomModeTab === 'light') {
      const nextLight: ThemeColorSet = { ...currentLight, [key]: cleanHex };
      const nextFull: CustomThemeTokens = {
        ...(customTheme || DEFAULT_LIGHT_SET),
        light: nextLight,
        dark: currentDark,
        // If current mode is light, also sync top-level tokens for backward compatibility
        ...(look.th !== 'dark' ? nextLight : {}),
      };
      updateLook({ pal: 'custom', customTheme: nextFull });
    } else {
      const nextDark: ThemeColorSet = { ...currentDark, [key]: cleanHex };
      const nextFull: CustomThemeTokens = {
        ...(customTheme || DEFAULT_LIGHT_SET),
        light: currentLight,
        dark: nextDark,
        // If current mode is dark, sync top-level tokens
        ...(look.th === 'dark' ? nextDark : {}),
      };
      updateLook({ pal: 'custom', customTheme: nextFull });
    }
  };

  const handleAutoGenerateMode = (fromMode: 'light' | 'dark') => {
    if (fromMode === 'light') {
      // Generate Dark mode from current Light tokens
      const newDark: ThemeColorSet = {
        bg: '#0E141F',
        card: '#161F2E',
        ink: '#EEF2F8',
        accent: currentLight.accent,
        line: '#2B3A52',
      };
      const nextFull: CustomThemeTokens = {
        ...(customTheme || DEFAULT_LIGHT_SET),
        light: currentLight,
        dark: newDark,
        ...(look.th === 'dark' ? newDark : currentLight),
      };
      updateLook({ pal: 'custom', customTheme: nextFull });
      setActiveCustomModeTab('dark');
    } else {
      // Generate Light mode from current Dark tokens
      const newLight: ThemeColorSet = {
        bg: '#F4F6FB',
        card: '#FFFFFF',
        ink: '#151E2E',
        accent: currentDark.accent,
        line: '#D4DCE8',
      };
      const nextFull: CustomThemeTokens = {
        ...(customTheme || DEFAULT_LIGHT_SET),
        light: newLight,
        dark: currentDark,
        ...(look.th === 'dark' ? currentDark : newLight),
      };
      updateLook({ pal: 'custom', customTheme: nextFull });
      setActiveCustomModeTab('light');
    }
  };

  const applyCustomPreset = (preset: { light: ThemeColorSet; dark: ThemeColorSet }) => {
    const isDarkNow = look.th === 'dark';
    const topLevel = isDarkNow ? preset.dark : preset.light;
    const nextFull: CustomThemeTokens = {
      ...topLevel,
      light: preset.light,
      dark: preset.dark,
    };
    updateLook({ pal: 'custom', customTheme: nextFull });
    setCustomStudioOpen(true);
  };

  const handleSaveCustomTheme = () => {
    const cleanName = themeSaveName.trim() || `Custom Theme ${savedThemes.length + 1}`;
    const newEntry: SavedCustomTheme = {
      id: `thm_${Date.now().toString(36)}`,
      name: cleanName,
      tokens: {
        ...(look.th === 'dark' ? currentDark : currentLight),
        light: currentLight,
        dark: currentDark,
      },
    };
    updateLook({
      pal: 'custom',
      customTheme: newEntry.tokens,
      savedThemes: [newEntry, ...savedThemes].slice(0, 16),
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
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div className="min-w-0">
            <h2
              id="customize-modal-title"
              className="font-display text-xl font-bold text-[var(--ink)]"
            >
              Website Appearance &amp; Themes
            </h2>
            <p className="mt-0.5 text-xs text-[var(--mute)]">
              Pick a curated study theme or design your own smooth custom palette with both light and dark modes.
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
          {/* Mode Selector */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--ink)]">Mode</span>
              <span className="text-xs text-[var(--mute)]">
                {activePal === 'custom'
                  ? `Custom Theme (${look.th === 'dark' ? 'Dark' : look.th === 'light' ? 'Light' : 'Auto'})`
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
                  ['', 'Auto (System)'],
                  ['light', '☀️ Light'],
                  ['dark', '🌙 Dark'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={look.th === val}
                  onClick={() => {
                    updateLook({ th: val });
                    if (val === 'light') setActiveCustomModeTab('light');
                    if (val === 'dark') setActiveCustomModeTab('dark');
                  }}
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
                    const baseTokens: CustomThemeTokens = {
                      ...(look.th === 'dark' ? currentDark : currentLight),
                      light: currentLight,
                      dark: currentDark,
                    };
                    updateLook({
                      pal: 'custom',
                      customTheme: baseTokens,
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
                <span>{customStudioOpen ? 'Hide Custom Studio' : 'Custom Theme Studio'}</span>
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
                <div className="flex items-center gap-2">
                  <span
                    className={`font-mono-num text-xs font-bold ${
                      ratio >= 4.5 ? 'text-[var(--ok)]' : 'text-[var(--bad)]'
                    }`}
                  >
                    Contrast {ratio.toFixed(1)}:1 ({ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'Low'})
                  </span>
                </div>
              </div>

              {/* Light & Dark Modes Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-2.5">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveCustomModeTab('light')}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                      activeCustomModeTab === 'light'
                        ? 'bg-[var(--card)] text-[var(--ink)] shadow-sm border border-[var(--line)]'
                        : 'text-[var(--mute)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <Sun className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                    <span>Light Mode Palette</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCustomModeTab('dark')}
                    className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                      activeCustomModeTab === 'dark'
                        ? 'bg-[var(--card)] text-[var(--ink)] shadow-sm border border-[var(--line)]'
                        : 'text-[var(--mute)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <Moon className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
                    <span>Dark Mode Palette</span>
                  </button>
                </div>

                {/* Auto-generate button */}
                {activeCustomModeTab === 'dark' ? (
                  <button
                    type="button"
                    onClick={() => handleAutoGenerateMode('light')}
                    className="sd-btn px-2.5 py-1 text-xs"
                    title="Auto-generate dark mode colors from light mode"
                  >
                    <Wand2 className="h-3 w-3 text-[var(--e3)]" aria-hidden="true" />
                    <span>Generate Dark from Light</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAutoGenerateMode('dark')}
                    className="sd-btn px-2.5 py-1 text-xs"
                    title="Auto-generate light mode colors from dark mode"
                  >
                    <Wand2 className="h-3 w-3 text-[var(--e3)]" aria-hidden="true" />
                    <span>Generate Light from Dark</span>
                  </button>
                )}
              </div>

              {/* Starter Presets */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                  Starter Palettes:
                </span>
                {CUSTOM_STARTER_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyCustomPreset(preset)}
                    className="sd-btn px-2.5 py-1 text-xs whitespace-nowrap"
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm border border-black/20"
                      style={{
                        backgroundColor:
                          activeCustomModeTab === 'light' ? preset.light.bg : preset.dark.bg,
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-sm border border-black/20"
                      style={{
                        backgroundColor:
                          activeCustomModeTab === 'light' ? preset.light.accent : preset.dark.accent,
                      }}
                      aria-hidden="true"
                    />
                    <span>{preset.label}</span>
                  </button>
                ))}
              </div>

              {/* Smooth Color Selectors for the 5 Tokens */}
              <div className="space-y-3">
                {(
                  [
                    {
                      key: 'bg' as const,
                      label: 'Page Background',
                      desc: 'Workspace canvas background',
                      swatches:
                        activeCustomModeTab === 'light'
                          ? QUICK_SWATCHES.bg.light
                          : QUICK_SWATCHES.bg.dark,
                    },
                    {
                      key: 'card' as const,
                      label: 'Card / Note Surface',
                      desc: 'Note blocks, flashcards, dialogs',
                      swatches:
                        activeCustomModeTab === 'light'
                          ? QUICK_SWATCHES.card.light
                          : QUICK_SWATCHES.card.dark,
                    },
                    {
                      key: 'ink' as const,
                      label: 'Body Text Ink',
                      desc: 'Primary reading text and headings',
                      swatches:
                        activeCustomModeTab === 'light'
                          ? QUICK_SWATCHES.ink.light
                          : QUICK_SWATCHES.ink.dark,
                    },
                    {
                      key: 'accent' as const,
                      label: 'Study Accent Color',
                      desc: 'Buttons, badges, highlights, links',
                      swatches: QUICK_SWATCHES.accent,
                    },
                    {
                      key: 'line' as const,
                      label: 'Borders & Dividers',
                      desc: 'Card borders, table dividers, outlines',
                      swatches:
                        activeCustomModeTab === 'light'
                          ? QUICK_SWATCHES.line.light
                          : QUICK_SWATCHES.line.dark,
                    },
                  ]
                ).map(({ key, label, desc, swatches }) => {
                  const currentValue = currentActiveSet[key] || '#000000';
                  return (
                    <div
                      key={key}
                      className="rounded-xl border border-[var(--line)] bg-[var(--card)] p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-[var(--ink)]">{label}</div>
                          <div className="text-[11px] text-[var(--mute)]">{desc}</div>
                        </div>

                        {/* Direct Color Picker & Hex Input */}
                        <div className="flex items-center gap-2">
                          <div className="relative flex items-center">
                            <span
                              className="h-8 w-8 shrink-0 rounded-lg border border-[var(--line)] shadow-inner"
                              style={{ backgroundColor: currentValue }}
                              aria-hidden="true"
                            />
                            <input
                              type="color"
                              value={currentValue}
                              onChange={(e) => handleUpdateToken(key, e.target.value)}
                              aria-label={`Pick color for ${label}`}
                              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                            />
                          </div>
                          <input
                            type="text"
                            value={currentValue}
                            onChange={(e) => handleUpdateToken(key, e.target.value)}
                            placeholder="#HEX"
                            className="sd-input h-8 w-24 text-center font-mono-num text-xs font-semibold uppercase"
                          />
                        </div>
                      </div>

                      {/* Quick Swatches Row */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[var(--line)] pt-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--mute)]">
                          Quick:
                        </span>
                        {swatches.map((color) => {
                          const isPicked = currentValue.toUpperCase() === color.toUpperCase();
                          return (
                            <button
                              key={color}
                              type="button"
                              onClick={() => handleUpdateToken(key, color)}
                              title={color}
                              aria-label={`Select ${color} for ${label}`}
                              className={`h-5 w-5 rounded-md border transition-transform hover:scale-110 ${
                                isPicked
                                  ? 'border-[var(--e3)] ring-2 ring-[var(--e3)] ring-offset-1'
                                  : 'border-black/20 hover:border-black/40'
                              }`}
                              style={{ backgroundColor: color }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Live Mini Preview for Current Palette Tab */}
              <div
                className="rounded-xl border p-4 transition-colors"
                style={{
                  backgroundColor: currentActiveSet.bg,
                  borderColor: currentActiveSet.line,
                  color: currentActiveSet.ink,
                }}
              >
                <div
                  className="rounded-lg border p-3.5 shadow-sm"
                  style={{
                    backgroundColor: currentActiveSet.card,
                    borderColor: currentActiveSet.line,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
                      style={{ backgroundColor: currentActiveSet.accent }}
                    >
                      {activeCustomModeTab === 'light' ? 'Light Mode Preview' : 'Dark Mode Preview'}
                    </span>
                    <span
                      className="text-xs font-semibold"
                      style={{ color: currentActiveSet.accent }}
                    >
                      Active Topic
                    </span>
                  </div>
                  <div className="mt-2 font-display text-base font-extrabold">
                    Cell Structure &amp; Membrane Transport
                  </div>
                  <p className="mt-1 text-xs opacity-85">
                    Tables, flowchart arrows, flashcards, and bold terms adapt seamlessly in both light and dark modes.
                  </p>
                </div>
              </div>

              {/* Save Custom Theme Form */}
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={themeSaveName}
                  onChange={(e) => setThemeSaveName(e.target.value)}
                  placeholder="Name your theme (e.g. Cobalt & Obsidian)"
                  className="sd-input flex-1 min-w-[180px] py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={handleSaveCustomTheme}
                  className="sd-btn-pri px-3.5 py-1.5 text-xs whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Save Theme</span>
                </button>
              </div>

              {/* Saved Custom Themes List */}
              {savedThemes.length > 0 && (
                <div className="space-y-1.5 border-t border-[var(--line)] pt-3">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--mute)]">
                    Saved Custom Themes ({savedThemes.length})
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {savedThemes.map((saved) => (
                      <div
                        key={saved.id}
                        className="flex items-center justify-between gap-2 rounded-xl border border-[var(--line)] bg-[var(--card)] px-3 py-2"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            const lightTokens = saved.tokens.light || saved.tokens;
                            const darkTokens = saved.tokens.dark || saved.tokens;
                            applyCustomPreset({ light: lightTokens, dark: darkTokens });
                          }}
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
                    ))}
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

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Font Family ({FONT_OPTIONS.length} options)
                  <select
                    value={look.ff}
                    onChange={(e) => updateLook({ ff: e.target.value })}
                    className="sd-input mt-1.5 font-semibold text-xs"
                  >
                    {FONT_OPTIONS.map((f) => (
                      <option key={f.label} value={f.value}>
                        {f.label} — {f.sample}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-[var(--mute)]">
                  Reading page width
                  <select
                    value={look.mw}
                    onChange={(e) => updateLook({ mw: e.target.value })}
                    className="sd-input mt-1.5 text-xs"
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

          {/* Footer Actions */}
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
