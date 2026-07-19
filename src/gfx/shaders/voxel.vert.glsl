#version 300 es

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aNormalIndex;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aLayer;

uniform mat4 uViewProj;
uniform mat4 uLightViewProj;

out vec2 vUv;
flat out int vLayer;
flat out int vNormalIndex;
out vec3 vWorldPos;
out vec4 vLightSpacePos;

void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  vUv = aUv;
  vLayer = int(aLayer);
  vNormalIndex = int(aNormalIndex);
  vWorldPos = aPosition;
  vLightSpacePos = uLightViewProj * vec4(aPosition, 1.0);
}
