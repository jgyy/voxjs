import { vec3 } from "gl-matrix";

export type SolidQuery = (x: number, y: number, z: number) => boolean;

export interface BodyDims {
  width: number;
  height: number;
}

/** Shared by the player and mob AI: sweeps an axis-aligned width x height x width body (feet-anchored) through the voxel world. */
export class VoxelBody {
  constructor(private dims: BodyDims) {}

  aabbCollides(feet: vec3, isSolid: SolidQuery): boolean {
    const hw = this.dims.width / 2;
    const minX = Math.floor(feet[0] - hw);
    const maxX = Math.floor(feet[0] + hw - 1e-6);
    const minY = Math.floor(feet[1]);
    const maxY = Math.floor(feet[1] + this.dims.height - 1e-6);
    const minZ = Math.floor(feet[2] - hw);
    const maxZ = Math.floor(feet[2] + hw - 1e-6);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (isSolid(x, y, z)) return true;
        }
      }
    }
    return false;
  }

  /** Largest sub-movement along one axis that doesn't collide, via binary search (robust and simple at our speed/timestep scale). */
  moveAxis(feet: vec3, axis: 0 | 1 | 2, delta: number, isSolid: SolidQuery): number {
    if (delta === 0) return 0;
    const probe = vec3.clone(feet);
    probe[axis] += delta;
    if (!this.aabbCollides(probe, isSolid)) return delta;

    let lo = 0;
    let hi = delta;
    for (let i = 0; i < 12; i++) {
      const mid = (lo + hi) / 2;
      probe[axis] = feet[axis] + mid;
      if (this.aabbCollides(probe, isSolid)) hi = mid;
      else lo = mid;
    }
    return lo;
  }
}
