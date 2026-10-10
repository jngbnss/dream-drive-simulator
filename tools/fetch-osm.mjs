// OpenStreetMap(Overpass API)에서 강남·송파 도심 데이터를 내려받습니다.
// 데이터: © OpenStreetMap contributors, ODbL 1.0
// - 공용 서버 부하를 줄이기 위해 영역을 타일로 나눠 순차 요청하고, 타일별로 캐시해 중단 후 이어받을 수 있습니다.
// - 한강처럼 거대한 멀티폴리곤(relation)은 영역 경계로 잘린 형상만 따로 받습니다.
// 사용법: node tools/fetch-osm.mjs
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { BBOX } from './bbox.mjs';

const COLS = 6;
const ROWS = 3;
const CACHE = 'tools/data/tiles';

const endpoints = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const wayQuery = (b) => `
[out:json][timeout:150];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street)$"](${b});
  way["building"](${b});
  way["natural"="water"](${b});
  way["waterway"="riverbank"](${b});
  way["leisure"="park"](${b});
  way["landuse"~"^(grass|recreation_ground|forest)$"](${b});
  node["highway"="traffic_signals"](${b});
);
out geom;
`;

const all = `${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}`;
const relationQuery = `
[out:json][timeout:180];
(
  relation["natural"="water"](${all});
  relation["leisure"="park"](${all});
  relation["building"](${all});
);
out geom(${all});
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 9; attempt++) {
    const url = endpoints[attempt % endpoints.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'dream-drive-simulator/0.1 (github.com/jngbnss/dream-drive-simulator)',
        },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(200_000),
      });
      if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
      return (await res.json()).elements;
    } catch (e) {
      lastErr = e;
      console.error('  retry:', String(e.message).slice(0, 120));
      await sleep(4000 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function cached(name, query) {
  const file = `${CACHE}/${name}.json`;
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const els = await overpass(query);
  await writeFile(file, JSON.stringify(els));
  await sleep(1500);
  return els;
}

await mkdir(CACHE, { recursive: true });
const byKey = new Map();
const dLat = (BBOX.north - BBOX.south) / ROWS;
const dLon = (BBOX.east - BBOX.west) / COLS;
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    const s = BBOX.south + r * dLat;
    const w = BBOX.west + c * dLon;
    const b = `${s.toFixed(5)},${w.toFixed(5)},${(s + dLat).toFixed(5)},${(w + dLon).toFixed(5)}`;
    const els = await cached(`tile-${r}-${c}`, wayQuery(b));
    for (const el of els) byKey.set(`${el.type}/${el.id}`, el);
    console.log(`tile ${r * COLS + c + 1}/${ROWS * COLS}: +${els.length} (unique ${byKey.size})`);
  }
}
const rels = await cached('relations', relationQuery);
for (const el of rels) byKey.set(`${el.type}/${el.id}`, el);
console.log(`relations: +${rels.length}`);

const out = JSON.stringify({ bbox: BBOX, fetchedAt: new Date().toISOString(), elements: [...byKey.values()] });
await writeFile('tools/data/osm-raw.json', out);
console.log('saved', (out.length / 1e6).toFixed(1), 'MB');
