// Self-contained gradient noise (Ken Perlin's "improved noise", 2002),
// seeded from our own mulberry32 stream. The subject only allows pulling in
// libraries for 3D-model loading, windowing, and math (matrix/vector) —
// procedural terrain generation is a mandatory part of the project, so the
// noise itself must be implemented here rather than imported.

type RandomFn = () => number;

/** Builds a seed-derived permutation table (Fisher-Yates over 0..255, duplicated to 512 entries). */
function buildPermutation(random: RandomFn): Uint8Array {
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = base[i]!;
    base[i] = base[j]!;
    base[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255]!;
  return perm;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

const GRAD_2D: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
];

function grad2(hash: number, x: number, y: number): number {
  const g = GRAD_2D[hash & 7]!;
  return g[0] * x + g[1] * y;
}

/** Returns a deterministic 2D gradient-noise function, roughly in [-1, 1]. */
export function createNoise2D(random: RandomFn): (x: number, y: number) => number {
  const perm = buildPermutation(random);

  return function noise2D(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = perm[xi + perm[yi]!]!;
    const ab = perm[xi + perm[yi + 1]!]!;
    const ba = perm[xi + 1 + perm[yi]!]!;
    const bb = perm[xi + 1 + perm[yi + 1]!]!;

    const x1 = lerp(u, grad2(aa, xf, yf), grad2(ba, xf - 1, yf));
    const x2 = lerp(u, grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1));
    return lerp(v, x1, x2) * Math.SQRT2;
  };
}

// The 12 cube-edge gradient directions from Perlin's reference implementation.
const GRAD_3D: readonly (readonly [number, number, number])[] = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function grad3(hash: number, x: number, y: number, z: number): number {
  const g = GRAD_3D[hash % 12]!;
  return g[0] * x + g[1] * y + g[2] * z;
}

/** Returns a deterministic 3D gradient-noise function, roughly in [-1, 1]. */
export function createNoise3D(
  random: RandomFn,
): (x: number, y: number, z: number) => number {
  const perm = buildPermutation(random);

  return function noise3D(x: number, y: number, z: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);

    const a = perm[xi]! + yi;
    const aa = perm[a]! + zi;
    const ab = perm[a + 1]! + zi;
    const b = perm[xi + 1]! + yi;
    const ba = perm[b]! + zi;
    const bb = perm[b + 1]! + zi;

    return lerp(
      w,
      lerp(
        v,
        lerp(u, grad3(perm[aa]!, xf, yf, zf), grad3(perm[ba]!, xf - 1, yf, zf)),
        lerp(u, grad3(perm[ab]!, xf, yf - 1, zf), grad3(perm[bb]!, xf - 1, yf - 1, zf)),
      ),
      lerp(
        v,
        lerp(u, grad3(perm[aa + 1]!, xf, yf, zf - 1), grad3(perm[ba + 1]!, xf - 1, yf, zf - 1)),
        lerp(u, grad3(perm[ab + 1]!, xf, yf - 1, zf - 1), grad3(perm[bb + 1]!, xf - 1, yf - 1, zf - 1)),
      ),
    );
  };
}
