import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  CHUNK_UNLOAD_MARGIN_CHUNKS,
  MAX_EDITED_CHUNKS,
} from "../config";
import { BlockId } from "./blocks";
import { Chunk } from "./chunk";
import { Frustum } from "./frustum";
import { TerrainGenerator } from "./generator";
import { buildChunkMesh, VERTEX_FLOATS } from "./mesher";

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private generator = new TerrainGenerator();
  private gl: WebGL2RenderingContext;
  /** Cap the number of (re)meshes uploaded per frame to avoid frame-time spikes. */
  private meshBudgetPerFrame = 2;

  /**
   * Player-made edits (currently just block removal), keyed by chunk then by
   * local "x,y,z" position, so a chunk that gets evicted and later
   * regenerated still reflects them. Map iteration order is insertion order,
   * which we exploit as a simple LRU: touching a chunk's edits re-inserts its
   * key at the end, and once the cache holds more than MAX_EDITED_CHUNKS
   * chunks the oldest (first) entry is dropped — mirroring the same
   * "remember visited terrain up to a limit, then forget it" rule the
   * subject requires for the terrain itself.
   */
  private edits = new Map<string, Map<string, BlockId>>();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  getBlock = (x: number, y: number, z: number): number => {
    if (y < 0 || y >= CHUNK_HEIGHT) return BlockId.Air;
    const cx = Math.floor(x / CHUNK_SIZE_X);
    const cz = Math.floor(z / CHUNK_SIZE_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (chunk) {
      const lx = x - chunk.worldOriginX;
      const lz = z - chunk.worldOriginZ;
      return chunk.get(lx, y, lz);
    }
    return this.generator.getBlockAt(x, y, z);
  };

  /** Bonus: "being able to delete blocks with the mouse". Returns false if there was nothing to remove. */
  removeBlock(worldX: number, y: number, worldZ: number): boolean {
    const cx = Math.floor(worldX / CHUNK_SIZE_X);
    const cz = Math.floor(worldZ / CHUNK_SIZE_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;

    const lx = worldX - chunk.worldOriginX;
    const lz = worldZ - chunk.worldOriginZ;
    if (chunk.get(lx, y, lz) === BlockId.Air) return false;

    chunk.set(lx, y, lz, BlockId.Air);
    this.recordEdit(cx, cz, lx, y, lz, BlockId.Air);

    // A block removed right on a chunk border can expose a face in the
    // neighboring chunk's mesh that was previously culled as hidden.
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE_X - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE_Z - 1) this.markDirty(cx, cz + 1);

    return true;
  }

  private markDirty(cx: number, cz: number): void {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (chunk) chunk.dirty = true;
  }

  private recordEdit(cx: number, cz: number, lx: number, y: number, lz: number, id: BlockId): void {
    const key = chunkKey(cx, cz);
    const existing = this.edits.get(key);
    const chunkEdits = existing ?? new Map<string, BlockId>();
    if (existing) this.edits.delete(key); // drop + re-set below to bump recency
    chunkEdits.set(`${lx},${y},${lz}`, id);
    this.edits.set(key, chunkEdits);

    if (this.edits.size > MAX_EDITED_CHUNKS) {
      const oldestKey = this.edits.keys().next().value;
      if (oldestKey !== undefined) this.edits.delete(oldestKey);
    }
  }

  private applyStoredEdits(chunk: Chunk): void {
    const chunkEdits = this.edits.get(chunkKey(chunk.cx, chunk.cz));
    if (!chunkEdits) return;
    for (const [posKey, id] of chunkEdits) {
      const [lx, y, lz] = posKey.split(",").map(Number) as [number, number, number];
      chunk.set(lx, y, lz, id);
    }
  }

  /** Ensures chunks within `radiusChunks` of the player exist, meshed & uploaded, and evicts far ones. */
  update(playerChunkX: number, playerChunkZ: number, radiusChunks: number): void {
    const wanted = new Set<string>();
    for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
        if (dx * dx + dz * dz > radiusChunks * radiusChunks) continue;
        const cx = playerChunkX + dx;
        const cz = playerChunkZ + dz;
        wanted.add(chunkKey(cx, cz));
        if (!this.chunks.has(chunkKey(cx, cz))) {
          const chunk = new Chunk(cx, cz);
          this.generator.generate(chunk);
          this.applyStoredEdits(chunk);
          this.chunks.set(chunkKey(cx, cz), chunk);
        }
      }
    }

    let meshBudget = this.meshBudgetPerFrame;
    for (const chunk of this.chunks.values()) {
      if (meshBudget <= 0) break;
      if (chunk.dirty) {
        try {
          this.uploadMesh(chunk);
        } catch (err) {
          console.error(`Failed to mesh chunk (${chunk.cx}, ${chunk.cz}):`, err);
          chunk.dirty = false;
        }
        meshBudget--;
      }
    }

    const unloadRadius = radiusChunks + CHUNK_UNLOAD_MARGIN_CHUNKS;
    for (const [key, chunk] of this.chunks) {
      const ddx = chunk.cx - playerChunkX;
      const ddz = chunk.cz - playerChunkZ;
      if (ddx * ddx + ddz * ddz > unloadRadius * unloadRadius) {
        chunk.dispose(this.gl);
        this.chunks.delete(key);
      }
    }
  }

  private uploadMesh(chunk: Chunk): void {
    const { vertices, indices } = buildChunkMesh(chunk, this.getBlock);
    chunk.dispose(this.gl);

    if (indices.length === 0) {
      chunk.indexCount = 0;
      chunk.dirty = false;
      return;
    }

    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const stride = VERTEX_FLOATS * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 16);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);

    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    chunk.vao = vao;
    chunk.vertexBuffer = vertexBuffer;
    chunk.indexBuffer = indexBuffer;
    chunk.indexCount = indices.length;
    chunk.dirty = false;
    chunk.meshVersion++;
  }

  /** Chunks with a ready GPU mesh that pass the frustum test, for rendering. */
  *visibleChunks(frustum: Frustum): Generator<Chunk> {
    for (const chunk of this.chunks.values()) {
      if (!chunk.vao || chunk.indexCount === 0) continue;
      const minX = chunk.worldOriginX;
      const minZ = chunk.worldOriginZ;
      if (
        frustum.intersectsAABB(minX, 0, minZ, minX + CHUNK_SIZE_X, CHUNK_HEIGHT, minZ + CHUNK_SIZE_Z)
      ) {
        yield chunk;
      }
    }
  }

  get loadedChunkCount(): number {
    return this.chunks.size;
  }

  get pendingMeshCount(): number {
    let n = 0;
    for (const c of this.chunks.values()) if (c.dirty) n++;
    return n;
  }

  static get vertexFloats(): number {
    return VERTEX_FLOATS;
  }
}
