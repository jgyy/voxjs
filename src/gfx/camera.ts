import { mat4, vec3 } from "gl-matrix";
import {
  BASE_MOVE_SPEED,
  FAR_PLANE,
  FOV_DEGREES,
  MOUSE_SENSITIVITY,
  NEAR_PLANE,
  SPRINT_MULTIPLIER,
} from "../config";
import { Frustum } from "../world/frustum";

export interface InputState {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  sprint: boolean;
}

const UP = vec3.fromValues(0, 1, 0);

export class Camera {
  position = vec3.fromValues(0, 96, 0);
  yaw = -Math.PI / 2; // facing -Z-ish / world forward
  pitch = 0;

  private viewMatrix = mat4.create();
  private projMatrix = mat4.create();
  private viewProjMatrix = mat4.create();
  readonly frustum = new Frustum();

  aspect = 16 / 9;

  applyMouseDelta(dx: number, dy: number): void {
    this.yaw += dx * MOUSE_SENSITIVITY;
    this.pitch -= dy * MOUSE_SENSITIVITY;
    const limit = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
  }

  forwardVector(out: vec3): vec3 {
    out[0] = Math.cos(this.pitch) * Math.cos(this.yaw);
    out[1] = Math.sin(this.pitch);
    out[2] = Math.cos(this.pitch) * Math.sin(this.yaw);
    return vec3.normalize(out, out);
  }

  update(dt: number, input: InputState): void {
    const forward = this.forwardVector(vec3.create());
    const flatForward = vec3.normalize(vec3.create(), vec3.fromValues(forward[0], 0, forward[2]));
    const right = vec3.normalize(vec3.create(), vec3.cross(vec3.create(), flatForward, UP));

    const speed = BASE_MOVE_SPEED * (input.sprint ? SPRINT_MULTIPLIER : 1);
    const move = vec3.create();

    if (input.forward) vec3.add(move, move, flatForward);
    if (input.back) vec3.sub(move, move, flatForward);
    if (input.right) vec3.add(move, move, right);
    if (input.left) vec3.sub(move, move, right);
    if (input.up) move[1] += 1;
    if (input.down) move[1] -= 1;

    if (vec3.length(move) > 0) {
      vec3.normalize(move, move);
      vec3.scaleAndAdd(this.position, this.position, move, speed * dt);
    }
  }

  updateMatrices(): void {
    const forward = this.forwardVector(vec3.create());
    const target = vec3.add(vec3.create(), this.position, forward);
    mat4.lookAt(this.viewMatrix, this.position, target, UP);
    mat4.perspective(this.projMatrix, (FOV_DEGREES * Math.PI) / 180, this.aspect, NEAR_PLANE, FAR_PLANE);
    mat4.multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
    this.frustum.setFromViewProjection(this.viewProjMatrix);
  }

  getViewProjMatrix(): mat4 {
    return this.viewProjMatrix;
  }
}
