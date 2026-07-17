import { mat4, vec3 } from "gl-matrix";
import voxelVertSource from "./shaders/voxel.vert.glsl?raw";
import voxelFragSource from "./shaders/voxel.frag.glsl?raw";
import skyVertSource from "./shaders/skybox.vert.glsl?raw";
import skyFragSource from "./shaders/skybox.frag.glsl?raw";
import { createTextureArray } from "./texture-atlas";
import { Camera } from "./camera";
import { Chunk } from "../world/chunk";
import { FAR_PLANE } from "../config";

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${log}`);
  }
  return shader;
}

function linkProgram(gl: WebGL2RenderingContext, vertSource: string, fragSource: string): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSource);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSource);
  const program = gl.createProgram()!;
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}

export class Renderer {
  static lastError: string | null = null;

  readonly gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  private voxelProgram!: WebGLProgram;
  private voxelUniforms!: {
    viewProj: WebGLUniformLocation | null;
    cameraPos: WebGLUniformLocation | null;
    fogColor: WebGLUniformLocation | null;
    fogParams: WebGLUniformLocation | null;
    atlas: WebGLUniformLocation | null;
  };
  private atlasTexture!: WebGLTexture;

  private skyProgram!: WebGLProgram;
  private skyUniforms!: {
    invViewProj: WebGLUniformLocation | null;
    sunDirection: WebGLUniformLocation | null;
  };
  private skyVao!: WebGLVertexArrayObject;

  private sunDirection = vec3.normalize(vec3.create(), vec3.fromValues(0.4, 0.85, 0.3));

  private constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    const gl = canvas.getContext("webgl2", { antialias: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is not supported in this browser.");

    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      console.error("WebGL context lost");
      Renderer.lastError = "WebGL context lost";
    });

    const renderer = new Renderer(gl, canvas);
    renderer.initResources();
    renderer.resize();
    return renderer;
  }

  private initResources(): void {
    const gl = this.gl;

    // --- Voxel program ---
    this.voxelProgram = linkProgram(gl, voxelVertSource, voxelFragSource);
    this.voxelUniforms = {
      viewProj: gl.getUniformLocation(this.voxelProgram, "uViewProj"),
      cameraPos: gl.getUniformLocation(this.voxelProgram, "uCameraPos"),
      fogColor: gl.getUniformLocation(this.voxelProgram, "uFogColor"),
      fogParams: gl.getUniformLocation(this.voxelProgram, "uFogParams"),
      atlas: gl.getUniformLocation(this.voxelProgram, "uAtlas"),
    };

    this.atlasTexture = createTextureArray(gl);

    // --- Skybox program ---
    this.skyProgram = linkProgram(gl, skyVertSource, skyFragSource);
    this.skyUniforms = {
      invViewProj: gl.getUniformLocation(this.skyProgram, "uInvViewProj"),
      sunDirection: gl.getUniformLocation(this.skyProgram, "uSunDirection"),
    };
    this.skyVao = gl.createVertexArray()!;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) return;

    this.canvas.width = width;
    this.canvas.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  render(camera: Camera, chunks: Iterable<Chunk>): void {
    const gl = this.gl;

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- Skybox: fullscreen triangle pinned to the far plane, depth writes off ---
    const invViewProj = mat4.invert(mat4.create(), camera.getViewProjMatrix()) ?? mat4.create();
    gl.depthMask(false);
    gl.useProgram(this.skyProgram);
    gl.bindVertexArray(this.skyVao);
    gl.uniformMatrix4fv(this.skyUniforms.invViewProj, false, invViewProj);
    gl.uniform3fv(this.skyUniforms.sunDirection, this.sunDirection);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.depthMask(true);

    // --- Voxel chunks ---
    gl.useProgram(this.voxelProgram);
    gl.uniformMatrix4fv(this.voxelUniforms.viewProj, false, camera.getViewProjMatrix());
    gl.uniform3fv(this.voxelUniforms.cameraPos, camera.position);
    gl.uniform4f(this.voxelUniforms.fogColor, 0.75, 0.85, 0.95, 1.0); // fog color matches sky horizon
    gl.uniform2f(this.voxelUniforms.fogParams, FAR_PLANE * 0.55, FAR_PLANE * 0.95);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTexture);
    gl.uniform1i(this.voxelUniforms.atlas, 0);

    for (const chunk of chunks) {
      if (!chunk.vao || chunk.indexCount === 0) continue;
      gl.bindVertexArray(chunk.vao);
      gl.drawElements(gl.TRIANGLES, chunk.indexCount, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);

    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      Renderer.lastError = `WebGL error code ${error}`;
    }
  }

  get aspect(): number {
    return this.canvas.width / this.canvas.height;
  }
}
