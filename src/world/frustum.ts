import { mat4 } from "gl-matrix";

// One plane per side, stored as (a, b, c, d) for ax+by+cz+d=0, normalized.
type Plane = [number, number, number, number];

const PLANE_COUNT = 6;

/** View-frustum extracted from a view-projection matrix (Gribb/Hartmann method). */
export class Frustum {
  private planes: Plane[] = Array.from({ length: PLANE_COUNT }, () => [0, 0, 0, 0]);

  setFromViewProjection(m: mat4): void {
    const me = m as unknown as number[];
    // column-major 4x4: element (row r, col c) = me[c*4 + r]
    const m00 = me[0]!, m01 = me[4]!, m02 = me[8]!, m03 = me[12]!;
    const m10 = me[1]!, m11 = me[5]!, m12 = me[9]!, m13 = me[13]!;
    const m20 = me[2]!, m21 = me[6]!, m22 = me[10]!, m23 = me[14]!;
    const m30 = me[3]!, m31 = me[7]!, m32 = me[11]!, m33 = me[15]!;

    this.setPlane(0, m30 + m00, m31 + m01, m32 + m02, m33 + m03); // left
    this.setPlane(1, m30 - m00, m31 - m01, m32 - m02, m33 - m03); // right
    this.setPlane(2, m30 + m10, m31 + m11, m32 + m12, m33 + m13); // bottom
    this.setPlane(3, m30 - m10, m31 - m11, m32 - m12, m33 - m13); // top
    this.setPlane(4, m30 + m20, m31 + m21, m32 + m22, m33 + m23); // near (WebGL -1..1 NDC z)
    this.setPlane(5, m30 - m20, m31 - m21, m32 - m22, m33 - m23); // far
  }

  private setPlane(i: number, a: number, b: number, c: number, d: number): void {
    const len = Math.hypot(a, b, c) || 1;
    this.planes[i] = [a / len, b / len, c / len, d / len];
  }

  /** True if the AABB intersects or is inside the frustum. */
  intersectsAABB(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): boolean {
    for (const [a, b, c, d] of this.planes) {
      const px = a >= 0 ? maxX : minX;
      const py = b >= 0 ? maxY : minY;
      const pz = c >= 0 ? maxZ : minZ;
      if (a * px + b * py + c * pz + d < 0) {
        return false;
      }
    }
    return true;
  }
}
