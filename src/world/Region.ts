import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { buildBuildingGeometry, generateBuildings } from './Buildings';
import type { MapBuilding, MapRoad } from './MapData';
import { createRoadMaterial } from './RoadMaterial';
import { buildFlatPolygons, buildRoadGeometry } from './RoadMesh';
import { makeFacadeTextures, makeGroundTexture } from './textures';

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

interface TileData { roads: MapRoad[]; water: number[][] }

interface Tile {
  key: string;
  ix: number;
  iz: number;
  state: 'loading' | 'ready' | 'built';
  data?: TileData;
  group?: THREE.Group;
  colliders: RAPIER.Collider[];
  cells: string[];
}

export interface Seg { road: MapRoad; x1: number; z1: number; x2: number; z2: number }
export interface RoadHit { road: MapRoad; x: number; z: number; heading: number; dist: number }

/** 랜드마크 (실제 위치·높이) */
const LANDMARKS: { name: string; lat: number; lon: number; w: number; d: number; h: number }[] = [
  { name: '롯데월드타워', lat: 37.5125, lon: 127.1025, w: 72, d: 72, h: 555 },
  { name: '63빌딩', lat: 37.5198, lon: 126.9403, w: 62, d: 30, h: 249 },
  { name: '파크원', lat: 37.5262, lon: 126.9283, w: 50, d: 40, h: 333 },
];

const CELL = 50;
const LOAD_RADIUS = 5200; // m: 이 안의 타일을 불러옴
const UNLOAD_RADIUS = 7600;

/**
 * 서울·경기 타일 스트리밍: 차 주변 타일만 내려받아 도로·수역·건물·충돌체를 만들고, 멀어지면 해제합니다.
 */
export class Region {
  readonly group = new THREE.Group();
  readonly tileSize: number;
  private readonly tiles = new Map<string, Tile>();
  private readonly available: Set<string>;
  private readonly grid = new Map<string, Seg[]>();
  private readonly roadMat = createRoadMaterial();
  private readonly waterMat = new THREE.MeshStandardMaterial({ color: 0x24465c, roughness: 0.08, metalness: 0.35 });
  private readonly facadeMat: THREE.MeshStandardMaterial;
  private readonly roofMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  private readonly ground: THREE.Mesh;
  private readonly buildQueue: Tile[] = [];
  private inflight = 0;
  private readonly landmarks: { x: number; z: number; b: MapBuilding }[] = [];
  stats = { loaded: 0, buildMs: 0, buildings: 0, roads: 0 };

  constructor(readonly index: RegionIndex, private readonly baseUrl: string, private readonly R: Rapier, private readonly world: RAPIER.World) {
    this.tileSize = index.tileSize;
    this.available = new Set(index.tiles.map(([x, z]) => `${x}_${z}`));
    this.group.name = 'Region';
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

  /** 매 프레임: 필요한 타일 요청·생성·해제 (생성은 프레임당 1개로 끊김 방지) */
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
      const d = Math.hypot((ix + 0.5) * ts - x, (iz + 0.5) * ts - z);
      if (d < LOAD_RADIUS) want.push({ key, ix, iz, d });
    }
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      if (this.inflight >= 3) break;
      this.request(w.key, w.ix, w.iz);
    }
    for (const t of this.tiles.values()) {
      const d = Math.hypot((t.ix + 0.5) * ts - x, (t.iz + 0.5) * ts - z);
      if (d > UNLOAD_RADIUS && t.state !== 'loading') this.unload(t);
    }
    // 가까운 타일부터 생성
    if (this.buildQueue.length) {
      this.buildQueue.sort((a, b) => Math.hypot((a.ix + 0.5) * ts - x, (a.iz + 0.5) * ts - z) - Math.hypot((b.ix + 0.5) * ts - x, (b.iz + 0.5) * ts - z));
      const t = this.buildQueue.shift()!;
      if (this.tiles.get(t.key) === t) this.build(t);
    }
  }

  /** 주변 타일이 모두 준비될 때까지 기다림 (출발 위치 이동 시) */
  async ready(x: number, z: number, radius = 1500): Promise<void> {
    for (let guard = 0; guard < 600; guard++) {
      this.update(x, z);
      const ts = this.tileSize;
      let pending = false;
      for (const key of this.available) {
        const [ix, iz] = key.split('_').map(Number);
        if (Math.hypot(Math.max(0, Math.abs((ix + 0.5) * ts - x) - ts / 2), Math.max(0, Math.abs((iz + 0.5) * ts - z) - ts / 2)) > radius) continue;
        const t = this.tiles.get(key);
        if (!t || t.state !== 'built') pending = true;
      }
      if (!pending) return;
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  private request(key: string, ix: number, iz: number) {
    const t: Tile = { key, ix, iz, state: 'loading', colliders: [], cells: [] };
    this.tiles.set(key, t);
    this.inflight++;
    fetch(`${this.baseUrl}tiles/${key}.json`)
      .then((r) => r.json())
      .then((data: TileData) => {
        if (this.tiles.get(key) !== t) return;
        t.data = data;
        t.state = 'ready';
        this.buildQueue.push(t);
      })
      .catch(() => this.tiles.delete(key))
      .finally(() => this.inflight--);
  }

  private build(t: Tile) {
    const t0 = performance.now();
    const data = t.data!;
    const g = new THREE.Group();
    g.name = `tile_${t.key}`;
    if (data.roads.length) {
      const roads = new THREE.Mesh(buildRoadGeometry(data.roads), this.roadMat);
      roads.receiveShadow = true;
      g.add(roads);
    }
    if (data.water.length) {
      const water = new THREE.Mesh(buildFlatPolygons(data.water, 0.016), this.waterMat);
      water.receiveShadow = true;
      g.add(water);
    }
    const ts = this.tileSize;
    let buildings = generateBuildings(data.roads, t.ix * ts, t.iz * ts, ts, t.ix * 73856093 ^ t.iz * 19349663);
    // 랜드마크: 해당 타일에 넣고 주변 생성 건물 제거
    for (const l of this.landmarks) {
      if (Math.floor(l.x / ts) !== t.ix || Math.floor(l.z / ts) !== t.iz) continue;
      buildings = buildings.filter((b) => Math.hypot(b.p[0] / 10 - l.x, b.p[1] / 10 - l.z) > 90);
      buildings.push(l.b);
    }
    if (buildings.length) {
      const bm = buildBuildingGeometry(buildings);
      const walls = new THREE.Mesh(bm.walls, this.facadeMat);
      const roofs = new THREE.Mesh(bm.roofs, this.roofMat);
      walls.castShadow = walls.receiveShadow = roofs.castShadow = roofs.receiveShadow = true;
      g.add(walls, roofs);
      t.colliders.push(this.world.createCollider(this.R.ColliderDesc.trimesh(bm.colliderVerts, bm.colliderIdx).setFriction(0.3)));
    }
    // 도로 검색 격자
    for (const r of data.roads) {
      for (let i = 0; i + 3 < r.p.length; i += 2) {
        const s: Seg = { road: r, x1: r.p[i] / 10, z1: r.p[i + 1] / 10, x2: r.p[i + 2] / 10, z2: r.p[i + 3] / 10 };
        const gx0 = Math.floor(Math.min(s.x1, s.x2) / CELL), gx1 = Math.floor(Math.max(s.x1, s.x2) / CELL);
        const gz0 = Math.floor(Math.min(s.z1, s.z2) / CELL), gz1 = Math.floor(Math.max(s.z1, s.z2) / CELL);
        for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
          const k = `${gx},${gz}`;
          let list = this.grid.get(k);
          if (!list) this.grid.set(k, (list = []));
          list.push(s);
          t.cells.push(k);
        }
      }
    }
    t.group = g;
    t.state = 'built';
    this.group.add(g);
    this.stats.loaded++;
    this.stats.buildings += buildings.length;
    this.stats.roads += data.roads.length;
    this.stats.buildMs = performance.now() - t0;
  }

  private unload(t: Tile) {
    this.tiles.delete(t.key);
    if (t.group) {
      this.group.remove(t.group);
      t.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    for (const c of t.colliders) this.world.removeCollider(c, false);
    if (t.data) {
      const roads = new Set(t.data.roads);
      for (const k of new Set(t.cells)) {
        const list = this.grid.get(k);
        if (!list) continue;
        const kept = list.filter((s) => !roads.has(s.road));
        if (kept.length) this.grid.set(k, kept);
        else this.grid.delete(k);
      }
      this.stats.buildings = Math.max(0, this.stats.buildings);
    }
    const qi = this.buildQueue.indexOf(t);
    if (qi >= 0) this.buildQueue.splice(qi, 1);
  }

  get tileCount(): number {
    let n = 0;
    for (const t of this.tiles.values()) if (t.state === 'built') n++;
    return n;
  }

  /** 반경 안의 도로 세그먼트 순회 (미니맵 그리기용) */
  forEachSegment(x: number, z: number, radius: number, cb: (s: Seg) => void) {
    const r = Math.ceil(radius / CELL);
    const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
    const seen = new Set<Seg>();
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const list = this.grid.get(`${gx + i},${gz + j}`);
      if (!list) continue;
      for (const s of list) if (!seen.has(s)) { seen.add(s); cb(s); }
    }
  }

  /** 가장 가까운 도로 위 지점 (큰 도로를 약간 우선) */
  nearestRoad(x: number, z: number, maxDist = 60): RoadHit | null {
    let best: RoadHit | null = null;
    let bestScore = Infinity;
    this.forEachSegment(x, z, maxDist, (s) => {
      const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.x1) * dx + (z - s.z1) * dz) / L2));
      const px = s.x1 + dx * t, pz = s.z1 + dz * t;
      const d = Math.hypot(px - x, pz - z);
      const score = d - (6 - Math.min(s.road.c, 6)) * 0.5;
      if (d <= maxDist && score < bestScore) {
        bestScore = score;
        best = { road: s.road, x: px, z: pz, heading: Math.atan2(-dz, dx), dist: d };
      }
    });
    return best;
  }

  setNight(night: boolean) {
    this.facadeMat.emissiveIntensity = night ? 0.9 : 0;
  }
}
