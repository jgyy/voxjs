import {
  CHUNK_HEIGHT,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  CHUNK_UNLOAD_MARGIN_CHUNKS,
  EDIT_STORAGE_KEY,
  MAX_EDITED_CHUNKS,
} from "../config";
import { BlockId, isSolid } from "./blocks";
import { Biome } from "./biomes";
import { Chunk, GpuMesh } from "./chunk";
import { Frustum } from "./frustum";
import { TerrainGenerator } from "./generator";
import { WorldGenerator } from "./generator-types";
import { buildChunkMesh, MeshResult, VERTEX_FLOATS } from "./mesher";

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export class ChunkManager {
  private chunks = new Map<string, Chunk>();
  private generator: WorldGenerator;
  private gl: WebGL2RenderingContext;
  /** Caps (re)meshes uploaded and brand-new chunks generated per frame, so a fast-moving or
   * teleporting player can't cause a multi-hundred-millisecond hitch in a single frame. */
  private meshBudgetPerFrame = 2;
  private genBudgetPerFrame = 4;

  /**
   * Player-made edits (block removal AND placement), keyed by chunk then by
   * local "x,y,z" position, so a chunk that gets evicted and later
   * regenerated still reflects them. Map iteration order is insertion order,
   * which we exploit as a simple LRU: touching a chunk's edits re-inserts its
   * key at the end, and once the cache holds more than MAX_EDITED_CHUNKS
   * chunks the oldest (first) entry is dropped — mirroring the same
   * "remember visited terrain up to a limit, then forget it" rule the
   * subject requires for the terrain itself. Also flushed to localStorage so
   * a page reload in single-player/offline mode doesn't lose the world.
   */
  private edits = new Map<string, Map<string, BlockId>>();
  private storageKey: string;

  constructor(gl: WebGL2RenderingContext, generator: WorldGenerator, storageKeySuffix = "") {
    this.gl = gl;
    this.generator = generator;
    this.storageKey = EDIT_STORAGE_KEY + storageKeySuffix;
    this.loadEditsFromStorage();
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

  isSolidAt = (x: number, y: number, z: number): boolean => isSolid(this.getBlock(x, y, z));

  /** Only meaningful for the overworld generator; other dimensions (e.g. the nether) have no biomes. */
  biomeAt(x: number, z: number): Biome | null {
    return this.generator instanceof TerrainGenerator ? this.generator.biomeAt(x, z) : null;
  }

  /** Bonus: "being able to delete blocks with the mouse". Returns the removed block id (for pickup), or null if nothing was removed. */
  removeBlock(worldX: number, y: number, worldZ: number): BlockId | null {
    const cx = Math.floor(worldX / CHUNK_SIZE_X);
    const cz = Math.floor(worldZ / CHUNK_SIZE_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return null;

    const lx = worldX - chunk.worldOriginX;
    const lz = worldZ - chunk.worldOriginZ;
    const existing = chunk.get(lx, y, lz);
    if (existing === BlockId.Air) return null;

    chunk.set(lx, y, lz, BlockId.Air);
    this.recordEdit(cx, cz, lx, y, lz, BlockId.Air);
    this.markBorderNeighborsDirty(cx, cz, lx, lz);
    return existing;
  }

  /** V.1: "place [blocks] wherever you want". Returns false if the target cell isn't free. */
  placeBlock(worldX: number, y: number, worldZ: number, id: BlockId): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(worldX / CHUNK_SIZE_X);
    const cz = Math.floor(worldZ / CHUNK_SIZE_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;

    const lx = worldX - chunk.worldOriginX;
    const lz = worldZ - chunk.worldOriginZ;
    if (chunk.get(lx, y, lz) !== BlockId.Air) return false;

    chunk.set(lx, y, lz, id);
    this.recordEdit(cx, cz, lx, y, lz, id);
    this.markBorderNeighborsDirty(cx, cz, lx, lz);
    return true;
  }

  /**
   * Unconditional block replacement for simulation systems (bonus: growing
   * plants, water flow) — unlike placeBlock, the target doesn't need to be
   * air, since growth/flow *replaces* an existing block. Still recorded as
   * an edit and re-meshed, same as any other world modification.
   */
  setBlockDirect(worldX: number, y: number, worldZ: number, id: BlockId): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = Math.floor(worldX / CHUNK_SIZE_X);
    const cz = Math.floor(worldZ / CHUNK_SIZE_Z);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;

    const lx = worldX - chunk.worldOriginX;
    const lz = worldZ - chunk.worldOriginZ;
    chunk.set(lx, y, lz, id);
    this.recordEdit(cx, cz, lx, y, lz, id);
    this.markBorderNeighborsDirty(cx, cz, lx, lz);
    return true;
  }

  private markBorderNeighborsDirty(cx: number, cz: number, lx: number, lz: number): void {
    // A block changed right on a chunk border can expose/hide a face in the
    // neighboring chunk's mesh that was previously culled the other way.
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE_X - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE_Z - 1) this.markDirty(cx, cz + 1);
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
    this.saveEditsToStorage();
  }

  private applyStoredEdits(chunk: Chunk): void {
    const chunkEdits = this.edits.get(chunkKey(chunk.cx, chunk.cz));
    if (!chunkEdits) return;
    for (const [posKey, id] of chunkEdits) {
      const [lx, y, lz] = posKey.split(",").map(Number) as [number, number, number];
      chunk.set(lx, y, lz, id);
    }
  }

  private saveEditsToStorage(): void {
    try {
      const serialized: Record<string, [string, number][]> = {};
      for (const [key, chunkEdits] of this.edits) serialized[key] = [...chunkEdits.entries()];
      localStorage.setItem(this.storageKey, JSON.stringify(serialized));
    } catch {
      // Storage can be unavailable (private browsing, quota) — edits just won't survive a reload.
    }
  }

  private loadEditsFromStorage(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, [string, number][]>;
      for (const [key, entries] of Object.entries(parsed)) {
        this.edits.set(key, new Map(entries));
      }
    } catch {
      // Corrupt/foreign data — start with a clean edit set rather than crashing startup.
    }
  }

  /** Ensures chunks within `radiusChunks` of the player exist, meshed & uploaded, and evicts far ones. */
  update(playerChunkX: number, playerChunkZ: number, radiusChunks: number): void {
    let genBudget = this.genBudgetPerFrame;
    for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
      for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
        if (dx * dx + dz * dz > radiusChunks * radiusChunks) continue;
        const cx = playerChunkX + dx;
        const cz = playerChunkZ + dz;
        const key = chunkKey(cx, cz);
        if (!this.chunks.has(key)) {
          if (genBudget <= 0) continue; // retried again next frame
          genBudget--;
          const chunk = new Chunk(cx, cz);
          this.generator.generate(chunk);
          this.applyStoredEdits(chunk);
          this.chunks.set(key, chunk);
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

  private uploadMeshBuffer(mesh: MeshResult): GpuMesh {
    if (mesh.indices.length === 0) {
      return { vao: null, vertexBuffer: null, indexBuffer: null, indexCount: 0, triangleCount: 0 };
    }
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const vertexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW);

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
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    return { vao, vertexBuffer, indexBuffer, indexCount: mesh.indices.length, triangleCount: mesh.indices.length / 3 };
  }

  private uploadMesh(chunk: Chunk): void {
    const { opaque, transparent } = buildChunkMesh(chunk, this.getBlock);
    chunk.dispose(this.gl);
    chunk.opaque = this.uploadMeshBuffer(opaque);
    chunk.transparent = this.uploadMeshBuffer(transparent);
    chunk.dirty = false;
    chunk.meshVersion++;
  }

  /** Chunks with a ready GPU mesh that pass the frustum test, for rendering. */
  *visibleChunks(frustum: Frustum): Generator<Chunk> {
    for (const chunk of this.chunks.values()) {
      if (chunk.opaque.indexCount === 0 && chunk.transparent.indexCount === 0) continue;
      const minX = chunk.worldOriginX;
      const minZ = chunk.worldOriginZ;
      if (frustum.intersectsAABB(minX, 0, minZ, minX + CHUNK_SIZE_X, CHUNK_HEIGHT, minZ + CHUNK_SIZE_Z)) {
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

  /** For the V.6 debug HUD ("triangles ... counts must be displayed"). Only counts currently-visible-radius chunks with an uploaded mesh. */
  triangleCountIn(chunks: Iterable<Chunk>): number {
    let n = 0;
    for (const c of chunks) n += c.opaque.triangleCount + c.transparent.triangleCount;
    return n;
  }

  static get vertexFloats(): number {
    return VERTEX_FLOATS;
  }
}
