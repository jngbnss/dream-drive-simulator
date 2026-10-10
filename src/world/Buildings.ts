import * as THREE from 'three';
import type { MapBuilding, MapRoad } from './MapData';

const FACADE_BAY = 3.6 * 8;
const FACADE_FLOOR = 3.3 * 8;
const FACADES = ['#e9e6df', '#d8d2c6', '#c9c3b8', '#b8b4ad', '#dcd9d2', '#a7aeb5', '#c4b39b', '#9fb1bf', '#e0d6c8', '#8c96a0'];
const ROOFS = ['#5a5b5e', '#6b6c6f', '#4a4c50', '#76736d'];

/** 결정적 난수 (타일마다 항상 같은 건물 배치) */
export function rng(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * 도로를 따라 일반 빌딩 부지를 절차적으로 생성합니다 (실제 건물 데이터 대신).
 * 도로 영역과 이미 놓인 건물은 4m 격자로 점유 표시해 겹치지 않게 합니다.
 */
export function generateBuildings(roads: MapRoad[], tileX0: number, tileZ0: number, size: number, seed: number): MapBuilding[] {
  const rand = rng(seed);
  const CELL = 4;
  const N = Math.ceil(size / CELL);
  const occ = new Uint8Array(N * N);
  const mark = (x: number, z: number) => {
    const i = Math.floor((x - tileX0) / CELL), j = Math.floor((z - tileZ0) / CELL);
    if (i >= 0 && j >= 0 && i < N && j < N) occ[j * N + i] = 1;
  };
  const isOcc = (x: number, z: number) => {
    const i = Math.floor((x - tileX0) / CELL), j = Math.floor((z - tileZ0) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return true;
    return occ[j * N + i] === 1;
  };
  // 도로 + 보도 영역 점유
  let roadLen = 0;
  for (const r of roads) {
    const half = r.w / 2 + 3;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i] / 10, z1 = r.p[i + 1] / 10, x2 = r.p[i + 2] / 10, z2 = r.p[i + 3] / 10;
      const len = Math.hypot(x2 - x1, z2 - z1);
      roadLen += len;
      if (len < 0.01) continue;
      const nx = -(z2 - z1) / len, nz = (x2 - x1) / len;
      for (let d = 0; d <= len; d += CELL * 0.7) {
        const px = x1 + ((x2 - x1) * d) / len, pz = z1 + ((z2 - z1) * d) / len;
        for (let o = -half; o <= half; o += CELL * 0.7) mark(px + nx * o, pz + nz * o);
      }
    }
  }
  // 도로 밀도 → 도시화 정도 (0 = 교외, 1 = 도심)
  const density = Math.min(1, roadLen / ((size / 1000) ** 2 * 18000));
  if (density < 0.08) return [];

  const out: MapBuilding[] = [];
  const corners: [number, number][] = [[0, 0], [0, 0], [0, 0], [0, 0]];
  for (const r of roads) {
    if (r.c < 2 || r.c > 5 || r.b || r.t) continue;
    const major = r.c <= 3;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i] / 10, z1 = r.p[i + 1] / 10, x2 = r.p[i + 2] / 10, z2 = r.p[i + 3] / 10;
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 15) continue;
      const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
      const nx = -dz, nz = dx;
      for (const side of [-1, 1]) {
        let d = 4 + rand() * 6;
        while (d < len - 6) {
          const front = (major ? 16 : 11) + rand() * (major ? 22 : 12);
          const depth = (major ? 16 : 10) + rand() * (major ? 18 : 10);
          const setback = r.w / 2 + 4 + rand() * 3;
          const cx = x1 + dx * (d + front / 2) + nx * side * (setback + depth / 2);
          const cz = z1 + dz * (d + front / 2) + nz * side * (setback + depth / 2);
          d += front + 3 + rand() * 6;
          if (rand() > 0.35 + density * 0.6) continue;
          // 네 모서리 + 중심이 비어 있어야 배치
          const hf = front / 2, hd = depth / 2;
          corners[0] = [cx + dx * hf + nx * hd, cz + dz * hf + nz * hd];
          corners[1] = [cx - dx * hf + nx * hd, cz - dz * hf + nz * hd];
          corners[2] = [cx - dx * hf - nx * hd, cz - dz * hf - nz * hd];
          corners[3] = [cx + dx * hf - nx * hd, cz + dz * hf - nz * hd];
          if (isOcc(cx, cz) || corners.some(([x, z]) => isOcc(x, z))) continue;
          // 점유 표시 (내부 격자)
          for (let a = -hf; a <= hf; a += CELL * 0.7) for (let b = -hd; b <= hd; b += CELL * 0.7) mark(cx + dx * a + nx * b, cz + dz * a + nz * b);
          const tall = rand() < density * (major ? 0.5 : 0.25);
          const h = tall ? 40 + rand() * (major ? 90 : 50) * density : (major ? 12 : 8) + rand() * (major ? 30 : 16) * (0.4 + density);
          const p: number[] = [];
          for (const [x, z] of corners) p.push(Math.round(x * 10), Math.round(z * 10));
          out.push({ h: Math.round(h * 10) / 10, p, s: Math.floor(rand() * 1000) });
        }
      }
    }
  }
  return out;
}

export interface BuildingMeshes {
  walls: THREE.BufferGeometry;
  roofs: THREE.BufferGeometry;
  colliderVerts: Float32Array;
  colliderIdx: Uint32Array;
}

/** 건물 압출 (외벽 UV: 층·칸 반복, 초고층은 위로 갈수록 가늘게) */
export function buildBuildingGeometry(buildings: MapBuilding[]): BuildingMeshes {
  const wp: number[] = [], wn: number[] = [], wuv: number[] = [], wc: number[] = [], wi: number[] = [];
  const rp: number[] = [], rc: number[] = [], ri: number[] = [];
  const cp: number[] = [], ci: number[] = [];
  const col = new THREE.Color();
  for (const b of buildings) {
    const n = b.p.length / 2;
    let pts: [number, number][] = [];
    for (let i = 0; i < n; i++) pts.push([b.p[i * 2] / 10, b.p[i * 2 + 1] / 10]);
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
      area += x1 * z2 - x2 * z1;
    }
    if (area > 0) pts = pts.reverse();
    let mx = 0, mz = 0;
    for (const [x, z] of pts) { mx += x; mz += z; }
    mx /= n; mz /= n;
    const h = b.h, seed = b.s ?? 0, tall = h > 70;
    col.set(tall ? (seed % 3 === 0 ? '#8fa3b5' : '#aab7c2') : FACADES[seed % FACADES.length]);
    const taper = h > 400 ? 0.28 : h > 150 ? 0.82 : 1;
    const levels = taper < 1 ? 16 : 1;
    const ring = (lv: number) => {
      const f = lv / levels;
      const s = taper < 1 ? 1 - (1 - taper) * Math.pow(f, taper < 0.5 ? 1.6 : 1) : 1;
      return { y: f * h, pts: pts.map(([x, z]) => [mx + (x - mx) * s, mz + (z - mz) * s] as [number, number]) };
    };
    let lower = ring(0);
    lower.y = -0.5;
    for (let lv = 1; lv <= levels; lv++) {
      const upper = ring(lv);
      let perim = 0;
      for (let i = 0; i < n; i++) {
        const [ax, az] = lower.pts[i], [bx, bz] = lower.pts[(i + 1) % n];
        const [cx2, cz2] = upper.pts[i], [dx2, dz2] = upper.pts[(i + 1) % n];
        const len = Math.hypot(bx - ax, bz - az);
        const base = wp.length / 3;
        wp.push(ax, lower.y, az, bx, lower.y, bz, dx2, upper.y, dz2, cx2, upper.y, cz2);
        const nx = -(bz - az), nz = bx - ax;
        const nl = Math.hypot(nx, nz) || 1;
        for (let k = 0; k < 4; k++) wn.push(nx / nl, 0, nz / nl);
        const u0 = perim / FACADE_BAY, u1 = (perim + len) / FACADE_BAY;
        const v0 = Math.max(0, lower.y) / FACADE_FLOOR, v1 = upper.y / FACADE_FLOOR;
        wuv.push(u0, v0, u1, v0, u1, v1, u0, v1);
        for (let k = 0; k < 4; k++) wc.push(col.r, col.g, col.b);
        wi.push(base, base + 1, base + 2, base, base + 2, base + 3);
        perim += len;
      }
      lower = upper;
    }
    const top = lower;
    const tris = THREE.ShapeUtils.triangulateShape(top.pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
    const rbase = rp.length / 3;
    const roofC = new THREE.Color(tall ? '#3c4248' : ROOFS[seed % ROOFS.length]);
    for (const [x, z] of top.pts) { rp.push(x, top.y, z); rc.push(roofC.r, roofC.g, roofC.b); }
    for (const [a, b2, c] of tris) ri.push(rbase + a, rbase + c, rbase + b2);
    // 충돌용 낮은 벽
    const colH = Math.min(h, 6);
    const cb = cp.length / 3;
    for (const [x, z] of pts) cp.push(x, -0.5, z, x, colH, z);
    for (let i = 0; i < n; i++) {
      const a = cb + i * 2, b2 = cb + ((i + 1) % n) * 2;
      ci.push(a, b2, b2 + 1, a, b2 + 1, a + 1);
    }
  }
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  walls.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
  walls.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  walls.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  walls.setIndex(wi);
  walls.computeBoundingSphere();
  const roofs = new THREE.BufferGeometry();
  roofs.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  roofs.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  roofs.setIndex(ri);
  roofs.computeVertexNormals();
  roofs.computeBoundingSphere();
  return { walls, roofs, colliderVerts: new Float32Array(cp), colliderIdx: new Uint32Array(ci) };
}
