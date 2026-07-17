import { CHUNK_HEIGHT, CHUNK_SIZE_X, CHUNK_SIZE_Z } from "../config";
import { BLOCK_FACES, isOpaque } from "./blocks";
import { Chunk } from "./chunk";

// Vertex layout (float32): position.xyz, normalIndex, uv.xy, texLayer  -> 7 floats
export const VERTEX_FLOATS = 7;

interface NeighborGetter {
  (x: number, y: number, z: number): number;
}

// Face definitions: 4 corner offsets (relative to the block's min corner) and
// the outward normal index (0=+X,1=-X,2=+Y,3=-Y,4=+Z,5=-Z), matched to WGSL.
const FACES: {
  normalIndex: number;
  dx: number;
  dy: number;
  dz: number;
  corners: [number, number, number][];
}[] = [
  { normalIndex: 0, dx: 1, dy: 0, dz: 0, corners: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]] },
  { normalIndex: 1, dx: -1, dy: 0, dz: 0, corners: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]] },
  { normalIndex: 2, dx: 0, dy: 1, dz: 0, corners: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]] },
  { normalIndex: 3, dx: 0, dy: -1, dz: 0, corners: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]] },
  { normalIndex: 4, dx: 0, dy: 0, dz: 1, corners: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]] },
  { normalIndex: 5, dx: 0, dy: 0, dz: -1, corners: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]] },
];

const UVS: [number, number][] = [[0, 1], [0, 0], [1, 0], [1, 1]];

export interface MeshResult {
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Builds a mesh for `chunk`, culling any face whose neighboring block is
 * opaque (hidden faces between solid cubes are never emitted). `getBlock`
 * lets faces on chunk borders sample into neighboring chunks so seams don't
 * get phantom faces or missing walls.
 */
export function buildChunkMesh(chunk: Chunk, getBlock: NeighborGetter): MeshResult {
  const vertices: number[] = [];
  const indices: number[] = [];
  let vertexCount = 0;

  const originX = chunk.worldOriginX;
  const originZ = chunk.worldOriginZ;

  for (let x = 0; x < CHUNK_SIZE_X; x++) {
    for (let z = 0; z < CHUNK_SIZE_Z; z++) {
      for (let y = 0; y < CHUNK_HEIGHT; y++) {
        const block = chunk.get(x, y, z);
        if (!isOpaque(block)) continue;
        const faces = BLOCK_FACES[block];
        if (!faces) continue;

        for (const face of FACES) {
          const nx = x + face.dx;
          const ny = y + face.dy;
          const nz = z + face.dz;
          const neighbor =
            nx >= 0 && nx < CHUNK_SIZE_X && ny >= 0 && ny < CHUNK_HEIGHT && nz >= 0 && nz < CHUNK_SIZE_Z
              ? chunk.get(nx, ny, nz)
              : getBlock(originX + nx, ny, originZ + nz);

          if (isOpaque(neighbor)) continue; // hidden face, skip entirely

          const layer = face.normalIndex === 2 ? faces.top : face.normalIndex === 3 ? faces.bottom : faces.side;

          for (let c = 0; c < 4; c++) {
            const corner = face.corners[c]!;
            const [u, v] = UVS[c]!;
            vertices.push(
              originX + x + corner[0],
              y + corner[1],
              originZ + z + corner[2],
              face.normalIndex,
              u,
              v,
              layer,
            );
          }
          indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          vertexCount += 4;
        }
      }
    }
  }

  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
