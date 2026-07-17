#version 300 es

// Fullscreen triangle, no vertex buffer needed.
const vec2 POSITIONS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2(3.0, -1.0),
  vec2(-1.0, 3.0)
);

out vec2 vNdc;

void main() {
  vec2 p = POSITIONS[gl_VertexID];
  gl_Position = vec4(p, 1.0, 1.0); // pinned to the far plane
  vNdc = p;
}
