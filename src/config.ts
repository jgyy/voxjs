// Global tunables for the voxel world, physics, and renderer.

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Z = 16;
export const CHUNK_HEIGHT = 256;

// World bounds required by the subject: navigable across at least 5,000,000
// cubes on the XZ plane. Expressed here in chunk-columns for the
// chunk-coordinate space; 16384^2 (~268M) clears it with a lot of margin.
export const WORLD_SIZE_BLOCKS_XZ = 16384;
export const WORLD_CHUNKS_XZ = WORLD_SIZE_BLOCKS_XZ / CHUNK_SIZE_X; // 1024

export const FOV_DEGREES = 80;
export const NEAR_PLANE = 0.05;
export const FAR_PLANE = 2200;

// V.3 Camera: walking speed ~1 cube/s, sprinting ~2 cubes/s (both grounded,
// gravity-bound), and a toggleable fly mode where running speed is
// multiplied by 20 instead of 2.
export const WALK_SPEED = 1; // cubes / second
export const SPRINT_SPEED = 2; // cubes / second
export const FLY_SPRINT_MULTIPLIER = 20; // applied to WALK_SPEED while flying + sprinting
export const FLY_SPEED_MULTIPLIER = 4; // plain (non-sprint) fly speed multiplier
export const SWIM_SPEED_MULTIPLIER = 0.6; // "optional slowed movement" underwater
export const MOUSE_SENSITIVITY = 0.0022;

export const GRAVITY = 28; // cubes / second^2
export const JUMP_VELOCITY = 8.4; // cubes / second, tuned for a ~1.25 cube jump height
export const TERMINAL_VELOCITY = 60;
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_EYE_HEIGHT = 1.62;
export const WATER_BUOYANCY = 10; // upward accel while submerged and rising

// V.2: minimum render distance is increased from 160 (ft_vox) to 260 cubes.
// This must be a hard floor: the dynamic-render-distance system (a former
// ft_vox bonus) is allowed to shrink for performance, but never below this.
export const REQUIRED_MIN_RENDER_CUBES = 260;
export const MIN_RENDER_DISTANCE_CHUNKS = Math.ceil(REQUIRED_MIN_RENDER_CUBES / CHUNK_SIZE_X) + 1; // 17 chunks (~272 cubes)
export const MAX_RENDER_DISTANCE_CHUNKS = 40; // ~640 cubes, ceiling for the auto-scaler
export const DEFAULT_RENDER_DISTANCE_CHUNKS = MIN_RENDER_DISTANCE_CHUNKS + 3; // starts comfortably above the floor

export const CHUNK_UNLOAD_MARGIN_CHUNKS = 3;

export const WORLD_SEED = 1337;

// Bonus: "being able to delete blocks with the mouse" — arm's-length reach,
// in cubes, for the block-breaking/placing raycast.
export const BLOCK_REACH = 6;

// Edited (broken/placed) blocks are kept per-chunk so a chunk that's evicted
// and later reloaded still shows the player's edits, up to this many
// distinct edited chunks — beyond that, the oldest edits are forgotten, same
// "save up to a limit, then start deleting" policy the subject requires for
// visited terrain in general (V.1). They're also flushed to localStorage so
// edits survive a page reload in single-player/offline mode.
export const MAX_EDITED_CHUNKS = 2048;
export const EDIT_STORAGE_KEY = "voxjs.edits.v1";

// --- Sea level / terrain shaping shared across generator + decorator ---
export const SEA_LEVEL = 62;

// --- Vegetation / decoration ---
export const HOTBAR_SIZE = 9;

export const PLAYER_MAX_HEALTH = 20;

// --- Mobs ---
export const MOB_SPAWN_RADIUS_MIN = 14;
export const MOB_SPAWN_RADIUS_MAX = 32;
export const MOB_DESPAWN_RADIUS = 96;
export const MOB_CHASE_RADIUS = 16;
export const MOB_MAX_COUNT = 24;
export const MOB_WALK_SPEED = 1.4;
export const MOB_CHASE_SPEED = 2.6;

// --- Day/night cycle, drives lighting + mob spawning + ambient music ---
export const DAY_LENGTH_SECONDS = 600; // full day/night cycle

// --- Multiplayer ---
export const DEFAULT_WS_PORT = 8791;
export const NETWORK_TICK_HZ = 15;

// --- Nether (bonus) ---
export const NETHER_SEED_XOR = 0x5eed_dead;
