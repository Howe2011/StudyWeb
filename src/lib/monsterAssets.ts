import arenaMapImgUrl from '../assets/images/monster_brawl_arena_map_1795860971828.jpg';
import slimeGruntImgUrl from '../assets/images/monster_slime_king_1795860971610.jpg';
import frostGolemImgUrl from '../assets/images/monster_frost_golem_1795860971592.jpg';
import shadowImpImgUrl from '../assets/images/monster_shadow_bat_1795860972184.jpg';
import magmaDrakeImgUrl from '../assets/images/monster_magma_drake_1795860972656.jpg';
import arcaneTitanImgUrl from '../assets/images/monster_arcane_lich_1795860972939.jpg';

export type MonsterArchetypeId =
  | 'slime'
  | 'imp'
  | 'golem'
  | 'drake'
  | 'titan';

export interface MonsterArchetype {
  id: MonsterArchetypeId;
  name: string;
  imageUrl: string;
  baseHp: number;
  baseSpeed: number;
  radius: number;
  damage: number;
  xpValue: number;
  scoreValue: number;
  auraColor: string;
  accentColor: string;
  minWave: number;
  isBoss?: boolean;
  rangedFire?: boolean;
}

export const ARENA_MAP_URL = arenaMapImgUrl;

export const MONSTER_ARCHETYPES: Record<MonsterArchetypeId, MonsterArchetype> = {
  slime: {
    id: 'slime',
    name: 'Emerald Slime',
    imageUrl: slimeGruntImgUrl,
    baseHp: 34,
    baseSpeed: 88,
    radius: 26,
    damage: 10,
    xpValue: 18,
    scoreValue: 25,
    auraColor: '#10b981',
    accentColor: '#fde047',
    minWave: 1,
  },
  imp: {
    id: 'imp',
    name: 'Shadow Imp',
    imageUrl: shadowImpImgUrl,
    baseHp: 28,
    baseSpeed: 138,
    radius: 26,
    damage: 12,
    xpValue: 24,
    scoreValue: 35,
    auraColor: '#a855f7',
    accentColor: '#f59e0b',
    minWave: 2,
  },
  golem: {
    id: 'golem',
    name: 'Frost Golem',
    imageUrl: frostGolemImgUrl,
    baseHp: 96,
    baseSpeed: 64,
    radius: 34,
    damage: 18,
    xpValue: 45,
    scoreValue: 65,
    auraColor: '#06b6d4',
    accentColor: '#bae6fd',
    minWave: 3,
  },
  drake: {
    id: 'drake',
    name: 'Magma Drake',
    imageUrl: magmaDrakeImgUrl,
    baseHp: 135,
    baseSpeed: 96,
    radius: 36,
    damage: 20,
    xpValue: 75,
    scoreValue: 110,
    auraColor: '#ef4444',
    accentColor: '#fb923c',
    minWave: 4,
    rangedFire: true,
  },
  titan: {
    id: 'titan',
    name: 'Arcane Overlord',
    imageUrl: arcaneTitanImgUrl,
    baseHp: 460,
    baseSpeed: 74,
    radius: 50,
    damage: 28,
    xpValue: 260,
    scoreValue: 400,
    auraColor: '#f59e0b',
    accentColor: '#34d399',
    minWave: 3,
    isBoss: true,
    rangedFire: true,
  },
};

export interface ProcessedMonsterSprite {
  normal: HTMLCanvasElement;
  flash: HTMLCanvasElement;
}

export interface LoadedMonsterAssetPack {
  mapImage: HTMLImageElement | null;
  sprites: Partial<Record<MonsterArchetypeId, ProcessedMonsterSprite>>;
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load ${src}`));
    img.src = src;
  });
}

/**
 * Flood-fills from the 4 borders of the generated monster artwork to strip the
 * uniform dark slate studio backdrop (#0f172a) into clean transparent alpha.
 */
function buildTransparentMonsterSprite(img: HTMLImageElement, targetSize = 192): ProcessedMonsterSprite {
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return { normal: canvas, flash: canvas };
  }

  ctx.drawImage(img, 0, 0, targetSize, targetSize);
  const imgData = ctx.getImageData(0, 0, targetSize, targetSize);
  const data = imgData.data;

  // Sample average border background color from top-left and top-right pixels
  const sampleOffsets = [0, (targetSize - 1) * 4, (targetSize - 1) * targetSize * 4];
  let refR = 0;
  let refG = 0;
  let refB = 0;
  for (const off of sampleOffsets) {
    refR += data[off];
    refG += data[off + 1];
    refB += data[off + 2];
  }
  refR /= sampleOffsets.length;
  refG /= sampleOffsets.length;
  refB /= sampleOffsets.length;

  const total = targetSize * targetSize;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;

  const isBackdrop = (idx: number): boolean => {
    const p = idx * 4;
    const dr = data[p] - refR;
    const dg = data[p + 1] - refG;
    const db = data[p + 2] - refB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    // Keep very saturated pixels safe even near borders
    const maxCh = Math.max(data[p], data[p + 1], data[p + 2]);
    const minCh = Math.min(data[p], data[p + 1], data[p + 2]);
    const sat = maxCh - minCh;
    return dist < 44 && sat < 45;
  };

  const enqueue = (idx: number) => {
    if (idx < 0 || idx >= total || visited[idx]) return;
    if (isBackdrop(idx)) {
      visited[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < targetSize; x++) {
    enqueue(x);
    enqueue((targetSize - 1) * targetSize + x);
  }
  for (let y = 0; y < targetSize; y++) {
    enqueue(y * targetSize);
    enqueue(y * targetSize + (targetSize - 1));
  }

  while (head < tail) {
    const cur = queue[head++];
    const p = cur * 4;
    data[p + 3] = 0;

    const x = cur % targetSize;
    const y = (cur - x) / targetSize;
    if (x > 0) enqueue(cur - 1);
    if (x < targetSize - 1) enqueue(cur + 1);
    if (y > 0) enqueue(cur - targetSize);
    if (y < targetSize - 1) enqueue(cur + targetSize);
  }

  // Soft 1px feather on pixels bordering removed backdrop for anti-aliased edges
  for (let y = 1; y < targetSize - 1; y++) {
    for (let x = 1; x < targetSize - 1; x++) {
      const idx = y * targetSize + x;
      if (visited[idx]) continue;
      const hasTransparentNeighbor =
        visited[idx - 1] ||
        visited[idx + 1] ||
        visited[idx - targetSize] ||
        visited[idx + targetSize];
      if (hasTransparentNeighbor) {
        const p = idx * 4;
        const dr = data[p] - refR;
        const dg = data[p + 1] - refG;
        const db = data[p + 2] - refB;
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        if (dist < 62) {
          data[p + 3] = Math.min(data[p + 3], 150);
        }
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);

  // Build crisp white hit-flash silhouette canvas
  const flash = document.createElement('canvas');
  flash.width = targetSize;
  flash.height = targetSize;
  const fCtx = flash.getContext('2d');
  if (fCtx) {
    fCtx.drawImage(canvas, 0, 0);
    fCtx.globalCompositeOperation = 'source-atop';
    fCtx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    fCtx.fillRect(0, 0, targetSize, targetSize);
    fCtx.globalCompositeOperation = 'source-over';
  }

  return { normal: canvas, flash };
}

let cachedAssetPromise: Promise<LoadedMonsterAssetPack> | null = null;

export function loadMonsterAssetPack(): Promise<LoadedMonsterAssetPack> {
  if (cachedAssetPromise) return cachedAssetPromise;

  cachedAssetPromise = (async () => {
    const pack: LoadedMonsterAssetPack = { mapImage: null, sprites: {} };
    const entries = Object.values(MONSTER_ARCHETYPES);

    const [mapRes, ...monsterResults] = await Promise.allSettled([
      loadImageElement(arenaMapImgUrl),
      ...entries.map((m) => loadImageElement(m.imageUrl)),
    ]);

    if (mapRes.status === 'fulfilled') {
      pack.mapImage = mapRes.value;
    }
    monsterResults.forEach((res, idx) => {
      if (res.status === 'fulfilled') {
        const archetype = entries[idx];
        pack.sprites[archetype.id] = buildTransparentMonsterSprite(res.value, archetype.isBoss ? 240 : 192);
      }
    });

    return pack;
  })();

  return cachedAssetPromise;
}
