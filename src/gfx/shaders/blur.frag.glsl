#version 300 es
precision highp float;

in vec2 vNdc;

uniform sampler2D uSourceTex;
uniform vec2 uTexelSize;

out vec4 fragColor;

void main() {
  vec2 uv = vNdc * 0.5 + 0.5;
  float result = 0.0;
  for (int x = -2; x < 2; x++) {
    for (int y = -2; y < 2; y++) {
      result += texture(uSourceTex, uv + vec2(float(x), float(y)) * uTexelSize).r;
    }
  }
  fragColor = vec4(vec3(result / 16.0), 1.0);
}
