# ft_vox (voxjs)

A WebGL2 voxel-world renderer built for the 42 `ft_vox` project: deterministic
procedural terrain (hills, mountains, caves, lakes, biomes), chunked
streaming with a dynamic render distance, per-block face culling + frustum
culling, a textured cube renderer, a seamless procedural skybox, a
first-person camera, and mouse-driven block breaking.

## Requirements

- Node.js >= 18.
- Any browser with WebGL2 (all current Chrome/Edge/Firefox/Safari).

## Setup

Per the subject, third-party libraries are never committed to the repo —
`scripts/install.sh` fetches them via `npm install`.

```sh
npm run install-deps   # or: npm install
npm run dev             # starts the Vite dev server, prints a local URL
```

Open the printed URL and click the canvas to enter fullscreen + pointer lock.

## Controls

| Input                 | Action                              |
| ---------------------- | ------------------------------------ |
| Mouse                  | Look around                          |
| `W` / `A` / `S` / `D`  | Move forward / left / back / right   |
| `Space`                | Move up                              |
| `Left Ctrl`            | Move down                            |
| `Shift`                | Sprint (x20 speed)                    |
| Left click             | Break the block under the crosshair   |
| `Esc`                  | Release pointer lock / fullscreen     |

## Architecture

```
src/
  config.ts             tunables: chunk size, render/edit limits, FOV, speeds...
  main.ts                input, fullscreen/pointer-lock, block breaking, game loop
  gfx/
    renderer.ts          WebGL2 program/VAO setup, per-frame draw calls
    camera.ts             FPS camera, view/projection matrices
    texture-atlas.ts      procedurally painted 2D texture array (block faces)
    shaders/
      voxel.vert/frag.glsl  textured cube shader + per-face shading + fog
      skybox.vert/frag.glsl full-screen procedural sky gradient
  world/
    chunk.ts               per-chunk voxel storage + GPU mesh handles
    generator.ts            deterministic fBm-noise terrain, caves, biomes, lakes
    mesher.ts               per-block hidden-face culling -> vertex/index buffers
    chunk-manager.ts        load/unload radius, mesh upload budget, edit persistence
    frustum.ts              view-frustum plane extraction + AABB test
    raycast.ts              Amanatides-Woo voxel DDA, used for block breaking
    blocks.ts               block type -> texture layer mapping
  util/
    rng.ts                seeded PRNG (mulberry32)
    noise.ts               self-implemented Perlin gradient noise (2D/3D)
```

### Notable design choices

- **No noise library**: the subject only allows pulling in libraries for 3D
  model/picture loading, windowing, and math (matrix/vector) — terrain
  generation itself must be authored here, so `util/noise.ts` implements
  classic Perlin gradient noise from scratch, seeded by `util/rng.ts`'s
  `mulberry32`. `gl-matrix` (pure math) is the only runtime dependency left.
- **Determinism**: terrain is generated from `WORLD_SEED` (see `config.ts`).
  The same seed always reproduces the same world, evaluated per-chunk with no
  dependency on generation order — `generator.ts`'s `getBlockAt()` and
  `generate()` share one `surfaceBlock()` decision function so a chunk and its
  neighbor's cross-border queries can never disagree.
- **Biomes**: two extra noise fields (temperature, moisture) classify each
  column into plains / forest / desert / snowy, each with distinct surface
  blocks (grass, dark forest grass, sand dunes, snow) on top of the shared
  hill/mountain/cave shape.
- **Lakes**: any column whose terrain height dips below sea level gets
  filled with an (opaque, per the subject's "all cubes but air are opaque"
  rule) water block up to sea level.
- **Visibility optimization**: the mesher never emits a face whose neighbor
  block is opaque (works across chunk borders too, via
  `TerrainGenerator.getBlockAt`), and `ChunkManager.visibleChunks` additionally
  frustum-culls whole chunks against the camera's view frustum before they're
  drawn.
- **Dynamic render distance**: `main.ts` grows/shrinks the load radius based
  on measured frame time, bounded by `MIN_RENDER_DISTANCE_CHUNKS` /
  `MAX_RENDER_DISTANCE_CHUNKS` in `config.ts` so it never drops below the
  bonus-part floor of 14 cubes.
- **Block breaking**: left click raycasts from the camera along its view
  direction using an Amanatides-Woo voxel DDA (`world/raycast.ts`) and removes
  the first solid block within `BLOCK_REACH`. Edits are kept in a small
  capped LRU (`ChunkManager`'s `edits` map, `MAX_EDITED_CHUNKS` in
  `config.ts`) so a chunk that scrolls out of range and back in still shows
  the edit — until it's old enough to be evicted, mirroring the same
  "remember visited terrain up to a limit, then forget it" rule the subject
  requires for terrain in general.
- **Skybox**: a single full-screen triangle reconstructs a world-space ray
  per pixel from the inverse view-projection matrix and shades it with an
  analytic gradient + sun glow — since it's a continuous function (not a
  sampled cubemap), there are no seams at direction boundaries.
- **Fullscreen**: requested on `<html>` (not the canvas) so the HUD and
  crosshair — which are canvas siblings, not descendants — stay visible;
  fullscreening the canvas alone would hide them per the Fullscreen API's
  top-layer rules.

## Building for production

```sh
npm run build      # type-checks then bundles to dist/
npm run preview     # serves the production build locally
```
