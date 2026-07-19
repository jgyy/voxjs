#version 300 es
precision highp float;

in vec2 vWorldXZ;

uniform float uTime;
uniform vec3 uCameraPos;
uniform float uCloudExtent;

out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += valueNoise(p) * amp;
    p *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

void main() {
  vec2 drift = vec2(uTime * 1.5, uTime * 0.6);
  float n = fbm(vWorldXZ / 48.0 + drift * 0.02);
  float coverage = smoothstep(0.52, 0.78, n);

  // Fade the cloud sheet out near the edge of its finite quad so it doesn't
  // show a hard boundary against the sky.
  float edgeFade = 1.0 - smoothstep(0.7, 1.0, length(vWorldXZ - uCameraPos.xz) / uCloudExtent);

  float alpha = coverage * edgeFade * 0.75;
  if (alpha < 0.01) discard;
  fragColor = vec4(vec3(1.0), alpha);
}
