import { mat4, vec3 } from "gl-matrix";
import voxelVertSource from "./shaders/voxel.vert.glsl?raw";
import voxelFragSource from "./shaders/voxel.frag.glsl?raw";
import fullscreenVertSource from "./shaders/fullscreen.vert.glsl?raw";
import skyFragSource from "./shaders/skybox.frag.glsl?raw";
import depthNormalVertSource from "./shaders/depthnormal.vert.glsl?raw";
import depthNormalFragSource from "./shaders/depthnormal.frag.glsl?raw";
import ssaoFragSource from "./shaders/ssao.frag.glsl?raw";
import blurFragSource from "./shaders/blur.frag.glsl?raw";
import shadowVertSource from "./shaders/shadow.vert.glsl?raw";
import shadowFragSource from "./shaders/shadow.frag.glsl?raw";
import cloudsVertSource from "./shaders/clouds.vert.glsl?raw";
import cloudsFragSource from "./shaders/clouds.frag.glsl?raw";
import underwaterFragSource from "./shaders/underwater.frag.glsl?raw";
import { createTextureArray } from "./texture-atlas";
import { Camera } from "./camera";
import { Chunk, GpuMesh } from "../world/chunk";
import { FAR_PLANE } from "../config";
import { mulberry32 } from "../util/rng";

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

const SHADOW_MAP_SIZE = 2048;
const SHADOW_ORTHO_HALF_SIZE = 110;
const SSAO_KERNEL_SIZE = 16;
const CLOUD_Y = 188;
const CLOUD_EXTENT = 700;

function buildSsaoKernel(): Float32Array {
  const rand = mulberry32(0x55a01234);
  const kernel = new Float32Array(SSAO_KERNEL_SIZE * 3);
  for (let i = 0; i < SSAO_KERNEL_SIZE; i++) {
    const v = vec3.fromValues(rand() * 2 - 1, rand() * 2 - 1, rand() + 0.05);
    vec3.normalize(v, v);
    let scale = i / SSAO_KERNEL_SIZE;
    scale = 0.1 + 0.9 * scale * scale;
    vec3.scale(v, v, scale * rand());
    kernel[i * 3] = v[0];
    kernel[i * 3 + 1] = v[1];
    kernel[i * 3 + 2] = v[2];
  }
  return kernel;
}

function createDepthTexture(gl: WebGL2RenderingContext, width: number, height: number, comparable: boolean): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, width, height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, comparable ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, comparable ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (comparable) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  }
  return tex;
}

function createColorTexture(gl: WebGL2RenderingContext, width: number, height: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

type UL = WebGLUniformLocation | null;

interface VoxelUniforms {
  viewProj: UL;
  lightViewProj: UL;
  cameraPos: UL;
  fogColor: UL;
  fogParams: UL;
  atlas: UL;
  shadowMap: UL;
  ssaoTex: UL;
  screenSize: UL;
  sunDirection: UL;
  sunColor: UL;
  ambient: UL;
}

interface SkyUniforms {
  invViewProj: UL;
  sunDirection: UL;
  daylight: UL;
}

interface DepthNormalUniforms {
  view: UL;
  proj: UL;
}

interface SsaoUniforms {
  depthTex: UL;
  normalTex: UL;
  proj: UL;
  invProj: UL;
  kernel: UL;
  radius: UL;
}

interface BlurUniforms {
  sourceTex: UL;
  texelSize: UL;
}

interface ShadowUniforms {
  lightViewProj: UL;
}

interface CloudsUniforms {
  viewProj: UL;
  cameraPos: UL;
  cloudY: UL;
  cloudExtent: UL;
  time: UL;
}

interface UnderwaterUniforms {
  tintColor: UL;
  strength: UL;
}

export interface RenderOptions {
  sunDirection: vec3;
  sunColor: vec3;
  daylight: number; // 0 = midnight, 1 = midday
  headSubmerged: boolean;
  timeSeconds: number;
  /** Bonus: nether dimension — moody red haze, no sky/clouds, instead of the day/night sky. */
  nether?: boolean;
}

export class Renderer {
  static lastError: string | null = null;

  readonly gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;

  private voxelProgram!: WebGLProgram;
  private voxelUniforms!: VoxelUniforms;
  private atlasTexture!: WebGLTexture;

  private skyProgram!: WebGLProgram;
  private skyUniforms!: SkyUniforms;

  private depthNormalProgram!: WebGLProgram;
  private depthNormalUniforms!: DepthNormalUniforms;

  private ssaoProgram!: WebGLProgram;
  private ssaoUniforms!: SsaoUniforms;
  private ssaoKernel = buildSsaoKernel();

  private blurProgram!: WebGLProgram;
  private blurUniforms!: BlurUniforms;

  private shadowProgram!: WebGLProgram;
  private shadowUniforms!: ShadowUniforms;

  private cloudsProgram!: WebGLProgram;
  private cloudsUniforms!: CloudsUniforms;
  private cloudsVao!: WebGLVertexArrayObject;

  private underwaterProgram!: WebGLProgram;
  private underwaterUniforms!: UnderwaterUniforms;

  private emptyVao!: WebGLVertexArrayObject;

  // --- Shadow map ---
  private shadowFbo!: WebGLFramebuffer;
  private shadowDepthTex!: WebGLTexture;

  // --- Half-res depth/normal prepass + SSAO + blur ---
  private prepassFbo!: WebGLFramebuffer;
  private prepassDepthTex!: WebGLTexture;
  private prepassNormalTex!: WebGLTexture;
  private ssaoFbo!: WebGLFramebuffer;
  private ssaoTex!: WebGLTexture;
  private blurFbo!: WebGLFramebuffer;
  private blurTex!: WebGLTexture;
  private halfWidth = 1;
  private halfHeight = 1;

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

    this.voxelProgram = linkProgram(gl, voxelVertSource, voxelFragSource);
    this.voxelUniforms = {
      viewProj: gl.getUniformLocation(this.voxelProgram, "uViewProj"),
      lightViewProj: gl.getUniformLocation(this.voxelProgram, "uLightViewProj"),
      cameraPos: gl.getUniformLocation(this.voxelProgram, "uCameraPos"),
      fogColor: gl.getUniformLocation(this.voxelProgram, "uFogColor"),
      fogParams: gl.getUniformLocation(this.voxelProgram, "uFogParams"),
      atlas: gl.getUniformLocation(this.voxelProgram, "uAtlas"),
      shadowMap: gl.getUniformLocation(this.voxelProgram, "uShadowMap"),
      ssaoTex: gl.getUniformLocation(this.voxelProgram, "uSsaoTex"),
      screenSize: gl.getUniformLocation(this.voxelProgram, "uScreenSize"),
      sunDirection: gl.getUniformLocation(this.voxelProgram, "uSunDirection"),
      sunColor: gl.getUniformLocation(this.voxelProgram, "uSunColor"),
      ambient: gl.getUniformLocation(this.voxelProgram, "uAmbient"),
    };
    this.atlasTexture = createTextureArray(gl);

    this.skyProgram = linkProgram(gl, fullscreenVertSource, skyFragSource);
    this.skyUniforms = {
      invViewProj: gl.getUniformLocation(this.skyProgram, "uInvViewProj"),
      sunDirection: gl.getUniformLocation(this.skyProgram, "uSunDirection"),
      daylight: gl.getUniformLocation(this.skyProgram, "uDaylight"),
    };

    this.depthNormalProgram = linkProgram(gl, depthNormalVertSource, depthNormalFragSource);
    this.depthNormalUniforms = {
      view: gl.getUniformLocation(this.depthNormalProgram, "uView"),
      proj: gl.getUniformLocation(this.depthNormalProgram, "uProj"),
    };

    this.ssaoProgram = linkProgram(gl, fullscreenVertSource, ssaoFragSource);
    this.ssaoUniforms = {
      depthTex: gl.getUniformLocation(this.ssaoProgram, "uDepthTex"),
      normalTex: gl.getUniformLocation(this.ssaoProgram, "uNormalTex"),
      proj: gl.getUniformLocation(this.ssaoProgram, "uProj"),
      invProj: gl.getUniformLocation(this.ssaoProgram, "uInvProj"),
      kernel: gl.getUniformLocation(this.ssaoProgram, "uKernel"),
      radius: gl.getUniformLocation(this.ssaoProgram, "uRadius"),
    };

    this.blurProgram = linkProgram(gl, fullscreenVertSource, blurFragSource);
    this.blurUniforms = {
      sourceTex: gl.getUniformLocation(this.blurProgram, "uSourceTex"),
      texelSize: gl.getUniformLocation(this.blurProgram, "uTexelSize"),
    };

    this.shadowProgram = linkProgram(gl, shadowVertSource, shadowFragSource);
    this.shadowUniforms = { lightViewProj: gl.getUniformLocation(this.shadowProgram, "uLightViewProj") };

    this.cloudsProgram = linkProgram(gl, cloudsVertSource, cloudsFragSource);
    this.cloudsUniforms = {
      viewProj: gl.getUniformLocation(this.cloudsProgram, "uViewProj"),
      cameraPos: gl.getUniformLocation(this.cloudsProgram, "uCameraPos"),
      cloudY: gl.getUniformLocation(this.cloudsProgram, "uCloudY"),
      cloudExtent: gl.getUniformLocation(this.cloudsProgram, "uCloudExtent"),
      time: gl.getUniformLocation(this.cloudsProgram, "uTime"),
    };
    this.cloudsVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.cloudsVao);
    const cloudBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cloudBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.underwaterProgram = linkProgram(gl, fullscreenVertSource, underwaterFragSource);
    this.underwaterUniforms = {
      tintColor: gl.getUniformLocation(this.underwaterProgram, "uTintColor"),
      strength: gl.getUniformLocation(this.underwaterProgram, "uStrength"),
    };

    this.emptyVao = gl.createVertexArray()!;

    this.shadowDepthTex = createDepthTexture(gl, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE, true);
    this.shadowFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowDepthTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    gl.enable(gl.DEPTH_TEST);
    // LEQUAL, not LESS: the skybox's fullscreen triangle is pinned to
    // gl_Position.z = 1.0 (the far plane) so it draws behind everything, but
    // the depth buffer is also cleared to 1.0 — under strict LESS that tie
    // always fails the depth test and the sky never gets drawn at all.
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
  }

  private createHalfResTargets(): void {
    const gl = this.gl;
    const disposeTex = (t?: WebGLTexture): void => {
      if (t) gl.deleteTexture(t);
    };
    const disposeFbo = (f?: WebGLFramebuffer): void => {
      if (f) gl.deleteFramebuffer(f);
    };
    disposeTex(this.prepassDepthTex);
    disposeTex(this.prepassNormalTex);
    disposeFbo(this.prepassFbo);
    disposeTex(this.ssaoTex);
    disposeFbo(this.ssaoFbo);
    disposeTex(this.blurTex);
    disposeFbo(this.blurFbo);

    this.prepassDepthTex = createDepthTexture(gl, this.halfWidth, this.halfHeight, false);
    this.prepassNormalTex = createColorTexture(gl, this.halfWidth, this.halfHeight);
    this.prepassFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.prepassFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.prepassNormalTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.prepassDepthTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    this.ssaoTex = createColorTexture(gl, this.halfWidth, this.halfHeight);
    this.ssaoFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.ssaoTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    this.blurTex = createColorTexture(gl, this.halfWidth, this.halfHeight);
    this.blurFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.blurTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    const newHalfWidth = Math.max(1, Math.floor(width / 2));
    const newHalfHeight = Math.max(1, Math.floor(height / 2));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }
    if (newHalfWidth !== this.halfWidth || newHalfHeight !== this.halfHeight || !this.prepassFbo) {
      this.halfWidth = newHalfWidth;
      this.halfHeight = newHalfHeight;
      this.createHalfResTargets();
    }
  }

  private lightViewProjFor(camera: Camera, sunDirection: vec3): mat4 {
    const center = vec3.clone(camera.position);
    const eye = vec3.scaleAndAdd(vec3.create(), center, sunDirection, 150);
    const up = Math.abs(sunDirection[1]) > 0.98 ? vec3.fromValues(0, 0, 1) : vec3.fromValues(0, 1, 0);
    const lightView = mat4.lookAt(mat4.create(), eye, center, up);
    const s = SHADOW_ORTHO_HALF_SIZE;
    const lightProj = mat4.ortho(mat4.create(), -s, s, -s, s, 1, 400);
    return mat4.multiply(mat4.create(), lightProj, lightView);
  }

  private drawMesh(mesh: GpuMesh): void {
    if (!mesh.vao || mesh.indexCount === 0) return;
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.indexCount, gl.UNSIGNED_INT, 0);
  }

  render(camera: Camera, visibleChunks: Chunk[], options: RenderOptions, drawExtraOpaque?: () => void): void {
    const gl = this.gl;
    const lightViewProj = this.lightViewProjFor(camera, options.sunDirection);

    // --- Pass 1: shadow depth from the sun's point of view ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.shadowProgram);
    gl.uniformMatrix4fv(this.shadowUniforms.lightViewProj, false, lightViewProj);
    for (const chunk of visibleChunks) this.drawMesh(chunk.opaque);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // --- Pass 2: half-res view-space normal + depth prepass (SSAO input) ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.prepassFbo);
    gl.viewport(0, 0, this.halfWidth, this.halfHeight);
    gl.clearColor(0.5, 0.5, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.depthNormalProgram);
    const viewMatrix = camera.getViewMatrix();
    const projMatrix = camera.getProjMatrix();
    gl.uniformMatrix4fv(this.depthNormalUniforms.view, false, viewMatrix);
    gl.uniformMatrix4fv(this.depthNormalUniforms.proj, false, projMatrix);
    for (const chunk of visibleChunks) this.drawMesh(chunk.opaque);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // --- Pass 3: SSAO from the prepass ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ssaoFbo);
    gl.viewport(0, 0, this.halfWidth, this.halfHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.ssaoProgram);
    gl.bindVertexArray(this.emptyVao);
    const invProj = mat4.invert(mat4.create(), projMatrix) ?? mat4.create();
    gl.uniformMatrix4fv(this.ssaoUniforms.proj, false, projMatrix);
    gl.uniformMatrix4fv(this.ssaoUniforms.invProj, false, invProj);
    gl.uniform3fv(this.ssaoUniforms.kernel, this.ssaoKernel);
    gl.uniform1f(this.ssaoUniforms.radius, 0.7);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.prepassDepthTex);
    gl.uniform1i(this.ssaoUniforms.depthTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.prepassNormalTex);
    gl.uniform1i(this.ssaoUniforms.normalTex, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- Pass 4: blur the AO buffer ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFbo);
    gl.useProgram(this.blurProgram);
    gl.uniform2f(this.blurUniforms.texelSize, 1 / this.halfWidth, 1 / this.halfHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.ssaoTex);
    gl.uniform1i(this.blurUniforms.sourceTex, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // --- Pass 5: main forward pass ---
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0.12, 0.03, 0.02, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (!options.nether) {
      gl.depthMask(false);
      gl.useProgram(this.skyProgram);
      gl.bindVertexArray(this.emptyVao);
      const invViewProj = mat4.invert(mat4.create(), camera.getViewProjMatrix()) ?? mat4.create();
      gl.uniformMatrix4fv(this.skyUniforms.invViewProj, false, invViewProj);
      gl.uniform3fv(this.skyUniforms.sunDirection, options.sunDirection);
      gl.uniform1f(this.skyUniforms.daylight, options.daylight);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);

      // Clouds: a single large shader-shaded quad, drawn after the sky and
      // before terrain so distant terrain still occludes them normally.
      // Skipped in the nether — no open sky to float through.
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(this.cloudsProgram);
      gl.bindVertexArray(this.cloudsVao);
      gl.uniformMatrix4fv(this.cloudsUniforms.viewProj, false, camera.getViewProjMatrix());
      gl.uniform3fv(this.cloudsUniforms.cameraPos, camera.position);
      gl.uniform1f(this.cloudsUniforms.cloudY, CLOUD_Y);
      gl.uniform1f(this.cloudsUniforms.cloudExtent, CLOUD_EXTENT);
      gl.uniform1f(this.cloudsUniforms.time, options.timeSeconds);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }

    gl.useProgram(this.voxelProgram);
    gl.uniformMatrix4fv(this.voxelUniforms.viewProj, false, camera.getViewProjMatrix());
    gl.uniformMatrix4fv(this.voxelUniforms.lightViewProj, false, lightViewProj);
    gl.uniform3fv(this.voxelUniforms.cameraPos, camera.position);

    const fogColor: [number, number, number] = options.headSubmerged
      ? [0.06, 0.16, 0.32]
      : options.nether
        ? [0.22, 0.06, 0.03]
        : [0.75 * options.daylight + 0.04, 0.85 * options.daylight + 0.05, 0.95 * options.daylight + 0.09];
    gl.uniform4f(this.voxelUniforms.fogColor, fogColor[0], fogColor[1], fogColor[2], 1.0);
    const fogEnd = options.headSubmerged ? 22 : options.nether ? FAR_PLANE * 0.4 : FAR_PLANE * 0.95;
    const fogStart = options.headSubmerged ? 2 : options.nether ? 8 : FAR_PLANE * 0.55;
    gl.uniform2f(this.voxelUniforms.fogParams, fogStart, fogEnd);
    gl.uniform3fv(this.voxelUniforms.sunDirection, options.sunDirection);
    gl.uniform3fv(this.voxelUniforms.sunColor, options.sunColor);
    gl.uniform1f(this.voxelUniforms.ambient, options.headSubmerged ? 0.55 : options.nether ? 0.5 : 0.32 + 0.25 * options.daylight);
    gl.uniform2f(this.voxelUniforms.screenSize, this.canvas.width, this.canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasTexture);
    gl.uniform1i(this.voxelUniforms.atlas, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowDepthTex);
    gl.uniform1i(this.voxelUniforms.shadowMap, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.blurTex);
    gl.uniform1i(this.voxelUniforms.ssaoTex, 2);

    for (const chunk of visibleChunks) this.drawMesh(chunk.opaque);
    if (drawExtraOpaque) drawExtraOpaque();

    // Transparent pass (water, clouds-as-blocks if any, portals): depth-tested
    // against the opaque geometry above, but not depth-written, so overlapping
    // translucent surfaces blend instead of randomly occluding each other.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (const chunk of visibleChunks) this.drawMesh(chunk.transparent);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(null);

    // --- Underwater screen tint overlay ---
    if (options.headSubmerged) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.underwaterProgram);
      gl.bindVertexArray(this.emptyVao);
      gl.uniform3f(this.underwaterUniforms.tintColor, 0.05, 0.25, 0.45);
      gl.uniform1f(this.underwaterUniforms.strength, 0.35);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
    }

    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      Renderer.lastError = `WebGL error code ${error}`;
    }
  }

  get aspect(): number {
    return this.canvas.width / this.canvas.height;
  }
}
