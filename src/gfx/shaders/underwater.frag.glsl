#version 300 es
precision highp float;

in vec2 vNdc;

uniform vec3 uTintColor;
uniform float uStrength;

out vec4 fragColor;

void main() {
  fragColor = vec4(uTintColor, uStrength);
}
