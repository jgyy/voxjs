// Builds simple stacked-box entity models (mobs, remote players) using the
// exact same proven per-face corner winding as the original (pre-greedy)
// block mesher, just remapped from a min-corner cube to a center+half-extent
// box — "Minecraft-like simplicity" per the subject's animation requirement.
const FACES: { normalIndex: number; corners: [number, number, number][] }[] = [
  { normalIndex: 0, corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { normalIndex: 1, corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { normalIndex: 2, corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]] },
  { normalIndex: 3, corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]] },
  { normalIndex: 4, corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { normalIndex: 5, corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
const UVS: [number, number][] = [
  [0, 1],
  [0, 0],
  [1, 0],
  [1, 1],
];

export interface EntityBox {
  cx: number;
  cy: number;
  cz: number; // box center, in local model space (origin = entity's feet)
  hx: number;
  hy: number;
  hz: number; // half-extents
  layer: number;
}

export interface EntityPose {
  worldX: number;
  worldY: number;
  worldZ: number;
  yaw: number; // radians, 0 = facing +X
  boxes: EntityBox[];
}

/** Appends one entity's world-space-transformed box geometry into shared vertex/index arrays. */
export function appendEntity(vertices: number[], indices: number[], vertexOffset: number, pose: EntityPose): number {
  const cos = Math.cos(pose.yaw);
  const sin = Math.sin(pose.yaw);
  let vc = vertexOffset;

  for (const box of pose.boxes) {
    for (const face of FACES) {
      for (let c = 0; c < 4; c++) {
        const corner = face.corners[c]!;
        const [u, v] = UVS[c]!;
        const lx = box.cx + (corner[0] === 0 ? -box.hx : box.hx);
        const ly = box.cy + (corner[1] === 0 ? -box.hy : box.hy);
        const lz = box.cz + (corner[2] === 0 ? -box.hz : box.hz);

        // Yaw rotation around the entity's vertical (Y) axis, then translate to world position.
        const wx = pose.worldX + lx * cos - lz * sin;
        const wz = pose.worldZ + lx * sin + lz * cos;
        const wy = pose.worldY + ly;

        vertices.push(wx, wy, wz, face.normalIndex, u, v, box.layer);
      }
      indices.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
      vc += 4;
    }
  }
  return vc;
}

export class EntityRenderer {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private vertexBuffer: WebGLBuffer;
  private indexBuffer: WebGLBuffer;
  private indexCount = 0;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.vertexBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;

    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    const stride = 7 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindVertexArray(null);
  }

  upload(poses: EntityPose[]): void {
    const gl = this.gl;
    if (poses.length === 0) {
      this.indexCount = 0;
      return;
    }
    const vertices: number[] = [];
    const indices: number[] = [];
    let vc = 0;
    for (const pose of poses) vc = appendEntity(vertices, indices, vc, pose);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.DYNAMIC_DRAW);
    this.indexCount = indices.length;
  }

  draw(): void {
    if (this.indexCount === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  get triangleCount(): number {
    return this.indexCount / 3;
  }
}
