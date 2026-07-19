import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z } from "../config";
import { BlockId } from "./blocks";

export const CHUNK_VOLUME = CHUNK_SIZE_X * CHUNK_SIZE_Z * CHUNK_HEIGHT;

function index(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
}

export interface GpuMesh {
  vao: WebGLVertexArrayObject | null;
  vertexBuffer: WebGLBuffer | null;
  indexBuffer: WebGLBuffer | null;
  indexCount: number;
  triangleCount: number;
}

function emptyMesh(): GpuMesh {
  return { vao: null, vertexBuffer: null, indexBuffer: null, indexCount: 0, triangleCount: 0 };
}

/** One CHUNK_SIZE_X x CHUNK_HEIGHT x CHUNK_SIZE_Z column of blocks. */
export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  dirty = true;
  /** GPU mesh buffers are attached externally by the mesher/renderer; opaque + alpha-blended water/cloud/portal are separate draws. */
  meshVersion = 0;
  opaque: GpuMesh = emptyMesh();
  transparent: GpuMesh = emptyMesh();

  constructor(cx: number, cz: number) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOLUME);
  }

  get(x: number, y: number, z: number): BlockId {
    if (x < 0 || x >= CHUNK_SIZE_X || z < 0 || z >= CHUNK_SIZE_Z || y < 0 || y >= CHUNK_HEIGHT) {
      return BlockId.Air;
    }
    return this.blocks[index(x, y, z)]! as BlockId;
  }

  set(x: number, y: number, z: number, id: BlockId): void {
    this.blocks[index(x, y, z)] = id;
    this.dirty = true;
  }

  get worldOriginX(): number {
    return this.cx * CHUNK_SIZE_X;
  }

  get worldOriginZ(): number {
    return this.cz * CHUNK_SIZE_Z;
  }

  private disposeMesh(gl: WebGL2RenderingContext, mesh: GpuMesh): GpuMesh {
    if (mesh.vertexBuffer) gl.deleteBuffer(mesh.vertexBuffer);
    if (mesh.indexBuffer) gl.deleteBuffer(mesh.indexBuffer);
    if (mesh.vao) gl.deleteVertexArray(mesh.vao);
    return emptyMesh();
  }

  dispose(gl: WebGL2RenderingContext): void {
    this.opaque = this.disposeMesh(gl, this.opaque);
    this.transparent = this.disposeMesh(gl, this.transparent);
  }
}
