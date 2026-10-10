// 서울·경기(+인천) 지역 OSM PBF → 타일 스트리밍용 도로·수역 데이터 + 내비게이션 그래프 + 목적지 목록
// 입력: tools/data/south-korea-latest.osm.pbf (Geofabrik, © OpenStreetMap contributors, ODbL 1.0)
// 사용법: node --max-old-space-size=8192 tools/osm-region.mjs
// 사용 오픈소스: osm-pbf-parser (MIT), through2 (MIT)
import { createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const osmParser = require('osm-pbf-parser');
const through = require('through2');

const PBF = 'tools/data/south-korea-latest.osm.pbf';
const OUT = 'public/region';
// 서울·경기·인천을 덮는 영역
export const REGION = { south: 36.88, west: 126.36, north: 38.31, east: 127.88 };
// 기존 강남·송파 맵과 같은 원점 (좌표 호환)
const ORIGIN = { lat: 37.506, lon: 127.073 };
const TILE = 4000; // m
const ROUTE_MAX_CLASS = 4; // 내비게이션 그래프: 고속도로~집산도로 + 연결로 (국지도로 제외해 용량 절감)

const M_LAT = 110_950;
const M_LON = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
const proj = (lat, lon) => [(lon - ORIGIN.lon) * M_LON, -(lat - ORIGIN.lat) * M_LAT];
const dm = (v) => Math.round(v * 10);

const CLASS = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  unclassified: 5, residential: 5, living_street: 5,
  motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 6,
};

// ── 성장형 타입 배열 ─────────────────────────────────────────
class Grow {
  constructor(Type, cap = 1 << 20) { this.Type = Type; this.a = new Type(cap); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.Type(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
  }
  view() { return this.a.subarray(0, this.n); }
}

function pass(onItems) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    createReadStream(PBF)
      .pipe(osmParser())
      .pipe(through.obj((items, _enc, next) => { onItems(items); next(); }))
      .on('finish', () => { console.log(`  pass ${((Date.now() - t0) / 1000).toFixed(0)}s`); resolve(); })
      .on('error', reject);
  });
}

// ── 1단계: 영역 안 노드 좌표 + 관계(수역·공원 멀티폴리곤) 멤버 + 목적지 후보 ─────
console.log('1/3 노드·관계 읽는 중');
const ids = new Grow(Float64Array, 1 << 22);
const xs = new Grow(Int32Array, 1 << 22);
const zs = new Grow(Int32Array, 1 << 22);
const relWayRole = new Map(); // wayId → 'water' | 'park'
const pois = [];
const pad = 0.02;
let sorted = true, lastId = -1;
await pass((items) => {
  for (const it of items) {
    if (it.type === 'node') {
      if (it.lat < REGION.south - pad || it.lat > REGION.north + pad || it.lon < REGION.west - pad || it.lon > REGION.east + pad) continue;
      if (it.id < lastId) sorted = false;
      lastId = it.id;
      const [x, z] = proj(it.lat, it.lon);
      ids.push(it.id); xs.push(dm(x)); zs.push(dm(z));
      const t = it.tags;
      if (t && t.name && isPoi(t)) pois.push({ name: poiName(t), kind: poiKind(t), x: Math.round(x), z: Math.round(z) });
    } else if (it.type === 'relation') {
      const t = it.tags || {};
      const kind = t.natural === 'water' || t.waterway === 'riverbank' ? 'water' : null;
      if (!kind || t.type !== 'multipolygon') continue;
      for (const m of it.members) if (m.type === 'way' && m.role !== 'inner') relWayRole.set(Number(m.id), kind);
    }
  }
});
console.log(`  노드 ${ids.n.toLocaleString()} (정렬 ${sorted}), 수역 관계 멤버 ${relWayRole.size}, 목적지 후보 ${pois.length}`);
let ID = ids.view(), X = xs.view(), Z = zs.view();
if (!sorted) {
  const order = Array.from(ID.keys()).sort((a, b) => ID[a] - ID[b]);
  ID = Float64Array.from(order, (i) => ID[i]); X = Int32Array.from(order, (i) => X[i]); Z = Int32Array.from(order, (i) => Z[i]);
}
function find(id) {
  let lo = 0, hi = ID.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = ID[mid];
    if (v === id) return mid;
    if (v < id) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

function isPoi(t) {
  return (
    t.railway === 'station' || t.public_transport === 'station' || t.aeroway === 'aerodrome' || t.aeroway === 'terminal' ||
    ['attraction', 'museum', 'theme_park', 'zoo', 'viewpoint', 'gallery'].includes(t.tourism) ||
    ['university', 'college', 'hospital', 'townhall', 'stadium'].includes(t.amenity) ||
    ['mall', 'department_store'].includes(t.shop) || t.leisure === 'stadium' || t.historic === 'palace' ||
    ['city', 'town', 'borough', 'suburb', 'quarter'].includes(t.place)
  );
}
function poiName(t) {
  const n = t['name:ko'] || t.name;
  // OSM 역 이름은 보통 '역'이 빠져 있음 (예: "판교") → "판교역"
  if ((t.railway === 'station' || t.public_transport === 'station') && !n.endsWith('역')) return `${n}역`;
  return n;
}
function poiKind(t) {
  if (t.railway || t.public_transport) return '역';
  if (t.aeroway) return '공항';
  if (t.place) return '지역';
  if (t.tourism) return '명소';
  if (t.shop) return '쇼핑';
  if (t.historic) return '명소';
  return '시설';
}

// ── 2단계: 도로·수역 웨이 ──────────────────────────────────
console.log('2/3 도로·수역 읽는 중');
const roads = []; // { c, l, o, w, n, b, t, idx: Int32Array(노드 인덱스) }
const waterWays = new Map(); // id → Int32Array(node idx) (관계 멤버)
const waterPolys = []; // 단일 웨이 폴리곤
await pass((items) => {
  for (const it of items) {
    if (it.type !== 'way') continue;
    const t = it.tags || {};
    const isRoad = t.highway in CLASS && t.area !== 'yes';
    const isWater = t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir';
    const rel = relWayRole.get(Number(it.id));
    // 건물·부지로 등록된 명소 (예: N서울타워, 경복궁) → 중심점을 목적지로
    if (t.name && (isPoi(t) || t.leisure === 'park') && !isRoad) {
      let sx = 0, sz = 0, c = 0;
      for (const r of it.refs) { const k = find(Number(r)); if (k >= 0) { sx += X[k]; sz += Z[k]; c++; } }
      if (c) pois.push({ name: poiName(t), kind: t.leisure === 'park' ? '공원' : poiKind(t), x: Math.round(sx / c / 10), z: Math.round(sz / c / 10) });
    }
    if (!isRoad && !isWater && !rel) continue;
    const idx = [];
    for (const r of it.refs) {
      const k = find(Number(r));
      if (k >= 0) idx.push(k);
      else if (isRoad && idx.length) break; // 영역 밖으로 나가면 자름
    }
    if (idx.length < 2) continue;
    if (isRoad) {
      const c = CLASS[t.highway];
      let oneway = ['yes', '1', 'true'].includes(t.oneway) || t.highway === 'motorway' || (c === 6 && t.oneway !== 'no') || t.junction === 'roundabout' ? 1 : 0;
      if (t.oneway === '-1') { idx.reverse(); oneway = 1; }
      let lanes = parseInt(t.lanes, 10);
      if (!Number.isFinite(lanes) || lanes < 1 || lanes > 14) lanes = defaultLanes(c, oneway);
      const laneW = c <= 2 ? 3.3 : c <= 4 ? 3.1 : 2.8;
      let width = parseFloat(t.width);
      if (!Number.isFinite(width) || width < 2.5 || width > 60) width = lanes * laneW + (c <= 3 ? 1.0 : 0.4);
      if (c === 5 && !t.lanes) width = Math.min(width, 6);
      roads.push({ c, l: lanes, o: oneway, w: Math.round(width * 10) / 10, n: t.name, b: t.bridge === 'yes' ? 1 : 0, t: t.tunnel === 'yes' ? 1 : 0, idx: Int32Array.from(idx) });
    }
    if (rel) waterWays.set(Number(it.id), { idx: Int32Array.from(idx), first: Number(it.refs[0]), last: Number(it.refs[it.refs.length - 1]) });
    else if (isWater && it.refs[0] === it.refs[it.refs.length - 1] && idx.length >= 4) waterPolys.push(Int32Array.from(idx));
  }
});
console.log(`  도로 ${roads.length.toLocaleString()}, 수역 웨이 ${waterPolys.length}, 관계 멤버 웨이 ${waterWays.size}`);

function defaultLanes(c, oneway) {
  switch (c) {
    case 0: return 3;
    case 1: case 2: return oneway ? 3 : 6;
    case 3: return oneway ? 2 : 4;
    case 4: return oneway ? 1 : 2;
    case 6: return 1;
    default: return oneway ? 1 : 2;
  }
}

// 수역 관계 멤버 → 링 조립 (끝점 노드 id 기준)
const used = new Set();
const ringsFromRel = [];
const byEnd = new Map();
for (const [id, w] of waterWays) {
  for (const e of [w.first, w.last]) { if (!byEnd.has(e)) byEnd.set(e, []); byEnd.get(e).push(id); }
}
for (const [id, w] of waterWays) {
  if (used.has(id)) continue;
  used.add(id);
  let ring = Array.from(w.idx);
  let head = w.first, tail = w.last;
  let guard = 0;
  while (head !== tail && guard++ < 5000) {
    const next = (byEnd.get(tail) || []).find((o) => !used.has(o));
    if (next === undefined) break;
    used.add(next);
    const nw = waterWays.get(next);
    if (nw.first === tail) { ring = ring.concat(Array.from(nw.idx).slice(1)); tail = nw.last; }
    else { ring = ring.concat(Array.from(nw.idx).reverse().slice(1)); tail = nw.first; }
  }
  if (ring.length >= 4) ringsFromRel.push(Int32Array.from(ring));
}
console.log(`  관계 수역 링 ${ringsFromRel.length}`);

// ── 교차점: 여러 도로가 공유하는 노드 ─────────────────────────
const nodeUse = new Uint8Array(ID.length);
for (const r of roads) {
  let prev = -1;
  for (const k of r.idx) { if (k !== prev && nodeUse[k] < 255) nodeUse[k]++; prev = k; }
}
for (const r of roads) { nodeUse[r.idx[0]] = Math.max(nodeUse[r.idx[0]], 2); nodeUse[r.idx[r.idx.length - 1]] = Math.max(nodeUse[r.idx[r.idx.length - 1]], 2); }

// ── 3단계: 타일 분할 ─────────────────────────────────────
console.log('3/3 타일·그래프 생성');
const [minX, maxZ] = proj(REGION.south, REGION.west).map((v) => v);
const [maxX, minZ] = proj(REGION.north, REGION.east);
const tileOf = (xdm, zdm) => [Math.floor(xdm / 10 / TILE), Math.floor(zdm / 10 / TILE)];
const tiles = new Map();
const tileGet = (ix, iz) => {
  const k = `${ix}_${iz}`;
  let t = tiles.get(k);
  if (!t) tiles.set(k, (t = { ix, iz, roads: [], water: [] }));
  return t;
};
for (const r of roads) {
  // 세그먼트 중점이 속한 타일 기준으로 연속 구간을 나눔
  let cur = null, curTile = null;
  for (let i = 0; i < r.idx.length - 1; i++) {
    const a = r.idx[i], b = r.idx[i + 1];
    const [ix, iz] = tileOf((X[a] + X[b]) / 2, (Z[a] + Z[b]) / 2);
    const key = `${ix}_${iz}`;
    if (key !== curTile) {
      if (cur) tileGet(...curTile.split('_').map(Number)).roads.push(cur);
      cur = { c: r.c, l: r.l, o: r.o, w: r.w, p: [X[a], Z[a]], j: nodeUse[a] > 1 ? [0] : [] };
      if (r.n) cur.n = r.n;
      if (r.b) cur.b = 1;
      if (r.t) cur.t = 1;
      curTile = key;
    }
    cur.p.push(X[b], Z[b]);
    if (nodeUse[b] > 1) cur.j.push(cur.p.length / 2 - 1);
  }
  if (cur) tileGet(...curTile.split('_').map(Number)).roads.push(cur);
}
// 수역: 폴리곤 경계 상자가 걸치는 모든 타일에 넣음 (타일 경계로 자르기)
for (const ring of [...waterPolys, ...ringsFromRel]) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const k of ring) { x0 = Math.min(x0, X[k]); x1 = Math.max(x1, X[k]); z0 = Math.min(z0, Z[k]); z1 = Math.max(z1, Z[k]); }
  const area = ((x1 - x0) / 10) * ((z1 - z0) / 10);
  if (area < 2000) continue;
  const poly = Array.from(ring, (k) => [X[k] / 10, Z[k] / 10]);
  const [tx0, tz0] = tileOf(x0, z0), [tx1, tz1] = tileOf(x1, z1);
  for (let ix = tx0; ix <= tx1; ix++) for (let iz = tz0; iz <= tz1; iz++) {
    const clipped = clipRect(poly, ix * TILE, iz * TILE, (ix + 1) * TILE, (iz + 1) * TILE);
    if (clipped.length >= 3) tileGet(ix, iz).water.push(simplify(clipped, 3).flatMap(([x, z]) => [Math.round(x * 10), Math.round(z * 10)]));
  }
}

function clipRect(poly, x0, z0, x1, z1) {
  const edges = [(p) => p[0] >= x0, (p) => p[0] <= x1, (p) => p[1] >= z0, (p) => p[1] <= z1];
  const cut = [(a, b) => at(a, b, 0, x0), (a, b) => at(a, b, 0, x1), (a, b) => at(a, b, 1, z0), (a, b) => at(a, b, 1, z1)];
  let out = poly;
  for (let e = 0; e < 4 && out.length; e++) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i], prev = inp[(i + inp.length - 1) % inp.length];
      const ci = edges[e](cur), pi = edges[e](prev);
      if (ci) { if (!pi) out.push(cut[e](prev, cur)); out.push(cur); } else if (pi) out.push(cut[e](prev, cur));
    }
  }
  return out;
}
function at(a, b, axis, v) { const t = (v - a[axis]) / (b[axis] - a[axis]); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
function simplify(pts, tol) {
  if (pts.length < 8) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    const [ax, az] = pts[a], [bx, bz] = pts[b];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/tiles`, { recursive: true });
let totalBytes = 0;
const tileIndex = [];
for (const t of tiles.values()) {
  const json = JSON.stringify({ roads: t.roads, water: t.water });
  totalBytes += json.length;
  tileIndex.push([t.ix, t.iz, t.roads.length]);
  await writeFile(`${OUT}/tiles/${t.ix}_${t.iz}.json`, json);
}
console.log(`  타일 ${tiles.size}, 총 ${(totalBytes / 1e6).toFixed(1)}MB`);

// ── 내비게이션 그래프 (CSR, 바이너리) ─────────────────────
const gNode = new Int32Array(ID.length).fill(-1);
const gx = [], gz = [];
const getNode = (k) => { if (gNode[k] < 0) { gNode[k] = gx.length; gx.push(X[k]); gz.push(Z[k]); } return gNode[k]; };
const names = [''];
const nameIdx = new Map([['', 0]]);
const edges = []; // [from, to, lenM, geomStart, geomCount, cls, name]
const geom = [];
for (const r of roads) {
  if (r.c > ROUTE_MAX_CLASS && r.c !== 6) continue;
  let ni = nameIdx.get(r.n || '');
  if (ni === undefined) { ni = names.length; names.push(r.n); nameIdx.set(r.n, ni); }
  let start = 0, len = 0;
  for (let i = 1; i < r.idx.length; i++) {
    const a = r.idx[i - 1], b = r.idx[i];
    len += Math.hypot(X[b] - X[a], Z[b] - Z[a]) / 10;
    if (nodeUse[b] > 1 || i === r.idx.length - 1) {
      const from = getNode(r.idx[start]), to = getNode(b);
      const gs = geom.length / 2;
      const seg = [];
      for (let k = start; k <= i; k++) seg.push([X[r.idx[k]], Z[r.idx[k]]]);
      for (const [px, pz] of simplify(seg, 15)) geom.push(px, pz); // 1.5m 허용오차로 형상 단순화
      const cnt = geom.length / 2 - gs;
      edges.push([from, to, len, gs, cnt, r.c, ni, 0]);
      if (!r.o) edges.push([to, from, len, gs, cnt, r.c, ni, 1]);
      start = i; len = 0;
    }
  }
}
const N = gx.length, E = edges.length;
edges.sort((a, b) => a[0] - b[0]);
const off = new Uint32Array(N + 1);
for (const e of edges) off[e[0] + 1]++;
for (let i = 0; i < N; i++) off[i + 1] += off[i];
const eTo = new Uint32Array(E), eLen = new Float32Array(E), eGeom = new Uint32Array(E), eCnt = new Uint16Array(E), eCls = new Uint8Array(E), eRev = new Uint8Array(E), eName = new Uint16Array(E);
edges.forEach((e, i) => { eTo[i] = e[1]; eLen[i] = e[2]; eGeom[i] = e[3]; eCnt[i] = Math.min(65535, e[4]); eCls[i] = e[5]; eName[i] = Math.min(65535, e[6]); eRev[i] = e[7]; });
const nodeXZ = new Int32Array(N * 2);
for (let i = 0; i < N; i++) { nodeXZ[i * 2] = gx[i]; nodeXZ[i * 2 + 1] = gz[i]; }
const geomArr = Int32Array.from(geom);
const parts = [nodeXZ, off, eTo, eLen, eGeom, eCnt, eCls, eRev, eName, geomArr];
const header = { N, E, G: geomArr.length / 2, names, layout: ['nodeXZ:i32', 'off:u32', 'to:u32', 'len:f32', 'geom:u32', 'cnt:u16', 'cls:u8', 'rev:u8', 'name:u16', 'geomXZ:i32'] };
const headerBuf = Buffer.from(JSON.stringify(header));
const align = (n) => (n + 3) & ~3;
let size = 4 + align(headerBuf.length);
for (const p of parts) size += align(p.byteLength);
const buf = Buffer.alloc(size);
buf.writeUInt32LE(headerBuf.length, 0);
headerBuf.copy(buf, 4);
let o = 4 + align(headerBuf.length);
for (const p of parts) { Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, o); o += align(p.byteLength); }
await writeFile(`${OUT}/graph.bin`, buf);
console.log(`  그래프 노드 ${N.toLocaleString()}, 간선 ${E.toLocaleString()}, 형상점 ${header.G.toLocaleString()}, ${(size / 1e6).toFixed(1)}MB`);

// 목적지 목록 (이름 중복 제거)
const seen = new Set();
const poiOut = [];
for (const p of pois) {
  const k = `${p.name}|${Math.round(p.x / 300)}|${Math.round(p.z / 300)}`;
  if (seen.has(k)) continue;
  seen.add(k);
  poiOut.push([p.name, p.kind, p.x, p.z]);
}
await writeFile(`${OUT}/pois.json`, JSON.stringify(poiOut));
await writeFile(`${OUT}/index.json`, JSON.stringify({
  version: 1, name: '서울 · 경기', origin: ORIGIN, tileSize: TILE,
  bounds: [Math.round(minX), Math.round(minZ), Math.round(maxX), Math.round(maxZ)],
  tiles: tileIndex, attribution: `© OpenStreetMap contributors (ODbL 1.0), Geofabrik 추출 ${new Date().toISOString().slice(0, 10)}`,
}));
console.log(`  목적지 ${poiOut.length.toLocaleString()}`);
