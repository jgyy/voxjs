#version 300 es

// A single huge quad centered under the camera at a fixed cloud altitude —
// V.1 allows clouds "as blocks ... or as shaders"; a shader plane is far
// cheaper than meshing real voxel geometry for a purely decorative layer.
layout(location = 0) in vec2 aUnit; // 0/1 quad corners

uniform mat4 uViewProj;
uniform vec3 uCameraPos;
uniform float uCloudY;
uniform float uCloudExtent;

out vec2 vWorldXZ;

void main() {
  vec2 worldXZ = uCameraPos.xz + (aUnit * 2.0 - 1.0) * uCloudExtent;
  vec3 worldPos = vec3(worldXZ.x, uCloudY, worldXZ.y);
  gl_Position = uViewProj * vec4(worldPos, 1.0);
  vWorldXZ = worldXZ;
}
