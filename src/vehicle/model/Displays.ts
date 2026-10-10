import * as THREE from 'three';
import { MBUX_PALETTE, type MapDrawer } from '../../world/MiniMap';
import { formatDist, maneuverIcon, maneuverText, type Guidance } from '../../nav/Navigator';

export interface DisplayState {
  speedKmh: number;
  rpm: number;
  gear: string;
  x: number;
  z: number;
  heading: number;
  roadName: string;
  accent: string;
  odometerKm: number;
  night: boolean;
  braking: boolean;
  nav: Guidance | null;
}

const FONT = '"Noto Sans KR", system-ui, sans-serif';

/** 12.3" 운전석 디스플레이 (MBUX "스포츠" 스타일을 참고한 2-다이얼 레이아웃) */
export class ClusterDisplay {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;

  constructor() {
    this.canvas.width = 1280;
    this.canvas.height = 494;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  draw(s: DisplayState): void {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#05070a');
    bg.addColorStop(1, '#0d1118');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    this.dial(250, 255, 200, s.speedKmh / 260, s.accent, 'km/h', Math.round(s.speedKmh).toString(), 260, 20);
    this.dial(W - 250, 255, 200, s.rpm / 7000, s.accent, 'x1000 rpm', (s.rpm / 1000).toFixed(1), 7, 1, 6.3 / 7);

    // 가운데: 기어, 도로명, 시계, 주행거리
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = `300 120px ${FONT}`;
    g.fillText(s.gear, W / 2, 230);
    g.font = `400 30px ${FONT}`;
    g.fillStyle = '#c9ccd2';
    g.fillText(s.roadName || '서울 강남·송파', W / 2, 300);
    const now = new Date();
    g.font = `400 26px ${FONT}`;
    g.fillStyle = '#8a8f99';
    g.fillText(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}   ·   18°C   ·   ${s.odometerKm.toFixed(1)} km`, W / 2, 420);
    // 상단 표시등
    g.fillStyle = s.night ? '#3fa9ff' : '#2c3038';
    g.font = `700 24px ${FONT}`;
    g.fillText(s.night ? 'AUTO  ●  LIGHT' : 'DYNAMIC SELECT  ·  COMFORT', W / 2, 60);
    if (s.braking && s.speedKmh < 1) {
      g.fillStyle = '#e53935';
      g.fillText('HOLD', W / 2, 360);
    }
  }

  private dial(cx: number, cy: number, r: number, frac: number, accent: string, unit: string, value: string, max: number, step: number, redFrom = 2) {
    const g = this.g;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    frac = Math.max(0, Math.min(1, frac));
    // 트랙
    g.lineCap = 'round';
    g.lineWidth = 14;
    g.strokeStyle = '#1c222c';
    g.beginPath();
    g.arc(cx, cy, r, a0, a1);
    g.stroke();
    if (redFrom < 1) {
      g.strokeStyle = '#5a1418';
      g.beginPath();
      g.arc(cx, cy, r, a0 + (a1 - a0) * redFrom, a1);
      g.stroke();
    }
    // 진행 호
    const grd = g.createLinearGradient(cx - r, cy, cx + r, cy);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, accent);
    g.strokeStyle = grd;
    g.shadowColor = accent;
    g.shadowBlur = 18;
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac);
    g.stroke();
    g.shadowBlur = 0;
    // 눈금 숫자
    g.fillStyle = '#7b818c';
    g.font = `400 22px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let v = 0; v <= max; v += step) {
      const a = a0 + ((a1 - a0) * v) / max;
      g.fillText(String(v), cx + Math.cos(a) * (r - 40), cy + Math.sin(a) * (r - 40));
    }
    // 바늘
    const a = a0 + (a1 - a0) * frac;
    g.strokeStyle = '#ff3b30';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r - 75), cy + Math.sin(a) * (r - 75));
    g.lineTo(cx + Math.cos(a) * (r + 6), cy + Math.sin(a) * (r + 6));
    g.stroke();
    // 값
    g.fillStyle = '#ffffff';
    g.font = `300 64px ${FONT}`;
    g.fillText(value, cx, cy + 10);
    g.fillStyle = '#8a8f99';
    g.font = `400 20px ${FONT}`;
    g.fillText(unit, cx, cy + 58);
    g.textBaseline = 'alphabetic';
  }
}

/** 11.9" 세로형 중앙 디스플레이 (MBUX 내비 + 인사 + 공조 바) */
export class CenterDisplay {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private readonly g: CanvasRenderingContext2D;
  greeting = '';

  constructor(private readonly raster: MapDrawer | null) {
    this.canvas.width = 714;
    this.canvas.height = 1000;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
  }

  draw(s: DisplayState): void {
    const g = this.g;
    const W = this.canvas.width, H = this.canvas.height;
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, W, H);

    // 내비게이션 지도
    const mapTop = 70, mapH = 640;
    g.save();
    g.beginPath();
    g.rect(0, mapTop, W, mapH);
    g.clip();
    if (this.raster) {
      g.translate(0, mapTop);
      this.raster.draw(g, s.x, s.z, s.heading, W, mapH, 420 + s.speedKmh * 3, 0.68, MBUX_PALETTE);
    }
    g.restore();
    // 차량 아이콘
    const cx = W / 2, cy = mapTop + mapH * 0.68;
    g.fillStyle = s.accent;
    g.shadowColor = s.accent;
    g.shadowBlur = 20;
    g.beginPath();
    g.moveTo(cx, cy - 26);
    g.lineTo(cx + 17, cy + 18);
    g.lineTo(cx, cy + 9);
    g.lineTo(cx - 17, cy + 18);
    g.closePath();
    g.fill();
    g.shadowBlur = 0;

    // 상단 상태 바
    g.fillStyle = '#0b0d12';
    g.fillRect(0, 0, W, mapTop);
    const now = new Date();
    g.fillStyle = '#e8e8ea';
    g.font = `500 30px ${FONT}`;
    g.textAlign = 'left';
    g.fillText(`${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`, 30, 46);
    g.textAlign = 'right';
    g.fillStyle = '#9aa0aa';
    g.font = `400 24px ${FONT}`;
    g.fillText('5G  ·  18°C', W - 30, 46);

    // 도로명 카드 / 내비 회전 안내 카드
    g.textAlign = 'left';
    if (s.nav && s.nav.next) {
      roundRect(g, 24, mapTop + 18, W - 48, 110, 18, 'rgba(20,90,200,0.92)');
      g.fillStyle = '#ffffff';
      g.font = `700 64px ${FONT}`;
      g.fillText(maneuverIcon(s.nav.next.type), 44, mapTop + 98);
      g.font = `700 40px ${FONT}`;
      g.fillText(formatDist(s.nav.nextInM), 130, mapTop + 66);
      g.font = `400 26px ${FONT}`;
      g.fillText(`${maneuverText(s.nav.next.type)}${s.nav.next.road ? ` · ${s.nav.next.road}` : ''}`.slice(0, 24), 130, mapTop + 106);
    } else {
      roundRect(g, 24, mapTop + 18, W - 48, 74, 18, 'rgba(15,18,24,0.88)');
      g.fillStyle = '#ffffff';
      g.font = `500 32px ${FONT}`;
      g.fillText(s.roadName || '주행 중', 48, mapTop + 66);
    }

    // 인사 카드
    const cardY = mapTop + mapH + 16;
    roundRect(g, 24, cardY, W - 48, 130, 22, '#151922');
    g.fillStyle = s.accent;
    g.fillRect(24, cardY + 20, 6, 90);
    g.fillStyle = '#ffffff';
    g.font = `500 34px ${FONT}`;
    g.fillText(this.greeting || '안녕하세요, 좋은 드라이브 되세요', 52, cardY + 58);
    g.fillStyle = '#9aa0aa';
    g.font = `400 24px ${FONT}`;
    g.fillText(s.night ? '야간 주행 · 앰비언트 라이트 켜짐' : '오늘의 드라이브 · 강남에서 송파까지', 52, cardY + 100);

    // 공조 바
    const barY = H - 120;
    g.fillStyle = '#10131a';
    g.fillRect(0, barY, W, 120);
    g.fillStyle = '#ffffff';
    g.font = `300 44px ${FONT}`;
    g.textAlign = 'left';
    g.fillText('22.0°', 34, barY + 74);
    g.textAlign = 'right';
    g.fillText('22.0°', W - 34, barY + 74);
    g.textAlign = 'center';
    g.fillStyle = '#9aa0aa';
    g.font = `400 26px ${FONT}`;
    g.fillText('AUTO  ✻  A/C', W / 2, barY + 70);
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  g.fill();
}
