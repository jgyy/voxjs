#version 300 es
precision highp float;
precision highp sampler2DArray;

in vec2 vUv;
flat in int vLayer;
in float vShade;
in vec3 vWorldPos;

uniform sampler2DArray uAtlas;
uniform vec3 uCameraPos;
uniform vec4 uFogColor;
uniform vec2 uFogParams; // x = fog start, y = fog end

out vec4 fragColor;

void main() {
  vec4 texColor = texture(uAtlas, vec3(vUv, float(vLayer)));
  vec3 lit = texColor.rgb * vShade;

  float dist = length(vWorldPos - uCameraPos);
  float fogFactor = clamp((dist - uFogParams.x) / max(uFogParams.y - uFogParams.x, 0.001), 0.0, 1.0);
  vec3 finalColor = mix(lit, uFogColor.rgb, fogFactor);

  fragColor = vec4(finalColor, texColor.a);
}
