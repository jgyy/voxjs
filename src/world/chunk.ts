import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z } from "../config";
import { BlockId } from "./blocks";

export const CHUNK_VOLUME = CHUNK_SIZE_X * CHUNK_SIZE_Z * CHUNK_HEIGHT;

function index(x: number, y: number, z: number): number {
  return (y * CHUNK_SIZE_Z + z) * CHUNK_SIZE_X + x;
}

/** One CHUNK_SIZE_X x CHUNK_HEIGHT x CHUNK_SIZE_Z column of blocks. */
export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  dirty = true;
  /** GPU mesh buffers are attached externally by the mesher/renderer. */
  meshVersion = 0;
  vao: WebGLVertexArrayObject | null = null;
  vertexBuffer: WebGLBuffer | null = null;
  indexBuffer: WebGLBuffer | null = null;
  indexCount = 0;

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

  dispose(gl: WebGL2RenderingContext): void {
    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vertexBuffer = null;
    this.indexBuffer = null;
    this.vao = null;
  }
}
