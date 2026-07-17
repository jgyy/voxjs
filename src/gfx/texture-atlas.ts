import { mulberry32 } from "../util/rng";

const TILE_SIZE = 32;

interface TileSpec {
  base: [number, number, number];
  variance: number;
  speckleColor?: [number, number, number];
  speckleChance?: number;
}

// index 0 unused (Air), 1..4 match BLOCK_FACES layer ids in blocks.ts.
const TILES: TileSpec[] = [
  { base: [90, 150, 60], variance: 18 }, // 0: grass top (unused directly, see below)
  { base: [58, 110, 46], variance: 14 }, // 1: grass side
  { base: [110, 80, 55], variance: 16 }, // 2: dirt
  { base: [120, 120, 120], variance: 14, speckleColor: [90, 90, 90], speckleChance: 0.15 }, // 3: stone
  { base: [214, 199, 145], variance: 10 }, // 4: sand
];

/** Deterministically renders a small tiled texture into a canvas 2D layer. */
function paintTile(ctx: OffscreenCanvasRenderingContext2D, spec: TileSpec, seed: number): void {
  const rng = mulberry32(seed);
  const img = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const i = (y * TILE_SIZE + x) * 4;
      const useSpeckle = spec.speckleColor && rng() < (spec.speckleChance ?? 0);
      const color = useSpeckle ? spec.speckleColor! : spec.base;
      const n = (rng() - 0.5) * 2 * spec.variance;
      img.data[i] = clamp(color[0] + n);
      img.data[i + 1] = clamp(color[1] + n);
      img.data[i + 2] = clamp(color[2] + n);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function createTextureArray(device: GPUDevice): GPUTexture {
  const layerCount = TILES.length;
  const texture = device.createTexture({
    size: [TILE_SIZE, TILE_SIZE, layerCount],
    format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    mipLevelCount: 1,
  });

  TILES.forEach((spec, layer) => {
    const canvas = new OffscreenCanvas(TILE_SIZE, TILE_SIZE);
    const ctx = canvas.getContext("2d")!;
    paintTile(ctx, spec, 0xc0ffee + layer * 101);
    const imageData = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE);
    device.queue.writeTexture(
      { texture, origin: [0, 0, layer] },
      imageData.data,
      { bytesPerRow: TILE_SIZE * 4, rowsPerImage: TILE_SIZE },
      { width: TILE_SIZE, height: TILE_SIZE, depthOrArrayLayers: 1 },
    );
  });

  return texture;
}
