import { formatDist, maneuverIcon, maneuverText, type Guidance } from '../nav/Navigator';
import type { MapDrawer } from '../world/MiniMap';

/** 주행 HUD: 속도·기어·RPM, 도로명, 원형 미니맵(경로선), GTA 스타일 회전 안내 배너, 토스트 */
export class Hud {
  private readonly root = document.getElementById('hud')!;
  private readonly speed = document.getElementById('speed')!;
  private readonly gear = document.getElementById('gear')!;
  private readonly rpmFill = document.getElementById('rpm-fill')!;
  private readonly road = document.getElementById('road-name')!;
  private readonly help = document.getElementById('help')!;
  private readonly toastEl = document.getElementById('toast')!;
  private readonly banner = document.getElementById('nav-banner')!;
  private readonly mini = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly g = this.mini.getContext('2d')!;
  private toastTimer = 0;
  private miniTimer = 0;

  constructor(private readonly drawer: MapDrawer) {}

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  toggleHelp() {
    this.help.classList.toggle('hidden');
  }

  toast(msg: string, seconds = 2.2) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  setGuidance(g: Guidance | null) {
    if (!g || !g.active || !g.next) {
      this.banner.classList.add('hidden');
      return;
    }
    this.banner.classList.remove('hidden');
    const n = g.next;
    this.banner.innerHTML = `<div class="nb-icon">${maneuverIcon(n.type)}</div>
      <div class="nb-main"><div class="nb-dist">${formatDist(g.nextInM)}</div><div class="nb-text"></div></div>
      <div class="nb-eta">${formatDist(g.remainingM)}<br><small>${Math.max(1, Math.round(g.etaMin))}분</small></div>`;
    this.banner.querySelector('.nb-text')!.textContent = `${maneuverText(n.type)}${n.road ? ` · ${n.road}` : ''}`;
    this.banner.classList.toggle('off', g.offRoute);
  }

  update(dt: number, speedKmh: number, gear: string, rpm: number, roadName: string, x: number, z: number, heading: number, accent: string) {
    this.speed.textContent = Math.round(speedKmh).toString();
    this.gear.textContent = gear;
    this.rpmFill.style.width = `${Math.min(100, (rpm / 6500) * 100)}%`;
    if (this.road.textContent !== roadName) this.road.textContent = roadName;
    if (this.toastTimer > 0 && (this.toastTimer -= dt) <= 0) this.toastEl.classList.remove('show');

    if ((this.miniTimer -= dt) > 0) return;
    this.miniTimer = 1 / 24;
    // GTA5 레이더: 사각형, 차량은 아래쪽 중앙, 속도가 빠를수록 넓게
    const g = this.g, w = this.mini.width, h = this.mini.height;
    const cy = 0.68;
    g.clearRect(0, 0, w, h);
    this.drawer.draw(g, x, z, heading, w, h, 230 + speedKmh * 2.2, cy);
    // 플레이어 화살표 (GTA처럼 흰 화살표 + 그림자)
    g.save();
    g.translate(w / 2, h * cy);
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 4;
    g.fillStyle = '#f4f4f4';
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(7.5, 8);
    g.lineTo(0, 4);
    g.lineTo(-7.5, 8);
    g.closePath();
    g.fill();
    g.restore();
    void accent;
    // 북쪽(N) 블립: 사각형 테두리 위 북쪽 방향 지점
    const a = heading - Math.PI / 2; // 지도 회전각
    const nx = Math.sin(a), ny = -Math.cos(a); // 화면에서 북쪽 방향
    const ox = w / 2, oy = h * cy;
    const tx = nx > 0 ? (w - 12 - ox) / nx : nx < 0 ? (12 - ox) / nx : Infinity;
    const ty = ny > 0 ? (h - 12 - oy) / ny : ny < 0 ? (12 - oy) / ny : Infinity;
    const tt = Math.min(tx, ty);
    g.save();
    g.fillStyle = 'rgba(20,20,20,0.85)';
    g.beginPath();
    g.arc(ox + nx * tt, oy + ny * tt, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = '700 12px "Noto Sans KR", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', ox + nx * tt, oy + ny * tt + 0.5);
    g.restore();
    // 아래 막대: 녹색 = 속도, 파랑 = RPM (GTA의 체력·방어구 막대 자리)
    this.hp.style.width = `${Math.min(100, (speedKmh / 200) * 100)}%`;
    this.ar.style.width = `${Math.min(100, (rpm / 6500) * 100)}%`;
  }

  private readonly hp = document.querySelector('#radar .hp') as HTMLElement;
  private readonly ar = document.querySelector('#radar .ar') as HTMLElement;
}
