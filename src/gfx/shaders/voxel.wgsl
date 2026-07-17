struct Uniforms {
  viewProj: mat4x4<f32>,
  cameraPos: vec4<f32>,
  fogColor: vec4<f32>,
  fogParams: vec4<f32>, // x = fog start, y = fog end, z,w unused
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var atlasSampler: sampler;
@group(0) @binding(2) var atlasTexture: texture_2d_array<f32>;

struct VertexIn {
  @location(0) position: vec3<f32>,
  @location(1) normalIndex: f32,
  @location(2) uv: vec2<f32>,
  @location(3) layer: f32,
};

struct VertexOut {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) layer: u32,
  @location(2) shade: f32,
  @location(3) worldPos: vec3<f32>,
};

const NORMALS = array<vec3<f32>, 6>(
  vec3<f32>(1.0, 0.0, 0.0),
  vec3<f32>(-1.0, 0.0, 0.0),
  vec3<f32>(0.0, 1.0, 0.0),
  vec3<f32>(0.0, -1.0, 0.0),
  vec3<f32>(0.0, 0.0, 1.0),
  vec3<f32>(0.0, 0.0, -1.0),
);

// Cheap fixed-direction "sun" shading per face, baked per normal so we avoid
// a full lighting pass — plenty for a blocky voxel look.
const FACE_SHADE = array<f32, 6>(0.75, 0.55, 1.0, 0.4, 0.65, 0.5);

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
  var out: VertexOut;
  out.clipPosition = uniforms.viewProj * vec4<f32>(in.position, 1.0);
  out.uv = in.uv;
  out.layer = u32(in.layer);
  out.shade = FACE_SHADE[u32(in.normalIndex)];
  out.worldPos = in.position;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let texColor = textureSample(atlasTexture, atlasSampler, in.uv, in.layer);
  let lit = texColor.rgb * in.shade;

  let dist = length(in.worldPos - uniforms.cameraPos.xyz);
  let fogStart = uniforms.fogParams.x;
  let fogEnd = uniforms.fogParams.y;
  let fogFactor = clamp((dist - fogStart) / max(fogEnd - fogStart, 0.001), 0.0, 1.0);
  let finalColor = mix(lit, uniforms.fogColor.rgb, fogFactor);

  return vec4<f32>(finalColor, texColor.a);
}
