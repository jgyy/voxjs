#version 300 es
precision highp float;

in vec3 vViewNormal;

out vec4 fragColor;

void main() {
  fragColor = vec4(normalize(vViewNormal) * 0.5 + 0.5, 1.0);
}
