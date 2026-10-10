// tools/data/osm-raw.json → public/maps/gangnam-songpa.json
// 데이터: © OpenStreetMap contributors, ODbL 1.0
// 사용법: node tools/osm-to-map.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { BBOX } from './bbox.mjs';

const raw = JSON.parse(await readFile('tools/data/osm-raw.json', 'utf8'));
const elements = raw.elements;

const origin = { lat: (BBOX.south + BBOX.north) / 2, lon: (BBOX.west + BBOX.east) / 2 };
const M_PER_DEG_LAT = 110_950;
const M_PER_DEG_LON = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
const project = (lat, lon) => [(lon - origin.lon) * M_PER_DEG_LON, -(lat - origin.lat) * M_PER_DEG_LAT];
const [minX, maxZ] = project(BBOX.south, BBOX.west);
const [maxX, minZ] = project(BBOX.north, BBOX.east);
const bounds = [minX, minZ, maxX, maxZ];
const q = (v) => Math.round(v * 10);
const inBounds = ([x, z], pad = 0) => x >= minX - pad && x <= maxX + pad && z >= minZ - pad && z <= maxZ + pad;

// ── 도로 ───────────────────────────────────────────────────
const CLASS = {
  motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4,
  unclassified: 5, residential: 5, living_street: 5,
  motorway_link: 6, trunk_link: 6, primary_link: 6, secondary_link: 6, tertiary_link: 6,
};
const roadsSrc = elements.filter(
  (e) => e.type === 'way' && e.tags?.highway in CLASS && e.geometry && e.tags.tunnel !== 'yes' && e.tags.area !== 'yes',
);
const nodeUse = new Map();
for (const w of roadsSrc) {
  const seen = new Set();
  for (const id of w.nodes) {
    if (seen.has(id)) continue;
    seen.add(id);
    nodeUse.set(id, (nodeUse.get(id) ?? 0) + 1);
  }
}

function defaultLanes(c, oneway) {
  switch (c) {
    case 0: return 3;
    case 1: return oneway ? 3 : 6;
    case 2: return oneway ? 3 : 6;
    case 3: return oneway ? 2 : 4;
    case 4: return oneway ? 1 : 2;
    case 6: return 1;
    default: return oneway ? 1 : 2;
  }
}

const roads = [];
for (const w of roadsSrc) {
  const t = w.tags;
  const c = CLASS[t.highway];
  const oneway = ['yes', '1', 'true'].includes(t.oneway) || t.highway === 'motorway' || (c === 6 && t.oneway !== 'no') || t.junction === 'roundabout' ? 1 : 0;
  let lanes = parseInt(t.lanes, 10);
  if (!Number.isFinite(lanes) || lanes < 1 || lanes > 14) lanes = defaultLanes(c, oneway);
  const laneW = c <= 2 ? 3.3 : c <= 4 ? 3.1 : 2.8;
  let width = parseFloat(t.width);
  if (!Number.isFinite(width) || width < 2.5 || width > 60) width = lanes * laneW + (c <= 3 ? 1.0 : 0.4);
  if (c === 5 && !t.lanes) width = Math.min(width, 6);
  const pts = w.geometry.map((g) => project(g.lat, g.lon));
  if (!pts.some((p) => inBounds(p, 50))) continue;
  const p = [];
  const j = [];
  for (let i = 0; i < pts.length; i++) {
    p.push(q(pts[i][0]), q(pts[i][1]));
    if ((nodeUse.get(w.nodes[i]) ?? 0) > 1) j.push(i);
  }
  const road = { c, l: lanes, o: oneway, w: Math.round(width * 10) / 10, p, j };
  if (t.name) road.n = t.name;
  if (t.bridge === 'yes') road.b = 1;
  roads.push(road);
}
// 낮은 등급부터 그려서 큰 도로가 위에 오도록 정렬
roads.sort((a, b) => b.c - a.c);

// ── 멀티폴리곤 링 조립 ─────────────────────────────────────
const key = (g) => `${g.lat.toFixed(7)},${g.lon.toFixed(7)}`;
// out geom(bbox)로 받은 관계는 영역 밖 좌표가 null → 연속 구간으로 분리
function runs(geom) {
  const out = [];
  let cur = [];
  for (const g of geom) {
    if (g) cur.push(g);
    else if (cur.length) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out.filter((r) => r.length >= 2);
}
function assembleRings(members) {
  const ways = members
    .filter((m) => m.type === 'way' && m.geometry && (m.role === 'outer' || m.role === ''))
    .flatMap((m) => runs(m.geometry));
  const rings = [];
  while (ways.length) {
    let ring = ways.shift();
    let guard = 0;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && guard++ < 10000) {
      const end = key(ring[ring.length - 1]);
      const idx = ways.findIndex((w) => key(w[0]) === end || key(w[w.length - 1]) === end);
      if (idx < 0) break;
      const next = ways.splice(idx, 1)[0];
      if (key(next[0]) !== end) next.reverse();
      ring = ring.concat(next.slice(1));
    }
    rings.push(ring);
  }
  return rings;
}

// Sutherland–Hodgman 직사각형 클리핑
function clipRect(poly, pad = 0) {
  const edges = [
    (p) => p[0] >= minX - pad, (p) => p[0] <= maxX + pad, (p) => p[1] >= minZ - pad, (p) => p[1] <= maxZ + pad,
  ];
  const intersect = [
    (a, b) => lerpAt(a, b, 0, minX - pad), (a, b) => lerpAt(a, b, 0, maxX + pad),
    (a, b) => lerpAt(a, b, 1, minZ - pad), (a, b) => lerpAt(a, b, 1, maxZ + pad),
  ];
  let out = poly;
  for (let e = 0; e < 4; e++) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const ci = edges[e](cur), pi = edges[e](prev);
      if (ci) {
        if (!pi) out.push(intersect[e](prev, cur));
        out.push(cur);
      } else if (pi) out.push(intersect[e](prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}
function lerpAt(a, b, axis, v) {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    s += x1 * z2 - x2 * z1;
  }
  return s / 2;
}

function polygonsOf(filter, pad = 0) {
  const out = [];
  for (const e of elements) {
    if (!filter(e.tags ?? {})) continue;
    let rings = [];
    if (e.type === 'way' && e.geometry) rings = [e.geometry];
    else if (e.type === 'relation' && e.members) rings = assembleRings(e.members);
    for (const r of rings) {
      let poly = r.map((g) => project(g.lat, g.lon));
      if (poly.length > 2 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop();
      if (poly.length < 3) continue;
      poly = clipRect(poly, pad);
      if (poly.length < 3 || Math.abs(area(poly)) < 1) continue;
      out.push({ poly, tags: e.tags ?? {} });
    }
  }
  return out;
}

const flat = (poly) => poly.flatMap(([x, z]) => [q(x), q(z)]);

// ── 물, 공원 ──────────────────────────────────────────────
const water = polygonsOf((t) => t.natural === 'water' || t.waterway === 'riverbank', 300).map((p) => flat(p.poly));
const parks = polygonsOf((t) => t.leisure === 'park' || ['grass', 'recreation_ground', 'forest'].includes(t.landuse), 100)
  .filter((p) => Math.abs(area(p.poly)) > 200)
  .map((p) => flat(p.poly));

// ── 건물 ──────────────────────────────────────────────────
function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function buildingHeight(t, id) {
  const h = parseFloat(String(t.height ?? '').split(';')[0]);
  if (Number.isFinite(h) && h > 2) return Math.min(h, 600);
  const lv = parseFloat(t['building:levels']);
  if (Number.isFinite(lv) && lv > 0) return Math.min(lv * 3.3 + 1.5, 600);
  const r = hash(id);
  switch (t.building) {
    case 'apartments': return 38 + r * 25;
    case 'commercial': case 'office': case 'retail': return 22 + r * 45;
    case 'hotel': return 40 + r * 40;
    case 'house': case 'detached': case 'residential': case 'terrace': return 8 + r * 7;
    case 'church': case 'school': case 'university': case 'public': return 12 + r * 8;
    case 'garage': case 'shed': case 'kiosk': case 'roof': return 3 + r * 2;
    default: return 10 + r * 18;
  }
}
const buildings = [];
const seenBuilding = new Map(); // 같은 건물이 way/relation으로 중복된 경우 제거 (중심·높이 기준)
for (const e of elements) {
  const t = e.tags ?? {};
  if (!t.building || t.building === 'no' || t.building === 'construction' && !t.height) continue;
  let rings = [];
  if (e.type === 'way' && e.geometry) rings = [e.geometry];
  else if (e.type === 'relation' && e.members) rings = assembleRings(e.members);
  for (const r of rings) {
    const poly = r.map((g) => project(g.lat, g.lon));
    if (poly.length > 3 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly.pop();
    if (poly.length < 3 || !inBounds(poly[0], 20)) continue;
    const a = Math.abs(area(poly));
    if (a < 15) continue;
    if (t.building === 'roof') continue; // 주유소 캐노피 등은 지면에서 띄워야 하므로 제외
    const h = Math.round(buildingHeight(t, e.id) * 10) / 10;
    const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
    const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const dk = h > 150 ? `tall:${Math.round(h)}` : `${Math.round(cx)},${Math.round(cz)},${Math.round(h)}`;
    const prev = seenBuilding.get(dk);
    if (prev) {
      if (prev.area >= a) continue;
      buildings.splice(buildings.indexOf(prev.b), 1);
    }
    const b = { h, p: flat(poly), s: Math.floor(hash(e.id + 7) * 1000) };
    seenBuilding.set(dk, { area: a, b });
    buildings.push(b);
  }
}

// ── 신호등 ────────────────────────────────────────────────
const signals = [];
for (const e of elements) {
  if (e.type === 'node' && e.tags?.highway === 'traffic_signals') {
    const p = project(e.lat, e.lon);
    if (inBounds(p)) signals.push(q(p[0]), q(p[1]));
  }
}

// ── 출발 지점(POI): 가장 가까운 큰 도로 위로 스냅 ──────────
const POIS = [
  { id: 'lotte-tower', name: '잠실 롯데월드타워', lat: 37.5122, lon: 127.1012 },
  { id: 'seokchon', name: '석촌호수', lat: 37.5078, lon: 127.1003 },
  { id: 'olympic-park', name: '올림픽공원', lat: 37.5192, lon: 127.1165 },
  { id: 'sports-complex', name: '잠실종합운동장', lat: 37.5153, lon: 127.0728 },
  { id: 'coex', name: '코엑스 · 삼성역', lat: 37.5089, lon: 127.0612 },
  { id: 'seolleung', name: '선릉역 · 테헤란로', lat: 37.5046, lon: 127.0489 },
  { id: 'gangnam', name: '강남역', lat: 37.4981, lon: 127.0279 },
  { id: 'apgujeong-south', name: '도산대로 · 청담', lat: 37.5222, lon: 127.0420 },
];
function snap(x, z, maxClass) {
  let best = null;
  for (const r of roads) {
    if (r.c > maxClass) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i] / 10, z1 = r.p[i + 1] / 10, x2 = r.p[i + 2] / 10, z2 = r.p[i + 3] / 10;
      const dx = x2 - x1, dz = z2 - z1;
      const L2 = dx * dx + dz * dz;
      if (L2 < 1) continue;
      const t = Math.max(0.1, Math.min(0.9, ((x - x1) * dx + (z - z1) * dz) / L2));
      const px = x1 + dx * t, pz = z1 + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (!best || d < best.d) {
        // 오른쪽 차로로 약간 이동 (한국은 우측통행)
        const len = Math.sqrt(L2);
        const off = r.o ? 0 : Math.min(r.w / 4, 4);
        // 진행방향 기준 오른쪽 = (-dz, dx)/len ... z가 남쪽이므로 오른쪽은 (−dz, dx)
        best = { d, x: px + (-dz / len) * off, z: pz + (dx / len) * off, heading: Math.atan2(-dz, dx) };
      }
    }
  }
  return best;
}
const pois = [];
for (const p of POIS) {
  const [x, z] = project(p.lat, p.lon);
  const s = snap(x, z, 3) ?? snap(x, z, 5);
  if (!s) continue;
  pois.push({ id: p.id, name: p.name, x: Math.round(s.x * 10) / 10, z: Math.round(s.z * 10) / 10, heading: Math.round(s.heading * 1000) / 1000 });
}

const out = {
  version: 1,
  name: '서울 강남 · 송파',
  origin,
  bounds: bounds.map((v) => Math.round(v)),
  roads,
  buildings,
  water,
  parks,
  signals,
  pois,
  attribution: `© OpenStreetMap contributors (ODbL 1.0), 추출일 ${raw.fetchedAt?.slice(0, 10) ?? ''}`,
};
await mkdir('public/maps', { recursive: true });
const json = JSON.stringify(out);
await writeFile('public/maps/gangnam-songpa.json', json);
console.log({
  roads: roads.length, buildings: buildings.length, water: water.length, parks: parks.length,
  signals: signals.length / 2, pois: pois.map((p) => p.name).join(', '), sizeMB: (json.length / 1e6).toFixed(2),
  tallest: buildings.reduce((a, b) => Math.max(a, b.h), 0),
});
