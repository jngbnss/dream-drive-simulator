import type { ActionKey, InputSystem } from '../input/Input';

export interface TouchActions {
  view(): void;
  lights(): void;
  menu(): void;
  reset(): void;
  nav(): void;
}

const STEER_RANGE = 70; // px: 이만큼 끌면 최대 조향
const TILT_RANGE = 28; // 도: 이만큼 기울이면 최대 조향

/**
 * 휴대폰·태블릿 조작
 *  - 왼쪽: 아날로그 핸들 (손가락을 댄 곳이 중심, 좌우로 끄는 만큼 꺾임)
 *  - 또는 기울기 조향 (휴대폰을 핸들처럼 기울임)
 *  - 오른쪽: 브레이크·가속 페달 (크게, 진동 피드백)
 *  - 위쪽: 목적지·시점·라이트·복귀·전체화면·메뉴
 */
export class TouchControls {
  readonly root = document.createElement('div');
  private tilt = false;
  private tiltZero: number | null = null;
  private readonly knob: HTMLElement;
  private readonly pad: HTMLElement;

  constructor(private readonly input: InputSystem, actions: TouchActions) {
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-steerpad"><div class="t-track"><div class="t-knob"></div></div><span class="t-hint">좌우로 밀어 조향</span></div>
      <div class="t-pedals">
        <button data-a="down" class="brake" aria-label="브레이크·후진">브레이크<small>정지 시 후진</small></button>
        <button data-a="up" class="gas" aria-label="가속">가속</button>
      </div>
      <div class="t-top">
        <button data-f="nav">목적지</button>
        <button data-f="view">시점</button>
        <button data-x="tilt">기울기</button>
        <button data-x="more" aria-label="더보기">⋯</button>
      </div>
      <div class="t-more hidden">
        <button data-f="lights">라이트</button>
        <button data-x="full">전체화면</button>
        <button data-f="reset">도로 복귀</button>
        <button data-f="menu">쇼룸으로</button>
      </div>`;
    document.getElementById('hud')!.appendChild(this.root);
    this.pad = this.root.querySelector('.t-steerpad')!;
    this.knob = this.root.querySelector('.t-knob')!;

    // ── 페달 ──
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-a]')) {
      const a = b.dataset.a as ActionKey;
      const on = (e: PointerEvent) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        input.press(a, true);
        navigator.vibrate?.(10);
      };
      const off = () => {
        b.classList.remove('down');
        input.press(a, false);
      };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    // ── 아날로그 핸들 패드 ──
    let originX = 0;
    let active = -1;
    this.pad.addEventListener('pointerdown', (e) => {
      if (this.tilt) return;
      e.preventDefault();
      active = e.pointerId;
      this.pad.setPointerCapture(e.pointerId);
      originX = e.clientX;
      this.pad.classList.add('down');
      this.setSteer(0);
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== active) return;
      const v = -(e.clientX - originX) / STEER_RANGE; // 왼쪽으로 끌면 +(좌회전)
      this.setSteer(v);
    });
    const release = (e: PointerEvent) => {
      if (e.pointerId !== active) return;
      active = -1;
      this.pad.classList.remove('down');
      this.setSteer(null);
    };
    this.pad.addEventListener('pointerup', release);
    this.pad.addEventListener('pointercancel', release);

    // ── 기능 버튼 ──
    const more = this.root.querySelector('.t-more')!;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-f]')) {
      b.addEventListener('click', () => {
        more.classList.add('hidden');
        actions[b.dataset.f as keyof TouchActions]();
      });
    }
    this.root.querySelector('[data-x="more"]')!.addEventListener('click', () => more.classList.toggle('hidden'));
    this.root.querySelector('[data-x="tilt"]')!.addEventListener('click', (e) => void this.toggleTilt(e.currentTarget as HTMLElement));
    this.root.querySelector('[data-x="full"]')!.addEventListener('click', () => void enterFullscreenLandscape());
    addEventListener('deviceorientation', this.onOrientation);
  }

  private setSteer(v: number | null) {
    const c = v === null ? null : Math.max(-1, Math.min(1, v));
    this.input.analogSteer = c;
    this.knob.style.transform = `translateX(${-(c ?? 0) * STEER_RANGE}px)`;
  }

  private async toggleTilt(btn: HTMLElement) {
    if (!this.tilt) {
      // iOS 13+는 사용자 동작 안에서 권한 요청 필요
      const DOE = (globalThis as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
      if (DOE?.requestPermission) {
        try {
          if ((await DOE.requestPermission()) !== 'granted') return;
        } catch {
          return;
        }
      }
    }
    this.tilt = !this.tilt;
    this.tiltZero = null; // 켤 때의 자세를 중립으로
    btn.classList.toggle('active', this.tilt);
    this.pad.classList.toggle('tilt', this.tilt);
    if (!this.tilt) this.setSteer(null);
  }

  private onOrientation = (e: DeviceOrientationEvent) => {
    if (!this.tilt || e.beta === null || e.gamma === null) return;
    // 가로 화면: 휴대폰을 핸들처럼 돌리면 beta가 변함 / 세로 화면: gamma
    const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
    let raw: number;
    if (angle === 90) raw = e.beta;
    else if (angle === 270 || angle === -90) raw = -e.beta;
    else raw = e.gamma;
    if (this.tiltZero === null) this.tiltZero = raw;
    // 오른쪽으로 기울이면 우회전(음수)
    const v = -(raw - this.tiltZero) / TILT_RANGE;
    this.setSteer(Math.abs(v) < 0.04 ? 0 : v);
  };
}

async function enterFullscreenLandscape() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    // iOS Safari 등 미지원 → 무시 (홈 화면에 추가하면 전체화면으로 실행됨)
  }
}

export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
