import { vec3 } from "gl-matrix";
import { Renderer } from "./gfx/renderer";
import { Camera, InputState } from "./gfx/camera";
import { ChunkManager } from "./world/chunk-manager";
import { raycastVoxel } from "./world/raycast";
import { isOpaque } from "./world/blocks";
import {
  BLOCK_REACH,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Z,
  DEFAULT_RENDER_DISTANCE_CHUNKS,
  MAX_RENDER_DISTANCE_CHUNKS,
  MIN_RENDER_DISTANCE_CHUNKS,
} from "./config";

const canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const overlay = document.getElementById("overlay") as HTMLDivElement;

async function main(): Promise<void> {
  const renderer = await Renderer.create(canvas);
  const camera = new Camera();
  const chunkManager = new ChunkManager(renderer.gl);

  const input: InputState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    sprint: false,
  };

  setupLookAndInput(canvas, overlay, camera, input);
  setupBlockBreaking(canvas, camera, chunkManager);

  window.addEventListener("resize", () => renderer.resize());

  // --- Dynamic render distance (bonus V.1 requirement): shrink under load,
  // grow back when frame time allows, never below the mandated floor.
  let renderDistanceChunks = DEFAULT_RENDER_DISTANCE_CHUNKS;
  const TARGET_FRAME_MS = 1000 / 60;

  let lastTime = performance.now();
  let fps = 0;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let fpsTimer = 0;

  function frame(now: number): void {
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    const frameStart = performance.now();

    camera.aspect = renderer.aspect;
    camera.update(dt, input);
    camera.updateMatrices();

    const playerChunkX = Math.floor(camera.position[0] / CHUNK_SIZE_X);
    const playerChunkZ = Math.floor(camera.position[2] / CHUNK_SIZE_Z);
    chunkManager.update(playerChunkX, playerChunkZ, renderDistanceChunks);

    renderer.render(camera, chunkManager.visibleChunks(camera.frustum));

    const frameMs = performance.now() - frameStart;

    // Adjust render distance gradually based on observed frame cost.
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
      const renderCubes = renderDistanceChunks * CHUNK_SIZE_X;
      hud.textContent =
        `FPS: ${fps.toFixed(0)}\n` +
        `Render distance: ${renderDistanceChunks} chunks (~${renderCubes} cubes)\n` +
        `Loaded chunks: ${chunkManager.loadedChunkCount} (pending mesh: ${chunkManager.pendingMeshCount})\n` +
        `Pos: ${camera.position[0].toFixed(1)}, ${camera.position[1].toFixed(1)}, ${camera.position[2].toFixed(1)}\n` +
        `Speed: ${input.sprint ? "x20 (sprint)" : "x1"}` +
        (Renderer.lastError ? `\nGPU ERROR: ${Renderer.lastError}` : "");
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function setupLookAndInput(
  canvas: HTMLCanvasElement,
  overlay: HTMLDivElement,
  camera: Camera,
  input: InputState,
): void {
  const keyMap: Record<string, keyof InputState> = {
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

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      document.exitPointerLock();
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
    for (const key of Object.keys(input) as (keyof InputState)[]) input[key] = false;
  });
}

// Bonus: "being able to delete blocks with the mouse" — left click raycasts
// along the view direction and removes the first solid block within reach.
function setupBlockBreaking(canvas: HTMLCanvasElement, camera: Camera, chunkManager: ChunkManager): void {
  canvas.addEventListener("mousedown", (e) => {
    if (document.pointerLockElement !== canvas || e.button !== 0) return;

    const direction = camera.forwardVector(vec3.create());
    const hit = raycastVoxel(camera.position, direction, BLOCK_REACH, (x, y, z) =>
      isOpaque(chunkManager.getBlock(x, y, z)),
    );
    if (hit) chunkManager.removeBlock(hit.x, hit.y, hit.z);
  });
}

main().catch((err) => {
  console.error(err);
  overlay.classList.remove("hidden");
  overlay.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
