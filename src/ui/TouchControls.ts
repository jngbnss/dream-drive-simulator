import type { ActionKey, InputSystem } from '../input/Input';

export interface TouchActions {
  view(): void;
  lights(): void;
  menu(): void;
  reset(): void;
  nav(): void;
}

/** 휴대폰·태블릿용 화면 버튼: 왼쪽 조향, 오른쪽 브레이크·가속 페달, 위쪽 기능 버튼 */
export class TouchControls {
  readonly root = document.createElement('div');

  constructor(input: InputSystem, actions: TouchActions) {
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-steer">
        <button data-a="left" aria-label="왼쪽">◀</button>
        <button data-a="right" aria-label="오른쪽">▶</button>
      </div>
      <div class="t-pedals">
        <button data-a="down" class="brake" aria-label="브레이크·후진">브레이크</button>
        <button data-a="up" class="gas" aria-label="가속">가속</button>
      </div>
      <div class="t-top">
        <button data-f="nav">목적지</button>
        <button data-f="view">시점</button>
        <button data-f="lights">라이트</button>
        <button data-f="reset">복귀</button>
        <button data-f="menu">메뉴</button>
      </div>`;
    document.getElementById('hud')!.appendChild(this.root);

    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-a]')) {
      const a = b.dataset.a as ActionKey;
      const on = (e: PointerEvent) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        input.press(a, true);
        navigator.vibrate?.(8);
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
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-f]')) {
      b.addEventListener('click', () => actions[b.dataset.f as keyof TouchActions]());
    }
  }
}

export function isTouchDevice(): boolean {
  return matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
}
