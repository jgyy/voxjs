import type { vec3 } from "gl-matrix";

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
}

interface AxisWalk {
  step: number;
  tDelta: number;
  tMax: number;
}

function axisWalk(dir: number, origin: number): AxisWalk {
  if (dir > 0) {
    return { step: 1, tDelta: 1 / dir, tMax: (Math.floor(origin) + 1 - origin) / dir };
  }
  if (dir < 0) {
    return { step: -1, tDelta: 1 / -dir, tMax: (origin - Math.floor(origin)) / -dir };
  }
  return { step: 0, tDelta: Infinity, tMax: Infinity };
}

/**
 * Amanatides & Woo fast voxel traversal: steps exactly one voxel boundary at
 * a time along the ray (never skipping or double-visiting a cell) until it
 * finds a solid voxel within `maxDistance`, or returns null.
 */
export function raycastVoxel(
  origin: vec3,
  direction: vec3,
  maxDistance: number,
  isSolid: (x: number, y: number, z: number) => boolean,
): RaycastHit | null {
  let x = Math.floor(origin[0]);
  let y = Math.floor(origin[1]);
  let z = Math.floor(origin[2]);

  const ax = axisWalk(direction[0], origin[0]);
  const ay = axisWalk(direction[1], origin[1]);
  const az = axisWalk(direction[2], origin[2]);

  let traveled = 0;
  while (traveled <= maxDistance) {
    if (isSolid(x, y, z)) return { x, y, z };

    if (ax.tMax < ay.tMax && ax.tMax < az.tMax) {
      traveled = ax.tMax;
      x += ax.step;
      ax.tMax += ax.tDelta;
    } else if (ay.tMax < az.tMax) {
      traveled = ay.tMax;
      y += ay.step;
      ay.tMax += ay.tDelta;
    } else {
      traveled = az.tMax;
      z += az.step;
      az.tMax += az.tDelta;
    }
  }
  return null;
}
