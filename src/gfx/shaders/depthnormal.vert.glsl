#version 300 es

layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aNormalIndex;

uniform mat4 uView;
uniform mat4 uProj;

out vec3 vViewNormal;

// Index 6 = billboards (no single face normal); treated as facing the camera.
const vec3 NORMALS[7] = vec3[7](
  vec3(1.0, 0.0, 0.0),
  vec3(-1.0, 0.0, 0.0),
  vec3(0.0, 1.0, 0.0),
  vec3(0.0, -1.0, 0.0),
  vec3(0.0, 0.0, 1.0),
  vec3(0.0, 0.0, -1.0),
  vec3(0.0, 1.0, 0.0)
);

void main() {
  vec4 viewPos = uView * vec4(aPosition, 1.0);
  gl_Position = uProj * viewPos;
  mat3 normalMat = mat3(uView);
  vViewNormal = normalize(normalMat * NORMALS[int(aNormalIndex)]);
}
