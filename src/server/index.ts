import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { vec3 } from "gl-matrix";
import { TerrainGenerator } from "../world/generator";
import { NetherGenerator } from "../world/nether";
import { BlockId, isSolid } from "../world/blocks";
import { Mob, MobKind, damageMob, spawnMob, tickMobs } from "../world/entities";
import {
  DEFAULT_WS_PORT,
  MOB_MAX_COUNT,
  MOB_SPAWN_RADIUS_MAX,
  MOB_SPAWN_RADIUS_MIN,
  NETWORK_TICK_HZ,
  PLAYER_MAX_HEALTH,
  WORLD_SEED,
} from "../config";
import { WorldStore } from "./store";
import { ClientMessage, MobState, PlayerState, ServerMessage } from "./protocol";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? DEFAULT_WS_PORT);

type Dimension = "overworld" | "nether";

const overworldGenerator = new TerrainGenerator(WORLD_SEED);
const netherGenerator = new NetherGenerator();
const stores: Record<Dimension, WorldStore> = {
  overworld: new WorldStore(overworldGenerator, "overworld-edits.json"),
  nether: new WorldStore(netherGenerator, "nether-edits.json"),
};

interface Connection {
  id: string;
  name: string;
  socket: WebSocket;
  state: PlayerState;
}

const connections = new Map<string, Connection>();
const mobsByDimension: Record<Dimension, Mob[]> = { overworld: [], nether: [] };
let nextConnectionId = 1;

function broadcast(message: ServerMessage, exceptId?: string): void {
  const payload = JSON.stringify(message);
  for (const conn of connections.values()) {
    if (conn.id === exceptId) continue;
    if (conn.socket.readyState === WebSocket.OPEN) conn.socket.send(payload);
  }
}

function send(conn: Connection, message: ServerMessage): void {
  if (conn.socket.readyState === WebSocket.OPEN) conn.socket.send(JSON.stringify(message));
}

function findSurfaceY(store: WorldStore, x: number, z: number): number | null {
  for (let y = 254; y >= 1; y--) {
    if (isSolid(store.getBlock(x, y, z))) return y + 1;
  }
  return null;
}

function playersInDimension(dim: Dimension): Connection[] {
  return [...connections.values()].filter((c) => c.state.dimension === dim);
}

// --- WebSocket server ---
const wss = new WebSocketServer({ noServer: true });

wss.on("connection", (socket) => {
  const id = `p${nextConnectionId++}`;
  const conn: Connection = {
    id,
    name: `Player${id}`,
    socket,
    state: { id, name: `Player${id}`, x: 0, y: 90, z: 0, yaw: 0, pitch: 0, dimension: "overworld", health: 20 },
  };
  connections.set(id, conn);

  send(conn, {
    type: "welcome",
    id,
    players: [...connections.values()].filter((c) => c.id !== id).map((c) => c.state),
    edits: [
      ...stores.overworld.allEdits().map((e) => ({ ...e, dimension: "overworld" as Dimension })),
      ...stores.nether.allEdits().map((e) => ({ ...e, dimension: "nether" as Dimension })),
    ],
  });

  socket.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleMessage(conn, msg);
  });

  socket.on("close", () => {
    connections.delete(id);
    broadcast({ type: "playerLeft", id });
  });
});

function handleMessage(conn: Connection, msg: ClientMessage): void {
  switch (msg.type) {
    case "hello": {
      conn.name = msg.name.slice(0, 24) || conn.name;
      conn.state.name = conn.name;
      broadcast({ type: "playerJoined", player: conn.state }, conn.id);
      break;
    }
    case "move": {
      conn.state.x = msg.x;
      conn.state.y = msg.y;
      conn.state.z = msg.z;
      conn.state.yaw = msg.yaw;
      conn.state.pitch = msg.pitch;
      conn.state.dimension = msg.dimension;
      broadcast({ type: "playerMoved", id: conn.id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch, dimension: msg.dimension }, conn.id);
      break;
    }
    case "break": {
      const store = stores[msg.dimension];
      if (store.getBlock(msg.x, msg.y, msg.z) === BlockId.Air) return;
      store.setBlock(msg.x, msg.y, msg.z, BlockId.Air);
      broadcast({ type: "blockChanged", x: msg.x, y: msg.y, z: msg.z, block: BlockId.Air, dimension: msg.dimension });
      break;
    }
    case "place": {
      const store = stores[msg.dimension];
      if (store.getBlock(msg.x, msg.y, msg.z) !== BlockId.Air) return;
      store.setBlock(msg.x, msg.y, msg.z, msg.block);
      broadcast({ type: "blockChanged", x: msg.x, y: msg.y, z: msg.z, block: msg.block, dimension: msg.dimension });
      break;
    }
    case "attack": {
      broadcast({ type: "playerAttacked", id: conn.id }, conn.id);
      break;
    }
    case "attackMob": {
      const mob = mobsByDimension[conn.state.dimension].find((m) => m.id === msg.mobId);
      if (mob) damageMob(mob, msg.damage);
      break;
    }
  }
}

// --- Server-authoritative mob simulation (V.5: "Entity states ... should also be synchronized") ---
const MOB_TICK_MS = 1000 / 20;
const MOB_SPAWN_INTERVAL_MS = 2500;
const mobSpawnAccumMs: Record<Dimension, number> = { overworld: 0, nether: 0 };

setInterval(() => {
  for (const dim of ["overworld", "nether"] as Dimension[]) {
    const store = stores[dim];
    const players = playersInDimension(dim);
    if (players.length === 0) continue;
    const target = players[0]!.state;

    tickMobs(mobsByDimension[dim], MOB_TICK_MS / 1000, {
      isSolid: (x, y, z) => store.isSolidAt(x, y, z),
      playerPosition: vec3.fromValues(target.x, target.y, target.z),
      onPlayerDamage: (amount) => {
        target.health = Math.max(0, target.health - amount);
        if (target.health <= 0) target.health = PLAYER_MAX_HEALTH; // simple respawn, mirrors the offline client
        const targetConn = connections.get(target.id);
        if (targetConn) send(targetConn, { type: "playerHealth", id: target.id, health: target.health });
        broadcast({ type: "playerHealth", id: target.id, health: target.health });
      },
    });
    mobsByDimension[dim] = mobsByDimension[dim].filter((m) => m.alive);

    mobSpawnAccumMs[dim] += MOB_TICK_MS;
    if (mobSpawnAccumMs[dim] >= MOB_SPAWN_INTERVAL_MS) {
      mobSpawnAccumMs[dim] = 0;
      if (mobsByDimension[dim].length < MOB_MAX_COUNT) {
        const angle = Math.random() * Math.PI * 2;
        const radius = MOB_SPAWN_RADIUS_MIN + Math.random() * (MOB_SPAWN_RADIUS_MAX - MOB_SPAWN_RADIUS_MIN);
        const sx = Math.floor(target.x + Math.cos(angle) * radius);
        const sz = Math.floor(target.z + Math.sin(angle) * radius);
        const sy = findSurfaceY(store, sx, sz);
        if (sy !== null) {
          const kind = Math.random() < 0.5 ? MobKind.Zombie : MobKind.Creeper;
          mobsByDimension[dim].push(spawnMob(kind, vec3.fromValues(sx + 0.5, sy, sz + 0.5)));
        }
      }
    }
  }
}, MOB_TICK_MS);

setInterval(() => {
  for (const dim of ["overworld", "nether"] as Dimension[]) {
    const list: MobState[] = mobsByDimension[dim].map((m) => ({
      id: m.id,
      kind: m.kind,
      x: m.position[0],
      y: m.position[1],
      z: m.position[2],
      yaw: m.yaw,
      health: m.health,
      maxHealth: m.maxHealth,
      alive: m.alive,
      dimension: dim,
    }));
    if (list.length === 0) continue;
    const message: ServerMessage = { type: "mobs", list };
    for (const conn of playersInDimension(dim)) send(conn, message);
  }
}, 1000 / NETWORK_TICK_HZ);

// --- HTTP: online map (bonus: "An online map interface (like Minecraft's Dynmap)") ---
const mapHtml = readFileSync(join(__dirname, "map.html"), "utf8");
const BIOME_COLORS = [
  "#6ea23c", // Plains
  "#2f6b2f", // Forest
  "#234d33", // SequoiaForest
  "#d8c789", // Desert
  "#a24a2c", // Canyon
  "#4b5a3a", // Swamp
  "#b6a23c", // Savanna
  "#e8ecf2", // SnowyPlains
  "#8c8c8c", // Mountain
  "#d8cf9e", // Island
];

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/map.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(mapHtml);
    return;
  }

  if (url.pathname === "/api/map") {
    const cx = Number(url.searchParams.get("cx") ?? 0);
    const cz = Number(url.searchParams.get("cz") ?? 0);
    const radius = Math.min(4096, Number(url.searchParams.get("radius") ?? 256));
    let step = Math.max(1, Number(url.searchParams.get("step") ?? 4));
    const dim = (url.searchParams.get("dim") ?? "overworld") as Dimension;

    // Hard cap on grid cells regardless of what the client asks for — biomeAt/heightAt
    // are real terrain-generation calls, not free, and an unclamped fine-grained request
    // over a full-viewport radius could ask for millions of them in one HTTP call.
    const MAX_GRID = 300;
    if ((radius * 2) / step > MAX_GRID) step = Math.ceil((radius * 2) / MAX_GRID);
    const size = Math.floor((radius * 2) / step);
    const colors: string[] = [];
    if (dim === "overworld") {
      for (let iz = 0; iz < size; iz++) {
        for (let ix = 0; ix < size; ix++) {
          const wx = cx - radius + ix * step;
          const wz = cz - radius + iz * step;
          const biome = overworldGenerator.biomeAt(wx, wz);
          const height = overworldGenerator.heightAt(wx, wz);
          const shade = Math.max(0.55, Math.min(1.15, height / 90));
          colors.push(shadeColor(BIOME_COLORS[biome] ?? "#777", shade));
        }
      }
    } else {
      for (let i = 0; i < size * size; i++) colors.push("#3a1410");
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ originX: cx - radius, originZ: cz - radius, step, size, colors }));
    return;
  }

  if (url.pathname === "/api/players") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([...connections.values()].map((c) => c.state)));
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

function shadeColor(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 255) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * factor));
  const b = Math.min(255, Math.round((n & 255) * factor));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

httpServer.on("upgrade", (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

httpServer.listen(PORT, () => {
  console.log(`voxjs multiplayer server listening on ws://localhost:${PORT} (map: http://localhost:${PORT}/)`);
});
