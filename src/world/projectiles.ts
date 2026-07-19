import { vec3 } from "gl-matrix";
import { MOB_TEXTURE_LAYERS } from "../gfx/texture-atlas";
import { EntityPose } from "../gfx/entity-mesh";
import { Mob, damageMob } from "./entities";
import { SolidQuery } from "./collision";

const ARROW_SPEED = 28;
const ARROW_GRAVITY = 14;
const ARROW_LIFETIME_SECONDS = 6;
const ARROW_HIT_RADIUS = 0.55;
export const ARROW_DAMAGE = 8;
const SUBSTEPS = 4;

export interface Arrow {
  position: vec3;
  velocity: vec3;
  alive: boolean;
  age: number;
  stuck: boolean;
}

/** Bonus: "A bow and arrow system similar to Minecraft." */
export function shootArrow(origin: vec3, direction: vec3): Arrow {
  return {
    position: vec3.clone(origin),
    velocity: vec3.scale(vec3.create(), direction, ARROW_SPEED),
    alive: true,
    age: 0,
    stuck: false,
  };
}

export interface ArrowTickOptions {
  isSolid: SolidQuery;
  mobs: Mob[];
  onHitMob?: (mob: Mob) => void;
}

export function tickArrows(arrows: Arrow[], dt: number, opts: ArrowTickOptions): void {
  for (const arrow of arrows) {
    if (!arrow.alive) continue;
    arrow.age += dt;
    if (arrow.age > ARROW_LIFETIME_SECONDS) {
      arrow.alive = false;
      continue;
    }
    if (arrow.stuck) continue;

    const subDt = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) {
      arrow.velocity[1] -= ARROW_GRAVITY * subDt;
      const prev = vec3.clone(arrow.position);
      vec3.scaleAndAdd(arrow.position, arrow.position, arrow.velocity, subDt);

      if (opts.isSolid(Math.floor(arrow.position[0]), Math.floor(arrow.position[1]), Math.floor(arrow.position[2]))) {
        arrow.stuck = true;
        vec3.copy(arrow.position, prev);
        break;
      }

      let hitMob: Mob | null = null;
      for (const mob of opts.mobs) {
        if (!mob.alive) continue;
        const center = vec3.fromValues(mob.position[0], mob.position[1] + 0.9, mob.position[2]);
        if (vec3.distance(arrow.position, center) < ARROW_HIT_RADIUS) {
          hitMob = mob;
          break;
        }
      }
      if (hitMob) {
        damageMob(hitMob, ARROW_DAMAGE);
        opts.onHitMob?.(hitMob);
        arrow.alive = false;
        break;
      }
    }
  }
}

export function arrowPose(arrow: Arrow): EntityPose {
  const yaw = Math.atan2(arrow.velocity[2], arrow.velocity[0]);
  return {
    worldX: arrow.position[0],
    worldY: arrow.position[1],
    worldZ: arrow.position[2],
    yaw,
    boxes: [{ cx: 0, cy: 0, cz: 0, hx: 0.35, hy: 0.05, hz: 0.05, layer: MOB_TEXTURE_LAYERS.arrow }],
  };
}
