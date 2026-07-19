#version 300 es
precision highp float;

in vec2 vNdc;

uniform sampler2D uDepthTex;
uniform sampler2D uNormalTex;
uniform mat4 uProj;
uniform mat4 uInvProj;
uniform vec3 uKernel[16];
uniform float uRadius;

out vec4 fragColor;

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

vec3 viewPosFromDepth(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 viewPos = uInvProj * ndc;
  return viewPos.xyz / viewPos.w;
}

void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  float depth = texture(uDepthTex, uv).r;
  if (depth >= 0.9999) {
    fragColor = vec4(1.0);
    return;
  }

  vec3 viewPos = viewPosFromDepth(uv, depth);
  vec3 normal = normalize(texture(uNormalTex, uv).xyz * 2.0 - 1.0);

  float angle = rand(uv) * 6.2831853;
  vec3 randomVec = vec3(cos(angle), sin(angle), 0.0);
  vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
  vec3 bitangent = cross(normal, tangent);
  mat3 tbn = mat3(tangent, bitangent, normal);

  float bias = 0.035;
  float occlusion = 0.0;
  for (int i = 0; i < 16; i++) {
    vec3 samplePos = viewPos + (tbn * uKernel[i]) * uRadius;

    vec4 offset = uProj * vec4(samplePos, 1.0);
    offset.xyz /= offset.w;
    offset.xy = offset.xy * 0.5 + 0.5;
    if (offset.x < 0.0 || offset.x > 1.0 || offset.y < 0.0 || offset.y > 1.0) continue;

    float sampleDepth = texture(uDepthTex, offset.xy).r;
    vec3 sampledViewPos = viewPosFromDepth(offset.xy, sampleDepth);

    float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(1e-4, abs(viewPos.z - sampledViewPos.z)));
    occlusion += (sampledViewPos.z >= samplePos.z + bias ? 1.0 : 0.0) * rangeCheck;
  }

  float ao = 1.0 - occlusion / 16.0;
  fragColor = vec4(vec3(ao), 1.0);
}
