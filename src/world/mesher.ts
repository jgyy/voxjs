import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z } from "../config";
import { BLOCK_FACES, BlockId, isBillboard, isOpaque, isTransparentRender } from "./blocks";
import { Chunk } from "./chunk";

// Vertex layout (float32): position.xyz, normalIndex, uv.xy, texLayer -> 7 floats.
// normalIndex 6 is reserved for billboards (no single face normal; shaded flat).
export const VERTEX_FLOATS = 7;
export const BILLBOARD_NORMAL_INDEX = 6;

interface NeighborGetter {
  (x: number, y: number, z: number): number;
}

export interface MeshResult {
  vertices: Float32Array;
  indices: Uint32Array;
}

export interface ChunkMeshResult {
  opaque: MeshResult;
  transparent: MeshResult;
}

class MeshBuilder {
  vertices: number[] = [];
  indices: number[] = [];
  private vertexCount = 0;

  quad(
    normalIndex: number,
    layer: number,
    corners: [number, number, number][],
    uvs: [number, number][],
  ): void {
    for (let c = 0; c < 4; c++) {
      const [x, y, z] = corners[c]!;
      const [u, v] = uvs[c]!;
      this.vertices.push(x, y, z, normalIndex, u, v, layer);
    }
    const vc = this.vertexCount;
    this.indices.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);
    this.vertexCount += 4;
  }

  build(): MeshResult {
    return { vertices: new Float32Array(this.vertices), indices: new Uint32Array(this.indices) };
  }
}

/** A block occludes/merges with an identical neighbor, but two DIFFERENT non-opaque
 * blocks (e.g. water next to air) still need a face drawn between them — this single
 * rule replaces the old "any non-opaque neighbor => face" rule, which used to make
 * every water-water contact emit a wasted internal face. */
function faceVisible(blockId: number, neighborId: number): boolean {
  if (blockId === neighborId) return false;
  return !isOpaque(neighborId);
}

function meshableSolid(id: number): boolean {
  return id !== BlockId.Air && !isBillboard(id);
}

function faceLayerFor(id: number, normalIndex: number): number {
  const faces = BLOCK_FACES[id]!;
  return normalIndex === 2 ? faces.top : normalIndex === 3 ? faces.bottom : faces.side;
}

function outputFor(builders: { opaque: MeshBuilder; transparent: MeshBuilder }, id: number): MeshBuilder {
  return isTransparentRender(id) ? builders.transparent : builders.opaque;
}

/** Greedy rectangle merge over a 2D mask of (blockId+1), 0 = empty. Standard sweep: for each
 * unclaimed cell, grow a run rightward while the block id matches, then grow that run downward
 * while every cell in the row still matches — merges same-block faces into fewer, larger quads. */
function mergeMask(mask: Int32Array, dimU: number, dimV: number): { u0: number; v0: number; w: number; h: number; id: number }[] {
  const rects: { u0: number; v0: number; w: number; h: number; id: number }[] = [];
  const used = new Uint8Array(dimU * dimV);
  for (let v = 0; v < dimV; v++) {
    for (let u = 0; u < dimU; u++) {
      const idx = v * dimU + u;
      if (used[idx] || mask[idx] === 0) continue;
      const id = mask[idx]!;

      let w = 1;
      while (u + w < dimU && !used[v * dimU + u + w] && mask[v * dimU + u + w] === id) w++;

      let h = 1;
      heightLoop: while (v + h < dimV) {
        for (let k = 0; k < w; k++) {
          const idx2 = (v + h) * dimU + (u + k);
          if (used[idx2] || mask[idx2] !== id) break heightLoop;
        }
        h++;
      }

      for (let dv = 0; dv < h; dv++) {
        for (let du = 0; du < w; du++) used[(v + dv) * dimU + (u + du)] = 1;
      }
      rects.push({ u0: u, v0: v, w, h, id: id - 1 });
    }
  }
  return rects;
}

function sampleXZ(
  chunk: Chunk,
  getBlock: NeighborGetter,
  originX: number,
  originZ: number,
  lx: number,
  ly: number,
  lz: number,
): number {
  if (ly < 0 || ly >= CHUNK_HEIGHT) return BlockId.Air;
  if (lx >= 0 && lx < CHUNK_SIZE_X && lz >= 0 && lz < CHUNK_SIZE_Z) return chunk.get(lx, ly, lz);
  return getBlock(originX + lx, ly, originZ + lz);
}

/** +Y / -Y faces (top/bottom). Mask axes: u=x, v=z. No cross-chunk sampling needed (Y never tiles). */
function buildAxisY(chunk: Chunk, builders: { opaque: MeshBuilder; transparent: MeshBuilder }, originX: number, originZ: number): void {
  const dimU = CHUNK_SIZE_X;
  const dimV = CHUNK_SIZE_Z;
  let below = new Int32Array(dimU * dimV); // block ids at slice b-1, +1 offset (0 = air)
  let above = new Int32Array(dimU * dimV);

  const fill = (arr: Int32Array, y: number): void => {
    if (y < 0 || y >= CHUNK_HEIGHT) {
      arr.fill(0);
      return;
    }
    for (let v = 0; v < dimV; v++) {
      for (let u = 0; u < dimU; u++) arr[v * dimU + u] = chunk.get(u, y, v) + 1;
    }
  };

  fill(below, -1);
  fill(above, 0);

  for (let b = 0; b <= CHUNK_HEIGHT; b++) {
    if (b >= 1) {
      const posMask = new Int32Array(dimU * dimV);
      for (let i = 0; i < posMask.length; i++) {
        const owner = below[i]! - 1;
        const neighbor = above[i]! - 1;
        posMask[i] = meshableSolid(owner) && faceVisible(owner, neighbor) ? owner + 1 : 0;
      }
      for (const r of mergeMask(posMask, dimU, dimV)) {
        const out = outputFor(builders, r.id);
        const layer = faceLayerFor(r.id, 2);
        out.quad(
          2,
          layer,
          [
            [originX + r.u0, b, originZ + r.v0],
            [originX + r.u0, b, originZ + r.v0 + r.h],
            [originX + r.u0 + r.w, b, originZ + r.v0 + r.h],
            [originX + r.u0 + r.w, b, originZ + r.v0],
          ],
          [
            [0, r.h],
            [0, 0],
            [r.w, 0],
            [r.w, r.h],
          ],
        );
      }
    }
    if (b <= CHUNK_HEIGHT - 1) {
      const negMask = new Int32Array(dimU * dimV);
      for (let i = 0; i < negMask.length; i++) {
        const owner = above[i]! - 1;
        const neighbor = below[i]! - 1;
        negMask[i] = meshableSolid(owner) && faceVisible(owner, neighbor) ? owner + 1 : 0;
      }
      for (const r of mergeMask(negMask, dimU, dimV)) {
        const out = outputFor(builders, r.id);
        const layer = faceLayerFor(r.id, 3);
        out.quad(
          3,
          layer,
          [
            [originX + r.u0, b, originZ + r.v0 + r.h],
            [originX + r.u0, b, originZ + r.v0],
            [originX + r.u0 + r.w, b, originZ + r.v0],
            [originX + r.u0 + r.w, b, originZ + r.v0 + r.h],
          ],
          [
            [0, r.h],
            [0, 0],
            [r.w, 0],
            [r.w, r.h],
          ],
        );
      }
    }

    if (b < CHUNK_HEIGHT) {
      const tmp = below;
      below = above;
      above = tmp;
      fill(above, b + 1);
    }
  }
}

/** +X / -X faces. Mask axes: u=z, v=y. Crosses into neighbor chunks at u=0/u=CHUNK_SIZE_X. */
function buildAxisX(
  chunk: Chunk,
  getBlock: NeighborGetter,
  builders: { opaque: MeshBuilder; transparent: MeshBuilder },
  originX: number,
  originZ: number,
): void {
  const dimU = CHUNK_SIZE_Z; // z
  const dimV = CHUNK_HEIGHT; // y

  const fillSlice = (x: number): Int32Array => {
    const arr = new Int32Array(dimU * dimV);
    for (let v = 0; v < dimV; v++) {
      for (let u = 0; u < dimU; u++) {
        arr[v * dimU + u] = sampleXZ(chunk, getBlock, originX, originZ, x, v, u) + 1;
      }
    }
    return arr;
  };

  let below = fillSlice(-1);
  let above = fillSlice(0);

  for (let b = 0; b <= CHUNK_SIZE_X; b++) {
    if (b >= 1) {
      const posMask = new Int32Array(dimU * dimV);
      for (let i = 0; i < posMask.length; i++) {
        const owner = below[i]! - 1;
        const neighbor = above[i]! - 1;
        posMask[i] = meshableSolid(owner) && faceVisible(owner, neighbor) ? owner + 1 : 0;
      }
      for (const r of mergeMask(posMask, dimU, dimV)) {
        // r.u0/w along z, r.v0/h along y
        const out = outputFor(builders, r.id);
        const layer = faceLayerFor(r.id, 0);
        out.quad(
          0,
          layer,
          [
            [originX + b, r.v0, originZ + r.u0],
            [originX + b, r.v0 + r.h, originZ + r.u0],
            [originX + b, r.v0 + r.h, originZ + r.u0 + r.w],
            [originX + b, r.v0, originZ + r.u0 + r.w],
          ],
          [
            [0, r.h],
            [0, 0],
            [r.w, 0],
            [r.w, r.h],
          ],
        );
      }
    }
    if (b <= CHUNK_SIZE_X - 1) {
      const negMask = new Int32Array(dimU * dimV);
      for (let i = 0; i < negMask.length; i++) {
        const owner = above[i]! - 1;
        const neighbor = below[i]! - 1;
        negMask[i] = meshableSolid(owner) && faceVisible(owner, neighbor) ? owner + 1 : 0;
      }
      for (const r of mergeMask(negMask, dimU, dimV)) {
        const out = outputFor(builders, r.id);
        const layer = faceLayerFor(r.id, 1);
        out.quad(
          1,
          layer,
          [
            [originX + b, r.v0, originZ + r.u0 + r.w],
            [originX + b, r.v0 + r.h, originZ + r.u0 + r.w],
            [originX + b, r.v0 + r.h, originZ + r.u0],
            [originX + b, r.v0, originZ + r.u0],
          ],
          [
            [0, r.h],
            [0, 0],
            [r.w, 0],
            [r.w, r.h],
          ],
        );
      }
    }

    if (b < CHUNK_SIZE_X) {
      below = above;
      above = fillSlice(b + 1);
    }
  }
}

/** +Z / -Z faces. Mask axes: u=x, v=y. Crosses into neighbor chunks at u=0/u=CHUNK_SIZE_Z. */
function buildAxisZ(
  chunk: Chunk,
  getBlock: NeighborGetter,
  builders: { opaque: MeshBuilder; transparent: MeshBuilder },
  originX: number,
  originZ: number,
): void {
  const dimU = CHUNK_SIZE_X; // x
  const dimV = CHUNK_HEIGHT; // y

  const fillSlice = (z: number): Int32Array => {
    const arr = new Int32Array(dimU * dimV);
    for (let v = 0; v < dimV; v++) {
      for (let u = 0; u < dimU; u++) {
        arr[v * dimU + u] = sampleXZ(chunk, getBlock, originX, originZ, u, v, z) + 1;
      }
    }
    return arr;
  };

  let below = fillSlice(-1);
  let above = fillSlice(0);

  for (let b = 0; b <= CHUNK_SIZE_Z; b++) {
    if (b >= 1) {
      const posMask = new Int32Array(dimU * dimV);
      for (let i = 0; i < posMask.length; i++) {
        const owner = below[i]! - 1;
        const neighbor = above[i]! - 1;
        posMask[i] = meshableSolid(owner) && faceVisible(owner, neighbor) ? owner + 1 : 0;
      }
      for (const r of mergeMask(posMask, dimU, dimV)) {
        const out = outputFor(builders, r.id);
        const layer = faceLayerFor(r.id, 4);
        out.quad(
          4,
          layer,
          [
            [originX + r.u0 + r.w, r.v0, originZ + b],
            [originX + r.u0 + r.w, r.v0 + r.h, originZ + b],
            [originX + r.u0, r.v0 + r.h, originZ + b],
            [originX + r.u0, r.v0, originZ + b],
          ],
          [
            [0, r.h],
            [0, 0],
            [r.w, 0],
            [r.w, r.h],
          ],
        );
      }
    }
    if (b <= CHUNK_SIZE_Z - 1) {
      const negMask = new Int32Array(dimU * dimV);
      for (let i = 0; i < negMask.length; i++) {
        const owner = above[i]! - 1;
        const neighbor = below[i]! - 1;
        negMask[i] = meshableSolid(owner) && faceVisible(owner, neighbor) ? owner + 1 : 0;
      }
      for (const r of mergeMask(negMask, dimU, dimV)) {
        const out = outputFor(builders, r.id);
        const layer = faceLayerFor(r.id, 5);
        out.quad(
          5,
          layer,
          [
            [originX + r.u0, r.v0, originZ + b],
            [originX + r.u0, r.v0 + r.h, originZ + b],
            [originX + r.u0 + r.w, r.v0 + r.h, originZ + b],
            [originX + r.u0 + r.w, r.v0, originZ + b],
          ],
          [
            [0, r.h],
            [0, 0],
            [r.w, 0],
            [r.w, r.h],
          ],
        );
      }
    }

    if (b < CHUNK_SIZE_Z) {
      below = above;
      above = fillSlice(b + 1);
    }
  }
}

/** Billboards: two crossed, double-sided quads per block (Minecraft-style plant rendering). */
function buildBillboards(chunk: Chunk, opaque: MeshBuilder, originX: number, originZ: number): void {
  for (let x = 0; x < CHUNK_SIZE_X; x++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const block = chunk.get(x, y, z);
        if (!isBillboard(block)) continue;
        const layer = faceLayerFor(block, BILLBOARD_NORMAL_INDEX);
        const wx = originX + x;
        const wz = originZ + z;

        const diagA: [number, number, number][] = [
          [wx, y, wz],
          [wx, y + 1, wz],
          [wx + 1, y + 1, wz + 1],
          [wx + 1, y, wz + 1],
        ];
        const diagB: [number, number, number][] = [
          [wx + 1, y, wz],
          [wx + 1, y + 1, wz],
          [wx, y + 1, wz + 1],
          [wx, y, wz + 1],
        ];
        const uv: [number, number][] = [
          [0, 1],
          [0, 0],
          [1, 0],
          [1, 1],
        ];
        const uvReversed: [number, number][] = [uv[3]!, uv[2]!, uv[1]!, uv[0]!];

        for (const quad of [diagA, diagB]) {
          opaque.quad(BILLBOARD_NORMAL_INDEX, layer, quad, uv);
          opaque.quad(BILLBOARD_NORMAL_INDEX, layer, [...quad].reverse() as [number, number, number][], uvReversed);
        }
      }
    }
  }
}

/**
 * Builds greedy-merged opaque and transparent meshes for `chunk`. Faces are
 * culled whenever the neighbor is opaque or identical (see faceVisible), and
 * adjacent same-block faces on a shared plane are merged into single quads
 * (greedy meshing) to keep triangle counts manageable at the 260+ cube
 * mandatory render distance. `getBlock` lets faces on chunk borders sample
 * into neighboring chunks so seams don't get phantom faces or missing walls.
 */
export function buildChunkMesh(chunk: Chunk, getBlock: NeighborGetter): ChunkMeshResult {
  const builders = { opaque: new MeshBuilder(), transparent: new MeshBuilder() };
  const originX = chunk.worldOriginX;
  const originZ = chunk.worldOriginZ;

  buildAxisY(chunk, builders, originX, originZ);
  buildAxisX(chunk, getBlock, builders, originX, originZ);
  buildAxisZ(chunk, getBlock, builders, originX, originZ);
  buildBillboards(chunk, builders.opaque, originX, originZ);

  return { opaque: builders.opaque.build(), transparent: builders.transparent.build() };
}
