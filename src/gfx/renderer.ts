import { mat4, vec3 } from "gl-matrix";
import voxelShaderCode from "./shaders/voxel.wgsl?raw";
import skyboxShaderCode from "./shaders/skybox.wgsl?raw";
import { createTextureArray } from "./texture-atlas";
import { Camera } from "./camera";
import { Chunk } from "../world/chunk";
import { FAR_PLANE } from "../config";

const VOXEL_UNIFORM_SIZE = 4 * 16 + 16 + 16 + 16; // mat4 + cameraPos + fogColor + fogParams
const SKY_UNIFORM_SIZE = 4 * 16 + 16; // invViewProj + sunDirection

export class Renderer {
  static lastError: string | null = null;

  readonly device: GPUDevice;
  private context: GPUCanvasContext;
  private format: GPUTextureFormat;
  private canvas: HTMLCanvasElement;

  private depthTexture!: GPUTexture;
  private depthView!: GPUTextureView;

  private voxelPipeline!: GPURenderPipeline;
  private voxelUniformBuffer!: GPUBuffer;
  private voxelBindGroup!: GPUBindGroup;

  private skyPipeline!: GPURenderPipeline;
  private skyUniformBuffer!: GPUBuffer;
  private skyBindGroup!: GPUBindGroup;

  private sunDirection = vec3.normalize(vec3.create(), vec3.fromValues(0.4, 0.85, 0.3));

  private constructor(device: GPUDevice, context: GPUCanvasContext, format: GPUTextureFormat, canvas: HTMLCanvasElement) {
    this.device = device;
    this.context = context;
    this.format = format;
    this.canvas = canvas;
  }

  static async create(canvas: HTMLCanvasElement): Promise<Renderer> {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not supported in this browser.");
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No suitable GPUAdapter found.");
    const device = await adapter.requestDevice();
    device.lost.then((info) => {
      console.error("WebGPU device lost:", info.message);
    });
    device.addEventListener("uncapturederror", (event) => {
      const message = (event as GPUUncapturedErrorEvent).error.message;
      console.error("WebGPU validation error:", message);
      Renderer.lastError = message;
    });

    const context = canvas.getContext("webgpu");
    if (!context) throw new Error("Failed to acquire WebGPU canvas context.");
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "opaque" });

    const renderer = new Renderer(device, context, format, canvas);
    renderer.initResources();
    renderer.resize();
    return renderer;
  }

  private initResources(): void {
    const device = this.device;

    // --- Voxel pipeline ---
    const voxelModule = device.createShaderModule({ code: voxelShaderCode });
    const voxelBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float", viewDimension: "2d-array" } },
      ],
    });

    this.voxelPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [voxelBindGroupLayout] }),
      vertex: {
        module: voxelModule,
        entryPoint: "vs_main",
        buffers: [
          {
            arrayStride: 7 * 4,
            attributes: [
              { shaderLocation: 0, offset: 0, format: "float32x3" },
              { shaderLocation: 1, offset: 12, format: "float32" },
              { shaderLocation: 2, offset: 16, format: "float32x2" },
              { shaderLocation: 3, offset: 24, format: "float32" },
            ],
          },
        ],
      },
      fragment: {
        module: voxelModule,
        entryPoint: "fs_main",
        targets: [{ format: this.format }],
      },
      primitive: { topology: "triangle-list", cullMode: "back" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });

    this.voxelUniformBuffer = device.createBuffer({
      size: VOXEL_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const atlas = createTextureArray(device);
    const sampler = device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
      addressModeU: "repeat",
      addressModeV: "repeat",
    });

    this.voxelBindGroup = device.createBindGroup({
      layout: voxelBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.voxelUniformBuffer } },
        { binding: 1, resource: sampler },
        { binding: 2, resource: atlas.createView({ dimension: "2d-array" }) },
      ],
    });

    // --- Skybox pipeline ---
    const skyModule = device.createShaderModule({ code: skyboxShaderCode });
    const skyBindGroupLayout = device.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
    });
    this.skyPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [skyBindGroupLayout] }),
      vertex: { module: skyModule, entryPoint: "vs_main" },
      fragment: { module: skyModule, entryPoint: "fs_main", targets: [{ format: this.format }] },
      primitive: { topology: "triangle-list" },
      depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" },
    });
    this.skyUniformBuffer = device.createBuffer({
      size: SKY_UNIFORM_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.skyBindGroup = device.createBindGroup({
      layout: skyBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.skyUniformBuffer } }],
    });
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height && this.depthTexture) return;

    this.canvas.width = width;
    this.canvas.height = height;

    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      size: [width, height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
  }

  render(camera: Camera, chunks: Iterable<Chunk>): void {
    const device = this.device;

    const invViewProj = mat4.invert(mat4.create(), camera.getViewProjMatrix());
    const skyData = new Float32Array(SKY_UNIFORM_SIZE / 4);
    skyData.set(invViewProj as unknown as Float32Array, 0);
    skyData.set(this.sunDirection, 16);
    device.queue.writeBuffer(this.skyUniformBuffer, 0, skyData);

    const voxelData = new Float32Array(VOXEL_UNIFORM_SIZE / 4);
    voxelData.set(camera.getViewProjMatrix() as unknown as Float32Array, 0);
    voxelData.set([camera.position[0], camera.position[1], camera.position[2], 0], 16);
    voxelData.set([0.75, 0.85, 0.95, 1.0], 20); // fog color matches sky horizon
    voxelData.set([FAR_PLANE * 0.55, FAR_PLANE * 0.95, 0, 0], 24);
    device.queue.writeBuffer(this.voxelUniformBuffer, 0, voxelData);

    const encoder = device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();

    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    pass.setPipeline(this.skyPipeline);
    pass.setBindGroup(0, this.skyBindGroup);
    pass.draw(3);

    pass.setPipeline(this.voxelPipeline);
    pass.setBindGroup(0, this.voxelBindGroup);
    for (const chunk of chunks) {
      if (!chunk.vertexBuffer || !chunk.indexBuffer || chunk.indexCount === 0) continue;
      pass.setVertexBuffer(0, chunk.vertexBuffer);
      pass.setIndexBuffer(chunk.indexBuffer, "uint32");
      pass.drawIndexed(chunk.indexCount);
    }

    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  get aspect(): number {
    return this.canvas.width / this.canvas.height;
  }
}
