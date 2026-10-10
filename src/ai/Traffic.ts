import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { MapData, MapRoad } from '../world/MapData';
import { roundedBox } from '../vehicle/model/geometry';

type Rapier = typeof RAPIER;

/**
 * 규칙 기반 교통 (머신러닝 없음 — docs/07-ai-features.md 결정 D-08)
 *  - 차선 추종: OSM 도로 폴리라인 + 우측통행 차로 오프셋
 *  - 차간 거리: IDM(Intelligent Driver Model)
 *  - 교차점(도로 끝)에서 연결된 다른 도로를 무작위 선택, 일방통행 준수
 *  - 플레이어 주변에서만 생성·소멸, 충돌은 키네마틱 바디
 */
const MAX_CARS = 70;
const SPAWN_MIN = 90;
const SPAWN_MAX = 420;
const DESPAWN = 520;

// IDM 파라미터
const A_MAX = 1.6; // m/s²
const B_COMF = 2.6;
const S0 = 3.2; // 최소 차간 거리 (m, 차량 앞-뒤 간격)
const T_HEAD = 1.3; // 시간 간격 (s)
const CAR_LEN = 4.6;

const SPEED_BY_CLASS = [80, 70, 55, 50, 40, 30, 40].map((k) => k / 3.6);
const COLORS = ['#f2f2f0', '#1b1c1f', '#8d9196', '#c7c9cc', '#23324a', '#6b1d22', '#3d4a3a', '#e8e4da', '#2c2d30', '#b8b2a6'];

interface Car {
  road: number;
  dir: 1 | -1;
  seg: number; // 현재 세그먼트 시작 인덱스 (dir 방향 기준)
  s: number; // 세그먼트 내 진행 거리
  lane: number;
  v: number;
  v0: number;
  x: number;
  z: number;
  heading: number;
  body: RAPIER.RigidBody;
  active: boolean;
}

export class Traffic {
  readonly group = new THREE.Group();
  private readonly cars: Car[] = [];
  private readonly nodes = new Map<string, { road: number; idx: number }[]>();
  private readonly spawnable: number[] = [];
  private readonly bodyMesh: THREE.InstancedMesh;
  private readonly darkMesh: THREE.InstancedMesh;
  private readonly lightMesh: THREE.InstancedMesh;
  private readonly lightMat: THREE.MeshBasicMaterial;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  enabled = true;

  constructor(private readonly map: MapData, R: Rapier, world: RAPIER.World) {
    map.roads.forEach((r, ri) => {
      const n = r.p.length / 2;
      for (const idx of new Set([0, n - 1, ...r.j])) {
        const k = `${r.p[idx * 2]},${r.p[idx * 2 + 1]}`;
        let list = this.nodes.get(k);
        if (!list) this.nodes.set(k, (list = []));
        list.push({ road: ri, idx });
      }
      if (r.c <= 4 && r.c !== 0 && !r.b && n >= 2) this.spawnable.push(ri);
    });

    // 교통 차량 모델 (단순화된 세단/SUV 실루엣)
    const body = roundedBox(4.5, 0.75, 1.8, 0.22);
    body.translate(0, 0.62, 0);
    const cabin = roundedBox(2.4, 0.6, 1.6, 0.25);
    cabin.translate(-0.25, 1.22, 0);
    const bodyGeo = mergeGeos([body, cabin]);
    const wheelGeos: THREE.BufferGeometry[] = [];
    for (const [x, z] of [[1.4, 0.82], [1.4, -0.82], [-1.4, 0.82], [-1.4, -0.82]]) {
      const w = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14).rotateX(Math.PI / 2);
      w.translate(x, 0.34, z);
      wheelGeos.push(w);
    }
    const glass = roundedBox(2.3, 0.45, 1.66, 0.2);
    glass.translate(-0.25, 1.25, 0);
    const darkGeo = mergeGeos([...wheelGeos, glass]);
    const lights: THREE.BufferGeometry[] = [];
    for (const z of [0.62, -0.62]) {
      lights.push(colorize(new THREE.BoxGeometry(0.06, 0.1, 0.36).translate(2.26, 0.78, z), 0xfff3dc));
      lights.push(colorize(new THREE.BoxGeometry(0.06, 0.1, 0.4).translate(-2.26, 0.85, z), 0xff1a1a));
    }
    const lightGeo = mergeGeos(lights);

    this.bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }), MAX_CARS);
    this.darkMesh = new THREE.InstancedMesh(darkGeo, new THREE.MeshStandardMaterial({ color: 0x0d0f12, roughness: 0.2, metalness: 0.3 }), MAX_CARS);
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.lightMesh = new THREE.InstancedMesh(lightGeo, this.lightMat, MAX_CARS);
    this.bodyMesh.castShadow = this.darkMesh.castShadow = true;
    for (const im of [this.bodyMesh, this.darkMesh, this.lightMesh]) {
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    const c = new THREE.Color();
    for (let i = 0; i < MAX_CARS; i++) {
      c.set(COLORS[i % COLORS.length]);
      this.bodyMesh.setColorAt(i, c);
      const rb = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100 - i * 5, 0));
      world.createCollider(R.ColliderDesc.cuboid(2.25, 0.7, 0.9).setTranslation(0, 0.75, 0).setFriction(0.5), rb);
      this.cars.push({ road: 0, dir: 1, seg: 0, s: 0, lane: 0, v: 0, v0: 10, x: 0, z: -1e5, heading: 0, body: rb, active: false });
    }
  }

  setNight(night: boolean) {
    this.lightMat.color.setScalar(night ? 2.2 : 0.9);
  }

  private pt(r: MapRoad, i: number): [number, number] {
    return [r.p[i * 2] / 10, r.p[i * 2 + 1] / 10];
  }

  /** dir 방향 기준 세그먼트의 시작·끝 점 */
  private segEnds(car: Car): [[number, number], [number, number]] {
    const r = this.map.roads[car.road];
    const n = r.p.length / 2;
    if (car.dir === 1) return [this.pt(r, car.seg), this.pt(r, car.seg + 1)];
    const a = n - 1 - car.seg;
    return [this.pt(r, a), this.pt(r, a - 1)];
  }

  private laneOffset(car: Car): number {
    const r = this.map.roads[car.road];
    const laneW = r.w / Math.max(1, r.l);
    if (r.o) return -r.w / 2 + (car.lane + 0.5) * laneW;
    return (car.lane + 0.5) * laneW;
  }

  private trySpawn(car: Car, px: number, pz: number): boolean {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ri = this.spawnable[(Math.random() * this.spawnable.length) | 0];
      const r = this.map.roads[ri];
      const n = r.p.length / 2;
      const seg = (Math.random() * (n - 1)) | 0;
      const [x1, z1] = this.pt(r, seg);
      const d = Math.hypot(x1 - px, z1 - pz);
      if (d < SPAWN_MIN || d > SPAWN_MAX) continue;
      car.road = ri;
      car.dir = r.o ? 1 : Math.random() < 0.5 ? 1 : -1;
      car.seg = car.dir === 1 ? seg : n - 2 - seg;
      car.s = 0;
      const lanes = r.o ? r.l : Math.max(1, Math.floor(r.l / 2));
      car.lane = (Math.random() * lanes) | 0;
      car.v0 = SPEED_BY_CLASS[r.c] * (0.85 + Math.random() * 0.25);
      car.v = car.v0 * 0.7;
      car.active = true;
      this.place(car, true);
      // 다른 차와 겹치면 취소
      for (const o of this.cars) {
        if (o !== car && o.active && Math.hypot(o.x - car.x, o.z - car.z) < 12) {
          car.active = false;
          break;
        }
      }
      if (car.active) return true;
    }
    return false;
  }

  /** 도로 끝에 도달 → 연결된 다음 도로 선택 */
  private advanceRoad(car: Car): boolean {
    const r = this.map.roads[car.road];
    const n = r.p.length / 2;
    const endIdx = car.dir === 1 ? n - 1 : 0;
    const k = `${r.p[endIdx * 2]},${r.p[endIdx * 2 + 1]}`;
    const options = (this.nodes.get(k) ?? []).filter((o) => o.road !== car.road && this.map.roads[o.road].c <= 5 && !this.map.roads[o.road].b);
    const choices: { road: number; dir: 1 | -1; seg: number }[] = [];
    for (const o of options) {
      const rr = this.map.roads[o.road];
      const m = rr.p.length / 2;
      if (o.idx < m - 1) choices.push({ road: o.road, dir: 1, seg: o.idx });
      if (!rr.o && o.idx > 0) choices.push({ road: o.road, dir: -1, seg: m - 1 - o.idx });
    }
    if (!choices.length) return false;
    // 큰 도로를 조금 더 선호
    choices.sort((a, b) => this.map.roads[a.road].c - this.map.roads[b.road].c + (Math.random() - 0.5) * 3);
    const ch = choices[0];
    const nr = this.map.roads[ch.road];
    car.road = ch.road;
    car.dir = ch.dir;
    car.seg = ch.seg;
    car.s = 0;
    const lanes = nr.o ? nr.l : Math.max(1, Math.floor(nr.l / 2));
    car.lane = Math.min(car.lane, lanes - 1);
    car.v0 = SPEED_BY_CLASS[nr.c] * (0.85 + Math.random() * 0.25);
    return true;
  }

  private place(car: Car, snapHeading = false) {
    const [[x1, z1], [x2, z2]] = this.segEnds(car);
    const len = Math.hypot(x2 - x1, z2 - z1) || 1;
    const dx = (x2 - x1) / len, dz = (z2 - z1) / len;
    const off = this.laneOffset(car);
    const t = Math.min(car.s, len);
    // 진행 방향 오른쪽 = (-dz, dx)
    car.x = x1 + dx * t - dz * off;
    car.z = z1 + dz * t + dx * off;
    const h = Math.atan2(-dz, dx);
    if (snapHeading) car.heading = h;
    else {
      const diff = Math.atan2(Math.sin(h - car.heading), Math.cos(h - car.heading));
      car.heading += diff * 0.18;
    }
  }

  fixedUpdate(dt: number, playerX: number, playerZ: number, playerVx: number, playerVz: number) {
    if (!this.enabled) return;
    let spawned = 0;
    for (const car of this.cars) {
      if (!car.active) {
        if (spawned < 2 && this.trySpawn(car, playerX, playerZ)) spawned++;
        continue;
      }
      if (Math.hypot(car.x - playerX, car.z - playerZ) > DESPAWN) {
        car.active = false;
        car.body.setNextKinematicTranslation({ x: 0, y: -100, z: 0 });
        continue;
      }
      // 앞차 찾기 (같은 방향, 진행 방향 앞쪽 콘 안)
      const fx = Math.cos(car.heading), fz = -Math.sin(car.heading);
      let gap = 1e9, leadV = 0;
      for (const o of this.cars) {
        if (o === car || !o.active) continue;
        const rx = o.x - car.x, rz = o.z - car.z;
        const ahead = rx * fx + rz * fz;
        if (ahead <= 0 || ahead > 70) continue;
        const lat = Math.abs(-rx * fz + rz * fx);
        if (lat > 1.8) continue;
        const ofx = Math.cos(o.heading), ofz = -Math.sin(o.heading);
        if (ofx * fx + ofz * fz < 0.3) continue; // 반대 방향 차는 무시
        if (ahead - CAR_LEN < gap) { gap = ahead - CAR_LEN; leadV = o.v; }
      }
      // 플레이어 차량도 앞차로 인식
      {
        const rx = playerX - car.x, rz = playerZ - car.z;
        const ahead = rx * fx + rz * fz;
        const lat = Math.abs(-rx * fz + rz * fx);
        if (ahead > 0 && ahead < 60 && lat < 2.2 && ahead - CAR_LEN < gap) {
          gap = ahead - CAR_LEN;
          leadV = Math.max(0, playerVx * fx + playerVz * fz);
        }
      }
      // IDM
      const v = car.v;
      let acc = A_MAX * (1 - Math.pow(v / car.v0, 4));
      if (gap < 1e8) {
        const sStar = S0 + v * T_HEAD + (v * (v - leadV)) / (2 * Math.sqrt(A_MAX * B_COMF));
        acc -= A_MAX * Math.pow(Math.max(0, sStar) / Math.max(0.5, gap), 2);
      }
      // 급커브 감속
      acc = Math.max(-8, acc);
      car.v = Math.max(0, v + acc * dt);
      car.s += car.v * dt;

      // 세그먼트/도로 진행
      let guard = 0;
      for (;;) {
        const [[x1, z1], [x2, z2]] = this.segEnds(car);
        const len = Math.hypot(x2 - x1, z2 - z1);
        if (car.s < len || guard++ > 8) break;
        car.s -= len;
        const n = this.map.roads[car.road].p.length / 2;
        if (car.seg + 1 < n - 1) car.seg++;
        else if (!this.advanceRoad(car)) {
          car.active = false;
          break;
        }
      }
      if (!car.active) {
        car.body.setNextKinematicTranslation({ x: 0, y: -100, z: 0 });
        continue;
      }
      this.place(car);
      this.q.setFromAxisAngle(this.up, car.heading);
      car.body.setNextKinematicTranslation({ x: car.x, y: 0, z: car.z });
      car.body.setNextKinematicRotation({ x: this.q.x, y: this.q.y, z: this.q.z, w: this.q.w });
    }
  }

  render() {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.active) {
        this.q.setFromAxisAngle(this.up, car.heading);
        this.m.makeRotationFromQuaternion(this.q).setPosition(car.x, 0, car.z);
      } else this.m.copy(this.hidden);
      this.bodyMesh.setMatrixAt(i, this.m);
      this.darkMesh.setMatrixAt(i, this.m);
      this.lightMesh.setMatrixAt(i, this.m);
    }
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    this.darkMesh.instanceMatrix.needsUpdate = true;
    this.lightMesh.instanceMatrix.needsUpdate = true;
  }

  get activeCount(): number {
    return this.cars.filter((c) => c.active).length;
  }
}

function colorize(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const ni = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const hasColor = ni.every((g) => g.getAttribute('color'));
  let total = 0;
  for (const g of ni) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
  const col = hasColor ? new Float32Array(total * 3) : null;
  let o = 0;
  for (const g of ni) {
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], (o + i) * 3);
      nor.set([n.getX(i), n.getY(i), n.getZ(i)], (o + i) * 3);
      if (col) {
        const c = g.getAttribute('color');
        col.set([c.getX(i), c.getY(i), c.getZ(i)], (o + i) * 3);
      }
    }
    o += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
