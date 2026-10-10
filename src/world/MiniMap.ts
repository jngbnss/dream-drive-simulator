import type { Region } from './Region';

const ROAD_COLORS = ['#f0b85a', '#f0b85a', '#e4ddcc', '#d2cdc0', '#b4b1aa', '#86878c', '#d6aa5e'];

/**
 * 벡터 미니맵: 로드된 타일의 도로를 차량 기준(진행 방향이 위)으로 그립니다.
 * 내비게이션 경로가 있으면 GTA처럼 굵은 경로선을 위에 그립니다.
 */
export class MapDrawer {
  route: Float32Array | null = null;
  routeColor = '#b65cff';
  destination: { x: number; z: number } | null = null;

  constructor(private readonly region: Region) {}

  draw(g: CanvasRenderingContext2D, x: number, z: number, heading: number, w: number, h: number, viewMeters: number, cyRatio = 0.5) {
    const scale = h / viewMeters;
    const radius = Math.hypot(w, h) / scale / 2 + 30;
    g.save();
    g.fillStyle = '#1b1e24';
    g.fillRect(0, 0, w, h);
    g.translate(w / 2, h * cyRatio);
    g.rotate(-(Math.PI / 2 - heading));
    g.scale(scale, scale);
    g.translate(-x, -z);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    // 등급별로 묶어 그리기 (작은 도로 먼저)
    const buckets: Map<number, number[]> = new Map();
    const cx = x, cz = z;
    this.region.forEachSegment(cx, cz, radius, (s) => {
      let arr = buckets.get(s.road.c);
      if (!arr) buckets.set(s.road.c, (arr = []));
      arr.push(s.x1, s.z1, s.x2, s.z2, s.road.w);
    });
    for (const c of [5, 6, 4, 3, 2, 1, 0]) {
      const arr = buckets.get(c);
      if (!arr) continue;
      g.strokeStyle = ROAD_COLORS[c];
      for (let i = 0; i < arr.length; i += 5) {
        g.lineWidth = Math.max(1.6 / scale, arr[i + 4] * 0.9);
        g.beginPath();
        g.moveTo(arr[i], arr[i + 1]);
        g.lineTo(arr[i + 2], arr[i + 3]);
        g.stroke();
      }
    }
    // 경로
    const r = this.route;
    if (r && r.length >= 4) {
      g.strokeStyle = this.routeColor;
      g.lineWidth = Math.max(5 / scale, 9);
      g.globalAlpha = 0.92;
      g.beginPath();
      g.moveTo(r[0], r[1]);
      for (let i = 2; i < r.length; i += 2) g.lineTo(r[i], r[i + 1]);
      g.stroke();
      g.globalAlpha = 1;
    }
    if (this.destination) {
      g.fillStyle = '#ffd34d';
      g.beginPath();
      g.arc(this.destination.x, this.destination.z, Math.max(9 / scale, 6), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }
}
