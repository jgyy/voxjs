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
