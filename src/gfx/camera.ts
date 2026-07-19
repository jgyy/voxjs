import { mat4, vec3 } from "gl-matrix";
import { FAR_PLANE, FOV_DEGREES, MOUSE_SENSITIVITY, NEAR_PLANE } from "../config";
import { Frustum } from "../world/frustum";

const UP = vec3.fromValues(0, 1, 0);

/**
 * Pure view/projection state — no movement or physics of its own (see
 * world/physics.ts for that). `position` is the eye position; callers are
 * free to write to it (physics) or read it (rendering, raycasting).
 */
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

  /** Forward projected onto the horizontal plane, used for ground-relative movement. */
  flatForwardVector(out: vec3): vec3 {
    out[0] = Math.cos(this.yaw);
    out[1] = 0;
    out[2] = Math.sin(this.yaw);
    return vec3.normalize(out, out);
  }

  rightVector(out: vec3): vec3 {
    const forward = this.flatForwardVector(vec3.create());
    return vec3.normalize(out, vec3.cross(out, forward, UP));
  }

  updateMatrices(): void {
    const forward = this.forwardVector(vec3.create());
    const target = vec3.add(vec3.create(), this.position, forward);
    mat4.lookAt(this.viewMatrix, this.position, target, UP);
    mat4.perspectiveNO(this.projMatrix, (FOV_DEGREES * Math.PI) / 180, this.aspect, NEAR_PLANE, FAR_PLANE);
    mat4.multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
    this.frustum.setFromViewProjection(this.viewProjMatrix);
  }

  getViewProjMatrix(): mat4 {
    return this.viewProjMatrix;
  }

  getViewMatrix(): mat4 {
    return this.viewMatrix;
  }

  getProjMatrix(): mat4 {
    return this.projMatrix;
  }
}
