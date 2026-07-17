import { Renderer } from "./gfx/renderer";
import { Camera, InputState } from "./gfx/camera";
import { ChunkManager } from "./world/chunk-manager";
import {
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
  const chunkManager = new ChunkManager(renderer.device);

  const input: InputState = {
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    sprint: false,
  };

  setupLookAndInput(overlay, camera, input);

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

function setupLookAndInput(overlay: HTMLDivElement, camera: Camera, input: InputState): void {
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

  let active = false;

  overlay.addEventListener("click", () => {
    active = true;
    overlay.classList.add("hidden");
  });

  document.addEventListener("mousemove", (e) => {
    if (!active) return;
    camera.applyMouseDelta(e.movementX, e.movementY);
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape") {
      active = false;
      overlay.classList.remove("hidden");
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

main().catch((err) => {
  console.error(err);
  overlay.classList.remove("hidden");
  overlay.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
