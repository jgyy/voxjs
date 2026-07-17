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
  private gl: WebGL2RenderingContext;
  /** Cap the number of (re)meshes uploaded per frame to avoid frame-time spikes. */
  private meshBudgetPerFrame = 2;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
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
        chunk.dispose(this.gl);
        this.chunks.delete(key);
      }
    }
  }

  private uploadMesh(chunk: Chunk): void {
    const { vertices, indices } = buildChunkMesh(chunk, this.getBlockGlobal);
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
