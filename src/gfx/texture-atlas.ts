import { mulberry32 } from "../util/rng";

const TILE_SIZE = 32;

type TileKind = "speckle" | "ringLog" | "barkLog" | "ore" | "plant" | "soft" | "swirl";

interface TileSpec {
  kind: TileKind;
  base: [number, number, number];
  variance: number;
  accent?: [number, number, number];
  accentChance?: number;
  /** For "plant" tiles: silhouette color drawn on a transparent background. */
  plantColor?: [number, number, number];
  plantColor2?: [number, number, number];
  /** 0..1, how much of the tile height the plant silhouette fills (growth stages). */
  plantFill?: number;
  plantStyle?: "blades" | "flower" | "mushroom" | "twig" | "crop";
  alpha?: number; // fixed alpha for "soft"/translucent tiles (cloud, portal)
}

// Layer indices below are referenced by BLOCK_FACES in blocks.ts — keep in sync.
const TILES: TileSpec[] = [
  { kind: "speckle", base: [90, 150, 60], variance: 18 }, // 0 grass top
  { kind: "speckle", base: [58, 110, 46], variance: 14 }, // 1 grass side
  { kind: "speckle", base: [110, 80, 55], variance: 16 }, // 2 dirt
  { kind: "speckle", base: [120, 120, 120], variance: 14, accent: [90, 90, 90], accentChance: 0.15 }, // 3 stone
  { kind: "speckle", base: [214, 199, 145], variance: 10 }, // 4 sand
  { kind: "speckle", base: [235, 235, 245], variance: 10, accent: [210, 220, 235], accentChance: 0.2 }, // 5 snow
  { kind: "soft", base: [40, 95, 170], variance: 16, alpha: 0.62 }, // 6 water (translucent, V.2 requirement)
  { kind: "speckle", base: [45, 100, 40], variance: 16 }, // 7 forest grass top
  { kind: "speckle", base: [30, 70, 32], variance: 12 }, // 8 forest grass side
  { kind: "ringLog", base: [150, 112, 70], variance: 10, accent: [110, 78, 48] }, // 9 log top (rings)
  { kind: "barkLog", base: [96, 66, 40], variance: 10, accent: [70, 48, 28] }, // 10 oak log side (bark)
  { kind: "speckle", base: [52, 108, 40], variance: 20, accent: [36, 84, 30], accentChance: 0.35 }, // 11 oak leaves
  { kind: "ringLog", base: [128, 90, 58], variance: 10, accent: [92, 62, 38] }, // 12 sequoia/jungle log top
  { kind: "barkLog", base: [92, 54, 40], variance: 12, accent: [64, 34, 26] }, // 13 sequoia log side
  { kind: "speckle", base: [34, 78, 46], variance: 14, accent: [24, 58, 34], accentChance: 0.3 }, // 14 sequoia leaves
  { kind: "barkLog", base: [150, 110, 70], variance: 12, accent: [110, 76, 44] }, // 15 acacia log side
  { kind: "speckle", base: [110, 130, 40], variance: 16, accent: [90, 108, 30], accentChance: 0.3 }, // 16 acacia leaves
  { kind: "barkLog", base: [104, 76, 46], variance: 10, accent: [76, 52, 30] }, // 17 jungle log side
  { kind: "speckle", base: [40, 120, 46], variance: 18, accent: [26, 96, 34], accentChance: 0.35 }, // 18 jungle leaves
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [70, 150, 50], plantStyle: "blades", plantFill: 1 }, // 19 tall grass
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [60, 140, 46], plantColor2: [210, 40, 40], plantStyle: "flower" }, // 20 red flower
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [60, 140, 46], plantColor2: [235, 205, 40], plantStyle: "flower" }, // 21 yellow flower
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [230, 230, 225], plantColor2: [190, 60, 50], plantStyle: "mushroom" }, // 22 mushroom
  { kind: "speckle", base: [60, 120, 55], variance: 12 }, // 23 cactus top
  { kind: "speckle", base: [50, 108, 48], variance: 12, accent: [200, 210, 190], accentChance: 0.05 }, // 24 cactus side
  { kind: "ore", base: [120, 120, 120], variance: 10, accent: [35, 35, 38] }, // 25 coal ore
  { kind: "ore", base: [124, 118, 112], variance: 10, accent: [214, 178, 140] }, // 26 iron ore
  { kind: "ore", base: [128, 118, 90], variance: 10, accent: [244, 208, 60] }, // 27 gold ore
  { kind: "ore", base: [116, 128, 130], variance: 10, accent: [90, 224, 226] }, // 28 diamond ore
  { kind: "speckle", base: [176, 96, 62], variance: 14 }, // 29 red sand (canyon)
  { kind: "speckle", base: [72, 62, 46], variance: 10, accent: [50, 44, 32], accentChance: 0.2 }, // 30 mud (swamp)
  { kind: "speckle", base: [128, 122, 118], variance: 16, accent: [96, 92, 88], accentChance: 0.3 }, // 31 gravel
  { kind: "speckle", base: [140, 148, 70], variance: 14 }, // 32 savanna grass top
  { kind: "speckle", base: [104, 100, 52], variance: 12 }, // 33 savanna grass side
  { kind: "speckle", base: [186, 150, 100], variance: 10 }, // 34 planks
  { kind: "speckle", base: [176, 140, 92], variance: 8, accent: [90, 60, 40], accentChance: 0.08 }, // 35 crafting table top
  { kind: "speckle", base: [150, 116, 74], variance: 10 }, // 36 crafting table side
  { kind: "speckle", base: [110, 110, 112], variance: 10, accent: [40, 40, 42], accentChance: 0.1 }, // 37 furnace top
  { kind: "speckle", base: [104, 104, 106], variance: 10, accent: [20, 20, 20], accentChance: 0.12 }, // 38 furnace side (mouth)
  { kind: "speckle", base: [128, 128, 130], variance: 18, accent: [96, 96, 98], accentChance: 0.25 }, // 39 cobblestone
  { kind: "speckle", base: [24, 18, 32], variance: 8, accent: [72, 40, 120], accentChance: 0.06 }, // 40 obsidian
  { kind: "swirl", base: [90, 20, 140], variance: 30, accent: [220, 160, 255], alpha: 0.75 }, // 41 nether portal
  { kind: "soft", base: [250, 250, 255], variance: 8, alpha: 0.82 }, // 42 cloud
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [70, 130, 40], plantStyle: "twig", plantFill: 0.45 }, // 43 sapling young
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [58, 118, 34], plantStyle: "twig", plantFill: 0.75 }, // 44 sapling mid
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [70, 140, 40], plantStyle: "crop", plantFill: 0.3 }, // 45 crop stage 0
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [90, 150, 40], plantStyle: "crop", plantFill: 0.55 }, // 46 crop stage 1
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [150, 160, 40], plantStyle: "crop", plantFill: 0.8 }, // 47 crop stage 2
  { kind: "plant", base: [0, 0, 0], variance: 0, plantColor: [210, 170, 40], plantStyle: "crop", plantFill: 1 }, // 48 crop stage 3
  { kind: "speckle", base: [110, 46, 40], variance: 16, accent: [80, 30, 28], accentChance: 0.2 }, // 49 netherrack
  { kind: "ore", base: [112, 48, 42], variance: 12, accent: [244, 196, 60] }, // 50 nether gold ore
  { kind: "speckle", base: [58, 48, 66], variance: 12, accent: [40, 32, 48], accentChance: 0.2 }, // 51 basalt top
  { kind: "speckle", base: [50, 42, 58], variance: 10, accent: [34, 28, 42], accentChance: 0.25 }, // 52 basalt side
  { kind: "speckle", base: [40, 40, 42], variance: 8, accent: [20, 20, 22], accentChance: 0.3 }, // 53 bedrock
  { kind: "speckle", base: [78, 128, 74], variance: 12, accent: [50, 40, 40], accentChance: 0.08 }, // 54 zombie skin
  { kind: "speckle", base: [66, 140, 60], variance: 10, accent: [40, 90, 38], accentChance: 0.3 }, // 55 creeper skin
  { kind: "speckle", base: [230, 200, 170], variance: 12 }, // 56 player skin (arms/head, for view-model + remote players)
  { kind: "speckle", base: [140, 100, 60], variance: 10, accent: [60, 60, 62], accentChance: 0.15 }, // 57 arrow shaft
];

export const MOB_TEXTURE_LAYERS = { zombie: 54, creeper: 55, player: 56, arrow: 57 } as const;

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function setPixel(img: ImageData, x: number, y: number, r: number, g: number, b: number, a: number): void {
  const i = (y * TILE_SIZE + x) * 4;
  img.data[i] = clamp(r);
  img.data[i + 1] = clamp(g);
  img.data[i + 2] = clamp(b);
  img.data[i + 3] = clamp(a);
}

function paintSpeckle(img: ImageData, spec: TileSpec, rng: () => number): void {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const useAccent = spec.accent && rng() < (spec.accentChance ?? 0);
      const color = useAccent ? spec.accent! : spec.base;
      const n = (rng() - 0.5) * 2 * spec.variance;
      setPixel(img, x, y, color[0] + n, color[1] + n, color[2] + n, 255);
    }
  }
}

/** Concentric-ring "log end grain" look for top/bottom log faces. */
function paintRingLog(img: ImageData, spec: TileSpec, rng: () => number): void {
  const cx = TILE_SIZE / 2;
  const cy = TILE_SIZE / 2;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.hypot(dx, dy);
      const ring = Math.sin(dist * 1.1) * 0.5 + 0.5;
      const color = ring > 0.55 ? spec.accent! : spec.base;
      const n = (rng() - 0.5) * spec.variance;
      setPixel(img, x, y, color[0] + n, color[1] + n, color[2] + n, 255);
    }
  }
}

/** Vertical bark stripes for log side faces. */
function paintBarkLog(img: ImageData, spec: TileSpec, rng: () => number): void {
  const stripeWidth = 3 + Math.floor(rng() * 2);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const wobble = Math.sin(y * 0.4 + x * 0.05) * 1.5;
      const stripe = Math.floor((x + wobble) / stripeWidth) % 2 === 0;
      const color = stripe ? spec.base : spec.accent!;
      const n = (rng() - 0.5) * spec.variance;
      setPixel(img, x, y, color[0] + n, color[1] + n, color[2] + n, 255);
    }
  }
}

/** Stone-like base with a handful of mineral-colored blob clusters (ore veins). */
function paintOre(img: ImageData, spec: TileSpec, rng: () => number): void {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = (rng() - 0.5) * spec.variance;
      setPixel(img, x, y, spec.base[0] + n, spec.base[1] + n, spec.base[2] + n, 255);
    }
  }
  const blobCount = 3 + Math.floor(rng() * 3);
  for (let b = 0; b < blobCount; b++) {
    const bx = Math.floor(rng() * TILE_SIZE);
    const by = Math.floor(rng() * TILE_SIZE);
    const r = 1 + Math.floor(rng() * 2);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const px = bx + x;
        const py = by + y;
        if (px < 0 || py < 0 || px >= TILE_SIZE || py >= TILE_SIZE) continue;
        if (x * x + y * y > r * r + 1) continue;
        const n = (rng() - 0.5) * 10;
        setPixel(img, px, py, spec.accent![0] + n, spec.accent![1] + n, spec.accent![2] + n, 255);
      }
    }
  }
}

/** Soft near-uniform translucent tile (clouds). */
function paintSoft(img: ImageData, spec: TileSpec, rng: () => number): void {
  const alpha = (spec.alpha ?? 1) * 255;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const n = (rng() - 0.5) * spec.variance;
      setPixel(img, x, y, spec.base[0] + n, spec.base[1] + n, spec.base[2] + n, alpha);
    }
  }
}

/** Radial swirl for the nether portal face. */
function paintSwirl(img: ImageData, spec: TileSpec, rng: () => number): void {
  const cx = TILE_SIZE / 2;
  const cy = TILE_SIZE / 2;
  const alpha = (spec.alpha ?? 1) * 255;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const angle = Math.atan2(dy, dx);
      const dist = Math.hypot(dx, dy);
      const swirl = Math.sin(angle * 5 + dist * 0.6) * 0.5 + 0.5;
      const color = swirl > 0.6 ? spec.accent! : spec.base;
      const n = (rng() - 0.5) * spec.variance;
      setPixel(img, x, y, color[0] + n, color[1] + n, color[2] + n, alpha);
    }
  }
}

/** Plant silhouettes on a transparent background, alpha-tested in the fragment shader. */
function paintPlant(img: ImageData, spec: TileSpec, rng: () => number): void {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      setPixel(img, x, y, 0, 0, 0, 0);
    }
  }
  const fill = spec.plantFill ?? 1;
  const topY = Math.floor(TILE_SIZE * (1 - fill));
  const color = spec.plantColor ?? [60, 140, 46];

  if (spec.plantStyle === "blades") {
    const bladeXs = [5, 11, 16, 21, 27];
    for (const bx of bladeXs) {
      const sway = (rng() - 0.5) * 4;
      const bladeTop = topY + Math.floor(rng() * 4);
      for (let y = bladeTop; y < TILE_SIZE; y++) {
        const t = (y - bladeTop) / Math.max(1, TILE_SIZE - bladeTop);
        const width = 1 + Math.round(t * 1.5);
        const cx = Math.round(bx + sway * (1 - t));
        for (let x = cx - width; x <= cx + width; x++) {
          if (x < 0 || x >= TILE_SIZE) continue;
          const n = (rng() - 0.5) * 16;
          setPixel(img, x, y, color[0] + n, color[1] + n, color[2] + n, 255);
        }
      }
    }
  } else if (spec.plantStyle === "flower") {
    const bloom = spec.plantColor2 ?? [210, 60, 50];
    for (let y = 18; y < TILE_SIZE; y++) {
      const cx = TILE_SIZE / 2;
      const n = (rng() - 0.5) * 10;
      setPixel(img, Math.round(cx), y, color[0] + n, color[1] + n, color[2] + n, 255);
      setPixel(img, Math.round(cx) - 1, y, color[0] + n, color[1] + n, color[2] + n, y > 24 ? 255 : 0);
    }
    const bcx = TILE_SIZE / 2;
    const bcy = 12;
    for (let y = -4; y <= 4; y++) {
      for (let x = -4; x <= 4; x++) {
        if (x * x + y * y > 16) continue;
        const px = Math.round(bcx + x);
        const py = Math.round(bcy + y);
        if (px < 0 || py < 0 || px >= TILE_SIZE || py >= TILE_SIZE) continue;
        const n = (rng() - 0.5) * 14;
        setPixel(img, px, py, bloom[0] + n, bloom[1] + n, bloom[2] + n, 255);
      }
    }
  } else if (spec.plantStyle === "mushroom") {
    const cap = spec.plantColor2 ?? [190, 60, 50];
    const cx = TILE_SIZE / 2;
    for (let y = 20; y < TILE_SIZE; y++) {
      for (let x = cx - 2; x <= cx + 2; x++) {
        setPixel(img, Math.round(x), y, color[0], color[1], color[2], 255);
      }
    }
    for (let y = 8; y < 20; y++) {
      const t = (y - 8) / 12;
      const halfWidth = 9 * (1 - Math.abs(t - 0.15));
      for (let x = cx - halfWidth; x <= cx + halfWidth; x++) {
        const px = Math.round(x);
        if (px < 0 || px >= TILE_SIZE) continue;
        const n = (rng() - 0.5) * 12;
        setPixel(img, px, y, cap[0] + n, cap[1] + n, cap[2] + n, 255);
      }
    }
  } else if (spec.plantStyle === "twig") {
    const cx = TILE_SIZE / 2;
    for (let y = topY; y < TILE_SIZE; y++) {
      const n = (rng() - 0.5) * 10;
      setPixel(img, Math.round(cx), y, 120 + n, 90 + n, 60 + n, 255);
    }
    const leafCount = 4;
    for (let i = 0; i < leafCount; i++) {
      const ly = topY + Math.floor((TILE_SIZE - topY) * (i / leafCount));
      const side = i % 2 === 0 ? -1 : 1;
      for (let r = 0; r < 3; r++) {
        const px = Math.round(cx + side * (2 + r));
        const py = ly + r;
        if (px < 0 || px >= TILE_SIZE || py < 0 || py >= TILE_SIZE) continue;
        const n = (rng() - 0.5) * 16;
        setPixel(img, px, py, color[0] + n, color[1] + n, color[2] + n, 255);
      }
    }
  } else if (spec.plantStyle === "crop") {
    const bladeXs = [4, 9, 14, 18, 23, 28];
    for (const bx of bladeXs) {
      for (let y = topY; y < TILE_SIZE; y++) {
        const n = (rng() - 0.5) * 16;
        setPixel(img, bx, y, color[0] + n, color[1] + n, color[2] + n, 255);
        if (fill > 0.5) setPixel(img, bx + 1, y, color[0] + n, color[1] + n, color[2] + n, 255);
      }
    }
  }
}

function paintTile(ctx: OffscreenCanvasRenderingContext2D, spec: TileSpec, seed: number): void {
  const rng = mulberry32(seed);
  const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  switch (spec.kind) {
    case "ringLog":
      paintRingLog(img, spec, rng);
      break;
    case "barkLog":
      paintBarkLog(img, spec, rng);
      break;
    case "ore":
      paintOre(img, spec, rng);
      break;
    case "soft":
      paintSoft(img, spec, rng);
      break;
    case "swirl":
      paintSwirl(img, spec, rng);
      break;
    case "plant":
      paintPlant(img, spec, rng);
      break;
    default:
      paintSpeckle(img, spec, rng);
  }
  ctx.putImageData(img, 0, 0);
}

export function createTextureArray(gl: WebGL2RenderingContext): WebGLTexture {
  const layerCount = TILES.length;
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, TILE_SIZE, TILE_SIZE, layerCount);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);

  TILES.forEach((spec, layer) => {
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = canvas.getContext("2d")!;
    paintTile(ctx, spec, 0xc0ffee + layer * 101);
    const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      TILE_SIZE,
      TILE_SIZE,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      imageData.data,
    );
  });

  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  return texture!;
}

export const TEXTURE_LAYER_COUNT = TILES.length;
