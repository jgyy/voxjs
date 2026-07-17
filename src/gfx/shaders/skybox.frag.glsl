#version 300 es
precision highp float;

in vec2 vNdc;

uniform mat4 uInvViewProj;
uniform vec3 uSunDirection;

out vec4 fragColor;

void main() {
  // Reconstruct a world-space ray direction from NDC using the inverse
  // view-projection matrix. Because this is a continuous analytic gradient
  // (not a sampled cubemap), there are no seams/junctions to hide.
  vec4 nearPoint = uInvViewProj * vec4(vNdc, 0.0, 1.0);
  vec4 farPoint = uInvViewProj * vec4(vNdc, 1.0, 1.0);
  vec3 nearWorld = nearPoint.xyz / nearPoint.w;
  vec3 farWorld = farPoint.xyz / farPoint.w;
  vec3 dir = normalize(farWorld - nearWorld);

  vec3 horizon = vec3(0.75, 0.85, 0.95);
  vec3 zenith = vec3(0.25, 0.5, 0.9);
  float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = mix(horizon, zenith, pow(t, 0.6));

  float sunAmount = clamp(dot(dir, normalize(uSunDirection)), 0.0, 1.0);
  color += vec3(1.0, 0.95, 0.8) * pow(sunAmount, 256.0) * 1.5;
  color += vec3(1.0, 0.9, 0.6) * pow(sunAmount, 8.0) * 0.15;

  fragColor = vec4(color, 1.0);
}
