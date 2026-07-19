#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;

in vec2 vUv;
flat in int vLayer;
flat in int vNormalIndex;
in vec3 vWorldPos;
in vec4 vLightSpacePos;

uniform sampler2DArray uAtlas;
uniform sampler2DShadow uShadowMap;
uniform sampler2D uSsaoTex;
uniform vec2 uScreenSize;

uniform vec3 uCameraPos;
uniform vec4 uFogColor;
uniform vec2 uFogParams; // x = fog start, y = fog end
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform float uAmbient;

out vec4 fragColor;

const vec3 NORMALS[7] = vec3[7](
  vec3(1.0, 0.0, 0.0),
  vec3(-1.0, 0.0, 0.0),
  vec3(0.0, 1.0, 0.0),
  vec3(0.0, -1.0, 0.0),
  vec3(0.0, 0.0, 1.0),
  vec3(0.0, 0.0, -1.0),
  vec3(0.0, 1.0, 0.0)
);

float sampleShadow() {
  vec3 proj = vLightSpacePos.xyz / vLightSpacePos.w;
  proj = proj * 0.5 + 0.5;
  if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0 || proj.z > 1.0) return 1.0;
  return texture(uShadowMap, vec3(proj.xy, proj.z - 0.0015));
}

void main() {
  vec4 texColor = texture(uAtlas, vec3(vUv, float(vLayer)));
  if (texColor.a < 0.05) discard;

  vec3 albedo = texColor.rgb;
  vec3 lit;

  if (vNormalIndex == 6) {
    // Billboards (plants): no single face normal, flat-shaded so they don't
    // pick up directionally-wrong lighting or self-shadow artifacts.
    lit = albedo * 0.9;
  } else {
    vec3 normal = NORMALS[vNormalIndex];
    float ndotl = max(dot(normal, normalize(uSunDirection)), 0.0);
    float shadow = sampleShadow();
    float ao = texture(uSsaoTex, gl_FragCoord.xy / uScreenSize).r;

    vec3 ambient = albedo * uAmbient * ao;
    vec3 diffuse = albedo * uSunColor * ndotl * shadow;
    lit = ambient + diffuse;
  }

  float dist = length(vWorldPos - uCameraPos);
  float fogFactor = clamp((dist - uFogParams.x) / max(uFogParams.y - uFogParams.x, 0.001), 0.0, 1.0);
  vec3 finalColor = mix(lit, uFogColor.rgb, fogFactor);

  fragColor = vec4(finalColor, texColor.a);
}
