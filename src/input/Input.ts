/** 모든 입력 장치를 공통 조작값으로 변환합니다. */
export interface ControlState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1(우) .. 1(좌)
  handbrake: boolean;
  /** 주차(P): 쇼룸·메뉴에서 차를 세워 둠 */
  park: boolean;
}

export function createControlState(): ControlState {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, park: true };
}

export type ActionKey = 'up' | 'down' | 'left' | 'right' | 'handbrake';

const KEYMAP: Record<string, ActionKey> = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'handbrake',
};

const approach = (cur: number, target: number, rate: number, dt: number) =>
  cur + Math.max(-rate * dt, Math.min(rate * dt, target - cur));

export class InputSystem {
  readonly state = createControlState();
  private readonly held = new Set<ActionKey>();
  private readonly pressedOnce = new Set<string>();
  enabled = false;
  /** 터치 핸들·기울기 조향 값 (-1 오른쪽 .. 1 왼쪽), 사용하지 않으면 null */
  analogSteer: number | null = null;

  constructor() {
    addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (a) {
        this.held.add(a);
        if (this.enabled) e.preventDefault();
      }
      if (!e.repeat) this.pressedOnce.add(e.code);
    });
    addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.held.delete(a);
    });
    addEventListener('blur', () => this.held.clear());
  }

  /** 이번 프레임에 새로 눌린 키인지 확인하고 소비합니다. */
  consume(code: string): boolean {
    return this.pressedOnce.delete(code);
  }

  clearPressed(): void {
    this.pressedOnce.clear();
  }

  /** 터치 버튼 등 가상 입력 */
  press(action: ActionKey, on: boolean): void {
    if (on) this.held.add(action);
    else this.held.delete(action);
  }

  /**
   * 키보드 디지털 입력을 부드러운 아날로그 값으로 변환합니다.
   * forwardSpeed(m/s)로 S키가 브레이크인지 후진인지 결정합니다.
   */
  update(dt: number, forwardSpeed: number): void {
    const s = this.state;
    if (!this.enabled) {
      s.throttle = 0; s.brake = 0; s.steer = approach(s.steer, 0, 3, dt); s.handbrake = false; s.park = true;
      return;
    }
    const up = this.held.has('up');
    const down = this.held.has('down');
    let steerTarget = (this.held.has('left') ? 1 : 0) - (this.held.has('right') ? 1 : 0);
    let throttle = up ? 1 : 0;
    let brake = down ? 1 : 0;
    let handbrake = this.held.has('handbrake');

    // 게임패드 / 레이싱 휠(표준 매핑) — 연결 시 키보드보다 우선
    const pad = navigator.getGamepads?.().find((p) => p && p.connected);
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      if (Math.abs(ax) > 0.08) steerTarget = -ax;
      const rt = pad.buttons[7]?.value ?? 0;
      const lt = pad.buttons[6]?.value ?? 0;
      if (rt > 0.02) throttle = rt;
      if (lt > 0.02) brake = lt;
      if (pad.buttons[0]?.pressed) handbrake = true;
    }

    s.throttle = approach(s.throttle, throttle, 4, dt);
    s.brake = approach(s.brake, brake, 6, dt);
    // 복귀가 빠르고, 고속에서는 조향 속도를 늦춰 안정감을 줌
    // 터치 핸들·기울기 조향 (아날로그): 손가락 위치를 그대로 따라가도록 빠르게
    if (this.analogSteer !== null) steerTarget = Math.max(-1, Math.min(1, this.analogSteer));
    const steerRate = this.analogSteer !== null ? 6 : steerTarget === 0 ? 4.5 : 2.6 - Math.min(1.4, Math.abs(forwardSpeed) / 30);
    s.steer = approach(s.steer, steerTarget, steerRate, dt);
    s.handbrake = handbrake;
    s.park = false;
  }
}
