#version 300 es

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aNormalIndex;
layout(location = 2) in vec2 aUv;
layout(location = 3) in float aLayer;

uniform mat4 uViewProj;

out vec2 vUv;
flat out int vLayer;
out float vShade;
out vec3 vWorldPos;

// Cheap fixed-direction "sun" shading per face, baked per normal so we avoid
// a full lighting pass — plenty for a blocky voxel look.
const float FACE_SHADE[6] = float[6](0.75, 0.55, 1.0, 0.4, 0.65, 0.5);

void main() {
  gl_Position = uViewProj * vec4(aPosition, 1.0);
  vUv = aUv;
  vLayer = int(aLayer);
  vShade = FACE_SHADE[int(aNormalIndex)];
  vWorldPos = aPosition;
}
