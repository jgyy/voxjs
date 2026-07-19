# ft_minecraft (voxjs)

A WebGL2 voxel-world engine built for the 42 `ft_minecraft` project (the
harder sequel to `ft_vox`): deterministic procedural terrain across ten
biomes with smooth transitions, gradual mountains, rivers, wormhole caves
with ore veins, procedurally-varied trees and vegetation, directional
lighting + shadow mapping + SSAO, transparent water, shader-based clouds,
day/night cycle, gravity/collision/swimming, zombies & creepers that chase
and fight back, procedural ambient music and spatial sound effects, and an
optional multiplayer server (position/block/entity sync + persistence).
Full bonus chapter included: villages, crafting, water flow simulation,
growing plants, bow & arrow, a nether dimension with portals, and an online
map.

## Requirements

- Node.js >= 18.
- Any browser with WebGL2 (all current Chrome/Edge/Firefox/Safari).

## Setup

Per the subject, third-party libraries are never committed to the repo —
`scripts/install.sh` fetches them via `npm install`.

```sh
npm run install-deps   # or: npm install
npm run dev             # starts the Vite dev server, prints a local URL
npm run server           # optional: starts the multiplayer server + online map (ws://localhost:8791)
```

Open the printed URL and click the canvas to enter fullscreen + pointer
lock. The game is fully playable single-player without `npm run server`
running — it just won't sync with other players.

## Controls

| Input                   | Action                                          |
| ------------------------ | ------------------------------------------------ |
| Mouse                    | Look around                                       |
| `W` / `A` / `S` / `D`    | Move forward / left / back / right                |
| `Space`                  | Jump (grounded) / ascend (flying) / paddle up (swimming) |
| `Left Ctrl`              | Descend (flying) / dive (swimming)                |
| `Shift`                  | Sprint                                            |
| `F`                      | Toggle fly mode (20x speed)                       |
| Left click                | Break block / attack mob                          |
| Right click               | Place selected block / shoot bow                  |
| Scroll wheel / `1`-`9`    | Select hotbar slot                                |
| `C`                       | Crafting menu                                     |
| `F3`                      | Toggle debug HUD (FPS, triangles, cubes, chunks)  |
| `Tab`                     | Toggle connected-players list                     |
| `Esc`                     | Release pointer lock / fullscreen                 |

Walk into an obsidian-framed 2x3 portal (or place the last obsidian block
of one) to activate and enter the nether; walking into any portal block
teleports you between dimensions.

## Architecture

```
src/
  config.ts               tunables: chunk size, render/edit limits, physics, mobs, network...
  main.ts                  input, fullscreen/pointer-lock, game loop, dimension switching, UI wiring
  gfx/
    renderer.ts              multi-pass pipeline: shadow map -> depth/normal prepass -> SSAO -> blur -> forward
    camera.ts                 pure view/projection matrices + frustum
    texture-atlas.ts          procedurally painted 2D texture array (block faces, mob skins)
    entity-mesh.ts             stacked-box mob/player/arrow model builder + shared dynamic VBO renderer
    shaders/                   voxel (lighting+shadow+SSAO+fog), shadow, depth/normal, ssao, blur,
                                skybox, clouds, underwater overlay, fullscreen-triangle helper
  world/
    chunk.ts / chunk-manager.ts   voxel storage, dual opaque/transparent GPU meshes, edit persistence
    generator.ts                   biome-blended fBm terrain, rivers, wormhole caves (generator-types.ts is
    biomes.ts                      the shared WorldGenerator interface the nether generator also implements)
    ores.ts                        seeded ore *cluster* placement (not per-block probability)
    decorator.ts                   procedurally varied trees + small plants, margin-scanned per chunk
    villages.ts                    cell-hashed procedural village/house placement
    nether.ts                      standalone cavern-and-ceiling generator for the nether dimension
    portal.ts                      obsidian-frame detection/activation + auto-built return portals
    mesher.ts                      greedy meshing + billboard quads + opaque/transparent split
    physics.ts / collision.ts       player & mob AABB-vs-voxel sweep, gravity, swim, fly
    entities.ts                    mob spawn/chase-AI/combat (framework-agnostic — also runs on the server)
    projectiles.ts                  bow & arrow ballistics + mob hit detection
    inventory.ts / items.ts / crafting.ts   hotbar, tool items, recipes
    growth.ts / water-sim.ts         bonus: growing plants, water flow simulation
    raycast.ts                     Amanatides-Woo voxel DDA (block breaking/placing/portal targeting)
    frustum.ts                     view-frustum plane extraction + AABB test
    blocks.ts                       block type -> texture/behavior tables
  audio/
    engine.ts / music-profiles.ts    generative per-biome ambient music + spatialized SFX (Web Audio)
  net/
    client.ts                       optional WebSocket client: position/block/entity sync, graceful offline fallback
  server/
    index.ts                        Node WebSocket + HTTP server: player registry, authoritative mob
                                     simulation, block-edit relay, online map API
    store.ts                        headless (no GPU) per-dimension world model + edit persistence to disk
    protocol.ts                     shared client<->server message types
    map.html                        standalone Dynmap-style online map page (canvas, pan/zoom, live players)
  util/
    rng.ts                seeded PRNG (mulberry32)
    noise.ts               self-implemented Perlin gradient noise (2D/3D)
```

### Notable design choices

- **No noise/terrain libraries**: the subject only allows pulling in
  libraries for 3D model/picture loading, windowing, audio, and math
  (matrix/vector) — terrain generation, biomes, caves, structures, and mob
  AI are all authored here from scratch. `gl-matrix` (pure math) and `ws`
  (WebSocket transport) are the only runtime dependencies.
- **Determinism**: terrain is generated from `WORLD_SEED` alone, evaluated
  per-column with no dependency on generation order — `generator.ts`'s
  `columnAt()` is the single source of truth shared by voxel fill,
  cross-chunk mesh queries, decoration, and villages, so neighboring chunks
  (or the server and a client) can never disagree about a shared voxel.
- **Biomes**: ten biomes (Plains, Forest, Sequoia Forest, Desert, Canyon,
  Swamp, Savanna, Snowy Plains, Mountain, Island) are picked by weighted
  distance in (temperature, moisture, erosion) climate space rather than a
  hard classifier, and *height itself* is blended across biome weights —
  so mountains build up through real foothills and a canyon fades into a
  neighboring desert over hundreds of blocks, never a cliff-edge biome
  seam. Continentalness shapes oceans/islands; a separate ridged noise
  field carves winding rivers only through lowlands.
- **Caves**: two independent 3D noise fields warp the query point before
  sampling a third (domain warping), bending what would otherwise be
  blobby noise caverns into long sinuous "worm" tunnels, occasionally
  breaking the surface for natural entrances. Ore veins are seeded 3D
  *blob clusters* on a coarse grid (`world/ores.ts`), never an independent
  per-block roll.
- **Greedy meshing**: the mesher merges adjacent same-block faces into
  single quads (per axis, per slice) instead of emitting one quad per
  block face, which is what keeps triangle counts survivable at the
  260+ cube mandatory render distance.
- **Rendering pipeline**: a real multi-pass forward+ pipeline — an
  orthographic shadow depth pass from the sun, a half-resolution
  view-space normal/depth prepass, hemisphere-kernel SSAO, a box blur, then
  a forward pass that samples both for real directional lighting +
  soft shadows + ambient occlusion, with a separate alpha-blended
  transparent pass for water (also depth-tested against, but not written
  by, opaque geometry).
- **Multiplayer is additive, not required**: `net/client.ts` tries to
  connect on startup and fails silently if no server is running — the
  entire single-player game (including its own `localStorage` edit
  persistence in `chunk-manager.ts`) works identically either way. When
  connected, mob spawning/AI moves from the client to the server
  (`world/entities.ts` is framework-agnostic and runs unmodified in
  Node), and block edits + player positions are relayed and persisted to
  disk (`world-data/*.json`) by `server/store.ts`, which reuses the exact
  same deterministic generator as the client so only the edit log needs
  to cross the wire.
- **Fullscreen**: requested on `<html>` (not the canvas) so the HUD and
  crosshair — which are canvas siblings, not descendants — stay visible;
  fullscreening the canvas alone would hide them per the Fullscreen API's
  top-layer rules.

## Building for production

```sh
npm run build      # type-checks then bundles the client to dist/
npm run preview     # serves the production client build locally
npm run server       # runs the multiplayer server + online map (separate Node process, not bundled by Vite)
```
