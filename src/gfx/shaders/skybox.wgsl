struct SkyUniforms {
  invViewProj: mat4x4<f32>,
  sunDirection: vec4<f32>,
};

@group(0) @binding(0) var<uniform> sky: SkyUniforms;

struct VertexOut {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

// Fullscreen triangle, no vertex buffer needed.
@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VertexOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0),
  );
  var out: VertexOut;
  let p = positions[idx];
  out.clipPosition = vec4<f32>(p, 1.0, 1.0); // pinned to the far plane
  out.ndc = p;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  // Reconstruct a world-space ray direction from NDC using the inverse
  // view-projection matrix. Because this is a continuous analytic gradient
  // (not a sampled cubemap), there are no seams/junctions to hide.
  let nearPoint = sky.invViewProj * vec4<f32>(in.ndc, 0.0, 1.0);
  let farPoint = sky.invViewProj * vec4<f32>(in.ndc, 1.0, 1.0);
  let nearWorld = nearPoint.xyz / nearPoint.w;
  let farWorld = farPoint.xyz / farPoint.w;
  let dir = normalize(farWorld - nearWorld);

  let horizon = vec3<f32>(0.75, 0.85, 0.95);
  let zenith = vec3<f32>(0.25, 0.5, 0.9);
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  var color = mix(horizon, zenith, pow(t, 0.6));

  let sunAmount = clamp(dot(dir, normalize(sky.sunDirection.xyz)), 0.0, 1.0);
  color += vec3<f32>(1.0, 0.95, 0.8) * pow(sunAmount, 256.0) * 1.5;
  color += vec3<f32>(1.0, 0.9, 0.6) * pow(sunAmount, 8.0) * 0.15;

  return vec4<f32>(color, 1.0);
}
