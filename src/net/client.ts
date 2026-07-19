import { vec3 } from "gl-matrix";
import { DEFAULT_WS_PORT, NETWORK_TICK_HZ } from "../config";
import { EntityPose } from "../gfx/entity-mesh";
import { MOB_TEXTURE_LAYERS } from "../gfx/texture-atlas";
import { ClientMessage, MobState, PlayerState, ServerMessage } from "../server/protocol";

/** V.5: "Players should be visible in the world, performing ... walking [and] attacking." */
export function remotePlayerPose(player: PlayerState): EntityPose {
  const layer = MOB_TEXTURE_LAYERS.player;
  return {
    worldX: player.x,
    worldY: player.y - 1.62,
    worldZ: player.z,
    yaw: player.yaw,
    boxes: [
      { cx: 0, cy: 1.5, cz: 0, hx: 0.22, hy: 0.22, hz: 0.22, layer },
      { cx: 0, cy: 0.95, cz: 0, hx: 0.28, hy: 0.55, hz: 0.16, layer },
      { cx: -0.12, cy: 0.4, cz: 0, hx: 0.11, hy: 0.4, hz: 0.11, layer },
      { cx: 0.12, cy: 0.4, cz: 0, hx: 0.11, hy: 0.4, hz: 0.11, layer },
    ],
  };
}

export type Dimension = "overworld" | "nether";

export interface RemoteBlockChange {
  x: number;
  y: number;
  z: number;
  block: number;
  dimension: Dimension;
}

/**
 * V.5: "ft_minecraft must be multiplayer-ready" — a thin, fully optional
 * WebSocket client. If no server is reachable it fails silently and the
 * game keeps running single-player (see world/chunk-manager.ts's own
 * localStorage persistence for that case); nothing here is required for
 * offline play to work.
 */
export class NetworkClient {
  private socket: WebSocket | null = null;
  connected = false;
  localId: string | null = null;
  players = new Map<string, PlayerState>();
  mobs: MobState[] = [];

  onBlockChanged: ((change: RemoteBlockChange) => void) | null = null;
  onPlayerAttacked: ((id: string) => void) | null = null;
  onLocalHealth: ((health: number) => void) | null = null;

  private lastSendMs = 0;
  private sendIntervalMs = 1000 / NETWORK_TICK_HZ;

  connect(name: string, host = window.location.hostname || "localhost", port = DEFAULT_WS_PORT): void {
    try {
      this.socket = new WebSocket(`ws://${host}:${port}`);
    } catch {
      return; // e.g. insecure-context restrictions — just stay offline
    }

    this.socket.addEventListener("open", () => {
      this.connected = true;
      this.send({ type: "hello", name });
    });
    this.socket.addEventListener("close", () => {
      this.connected = false;
    });
    this.socket.addEventListener("error", () => {
      this.connected = false;
    });
    this.socket.addEventListener("message", (event) => {
      try {
        this.handle(JSON.parse(event.data as string) as ServerMessage);
      } catch {
        // ignore malformed frames rather than crashing the game
      }
    });
  }

  private send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "welcome":
        this.localId = msg.id;
        for (const p of msg.players) this.players.set(p.id, p);
        for (const edit of msg.edits) this.onBlockChanged?.(edit);
        break;
      case "playerJoined":
        this.players.set(msg.player.id, msg.player);
        break;
      case "playerLeft":
        this.players.delete(msg.id);
        break;
      case "playerMoved": {
        const p = this.players.get(msg.id);
        if (p) {
          p.x = msg.x;
          p.y = msg.y;
          p.z = msg.z;
          p.yaw = msg.yaw;
          p.pitch = msg.pitch;
          p.dimension = msg.dimension;
        }
        break;
      }
      case "playerAttacked":
        this.onPlayerAttacked?.(msg.id);
        break;
      case "blockChanged":
        this.onBlockChanged?.(msg);
        break;
      case "mobs":
        this.mobs = msg.list;
        break;
      case "playerHealth":
        if (msg.id === this.localId) this.onLocalHealth?.(msg.health);
        else {
          const p = this.players.get(msg.id);
          if (p) p.health = msg.health;
        }
        break;
    }
  }

  /** Throttled to NETWORK_TICK_HZ regardless of call frequency, so the render loop can call it every frame. */
  sendMove(position: vec3, yaw: number, pitch: number, dimension: Dimension): void {
    const now = performance.now();
    if (now - this.lastSendMs < this.sendIntervalMs) return;
    this.lastSendMs = now;
    this.send({ type: "move", x: position[0], y: position[1], z: position[2], yaw, pitch, dimension });
  }

  sendBreak(x: number, y: number, z: number, dimension: Dimension): void {
    this.send({ type: "break", x, y, z, dimension });
  }

  sendPlace(x: number, y: number, z: number, block: number, dimension: Dimension): void {
    this.send({ type: "place", x, y, z, block, dimension });
  }

  sendAttack(): void {
    this.send({ type: "attack" });
  }

  sendAttackMob(mobId: number, damage: number): void {
    this.send({ type: "attackMob", mobId, damage });
  }

  remotePlayersIn(dimension: Dimension): PlayerState[] {
    return [...this.players.values()].filter((p) => p.dimension === dimension);
  }
}
