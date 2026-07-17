# ft_vox (voxjs)

A WebGPU voxel-world renderer built for the 42 `ft_vox` project: deterministic
procedural terrain (hills, mountains, caves), chunked streaming with a
dynamic render distance, per-block face culling + frustum culling, a
textured cube renderer, a seamless procedural skybox, and a first-person
camera.

## Requirements

- Node.js >= 18.
- A browser with WebGPU: recent Chrome/Edge (enabled by default), or Firefox
  Nightly / Safari Technology Preview with WebGPU flags on.

## Setup

Per the subject, third-party libraries are never committed to the repo —
`scripts/install.sh` fetches them via `npm install`.

```sh
npm run install-deps   # or: npm install
npm run dev             # starts the Vite dev server, prints a local URL
```

Open the printed URL in a WebGPU-capable browser, click the canvas to enter
pointer lock + fullscreen.

## Controls

| Input          | Action                          |
| -------------- | -------------------------------- |
| Mouse          | Look around                      |
| `W` / `A` / `S` / `D` | Move forward / left / back / right |
| `Space`        | Move up                          |
| `Left Ctrl`    | Move down                        |
| `Shift`        | Sprint (x20 speed)                |
| `Esc`          | Release pointer lock             |

## Architecture

```
src/
  config.ts             tunables: chunk size, render distance, FOV, speeds...
  main.ts                input, game loop, dynamic render-distance controller
  gfx/
    renderer.ts          WebGPU device/pipeline setup, frame rendering
    camera.ts             FPS camera, view/projection matrices
    texture-atlas.ts      procedurally painted 2D texture array (block faces)
    shaders/
      voxel.wgsl           textured cube vertex/fragment shader + fog
      skybox.wgsl           full-screen procedural sky gradient
  world/
    chunk.ts               per-chunk voxel storage + GPU mesh handles
    generator.ts           deterministic fBm-noise terrain + caves
    mesher.ts               per-block hidden-face culling -> vertex/index buffers
    chunk-manager.ts        load/unload radius, mesh upload budget, GPU eviction
    frustum.ts              view-frustum plane extraction + AABB test
    blocks.ts               block type -> texture layer mapping
  util/rng.ts               seeded PRNG (mulberry32) feeding simplex-noise
```

### Notable design choices

- **Determinism**: terrain is generated from `WORLD_SEED` (see `config.ts`)
  via a seeded PRNG feeding `simplex-noise`'s `createNoise2D`/`createNoise3D`.
  The same seed always reproduces the same world, evaluated per-chunk with no
  dependency on generation order.
- **Visibility optimization**: the mesher never emits a face whose neighbor
  block is opaque (works across chunk borders too, via
  `TerrainGenerator.getBlockAt`), and `ChunkManager.visibleChunks` additionally
  frustum-culls whole chunks against the camera's view frustum before they're
  drawn.
- **Dynamic render distance**: `main.ts` grows/shrinks the load radius based
  on measured frame time, bounded by `MIN_RENDER_DISTANCE_CHUNKS` /
  `MAX_RENDER_DISTANCE_CHUNKS` in `config.ts` so it never drops below the
  bonus-part floor.
- **Skybox**: a single full-screen triangle reconstructs a world-space ray
  per pixel from the inverse view-projection matrix and shades it with an
  analytic gradient + sun glow — since it's a continuous function (not a
  sampled cubemap), there are no seams at direction boundaries.

## Building for production

```sh
npm run build      # type-checks then bundles to dist/
npm run preview     # serves the production build locally
```
