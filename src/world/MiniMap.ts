import type { Region } from './Region';

export interface MapPalette {
  land: string;
  water: string;
  roads: string[];
  route: string;
  routeOutline: string;
  minLine: number;
  widthScale: number;
}

/** GTA5 레이더 느낌: 짙은 회청색 땅, 밝은 회색 도로, 보라색 웨이포인트 경로 */
export const GTA_PALETTE: MapPalette = {
  land: '#3c4447',
  water: '#2f5f7a',
  roads: ['#d9dcdc', '#d9dcdc', '#c4c8c9', '#b3b7b9', '#9fa4a6', '#81878a', '#c4c8c9'],
  route: '#b25ee0',
  routeOutline: '#5b2a7a',
  minLine: 2.2,
  widthScale: 1.0,
};

/** MBUX 내비 느낌: 어두운 바탕, 따뜻한 간선도로 */
export const MBUX_PALETTE: MapPalette = {
  land: '#1b1e24',
  water: '#1d3d5c',
  roads: ['#f0b85a', '#f0b85a', '#e4ddcc', '#d2cdc0', '#b4b1aa', '#86878c', '#d6aa5e'],
  route: '#3d9bff',
  routeOutline: '#0e3d7a',
  minLine: 1.6,
  widthScale: 0.9,
};

/**
 * 벡터 지도: 로드된 타일의 도로·물을 차량 기준(진행 방향이 위)으로 그립니다.
 * 경로는 현재 위치 이후 구간만 그려 지나온 길은 사라집니다.
 */
export class MapDrawer {
  route: Float32Array | null = null;
  /** 경로 위 현재 위치 (이 점부터 그림) */
  routeFrom: { seg: number; x: number; z: number } | null = null;
  destination: { x: number; z: number } | null = null;

  constructor(private readonly region: Region) {}

  draw(g: CanvasRenderingContext2D, x: number, z: number, heading: number, w: number, h: number, viewMeters: number, cyRatio = 0.5, palette: MapPalette = GTA_PALETTE) {
    const scale = h / viewMeters;
    const radius = Math.hypot(w, h) / scale + 30;
    g.save();
    g.fillStyle = palette.land;
    g.fillRect(0, 0, w, h);
    g.translate(w / 2, h * cyRatio);
    g.rotate(-(Math.PI / 2 - heading));
    g.scale(scale, scale);
    g.translate(-x, -z);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // 물
    g.fillStyle = palette.water;
    this.region.forEachWater(x, z, radius, (poly) => {
      g.beginPath();
      g.moveTo(poly[0] / 10, poly[1] / 10);
      for (let i = 2; i < poly.length; i += 2) g.lineTo(poly[i] / 10, poly[i + 1] / 10);
      g.closePath();
      g.fill();
    });
    // 도로: 등급·폭별로 묶어 한 번에 그리기 (선분마다 stroke 하지 않음 → 캔버스 비용 대폭 감소)
    const paths = new Map<string, { c: number; w: number; path: Path2D }>();
    this.region.forEachSegment(x, z, radius, (road, x1, z1, x2, z2) => {
      const rw = Math.round(road.w / 2) * 2;
      const key = `${road.c}|${rw}`;
      let e = paths.get(key);
      if (!e) paths.set(key, (e = { c: road.c, w: rw, path: new Path2D() }));
      e.path.moveTo(x1, z1);
      e.path.lineTo(x2, z2);
    });
    const order = [5, 6, 4, 3, 2, 1, 0];
    for (const e of [...paths.values()].sort((a, b) => order.indexOf(a.c) - order.indexOf(b.c))) {
      g.strokeStyle = palette.roads[e.c];
      g.lineWidth = Math.max(palette.minLine / scale, e.w * palette.widthScale);
      g.stroke(e.path);
    }
    // 경로 (현재 위치부터)
    const r = this.route;
    if (r && r.length >= 4) {
      const from = this.routeFrom;
      const path = new Path2D();
      let i0 = 0;
      if (from) {
        path.moveTo(from.x, from.z);
        i0 = from.seg + 1;
      } else path.moveTo(r[0], r[1]);
      for (let i = i0 * 2; i < r.length; i += 2) path.lineTo(r[i], r[i + 1]);
      g.strokeStyle = palette.routeOutline;
      g.lineWidth = Math.max(9 / scale, 14);
      g.stroke(path);
      g.strokeStyle = palette.route;
      g.lineWidth = Math.max(6 / scale, 10);
      g.stroke(path);
    }
    if (this.destination) {
      const d = this.destination;
      g.fillStyle = palette.route;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5 / scale;
      g.beginPath();
      g.arc(d.x, d.z, 8 / scale, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    g.restore();
  }
}
