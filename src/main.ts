import { vec3 } from "gl-matrix";
import { Renderer } from "./gfx/renderer";
import { Camera } from "./gfx/camera";
import { EntityRenderer } from "./gfx/entity-mesh";
import { ChunkManager } from "./world/chunk-manager";
import { raycastVoxel } from "./world/raycast";
import { BlockId, dropFor, isLiquid, isOpaque, isSolid } from "./world/blocks";
import { PlayerPhysics, MovementInput } from "./world/physics";
import { Inventory, isPlaceable } from "./world/inventory";
import { Mob, MobKind, damageMob, mobPose, spawnMob, tickMobs } from "./world/entities";
import { AudioEngine } from "./audio/engine";
import { mulberry32 } from "./util/rng";
import { GrowthSimulation } from "./world/growth";
import { WaterSimulation } from "./world/water-sim";
import { ARROW_DAMAGE, Arrow, arrowPose, shootArrow, tickArrows } from "./world/projectiles";
import { ItemId, itemDisplayName } from "./world/items";
import { RECIPES, Recipe, canCraft, craft } from "./world/crafting";
import { TerrainGenerator } from "./world/generator";
import { NetherGenerator } from "./world/nether";
import { buildFullPortalFrame, isPortalBlock, tryActivatePortalNear } from "./world/portal";
import { NetworkClient, remotePlayerPose } from "./net/client";
import {
  BLOCK_REACH,
  CHUNK_HEIGHT,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  DAY_LENGTH_SECONDS,
  DEFAULT_RENDER_DISTANCE_CHUNKS,
  MAX_RENDER_DISTANCE_CHUNKS,
  MIN_RENDER_DISTANCE_CHUNKS,
  MOB_MAX_COUNT,
  MOB_SPAWN_RADIUS_MAX,
  MOB_SPAWN_RADIUS_MIN,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_MAX_HEALTH,
  PLAYER_WIDTH,
  WORLD_SEED,
} from "./config";

const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;
const hotbarEl = document.getElementById("hotbar") as HTMLDivElement;
const playerListEl = document.getElementById("playerlist") as HTMLDivElement;
const damageFlashEl = document.getElementById("damageflash") as HTMLDivElement;
const craftingPanelEl = document.getElementById("craftingpanel") as HTMLDivElement;

const MOB_SPAWN_INTERVAL = 2.5;

const BLOCK_NAMES: Partial<Record<BlockId, string>> = {
  [BlockId.Grass]: "Grass",
  [BlockId.Dirt]: "Dirt",
  [BlockId.Stone]: "Stone",
  [BlockId.Cobblestone]: "Cobble",
  [BlockId.Sand]: "Sand",
  [BlockId.Snow]: "Snow",
  [BlockId.OakLog]: "Log",
  [BlockId.Planks]: "Planks",
  [BlockId.CraftingTable]: "Craft Tbl",
  [BlockId.Furnace]: "Furnace",
  [BlockId.Obsidian]: "Obsidian",
  [BlockId.SaplingYoung]: "Sapling",
  [BlockId.TallGrass]: "Grass Tuft",
  [BlockId.Water]: "Water",
  [BlockId.CropStage0]: "Seeds",
};

const BLOCK_COLORS: Partial<Record<BlockId, string>> = {
  [BlockId.Grass]: "#5a9a3c",
  [BlockId.Dirt]: "#6e5033",
  [BlockId.Stone]: "#787878",
  [BlockId.Cobblestone]: "#808080",
  [BlockId.Sand]: "#d6c791",
  [BlockId.Snow]: "#ebebf5",
  [BlockId.OakLog]: "#8a5a34",
  [BlockId.Planks]: "#ba9664",
  [BlockId.CraftingTable]: "#a8825a",
  [BlockId.Furnace]: "#6e6e70",
  [BlockId.Obsidian]: "#1c1220",
  [BlockId.SaplingYoung]: "#4a8228",
  [BlockId.TallGrass]: "#468032",
  [BlockId.Water]: "#3a70be",
  [BlockId.CropStage0]: "#5a8c28",
};

const ITEM_COLORS: Record<number, string> = {
  [ItemId.Bow]: "#7a5230",
  [ItemId.Arrow]: "#8c704a",
};

function itemName(itemId: number): string {
  return itemDisplayName(itemId) ?? BLOCK_NAMES[itemId as BlockId] ?? `#${itemId}`;
}

function itemColor(itemId: number): string {
  return ITEM_COLORS[itemId] ?? BLOCK_COLORS[itemId as BlockId] ?? "#999";
}

function findSurfaceY(chunkManager: ChunkManager, x: number, z: number): number | null {
  for (let y = CHUNK_HEIGHT - 1; y >= 1; y--) {
    if (isSolid(chunkManager.getBlock(x, y, z))) return y + 1;
  }
  return null;
}

/** Topmost open (2-tall) cavern pocket in a nether column, or null if the column is solid rock throughout. */
function findNetherOpenY(chunkManager: ChunkManager, x: number, z: number): number | null {
  for (let y = 112; y >= 13; y--) {
    if (chunkManager.getBlock(x, y, z) === BlockId.Air && chunkManager.getBlock(x, y + 1, z) === BlockId.Air) {
      return y;
    }
  }
  return null;
}

const PORTAL_TELEPORT_COOLDOWN = 3;

type Dimension = "overworld" | "nether";

/** Mutable holder so closures set up once (mouse/keyboard handlers) still see
 * the active dimension's ChunkManager after a nether-portal teleport swaps it. */
interface WorldRef {
  dimension: Dimension;
  chunkManager: ChunkManager;
}

async function main(): Promise<void> {
  const renderer = await Renderer.create(canvas);
  const camera = new Camera();
  const overworldChunkManager = new ChunkManager(renderer.gl, new TerrainGenerator(WORLD_SEED));
  const netherChunkManager = new ChunkManager(renderer.gl, new NetherGenerator(), ".nether");
  const world: WorldRef = { dimension: "overworld", chunkManager: overworldChunkManager };
  const physics = new PlayerPhysics();
  const inventory = new Inventory();
  inventory.seedStarterBlocks();
  const entityRenderer = new EntityRenderer(renderer.gl);
  const mobs: Mob[] = [];
  const spawnRng = mulberry32(0xdeadc0de);
  let mobSpawnTimer = 0;
  let playerHealth = PLAYER_MAX_HEALTH;
  const audio = new AudioEngine();
  let distanceSinceFootstep = 0;
  let lastFootPos = vec3.clone(camera.position);
  const growth = new GrowthSimulation();
  const water = new WaterSimulation();
  const arrows: Arrow[] = [];
  let craftingVisible = false;
  let portalCooldown = 0;

  // V.5: multiplayer is opt-in-by-availability — if src/server/index.ts (npm run
  // server) isn't reachable this just silently stays disconnected and the game
  // is fully playable single-player (offline persistence: ChunkManager's own
  // localStorage). See net/client.ts.
  const network = new NetworkClient();
  network.connect(`Player${Math.floor(Math.random() * 10000)}`);
  network.onBlockChanged = (change) => {
    const target = change.dimension === "overworld" ? overworldChunkManager : netherChunkManager;
    target.setBlockDirect(change.x, change.y, change.z, change.block);
  };
  network.onLocalHealth = (health) => {
    if (health < playerHealth) {
      audio.playHurt(camera.position);
      damageFlashEl.classList.add("flash");
      window.setTimeout(() => damageFlashEl.classList.remove("flash"), 220);
    }
    playerHealth = health;
    if (playerHealth <= 0) {
      playerHealth = PLAYER_MAX_HEALTH;
      camera.position[1] += 40;
    }
  };
  network.onPlayerAttacked = (id) => {
    const remote = network.players.get(id);
    if (remote) audio.playAttackSwing(vec3.fromValues(remote.x, remote.y, remote.z));
  };

  // Bonus: nether portal teleport. Always leaves the far side safe to stand
  // in and with a return portal already lit, mirroring vanilla Minecraft.
  function teleportBetweenDimensions(): void {
    portalCooldown = PORTAL_TELEPORT_COOLDOWN;
    const targetDim: Dimension = world.dimension === "overworld" ? "nether" : "overworld";
    const target = targetDim === "nether" ? netherChunkManager : overworldChunkManager;
    const x = Math.floor(camera.position[0]);
    const z = Math.floor(camera.position[2]);

    target.update(Math.floor(x / CHUNK_SIZE_X), Math.floor(z / CHUNK_SIZE_Z), 2);

    let y: number;
    if (targetDim === "nether") {
      const open = findNetherOpenY(target, x, z);
      y = open ?? 60;
      if (open === null) {
        target.setBlockDirect(x, y, z, BlockId.Air);
        target.setBlockDirect(x, y + 1, z, BlockId.Air);
        target.setBlockDirect(x, y - 1, z, BlockId.Netherrack);
      }
    } else {
      y = findSurfaceY(target, x, z) ?? 90;
    }

    if (!isPortalBlock(target.getBlock(x, y, z))) {
      buildFullPortalFrame(target, x - 1, y, z, true);
      y += 1;
    }

    world.dimension = targetDim;
    world.chunkManager = target;
    camera.position[0] = x + 0.5;
    camera.position[1] = y + PLAYER_EYE_HEIGHT + 0.1;
    camera.position[2] = z + 0.5;
    physics.velocity[1] = 0;
  }

  function refreshCraftingPanel(): void {
    renderCraftingPanel(inventory, (recipe) => {
      craft(inventory, recipe);
      refreshCraftingPanel();
    });
  }

  function toggleCrafting(): void {
    craftingVisible = !craftingVisible;
    craftingPanelEl.classList.toggle("hidden", !craftingVisible);
    if (craftingVisible) {
      document.exitPointerLock();
      refreshCraftingPanel();
    }
  }

  const input: MovementInput = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    sprint: false,
  };

  let hudVisible = true;
  let playerListVisible = false;

  function damagePlayer(amount: number): void {
    if (amount <= 0) return;
    playerHealth = Math.max(0, playerHealth - amount);
    audio.playHurt(camera.position);
    damageFlashEl.classList.add("flash");
    window.setTimeout(() => damageFlashEl.classList.remove("flash"), 220);
    if (playerHealth <= 0) {
      playerHealth = PLAYER_MAX_HEALTH;
      camera.position[1] += 40; // simple respawn: pop back up, gravity resettles the player on the surface
    }
  }

  setupLookAndInput(canvas, overlay, camera, input, physics, inventory, audio);
  setupBlockInteraction(canvas, camera, world, inventory, mobs, audio, growth, water, arrows, network);

  window.addEventListener("resize", () => renderer.resize());

  // --- Dynamic render distance: shrink under load, grow back when frame
  // time allows, but never below the mandated 260-cube floor (V.2).
  let renderDistanceChunks = DEFAULT_RENDER_DISTANCE_CHUNKS;
  const TARGET_FRAME_MS = 1000 / 60;

  let lastTime = performance.now();
  let elapsedSeconds = 0;
  let fps = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsTimer = 0;

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    elapsedSeconds += dt;

    const frameStart = performance.now();
    const chunkManager = world.chunkManager;

    camera.aspect = renderer.aspect;
    physics.update(
      camera,
      dt,
      input,
      (x, y, z) => chunkManager.isSolidAt(x, y, z),
      (x, y, z) => isLiquid(chunkManager.getBlock(x, y, z)),
    );
    camera.updateMatrices();

    const playerChunkX = Math.floor(camera.position[0] / CHUNK_SIZE_X);
    const playerChunkZ = Math.floor(camera.position[2] / CHUNK_SIZE_Z);
    chunkManager.update(playerChunkX, playerChunkZ, renderDistanceChunks);

    // --- Bonus: nether portal teleport ---
    portalCooldown = Math.max(0, portalCooldown - dt);
    if (portalCooldown <= 0 && isPortalBlock(chunkManager.getBlock(Math.floor(camera.position[0]), Math.floor(camera.position[1]), Math.floor(camera.position[2])))) {
      teleportBetweenDimensions();
    }

    const timeOfDay = (elapsedSeconds % DAY_LENGTH_SECONDS) / DAY_LENGTH_SECONDS;
    const sunAngle = timeOfDay * Math.PI * 2;
    const sunDirection = vec3.normalize(
      vec3.create(),
      vec3.fromValues(Math.cos(sunAngle), Math.sin(sunAngle), 0.25),
    );
    const daylight = Math.max(0, Math.min(1, sunDirection[1] * 1.4 + 0.25));
    const sunColor = vec3.lerp(vec3.create(), vec3.fromValues(0.16, 0.2, 0.32), vec3.fromValues(1.0, 0.96, 0.85), daylight);

    // --- Mobs: spawn near the player in the dark, chase when close (V.1). When
    // connected, the server simulates mobs authoritatively (V.5) and we just
    // mirror its snapshots instead of also running our own local AI/spawns. ---
    if (network.connected) {
      mobs.length = 0;
      for (const m of network.mobs) {
        if (m.dimension !== world.dimension || !m.alive) continue;
        const mob = spawnMob(m.kind as MobKind, vec3.fromValues(m.x, m.y, m.z));
        mob.id = m.id;
        mob.yaw = m.yaw;
        mob.health = m.health;
        mob.maxHealth = m.maxHealth;
        mob.grounded = true;
        mobs.push(mob);
      }
    } else {
      mobSpawnTimer -= dt;
      if (mobSpawnTimer <= 0) {
        mobSpawnTimer = MOB_SPAWN_INTERVAL;
        if (mobs.length < MOB_MAX_COUNT && daylight < 0.4) {
          const angle = spawnRng() * Math.PI * 2;
          const radius = MOB_SPAWN_RADIUS_MIN + spawnRng() * (MOB_SPAWN_RADIUS_MAX - MOB_SPAWN_RADIUS_MIN);
          const sx = Math.floor(camera.position[0] + Math.cos(angle) * radius);
          const sz = Math.floor(camera.position[2] + Math.sin(angle) * radius);
          const sy = findSurfaceY(chunkManager, sx, sz);
          if (sy !== null && sy < CHUNK_HEIGHT - 2) {
            const kind = spawnRng() < 0.5 ? MobKind.Zombie : MobKind.Creeper;
            mobs.push(spawnMob(kind, vec3.fromValues(sx + 0.5, sy, sz + 0.5)));
          }
        }
      }
      tickMobs(mobs, dt, {
        isSolid: (x, y, z) => chunkManager.isSolidAt(x, y, z),
        playerPosition: vec3.fromValues(camera.position[0], camera.position[1] - PLAYER_EYE_HEIGHT, camera.position[2]),
        onPlayerDamage: damagePlayer,
      });
      for (let i = mobs.length - 1; i >= 0; i--) if (!mobs[i]!.alive) mobs.splice(i, 1);
    }
    for (const mob of mobs) {
      if (mob.grounded && spawnRng() < dt * 0.5) audio.playMobStep(mob.position, mob.kind);
    }

    // --- Bonus: growing plants + water flow simulation (host/offline world only —
    // simplification: not server-synced, unlike block edits and mob state) ---
    growth.tick(dt, chunkManager);
    water.tick(dt, chunkManager);

    // --- Bonus: bow & arrow projectiles (simulated client-side; server is told
    // about confirmed hits so mob damage stays authoritative when connected) ---
    tickArrows(arrows, dt, {
      isSolid: (x, y, z) => chunkManager.isSolidAt(x, y, z),
      mobs,
      onHitMob: (mob) => {
        audio.playHurt(mob.position);
        if (network.connected) network.sendAttackMob(mob.id, ARROW_DAMAGE);
      },
    });
    for (let i = arrows.length - 1; i >= 0; i--) if (!arrows[i]!.alive) arrows.splice(i, 1);

    // --- Multiplayer: broadcast our own position, render everyone else (V.5) ---
    network.sendMove(camera.position, camera.yaw, camera.pitch, world.dimension);
    const remotePoses = network.remotePlayersIn(world.dimension).map(remotePlayerPose);
    entityRenderer.upload([...mobs.map(mobPose), ...arrows.map(arrowPose), ...remotePoses]);

    // --- Ambient biome music + footstep/swim SFX (V.4) ---
    audio.update(camera, dt);
    const currentBiome = chunkManager.biomeAt(Math.floor(camera.position[0]), Math.floor(camera.position[2]));
    if (currentBiome !== null) audio.setBiome(currentBiome);
    const moveDelta = vec3.distance(camera.position, lastFootPos);
    lastFootPos = vec3.clone(camera.position);
    const isMovingOnFoot = input.forward || input.back || input.left || input.right;
    if (!physics.flying && isMovingOnFoot && (physics.grounded || physics.swimming)) {
      distanceSinceFootstep += moveDelta;
      const stepInterval = physics.swimming ? 0.9 : input.sprint ? 0.75 : 1.1;
      if (distanceSinceFootstep >= stepInterval) {
        distanceSinceFootstep = 0;
        if (physics.swimming) audio.playSwim(camera.position);
        else audio.playFootstep(camera.position);
      }
    } else {
      distanceSinceFootstep = 0;
    }

    const inNether = world.dimension === "nether";
    const visibleChunks = [...chunkManager.visibleChunks(camera.frustum)];
    renderer.render(
      camera,
      visibleChunks,
      {
        sunDirection: inNether ? vec3.fromValues(0.3, 0.6, 0.3) : sunDirection,
        sunColor: inNether ? vec3.fromValues(0.9, 0.35, 0.2) : sunColor,
        daylight: inNether ? 0.4 : daylight,
        headSubmerged: physics.headSubmerged,
        timeSeconds: elapsedSeconds,
        nether: inNether,
      },
      () => entityRenderer.draw(),
    );

    const frameMs = performance.now() - frameStart;
    if (frameMs > TARGET_FRAME_MS * 1.4 && renderDistanceChunks > MIN_RENDER_DISTANCE_CHUNKS) {
      renderDistanceChunks--;
    } else if (frameMs < TARGET_FRAME_MS * 0.7 && renderDistanceChunks < MAX_RENDER_DISTANCE_CHUNKS) {
      renderDistanceChunks++;
    }

    fpsAccum += dt;
    fpsFrames++;
    fpsTimer += dt;
    if (fpsTimer >= 0.5) {
      fps = fpsFrames / fpsAccum;
      fpsAccum = 0;
      fpsFrames = 0;
      fpsTimer = 0;
      updateHud(hudVisible, {
        fps,
        renderDistanceChunks,
        loadedChunks: chunkManager.loadedChunkCount,
        pendingMesh: chunkManager.pendingMeshCount,
        triangleCount: chunkManager.triangleCountIn(visibleChunks) + entityRenderer.triangleCount,
        cubeCount: visibleChunks.length * CHUNK_SIZE_X * CHUNK_SIZE_Z,
        camera,
        physics,
        health: playerHealth,
        mobCount: mobs.length,
      });
    }

    updateHotbar(inventory);
    updatePlayerList(playerListVisible, network);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  window.addEventListener("keydown", (e) => {
    if (e.code === "F3") {
      e.preventDefault();
      hudVisible = !hudVisible;
      hud.classList.toggle("hidden", !hudVisible);
    } else if (e.code === "Tab") {
      e.preventDefault();
      playerListVisible = !playerListVisible;
      playerListEl.classList.toggle("hidden", !playerListVisible);
    } else if (e.code === "KeyC") {
      toggleCrafting();
    }
  });
}

interface HudInfo {
  fps: number;
  renderDistanceChunks: number;
  loadedChunks: number;
  pendingMesh: number;
  triangleCount: number;
  cubeCount: number;
  camera: Camera;
  physics: PlayerPhysics;
  health: number;
  mobCount: number;
}

// V.6: "FPS, triangles, cube, and chunk counts must be displayed on-screen with a key toggle" (F3).
function updateHud(visible: boolean, info: HudInfo): void {
  if (!visible) return;
  const renderCubes = info.renderDistanceChunks * CHUNK_SIZE_X;
  const mode = info.physics.flying ? "Fly" : info.physics.swimming ? "Swim" : info.physics.grounded ? "Walk" : "Air";
  hud.textContent =
    `FPS: ${info.fps.toFixed(0)}\n` +
    `Triangles: ${info.triangleCount.toLocaleString()}  Cubes(cols): ${info.cubeCount.toLocaleString()}\n` +
    `Render distance: ${info.renderDistanceChunks} chunks (~${renderCubes} cubes)\n` +
    `Loaded chunks: ${info.loadedChunks} (pending mesh: ${info.pendingMesh})\n` +
    `Pos: ${info.camera.position[0].toFixed(1)}, ${info.camera.position[1].toFixed(1)}, ${info.camera.position[2].toFixed(1)}\n` +
    `Mode: ${mode}  HP: ${info.health}/${PLAYER_MAX_HEALTH}  Mobs: ${info.mobCount}\n` +
    `[F3] toggle HUD  [Tab] player list  [F] fly  [R-click] place` +
    (Renderer.lastError ? `\nGPU ERROR: ${Renderer.lastError}` : "");
}

let lastHotbarSignature = "";
function updateHotbar(inventory: Inventory): void {
  const signature = inventory.selected + "|" + inventory.slots.map((s) => (s ? `${s.itemId}:${s.count}` : "-")).join(",");
  if (signature === lastHotbarSignature) return;
  lastHotbarSignature = signature;

  hotbarEl.replaceChildren();
  inventory.slots.forEach((slot, i) => {
    const el = document.createElement("div");
    el.className = "hotbar-slot" + (i === inventory.selected ? " selected" : "");
    if (slot) {
      el.style.background = itemColor(slot.itemId);
      el.title = `${itemName(slot.itemId)} x${slot.count}`;
      el.textContent = String(slot.count);
    }
    hotbarEl.appendChild(el);
  });
}

// V.6: "A list of all connected players should also be available with a key toggle" (Tab).
function updatePlayerList(visible: boolean, network: NetworkClient): void {
  if (!visible) return;
  const status = network.connected ? "online" : "offline (no server)";
  const others = [...network.players.values()].map((p) => `  ${p.name} — ${p.dimension}, HP ${p.health}`);
  playerListEl.textContent = [`Players (${status}):`, "  You (this client)", ...others].join("\n");
}

// Bonus: "Crafting system" — a simple always-available recipe list (pointer lock
// releases while open, like Minecraft's own inventory screen, so the mouse is free to click).
function renderCraftingPanel(inventory: Inventory, onCraft: (recipe: Recipe) => void): void {
  craftingPanelEl.replaceChildren();
  const title = document.createElement("div");
  title.textContent = "Crafting [C to close]";
  title.style.marginBottom = "8px";
  craftingPanelEl.appendChild(title);

  for (const recipe of RECIPES) {
    const row = document.createElement("button");
    const ok = canCraft(inventory, recipe);
    row.className = "recipe-row" + (ok ? "" : " disabled");
    row.textContent = recipe.label;
    row.disabled = !ok;
    row.addEventListener("click", () => onCraft(recipe));
    craftingPanelEl.appendChild(row);
  }
}

function setupLookAndInput(
  canvas: HTMLCanvasElement,
  overlay: HTMLDivElement,
  camera: Camera,
  input: MovementInput,
  physics: PlayerPhysics,
  inventory: Inventory,
  audio: AudioEngine,
): void {
  const keyMap: Record<string, keyof MovementInput> = {
    KeyW: "forward",
    KeyS: "back",
    KeyA: "left",
    KeyD: "right",
    Space: "up",
    ControlLeft: "down",
    ShiftLeft: "sprint",
    ShiftRight: "sprint",
  };

  // Pointer Lock recenters the cursor every frame and hands us unbounded
  // movementX/Y deltas, so looking around never hits the edge of the screen.
  // The OS cursor it hides is replaced by the always-centered #crosshair
  // element, so the player still has a visible aim reference.
  //
  // Fullscreen is requested on <html> rather than the canvas itself: the
  // Fullscreen API only keeps the fullscreen element's *descendants* visible
  // (its "top layer"), and #hud/#crosshair/#overlay are canvas *siblings* —
  // fullscreening the canvas alone would blank the HUD out.
  overlay.addEventListener("click", () => {
    // Web Audio requires a real user gesture to start — this click is one.
    audio.unlock();

    // Chained, not fired in parallel: requesting pointer lock while the
    // fullscreen transition is still in flight makes Chromium reject it
    // ("root document ... not valid for pointer lock"), so pointer lock is
    // only requested once the fullscreen promise has settled either way.
    if (document.fullscreenElement) {
      canvas.requestPointerLock();
      return;
    }
    document.documentElement
      .requestFullscreen()
      .catch(() => {
        // Fullscreen can be denied (e.g. iframe without the allow attribute);
        // pointer lock + look/move still work windowed.
      })
      .finally(() => canvas.requestPointerLock());
  });

  document.addEventListener("pointerlockchange", () => {
    const active = document.pointerLockElement === canvas;
    overlay.classList.toggle("hidden", active);
  });

  document.addEventListener("pointerlockerror", () => {
    overlay.classList.remove("hidden");
    overlay.textContent = "Pointer lock failed — click to try again.";
  });

  // Some browsers only release pointer lock (not fullscreen) or vice versa
  // when the user backs out; keep the two in sync either way.
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement !== canvas) return;
    camera.applyMouseDelta(e.movementX, e.movementY);
  });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    if (document.pointerLockElement !== canvas) return;
    inventory.scrollSelect(e.deltaY > 0 ? 1 : -1);
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      document.exitPointerLock();
      return;
    }
    if (e.code === "KeyF") {
      physics.toggleFly();
      return;
    }
    if (e.code.startsWith("Digit")) {
      const n = Number(e.code.slice(5));
      if (n >= 1 && n <= 9) inventory.selectSlot(n - 1);
      return;
    }
    const field = keyMap[e.code];
    if (field) input[field] = true;
  });
  window.addEventListener("keyup", (e) => {
    const field = keyMap[e.code];
    if (field) input[field] = false;
  });

  window.addEventListener("blur", () => {
    for (const key of Object.keys(input) as (keyof MovementInput)[]) input[key] = false;
  });
}

// Player AABB test used to keep block placement from clipping into the player's own body.
function overlapsPlayer(camera: Camera, x: number, y: number, z: number): boolean {
  const hw = PLAYER_WIDTH / 2;
  const feetY = camera.position[1] - PLAYER_EYE_HEIGHT;
  return (
    x + 1 > camera.position[0] - hw &&
    x < camera.position[0] + hw &&
    y + 1 > feetY &&
    y < feetY + PLAYER_HEIGHT &&
    z + 1 > camera.position[2] - hw &&
    z < camera.position[2] + hw
  );
}

const ATTACK_DAMAGE_TO_MOB = 6;
const ATTACK_ANGLE_COS = Math.cos(0.18); // ~10 degrees — how precisely the crosshair must be on the mob

/** Nearest alive mob within reach whose direction from the camera is close to where it's looking. */
function pickTargetMob(camera: Camera, mobs: Mob[]): Mob | null {
  const forward = camera.forwardVector(vec3.create());
  let best: Mob | null = null;
  let bestDist = Infinity;
  for (const mob of mobs) {
    if (!mob.alive) continue;
    const toMob = vec3.sub(vec3.create(), mob.position, camera.position);
    toMob[1] += 0.9; // aim roughly at torso height, not feet
    const dist = vec3.length(toMob);
    if (dist > BLOCK_REACH || dist < 0.001) continue;
    vec3.scale(toMob, toMob, 1 / dist);
    if (vec3.dot(toMob, forward) < ATTACK_ANGLE_COS) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = mob;
    }
  }
  return best;
}

// Bonus/V.1: break blocks with the mouse (left click, pick up), place them back (right click).
function setupBlockInteraction(
  canvas: HTMLCanvasElement,
  camera: Camera,
  world: WorldRef,
  inventory: Inventory,
  mobs: Mob[],
  audio: AudioEngine,
  growth: GrowthSimulation,
  water: WaterSimulation,
  arrows: Arrow[],
  network: NetworkClient,
): void {
  canvas.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement !== canvas) return;
    const chunkManager = world.chunkManager;

    if (e.button === 0) {
      const target = pickTargetMob(camera, mobs);
      if (target) {
        damageMob(target, ATTACK_DAMAGE_TO_MOB);
        if (network.connected) network.sendAttackMob(target.id, ATTACK_DAMAGE_TO_MOB);
        audio.playAttackSwing(camera.position);
        network.sendAttack();
        return;
      }
    }

    // Bonus: bow & arrow — shoots regardless of what's in reach, unlike block placement.
    if (e.button === 2 && inventory.selectedItem() === ItemId.Bow) {
      if (!inventory.remove(ItemId.Arrow, 1)) return;
      const direction = camera.forwardVector(vec3.create());
      const origin = vec3.scaleAndAdd(vec3.create(), camera.position, direction, 0.6);
      arrows.push(shootArrow(origin, direction));
      audio.playAttackSwing(camera.position);
      network.sendAttack();
      return;
    }

    const direction = camera.forwardVector(vec3.create());
    const hit = raycastVoxel(camera.position, direction, BLOCK_REACH, (x, y, z) =>
      isOpaque(chunkManager.getBlock(x, y, z)),
    );
    if (!hit) return;

    if (e.button === 0) {
      const removed = chunkManager.removeBlock(hit.x, hit.y, hit.z);
      if (removed !== null && removed !== BlockId.Air) {
        inventory.add(dropFor(removed));
        audio.playBreak(camera.position);
        network.sendAttack();
        network.sendBreak(hit.x, hit.y, hit.z, world.dimension);
      }
    } else if (e.button === 2) {
      const block = inventory.selectedItem();
      if (block === null || !isPlaceable(block)) return;
      if (overlapsPlayer(camera, hit.prevX, hit.prevY, hit.prevZ)) return;
      if (chunkManager.placeBlock(hit.prevX, hit.prevY, hit.prevZ, block)) {
        inventory.consumeSelected();
        audio.playPlace(camera.position);
        network.sendPlace(hit.prevX, hit.prevY, hit.prevZ, block, world.dimension);
        if (block === BlockId.Water) water.addSource(hit.prevX, hit.prevY, hit.prevZ);
        if (block === BlockId.SaplingYoung || block === BlockId.CropStage0) growth.register(hit.prevX, hit.prevY, hit.prevZ);
        if (block === BlockId.Obsidian) tryActivatePortalNear(chunkManager, hit.prevX, hit.prevY, hit.prevZ);
      }
    }
  });
}

main().catch((err) => {
  console.error(err);
  overlay.classList.remove("hidden");
  overlay.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
