// Global tunables for the voxel world and renderer.

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const CHUNK_HEIGHT = 256;

// World bounds required by the subject: 16384 * 256 * 16384 cubes must be
// visitable. Expressed here in chunk-columns for the chunk-coordinate space.
export const WORLD_SIZE_BLOCKS_XZ = 16384;
export const WORLD_CHUNKS_XZ = WORLD_SIZE_BLOCKS_XZ / CHUNK_SIZE_X; // 1024

export const FOV_DEGREES = 80;
export const NEAR_PLANE = 0.05;
export const FAR_PLANE = 2000;

export const BASE_MOVE_SPEED = 1; // cubes / second
export const SPRINT_MULTIPLIER = 20;
export const MOUSE_SENSITIVITY = 0.0022;

// Render distance is tracked in chunks. 160 cubes (mandatory, open areas) /
// 16 blocks-per-chunk = 10 chunks; we default a little above that so open
// areas comfortably clear 160 cubes, and never drop below the bonus floor
// of 14 cubes (~1 chunk, we floor at 2 to keep a usable margin).
export const MAX_RENDER_DISTANCE_CHUNKS = 24; // ~384 cubes
export const MIN_RENDER_DISTANCE_CHUNKS = 2; // 32 cubes, safely > 14 cube floor
export const DEFAULT_RENDER_DISTANCE_CHUNKS = 12; // 192 cubes, clears the 160 requirement

export const CHUNK_UNLOAD_MARGIN_CHUNKS = 3;

export const WORLD_SEED = 1337;

// Bonus: "being able to delete blocks with the mouse" — arm's-length reach,
// in cubes, for the block-breaking raycast.
export const BLOCK_REACH = 6;

// Edited (broken) blocks are kept in memory per-chunk so a chunk that's
// evicted and later reloaded still shows the player's edits, up to this many
// distinct edited chunks — beyond that, the oldest edits are forgotten, same
// "save up to a limit, then start deleting" policy the subject requires for
// visited terrain in general (V.1).
export const MAX_EDITED_CHUNKS = 512;
