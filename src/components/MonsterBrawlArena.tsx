import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  Flame,
  Heart,
  LogOut,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import {
  BRAWL_DIFFICULTIES,
  computeBrawlScale,
  normalizeBrawlDifficulty,
} from '../lib/brawlDifficulty';
import {
  LoadedMonsterAssetPack,
  loadMonsterAssetPack,
  MONSTER_ARCHETYPES,
  MonsterArchetypeId,
} from '../lib/monsterAssets';
import {
  BrawlCoopActionPacket,
  BrawlDamageEvent,
  BrawlHeroPacket,
  BrawlWorldSnapshot,
  QuizBrawlQuestion,
  QuizBrawlStats,
  QuizQuestionFormat,
  QuizRoomState,
} from '../types';

export interface BrawlAnswerFeedback {
  correct: boolean;
  officialAnswer: string;
  pointsAwarded: number;
  streak: number;
}

export interface BrawlCoopChannel {
  isRealtimeServer: boolean;
  sendWorld: (world: BrawlWorldSnapshot) => void;
  sendHero: (hero: BrawlHeroPacket) => void;
  sendAction: (action: BrawlCoopActionPacket) => void;
  subscribe: (handlers: {
    onWorld?: (world: BrawlWorldSnapshot) => void;
    onHero?: (hero: BrawlHeroPacket) => void;
    onAction?: (action: BrawlCoopActionPacket) => void;
  }) => () => void;
}

interface MonsterBrawlArenaProps {
  room: QuizRoomState;
  playerId: string | null;
  isHost: boolean;
  muted: boolean;
  coopChannel?: BrawlCoopChannel;
  onToggleMute: () => void;
  onReportProgress: (stats: QuizBrawlStats) => void;
  onSubmitBrawlAnswer: (
    question: QuizBrawlQuestion,
    answer: string
  ) => Promise<BrawlAnswerFeedback>;
  onFinishMatch: () => void;
  onLeaveRoom: () => void;
}

type BrawlOverlayState =
  | 'STARTER_PICK'
  | 'PLAYING'
  | 'LEVEL_UP_QUIZ'
  | 'LEVEL_UP'
  | 'GAME_OVER';

type AbilityId = 'slash' | 'bolt' | 'orbit' | 'lightning' | 'nova' | 'magnet';

interface AbilityDef {
  id: AbilityId;
  name: string;
  tagline: string;
  color: string;
  accentBg: string;
  icon: 'sword' | 'bolt' | 'orbit' | 'lightning' | 'nova' | 'magnet';
  maxLevel: number;
}

const ABILITY_CATALOG: Record<AbilityId, AbilityDef> = {
  slash: {
    id: 'slash',
    name: 'Emerald Crescent',
    tagline: 'Wider, faster blade arc that cleaves monsters in front of you.',
    color: '#10b981',
    accentBg: 'rgba(16, 185, 129, 0.16)',
    icon: 'sword',
    maxLevel: 6,
  },
  bolt: {
    id: 'bolt',
    name: 'Arcane Barrage',
    tagline: 'Fires homing energy bolts that lock onto nearby monsters.',
    color: '#38bdf8',
    accentBg: 'rgba(56, 189, 248, 0.16)',
    icon: 'bolt',
    maxLevel: 6,
  },
  orbit: {
    id: 'orbit',
    name: 'Frost Orbitals',
    tagline: 'Summons spinning ice crystals around you that knock foes back.',
    color: '#818cf8',
    accentBg: 'rgba(129, 140, 248, 0.16)',
    icon: 'orbit',
    maxLevel: 5,
  },
  lightning: {
    id: 'lightning',
    name: 'Storm Chain',
    tagline: 'Strikes nearby monsters with jagged lightning arcs.',
    color: '#facc15',
    accentBg: 'rgba(250, 204, 21, 0.16)',
    icon: 'lightning',
    maxLevel: 5,
  },
  nova: {
    id: 'nova',
    name: 'Meteor Nova',
    tagline: 'Emits a fiery shockwave blast around you every few seconds.',
    color: '#fb7185',
    accentBg: 'rgba(251, 113, 133, 0.16)',
    icon: 'nova',
    maxLevel: 5,
  },
  magnet: {
    id: 'magnet',
    name: 'Crystal Haste',
    tagline: '+15% move speed, wider XP magnet & +20 Max HP (heals now).',
    color: '#a855f7',
    accentBg: 'rgba(168, 85, 247, 0.16)',
    icon: 'magnet',
    maxLevel: 6,
  },
};

const TEAMMATE_PALETTE = [
  { top: '#38bdf8', bottom: '#0284c7', border: '#e0f2fe', shell: '#075985' },
  { top: '#a78bfa', bottom: '#7c3aed', border: '#ede9fe', shell: '#4c1d95' },
  { top: '#fbbf24', bottom: '#d97706', border: '#fef3c7', shell: '#78350f' },
  { top: '#fb7185', bottom: '#e11d48', border: '#ffe4e6', shell: '#881337' },
  { top: '#2dd4bf', bottom: '#0d9488', border: '#ccfbf1', shell: '#134e4a' },
  { top: '#f472b6', bottom: '#db2777', border: '#fce7f3', shell: '#831843' },
];

// Bigger arena map (2240 x 1400, ~2x playable area) with 6 strategic stone pillars
const WORLD_W = 2240;
const WORLD_H = 1400;
const ARENA_MARGIN = 110;
const PILLARS = [
  { x: 560, y: 390, r: 38 },
  { x: 1120, y: 300, r: 36 },
  { x: 1680, y: 390, r: 38 },
  { x: 560, y: 1010, r: 38 },
  { x: 1120, y: 1100, r: 36 },
  { x: 1680, y: 1010, r: 38 },
];

interface MonsterEntity {
  uid: number;
  kind: MonsterArchetypeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX?: number;
  targetY?: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  damage: number;
  xpValue: number;
  flashTimer: number;
  spawnTimer: number;
  facing: 1 | -1;
  phaseOffset: number;
  shootCooldown: number;
  isBoss: boolean;
}

interface ProjectileEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  damage: number;
  life: number;
  fromEnemy: boolean;
  color: string;
  homing: boolean;
}

interface SlashArcEffect {
  x: number;
  y: number;
  angle: number;
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

interface LightningBoltEffect {
  points: Array<{ x: number; y: number }>;
  life: number;
  maxLife: number;
}

interface NovaRingEffect {
  x: number;
  y: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
}

interface XpCrystalEntity {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  kind: 'emerald' | 'cyan' | 'gold' | 'heart';
  life: number;
}

interface FloatingDamageText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  big?: boolean;
}

interface ParticleEffect {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

interface AfterImage {
  x: number;
  y: number;
  life: number;
  color?: string;
}

interface RemoteHeroState extends BrawlHeroPacket {
  targetX: number;
  targetY: number;
  lastSeenAt: number;
  walkPhase: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function xpRequiredForLevel(level: number): number {
  return Math.round(70 + (level - 1) * 48 + Math.pow(level - 1, 1.45) * 18);
}

function colorIndexForId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % TEAMMATE_PALETTE.length;
}

// Shared reusable SFX engine
class BrawlAudioEngine {
  private ctx: AudioContext | null = null;
  private lastPlayed = new Map<string, number>();

  private ensureContext(): AudioContext | null {
    try {
      if (!this.ctx) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  play(
    kind:
      | 'slash'
      | 'hit'
      | 'gem'
      | 'levelup'
      | 'dash'
      | 'hurt'
      | 'boss'
      | 'correct'
      | 'wrong'
      | 'gameover',
    muted: boolean
  ) {
    if (muted) return;
    const nowMs = performance.now();
    const minGap = kind === 'hit' || kind === 'gem' ? 55 : kind === 'slash' ? 140 : 60;
    if (nowMs - (this.lastPlayed.get(kind) || 0) < minGap) return;
    this.lastPlayed.set(kind, nowMs);

    const ctx = this.ensureContext();
    if (!ctx) return;

    const t = ctx.currentTime;
    const tone = (
      freq: number,
      endFreq: number,
      dur: number,
      offset = 0,
      type: OscillatorType = 'sine',
      vol = 0.05
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t + offset);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t + offset + dur);
      gain.gain.setValueAtTime(vol, t + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, t + offset + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + dur);
    };

    if (kind === 'slash') {
      tone(340, 150, 0.11, 0, 'triangle', 0.045);
    } else if (kind === 'hit') {
      tone(190, 95, 0.08, 0, 'square', 0.032);
    } else if (kind === 'gem') {
      tone(740, 980, 0.09, 0, 'sine', 0.04);
    } else if (kind === 'dash') {
      tone(460, 860, 0.13, 0, 'sine', 0.04);
    } else if (kind === 'hurt') {
      tone(160, 75, 0.16, 0, 'sawtooth', 0.05);
    } else if (kind === 'boss') {
      tone(140, 220, 0.28, 0, 'sawtooth', 0.06);
      tone(180, 320, 0.32, 0.16, 'triangle', 0.06);
    } else if (kind === 'levelup') {
      tone(523.25, 523.25, 0.12, 0, 'triangle', 0.06);
      tone(659.25, 659.25, 0.12, 0.09, 'triangle', 0.06);
      tone(783.99, 783.99, 0.14, 0.18, 'triangle', 0.06);
      tone(1046.5, 1046.5, 0.24, 0.27, 'sine', 0.07);
    } else if (kind === 'correct') {
      tone(587.33, 587.33, 0.11, 0, 'sine', 0.06);
      tone(880, 880, 0.2, 0.09, 'sine', 0.06);
    } else if (kind === 'wrong') {
      tone(230, 170, 0.18, 0, 'triangle', 0.055);
    } else if (kind === 'gameover') {
      tone(320, 240, 0.18, 0, 'sawtooth', 0.065);
      tone(240, 170, 0.2, 0.16, 'sawtooth', 0.065);
      tone(170, 82, 0.42, 0.34, 'triangle', 0.075);
    }
  }

  dispose() {
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}

export function MonsterBrawlArena({
  room,
  playerId,
  isHost,
  muted,
  coopChannel,
  onToggleMute,
  onReportProgress,
  onSubmitBrawlAnswer,
  onFinishMatch,
  onLeaveRoom,
}: MonsterBrawlArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const assetsRef = useRef<LoadedMonsterAssetPack | null>(null);
  const audioRef = useRef<BrawlAudioEngine | null>(null);
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  const playerIdRef = useRef(playerId);
  playerIdRef.current = playerId;

  const difficulty = normalizeBrawlDifficulty(room.brawlDifficulty);
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;

  const connectedPlayersList = useMemo(
    () => room.players.filter((p) => p.connected),
    [room.players]
  );
  const connectedCount = Math.max(1, connectedPlayersList.length);
  const connectedCountRef = useRef(connectedCount);
  connectedCountRef.current = connectedCount;

  const roomPlayersRef = useRef(room.players);
  roomPlayersRef.current = room.players;

  const myNickname = useMemo(() => {
    const me = room.players.find((p) => p.id === playerId);
    return me?.nickname || 'Hero';
  }, [room.players, playerId]);
  const myNicknameRef = useRef(myNickname);
  myNicknameRef.current = myNickname;

  const coopScale = useMemo(
    () => computeBrawlScale(difficulty, connectedCount),
    [difficulty, connectedCount]
  );

  const [assetsReady, setAssetsReady] = useState(false);
  const [overlay, setOverlay] = useState<BrawlOverlayState>('STARTER_PICK');
  const overlayRef = useRef<BrawlOverlayState>('STARTER_PICK');
  overlayRef.current = overlay;

  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const [spectating, setSpectating] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(true);
  const [upgradeOptions, setUpgradeOptions] = useState<AbilityId[]>(['slash', 'bolt', 'orbit']);
  const [abilitiesState, setAbilitiesState] = useState<Record<AbilityId, number>>({
    slash: 0,
    bolt: 0,
    orbit: 0,
    lightning: 0,
    nova: 0,
    magnet: 0,
  });

  // HUD snapshot synced at ~11Hz
  const [hud, setHud] = useState({
    hp: 100,
    maxHp: 100,
    xp: 0,
    xpInLevel: 0,
    xpNextLevel: xpRequiredForLevel(1),
    level: 1,
    kills: 0,
    wave: 1,
    waveTimeLeft: 26,
    dashCooldownRatio: 0,
    bossName: '' as string,
    bossHp: 0,
    bossMaxHp: 0,
    bossCount: 0,
    shielded: true,
    teammateCount: Math.max(0, connectedCount - 1),
    aliveTeammateCount: Math.max(0, connectedCount - 1),
  });

  // Quiz modal state inside Monster Brawl
  const [activeQuestion, setActiveQuestion] = useState<QuizBrawlQuestion | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [submittingAnswer, setSubmittingAnswer] = useState(false);
  const [answerFeedback, setAnswerFeedback] = useState<BrawlAnswerFeedback | null>(null);
  const questionCursorRef = useRef(0);

  const reducedMotionRef = useRef(false);
  useEffect(() => {
    reducedMotionRef.current =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  }, []);

  // Load high-quality generated arena map + transparent monster sprites
  useEffect(() => {
    let alive = true;
    audioRef.current = new BrawlAudioEngine();
    void loadMonsterAssetPack().then((pack) => {
      if (!alive) return;
      assetsRef.current = pack;
      setAssetsReady(true);
    });
    return () => {
      alive = false;
      audioRef.current?.dispose();
    };
  }, []);

  const questionFormat: QuizQuestionFormat = room.questionFormat || 'mcq';
  const brawlDeck = useMemo<QuizBrawlQuestion[]>(() => {
    if (room.brawlDeck && room.brawlDeck.length > 0) {
      return room.brawlDeck;
    }
    if (room.currentQuestion) {
      return [
        {
          id: room.currentQuestion.id,
          question: room.currentQuestion.question,
          section: room.currentQuestion.section,
          choices: room.currentQuestion.choices,
        },
      ];
    }
    return [];
  }, [room.brawlDeck, room.currentQuestion]);

  // Co-op networking refs
  const coopChannelRef = useRef(coopChannel);
  coopChannelRef.current = coopChannel;
  const remoteHeroesRef = useRef<Map<string, RemoteHeroState>>(new Map());
  const pendingGuestHitsRef = useRef<BrawlDamageEvent[]>([]);
  const pendingCrystalPickupsRef = useRef<number[]>([]);
  const locallyPickedCrystalIdsRef = useRef<Map<number, number>>(new Map());
  const pendingSlashRef = useRef<BrawlCoopActionPacket['slash'] | undefined>(undefined);
  const pendingBoltRef = useRef<BrawlCoopActionPacket['bolt'] | undefined>(undefined);
  const pendingNovaRef = useRef<BrawlCoopActionPacket['nova'] | undefined>(undefined);
  const incomingGuestActionsRef = useRef<BrawlCoopActionPacket[]>([]);
  const latestWorldSnapshotRef = useRef<BrawlWorldSnapshot | null>(null);

  // Monotonic XP / heal assist ledgers managed by Host & applied by Guests
  const hostXpGrantsRef = useRef<Record<string, number>>({});
  const hostHealGrantsRef = useRef<Record<string, number>>({});
  const appliedXpGrantRef = useRef(0);
  const appliedHealGrantRef = useRef(0);

  // Initial spread spawn offset in co-op so teammates don't overlap on start
  const initialHeroPos = useMemo(() => {
    const players = room.players;
    const idx = Math.max(0, players.findIndex((p) => p.id === playerId));
    const total = Math.max(1, players.length);
    if (total === 1) {
      return { x: WORLD_W / 2, y: WORLD_H / 2 + 45 };
    }
    const angle = (idx * Math.PI * 2) / total - Math.PI / 2;
    return {
      x: Math.round(WORLD_W / 2 + Math.cos(angle) * 95),
      y: Math.round(WORLD_H / 2 + Math.sin(angle) * 95),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mutable simulation engine state inside ref for zero-jank 60fps loop
  const simRef = useRef({
    hero: {
      x: initialHeroPos.x,
      y: initialHeroPos.y,
      vx: 0,
      vy: 0,
      radius: 22,
      hp: 100,
      maxHp: 100,
      xp: 0,
      xpInLevel: 0,
      level: 1,
      kills: 0,
      aimAngle: 0,
      dashTimer: 0,
      dashCooldown: 0,
      dashVx: 0,
      dashVy: 0,
      invulnTimer: 0,
      walkPhase: 0,
      facing: 1 as 1 | -1,
    },
    abilities: {
      slash: 0,
      bolt: 0,
      orbit: 0,
      lightning: 0,
      nova: 0,
      magnet: 0,
    } as Record<AbilityId, number>,
    cooldowns: {
      slash: 0,
      bolt: 0,
      lightning: 0,
      nova: 0,
    },
    orbitAngle: 0,
    wave: 1,
    waveTimer: 26,
    spawnAccum: 0,
    bossSpawnedForWave: 0,
    nextUid: 1,
    nextCrystalId: 1,
    nextProjId: 1,
    cameraX: initialHeroPos.x,
    cameraY: initialHeroPos.y,
    shakeTimer: 0,
    shakePower: 0,
    monsters: [] as MonsterEntity[],
    projectiles: [] as ProjectileEntity[],
    slashes: [] as SlashArcEffect[],
    bolts: [] as LightningBoltEffect[],
    novas: [] as NovaRingEffect[],
    crystals: [] as XpCrystalEntity[],
    dmgTexts: [] as FloatingDamageText[],
    particles: [] as ParticleEffect[],
    afterImages: [] as AfterImage[],
    ambientMotes: Array.from({ length: 42 }, (_, idx) => ({
      x: (idx * 271) % WORLD_W,
      y: (idx * 197) % WORLD_H,
      phase: idx * 0.65,
      speed: 12 + (idx % 5) * 4,
    })),
    pendingUpgrades: 0,
    lastReportedAt: 0,
    lastWorldSyncAt: 0,
    lastHeroSyncAt: 0,
    lastActionSyncAt: 0,
  });

  // Subscribe to Co-op WebSocket packets
  useEffect(() => {
    if (!coopChannel) return;
    return coopChannel.subscribe({
      onHero: (pkt) => {
        if (!pkt || !pkt.playerId || pkt.playerId === playerIdRef.current) return;
        const prev = remoteHeroesRef.current.get(pkt.playerId);
        remoteHeroesRef.current.set(pkt.playerId, {
          ...pkt,
          x: prev ? prev.x : pkt.x,
          y: prev ? prev.y : pkt.y,
          targetX: pkt.x,
          targetY: pkt.y,
          lastSeenAt: performance.now(),
          walkPhase: prev ? prev.walkPhase : 0,
        });
      },
      onWorld: (world) => {
        if (isHostRef.current) return;
        latestWorldSnapshotRef.current = world;
      },
      onAction: (action) => {
        if (!action || action.playerId === playerIdRef.current) return;
        incomingGuestActionsRef.current.push(action);
      },
    });
  }, [coopChannel]);

  // Also keep Cloud Fallback teammate markers updated if WebSocket isn't active
  useEffect(() => {
    if (coopChannel?.isRealtimeServer) return;
    const now = performance.now();
    const activeIds = new Set<string>();
    for (const p of room.players) {
      if (p.id === playerId || !p.connected) continue;
      activeIds.add(p.id);
      const st = p.brawlStats;
      if (st && typeof st.x === 'number' && typeof st.y === 'number') {
        const prev = remoteHeroesRef.current.get(p.id);
        remoteHeroesRef.current.set(p.id, {
          playerId: p.id,
          nickname: p.nickname,
          x: prev ? prev.x : st.x,
          y: prev ? prev.y : st.y,
          targetX: st.x,
          targetY: st.y,
          vx: 0,
          vy: 0,
          hp: st.hp,
          maxHp: st.maxHp,
          level: st.level,
          xp: st.xp,
          kills: st.kills,
          facing: st.facing || 1,
          aimAngle: 0,
          shielded: Boolean(st.shielded),
          dashing: false,
          abilities: {},
          lastSeenAt: now,
          walkPhase: prev ? prev.walkPhase : 0,
        });
      }
    }
    for (const key of Array.from(remoteHeroesRef.current.keys())) {
      if (!activeIds.has(key)) {
        remoteHeroesRef.current.delete(key);
      }
    }
  }, [room.players, playerId, coopChannel?.isRealtimeServer]);

  // Keyboard & pointer input tracking
  const keysRef = useRef<Set<string>>(new Set());
  const pointerRef = useRef<{
    active: boolean;
    screenX: number;
    screenY: number;
    joyOriginX: number;
    joyOriginY: number;
    joyDx: number;
    joyDy: number;
    pointerDown: boolean;
  }>({
    active: false,
    screenX: 0,
    screenY: 0,
    joyOriginX: 0,
    joyOriginY: 0,
    joyDx: 0,
    joyDy: 0,
    pointerDown: false,
  });

  const pickThreeAbilities = useCallback((): AbilityId[] => {
    const ab = simRef.current.abilities;
    const pool = (Object.keys(ABILITY_CATALOG) as AbilityId[]).filter(
      (id) => ab[id] < ABILITY_CATALOG[id].maxLevel
    );
    const candidates = pool.length > 0 ? pool : (Object.keys(ABILITY_CATALOG) as AbilityId[]);
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3);
  }, []);

  const triggerUpgradeChoice = useCallback(() => {
    const picks = pickThreeAbilities();
    setUpgradeOptions(picks);
    setOverlay('LEVEL_UP');
    audioRef.current?.play('levelup', mutedRef.current);
  }, [pickThreeAbilities]);

  const spawnResumeShockwave = useCallback((radius = 190, dmg = 26) => {
    const sim = simRef.current;
    sim.novas.push({
      x: sim.hero.x,
      y: sim.hero.y,
      maxRadius: radius,
      life: 0.4,
      maxLife: 0.4,
      color: '#10b981',
    });
    const isGuestCoop =
      !isHostRef.current &&
      connectedCountRef.current > 1 &&
      Boolean(coopChannelRef.current?.isRealtimeServer);

    if (isGuestCoop) {
      pendingNovaRef.current = { x: sim.hero.x, y: sim.hero.y, maxRadius: radius, color: '#10b981' };
      for (const m of sim.monsters) {
        const dist = Math.hypot(m.x - sim.hero.x, m.y - sim.hero.y);
        if (dist < radius) {
          const ang = Math.atan2(m.y - sim.hero.y, m.x - sim.hero.x);
          pendingGuestHitsRef.current.push({
            uid: m.uid,
            dmg,
            kbX: Math.cos(ang) * 320,
            kbY: Math.sin(ang) * 320,
            crit: false,
          });
          m.flashTimer = 0.14;
        }
      }
    } else {
      for (const m of sim.monsters) {
        const dist = Math.hypot(m.x - sim.hero.x, m.y - sim.hero.y);
        if (dist < radius) {
          const ang = Math.atan2(m.y - sim.hero.y, m.x - sim.hero.x);
          m.vx += Math.cos(ang) * 320;
          m.vy += Math.sin(ang) * 320;
          m.hp -= dmg;
          m.flashTimer = 0.14;
        }
      }
    }
  }, []);

  const applyAbilityUpgrade = useCallback(
    (id: AbilityId) => {
      const sim = simRef.current;
      const wasStarter = overlayRef.current === 'STARTER_PICK';
      sim.abilities[id] = (sim.abilities[id] || 0) + 1;
      setAbilitiesState({ ...sim.abilities });

      if (id === 'magnet') {
        sim.hero.maxHp += 20;
        sim.hero.hp = Math.min(sim.hero.maxHp, sim.hero.hp + 25);
      } else {
        sim.hero.hp = Math.min(sim.hero.maxHp, sim.hero.hp + 12);
      }

      sim.hero.invulnTimer = Math.max(sim.hero.invulnTimer, 1.2);
      if (!wasStarter) {
        spawnResumeShockwave(190, 24);
      }

      if (sim.pendingUpgrades > 0) {
        sim.pendingUpgrades -= 1;
        if (brawlDeck.length > 0) {
          const idx = questionCursorRef.current % brawlDeck.length;
          questionCursorRef.current += 1;
          setActiveQuestion(brawlDeck[idx]);
          setTypedAnswer('');
          setAnswerFeedback(null);
          setSubmittingAnswer(false);
          setOverlay('LEVEL_UP_QUIZ');
          return;
        }
        const nextPicks = pickThreeAbilities();
        setUpgradeOptions(nextPicks);
        setOverlay('LEVEL_UP');
        return;
      }

      setOverlay('PLAYING');
    },
    [brawlDeck, pickThreeAbilities, spawnResumeShockwave]
  );

  const openQuizModal = useCallback(() => {
    if (!brawlDeck.length) {
      triggerUpgradeChoice();
      return;
    }
    const idx = questionCursorRef.current % brawlDeck.length;
    questionCursorRef.current += 1;
    setActiveQuestion(brawlDeck[idx]);
    setTypedAnswer('');
    setAnswerFeedback(null);
    setSubmittingAnswer(false);
    audioRef.current?.play('levelup', mutedRef.current);
    setOverlay('LEVEL_UP_QUIZ');
  }, [brawlDeck, triggerUpgradeChoice]);

  const handleRestartSoloRun = useCallback(() => {
    const sim = simRef.current;
    sim.hero = {
      x: initialHeroPos.x,
      y: initialHeroPos.y,
      vx: 0,
      vy: 0,
      radius: 22,
      hp: 100,
      maxHp: 100,
      xp: 0,
      xpInLevel: 0,
      level: 1,
      kills: 0,
      aimAngle: 0,
      dashTimer: 0,
      dashCooldown: 0,
      dashVx: 0,
      dashVy: 0,
      invulnTimer: 0.8,
      walkPhase: 0,
      facing: 1,
    };
    sim.abilities = {
      slash: 0,
      bolt: 0,
      orbit: 0,
      lightning: 0,
      nova: 0,
      magnet: 0,
    };
    sim.cooldowns = { slash: 0, bolt: 0, lightning: 0, nova: 0 };
    sim.orbitAngle = 0;
    sim.wave = 1;
    sim.waveTimer = 26;
    sim.spawnAccum = 0;
    sim.bossSpawnedForWave = 0;
    sim.cameraX = initialHeroPos.x;
    sim.cameraY = initialHeroPos.y;
    sim.shakeTimer = 0;
    sim.shakePower = 0;
    sim.monsters = [];
    sim.projectiles = [];
    sim.slashes = [];
    sim.bolts = [];
    sim.novas = [];
    sim.crystals = [];
    sim.dmgTexts = [];
    sim.particles = [];
    sim.afterImages = [];
    sim.pendingUpgrades = 0;

    setAbilitiesState({
      slash: 0,
      bolt: 0,
      orbit: 0,
      lightning: 0,
      nova: 0,
      magnet: 0,
    });
    setUpgradeOptions(['slash', 'bolt', 'orbit']);
    setActiveQuestion(null);
    setAnswerFeedback(null);
    setSpectating(false);
    setPaused(false);
    setOverlay('STARTER_PICK');
  }, [initialHeroPos]);

  const handleTriggerDash = useCallback(() => {
    if (overlayRef.current !== 'PLAYING' || pausedRef.current) return;
    const sim = simRef.current;
    if (sim.hero.dashCooldown > 0 || sim.hero.dashTimer > 0) return;

    let dx = 0;
    let dy = 0;
    const keys = keysRef.current;
    if (keys.has('w') || keys.has('arrowup')) dy -= 1;
    if (keys.has('s') || keys.has('arrowdown')) dy += 1;
    if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
    if (keys.has('d') || keys.has('arrowright')) dx += 1;
    if (dx === 0 && dy === 0 && (Math.abs(pointerRef.current.joyDx) > 4 || Math.abs(pointerRef.current.joyDy) > 4)) {
      dx = pointerRef.current.joyDx;
      dy = pointerRef.current.joyDy;
    }
    if (dx === 0 && dy === 0) {
      dx = Math.cos(sim.hero.aimAngle);
      dy = Math.sin(sim.hero.aimAngle);
    }
    const len = Math.hypot(dx, dy) || 1;
    sim.hero.dashVx = (dx / len) * 700;
    sim.hero.dashVy = (dy / len) * 700;
    sim.hero.dashTimer = 0.16;
    sim.hero.dashCooldown = 1.55;
    sim.hero.invulnTimer = Math.max(sim.hero.invulnTimer, 0.25);
    audioRef.current?.play('dash', mutedRef.current);
  }, []);

  const submitAnswerChoice = useCallback(
    async (chosenText: string) => {
      if (!activeQuestion || submittingAnswer || answerFeedback) return;
      const clean = chosenText.trim();
      if (!clean) return;
      setSubmittingAnswer(true);
      try {
        const res = await onSubmitBrawlAnswer(activeQuestion, clean);
        setAnswerFeedback(res);
        audioRef.current?.play(res.correct ? 'correct' : 'wrong', mutedRef.current);

        const sim = simRef.current;
        if (res.correct && sim.hero.hp > 0) {
          sim.hero.hp = Math.min(sim.hero.maxHp, sim.hero.hp + 20);
          sim.hero.invulnTimer = Math.max(sim.hero.invulnTimer, 1.5);
        }
      } finally {
        setSubmittingAnswer(false);
      }
    },
    [activeQuestion, submittingAnswer, answerFeedback, onSubmitBrawlAnswer]
  );

  const retryLevelUpQuestion = useCallback(() => {
    if (!brawlDeck.length) {
      triggerUpgradeChoice();
      return;
    }
    const idx = questionCursorRef.current % brawlDeck.length;
    questionCursorRef.current += 1;
    setActiveQuestion(brawlDeck[idx]);
    setTypedAnswer('');
    setAnswerFeedback(null);
    setSubmittingAnswer(false);
  }, [brawlDeck, triggerUpgradeChoice]);

  const continueAfterQuiz = useCallback(() => {
    const wasCorrect = Boolean(answerFeedback?.correct);
    setActiveQuestion(null);
    setAnswerFeedback(null);

    if (wasCorrect) {
      triggerUpgradeChoice();
      return;
    }
    simRef.current.hero.invulnTimer = Math.max(simRef.current.hero.invulnTimer, 1.2);
    spawnResumeShockwave(160, 15);
    setOverlay('PLAYING');
  }, [answerFeedback, spawnResumeShockwave, triggerUpgradeChoice]);

  // Global keyboard shortcuts inside Monster Brawl
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');

      if (overlayRef.current === 'STARTER_PICK' || overlayRef.current === 'LEVEL_UP') {
        if (['1', '2', '3'].includes(e.key)) {
          const idx = Number(e.key) - 1;
          if (upgradeOptions[idx]) {
            e.preventDefault();
            applyAbilityUpgrade(upgradeOptions[idx]);
          }
        }
        return;
      }

      if (overlayRef.current === 'LEVEL_UP_QUIZ') {
        if (answerFeedback && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          if (!answerFeedback.correct) {
            retryLevelUpQuestion();
          } else {
            continueAfterQuiz();
          }
          return;
        }
        if (!inInput && !answerFeedback && activeQuestion?.choices?.length) {
          const mapIdx =
            e.key === '1' || e.key.toLowerCase() === 'a'
              ? 0
              : e.key === '2' || e.key.toLowerCase() === 'b'
              ? 1
              : e.key === '3' || e.key.toLowerCase() === 'c'
              ? 2
              : e.key === '4' || e.key.toLowerCase() === 'd'
              ? 3
              : -1;
          if (mapIdx >= 0 && activeQuestion.choices[mapIdx]) {
            e.preventDefault();
            void submitAnswerChoice(activeQuestion.choices[mapIdx]);
          }
        }
        return;
      }

      if (overlayRef.current === 'GAME_OVER' || inInput) return;

      const lower = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(lower)) {
        keysRef.current.add(lower);
        if (lower.startsWith('arrow')) e.preventDefault();
      } else if (e.key === ' ' || e.key === 'Shift') {
        e.preventDefault();
        handleTriggerDash();
      } else if (lower === 'p' || e.key === 'Escape') {
        setPaused((p) => !p);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    upgradeOptions,
    applyAbilityUpgrade,
    answerFeedback,
    activeQuestion,
    submitAnswerChoice,
    retryLevelUpQuestion,
    continueAfterQuiz,
    handleTriggerDash,
  ]);

  // Core 60fps Game Loop (Supports Solo, Co-op Host Authority, and Co-op Guest Sync)
  useEffect(() => {
    let rafId = 0;
    let lastTime = performance.now();
    let hudSyncTimer = 0;

    const grantHeroXp = (amount: number) => {
      if (amount <= 0) return;
      const sim = simRef.current;
      sim.hero.xp += amount;
      sim.hero.xpInLevel += amount;
      while (sim.hero.xpInLevel >= xpRequiredForLevel(sim.hero.level)) {
        sim.hero.xpInLevel -= xpRequiredForLevel(sim.hero.level);
        sim.hero.level += 1;
        sim.pendingUpgrades += 1;
      }
    };

    const spawnMonster = (wave: number, forceBoss = false) => {
      const sim = simRef.current;
      const scale = computeBrawlScale(difficultyRef.current, connectedCountRef.current);
      const prof = scale.profile;

      let kind: MonsterArchetypeId = 'slime';
      if (forceBoss) {
        kind = 'titan';
      } else {
        const eligible: MonsterArchetypeId[] = ['slime'];
        if (wave >= prof.unlockImpWave) eligible.push('imp');
        if (wave >= prof.unlockGolemWave) eligible.push('golem');
        if (wave >= prof.unlockDrakeWave) eligible.push('drake');
        const roll = Math.random();
        if (eligible.length === 1) kind = 'slime';
        else if (roll < 0.34) kind = eligible[0];
        else if (roll < 0.62) kind = eligible[1] || 'slime';
        else if (roll < 0.85) kind = eligible[2] || eligible[eligible.length - 1];
        else kind = eligible[eligible.length - 1];
      }

      const arch = MONSTER_ARCHETYPES[kind];

      // Pick a random active (alive & non-shielded) player anchor so co-op hordes distribute fairly
      const anchors: Array<{ x: number; y: number }> = [];
      if (overlayRef.current === 'PLAYING' && sim.hero.hp > 0) {
        anchors.push({ x: sim.hero.x, y: sim.hero.y });
      }
      for (const rh of remoteHeroesRef.current.values()) {
        if (!rh.shielded && rh.hp > 0) anchors.push({ x: rh.x, y: rh.y });
      }
      const anchor =
        anchors.length > 0
          ? anchors[Math.floor(Math.random() * anchors.length)]
          : { x: sim.hero.x, y: sim.hero.y };

      const angle = Math.random() * Math.PI * 2;
      const spawnDist = forceBoss ? 480 : 420 + Math.random() * 190;
      const sx = clamp(
        anchor.x + Math.cos(angle) * spawnDist,
        ARENA_MARGIN + arch.radius,
        WORLD_W - ARENA_MARGIN - arch.radius
      );
      const sy = clamp(
        anchor.y + Math.sin(angle) * spawnDist,
        ARENA_MARGIN + arch.radius,
        WORLD_H - ARENA_MARGIN - arch.radius
      );

      const waveHpScale = 1 + (wave - 1) * 0.24;
      const hp = Math.max(12, Math.round(arch.baseHp * waveHpScale * scale.hpMult));
      const speed =
        arch.baseSpeed * (1 + Math.min(0.45, (wave - 1) * 0.045)) * scale.speedMult;
      const damage = Math.max(
        5,
        Math.round(arch.damage * (1 + (wave - 1) * 0.09) * scale.damageMult)
      );
      const xpValue = Math.max(
        4,
        Math.round(arch.xpValue * (1 + (wave - 1) * 0.1) * prof.xpGainMult)
      );

      sim.monsters.push({
        uid: sim.nextUid++,
        kind,
        x: sx,
        y: sy,
        vx: 0,
        vy: 0,
        hp,
        maxHp: hp,
        speed,
        radius: arch.radius,
        damage,
        xpValue,
        flashTimer: 0,
        spawnTimer: 0.45,
        facing: sx > anchor.x ? -1 : 1,
        phaseOffset: Math.random() * Math.PI * 2,
        shootCooldown: arch.rangedFire
          ? (1.9 + Math.random() * 1.1) * prof.rangedCooldownMult
          : 999,
        isBoss: Boolean(arch.isBoss),
      });
    };

    const damageMonster = (
      m: MonsterEntity,
      dmg: number,
      kbX: number,
      kbY: number,
      crit = false,
      reportToHost = false
    ) => {
      const sim = simRef.current;
      m.flashTimer = 0.12;
      if (reportToHost) {
        pendingGuestHitsRef.current.push({
          uid: m.uid,
          dmg: Math.round(dmg),
          kbX: Math.round(kbX),
          kbY: Math.round(kbY),
          crit,
        });
      } else {
        m.hp -= dmg;
        const kbResist = m.isBoss ? 0.18 : m.kind === 'golem' ? 0.45 : 1;
        m.vx += kbX * kbResist;
        m.vy += kbY * kbResist;
      }

      sim.dmgTexts.push({
        x: m.x + (Math.random() - 0.5) * 16,
        y: m.y - m.radius - 6,
        vy: -54,
        text: crit ? `${Math.round(dmg)}!` : `${Math.round(dmg)}`,
        color: crit ? '#fde047' : '#ffffff',
        life: 0.65,
        maxLife: 0.65,
        big: crit,
      });

      if (crit && !reducedMotionRef.current) {
        sim.shakeTimer = Math.max(sim.shakeTimer, 0.08);
        sim.shakePower = Math.max(sim.shakePower, 3);
      }
      audioRef.current?.play('hit', mutedRef.current);
    };

    // Initial wave monsters if host or solo
    if ((isHostRef.current || !coopChannelRef.current?.isRealtimeServer) && simRef.current.monsters.length === 0) {
      const initScale = computeBrawlScale(difficultyRef.current, connectedCountRef.current);
      const initialCount = Math.min(10, Math.max(4, Math.round(4 * initScale.spawnRateMult)));
      for (let i = 0; i < initialCount; i++) {
        spawnMonster(1, false);
      }
    }

    const tick = (now: number) => {
      rafId = window.requestAnimationFrame(tick);
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const dt = Math.min(0.05, Math.max(0.001, rawDt));

      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = container.getBoundingClientRect();
      const viewW = Math.max(320, Math.floor(rect.width));
      const viewH = Math.max(280, Math.floor(rect.height));
      if (canvas.width !== Math.floor(viewW * dpr) || canvas.height !== Math.floor(viewH * dpr)) {
        canvas.width = Math.floor(viewW * dpr);
        canvas.height = Math.floor(viewH * dpr);
      }

      const sim = simRef.current;
      const channel = coopChannelRef.current;
      const cCount = connectedCountRef.current;
      const isRealtimeCoop = Boolean(channel?.isRealtimeServer && cCount > 1);
      const isGuestCoop = isRealtimeCoop && !isHostRef.current;
      const worldAuthority = !isGuestCoop;
      const scale = computeBrawlScale(difficultyRef.current, cCount);
      const isDefeated = overlayRef.current === 'GAME_OVER' || sim.hero.hp <= 0;
      const localShielded = !isDefeated && overlayRef.current !== 'PLAYING';

      // Prune stale remote heroes & interpolate remote positions at 60fps
      const connectedIdSet = new Set(
        roomPlayersRef.current.filter((p) => p.connected).map((p) => p.id)
      );
      for (const [rhId, rh] of remoteHeroesRef.current.entries()) {
        if (!connectedIdSet.has(rhId) || now - rh.lastSeenAt > 5000) {
          remoteHeroesRef.current.delete(rhId);
          continue;
        }
        const prevX = rh.x;
        const prevY = rh.y;
        rh.x += (rh.targetX - rh.x) * Math.min(1, dt * 16);
        rh.y += (rh.targetY - rh.y) * Math.min(1, dt * 16);
        const moved = Math.hypot(rh.x - prevX, rh.y - prevY);
        if (moved > 0.35 && rh.hp > 0) {
          rh.walkPhase += dt * 11;
        }
        if (rh.dashing && rh.hp > 0 && Math.random() < 0.65) {
          const palette = TEAMMATE_PALETTE[colorIndexForId(rhId)];
          sim.afterImages.push({ x: rh.x, y: rh.y, life: 0.2, color: palette.top });
        }
      }

      // Respawn initial monsters if Solo restarted from GAME_OVER
      if (worldAuthority && sim.monsters.length === 0 && overlayRef.current === 'STARTER_PICK' && sim.wave === 1) {
        const initScale = computeBrawlScale(difficultyRef.current, cCount);
        const initialCount = Math.min(10, Math.max(4, Math.round(4 * initScale.spawnRateMult)));
        for (let i = 0; i < initialCount; i++) {
          spawnMonster(1, false);
        }
      }

      // In Solo, any modal (including GAME_OVER) freezes simulation; in Co-op, world runs live while teammates fight
      const simRunning = cCount > 1 ? !pausedRef.current : overlayRef.current === 'PLAYING' && !pausedRef.current;
      const heroCanAct = !isDefeated && overlayRef.current === 'PLAYING' && !pausedRef.current;

      // Clear expired crystal suppression cache
      for (const [cid, exp] of locallyPickedCrystalIdsRef.current.entries()) {
        if (now > exp) locallyPickedCrystalIdsRef.current.delete(cid);
      }

      if (simRunning) {
        const hero = sim.hero;
        hero.dashTimer = Math.max(0, hero.dashTimer - dt);
        hero.dashCooldown = Math.max(0, hero.dashCooldown - dt);
        hero.invulnTimer = Math.max(0, hero.invulnTimer - dt);
        sim.shakeTimer = Math.max(0, sim.shakeTimer - dt);

        // ------------------------------------------------------------------
        // 1. LOCAL HERO MOVEMENT & TARGETING
        // ------------------------------------------------------------------
        if (heroCanAct) {
          const speedMult = 1 + sim.abilities.magnet * 0.14;
          const moveSpeed = 242 * speedMult;

          if (hero.dashTimer > 0) {
            hero.vx = hero.dashVx;
            hero.vy = hero.dashVy;
            sim.afterImages.push({ x: hero.x, y: hero.y, life: 0.22, color: '#38bdf8' });
          } else {
            let mx = 0;
            let my = 0;
            const keys = keysRef.current;
            if (keys.has('w') || keys.has('arrowup')) my -= 1;
            if (keys.has('s') || keys.has('arrowdown')) my += 1;
            if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
            if (keys.has('d') || keys.has('arrowright')) mx += 1;

            if (mx === 0 && my === 0 && pointerRef.current.pointerDown) {
              const jx = pointerRef.current.joyDx;
              const jy = pointerRef.current.joyDy;
              const jDist = Math.hypot(jx, jy);
              if (jDist > 6) {
                mx = jx / jDist;
                my = jy / jDist;
              }
            }

            const mLen = Math.hypot(mx, my);
            if (mLen > 0) {
              hero.vx = (mx / mLen) * moveSpeed;
              hero.vy = (my / mLen) * moveSpeed;
              hero.walkPhase += dt * 11;
              if (Math.abs(hero.vx) > 8) {
                hero.facing = hero.vx >= 0 ? 1 : -1;
              }
            } else {
              hero.vx *= Math.pow(0.001, dt);
              hero.vy *= Math.pow(0.001, dt);
            }
          }

          hero.x = clamp(
            hero.x + hero.vx * dt,
            ARENA_MARGIN + hero.radius,
            WORLD_W - ARENA_MARGIN - hero.radius
          );
          hero.y = clamp(
            hero.y + hero.vy * dt,
            ARENA_MARGIN + hero.radius,
            WORLD_H - ARENA_MARGIN - hero.radius
          );

          // Collide hero smoothly with stone pillars
          for (const p of PILLARS) {
            const dx = hero.x - p.x;
            const dy = hero.y - p.y;
            const dist = Math.hypot(dx, dy);
            const minDist = hero.radius + p.r;
            if (dist > 0 && dist < minDist) {
              hero.x = p.x + (dx / dist) * minDist;
              hero.y = p.y + (dy / dist) * minDist;
            }
          }
        } else {
          hero.vx = 0;
          hero.vy = 0;
        }

        // ------------------------------------------------------------------
        // 2. GUEST WORLD SNAPSHOT RECONCILIATION (When !isHost in Real-Time Co-op)
        // ------------------------------------------------------------------
        if (isGuestCoop && latestWorldSnapshotRef.current) {
          const snap = latestWorldSnapshotRef.current;
          latestWorldSnapshotRef.current = null;

          sim.wave = snap.wave;
          sim.waveTimer = snap.waveTimer;

          // Apply authoritative XP & Heart Assist Grants from Host
          const myId = playerIdRef.current;
          if (myId) {
            const totalGrantedXp = snap.xpGrants?.[myId] || 0;
            if (totalGrantedXp > appliedXpGrantRef.current) {
              const delta = totalGrantedXp - appliedXpGrantRef.current;
              appliedXpGrantRef.current = totalGrantedXp;
              grantHeroXp(delta);
            }
            const totalGrantedHeal = snap.healGrants?.[myId] || 0;
            if (totalGrantedHeal > appliedHealGrantRef.current) {
              const deltaH = totalGrantedHeal - appliedHealGrantRef.current;
              appliedHealGrantRef.current = totalGrantedHeal;
              hero.hp = Math.min(hero.maxHp, hero.hp + deltaH);
              sim.dmgTexts.push({
                x: hero.x,
                y: hero.y - 32,
                vy: -36,
                text: `+${deltaH} HP`,
                color: '#4ade80',
                life: 0.85,
                maxLife: 0.85,
              });
            }
          }

          // Reconcile Monsters by UID for smooth 60fps movement
          const existingMap = new Map<number, MonsterEntity>();
          for (const m of sim.monsters) existingMap.set(m.uid, m);

          const nextMonsters: MonsterEntity[] = [];
          for (const nm of snap.monsters) {
            const prev = existingMap.get(nm.uid);
            if (prev) {
              prev.targetX = nm.x;
              prev.targetY = nm.y;
              prev.vx = nm.vx;
              prev.vy = nm.vy;
              prev.hp = nm.hp;
              prev.maxHp = nm.maxHp;
              prev.speed = nm.speed;
              prev.damage = nm.damage;
              prev.facing = nm.facing;
              prev.spawnTimer = nm.spawnTimer;
              prev.isBoss = nm.isBoss;
              prev.flashTimer = Math.max(prev.flashTimer, nm.flashTimer);
              nextMonsters.push(prev);
            } else {
              nextMonsters.push({
                uid: nm.uid,
                kind: nm.kind,
                x: nm.x,
                y: nm.y,
                targetX: nm.x,
                targetY: nm.y,
                vx: nm.vx,
                vy: nm.vy,
                hp: nm.hp,
                maxHp: nm.maxHp,
                speed: nm.speed,
                radius: nm.radius,
                damage: nm.damage,
                xpValue: nm.xpValue,
                flashTimer: nm.flashTimer,
                spawnTimer: nm.spawnTimer,
                facing: nm.facing,
                phaseOffset: (nm.uid * 1.37) % (Math.PI * 2),
                shootCooldown: 999,
                isBoss: nm.isBoss,
              });
            }
          }
          sim.monsters = nextMonsters;

          // Reconcile Crystals (skipping ones just picked up locally)
          const existingCrystals = new Map<number, XpCrystalEntity>();
          for (const c of sim.crystals) existingCrystals.set(c.id, c);
          const nextCrystals: XpCrystalEntity[] = [];
          for (const nc of snap.crystals) {
            if (locallyPickedCrystalIdsRef.current.has(nc.id)) continue;
            const prevC = existingCrystals.get(nc.id);
            nextCrystals.push({
              id: nc.id,
              x: prevC ? prevC.x + (nc.x - prevC.x) * 0.45 : nc.x,
              y: prevC ? prevC.y + (nc.y - prevC.y) * 0.45 : nc.y,
              vx: prevC ? prevC.vx : 0,
              vy: prevC ? prevC.vy : 0,
              value: nc.value,
              kind: nc.kind,
              life: 24,
            });
          }
          sim.crystals = nextCrystals;

          // Reconcile Enemy Projectiles while preserving local friendly homing bolts
          const friendlyProjectiles = sim.projectiles.filter((p) => !p.fromEnemy);
          const enemyProjectiles: ProjectileEntity[] = snap.enemyProjectiles.map((ep) => ({
            id: ep.id,
            x: ep.x,
            y: ep.y,
            vx: ep.vx,
            vy: ep.vy,
            radius: ep.radius,
            damage: ep.damage,
            life: 2.3,
            fromEnemy: true,
            color: ep.color,
            homing: false,
          }));
          sim.projectiles = [...friendlyProjectiles, ...enemyProjectiles];
        }

        // Consume incoming teammate action VFX & Guest damage/crystal events
        while (incomingGuestActionsRef.current.length > 0) {
          const act = incomingGuestActionsRef.current.shift()!;
          if (act.slash) {
            sim.slashes.push({
              ...act.slash,
              life: 0.2,
              maxLife: 0.2,
            });
          }
          if (act.bolt) {
            sim.bolts.push({
              points: act.bolt.points,
              life: 0.24,
              maxLife: 0.24,
            });
          }
          if (act.nova) {
            sim.novas.push({
              ...act.nova,
              life: 0.42,
              maxLife: 0.42,
            });
          }

          if (worldAuthority) {
            if (act.hits?.length) {
              for (const h of act.hits) {
                const target = sim.monsters.find((m) => m.uid === h.uid);
                if (target) {
                  damageMonster(target, h.dmg, h.kbX, h.kbY, h.crit, false);
                }
              }
            }
            if (act.pickedCrystalIds?.length) {
              const pickerId = act.playerId;
              for (const cid of act.pickedCrystalIds) {
                const idx = sim.crystals.findIndex((c) => c.id === cid);
                if (idx === -1) continue;
                const cr = sim.crystals[idx];
                sim.crystals.splice(idx, 1);

                if (cr.kind === 'heart') {
                  hostHealGrantsRef.current[pickerId] =
                    (hostHealGrantsRef.current[pickerId] || 0) + cr.value;
                  // Co-op Heart Assist heal for Host + other teammates
                  const assistHeal = Math.max(8, Math.round(cr.value * 0.4));
                  hero.hp = Math.min(hero.maxHp, hero.hp + assistHeal);
                  for (const rhId of remoteHeroesRef.current.keys()) {
                    if (rhId !== pickerId) {
                      hostHealGrantsRef.current[rhId] =
                        (hostHealGrantsRef.current[rhId] || 0) + assistHeal;
                    }
                  }
                } else {
                  hostXpGrantsRef.current[pickerId] =
                    (hostXpGrantsRef.current[pickerId] || 0) + cr.value;
                  // Co-op XP Assist: 50% shared XP to teammates so fighting together rewards everyone
                  const assistXp = Math.max(2, Math.round(cr.value * 0.5));
                  grantHeroXp(assistXp);
                  for (const rhId of remoteHeroesRef.current.keys()) {
                    if (rhId !== pickerId) {
                      hostXpGrantsRef.current[rhId] =
                        (hostXpGrantsRef.current[rhId] || 0) + assistXp;
                    }
                  }
                }
              }
            }
          }
        }

        // Find nearest active monster for hero auto-aim & weapons
        let nearest: MonsterEntity | null = null;
        let nearestDist = Infinity;
        for (const m of sim.monsters) {
          if (m.spawnTimer > 0) continue;
          const d = Math.hypot(m.x - hero.x, m.y - hero.y);
          if (d < nearestDist) {
            nearestDist = d;
            nearest = m;
          }
        }
        if (heroCanAct) {
          if (nearest && nearestDist < 440) {
            hero.aimAngle = Math.atan2(nearest.y - hero.y, nearest.x - hero.x);
          } else if (pointerRef.current.active) {
            const worldPtrX = pointerRef.current.screenX + (sim.cameraX - viewW / 2);
            const worldPtrY = pointerRef.current.screenY + (sim.cameraY - viewH / 2);
            hero.aimAngle = Math.atan2(worldPtrY - hero.y, worldPtrX - hero.x);
          }
        }

        // ------------------------------------------------------------------
        // 3. HOST / SOLO WAVE PROGRESSION & DIFFICULTY-SCALED SPAWNING
        // ------------------------------------------------------------------
        if (worldAuthority) {
          sim.waveTimer -= dt;
          if (sim.waveTimer <= 0) {
            sim.wave += 1;
            sim.waveTimer = 26;
            if (
              sim.wave % scale.profile.bossWaveInterval === 0 &&
              sim.bossSpawnedForWave !== sim.wave
            ) {
              sim.bossSpawnedForWave = sim.wave;
              const bossCount = sim.wave >= scale.profile.dualBossFromWave ? 2 : 1;
              for (let b = 0; b < bossCount; b++) {
                spawnMonster(sim.wave, true);
              }
              audioRef.current?.play('boss', mutedRef.current);
              if (!reducedMotionRef.current) {
                sim.shakeTimer = 0.28;
                sim.shakePower = 7;
              }
            }
          }

          const maxMonsters = Math.min(
            54,
            scale.maxMonstersBase + sim.wave * scale.maxMonstersPerWave
          );
          const spawnInterval = Math.max(
            0.28,
            (1.82 - sim.wave * 0.13) / scale.spawnRateMult
          );
          sim.spawnAccum += dt;
          if (sim.spawnAccum >= spawnInterval && sim.monsters.length < maxMonsters) {
            sim.spawnAccum = 0;
            spawnMonster(sim.wave, false);
          }
        }

        // ------------------------------------------------------------------
        // 4. LOCAL HERO AUTO-WEAPONS (Active only when playing, not shielded)
        // ------------------------------------------------------------------
        if (heroCanAct) {
          // WEAPON 1: Emerald Crescent Slash
          const slashLvl = sim.abilities.slash;
          if (slashLvl > 0) {
            sim.cooldowns.slash -= dt;
            if (sim.cooldowns.slash <= 0 && (nearestDist < 240 || sim.monsters.length > 0)) {
              sim.cooldowns.slash = Math.max(0.38, 0.92 - (slashLvl - 1) * 0.09);
              const slashRadius = 96 + (slashLvl - 1) * 16;
              const slashDmg = 24 + (slashLvl - 1) * 9;
              const angle = hero.aimAngle;
              const slashObj = {
                x: hero.x,
                y: hero.y,
                angle,
                radius: slashRadius,
                color: '#34d399',
              };
              sim.slashes.push({ ...slashObj, life: 0.2, maxLife: 0.2 });
              if (isRealtimeCoop) {
                pendingSlashRef.current = slashObj;
              }
              audioRef.current?.play('slash', mutedRef.current);

              for (const m of sim.monsters) {
                if (m.spawnTimer > 0) continue;
                const dx = m.x - hero.x;
                const dy = m.y - hero.y;
                const d = Math.hypot(dx, dy);
                if (d <= slashRadius + m.radius) {
                  let diff = Math.atan2(dy, dx) - angle;
                  while (diff > Math.PI) diff -= Math.PI * 2;
                  while (diff < -Math.PI) diff += Math.PI * 2;
                  if (Math.abs(diff) <= Math.PI * 0.62 || d < 42) {
                    const crit = Math.random() < 0.22;
                    const mult = crit ? 1.65 : 1;
                    const dirLen = d || 1;
                    damageMonster(
                      m,
                      slashDmg * mult,
                      (dx / dirLen) * 240,
                      (dy / dirLen) * 240,
                      crit,
                      isGuestCoop
                    );
                  }
                }
              }
            }
          }

          // WEAPON 2: Arcane Barrage (homing bolts)
          const boltLvl = sim.abilities.bolt;
          if (boltLvl > 0) {
            sim.cooldowns.bolt -= dt;
            if (sim.cooldowns.bolt <= 0 && nearest) {
              sim.cooldowns.bolt = Math.max(0.32, 0.9 - (boltLvl - 1) * 0.1);
              const count = boltLvl >= 4 ? 3 : boltLvl >= 2 ? 2 : 1;
              const targetAngle = Math.atan2(nearest.y - hero.y, nearest.x - hero.x);
              for (let b = 0; b < count; b++) {
                const spread = (b - (count - 1) / 2) * 0.22;
                const a = targetAngle + spread;
                sim.projectiles.push({
                  id: sim.nextProjId++,
                  x: hero.x + Math.cos(a) * 18,
                  y: hero.y + Math.sin(a) * 18,
                  vx: Math.cos(a) * 440,
                  vy: Math.sin(a) * 440,
                  radius: 7,
                  damage: 24 + boltLvl * 7,
                  life: 1.5,
                  fromEnemy: false,
                  color: '#38bdf8',
                  homing: true,
                });
              }
            }
          }

          // WEAPON 3: Frost Orbitals
          const orbitLvl = sim.abilities.orbit;
          if (orbitLvl > 0) {
            sim.orbitAngle += dt * (2.6 + orbitLvl * 0.35);
            const orbCount = orbitLvl + 1;
            const orbDist = 74 + orbitLvl * 4;
            for (let o = 0; o < orbCount; o++) {
              const a = sim.orbitAngle + (o * Math.PI * 2) / orbCount;
              const ox = hero.x + Math.cos(a) * orbDist;
              const oy = hero.y + Math.sin(a) * orbDist;
              for (const m of sim.monsters) {
                if (m.spawnTimer > 0 || m.flashTimer > 0) continue;
                const dx = m.x - ox;
                const dy = m.y - oy;
                if (Math.hypot(dx, dy) < m.radius + 14) {
                  const len = Math.hypot(m.x - hero.x, m.y - hero.y) || 1;
                  damageMonster(
                    m,
                    22 + orbitLvl * 6,
                    ((m.x - hero.x) / len) * 210,
                    ((m.y - hero.y) / len) * 210,
                    false,
                    isGuestCoop
                  );
                }
              }
            }
          }

          // WEAPON 4: Storm Chain Lightning
          const lightLvl = sim.abilities.lightning;
          if (lightLvl > 0) {
            sim.cooldowns.lightning -= dt;
            if (sim.cooldowns.lightning <= 0 && nearest && nearestDist < 380) {
              sim.cooldowns.lightning = Math.max(0.85, 2.2 - lightLvl * 0.24);
              const jumps = Math.min(4, 1 + lightLvl);
              const hitSet = new Set<number>();
              const pts: Array<{ x: number; y: number }> = [{ x: hero.x, y: hero.y }];
              let curX = hero.x;
              let curY = hero.y;
              for (let j = 0; j < jumps; j++) {
                let bestM: MonsterEntity | null = null;
                let bestD = 260;
                for (const m of sim.monsters) {
                  if (m.spawnTimer > 0 || hitSet.has(m.uid)) continue;
                  const d = Math.hypot(m.x - curX, m.y - curY);
                  if (d < bestD) {
                    bestD = d;
                    bestM = m;
                  }
                }
                if (!bestM) break;
                hitSet.add(bestM.uid);
                pts.push({ x: bestM.x, y: bestM.y });
                damageMonster(bestM, 26 + lightLvl * 8, 0, 0, true, isGuestCoop);
                curX = bestM.x;
                curY = bestM.y;
              }
              if (pts.length > 1) {
                sim.bolts.push({ points: pts, life: 0.24, maxLife: 0.24 });
                if (isRealtimeCoop) {
                  pendingBoltRef.current = { points: pts };
                }
              }
            }
          }

          // WEAPON 5: Meteor Nova Shockwave
          const novaLvl = sim.abilities.nova;
          if (novaLvl > 0) {
            sim.cooldowns.nova -= dt;
            if (sim.cooldowns.nova <= 0) {
              sim.cooldowns.nova = Math.max(1.8, 4.2 - novaLvl * 0.42);
              const maxRad = 145 + novaLvl * 26;
              const novaObj = { x: hero.x, y: hero.y, maxRadius: maxRad, color: '#fb7185' };
              sim.novas.push({ ...novaObj, life: 0.42, maxLife: 0.42 });
              if (isRealtimeCoop) {
                pendingNovaRef.current = novaObj;
              }
              for (const m of sim.monsters) {
                if (m.spawnTimer > 0) continue;
                const dx = m.x - hero.x;
                const dy = m.y - hero.y;
                const d = Math.hypot(dx, dy) || 1;
                if (d <= maxRad + m.radius) {
                  damageMonster(
                    m,
                    32 + novaLvl * 11,
                    (dx / d) * 320,
                    (dy / d) * 320,
                    true,
                    isGuestCoop
                  );
                }
              }
            }
          }
        }

        // ------------------------------------------------------------------
        // 5. PROJECTILES UPDATE (Friendly everywhere; Enemy authoritative on Host)
        // ------------------------------------------------------------------
        for (let i = sim.projectiles.length - 1; i >= 0; i--) {
          const pr = sim.projectiles[i];
          pr.life -= dt;
          if (pr.life <= 0) {
            sim.projectiles.splice(i, 1);
            continue;
          }

          if (!pr.fromEnemy && pr.homing && nearest) {
            const desiredAngle = Math.atan2(nearest.y - pr.y, nearest.x - pr.x);
            const curAngle = Math.atan2(pr.vy, pr.vx);
            let diff = desiredAngle - curAngle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const nextAngle = curAngle + clamp(diff, -5.5 * dt, 5.5 * dt);
            const spd = Math.hypot(pr.vx, pr.vy);
            pr.vx = Math.cos(nextAngle) * spd;
            pr.vy = Math.sin(nextAngle) * spd;
          }

          pr.x += pr.vx * dt;
          pr.y += pr.vy * dt;

          let hitWall =
            pr.x < ARENA_MARGIN ||
            pr.x > WORLD_W - ARENA_MARGIN ||
            pr.y < ARENA_MARGIN ||
            pr.y > WORLD_H - ARENA_MARGIN;
          if (!hitWall) {
            for (const pil of PILLARS) {
              if (Math.hypot(pr.x - pil.x, pr.y - pil.y) < pil.r + pr.radius) {
                hitWall = true;
                break;
              }
            }
          }
          if (hitWall) {
            sim.projectiles.splice(i, 1);
            continue;
          }

          if (pr.fromEnemy) {
            if (
              !localShielded &&
              hero.invulnTimer <= 0 &&
              Math.hypot(pr.x - hero.x, pr.y - hero.y) < hero.radius + pr.radius
            ) {
              hero.hp = Math.max(0, hero.hp - pr.damage);
              hero.invulnTimer = scale.profile.invulnDuration;
              audioRef.current?.play('hurt', mutedRef.current);
              if (!reducedMotionRef.current) {
                sim.shakeTimer = 0.14;
                sim.shakePower = 5;
              }
              sim.projectiles.splice(i, 1);
            }
          } else {
            let consumed = false;
            for (const m of sim.monsters) {
              if (m.spawnTimer > 0) continue;
              const dx = m.x - pr.x;
              const dy = m.y - pr.y;
              if (Math.hypot(dx, dy) < m.radius + pr.radius) {
                damageMonster(
                  m,
                  pr.damage,
                  (pr.vx / (Math.hypot(pr.vx, pr.vy) || 1)) * 140,
                  (pr.vy / (Math.hypot(pr.vx, pr.vy) || 1)) * 140,
                  false,
                  isGuestCoop
                );
                consumed = true;
                break;
              }
            }
            if (consumed) {
              sim.projectiles.splice(i, 1);
            }
          }
        }

        // ------------------------------------------------------------------
        // 6. MONSTERS UPDATE & AI CHASE (Authoritative on Host/Solo, Smooth on Guest)
        // ------------------------------------------------------------------
        for (let i = sim.monsters.length - 1; i >= 0; i--) {
          const m = sim.monsters[i];

          if (worldAuthority && m.hp <= 0) {
            hero.kills += 1;
            const arch = MONSTER_ARCHETYPES[m.kind];
            for (let p = 0; p < (m.isBoss ? 22 : 9); p++) {
              const pa = Math.random() * Math.PI * 2;
              const ps = 60 + Math.random() * 140;
              sim.particles.push({
                x: m.x,
                y: m.y,
                vx: Math.cos(pa) * ps,
                vy: Math.sin(pa) * ps,
                size: m.isBoss ? 6 : 4,
                color: p % 2 === 0 ? arch.auraColor : arch.accentColor,
                life: 0.45,
                maxLife: 0.45,
              });
            }
            sim.crystals.push({
              id: sim.nextCrystalId++,
              x: m.x,
              y: m.y,
              vx: (Math.random() - 0.5) * 80,
              vy: (Math.random() - 0.5) * 80,
              value: m.xpValue,
              kind: m.isBoss ? 'gold' : m.kind === 'golem' || m.kind === 'drake' ? 'cyan' : 'emerald',
              life: 26,
            });
            if (m.isBoss || Math.random() < 0.08) {
              sim.crystals.push({
                id: sim.nextCrystalId++,
                x: m.x + 14,
                y: m.y - 10,
                vx: 40,
                vy: -40,
                value: 25,
                kind: 'heart',
                life: 26,
              });
            }
            sim.monsters.splice(i, 1);
            continue;
          }

          m.flashTimer = Math.max(0, m.flashTimer - dt);
          if (m.spawnTimer > 0) {
            m.spawnTimer = Math.max(0, m.spawnTimer - dt);
            continue;
          }

          if (isGuestCoop) {
            // Smooth visual interpolation + gentle velocity extrapolation between Host snapshots
            if (m.targetX !== undefined && m.targetY !== undefined) {
              m.targetX += m.vx * dt * 0.55;
              m.targetY += m.vy * dt * 0.55;
              m.x += (m.targetX - m.x) * Math.min(1, dt * 15);
              m.y += (m.targetY - m.y) * Math.min(1, dt * 15);
            }
          } else {
            // Host / Solo: chase nearest alive non-shielded player (patrol center if none active)
            let targetX = hero.x;
            let targetY = hero.y;
            let targetDist =
              localShielded || isDefeated ? Infinity : Math.hypot(hero.x - m.x, hero.y - m.y);

            for (const rh of remoteHeroesRef.current.values()) {
              if (rh.shielded || rh.hp <= 0) continue;
              const rd = Math.hypot(rh.x - m.x, rh.y - m.y);
              if (rd < targetDist) {
                targetDist = rd;
                targetX = rh.x;
                targetY = rh.y;
              }
            }

            if (targetDist === Infinity) {
              targetX = WORLD_W / 2 + Math.cos(now / 1000 + m.phaseOffset) * 180;
              targetY = WORLD_H / 2 + Math.sin(now / 1000 + m.phaseOffset) * 140;
            }

            const tdx = targetX - m.x;
            const tdy = targetY - m.y;
            const tdist = Math.hypot(tdx, tdy) || 1;
            m.facing = tdx >= 0 ? 1 : -1;

            const chaseVx = (tdx / tdist) * m.speed;
            const chaseVy = (tdy / tdist) * m.speed;
            m.vx *= Math.pow(0.02, dt);
            m.vy *= Math.pow(0.02, dt);
            m.x += (chaseVx + m.vx) * dt;
            m.y += (chaseVy + m.vy) * dt;

            // Soft monster separation
            for (let j = i - 1; j >= 0; j--) {
              const o = sim.monsters[j];
              if (o.spawnTimer > 0) continue;
              const sdx = m.x - o.x;
              const sdy = m.y - o.y;
              const sd = Math.hypot(sdx, sdy);
              const minSep = (m.radius + o.radius) * 0.72;
              if (sd > 0 && sd < minSep) {
                const push = (minSep - sd) * 0.5;
                m.x += (sdx / sd) * push;
                m.y += (sdy / sd) * push;
                o.x -= (sdx / sd) * push;
                o.y -= (sdy / sd) * push;
              }
            }

            // Pillar & arena bounds collision for monsters
            m.x = clamp(m.x, ARENA_MARGIN + m.radius, WORLD_W - ARENA_MARGIN - m.radius);
            m.y = clamp(m.y, ARENA_MARGIN + m.radius, WORLD_H - ARENA_MARGIN - m.radius);
            for (const pil of PILLARS) {
              const pdx = m.x - pil.x;
              const pdy = m.y - pil.y;
              const pdist = Math.hypot(pdx, pdy);
              const minP = m.radius + pil.r;
              if (pdist > 0 && pdist < minP) {
                m.x = pil.x + (pdx / pdist) * minP;
                m.y = pil.y + (pdy / pdist) * minP;
              }
            }

            // Ranged Drake / Boss attacks aimed at nearest unshielded target
            const arch = MONSTER_ARCHETYPES[m.kind];
            if (arch.rangedFire && targetDist < 520) {
              m.shootCooldown -= dt;
              if (m.shootCooldown <= 0) {
                m.shootCooldown = (m.isBoss ? 2.4 : 3.2) * scale.profile.rangedCooldownMult;
                const baseAngle = Math.atan2(tdy, tdx);
                const shots = m.isBoss ? [-0.3, 0, 0.3] : [0];
                const projSpeed = 230 * (0.95 + scale.speedMult * 0.14);
                const projDmg = Math.max(
                  8,
                  Math.round((m.isBoss ? 16 : 12) * (1 + (sim.wave - 1) * 0.06) * scale.damageMult)
                );
                for (const off of shots) {
                  const a = baseAngle + off;
                  sim.projectiles.push({
                    id: sim.nextProjId++,
                    x: m.x,
                    y: m.y,
                    vx: Math.cos(a) * projSpeed,
                    vy: Math.sin(a) * projSpeed,
                    radius: m.isBoss ? 9 : 7,
                    damage: projDmg,
                    life: 2.4,
                    fromEnemy: true,
                    color: m.isBoss ? '#f59e0b' : '#f97316',
                    homing: false,
                  });
                }
              }
            }
          }

          // Local hero contact damage (only when alive and unshielded)
          const hdx = hero.x - m.x;
          const hdy = hero.y - m.y;
          const hdist = Math.hypot(hdx, hdy) || 1;
          if (!isDefeated && !localShielded && hero.invulnTimer <= 0 && hdist < hero.radius + m.radius - 4) {
            hero.hp = Math.max(0, hero.hp - m.damage);
            hero.invulnTimer = scale.profile.invulnDuration;
            hero.vx += (hdx / hdist) * 210;
            hero.vy += (hdy / hdist) * 210;
            audioRef.current?.play('hurt', mutedRef.current);
            if (!reducedMotionRef.current) {
              sim.shakeTimer = 0.16;
              sim.shakePower = 6;
            }
          }
        }

        // Check local hero defeat -> GAME OVER when health runs out!
        if (hero.hp <= 0 && overlayRef.current !== 'GAME_OVER') {
          hero.hp = 0;
          hero.vx = 0;
          hero.vy = 0;
          setSpectating(false);
          setActiveQuestion(null);
          setAnswerFeedback(null);
          audioRef.current?.play('gameover', mutedRef.current);
          setOverlay('GAME_OVER');
        }

        // ------------------------------------------------------------------
        // 7. XP CRYSTAL MAGNET & CO-OP ASSIST SHARING
        // ------------------------------------------------------------------
        const pickupRadius = heroCanAct ? 120 + sim.abilities.magnet * 42 : 0;
        for (let i = sim.crystals.length - 1; i >= 0; i--) {
          const cr = sim.crystals[i];
          if (worldAuthority) {
            cr.life -= dt;
            if (cr.life <= 0) {
              sim.crystals.splice(i, 1);
              continue;
            }
          }
          cr.vx *= Math.pow(0.03, dt);
          cr.vy *= Math.pow(0.03, dt);
          const dx = hero.x - cr.x;
          const dy = hero.y - cr.y;
          const d = Math.hypot(dx, dy) || 1;
          if (heroCanAct && d < pickupRadius) {
            const pull = 460 * (1 - d / pickupRadius) + 220;
            cr.vx = (dx / d) * pull;
            cr.vy = (dy / d) * pull;
          }
          cr.x += cr.vx * dt;
          cr.y += cr.vy * dt;

          if (heroCanAct && d < hero.radius + 18) {
            audioRef.current?.play('gem', mutedRef.current);
            sim.crystals.splice(i, 1);

            if (isGuestCoop) {
              // Suppress locally and ask Host to award authoritative 100% + teammate 50% assist XP
              locallyPickedCrystalIdsRef.current.set(cr.id, now + 900);
              pendingCrystalPickupsRef.current.push(cr.id);
              if (cr.kind !== 'heart') {
                sim.dmgTexts.push({
                  x: hero.x,
                  y: hero.y - 26,
                  vy: -34,
                  text: `+${cr.value} XP`,
                  color: '#34d399',
                  life: 0.65,
                  maxLife: 0.65,
                });
              }
            } else {
              if (cr.kind === 'heart') {
                hero.hp = Math.min(hero.maxHp, hero.hp + cr.value);
                sim.dmgTexts.push({
                  x: hero.x,
                  y: hero.y - 32,
                  vy: -36,
                  text: `+${cr.value} HP`,
                  color: '#4ade80',
                  life: 0.8,
                  maxLife: 0.8,
                });
                if (isRealtimeCoop) {
                  const assistHeal = Math.max(8, Math.round(cr.value * 0.4));
                  for (const rhId of remoteHeroesRef.current.keys()) {
                    hostHealGrantsRef.current[rhId] =
                      (hostHealGrantsRef.current[rhId] || 0) + assistHeal;
                  }
                }
              } else {
                grantHeroXp(cr.value);
                if (isRealtimeCoop) {
                  const assistXp = Math.max(2, Math.round(cr.value * 0.5));
                  for (const rhId of remoteHeroesRef.current.keys()) {
                    hostXpGrantsRef.current[rhId] =
                      (hostXpGrantsRef.current[rhId] || 0) + assistXp;
                  }
                }
              }
            }
          }
        }

        // Level reached -> Answer Question first, then pick an Upgrade! (only while alive)
        if (!isDefeated && hero.hp > 0 && sim.pendingUpgrades > 0 && overlayRef.current === 'PLAYING') {
          sim.pendingUpgrades -= 1;
          openQuizModal();
        }

        // Decay transient VFX
        for (let i = sim.slashes.length - 1; i >= 0; i--) {
          sim.slashes[i].life -= dt;
          if (sim.slashes[i].life <= 0) sim.slashes.splice(i, 1);
        }
        for (let i = sim.bolts.length - 1; i >= 0; i--) {
          sim.bolts[i].life -= dt;
          if (sim.bolts[i].life <= 0) sim.bolts.splice(i, 1);
        }
        for (let i = sim.novas.length - 1; i >= 0; i--) {
          sim.novas[i].life -= dt;
          if (sim.novas[i].life <= 0) sim.novas.splice(i, 1);
        }
        for (let i = sim.dmgTexts.length - 1; i >= 0; i--) {
          const dtItem = sim.dmgTexts[i];
          dtItem.life -= dt;
          dtItem.y += dtItem.vy * dt;
          if (dtItem.life <= 0) sim.dmgTexts.splice(i, 1);
        }
        for (let i = sim.particles.length - 1; i >= 0; i--) {
          const p = sim.particles[i];
          p.life -= dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= Math.pow(0.05, dt);
          p.vy *= Math.pow(0.05, dt);
          if (p.life <= 0) sim.particles.splice(i, 1);
        }
        for (let i = sim.afterImages.length - 1; i >= 0; i--) {
          sim.afterImages[i].life -= dt;
          if (sim.afterImages[i].life <= 0) sim.afterImages.splice(i, 1);
        }

        // Smooth camera follow clamped to expanded world bounds (follows alive teammate when spectating)
        let focusX = hero.x;
        let focusY = hero.y;
        if (isDefeated && cCount > 1) {
          for (const rh of remoteHeroesRef.current.values()) {
            if (rh.hp > 0) {
              focusX = rh.x;
              focusY = rh.y;
              break;
            }
          }
        }
        const halfW = Math.min(viewW / 2, WORLD_W / 2);
        const halfH = Math.min(viewH / 2, WORLD_H / 2);
        const targetCamX = clamp(focusX, halfW, WORLD_W - halfW);
        const targetCamY = clamp(focusY, halfH, WORLD_H - halfH);
        sim.cameraX += (targetCamX - sim.cameraX) * Math.min(1, dt * 8.5);
        sim.cameraY += (targetCamY - sim.cameraY) * Math.min(1, dt * 8.5);

        // ------------------------------------------------------------------
        // 8. REAL-TIME CO-OP NETWORK BROADCASTS (~15Hz)
        // ------------------------------------------------------------------
        if (isRealtimeCoop && channel) {
          const myId = playerIdRef.current || 'hero';
          if (now - sim.lastHeroSyncAt >= 60) {
            sim.lastHeroSyncAt = now;
            channel.sendHero({
              playerId: myId,
              nickname: myNicknameRef.current,
              x: Math.round(hero.x),
              y: Math.round(hero.y),
              vx: Math.round(hero.vx),
              vy: Math.round(hero.vy),
              hp: Math.ceil(hero.hp),
              maxHp: hero.maxHp,
              level: hero.level,
              xp: hero.xp,
              kills: hero.kills,
              facing: hero.facing,
              aimAngle: Number(hero.aimAngle.toFixed(2)),
              shielded: localShielded,
              dashing: hero.dashTimer > 0,
              abilities: { ...sim.abilities },
            });
          }

          if (
            now - sim.lastActionSyncAt >= 55 &&
            (pendingGuestHitsRef.current.length > 0 ||
              pendingCrystalPickupsRef.current.length > 0 ||
              pendingSlashRef.current ||
              pendingBoltRef.current ||
              pendingNovaRef.current)
          ) {
            sim.lastActionSyncAt = now;
            channel.sendAction({
              playerId: myId,
              hits: isGuestCoop && pendingGuestHitsRef.current.length > 0
                ? pendingGuestHitsRef.current.splice(0, 32)
                : undefined,
              pickedCrystalIds:
                isGuestCoop && pendingCrystalPickupsRef.current.length > 0
                  ? pendingCrystalPickupsRef.current.splice(0, 20)
                  : undefined,
              slash: pendingSlashRef.current,
              bolt: pendingBoltRef.current,
              nova: pendingNovaRef.current,
            });
            pendingSlashRef.current = undefined;
            pendingBoltRef.current = undefined;
            pendingNovaRef.current = undefined;
          }

          if (isHostRef.current && now - sim.lastWorldSyncAt >= 65) {
            sim.lastWorldSyncAt = now;
            channel.sendWorld({
              wave: sim.wave,
              waveTimer: Number(sim.waveTimer.toFixed(1)),
              monsters: sim.monsters.slice(0, 60).map((m) => ({
                uid: m.uid,
                kind: m.kind,
                x: Math.round(m.x),
                y: Math.round(m.y),
                vx: Math.round(m.vx),
                vy: Math.round(m.vy),
                hp: Math.round(m.hp),
                maxHp: m.maxHp,
                speed: Math.round(m.speed),
                radius: m.radius,
                damage: m.damage,
                xpValue: m.xpValue,
                facing: m.facing,
                spawnTimer: Number(m.spawnTimer.toFixed(2)),
                isBoss: m.isBoss,
                flashTimer: Number(m.flashTimer.toFixed(2)),
              })),
              crystals: sim.crystals.slice(0, 80).map((c) => ({
                id: c.id,
                x: Math.round(c.x),
                y: Math.round(c.y),
                value: c.value,
                kind: c.kind,
              })),
              enemyProjectiles: sim.projectiles
                .filter((p) => p.fromEnemy)
                .slice(0, 48)
                .map((p) => ({
                  id: p.id,
                  x: Math.round(p.x),
                  y: Math.round(p.y),
                  vx: Math.round(p.vx),
                  vy: Math.round(p.vy),
                  radius: p.radius,
                  damage: p.damage,
                  fromEnemy: true,
                  color: p.color,
                })),
              xpGrants: { ...hostXpGrantsRef.current },
              healGrants: { ...hostHealGrantsRef.current },
              coopPlayerCount: cCount,
              serverTs: Date.now(),
            });
          }
        }
      }

      // Sync React HUD ~11Hz
      hudSyncTimer += dt;
      if (hudSyncTimer >= 0.09) {
        hudSyncTimer = 0;
        const bosses = sim.monsters.filter((m) => m.isBoss);
        const totalBossHp = bosses.reduce((acc, b) => acc + Math.max(0, Math.ceil(b.hp)), 0);
        const totalBossMaxHp = bosses.reduce((acc, b) => acc + b.maxHp, 0);
        const weaponCount = Object.values(sim.abilities).filter((lvl) => lvl > 0).length;
        let aliveTeammates = 0;
        for (const rh of remoteHeroesRef.current.values()) {
          if (rh.hp > 0) aliveTeammates += 1;
        }
        setHud({
          hp: Math.max(0, Math.ceil(sim.hero.hp)),
          maxHp: sim.hero.maxHp,
          xp: sim.hero.xp,
          xpInLevel: sim.hero.xpInLevel,
          xpNextLevel: xpRequiredForLevel(sim.hero.level),
          level: sim.hero.level,
          kills: sim.hero.kills,
          wave: sim.wave,
          waveTimeLeft: Math.ceil(sim.waveTimer),
          dashCooldownRatio: Math.min(1, sim.hero.dashCooldown / 1.55),
          bossName: bosses.length > 0 ? MONSTER_ARCHETYPES[bosses[0].kind].name : '',
          bossHp: totalBossHp,
          bossMaxHp: totalBossMaxHp,
          bossCount: bosses.length,
          shielded: localShielded && cCount > 1,
          teammateCount: Math.max(0, cCount - 1),
          aliveTeammateCount: aliveTeammates,
        });

        if (now - sim.lastReportedAt >= 900 || isDefeated) {
          if (now - sim.lastReportedAt >= 450) {
            sim.lastReportedAt = now;
            onReportProgress({
              xp: sim.hero.xp,
              level: sim.hero.level,
              kills: sim.hero.kills,
              wave: sim.wave,
              hp: Math.max(0, Math.ceil(sim.hero.hp)),
              maxHp: sim.hero.maxHp,
              weaponCount,
              x: Math.round(sim.hero.x),
              y: Math.round(sim.hero.y),
              facing: sim.hero.facing,
              shielded: localShielded && cCount > 1,
            });
          }
        }
      }

      // ======================================================================
      // RENDER ARENA + CO-OP HEROES + MINI-MAP AT 60FPS
      // ======================================================================
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#07130f';
      ctx.fillRect(0, 0, viewW, viewH);

      const shakeX =
        sim.shakeTimer > 0 ? (Math.random() - 0.5) * 2 * sim.shakePower : 0;
      const shakeY =
        sim.shakeTimer > 0 ? (Math.random() - 0.5) * 2 * sim.shakePower : 0;

      const camOffsetX = Math.round(viewW / 2 - sim.cameraX + shakeX);
      const camOffsetY = Math.round(viewH / 2 - sim.cameraY + shakeY);
      ctx.save();
      ctx.translate(camOffsetX, camOffsetY);

      // 1. Arena Map Illustration Backdrop
      const pack = assetsRef.current;
      if (pack?.mapImage) {
        ctx.drawImage(pack.mapImage, 0, 0, WORLD_W, WORLD_H);
      } else {
        const grad = ctx.createRadialGradient(
          WORLD_W / 2,
          WORLD_H / 2,
          100,
          WORLD_W / 2,
          WORLD_H / 2,
          1150
        );
        grad.addColorStop(0, '#1e3a2f');
        grad.addColorStop(1, '#0b1d17');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
      }

      // Subtle glowing center arcane pulse & 12 rotating rune ticks
      const tSec = now / 1000;
      const pulseAlpha = 0.14 + Math.sin(tSec * 2.4) * 0.06;
      ctx.save();
      ctx.strokeStyle = `rgba(34, 211, 238, ${pulseAlpha + 0.18})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(WORLD_W / 2, WORLD_H / 2, 210 + Math.sin(tSec * 2.4) * 5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.translate(WORLD_W / 2, WORLD_H / 2);
      ctx.rotate(tSec * 0.22);
      for (let k = 0; k < 12; k++) {
        const a = (k * Math.PI) / 6;
        ctx.fillStyle = `rgba(56, 189, 248, ${pulseAlpha + 0.22})`;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * 228, Math.sin(a) * 228, 4.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Arena boundary ring
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.28)';
      ctx.lineWidth = 3;
      ctx.strokeRect(
        ARENA_MARGIN,
        ARENA_MARGIN,
        WORLD_W - ARENA_MARGIN * 2,
        WORLD_H - ARENA_MARGIN * 2
      );

      // 6 Stone obstacle pillars with soft shadow ring
      for (const pil of PILLARS) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.beginPath();
        ctx.ellipse(pil.x + 4, pil.y + 10, pil.r + 6, pil.r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();

        const pGrad = ctx.createRadialGradient(pil.x - 8, pil.y - 10, 4, pil.x, pil.y, pil.r);
        pGrad.addColorStop(0, '#94a3b8');
        pGrad.addColorStop(0.7, '#475569');
        pGrad.addColorStop(1, '#1e293b');
        ctx.fillStyle = pGrad;
        ctx.beginPath();
        ctx.arc(pil.x, pil.y, pil.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(203, 213, 225, 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 2. Nova shockwaves
      for (const nv of sim.novas) {
        const prog = 1 - nv.life / nv.maxLife;
        const rad = nv.maxRadius * prog;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - prog);
        ctx.strokeStyle = nv.color;
        ctx.lineWidth = 10 * (1 - prog) + 2;
        ctx.beginPath();
        ctx.arc(nv.x, nv.y, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // 3. XP Crystals & Hearts
      for (const cr of sim.crystals) {
        const bob = Math.sin(tSec * 6 + cr.x) * 3;
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath();
        ctx.ellipse(cr.x, cr.y + 8, 7, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        if (cr.kind === 'heart') {
          ctx.fillStyle = '#fb7185';
          ctx.beginPath();
          ctx.arc(cr.x - 4, cr.y - 2 + bob, 5, 0, Math.PI * 2);
          ctx.arc(cr.x + 4, cr.y - 2 + bob, 5, 0, Math.PI * 2);
          ctx.lineTo(cr.x, cr.y + 8 + bob);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.save();
          ctx.translate(cr.x, cr.y + bob);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle =
            cr.kind === 'gold' ? '#facc15' : cr.kind === 'cyan' ? '#22d3ee' : '#34d399';
          ctx.fillRect(-5, -5, 10, 10);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.4;
          ctx.strokeRect(-5, -5, 10, 10);
          ctx.restore();
        }
      }

      // 4. Monsters (sorted by Y for clean depth overlap)
      const sortedMonsters = [...sim.monsters].sort((a, b) => a.y - b.y);
      for (const m of sortedMonsters) {
        const arch = MONSTER_ARCHETYPES[m.kind];
        if (m.spawnTimer > 0) {
          const ratio = 1 - m.spawnTimer / 0.45;
          ctx.save();
          ctx.strokeStyle = arch.auraColor;
          ctx.lineWidth = 3;
          ctx.globalAlpha = ratio;
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.radius * (1.4 - ratio * 0.4), 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
          continue;
        }

        const hop = Math.abs(Math.sin(tSec * (m.kind === 'imp' ? 9 : 6) + m.phaseOffset)) * 5;
        const squash = 1 + Math.sin(tSec * 8 + m.phaseOffset) * 0.04;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
        ctx.beginPath();
        ctx.ellipse(m.x, m.y + m.radius * 0.78, m.radius * 0.88, m.radius * 0.36, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = arch.auraColor;
        ctx.lineWidth = m.isBoss ? 3.5 : 2;
        ctx.globalAlpha = m.isBoss ? 0.85 : 0.48;
        ctx.beginPath();
        ctx.ellipse(m.x, m.y + m.radius * 0.72, m.radius * 0.96, m.radius * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

        const spritePair = pack?.sprites[m.kind];
        const drawSize = m.radius * 2.55;
        ctx.save();
        ctx.translate(m.x, m.y - hop);
        ctx.scale(m.facing * squash, 2 - squash);

        if (spritePair) {
          const canvasSprite = m.flashTimer > 0 ? spritePair.flash : spritePair.normal;
          ctx.drawImage(canvasSprite, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
        } else {
          ctx.fillStyle = m.flashTimer > 0 ? '#ffffff' : arch.auraColor;
          ctx.beginPath();
          ctx.arc(0, 0, m.radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();

        // Compact HP bar above damaged monsters (including individual Boss bars when dual bosses spawn)
        if (m.isBoss || m.hp < m.maxHp) {
          const bw = m.isBoss ? m.radius * 2.2 : m.radius * 1.7;
          const bh = m.isBoss ? 7 : 5;
          const bx = m.x - bw / 2;
          const by = m.y - m.radius * 1.28 - hop;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
          ctx.fillRect(bx, by, bw, bh);
          ctx.fillStyle = m.isBoss ? '#f59e0b' : '#ef4444';
          ctx.fillRect(bx, by, bw * Math.max(0, m.hp / Math.max(1, m.maxHp)), bh);
        }
      }

      // 5. Dash afterimages
      for (const ai of sim.afterImages) {
        ctx.save();
        ctx.globalAlpha = (ai.life / 0.22) * 0.42;
        ctx.fillStyle = ai.color || '#38bdf8';
        ctx.beginPath();
        ctx.arc(ai.x, ai.y, sim.hero.radius * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 6A. Remote Co-op Teammate Heroes
      for (const rh of remoteHeroesRef.current.values()) {
        const pal = TEAMMATE_PALETTE[colorIndexForId(rh.playerId)];
        const rhDefeated = rh.hp <= 0;
        const bob = rhDefeated ? 0 : Math.sin(rh.walkPhase) * 2.2;

        ctx.fillStyle = 'rgba(0,0,0,0.42)';
        ctx.beginPath();
        ctx.ellipse(rh.x, rh.y + 20, 21, 9, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(rh.x, rh.y - bob);
        if (rhDefeated) ctx.globalAlpha = 0.42;

        // Teammate Body
        ctx.fillStyle = rhDefeated ? '#334155' : pal.shell;
        ctx.beginPath();
        ctx.roundRect(-18, -19, 36, 36, 11);
        ctx.fill();

        const tGrad = ctx.createLinearGradient(0, -17, 0, 15);
        tGrad.addColorStop(0, rhDefeated ? '#64748b' : pal.top);
        tGrad.addColorStop(1, rhDefeated ? '#334155' : pal.bottom);
        ctx.fillStyle = tGrad;
        ctx.beginPath();
        ctx.roundRect(-16, -17, 32, 32, 9);
        ctx.fill();
        ctx.strokeStyle = rhDefeated ? '#94a3b8' : pal.border;
        ctx.lineWidth = 2.2;
        ctx.stroke();

        // Visor band & eyes
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(-12, -17, 24, 5);
        const eyeShift = (rh.facing || 1) * 3;
        if (rhDefeated) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(-8 + eyeShift, -5);
          ctx.lineTo(-3 + eyeShift, 0);
          ctx.moveTo(-3 + eyeShift, -5);
          ctx.lineTo(-8 + eyeShift, 0);
          ctx.moveTo(3 + eyeShift, -5);
          ctx.lineTo(8 + eyeShift, 0);
          ctx.moveTo(8 + eyeShift, -5);
          ctx.lineTo(3 + eyeShift, 0);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(-5.5 + eyeShift, -3, 3.1, 0, Math.PI * 2);
          ctx.arc(5.5 + eyeShift, -3, 3.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(-6.3 + eyeShift, -4, 1.1, 0, Math.PI * 2);
          ctx.arc(4.7 + eyeShift, -4, 1.1, 0, Math.PI * 2);
          ctx.fill();
        }

        // Sanctuary Shield Bubble when alive teammate is answering Quiz / drafting Upgrade
        if (!rhDefeated && rh.shielded) {
          ctx.strokeStyle = '#38bdf8';
          ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, -1, 32 + Math.sin(tSec * 5) * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();

        // Teammate Orbitals if alive & equipped
        const rOrbit = !rhDefeated ? rh.abilities?.orbit || 0 : 0;
        if (rOrbit > 0) {
          const orbCount = rOrbit + 1;
          const orbDist = 72 + rOrbit * 4;
          for (let o = 0; o < orbCount; o++) {
            const a = tSec * (2.6 + rOrbit * 0.35) + (o * Math.PI * 2) / orbCount;
            const ox = rh.x + Math.cos(a) * orbDist;
            const oy = rh.y + Math.sin(a) * orbDist;
            ctx.save();
            ctx.translate(ox, oy);
            ctx.rotate(a + tSec * 4);
            ctx.fillStyle = pal.top;
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(7, 0);
            ctx.lineTo(0, 8);
            ctx.lineTo(-7, 0);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          }
        }

        // Teammate Nickname + Compact HP Bar
        const label = rhDefeated ? `${rh.nickname} (KO)` : `${rh.nickname} Lv.${rh.level}`;
        ctx.save();
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#020617';
        ctx.lineWidth = 3;
        ctx.strokeText(label, rh.x, rh.y - 35);
        ctx.fillStyle = rhDefeated ? '#f87171' : pal.border;
        ctx.fillText(label, rh.x, rh.y - 35);

        const hpW = 42;
        const hpX = rh.x - hpW / 2;
        const hpY = rh.y - 30;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(hpX, hpY, hpW, 4);
        ctx.fillStyle = rhDefeated ? '#ef4444' : rh.shielded ? '#38bdf8' : '#34d399';
        ctx.fillRect(
          hpX,
          hpY,
          hpW * clamp(rh.hp / Math.max(1, rh.maxHp), 0, 1),
          4
        );
        ctx.restore();
      }

      // 6B. Local Hero Knight Avatar
      {
        const hero = sim.hero;
        const bob = isDefeated ? 0 : Math.sin(hero.walkPhase) * 2.5;
        const blinkOut = !isDefeated && hero.invulnTimer > 0 && Math.floor(tSec * 20) % 2 === 0;

        if (!isDefeated && sim.abilities.magnet > 0) {
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.22)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hero.x, hero.y, 115 + sim.abilities.magnet * 42, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath();
        ctx.ellipse(hero.x, hero.y + 20, 22, 10, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.save();
        ctx.translate(hero.x, hero.y - bob);
        if (isDefeated) ctx.globalAlpha = 0.42;
        else if (blinkOut) ctx.globalAlpha = 0.5;

        if (!isDefeated) {
          ctx.save();
          ctx.rotate(hero.aimAngle);
          ctx.fillStyle = '#fde047';
          ctx.beginPath();
          ctx.moveTo(32, 0);
          ctx.lineTo(22, -6);
          ctx.lineTo(22, 6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // Stylized Champion Blook hero
        ctx.fillStyle = isDefeated ? '#334155' : '#065f46';
        ctx.beginPath();
        ctx.roundRect(-19, -20, 38, 38, 12);
        ctx.fill();

        const bodyGrad = ctx.createLinearGradient(0, -18, 0, 16);
        bodyGrad.addColorStop(0, isDefeated ? '#64748b' : '#34d399');
        bodyGrad.addColorStop(1, isDefeated ? '#334155' : '#059669');
        ctx.fillStyle = bodyGrad;
        ctx.beginPath();
        ctx.roundRect(-17, -18, 34, 34, 10);
        ctx.fill();
        ctx.strokeStyle = isDefeated ? '#f87171' : '#ecfdf5';
        ctx.lineWidth = 2.5;
        ctx.stroke();

        ctx.fillStyle = isDefeated ? '#94a3b8' : '#fbbf24';
        ctx.fillRect(-13, -18, 26, 6);
        const eyeShift = hero.facing * 3;
        if (isDefeated) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(-9 + eyeShift, -6);
          ctx.lineTo(-3 + eyeShift, 0);
          ctx.moveTo(-3 + eyeShift, -6);
          ctx.lineTo(-9 + eyeShift, 0);
          ctx.moveTo(3 + eyeShift, -6);
          ctx.lineTo(9 + eyeShift, 0);
          ctx.moveTo(9 + eyeShift, -6);
          ctx.lineTo(3 + eyeShift, 0);
          ctx.stroke();
        } else {
          ctx.fillStyle = '#0f172a';
          ctx.beginPath();
          ctx.arc(-6 + eyeShift, -3, 3.3, 0, Math.PI * 2);
          ctx.arc(6 + eyeShift, -3, 3.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(-7 + eyeShift, -4, 1.2, 0, Math.PI * 2);
          ctx.arc(5 + eyeShift, -4, 1.2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Sanctuary Shield visual when shielded in co-op
        if (!isDefeated && localShielded && cCount > 1) {
          ctx.strokeStyle = '#38bdf8';
          ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(0, -1, 34 + Math.sin(tSec * 5) * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();

        // Frost Orbitals spinning around hero (only while alive)
        if (!isDefeated && sim.abilities.orbit > 0) {
          const orbCount = sim.abilities.orbit + 1;
          const orbDist = 74 + sim.abilities.orbit * 4;
          for (let o = 0; o < orbCount; o++) {
            const a = sim.orbitAngle + (o * Math.PI * 2) / orbCount;
            const ox = hero.x + Math.cos(a) * orbDist;
            const oy = hero.y + Math.sin(a) * orbDist;
            ctx.save();
            ctx.translate(ox, oy);
            ctx.rotate(a + tSec * 4);
            ctx.fillStyle = '#60a5fa';
            ctx.beginPath();
            ctx.moveTo(0, -10);
            ctx.lineTo(8, 0);
            ctx.lineTo(0, 10);
            ctx.lineTo(-8, 0);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#e0f2fe';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // 7. Crescent Slash Arcs
      for (const sl of sim.slashes) {
        const alpha = sl.life / sl.maxLife;
        ctx.save();
        ctx.translate(sl.x, sl.y);
        ctx.rotate(sl.angle);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = sl.color;
        ctx.lineWidth = 14 * alpha + 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(0, 0, sl.radius * 0.85, -Math.PI * 0.55, Math.PI * 0.55);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4 * alpha;
        ctx.beginPath();
        ctx.arc(0, 0, sl.radius * 0.88, -Math.PI * 0.45, Math.PI * 0.45);
        ctx.stroke();
        ctx.restore();
      }

      // 8. Projectiles
      for (const pr of sim.projectiles) {
        ctx.save();
        ctx.fillStyle = pr.color;
        ctx.shadowColor = pr.color;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, pr.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, pr.radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 9. Chain Lightning Bolts
      for (const lb of sim.bolts) {
        ctx.save();
        ctx.globalAlpha = lb.life / lb.maxLife;
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        lb.points.forEach((pt, idx) => {
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else {
            const prev = lb.points[idx - 1];
            const midX = (prev.x + pt.x) / 2 + (Math.random() - 0.5) * 24;
            const midY = (prev.y + pt.y) / 2 + (Math.random() - 0.5) * 24;
            ctx.lineTo(midX, midY);
            ctx.lineTo(pt.x, pt.y);
          }
        });
        ctx.stroke();
        ctx.restore();
      }

      // 10. Particles & Ambient Motes
      for (const p of sim.particles) {
        ctx.save();
        ctx.globalAlpha = p.life / p.maxLife;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (const mt of sim.ambientMotes) {
        const mx = mt.x + Math.sin(tSec * 0.8 + mt.phase) * 18;
        const my = mt.y + Math.cos(tSec * 0.6 + mt.phase) * 18;
        ctx.fillStyle = `rgba(167, 243, 208, ${0.22 + Math.sin(tSec * 2 + mt.phase) * 0.14})`;
        ctx.beginPath();
        ctx.arc(mx, my, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 11. Floating Damage Numbers
      for (const dtTxt of sim.dmgTexts) {
        ctx.save();
        ctx.globalAlpha = dtTxt.life / dtTxt.maxLife;
        ctx.font = dtTxt.big ? '800 18px system-ui, sans-serif' : '700 14px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 3.5;
        ctx.strokeText(dtTxt.text, dtTxt.x, dtTxt.y);
        ctx.fillStyle = dtTxt.color;
        ctx.fillText(dtTxt.text, dtTxt.x, dtTxt.y);
        ctx.restore();
      }

      ctx.restore(); // Restore from world camera transform -> Screen-space overlays

      // 12. Mini-Map Radar (Top-Right of Arena Canvas)
      if (viewW >= 540 && viewH >= 380) {
        const mmW = 168;
        const mmH = Math.round((mmW * WORLD_H) / WORLD_W);
        const mmX = viewW - mmW - 14;
        const mmY = 14;
        const sx = mmW / WORLD_W;
        const sy = mmH / WORLD_H;

        ctx.save();
        ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.roundRect(mmX, mmY, mmW, mmH, 8);
        ctx.fill();
        ctx.stroke();

        // Arena inner border
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(
          mmX + ARENA_MARGIN * sx,
          mmY + ARENA_MARGIN * sy,
          (WORLD_W - ARENA_MARGIN * 2) * sx,
          (WORLD_H - ARENA_MARGIN * 2) * sy
        );

        // Pillars
        ctx.fillStyle = '#64748b';
        for (const pil of PILLARS) {
          ctx.beginPath();
          ctx.arc(mmX + pil.x * sx, mmY + pil.y * sy, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Camera viewport rectangle
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
        ctx.strokeRect(
          clamp(mmX + (sim.cameraX - viewW / 2) * sx, mmX, mmX + mmW),
          clamp(mmY + (sim.cameraY - viewH / 2) * sy, mmY, mmY + mmH),
          Math.min(mmW, viewW * sx),
          Math.min(mmH, viewH * sy)
        );

        // Monsters & Bosses
        for (const m of sim.monsters) {
          if (m.spawnTimer > 0) continue;
          const mx = mmX + m.x * sx;
          const my = mmY + m.y * sy;
          if (m.isBoss) {
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(mx, my, 4.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#fef3c7';
            ctx.lineWidth = 1;
            ctx.stroke();
          } else {
            ctx.fillStyle = 'rgba(248, 113, 113, 0.85)';
            ctx.fillRect(mx - 1, my - 1, 2.2, 2.2);
          }
        }

        // Remote Teammates
        for (const rh of remoteHeroesRef.current.values()) {
          const pal = TEAMMATE_PALETTE[colorIndexForId(rh.playerId)];
          ctx.fillStyle = rh.hp <= 0 ? '#64748b' : pal.top;
          ctx.beginPath();
          ctx.arc(mmX + rh.x * sx, mmY + rh.y * sy, 3.2, 0, Math.PI * 2);
          ctx.fill();
          if (rh.hp > 0 && rh.shielded) {
            ctx.strokeStyle = '#38bdf8';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
        }

        // Self Hero
        ctx.fillStyle = isDefeated ? '#ef4444' : '#34d399';
        ctx.beginPath();
        ctx.arc(mmX + sim.hero.x * sx, mmY + sim.hero.y * sy, 3.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        ctx.restore();
      }

      ctx.restore();
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [brawlDeck.length, onReportProgress, openQuizModal, triggerUpgradeChoice]);

  const sortedPlayers = useMemo(() => {
    return [...room.players].sort((a, b) => {
      const aXp = a.brawlStats?.xp ?? a.score;
      const bXp = b.brawlStats?.xp ?? b.score;
      return b.score - a.score || bXp - aXp;
    });
  }, [room.players]);

  const hpPct = Math.max(0, Math.min(100, Math.round((hud.hp / Math.max(1, hud.maxHp)) * 100)));
  const xpPct = Math.max(
    0,
    Math.min(100, Math.round((hud.xpInLevel / Math.max(1, hud.xpNextLevel)) * 100))
  );
  const diffProfile = BRAWL_DIFFICULTIES[difficulty];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-slate-950 text-slate-100 select-none">
      {/* Top Game HUD Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/95 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
              <Swords className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold tracking-wide text-white">
                <span>MONSTER BRAWL</span>
                <span className="font-mono-num rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-amber-300">
                  Room {room.code}
                </span>
                <span
                  className="font-mono-num rounded border px-1.5 py-0.5 text-[10px] font-extrabold uppercase"
                  style={{
                    color: diffProfile.badgeColor,
                    borderColor: `${diffProfile.badgeColor}66`,
                    backgroundColor: `${diffProfile.badgeColor}1a`,
                  }}
                >
                  {diffProfile.label}
                </span>
                {coopScale.playerCount > 1 && (
                  <span className="font-mono-num rounded border border-cyan-500/40 bg-cyan-500/15 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                    {coopScale.playerCount}P Co-op · {coopScale.coopHpMult.toFixed(2)}x HP
                  </span>
                )}
              </div>
              <div className="font-mono-num text-[11px] text-slate-400">
                Wave {hud.wave} · Next wave in {hud.waveTimeLeft}s · {hud.kills} defeated
              </div>
            </div>
          </div>

          {/* Health Meter */}
          <div className="min-w-[145px]">
            <div className="font-mono-num flex items-center justify-between text-[11px] font-bold">
              <span className="flex items-center gap-1 text-rose-400">
                <Heart className="h-3 w-3 fill-current" aria-hidden="true" />
                HP: {hud.hp}/{hud.maxHp}
              </span>
              <span className="text-slate-400">{hpPct}%</span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full transition-[width] duration-150 ${
                  hpPct <= 30 ? 'bg-rose-500' : 'bg-emerald-400'
                }`}
                style={{ width: `${hpPct}%` }}
              />
            </div>
          </div>

          {/* Level & XP Progress to Next Question + Upgrade */}
          <div className="min-w-[195px]">
            <div className="font-mono-num flex items-center justify-between text-[11px] font-bold">
              <span className="text-amber-300">LVL {hud.level}</span>
              <span className="text-cyan-300">
                {hud.xpInLevel}/{hud.xpNextLevel} XP → Upgrade
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full bg-cyan-400 transition-[width] duration-150"
                style={{ width: `${xpPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            <span>{paused ? 'Resume' : 'Pause'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowLeaderboard((v) => !v)}
            className="flex cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
          >
            <Users className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
            <span>Players ({room.players.length})</span>
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? 'Unmute game audio' : 'Mute game audio'}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
          >
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>

          {isHost && (
            <button
              type="button"
              onClick={onFinishMatch}
              className="flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
            >
              <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>End &amp; Podium</span>
            </button>
          )}

          <button
            type="button"
            onClick={onLeaveRoom}
            className="flex cursor-pointer items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/25"
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Leave</span>
          </button>
        </div>
      </div>

      {/* Main Playfield + Collapsible Multiplayer Rail */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-slate-950"
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            pointerRef.current.pointerDown = true;
            pointerRef.current.active = true;
            pointerRef.current.joyOriginX = e.clientX - rect.left;
            pointerRef.current.joyOriginY = e.clientY - rect.top;
            pointerRef.current.screenX = pointerRef.current.joyOriginX;
            pointerRef.current.screenY = pointerRef.current.joyOriginY;
          }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const sx = e.clientX - rect.left;
            const sy = e.clientY - rect.top;
            pointerRef.current.active = true;
            pointerRef.current.screenX = sx;
            pointerRef.current.screenY = sy;
            if (pointerRef.current.pointerDown) {
              pointerRef.current.joyDx = sx - pointerRef.current.joyOriginX;
              pointerRef.current.joyDy = sy - pointerRef.current.joyOriginY;
            }
          }}
          onPointerUp={() => {
            pointerRef.current.pointerDown = false;
            pointerRef.current.joyDx = 0;
            pointerRef.current.joyDy = 0;
          }}
          onPointerCancel={() => {
            pointerRef.current.pointerDown = false;
            pointerRef.current.joyDx = 0;
            pointerRef.current.joyDy = 0;
          }}
        >
          <canvas ref={canvasRef} className="block h-full w-full touch-none" />

          {!assetsReady && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/75 text-sm font-semibold text-emerald-300">
              Loading Monster Brawl Arena &amp; Sprites…
            </div>
          )}

          {/* Boss Health Bar at Top-Center */}
          {hud.bossName && hud.bossMaxHp > 0 && (
            <div className="pointer-events-none absolute top-3 left-1/2 z-10 w-[min(420px,88%)] -translate-x-1/2 rounded-xl border border-amber-400/50 bg-slate-950/90 px-4 py-2 shadow-lg">
              <div className="font-mono-num flex items-center justify-between text-xs font-extrabold text-amber-300">
                <span className="flex items-center gap-1.5">
                  <Flame className="h-3.5 w-3.5 text-orange-400" aria-hidden="true" />
                  BOSS{hud.bossCount > 1 ? ` ×${hud.bossCount}` : ''}: {hud.bossName}
                </span>
                <span>
                  {hud.bossHp} / {hud.bossMaxHp}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-[width] duration-100"
                  style={{ width: `${Math.round((hud.bossHp / hud.bossMaxHp) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Bottom-Left Controls Hint & Active Arsenal */}
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-wrap items-end gap-2">
            <div className="rounded-xl border border-slate-700/80 bg-slate-950/85 px-3 py-2 text-[11px] text-slate-300 backdrop-blur-sm">
              <span className="font-bold text-emerald-300">Move:</span> WASD / Arrows or Drag ·{' '}
              <span className="font-bold text-cyan-300">Dash:</span> Space ·{' '}
              <span className="font-bold text-amber-300">Loop:</span> Slay → XP Crystals → Answer Q → Upgrade
              {coopScale.playerCount > 1 && ' · 50% Team XP Share'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(abilitiesState) as AbilityId[])
                .filter((id) => abilitiesState[id] > 0)
                .map((id) => (
                  <div
                    key={id}
                    className="font-mono-num rounded-lg border border-slate-700 bg-slate-950/85 px-2 py-1 text-[11px] font-bold"
                    style={{ color: ABILITY_CATALOG[id].color }}
                  >
                    {ABILITY_CATALOG[id].name.split(' ')[0]} Lv.{abilitiesState[id]}
                  </div>
                ))}
            </div>
          </div>

          {/* Bottom-Right Touch Dash Button */}
          <button
            type="button"
            onClick={handleTriggerDash}
            disabled={hud.dashCooldownRatio > 0}
            className="font-mono-num absolute right-4 bottom-4 z-10 flex h-12 cursor-pointer items-center gap-1.5 rounded-xl border border-cyan-400/50 bg-slate-900/90 px-4 text-xs font-extrabold text-cyan-300 shadow-lg backdrop-blur hover:bg-slate-800 disabled:opacity-50"
          >
            <Shield className="h-4 w-4" aria-hidden="true" />
            <span>
              {hud.dashCooldownRatio > 0
                ? `Dash ${(hud.dashCooldownRatio * 1.55).toFixed(1)}s`
                : 'Dash [Space]'}
            </span>
          </button>

          {/* PAUSED BANNER */}
          {paused && overlay === 'PLAYING' && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs">
              <div className="rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
                <div className="font-display text-xl font-extrabold text-white">Arena Paused</div>
                <p className="mt-1 text-xs text-slate-400">
                  Press P / Esc or click Resume to jump back in.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPaused(false)}
                    className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950"
                  >
                    Resume Battle
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STARTER PICK OR LEVEL-UP 3-CARD ABILITY DRAFT */}
          {(overlay === 'STARTER_PICK' || overlay === 'LEVEL_UP') && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-2xl rounded-2xl border border-amber-400/40 bg-slate-900 p-6 shadow-2xl">
                <div className="text-center">
                  <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-amber-300">
                    <Sparkles className="h-4 w-4" aria-hidden="true" />
                    <span>
                      {overlay === 'STARTER_PICK'
                        ? `Prepare for Monster Brawl (${diffProfile.label})`
                        : `Level ${hud.level} Upgrade Unlocked`}
                    </span>
                  </div>
                  <h2 className="font-display mt-1 text-xl font-extrabold text-white">
                    {overlay === 'STARTER_PICK'
                      ? 'Choose Your Starting Weapon (Press 1, 2, or 3)'
                      : 'Pick an Ability Upgrade (Press 1, 2, or 3)'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-400">
                    {overlay === 'STARTER_PICK'
                      ? 'Walk around the arena, survive monsters, and collect XP crystals to level up and answer questions.'
                      : 'Equip one upgrade below to grow stronger against incoming waves.'}
                  </p>
                  {coopScale.playerCount > 1 && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-300">
                      <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Sanctuary Shield active while teammates keep fighting!</span>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {upgradeOptions.map((id, idx) => {
                    const def = ABILITY_CATALOG[id];
                    const curLvl = abilitiesState[id] || 0;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => applyAbilityUpgrade(id)}
                        className="group flex cursor-pointer flex-col justify-between rounded-xl border border-slate-700 bg-slate-950/90 p-4 text-left transition-all hover:-translate-y-0.5 hover:border-amber-300"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span
                              className="font-mono-num rounded px-1.5 py-0.5 text-[11px] font-extrabold"
                              style={{ backgroundColor: def.accentBg, color: def.color }}
                            >
                              [{idx + 1}] {curLvl === 0 ? 'NEW' : `Lv.${curLvl} → ${curLvl + 1}`}
                            </span>
                          </div>
                          <div className="font-display mt-3 text-base font-extrabold text-white group-hover:text-amber-200">
                            {def.name}
                          </div>
                          <p className="mt-1.5 text-xs leading-relaxed text-slate-300">
                            {def.tagline}
                          </p>
                        </div>
                        <div className="mt-4 text-xs font-bold" style={{ color: def.color }}>
                          {overlay === 'STARTER_PICK' ? 'Start with Weapon →' : 'Equip Upgrade →'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* LEVEL-UP QUESTION GATE */}
          {overlay === 'LEVEL_UP_QUIZ' && activeQuestion && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
              <div className="w-full max-w-xl rounded-2xl border border-emerald-400/40 bg-slate-900 p-6 shadow-2xl">
                <div className="flex items-center justify-between gap-2 text-xs font-bold">
                  <span className="flex items-center gap-1.5 uppercase tracking-wider text-amber-300">
                    <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                    {`Level ${hud.level} Reached! Answer to Unlock Upgrade`}
                  </span>
                  <span className="text-slate-400">{activeQuestion.section}</span>
                </div>

                {coopScale.playerCount > 1 && (
                  <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-cyan-300">
                    <Shield className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Sanctuary Shield active — your hero is protected while you answer.</span>
                  </div>
                )}

                <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950 p-4">
                  <h3 className="font-display text-lg font-bold leading-snug text-white">
                    {activeQuestion.question}
                  </h3>
                </div>

                {!answerFeedback ? (
                  questionFormat === 'mcq' && activeQuestion.choices?.length ? (
                    <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                      {activeQuestion.choices.map((choice, idx) => {
                        const letter = String.fromCharCode(65 + idx);
                        const optionStyles = [
                          'border-rose-500/40 hover:border-rose-400 hover:bg-rose-500/15',
                          'border-sky-500/40 hover:border-sky-400 hover:bg-sky-500/15',
                          'border-amber-500/40 hover:border-amber-400 hover:bg-amber-500/15',
                          'border-emerald-500/40 hover:border-emerald-400 hover:bg-emerald-500/15',
                        ][idx % 4];
                        return (
                          <button
                            key={`${idx}:${choice}`}
                            type="button"
                            disabled={submittingAnswer}
                            onClick={() => void submitAnswerChoice(choice)}
                            className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-slate-950 px-3.5 py-3 text-left text-sm font-semibold text-white transition-colors disabled:opacity-50 ${optionStyles}`}
                          >
                            <span className="font-mono-num flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-800 text-xs font-extrabold text-slate-200">
                              {letter}
                            </span>
                            <span className="flex-1 leading-snug">{choice}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <form
                      onSubmit={(e: FormEvent) => {
                        e.preventDefault();
                        void submitAnswerChoice(typedAnswer);
                      }}
                      className="mt-4 space-y-3"
                    >
                      <input
                        type="text"
                        autoFocus
                        value={typedAnswer}
                        onChange={(e) => setTypedAnswer(e.target.value)}
                        placeholder="Type your answer and press Enter…"
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white outline-none focus:border-emerald-400"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="submit"
                          disabled={submittingAnswer || !typedAnswer.trim()}
                          className="cursor-pointer rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
                        >
                          {submittingAnswer ? 'Checking…' : 'Submit Answer'}
                        </button>
                      </div>
                    </form>
                  )
                ) : (
                  <div className="mt-4 space-y-3">
                    <div
                      className={`rounded-xl border p-4 text-sm ${
                        answerFeedback.correct
                          ? 'border-emerald-500 bg-emerald-500/15 text-emerald-200'
                          : 'border-rose-500 bg-rose-500/15 text-rose-200'
                      }`}
                    >
                      <div className="font-extrabold">
                        {answerFeedback.correct
                          ? `Correct! Upgrade unlocked (+20 HP · Streak ${answerFeedback.streak})`
                          : `Incorrect — Official Answer: ${answerFeedback.officialAnswer}`}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {!answerFeedback.correct ? (
                        <>
                          <button
                            type="button"
                            onClick={continueAfterQuiz}
                            className="cursor-pointer rounded-lg border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800"
                          >
                            Skip Upgrade
                          </button>
                          <button
                            type="button"
                            autoFocus
                            onClick={retryLevelUpQuestion}
                            className="cursor-pointer rounded-lg bg-amber-400 px-5 py-2 text-xs font-extrabold text-slate-950 hover:bg-amber-300"
                          >
                            Try Next Question [Enter]
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          autoFocus
                          onClick={continueAfterQuiz}
                          className="cursor-pointer rounded-lg bg-emerald-500 px-5 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"
                        >
                          Pick Your Upgrade → [Enter]
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* GAME OVER SCREEN (or Spectating Banner in Co-op) */}
          {overlay === 'GAME_OVER' && !spectating && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-2xl border border-rose-500/50 bg-slate-900 p-6 text-center shadow-2xl">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400">
                  <Skull className="h-8 w-8" aria-hidden="true" />
                </div>
                <div className="mt-3 text-xs font-extrabold uppercase tracking-widest text-rose-400">
                  {coopScale.playerCount > 1 && hud.aliveTeammateCount === 0
                    ? 'Squad Wiped'
                    : 'Health Depleted'}
                </div>
                <h2 className="font-display mt-1 text-3xl font-black tracking-tight text-white">
                  GAME OVER
                </h2>
                <p className="mt-1.5 text-xs text-slate-400">
                  {coopScale.playerCount > 1 && hud.aliveTeammateCount > 0
                    ? `${hud.aliveTeammateCount} teammate${hud.aliveTeammateCount > 1 ? 's' : ''} still fighting in the arena.`
                    : `You fell on Wave ${hud.wave} (${diffProfile.label} mode).`}
                </p>

                <div className="mt-5 grid grid-cols-2 gap-2.5 text-left">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3">
                    <div className="text-[11px] font-semibold text-slate-400">Wave Reached</div>
                    <div className="font-mono-num mt-0.5 text-lg font-extrabold text-amber-300">
                      Wave {hud.wave}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3">
                    <div className="text-[11px] font-semibold text-slate-400">Monsters Defeated</div>
                    <div className="font-mono-num mt-0.5 text-lg font-extrabold text-rose-300">
                      {hud.kills}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3">
                    <div className="text-[11px] font-semibold text-slate-400">Level Reached</div>
                    <div className="font-mono-num mt-0.5 text-lg font-extrabold text-emerald-300">
                      Lv.{hud.level}
                    </div>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3">
                    <div className="text-[11px] font-semibold text-slate-400">Total XP</div>
                    <div className="font-mono-num mt-0.5 text-lg font-extrabold text-cyan-300">
                      {hud.xp.toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap justify-center gap-2.5">
                  {coopScale.playerCount === 1 && (
                    <button
                      type="button"
                      onClick={handleRestartSoloRun}
                      className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Play Again</span>
                    </button>
                  )}

                  {coopScale.playerCount > 1 && hud.aliveTeammateCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setSpectating(true)}
                      className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-cyan-400"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Spectate Squad</span>
                    </button>
                  )}

                  {isHost && (
                    <button
                      type="button"
                      onClick={onFinishMatch}
                      className="flex cursor-pointer items-center gap-1.5 rounded-xl bg-amber-400 px-4 py-2.5 text-xs font-extrabold text-slate-950 hover:bg-amber-300"
                    >
                      <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>End &amp; Podium</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={onLeaveRoom}
                    className="flex cursor-pointer items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/15 px-4 py-2.5 text-xs font-bold text-rose-300 hover:bg-rose-500/25"
                  >
                    <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Leave Room</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {overlay === 'GAME_OVER' && spectating && (
            <div className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-rose-500/50 bg-slate-950/90 px-4 py-2 text-xs shadow-lg backdrop-blur-sm">
              <Skull className="h-4 w-4 text-rose-400" aria-hidden="true" />
              <span className="font-bold text-rose-300">GAME OVER · Spectating Squad</span>
              <button
                type="button"
                onClick={() => setSpectating(false)}
                className="cursor-pointer rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700"
              >
                Summary
              </button>
            </div>
          )}
        </div>

        {/* Collapsible Live Multiplayer Standings Drawer */}
        {showLeaderboard && (
          <aside className="flex w-64 shrink-0 flex-col border-l border-slate-800 bg-slate-900/95 p-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="font-display flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-slate-200">
                <Trophy className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
                Co-op Squad
              </span>
              <span className="font-mono-num text-[11px] text-slate-400">
                {connectedCount} online
              </span>
            </div>

            {coopScale.playerCount > 1 && (
              <div className="mt-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] text-cyan-200">
                Scaled for {coopScale.playerCount} players: {coopScale.coopHpMult.toFixed(2)}x HP ·{' '}
                {coopScale.coopSpawnMult.toFixed(2)}x Spawns
              </div>
            )}

            <div className="mt-2.5 flex-1 space-y-2 overflow-y-auto pr-0.5">
              {sortedPlayers.map((p, idx) => {
                const isMe = p.id === playerId;
                const st = p.brawlStats;
                const playerKo = Boolean(st && st.hp <= 0);
                const hpRatio = st
                  ? Math.max(0, Math.min(100, Math.round((st.hp / Math.max(1, st.maxHp)) * 100)))
                  : 100;
                return (
                  <div
                    key={p.id}
                    className={`rounded-xl border p-2.5 text-xs ${
                      playerKo
                        ? 'border-rose-500/40 bg-rose-950/20 opacity-80'
                        : isMe
                        ? 'border-emerald-400/60 bg-emerald-500/10'
                        : 'border-slate-800 bg-slate-950/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 truncate font-bold text-white">
                        <span>#{idx + 1} {p.nickname}</span>
                        {playerKo ? (
                          <Skull className="h-3 w-3 shrink-0 text-rose-400" aria-label="Defeated" />
                        ) : st?.shielded ? (
                          <Shield className="h-3 w-3 shrink-0 text-cyan-400" aria-label="Shielded" />
                        ) : null}
                      </span>
                      <span className="font-mono-num shrink-0 font-extrabold text-amber-300">
                        {p.score.toLocaleString()}
                      </span>
                    </div>
                    <div className="font-mono-num mt-1 flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        {playerKo ? 'KO' : `Lv.${st?.level ?? 1}`} · Wave {st?.wave ?? 1}
                      </span>
                      <span>
                        {st?.kills ?? 0} kills · {p.correctCount} Qs
                      </span>
                    </div>
                    {st && (
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                        <div
                          className={`h-full transition-[width] duration-150 ${
                            playerKo
                              ? 'bg-rose-500'
                              : st.shielded
                              ? 'bg-cyan-400'
                              : hpRatio <= 30
                              ? 'bg-rose-500'
                              : 'bg-emerald-400'
                          }`}
                          style={{ width: `${hpRatio}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
