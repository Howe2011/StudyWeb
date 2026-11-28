import type { BrawlDifficulty } from '../types';

export interface BrawlDifficultyProfile {
  id: BrawlDifficulty;
  label: string;
  shortTag: string;
  description: string;
  badgeColor: string;
  hpMult: number;
  speedMult: number;
  damageMult: number;
  spawnRateMult: number;
  maxMonstersBase: number;
  maxMonstersPerWave: number;
  bossWaveInterval: number;
  xpGainMult: number;
  rangedCooldownMult: number;
  invulnDuration: number;
  unlockImpWave: number;
  unlockGolemWave: number;
  unlockDrakeWave: number;
  dualBossFromWave: number;
}

export const BRAWL_DIFFICULTY_ORDER: BrawlDifficulty[] = [
  'easy',
  'medium',
  'hard',
  'impossible',
];

export const BRAWL_DIFFICULTIES: Record<BrawlDifficulty, BrawlDifficultyProfile> = {
  easy: {
    id: 'easy',
    label: 'Easy',
    shortTag: 'Standard',
    description: 'Classic Monster Brawl pacing. Great for warm-ups and relaxed revision.',
    badgeColor: '#10b981',
    hpMult: 1.0,
    speedMult: 1.0,
    damageMult: 1.0,
    spawnRateMult: 1.0,
    maxMonstersBase: 10,
    maxMonstersPerWave: 3,
    bossWaveInterval: 3,
    xpGainMult: 1.0,
    rangedCooldownMult: 1.0,
    invulnDuration: 0.72,
    unlockImpWave: 2,
    unlockGolemWave: 3,
    unlockDrakeWave: 4,
    dualBossFromWave: 99,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    shortTag: 'Stronger Horde',
    description: 'Tougher, faster monsters and earlier Golems & Drakes.',
    badgeColor: '#38bdf8',
    hpMult: 1.55,
    speedMult: 1.15,
    damageMult: 1.38,
    spawnRateMult: 1.32,
    maxMonstersBase: 13,
    maxMonstersPerWave: 4,
    bossWaveInterval: 3,
    xpGainMult: 0.95,
    rangedCooldownMult: 0.84,
    invulnDuration: 0.64,
    unlockImpWave: 2,
    unlockGolemWave: 2,
    unlockDrakeWave: 3,
    dualBossFromWave: 9,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    shortTag: 'Tactical Synergy',
    description: 'Punishing swarms & bosses every 2 waves. Unbeatable without smart upgrade synergy.',
    badgeColor: '#f59e0b',
    hpMult: 2.35,
    speedMult: 1.28,
    damageMult: 1.85,
    spawnRateMult: 1.68,
    maxMonstersBase: 17,
    maxMonstersPerWave: 5,
    bossWaveInterval: 2,
    xpGainMult: 0.9,
    rangedCooldownMult: 0.66,
    invulnDuration: 0.52,
    unlockImpWave: 1,
    unlockGolemWave: 2,
    unlockDrakeWave: 3,
    dualBossFromWave: 6,
  },
  impossible: {
    id: 'impossible',
    label: 'Impossible',
    shortTag: 'Flawless Play',
    description: 'Relentless elites, dense fireballs & double bosses. Demands perfect movement and buildcraft.',
    badgeColor: '#ef4444',
    hpMult: 3.5,
    speedMult: 1.44,
    damageMult: 2.5,
    spawnRateMult: 2.15,
    maxMonstersBase: 21,
    maxMonstersPerWave: 6,
    bossWaveInterval: 2,
    xpGainMult: 0.85,
    rangedCooldownMult: 0.5,
    invulnDuration: 0.4,
    unlockImpWave: 1,
    unlockGolemWave: 1,
    unlockDrakeWave: 2,
    dualBossFromWave: 4,
  },
};

export interface EffectiveBrawlScaling {
  profile: BrawlDifficultyProfile;
  playerCount: number;
  coopHpMult: number;
  coopSpawnMult: number;
  coopDamageMult: number;
  hpMult: number;
  speedMult: number;
  damageMult: number;
  spawnRateMult: number;
  maxMonstersBase: number;
  maxMonstersPerWave: number;
}

export function normalizeBrawlDifficulty(raw: unknown): BrawlDifficulty {
  if (raw === 'easy' || raw === 'medium' || raw === 'hard' || raw === 'impossible') {
    return raw;
  }
  return 'medium';
}

export function computeBrawlScale(
  difficulty: BrawlDifficulty,
  connectedPlayerCount: number
): EffectiveBrawlScaling {
  const profile = BRAWL_DIFFICULTIES[difficulty] || BRAWL_DIFFICULTIES.medium;
  const playerCount = Math.max(1, connectedPlayerCount);
  const coopHpMult = 1 + (playerCount - 1) * 0.55;
  const coopSpawnMult = 1 + (playerCount - 1) * 0.45;
  const coopDamageMult = 1 + (playerCount - 1) * 0.16;

  return {
    profile,
    playerCount,
    coopHpMult,
    coopSpawnMult,
    coopDamageMult,
    hpMult: profile.hpMult * coopHpMult,
    speedMult: profile.speedMult * (1 + Math.min(0.16, (playerCount - 1) * 0.03)),
    damageMult: profile.damageMult * coopDamageMult,
    spawnRateMult: profile.spawnRateMult * coopSpawnMult,
    maxMonstersBase: profile.maxMonstersBase + (playerCount - 1) * 6,
    maxMonstersPerWave: profile.maxMonstersPerWave + Math.floor((playerCount - 1) * 1.5),
  };
}
