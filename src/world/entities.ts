import { vec3 } from "gl-matrix";
import { MOB_TEXTURE_LAYERS } from "../gfx/texture-atlas";
import { EntityBox, EntityPose } from "../gfx/entity-mesh";
import { SolidQuery, VoxelBody } from "./collision";
import {
  GRAVITY,
  MOB_CHASE_RADIUS,
  MOB_CHASE_SPEED,
  MOB_DESPAWN_RADIUS,
  MOB_WALK_SPEED,
  TERMINAL_VELOCITY,
} from "../config";

export const enum MobKind {
  Zombie,
  Creeper,
}

export interface Mob {
  id: number;
  kind: MobKind;
  position: vec3; // feet position
  velocity: vec3;
  yaw: number;
  health: number;
  maxHealth: number;
  grounded: boolean;
  attackCooldownSeconds: number;
  animPhase: number;
  alive: boolean;
}

const MOB_BODY = new VoxelBody({ width: 0.7, height: 1.9 });
let nextMobId = 1;

export function spawnMob(kind: MobKind, position: vec3): Mob {
  return {
    id: nextMobId++,
    kind,
    position: vec3.clone(position),
    velocity: vec3.create(),
    yaw: 0,
    health: kind === MobKind.Creeper ? 15 : 20,
    maxHealth: kind === MobKind.Creeper ? 15 : 20,
    grounded: false,
    attackCooldownSeconds: 0,
    animPhase: 0,
    alive: true,
  };
}

export interface MobTickOptions {
  isSolid: SolidQuery;
  playerPosition: vec3;
  onPlayerDamage: (amount: number) => void;
}

const ATTACK_RANGE = 1.3;
const ATTACK_COOLDOWN = 1.1;
const ATTACK_DAMAGE = { [MobKind.Zombie]: 2, [MobKind.Creeper]: 3 };

/** Chase-when-close AI (V.1: "Monsters ... should spawn and chase you when you get close"). Pure enough to run identically client-side (offline) or server-side (authoritative multiplayer, see task 13). */
export function tickMobs(mobs: Mob[], dt: number, opts: MobTickOptions): void {
  for (const mob of mobs) {
    if (!mob.alive) continue;

    const toPlayer = vec3.sub(vec3.create(), opts.playerPosition, mob.position);
    toPlayer[1] = 0;
    const dist = vec3.length(toPlayer);

    if (dist > MOB_DESPAWN_RADIUS) {
      mob.alive = false;
      continue;
    }

    let speed = 0;
    if (dist < MOB_CHASE_RADIUS && dist > 0.1) {
      vec3.normalize(toPlayer, toPlayer);
      mob.yaw = Math.atan2(toPlayer[2], toPlayer[0]);
      speed = MOB_CHASE_SPEED;
    } else {
      speed = MOB_WALK_SPEED * 0.2; // idle drift, kept simple on purpose
    }

    const dx = Math.cos(mob.yaw) * speed * dt;
    const dz = Math.sin(mob.yaw) * speed * dt;

    mob.velocity[1] -= GRAVITY * dt;
    mob.velocity[1] = Math.max(-TERMINAL_VELOCITY, mob.velocity[1]);

    const actualX = MOB_BODY.moveAxis(mob.position, 0, dx, opts.isSolid);
    const actualZ = MOB_BODY.moveAxis(mob.position, 2, dz, opts.isSolid);
    const actualY = MOB_BODY.moveAxis(mob.position, 1, mob.velocity[1] * dt, opts.isSolid);
    mob.position[0] += actualX;
    mob.position[2] += actualZ;
    mob.position[1] += actualY;

    if (Math.abs(actualY - mob.velocity[1] * dt) > 1e-9) {
      if (mob.velocity[1] < 0) mob.grounded = true;
      mob.velocity[1] = 0;
    } else {
      mob.grounded = false;
    }

    const moved = Math.hypot(actualX, actualZ);
    mob.animPhase += moved * 6;

    mob.attackCooldownSeconds = Math.max(0, mob.attackCooldownSeconds - dt);
    if (dist < ATTACK_RANGE && mob.attackCooldownSeconds <= 0) {
      opts.onPlayerDamage(ATTACK_DAMAGE[mob.kind]);
      mob.attackCooldownSeconds = ATTACK_COOLDOWN;
    }
  }
}

export function damageMob(mob: Mob, amount: number): void {
  mob.health -= amount;
  if (mob.health <= 0) mob.alive = false;
}

/** Simple stacked-box humanoid/creeper silhouettes with a sine-wave leg-swing walk cycle (V.7: "basic animations for walking ... Minecraft-like in simplicity"). */
export function mobPose(mob: Mob): EntityPose {
  const swing = Math.sin(mob.animPhase) * 0.5;
  const layer = mob.kind === MobKind.Zombie ? MOB_TEXTURE_LAYERS.zombie : MOB_TEXTURE_LAYERS.creeper;

  const boxes: EntityBox[] =
    mob.kind === MobKind.Zombie
      ? [
          { cx: 0, cy: 1.5, cz: 0, hx: 0.22, hy: 0.22, hz: 0.22, layer }, // head
          { cx: 0, cy: 0.95, cz: 0, hx: 0.28, hy: 0.55, hz: 0.16, layer }, // torso
          { cx: -0.12 + swing * 0.06, cy: 0.4, cz: swing * 0.18, hx: 0.11, hy: 0.4, hz: 0.11, layer }, // left leg
          { cx: 0.12 - swing * 0.06, cy: 0.4, cz: -swing * 0.18, hx: 0.11, hy: 0.4, hz: 0.11, layer }, // right leg
        ]
      : [
          { cx: 0, cy: 1.5, cz: 0, hx: 0.24, hy: 0.24, hz: 0.24, layer }, // head
          { cx: 0, cy: 0.85, cz: 0, hx: 0.26, hy: 0.65, hz: 0.2, layer }, // body
        ];

  return { worldX: mob.position[0], worldY: mob.position[1], worldZ: mob.position[2], yaw: mob.yaw, boxes };
}
