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
    this.miniTimer = 1 / 20;
    const g = this.g, w = this.mini.width, h = this.mini.height;
    g.save();
    g.clearRect(0, 0, w, h);
    g.beginPath();
    g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    g.clip();
    this.drawer.draw(g, x, z, heading, w, h, 360 + speedKmh * 2, 0.5);
    g.translate(w / 2, h / 2);
    g.fillStyle = accent;
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(6.5, 7);
    g.lineTo(0, 3.5);
    g.lineTo(-6.5, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // 북쪽 표시
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(heading - Math.PI / 2);
    g.fillStyle = '#ff5a4f';
    g.font = '700 13px "Noto Sans KR", sans-serif';
    g.textAlign = 'center';
    g.fillText('N', 0, -h / 2 + 18);
    g.restore();
  }
}
