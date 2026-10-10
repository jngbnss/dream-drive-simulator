/**
 * 타일 생성 워커: JSON 다운로드·파싱, 도로·수역·건물 지오메트리와 충돌 메시 계산을
 * 메인 스레드 밖에서 수행해 주행 중 끊김(스터터)을 없앱니다. 결과 배열은 복사 없이 전송(transfer)합니다.
 */
import type * as THREE from 'three';
import { buildBuildingGeometry, generateBuildings } from './Buildings';
import type { MapBuilding, MapRoad } from './MapData';
import { buildFlatPolygons, buildRoadGeometry } from './RoadMesh';

export interface TileRequest {
  key: string;
  url: string;
  ix: number;
  iz: number;
  tileSize: number;
  landmarks: { x: number; z: number; b: MapBuilding }[];
}

export interface GeoPack {
  attrs: Record<string, { array: Float32Array; itemSize: number }>;
  index: Uint32Array;
}

export interface TileResult {
  key: string;
  ok: boolean;
  roads?: MapRoad[];
  waterPolys?: number[][];
  road?: GeoPack;
  water?: GeoPack;
  walls?: GeoPack;
  roofs?: GeoPack;
  colliderVerts?: Float32Array;
  colliderIdx?: Uint32Array;
  /** 도로 세그먼트 [x1,z1,x2,z2] (m) + 소속 도로 인덱스 + 타일 로컬 50m 격자(CSR) */
  segs?: Float32Array;
  segRoad?: Uint32Array;
  cellStart?: Uint32Array;
  cellSegs?: Uint32Array;
  buildings: number;
}

function pack(g: THREE.BufferGeometry, transfer: Transferable[]): GeoPack {
  const attrs: GeoPack['attrs'] = {};
  for (const [name, a] of Object.entries(g.attributes)) {
    const array = new Float32Array((a as THREE.BufferAttribute).array as ArrayLike<number>);
    attrs[name] = { array, itemSize: a.itemSize };
    transfer.push(array.buffer);
  }
  const index = new Uint32Array((g.index?.array ?? []) as ArrayLike<number>);
  transfer.push(index.buffer);
  return { attrs, index };
}

(self as unknown as { onmessage: (e: MessageEvent<TileRequest>) => void }).onmessage = async (e: MessageEvent<TileRequest>) => {
  const req = e.data;
  const transfer: Transferable[] = [];
  try {
    const data: { roads: MapRoad[]; water: number[][] } = await (await fetch(req.url)).json();
    const out: TileResult = { key: req.key, ok: true, roads: data.roads, buildings: 0 };
    if (data.roads.length) out.road = pack(buildRoadGeometry(data.roads), transfer);
    if (data.water.length) {
      out.water = pack(buildFlatPolygons(data.water, 0.016), transfer);
      out.waterPolys = data.water;
    }
    const ts = req.tileSize;
    let buildings = generateBuildings(data.roads, req.ix * ts, req.iz * ts, ts, (req.ix * 73856093) ^ (req.iz * 19349663));
    for (const l of req.landmarks) {
      if (Math.floor(l.x / ts) !== req.ix || Math.floor(l.z / ts) !== req.iz) continue;
      buildings = buildings.filter((b) => Math.hypot(b.p[0] / 10 - l.x, b.p[1] / 10 - l.z) > 90);
      buildings.push(l.b);
    }
    if (buildings.length) {
      const bm = buildBuildingGeometry(buildings);
      out.walls = pack(bm.walls, transfer);
      out.roofs = pack(bm.roofs, transfer);
      out.colliderVerts = bm.colliderVerts;
      out.colliderIdx = bm.colliderIdx;
      transfer.push(bm.colliderVerts.buffer, bm.colliderIdx.buffer);
    }
    out.buildings = buildings.length;
    Object.assign(out, buildSegmentGrid(data.roads, req.ix * ts, req.iz * ts, ts, transfer));
    (self as unknown as Worker).postMessage(out, transfer);
  } catch {
    (self as unknown as Worker).postMessage({ key: req.key, ok: false, buildings: 0 } satisfies TileResult);
  }
};

export const GRID_CELL = 50;

/** 도로 세그먼트를 타일 로컬 격자(CSR)로 색인 → 메인 스레드에서 Map/문자열 키 작업 없음 */
function buildSegmentGrid(roads: MapRoad[], x0: number, z0: number, ts: number, transfer: Transferable[]) {
  let n = 0;
  for (const r of roads) n += r.p.length / 2 - 1;
  const segs = new Float32Array(n * 4);
  const segRoad = new Uint32Array(n);
  let k = 0;
  roads.forEach((r, ri) => {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      segs.set([r.p[i] / 10, r.p[i + 1] / 10, r.p[i + 2] / 10, r.p[i + 3] / 10], k * 4);
      segRoad[k++] = ri;
    }
  });
  const C = Math.ceil(ts / GRID_CELL);
  const clampC = (v: number) => Math.max(0, Math.min(C - 1, v));
  const range = (s: number) => {
    const ax = segs[s * 4], az = segs[s * 4 + 1], bx = segs[s * 4 + 2], bz = segs[s * 4 + 3];
    return [
      clampC(Math.floor((Math.min(ax, bx) - x0) / GRID_CELL)), clampC(Math.floor((Math.max(ax, bx) - x0) / GRID_CELL)),
      clampC(Math.floor((Math.min(az, bz) - z0) / GRID_CELL)), clampC(Math.floor((Math.max(az, bz) - z0) / GRID_CELL)),
    ];
  };
  const counts = new Uint32Array(C * C + 1);
  for (let s = 0; s < n; s++) {
    const [i0, i1, j0, j1] = range(s);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) counts[j * C + i + 1]++;
  }
  for (let c = 0; c < C * C; c++) counts[c + 1] += counts[c];
  const cellSegs = new Uint32Array(counts[C * C]);
  const fill = counts.slice(0, C * C);
  for (let s = 0; s < n; s++) {
    const [i0, i1, j0, j1] = range(s);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) cellSegs[fill[j * C + i]++] = s;
  }
  transfer.push(segs.buffer, segRoad.buffer, counts.buffer, cellSegs.buffer);
  return { segs, segRoad, cellStart: counts, cellSegs };
}
