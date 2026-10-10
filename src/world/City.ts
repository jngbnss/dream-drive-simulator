import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { MapData, MapRoad } from './MapData';
import { createRoadMaterial } from './RoadMaterial';
import { makeFacadeTextures, makeGroundTexture } from './textures';

type Rapier = typeof RAPIER;

const CHUNK = 700;
const FACADE_BAY = 3.6 * 8;
const FACADE_FLOOR = 3.3 * 8;

/** 건물 외벽 색 팔레트 (서울 도심 톤: 화이트/베이지/그레이/유리) */
const FACADES = ['#e9e6df', '#d8d2c6', '#c9c3b8', '#b8b4ad', '#dcd9d2', '#a7aeb5', '#c4b39b', '#9fb1bf', '#e0d6c8', '#8c96a0'];
const ROOFS = ['#5a5b5e', '#6b6c6f', '#4a4c50', '#76736d'];

interface Seg { road: number; x1: number; z1: number; x2: number; z2: number }
interface Chunk { wp: number[]; wn: number[]; wuv: number[]; wc: number[]; wi: number[]; rp: number[]; rc: number[]; ri: number[]; cp: number[]; ci: number[] }
interface SignalLamps { red: THREE.InstancedMesh; yellow: THREE.InstancedMesh; green: THREE.InstancedMesh; phase: Float32Array }
export interface RoadHit { road: MapRoad; x: number; z: number; heading: number; dist: number }

/** OSM 기반 맵 데이터를 Three.js 메시와 Rapier 콜라이더로 변환합니다. */
export class City {
  readonly group = new THREE.Group();
  readonly facadeMaterial: THREE.MeshStandardMaterial;
  readonly waterMaterial: THREE.MeshStandardMaterial;
  private readonly grid = new Map<string, Seg[]>();
  private readonly signalLamps: SignalLamps | null;
  private lastSignalTick = -1;
  stats = { roads: 0, buildings: 0, trees: 0, signals: 0, triangles: 0, buildMs: 0 };

  constructor(readonly map: MapData, R: Rapier, world: RAPIER.World, onProgress: (f: number, label: string) => void) {
    const t0 = performance.now();
    this.group.name = 'City';
    const [minX, minZ, maxX, maxZ] = map.bounds;

    // ── 지면 ────────────────────────────────────────────
    const groundTex = makeGroundTexture();
    groundTex.repeat.set((maxX - minX + 2000) / 8, (maxZ - minZ + 2000) / 8);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(maxX - minX + 2000, maxZ - minZ + 2000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: groundTex, color: 0xb5b0a8, roughness: 0.95 }),
    );
    ground.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);
    world.createCollider(
      R.ColliderDesc.cuboid((maxX - minX) / 2 + 1000, 1, (maxZ - minZ) / 2 + 1000)
        .setTranslation((minX + maxX) / 2, -1, (minZ + maxZ) / 2)
        .setFriction(1.0),
    );
    // 맵 경계 벽
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, hx = (maxX - minX) / 2, hz = (maxZ - minZ) / 2;
    for (const [x, z, sx, sz] of [[cx, minZ, hx, 1], [cx, maxZ, hx, 1], [minX, cz, 1, hz], [maxX, cz, 1, hz]]) {
      world.createCollider(R.ColliderDesc.cuboid(sx, 10, sz).setTranslation(x, 10, z));
    }

    // ── 공원·물 ─────────────────────────────────────────
    onProgress(0.1, '공원과 한강');
    this.group.add(flatPolys(map.parks, 0.012, new THREE.MeshStandardMaterial({ color: 0x4f6b3a, roughness: 1 })));
    this.waterMaterial = new THREE.MeshStandardMaterial({ color: 0x24465c, roughness: 0.08, metalness: 0.35 });
    this.group.add(flatPolys(map.water, 0.016, this.waterMaterial));

    // ── 도로 ────────────────────────────────────────────
    onProgress(0.25, '도로와 차선');
    this.group.add(this.buildRoads(map.roads));

    // ── 건물 ────────────────────────────────────────────
    onProgress(0.5, '건물');
    const facade = makeFacadeTextures();
    this.facadeMaterial = new THREE.MeshStandardMaterial({
      map: facade.map, emissiveMap: facade.emissive, emissive: 0xffffff, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.7, metalness: 0.05,
    });
    this.buildBuildings(R, world, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));

    // ── 가로수 ──────────────────────────────────────────
    onProgress(0.8, '가로수');
    this.buildTrees(map, R, world);

    // ── 신호등 ──────────────────────────────────────────
    onProgress(0.9, '신호등');
    this.signalLamps = this.buildSignals(map);

    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      const idx = m.geometry.index;
      const n = idx ? idx.count / 3 : (m.geometry.getAttribute('position')?.count ?? 0) / 3;
      const inst = o as THREE.InstancedMesh;
      this.stats.triangles += n * (inst.isInstancedMesh ? inst.count : 1);
    });
    this.stats.buildMs = performance.now() - t0;
  }

  // ── 도로 메시 ───────────────────────────────────────────
  private buildRoads(roads: MapRoad[]): THREE.Mesh {
    // 교차점별 연결 도로
    const juncs = new Map<string, { roads: number[]; x: number; z: number }>();
    roads.forEach((r, ri) => {
      for (const j of r.j) {
        const k = `${r.p[j * 2]},${r.p[j * 2 + 1]}`;
        let e = juncs.get(k);
        if (!e) juncs.set(k, (e = { roads: [], x: r.p[j * 2] / 10, z: r.p[j * 2 + 1] / 10 }));
        if (!e.roads.includes(ri)) e.roads.push(ri);
      }
    });
    // 도로 A 기준: 교차 영역 반경 = 다른 도로 중 가장 넓은 폭의 절반
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
      const crosswalkRoad = r.c <= 4 && r.w >= 6;
      const y = 0.03 + (7 - r.c) * 0.004;
      const hw = r.w / 2;
      // 정점별 마이터 오프셋 (진행 방향 왼쪽)
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
        off.push([(tz * hw) / cos, (-tx * hw) / cos]);
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
    // 교차로 모서리 틈을 메우는 원판 (차선 없음, 도로 아래층)
    for (const [, e] of juncs) {
      if (e.roads.length < 2) continue;
      const ws = e.roads.map((ri) => roads[ri].w).sort((a, b) => b - a);
      const rad = ws[1] / 2 + 0.3;
      const y = 0.03 + (7 - Math.max(...e.roads.map((ri) => roads[ri].c))) * 0.004 - 0.002;
      const seg = 14;
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
    const mesh = new THREE.Mesh(g, createRoadMaterial());
    mesh.receiveShadow = true;
    this.stats.roads = roads.length;

    // 도로명·리셋용 공간 격자 (50m)
    roads.forEach((r, ri) => {
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const s: Seg = { road: ri, x1: r.p[i] / 10, z1: r.p[i + 1] / 10, x2: r.p[i + 2] / 10, z2: r.p[i + 3] / 10 };
        const gx0 = Math.floor(Math.min(s.x1, s.x2) / 50), gx1 = Math.floor(Math.max(s.x1, s.x2) / 50);
        const gz0 = Math.floor(Math.min(s.z1, s.z2) / 50), gz1 = Math.floor(Math.max(s.z1, s.z2) / 50);
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
          const k = `${gx},${gz}`;
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(s);
        }
      }
    });
    return mesh;
  }

  /** 가장 가까운 도로 위 지점 (큰 도로를 약간 우선) */
  nearestRoad(x: number, z: number, maxDist = 60): RoadHit | null {
    let best: RoadHit | null = null;
    let bestScore = Infinity;
    const r = Math.ceil(maxDist / 50);
    const gx = Math.floor(x / 50), gz = Math.floor(z / 50);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const list = this.grid.get(`${gx + i},${gz + j}`);
      if (!list) continue;
      for (const s of list) {
        const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / L2));
        const px = s.x1 + dx * t, pz = s.z1 + dz * t;
        const d = Math.hypot(px - x, pz - z);
        const road = this.map.roads[s.road];
        const score = d - (6 - road.c) * 0.5;
        if (d <= maxDist && score < bestScore) {
          bestScore = score;
          best = { road, x: px, z: pz, heading: Math.atan2(-dz, dx), dist: d };
        }
      }
    }
    return best;
  }

  // ── 건물 ────────────────────────────────────────────────
  private buildBuildings(R: Rapier, world: RAPIER.World, roofMat: THREE.Material) {
    const chunks = new Map<string, Chunk>();
    const col = new THREE.Color();
    for (const b of this.map.buildings) {
      const n = b.p.length / 2;
      let pts: [number, number][] = [];
      for (let i = 0; i < n; i++) pts.push([b.p[i * 2] / 10, b.p[i * 2 + 1] / 10]);
      // 위에서 볼 때 반시계 방향으로 정렬 (x-z 평면, z = 남쪽 → signed area < 0)
      let area = 0;
      for (let i = 0; i < n; i++) {
        const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % n];
        area += x1 * z2 - x2 * z1;
      }
      if (area > 0) pts = pts.reverse();
      let mx = 0, mz = 0;
      for (const [x, z] of pts) { mx += x; mz += z; }
      mx /= n; mz /= n;
      const key = `${Math.floor(mx / CHUNK)},${Math.floor(mz / CHUNK)}`;
      let ch = chunks.get(key);
      if (!ch) chunks.set(key, (ch = { wp: [], wn: [], wuv: [], wc: [], wi: [], rp: [], rc: [], ri: [], cp: [], ci: [] }));

      const h = b.h;
      const seed = b.s ?? 0;
      const tall = h > 70;
      col.set(tall ? (seed % 3 === 0 ? '#8fa3b5' : '#aab7c2') : FACADES[seed % FACADES.length]);
      // 초고층(롯데월드타워 등)은 위로 갈수록 가늘어지게
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
          const base = ch.wp.length / 3;
          ch.wp.push(ax, lower.y, az, bx, lower.y, bz, dx2, upper.y, dz2, cx2, upper.y, cz2);
          // 바깥쪽 법선 (반시계 외곽선의 오른쪽)
          const nx = -(bz - az), nz = bx - ax;
          const nl = Math.hypot(nx, nz) || 1;
          for (let k = 0; k < 4; k++) ch.wn.push(nx / nl, 0, nz / nl);
          const u0 = perim / FACADE_BAY, u1 = (perim + len) / FACADE_BAY;
          const v0 = Math.max(0, lower.y) / FACADE_FLOOR, v1 = upper.y / FACADE_FLOOR;
          ch.wuv.push(u0, v0, u1, v0, u1, v1, u0, v1);
          for (let k = 0; k < 4; k++) ch.wc.push(col.r, col.g, col.b);
          ch.wi.push(base, base + 1, base + 2, base, base + 2, base + 3);
          perim += len;
        }
        lower = upper;
      }
      // 지붕
      const top = lower;
      const tris = THREE.ShapeUtils.triangulateShape(top.pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
      const rbase = ch.rp.length / 3;
      const rc = new THREE.Color(tall ? '#3c4248' : ROOFS[seed % ROOFS.length]);
      for (const [x, z] of top.pts) {
        ch.rp.push(x, top.y, z);
        ch.rc.push(rc.r, rc.g, rc.b);
      }
      for (const [a, b2, c] of tris) ch.ri.push(rbase + a, rbase + c, rbase + b2);

      // 충돌용: 낮은 벽만 (차량 높이면 충분)
      const colH = Math.min(h, 6);
      const cb = ch.cp.length / 3;
      for (const [x, z] of pts) ch.cp.push(x, -0.5, z, x, colH, z);
      for (let i = 0; i < n; i++) {
        const a = cb + i * 2, b2 = cb + ((i + 1) % n) * 2;
        ch.ci.push(a, b2, b2 + 1, a, b2 + 1, a + 1);
      }
      this.stats.buildings++;
    }

    for (const [, c] of chunks) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(c.wp, 3));
      wg.setAttribute('normal', new THREE.Float32BufferAttribute(c.wn, 3));
      wg.setAttribute('uv', new THREE.Float32BufferAttribute(c.wuv, 2));
      wg.setAttribute('color', new THREE.Float32BufferAttribute(c.wc, 3));
      wg.setIndex(c.wi);
      wg.computeBoundingSphere();
      const walls = new THREE.Mesh(wg, this.facadeMaterial);
      walls.castShadow = true;
      walls.receiveShadow = true;
      this.group.add(walls);

      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(c.rp, 3));
      rg.setAttribute('color', new THREE.Float32BufferAttribute(c.rc, 3));
      rg.setIndex(c.ri);
      fixUpNormals(rg);
      rg.computeBoundingSphere();
      const roofs = new THREE.Mesh(rg, roofMat);
      roofs.castShadow = true;
      roofs.receiveShadow = true;
      this.group.add(roofs);

      if (c.ci.length) world.createCollider(R.ColliderDesc.trimesh(new Float32Array(c.cp), new Uint32Array(c.ci)).setFriction(0.3));
    }
  }

  // ── 가로수 ──────────────────────────────────────────────
  private buildTrees(map: MapData, R: Rapier, world: RAPIER.World) {
    const positions: number[] = [];
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const r of map.roads) {
      if (r.c < 2 || r.c > 4 || r.b) continue;
      const spacing = r.c === 2 ? 14 : 18;
      const P: [number, number][] = [];
      for (let i = 0; i < r.p.length; i += 2) P.push([r.p[i] / 10, r.p[i + 1] / 10]);
      const jset = new Set(r.j);
      let carry = spacing / 2;
      for (let i = 0; i < P.length - 1; i++) {
        const [x1, z1] = P[i], [x2, z2] = P[i + 1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (len < 1) continue;
        const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
        for (let d = carry; d < len; d += spacing) {
          if ((jset.has(i) && d < 18) || (jset.has(i + 1) && len - d < 18)) continue; // 교차로 근처는 비움
          const px = x1 + dx * d, pz = z1 + dz * d;
          const off = r.w / 2 + 1.6;
          const sides = r.o ? [1] : [-1, 1]; // 일방통행은 오른쪽만
          for (const s of sides) positions.push(px - dz * off * s, pz + dx * off * s, 0.85 + rand() * 0.35);
        }
        carry = (((carry - len) % spacing) + spacing) % spacing;
      }
    }
    // 공원 내부 나무
    for (const p of map.parks) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      const poly: [number, number][] = [];
      for (let i = 0; i < p.length; i += 2) {
        const x = p[i] / 10, z = p[i + 1] / 10;
        poly.push([x, z]);
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      const count = Math.min(400, Math.floor(((maxX - minX) * (maxZ - minZ)) / 260));
      for (let k = 0; k < count; k++) {
        const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ);
        if (pointInPoly(x, z, poly)) positions.push(x, z, 0.8 + rand() * 0.6);
      }
    }
    const count = positions.length / 3;
    this.stats.trees = count;
    if (!count) return;
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 3.2, 6).translate(0, 1.6, 0);
    const crownGeo = new THREE.IcosahedronGeometry(2.3, 1).scale(1, 1.25, 1).translate(0, 4.8, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3b2e, roughness: 1 }), count);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      const s = positions[i * 3 + 2];
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      m.compose(new THREE.Vector3(positions[i * 3], 0, positions[i * 3 + 1]), q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      c.setHSL(0.22 + rand() * 0.08, 0.45 + rand() * 0.2, 0.22 + rand() * 0.1);
      crowns.setColorAt(i, c);
    }
    trunks.castShadow = crowns.castShadow = true;
    crowns.receiveShadow = true;
    trunks.computeBoundingSphere();
    crowns.computeBoundingSphere();
    this.group.add(trunks, crowns);
    // 나무 기둥 충돌 (차가 통과하지 않도록)
    for (let i = 0; i < count; i++) {
      world.createCollider(R.ColliderDesc.cylinder(1.5, 0.25).setTranslation(positions[i * 3], 1.5, positions[i * 3 + 1]).setFriction(0.3));
    }
  }

  // ── 신호등 (가로형 3구: 적·황·녹) ───────────────────────
  private buildSignals(map: MapData): SignalLamps | null {
    const n = map.signals.length / 2;
    if (!n) return null;
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.15, 6, 8).translate(0, 3, 0);
    const armGeo = new THREE.BoxGeometry(0.12, 0.12, 1).translate(0, 0, 0.5);
    const headGeo = new THREE.BoxGeometry(0.35, 0.42, 1.25);
    const lampGeo = new THREE.CircleGeometry(0.14, 12);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x2e3135, roughness: 0.7, metalness: 0.4 });
    const poles = new THREE.InstancedMesh(poleGeo, darkMat, n);
    const arms = new THREE.InstancedMesh(armGeo, darkMat, n);
    const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6 }), n);
    const lampMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const red = new THREE.InstancedMesh(lampGeo, lampMat(), n);
    const yellow = new THREE.InstancedMesh(lampGeo, lampMat(), n);
    const green = new THREE.InstancedMesh(lampGeo, lampMat(), n);
    const phase = new Float32Array(n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), lq = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1), yAxis = new THREE.Vector3(0, 1, 0);
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const x = map.signals[i * 2] / 10, z = map.signals[i * 2 + 1] / 10;
      const near = this.nearestRoad(x, z, 25);
      if (!near) continue;
      const h = near.heading;
      const fx = Math.cos(h), fz = -Math.sin(h);
      const rx = -fz, rz = fx; // 진행 방향 오른쪽
      const half = near.road.w / 2 + 0.8;
      const px = near.x + rx * half, pz = near.z + rz * half;
      // 기둥은 도로 오른쪽, 팔은 도로 위(왼쪽)로, 램프는 다가오는 차를 향함
      const armLen = Math.min(near.road.w * 0.55, 9);
      q.setFromAxisAngle(yAxis, h + Math.PI); // 로컬 +Z → 진행 왼쪽
      m.compose(new THREE.Vector3(px, 0, pz), q, one);
      poles.setMatrixAt(placed, m);
      m.compose(new THREE.Vector3(px, 5.8, pz), q, new THREE.Vector3(1, 1, armLen));
      arms.setMatrixAt(placed, m);
      const hx = px - rx * (armLen - 0.8), hz = pz - rz * (armLen - 0.8);
      m.compose(new THREE.Vector3(hx, 5.55, hz), q, one);
      heads.setMatrixAt(placed, m);
      lq.setFromAxisAngle(yAxis, h - Math.PI / 2);
      // 운전자 기준 왼쪽부터 적·황·녹
      for (const [k, lm] of [[0.4, red], [0, yellow], [-0.4, green]] as [number, THREE.InstancedMesh][]) {
        m.compose(new THREE.Vector3(hx - fx * 0.18 - rx * k, 5.55, hz - fz * 0.18 - rz * k), lq, one);
        lm.setMatrixAt(placed, m);
      }
      phase[placed] = (Math.abs(fx) > Math.abs(fz) ? 0 : 0.5) + Math.abs((x * 0.013 + z * 0.007) % 0.05);
      placed++;
    }
    const off = new THREE.Color(0.06, 0.06, 0.06);
    for (const im of [poles, arms, heads, red, yellow, green]) {
      im.count = placed;
      im.computeBoundingSphere();
      this.group.add(im);
    }
    for (let i = 0; i < placed; i++) {
      red.setColorAt(i, off);
      yellow.setColorAt(i, off);
      green.setColorAt(i, off);
    }
    poles.castShadow = arms.castShadow = heads.castShadow = true;
    this.stats.signals = placed;
    return { red, yellow, green, phase };
  }

  /** 신호 주기: 녹색 22s → 황색 3s → 적색 25s (방향별 반대 위상) */
  update(time: number) {
    const s = this.signalLamps;
    if (!s) return;
    const tick = Math.floor(time * 4);
    if (tick === this.lastSignalTick) return;
    this.lastSignalTick = tick;
    const cycle = 50;
    const R = new THREE.Color(3, 0.15, 0.1), Y = new THREE.Color(3, 1.9, 0.1), G = new THREE.Color(0.1, 2.6, 1.2);
    const off = new THREE.Color(0.06, 0.06, 0.06);
    for (let i = 0; i < s.red.count; i++) {
      const t = ((time / cycle + s.phase[i]) % 1) * cycle;
      const st = t < 22 ? 2 : t < 25 ? 1 : 0;
      s.red.setColorAt(i, st === 0 ? R : off);
      s.yellow.setColorAt(i, st === 1 ? Y : off);
      s.green.setColorAt(i, st === 2 ? G : off);
    }
    for (const im of [s.red, s.yellow, s.green]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  setNight(night: boolean) {
    this.facadeMaterial.emissiveIntensity = night ? 0.9 : 0;
  }
}

function flatPolys(polys: number[][], y: number, mat: THREE.Material): THREE.Mesh {
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
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  return mesh;
}

function pointInPoly(x: number, z: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 평면 지오메트리의 법선이 위(+Y)를 향하도록 삼각형 방향을 보정 */
function fixUpNormals(g: THREE.BufferGeometry) {
  const idx = g.getIndex();
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  if (idx) {
    const arr = idx.array as Uint32Array | Uint16Array;
    for (let i = 0; i < arr.length; i += 3) {
      const a = arr[i], b = arr[i + 1], c = arr[i + 2];
      const abx = pos.getX(b) - pos.getX(a), abz = pos.getZ(b) - pos.getZ(a);
      const acx = pos.getX(c) - pos.getX(a), acz = pos.getZ(c) - pos.getZ(a);
      // (b-a) × (c-a) 의 y 성분 = abz*acx - abx*acz
      if (abz * acx - abx * acz < 0) {
        arr[i + 1] = c;
        arr[i + 2] = b;
      }
    }
    idx.needsUpdate = true;
  }
  g.computeVertexNormals();
}
