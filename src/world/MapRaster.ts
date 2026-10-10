import type { MapData } from './MapData';

/**
 * 맵 전체를 한 번 2D 캔버스에 그려 두고(미니맵·MBUX 내비 공용),
 * 매 프레임에는 회전·확대된 일부만 복사합니다.
 */
export class MapRaster {
  readonly canvas: HTMLCanvasElement;
  readonly metersPerPx: number;
  private readonly minX: number;
  private readonly minZ: number;

  constructor(map: MapData, metersPerPx = 2.5) {
    this.metersPerPx = metersPerPx;
    const [minX, minZ, maxX, maxZ] = map.bounds;
    this.minX = minX;
    this.minZ = minZ;
    const w = Math.ceil((maxX - minX) / metersPerPx);
    const h = Math.ceil((maxZ - minZ) / metersPerPx);
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#1d2026';
    g.fillRect(0, 0, w, h);
    const tx = (v: number) => (v / 10 - minX) / metersPerPx;
    const tz = (v: number) => (v / 10 - minZ) / metersPerPx;
    const poly = (p: number[]) => {
      g.beginPath();
      g.moveTo(tx(p[0]), tz(p[1]));
      for (let i = 2; i < p.length; i += 2) g.lineTo(tx(p[i]), tz(p[i + 1]));
      g.closePath();
    };
    g.fillStyle = '#23402e';
    for (const p of map.parks) { poly(p); g.fill(); }
    g.fillStyle = '#1d3d5c';
    for (const p of map.water) { poly(p); g.fill(); }
    g.fillStyle = '#2b2e35';
    for (const b of map.buildings) { poly(b.p); g.fill(); }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const colors = ['#e8b25a', '#e8b25a', '#d9d2c2', '#c9c4b8', '#a9a7a2', '#7e7f84', '#c9a35c'];
    for (const r of map.roads) {
      g.strokeStyle = colors[r.c];
      g.lineWidth = Math.max(1, (r.w * (r.c <= 3 ? 1.2 : 1)) / metersPerPx);
      g.beginPath();
      g.moveTo(tx(r.p[0]), tz(r.p[1]));
      for (let i = 2; i < r.p.length; i += 2) g.lineTo(tx(r.p[i]), tz(r.p[i + 1]));
      g.stroke();
    }
  }

  /**
   * 차량 중심, 진행 방향이 위로 오도록 그립니다.
   * @param heading 차량 heading (0 = +X/동쪽, 반시계 양수)
   * @param viewMeters 화면 높이에 해당하는 거리
   */
  draw(g: CanvasRenderingContext2D, x: number, z: number, heading: number, w: number, h: number, viewMeters: number, cyRatio = 0.5): void {
    const scale = h / viewMeters; // px per meter on screen
    const k = scale * this.metersPerPx;
    g.save();
    g.translate(w / 2, h * cyRatio);
    // 전방(cos h, -sin h) → 화면 위쪽 (0,-1)
    g.rotate(-(Math.PI / 2 - heading));
    g.scale(k, k);
    g.drawImage(this.canvas, -(x - this.minX) / this.metersPerPx, -(z - this.minZ) / this.metersPerPx);
    g.restore();
  }
}
