import * as THREE from 'three';

/**
 * 도로 재질: 차선·중앙선·정지 구간·횡단보도를 셰이더에서 절차적으로 그립니다 (텍스처·추가 메시 없음).
 * 정점 속성
 *  - aUvRoad: (가로 0..1, 세로 누적거리 m)
 *  - aRoad:   (차로 수, 일방통행, 폭 m, 횡단보도 여부)
 *  - aJunc:   (이전 교차점 거리, 다음 교차점 거리, 이전 교차 반경, 다음 교차 반경)
 */
export function createRoadMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec2 aUvRoad; attribute vec4 aRoad; attribute vec4 aJunc;
varying vec2 vUvRoad; varying vec4 vRoad; varying vec4 vJunc;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vUvRoad = aUvRoad; vRoad = aRoad; vJunc = aJunc;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vUvRoad; varying vec4 vRoad; varying vec4 vJunc;
float lineMask(float s, float center, float halfW) {
  float aa = fwidth(s) * 0.8 + 1e-4;
  return 1.0 - smoothstep(halfW - aa, halfW + aa, abs(s - center));
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  float lanes = vRoad.x;
  float W = vRoad.z;
  float s = vUvRoad.x * W;          // 왼쪽 가장자리로부터 거리
  float v = vUvRoad.y;              // 진행 방향 누적 거리
  // 아스팔트 질감
  float n = hash12(floor(vec2(s, v) * 6.0));
  diffuseColor.rgb *= 0.93 + n * 0.1;
  if (lanes > 0.5) {
    float dPrev = v - vJunc.x;
    float dNext = vJunc.y - v;
    float startP = vJunc.z + 1.0;
    float startN = vJunc.w + 1.0;
    bool inPrevZone = dPrev < startP + 6.5;
    bool inNextZone = dNext < startN + 6.5;
    vec3 white = vec3(0.86);
    vec3 yellow = vec3(0.88, 0.66, 0.12);
    float m = 0.0; vec3 col = white;
    // 횡단보도 (교차로 직전 3.5m 띠)
    float cw = 0.0;
    if (vRoad.w > 0.5) {
      if (dPrev > startP && dPrev < startP + 3.5) cw = 1.0;
      if (dNext > startN && dNext < startN + 3.5) cw = 1.0;
    }
    if (cw > 0.5) {
      float stripe = step(0.5, fract(s / 1.0));
      if (s > 0.4 && s < W - 0.4) m = stripe;
    } else if (!inPrevZone && !inNextZone) {
      float laneW = W / lanes;
      float dash = step(fract(v / 12.0), 0.42);
      // 가장자리 실선
      m = max(m, lineMask(s, 0.35, 0.075) + lineMask(s, W - 0.35, 0.075));
      if (vRoad.y < 0.5) {
        // 양방향: 노란 이중 중앙선 + 방향별 흰 점선
        float c = lineMask(s, W * 0.5 - 0.15, 0.07) + lineMask(s, W * 0.5 + 0.15, 0.07);
        if (lanes >= 2.0 && c > 0.0) { col = yellow; m = max(m, c); }
        float halfLanes = floor(lanes * 0.5 + 0.5);
        for (int i = 1; i < 7; i++) {
          float fi = float(i);
          if (fi < halfLanes) {
            m = max(m, dash * lineMask(s, fi * laneW, 0.075));
            m = max(m, dash * lineMask(s, W - fi * laneW, 0.075));
          }
        }
      } else {
        for (int i = 1; i < 12; i++) {
          float fi = float(i);
          if (fi < lanes) m = max(m, dash * lineMask(s, fi * laneW, 0.075));
        }
      }
    } else if (W > 6.0) {
      // 정지선 (교차로 쪽, 진행 방향 오른쪽 절반)
      bool stopN = dNext > startN + 3.8 && dNext < startN + 4.3 && (vRoad.y > 0.5 || s > W * 0.5);
      bool stopP = dPrev > startP + 3.8 && dPrev < startP + 4.3 && vRoad.y < 0.5 && s < W * 0.5;
      if (vRoad.w > 0.5 && (stopN || stopP)) m = 1.0;
    }
    diffuseColor.rgb = mix(diffuseColor.rgb, col, clamp(m, 0.0, 1.0) * 0.92);
  }
}`,
      );
  };
  mat.customProgramCacheKey = () => 'road-v1';
  return mat;
}
