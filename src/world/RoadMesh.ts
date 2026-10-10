import * as THREE from 'three';
import type { MapRoad } from './MapData';

/**
 * 도로 리본 메시 생성. 차선·횡단보도는 RoadMaterial 셰이더가 정점 속성으로 그립니다.
 * 교차점 반경은 같은 메시에 포함된 도로들끼리만 계산합니다(타일 경계에서는 근사).
 */
export function buildRoadGeometry(roads: MapRoad[]): THREE.BufferGeometry {
  const juncs = new Map<string, { roads: number[]; x: number; z: number }>();
  roads.forEach((r, ri) => {
    for (const j of r.j) {
      const k = `${r.p[j * 2]},${r.p[j * 2 + 1]}`;
      let e = juncs.get(k);
      if (!e) juncs.set(k, (e = { roads: [], x: r.p[j * 2] / 10, z: r.p[j * 2 + 1] / 10 }));
      if (!e.roads.includes(ri)) e.roads.push(ri);
    }
  });
  // 도로 A 기준 교차 영역 반경 = 다른 도로 중 가장 넓은 폭의 절반
  const juncInfo = (ri: number, k: string) => {
    const e = juncs.get(k);
    let otherW = 0, otherC = 9;
    if (e) for (const o of e.roads) if (o !== ri) { otherW = Math.max(otherW, roads[o].w); otherC = Math.min(otherC, roads[o].c); }
    return { radius: otherW / 2, crossing: otherC <= 4 };
  };

  const pos: number[] = [], uvr: number[] = [], attr: number[] = [], junc: number[] = [], idx: number[] = [];
  roads.forEach((r, ri) => {
    const n = r.p.length / 2;
    if (n < 2) return;
    const P: [number, number][] = [];
    for (let i = 0; i < n; i++) P.push([r.p[i * 2] / 10, r.p[i * 2 + 1] / 10]);
    const dist = [0];
    for (let i = 1; i < n; i++) dist.push(dist[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const jd = r.j.map((j) => {
      const info = juncInfo(ri, `${r.p[j * 2]},${r.p[j * 2 + 1]}`);
      return { d: dist[j], r: info.radius, cw: info.crossing };
    });
    const crosswalkRoad = r.c <= 4 && r.w >= 6 && !r.b;
    // 높은 등급이 위에 그려지도록 높이를 조금씩 다르게
    const y = 0.03 + (7 - r.c) * 0.004 + (r.b ? 0.01 : 0);
    const hw = r.w / 2;
    const off: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[i], c = P[Math.min(n - 1, i + 1)];
      let d1x = b[0] - a[0], d1z = b[1] - a[1];
      let d2x = c[0] - b[0], d2z = c[1] - b[1];
      const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
      d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
      if (i === 0) { d1x = d2x; d1z = d2z; }
      if (i === n - 1) { d2x = d1x; d2z = d1z; }
      let tx = d1x + d2x, tz = d1z + d2z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl; tz /= tl;
      const cos = Math.max(0.5, tx * d2x + tz * d2z);
      off.push([(tz * hw) / cos, (-tx * hw) / cos]); // 진행 방향 왼쪽
    }
    for (let i = 0; i < n - 1; i++) {
      let prevJ = -1e6, nextJ = 1e6, prevR = 0, nextR = 0, cwP = false, cwN = false;
      for (const j of jd) {
        if (j.d <= dist[i] + 1e-3 && j.d > prevJ) { prevJ = j.d; prevR = j.r; cwP = j.cw; }
        if (j.d >= dist[i + 1] - 1e-3 && j.d < nextJ) { nextJ = j.d; nextR = j.r; cwN = j.cw; }
      }
      const cw = crosswalkRoad && (cwP || cwN) ? 1 : 0;
      const base = pos.length / 3;
      for (const k of [i, i + 1]) {
        pos.push(P[k][0] + off[k][0], y, P[k][1] + off[k][1]);
        pos.push(P[k][0] - off[k][0], y, P[k][1] - off[k][1]);
        uvr.push(0, dist[k], 1, dist[k]);
        for (let t = 0; t < 2; t++) {
          attr.push(r.l, r.o, r.w, cw);
          junc.push(prevJ, nextJ, prevR, nextR);
        }
      }
      idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  });
  // 교차로 모서리 틈 메우기
  for (const [, e] of juncs) {
    if (e.roads.length < 2) continue;
    const ws = e.roads.map((ri) => roads[ri].w).sort((a, b) => b - a);
    const rad = ws[1] / 2 + 0.3;
    const y = 0.03 + (7 - Math.max(...e.roads.map((ri) => roads[ri].c))) * 0.004 - 0.002;
    const seg = 12;
    const base = pos.length / 3;
    pos.push(e.x, y, e.z);
    uvr.push(0.5, 0);
    attr.push(0, 0, 1, 0);
    junc.push(0, 0, 0, 0);
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      pos.push(e.x + Math.cos(a) * rad, y, e.z + Math.sin(a) * rad);
      uvr.push(0.5, 0);
      attr.push(0, 0, 1, 0);
      junc.push(0, 0, 0, 0);
      if (s > 0) idx.push(base, base + s + 1, base + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUvRoad', new THREE.Float32BufferAttribute(uvr, 2));
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(attr, 4));
  g.setAttribute('aJunc', new THREE.Float32BufferAttribute(junc, 4));
  g.setIndex(idx);
  fixUpNormals(g);
  g.computeBoundingSphere();
  return g;
}

/** 평면 폴리곤(물·공원) 지오메트리 */
export function buildFlatPolygons(polys: number[][], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const p of polys) {
    const contour: THREE.Vector2[] = [];
    for (let i = 0; i < p.length; i += 2) contour.push(new THREE.Vector2(p[i] / 10, p[i + 1] / 10));
    if (contour.length < 3) continue;
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = pos.length / 3;
    for (const v of contour) pos.push(v.x, y, v.y);
    for (const [a, b, c] of tris) idx.push(base + a, base + c, base + b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  fixUpNormals(g);
  g.computeBoundingSphere();
  return g;
}

/** 평면 지오메트리의 법선이 위(+Y)를 향하도록 삼각형 방향 보정 */
export function fixUpNormals(g: THREE.BufferGeometry) {
  const idx = g.getIndex();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (idx) {
    const arr = idx.array as Uint32Array | Uint16Array;
    for (let i = 0; i < arr.length; i += 3) {
      const a = arr[i], b = arr[i + 1], c = arr[i + 2];
      const abx = pos.getX(b) - pos.getX(a), abz = pos.getZ(b) - pos.getZ(a);
      const acx = pos.getX(c) - pos.getX(a), acz = pos.getZ(c) - pos.getZ(a);
      if (abz * acx - abx * acz < 0) {
        arr[i + 1] = c;
        arr[i + 2] = b;
      }
    }
    idx.needsUpdate = true;
  }
  g.computeVertexNormals();
}
