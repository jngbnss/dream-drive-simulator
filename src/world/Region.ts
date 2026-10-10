import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { MapBuilding, MapRoad } from './MapData';
import { createRoadMaterial } from './RoadMaterial';
import { makeFacadeTextures, makeGroundTexture } from './textures';
import { GRID_CELL, type GeoPack, type TileRequest, type TileResult } from './tileWorker';

type Rapier = typeof RAPIER;

export interface RegionIndex {
  version: number;
  name: string;
  origin: { lat: number; lon: number };
  tileSize: number;
  bounds: [number, number, number, number];
  tiles: [number, number, number][];
  attribution: string;
}

interface Tile {
  key: string;
  ix: number;
  iz: number;
  state: 'loading' | 'ready' | 'built';
  result?: TileResult;
  group?: THREE.Group;
  collider?: RAPIER.Collider;
  /** forEachSegment 중복 방지용 */
  stamp?: Uint32Array;
}

export type SegCallback = (road: MapRoad, x1: number, z1: number, x2: number, z2: number) => void;
export interface RoadHit { road: MapRoad; x: number; z: number; heading: number; dist: number }

/** 랜드마크 (실제 위치·높이) */
const LANDMARKS: { name: string; lat: number; lon: number; w: number; d: number; h: number }[] = [
  { name: '롯데월드타워', lat: 37.5125, lon: 127.1025, w: 72, d: 72, h: 555 },
  { name: '63빌딩', lat: 37.5198, lon: 126.9403, w: 62, d: 30, h: 249 },
  { name: '파크원', lat: 37.5262, lon: 126.9283, w: 50, d: 40, h: 333 },
];

const LOAD_RADIUS = 5200; // m: 이 안의 타일을 불러옴
const UNLOAD_RADIUS = 7600;
const COLLIDER_RADIUS = 1400; // m: 이 안의 타일만 건물 충돌체 생성 (멀리 있는 건 부딪힐 일이 없음)

/**
 * 서울·경기 타일 스트리밍
 *  - 내려받기·파싱·지오메트리·충돌 메시·도로 검색 격자 계산은 Web Worker에서 (메인 스레드 끊김 방지)
 *  - 메인 스레드는 프레임당 타일 1개만 화면에 붙이고, 건물 충돌체는 차가 가까워질 때 지연 생성
 */
export class Region {
  readonly group = new THREE.Group();
  readonly tileSize: number;
  private readonly tiles = new Map<string, Tile>();
  private readonly available: Set<string>;
  private readonly roadMat = createRoadMaterial();
  private readonly waterMat = new THREE.MeshStandardMaterial({ color: 0x24465c, roughness: 0.08, metalness: 0.35 });
  private readonly facadeMat: THREE.MeshStandardMaterial;
  private readonly roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  private readonly ground: THREE.Mesh;
  private readonly buildQueue: Tile[] = [];
  private inflight = 0;
  private readonly workers: Worker[] = [];
  private nextWorker = 0;
  private readonly landmarks: { x: number; z: number; b: MapBuilding }[] = [];
  private stampId = 0;
  stats = { loaded: 0, buildMs: 0, maxBuildMs: 0, maxColliderMs: 0, buildings: 0, roads: 0 };

  constructor(readonly index: RegionIndex, private readonly baseUrl: string, private readonly R: Rapier, private readonly world: RAPIER.World) {
    this.tileSize = index.tileSize;
    this.available = new Set(index.tiles.map(([x, z]) => `${x}_${z}`));
    this.group.name = 'Region';
    const workerCount = Math.min(2, Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1));
    for (let i = 0; i < workerCount; i++) {
      const w = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module' });
      w.onmessage = this.onWorkerResult;
      this.workers.push(w);
    }
    const facade = makeFacadeTextures();
    this.facadeMat = new THREE.MeshStandardMaterial({
      map: facade.map, emissiveMap: facade.emissive, emissive: 0xffffff, emissiveIntensity: 0,
      vertexColors: true, roughness: 0.7, metalness: 0.05,
    });
    // 지면: 차를 따라 움직이는 큰 평면 (텍스처는 월드 좌표에 고정)
    const tex = makeGroundTexture();
    tex.repeat.set(16000 / 8, 16000 / 8);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, color: 0xb5b0a8, roughness: 0.95 }));
    this.ground.receiveShadow = true;
    this.group.add(this.ground);
    const [minX, minZ, maxX, maxZ] = index.bounds;
    world.createCollider(
      R.ColliderDesc.cuboid((maxX - minX) / 2 + 2000, 1, (maxZ - minZ) / 2 + 2000).setTranslation((minX + maxX) / 2, -1, (minZ + maxZ) / 2).setFriction(1),
    );
    for (const l of LANDMARKS) {
      const [x, z] = this.project(l.lat, l.lon);
      const p: number[] = [];
      for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) p.push(Math.round((x + (sx * l.w) / 2) * 10), Math.round((z + (sz * l.d) / 2) * 10));
      this.landmarks.push({ x, z, b: { h: l.h, p, s: 3 } });
    }
  }

  static async load(baseUrl: string, R: Rapier, world: RAPIER.World): Promise<Region> {
    const res = await fetch(`${baseUrl}index.json`);
    if (!res.ok) throw new Error(`지역 데이터를 불러오지 못했습니다 (${res.status})`);
    return new Region(await res.json(), baseUrl, R, world);
  }

  /** 위경도 → 로컬 좌표 (m) */
  project(lat: number, lon: number): [number, number] {
    const o = this.index.origin;
    return [(lon - o.lon) * 111_320 * Math.cos((o.lat * Math.PI) / 180), -(lat - o.lat) * 110_950];
  }

  /** 로컬 좌표 → 위경도 */
  unproject(x: number, z: number): [number, number] {
    const o = this.index.origin;
    return [o.lat - z / 110_950, o.lon + x / (111_320 * Math.cos((o.lat * Math.PI) / 180))];
  }

  private tileDist(t: { ix: number; iz: number }, x: number, z: number): number {
    const ts = this.tileSize;
    const dx = Math.max(0, Math.abs((t.ix + 0.5) * ts - x) - ts / 2);
    const dz = Math.max(0, Math.abs((t.iz + 0.5) * ts - z) - ts / 2);
    return Math.hypot(dx, dz);
  }

  /** 매 프레임: 필요한 타일 요청·부착·해제 (작업은 프레임당 하나씩만) */
  update(x: number, z: number) {
    this.ground.position.set(Math.round(x / 8) * 8, 0, Math.round(z / 8) * 8);
    const ts = this.tileSize;
    const cx = Math.floor(x / ts), cz = Math.floor(z / ts);
    const r = Math.ceil(LOAD_RADIUS / ts);
    const want: { key: string; ix: number; iz: number; d: number }[] = [];
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const ix = cx + i, iz = cz + j;
      const key = `${ix}_${iz}`;
      if (!this.available.has(key) || this.tiles.has(key)) continue;
      const d = this.tileDist({ ix, iz }, x, z);
      if (d < LOAD_RADIUS - ts / 2) want.push({ key, ix, iz, d });
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      if (this.inflight >= this.workers.length * 2) break;
      this.request(w.key, w.ix, w.iz);
    }
    let workDone = false;
    for (const t of this.tiles.values()) {
      const d = this.tileDist(t, x, z);
      if (d > UNLOAD_RADIUS - ts / 2 && t.state !== 'loading') this.unload(t);
      else if (!workDone && t.state === 'built' && !t.collider && d < COLLIDER_RADIUS && t.result?.colliderIdx?.length) {
        const tc = performance.now();
        t.collider = this.world.createCollider(this.R.ColliderDesc.trimesh(t.result.colliderVerts!, t.result.colliderIdx).setFriction(0.3));
        this.stats.maxColliderMs = Math.max(this.stats.maxColliderMs, performance.now() - tc);
        workDone = true;
      }
    }
    if (!workDone && this.buildQueue.length) {
      this.buildQueue.sort((a, b) => this.tileDist(a, x, z) - this.tileDist(b, x, z));
      const t = this.buildQueue.shift()!;
      if (this.tiles.get(t.key) === t) this.build(t);
    }
  }

  /** 주변 타일이 모두 준비될 때까지 기다림 (출발 위치 이동 시) */
  async ready(x: number, z: number, radius = 1500): Promise<void> {
    for (let guard = 0; guard < 900; guard++) {
      this.update(x, z);
      let pending = false;
      for (const key of this.available) {
        const [ix, iz] = key.split('_').map(Number);
        if (this.tileDist({ ix, iz }, x, z) > radius) continue;
        const t = this.tiles.get(key);
        if (!t || t.state !== 'built' || (this.tileDist(t, x, z) < COLLIDER_RADIUS && t.result?.colliderIdx?.length && !t.collider)) pending = true;
      }
      if (!pending) return;
      await new Promise((r) => setTimeout(r, 16));
    }
  }

  private request(key: string, ix: number, iz: number) {
    const t: Tile = { key, ix, iz, state: 'loading' };
    this.tiles.set(key, t);
    this.inflight++;
    const worker = this.workers[this.nextWorker++ % this.workers.length];
    const req: TileRequest = {
      key, ix, iz, tileSize: this.tileSize,
      url: new URL(`${this.baseUrl}tiles/${key}.json`, location.href).href,
      landmarks: this.landmarks,
    };
    worker.postMessage(req);
  }

  private onWorkerResult = (e: MessageEvent<TileResult>) => {
    this.inflight--;
    const res = e.data;
    const t = this.tiles.get(res.key);
    if (!t || t.state !== 'loading') return;
    if (!res.ok) {
      this.tiles.delete(res.key);
      return;
    }
    t.result = res;
    t.state = 'ready';
    this.buildQueue.push(t);
  };

  /** 워커가 만든 배열을 메시로 감싸 장면에 붙임 (가벼운 작업만) */
  private build(t: Tile) {
    const t0 = performance.now();
    const res = t.result!;
    const g = new THREE.Group();
    g.name = `tile_${t.key}`;
    if (res.road) {
      const roads = new THREE.Mesh(unpack(res.road), this.roadMat);
      roads.receiveShadow = true;
      g.add(roads);
    }
    if (res.water) {
      const water = new THREE.Mesh(unpack(res.water), this.waterMat);
      water.receiveShadow = true;
      g.add(water);
    }
    if (res.walls && res.roofs) {
      const walls = new THREE.Mesh(unpack(res.walls), this.facadeMat);
      const roofs = new THREE.Mesh(unpack(res.roofs), this.roofMat);
      walls.castShadow = walls.receiveShadow = roofs.castShadow = roofs.receiveShadow = true;
      g.add(walls, roofs);
    }
    t.stamp = new Uint32Array(res.segRoad?.length ?? 0);
    t.group = g;
    t.state = 'built';
    this.group.add(g);
    this.stats.loaded++;
    this.stats.buildings += res.buildings;
    this.stats.roads += res.roads?.length ?? 0;
    this.stats.buildMs = performance.now() - t0;
    this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, this.stats.buildMs);
  }

  private unload(t: Tile) {
    this.tiles.delete(t.key);
    if (t.group) {
      this.group.remove(t.group);
      t.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    if (t.collider) this.world.removeCollider(t.collider, false);
    if (t.result) this.stats.buildings -= t.result.buildings;
    const qi = this.buildQueue.indexOf(t);
    if (qi >= 0) this.buildQueue.splice(qi, 1);
  }

  get tileCount(): number {
    let n = 0;
    for (const t of this.tiles.values()) if (t.state === 'built') n++;
    return n;
  }

  /** 반경 안의 도로 세그먼트 순회 (타일별 로컬 격자 사용) */
  forEachSegment(x: number, z: number, radius: number, cb: SegCallback) {
    const ts = this.tileSize;
    const C = Math.ceil(ts / GRID_CELL);
    const stamp = ++this.stampId;
    for (const t of this.tiles.values()) {
      const res = t.result;
      if (t.state !== 'built' || !res?.cellStart || !res.segs || !res.roads) continue;
      if (this.tileDist(t, x, z) > radius) continue;
      const x0 = t.ix * ts, z0 = t.iz * ts;
      const i0 = Math.max(0, Math.floor((x - radius - x0) / GRID_CELL)), i1 = Math.min(C - 1, Math.floor((x + radius - x0) / GRID_CELL));
      const j0 = Math.max(0, Math.floor((z - radius - z0) / GRID_CELL)), j1 = Math.min(C - 1, Math.floor((z + radius - z0) / GRID_CELL));
      const st = t.stamp!, segs = res.segs, cs = res.cellStart, cells = res.cellSegs!, sr = res.segRoad!, roads = res.roads;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const c = j * C + i;
        for (let k = cs[c]; k < cs[c + 1]; k++) {
          const s = cells[k];
          if (st[s] === stamp) continue;
          st[s] = stamp;
          cb(roads[sr[s]], segs[s * 4], segs[s * 4 + 1], segs[s * 4 + 2], segs[s * 4 + 3]);
        }
      }
    }
  }

  /** 반경 안 타일의 물 폴리곤 순회 (미니맵용) */
  forEachWater(x: number, z: number, radius: number, cb: (poly: number[]) => void) {
    for (const t of this.tiles.values()) {
      if (t.state !== 'built' || !t.result?.waterPolys) continue;
      if (this.tileDist(t, x, z) > radius) continue;
      for (const p of t.result.waterPolys) cb(p);
    }
  }

  /** 가장 가까운 도로 위 지점 (큰 도로를 약간 우선) */
  nearestRoad(x: number, z: number, maxDist = 60): RoadHit | null {
    let best: RoadHit | null = null;
    let bestScore = Infinity;
    this.forEachSegment(x, z, maxDist, (road, x1, z1, x2, z2) => {
      const dx = x2 - x1, dz = z2 - z1;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
      const px = x1 + dx * t, pz = z1 + dz * t;
      const d = Math.hypot(px - x, pz - z);
      const score = d - (6 - Math.min(road.c, 6)) * 0.5;
      if (d <= maxDist && score < bestScore) {
        bestScore = score;
        best = { road, x: px, z: pz, heading: Math.atan2(-dz, dx), dist: d };
      }
    });
    return best;
  }

  setNight(night: boolean) {
    this.facadeMat.emissiveIntensity = night ? 0.9 : 0;
  }
}

function unpack(p: GeoPack): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(p.attrs)) g.setAttribute(name, new THREE.BufferAttribute(a.array, a.itemSize));
  g.setIndex(new THREE.BufferAttribute(p.index, 1));
  g.computeBoundingSphere();
  return g;
}
