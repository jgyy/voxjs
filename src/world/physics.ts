import { vec3 } from "gl-matrix";
import { Camera } from "../gfx/camera";
import {
  FLY_SPEED_MULTIPLIER,
  FLY_SPRINT_MULTIPLIER,
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  SPRINT_SPEED,
  SWIM_SPEED_MULTIPLIER,
  TERMINAL_VELOCITY,
  WALK_SPEED,
  WATER_BUOYANCY,
} from "../config";
import { SolidQuery, VoxelBody } from "./collision";

export interface MovementInput {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean; // jump (grounded) / ascend (flying) / paddle up (swimming)
  down: boolean; // descend (flying) / dive (swimming)
  sprint: boolean;
}

export type { SolidQuery };

export class PlayerPhysics {
  velocity = vec3.create();
  flying = false;
  grounded = false;
  swimming = false;
  /** Camera (eye) is fully inside a water block — drives the underwater screen overlay (V.7). */
  headSubmerged = false;

  private body = new VoxelBody({ width: PLAYER_WIDTH, height: PLAYER_HEIGHT });

  toggleFly(): void {
    this.flying = !this.flying;
    if (this.flying) vec3.set(this.velocity, 0, 0, 0);
  }

  update(camera: Camera, dt: number, input: MovementInput, isSolid: SolidQuery, isLiquid: SolidQuery): void {
    const feet = vec3.fromValues(camera.position[0], camera.position[1] - PLAYER_EYE_HEIGHT, camera.position[2]);

    const feetBlock = isLiquid(Math.floor(feet[0]), Math.floor(feet[1] + 0.1), Math.floor(feet[2]));
    const eyeBlock = isLiquid(Math.floor(camera.position[0]), Math.floor(camera.position[1]), Math.floor(camera.position[2]));
    this.swimming = feetBlock && !this.flying;
    this.headSubmerged = eyeBlock;

    const forward = camera.flatForwardVector(vec3.create());
    const right = camera.rightVector(vec3.create());
    const move = vec3.create();
    if (input.forward) vec3.add(move, move, forward);
    if (input.back) vec3.sub(move, move, forward);
    if (input.right) vec3.add(move, move, right);
    if (input.left) vec3.sub(move, move, right);
    if (vec3.length(move) > 0) vec3.normalize(move, move);

    let horizontalSpeed: number;
    let verticalDelta: number;

    if (this.flying) {
      horizontalSpeed = WALK_SPEED * (input.sprint ? FLY_SPRINT_MULTIPLIER : FLY_SPEED_MULTIPLIER);
      let vy = 0;
      if (input.up) vy += horizontalSpeed;
      if (input.down) vy -= horizontalSpeed;
      verticalDelta = vy * dt;
      this.grounded = false;
    } else if (this.swimming) {
      horizontalSpeed = WALK_SPEED * SWIM_SPEED_MULTIPLIER * (input.sprint ? 1.4 : 1);
      this.velocity[1] += (WATER_BUOYANCY * 0.35 - GRAVITY * 0.35) * dt;
      if (input.up) this.velocity[1] = Math.max(this.velocity[1], 2.2);
      if (input.down) this.velocity[1] -= 6 * dt;
      this.velocity[1] = Math.max(-4, Math.min(4, this.velocity[1]));
      verticalDelta = this.velocity[1] * dt;
    } else {
      horizontalSpeed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
      this.velocity[1] -= GRAVITY * dt;
      if (input.up && this.grounded) this.velocity[1] = JUMP_VELOCITY;
      this.velocity[1] = Math.max(-TERMINAL_VELOCITY, this.velocity[1]);
      verticalDelta = this.velocity[1] * dt;
    }

    const dx = move[0] * horizontalSpeed * dt;
    const dz = move[2] * horizontalSpeed * dt;

    feet[0] += this.body.moveAxis(feet, 0, dx, isSolid);
    feet[2] += this.body.moveAxis(feet, 2, dz, isSolid);
    const actualVY = this.body.moveAxis(feet, 1, verticalDelta, isSolid);
    feet[1] += actualVY;

    if (!this.flying) {
      const blockedVertically = Math.abs(actualVY - verticalDelta) > 1e-9;
      if (blockedVertically) {
        if (verticalDelta < 0) this.grounded = true;
        this.velocity[1] = 0;
      } else {
        this.grounded = false;
      }
    }

    camera.position[0] = feet[0];
    camera.position[1] = feet[1] + PLAYER_EYE_HEIGHT;
    camera.position[2] = feet[2];
  }
}
