import { NoteAccentColor, NotePartRole } from '../types';
import { countRightArrows } from './noteSymbols';

export interface NoteColorOption {
  id: NoteAccentColor;
  label: string;
  swatch: string;
}

export const NOTE_COLOR_OPTIONS: NoteColorOption[] = [
  { id: 'default', label: 'Theme', swatch: 'var(--e3)' },
  { id: 'blue', label: 'Cobalt', swatch: '#2563EB' },
  { id: 'green', label: 'Sage', swatch: '#16A34A' },
  { id: 'purple', label: 'Plum', swatch: '#7C3AED' },
  { id: 'amber', label: 'Amber', swatch: '#D97706' },
  { id: 'rose', label: 'Crimson', swatch: '#E11D48' },
];

export interface NotePartRoleInfo {
  id: NotePartRole;
  label: string;
  color: Exclude<NoteAccentColor, 'default'>;
  hint: string;
}

export const NOTE_PART_ROLE_MAP: Record<NotePartRole, NotePartRoleInfo> = {
  core: {
    id: 'core',
    label: 'Core Theory',
    color: 'blue',
    hint: 'Core concepts, definitions, principles, structures, and formulas',
  },
  process: {
    id: 'process',
    label: 'Process & Steps',
    color: 'green',
    hint: 'Mechanisms, sequences, pathways, advantages, and solutions',
  },
  compare: {
    id: 'compare',
    label: 'Comparison & Data',
    color: 'purple',
    hint: 'Comparisons, classification, tables, and evaluations',
  },
  example: {
    id: 'example',
    label: 'Examples & Context',
    color: 'amber',
    hint: 'Case studies, historical context, applications, and examples',
  },
  risk: {
    id: 'risk',
    label: 'Risks & Limits',
    color: 'rose',
    hint: 'Limitations, disadvantages, causes of failure, hazards, and pitfalls',
  },
};

export function normalizeNoteColor(value?: string): NoteAccentColor {
  if (
    value === 'blue' ||
    value === 'green' ||
    value === 'purple' ||
    value === 'amber' ||
    value === 'rose'
  ) {
    return value;
  }
  return 'default';
}

export function normalizeNotePartRole(raw?: string): NotePartRole | undefined {
  const v = String(raw || '')
    .trim()
    .toLowerCase();
  if (!v) return undefined;
  if (v === 'core' || v === 'theory' || v === 'definition' || v === 'concept') return 'core';
  if (
    v === 'process' ||
    v === 'steps' ||
    v === 'mechanism' ||
    v === 'method' ||
    v === 'solution' ||
    v === 'advantage'
  ) {
    return 'process';
  }
  if (
    v === 'compare' ||
    v === 'comparison' ||
    v === 'table' ||
    v === 'evaluation' ||
    v === 'classification'
  ) {
    return 'compare';
  }
  if (
    v === 'example' ||
    v === 'examples' ||
    v === 'case_study' ||
    v === 'casestudy' ||
    v === 'context' ||
    v === 'application'
  ) {
    return 'example';
  }
  if (
    v === 'risk' ||
    v === 'warning' ||
    v === 'limitation' ||
    v === 'limitations' ||
    v === 'disadvantage' ||
    v === 'problem'
  ) {
    return 'risk';
  }
  return undefined;
}

const EXAMPLE_HEADING_RE =
  /\b(?:case\s*stud(?:y|ies)|examples?|applications?|real[- ]world|historical\s*(?:context|background)|background|timeline|evidence|experiments?|practical|scenarios?)\b/i;
const COMPARE_HEADING_RE =
  /\b(?:compar(?:e|ison|ing)|contrast|versus|\bvs\.?\b|pros\s*(?:and|&|\/)\s*cons|advantages\s*(?:and|&|\/)\s*disadvantages|strengths\s*(?:and|&|\/)\s*weaknesses|types\s+of|classif(?:y|ication)|categor(?:y|ies)|evaluation|differences|matrix)\b/i;
const RISK_HEADING_RE =
  /\b(?:disadvantages?|limitations?|weaknesses|drawbacks?|risks?|hazards?|threats?|pitfalls?|mistakes?|misconceptions?|errors?|problems?|challenges?|crises|crisis|criticisms?|consequences?|side[- ]effects?|failures?|negatives?|cons)\b/i;
const PROCESS_HEADING_RE =
  /\b(?:process(?:es)?|stages?|steps?|cycles?|pathways?|mechanisms?|methods?|procedures?|how\s+.+\s+works?|synthes(?:is|es)|reactions?|formation|advantages?|benefits?|strengths?|solutions?|mitigation|management|responses?|prevention|positives?)\b/i;
const CORE_HEADING_RE =
  /\b(?:definitions?|overview|introduction|core\s*concepts?|principles?|theor(?:y|ies)|structures?|components?|key\s*features?|formulas?|equations?|laws?|fundamentals?|anatomy|functions?)\b/i;

function inferSecondaryRoleFromPoints(points: string[]): NotePartRole | undefined {
  const joined = points.join('\n');
  if (!joined.trim()) return undefined;
  if (points.some((p) => /^\|.+\|$/.test(p.trim()))) return 'compare';
  if (points.some((p) => p.includes('⇒ ') || countRightArrows(p) >= 2)) {
    return 'process';
  }
  if (/\b(?:disadvantage|limitation|drawback|risk|hazard|threat|pitfall|fails?\s+to|side[- ]effect|harmful)\b/i.test(joined)) {
    return 'risk';
  }
  if (/\b(?:case\s+study|for\s+example|e\.g\.|in\s+(?:1\d{3}|20\d{2}))\b/i.test(joined)) {
    return 'example';
  }
  if (/\b(?:whereas|in\s+contrast|unlike|compared\s+(?:to|with)|on\s+the\s+other\s+hand)\b/i.test(joined)) {
    return 'compare';
  }
  if (/\b(?:step\s*\d+|firstly|subsequently|stage\s*\d+|then\s+moves?|results?\s+in)\b/i.test(joined)) {
    return 'process';
  }
  return undefined;
}

/**
 * Verifies an AI-assigned section role against deterministic heading & structural cues
 * so misclassifications, invalid values, or monochrome collapses are corrected automatically.
 */
export function verifySectionPartRole(
  heading: string,
  points: string[],
  aiRole?: string
): NotePartRole {
  const h = String(heading || '').trim();
  const hasTable = points.some((p) => /^\|.+\|$/.test(p.trim()));
  const hasFlow = points.some(
    (p) => p.includes('⇒ ') || countRightArrows(p) >= 2
  );

  if (EXAMPLE_HEADING_RE.test(h)) return 'example';
  if (COMPARE_HEADING_RE.test(h)) return 'compare';
  if (RISK_HEADING_RE.test(h)) return 'risk';
  if (PROCESS_HEADING_RE.test(h)) return 'process';
  if (hasTable) return 'compare';
  if (hasFlow) return 'process';
  if (CORE_HEADING_RE.test(h)) return 'core';

  const normalizedAi = normalizeNotePartRole(aiRole);
  if (normalizedAi) return normalizedAi;

  return inferSecondaryRoleFromPoints(points) || 'core';
}

export function applyVerifiedPartColors<
  T extends {
    heading: string;
    points: string[];
    accentColor?: NoteAccentColor;
    partRole?: NotePartRole;
  }
>(sections: T[], useExistingRole = true): T[] {
  const roles = sections.map((sec) =>
    verifySectionPartRole(
      sec.heading,
      sec.points,
      useExistingRole ? sec.partRole : undefined
    )
  );

  // Anti-monotony check: if 3+ sections all resolved to the same role, differentiate using point cues
  if (roles.length >= 3 && new Set(roles).size === 1) {
    for (let i = 0; i < sections.length; i++) {
      if (CORE_HEADING_RE.test(sections[i].heading)) continue;
      const inferred = inferSecondaryRoleFromPoints(sections[i].points);
      if (inferred && inferred !== roles[i]) {
        roles[i] = inferred;
      }
    }
  }

  return sections.map((sec, idx) => {
    const role = roles[idx];
    return {
      ...sec,
      partRole: role,
      accentColor: NOTE_PART_ROLE_MAP[role].color,
    };
  });
}

export function stripSectionPartColors<
  T extends { accentColor?: NoteAccentColor; partRole?: NotePartRole }
>(sections: T[]): T[] {
  return sections.map((sec) => {
    const { accentColor: _dropColor, partRole: _dropRole, ...rest } = sec;
    return rest as T;
  });
}

