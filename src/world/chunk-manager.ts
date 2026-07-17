import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z, CHUNK_UNLOAD_MARGIN_CHUNKS } from "../config";
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
  private device: GPUDevice;
  /** Cap the number of (re)meshes uploaded per frame to avoid frame-time spikes. */
  private meshBudgetPerFrame = 2;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  private getBlockGlobal = (x: number, y: number, z: number): number => {
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
        chunk.dispose();
        this.chunks.delete(key);
      }
    }
  }

  private uploadMesh(chunk: Chunk): void {
    const { vertices, indices } = buildChunkMesh(chunk, this.getBlockGlobal);
    chunk.dispose();

    if (indices.length === 0) {
      chunk.indexCount = 0;
      chunk.dirty = false;
      return;
    }

    chunk.vertexBuffer = this.device.createBuffer({
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(chunk.vertexBuffer, 0, vertices);

    chunk.indexBuffer = this.device.createBuffer({
      size: indices.byteLength,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(chunk.indexBuffer, 0, indices);

    chunk.indexCount = indices.length;
    chunk.dirty = false;
    chunk.meshVersion++;
  }

  /** Chunks with a ready GPU mesh that pass the frustum test, for rendering. */
  *visibleChunks(frustum: Frustum): Generator<Chunk> {
    for (const chunk of this.chunks.values()) {
      if (!chunk.vertexBuffer || chunk.indexCount === 0) continue;
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
