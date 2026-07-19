// Shared WebSocket message shapes between client (src/net/client.ts) and
// server (src/server/index.ts) — a single source of truth for the wire
// protocol so the two sides can never silently drift apart.

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  dimension: "overworld" | "nether";
  health: number;
}

export interface MobState {
  id: number;
  kind: number; // MobKind
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  dimension: "overworld" | "nether";
}

export type ClientMessage =
  | { type: "hello"; name: string }
  | { type: "move"; x: number; y: number; z: number; yaw: number; pitch: number; dimension: "overworld" | "nether" }
  | { type: "break"; x: number; y: number; z: number; dimension: "overworld" | "nether" }
  | { type: "place"; x: number; y: number; z: number; block: number; dimension: "overworld" | "nether" }
  | { type: "attack" }
  | { type: "attackMob"; mobId: number; damage: number };

export type ServerMessage =
  | { type: "welcome"; id: string; players: PlayerState[]; edits: { x: number; y: number; z: number; block: number; dimension: "overworld" | "nether" }[] }
  | { type: "playerJoined"; player: PlayerState }
  | { type: "playerLeft"; id: string }
  | { type: "playerMoved"; id: string; x: number; y: number; z: number; yaw: number; pitch: number; dimension: "overworld" | "nether" }
  | { type: "playerAttacked"; id: string }
  | { type: "blockChanged"; x: number; y: number; z: number; block: number; dimension: "overworld" | "nether" }
  | { type: "mobs"; list: MobState[] }
  | { type: "playerHealth"; id: string; health: number };
