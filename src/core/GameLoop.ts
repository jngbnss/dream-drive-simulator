/**
 * 고정 시간 간격 물리 + 가변 렌더링 루프.
 * 물리는 항상 FIXED_DT로 진행하고, 렌더링은 두 물리 상태 사이를 alpha로 보간합니다.
 */
export const FIXED_DT = 1 / 60;
const MAX_FRAME_DT = 0.25;
const MAX_STEPS_PER_FRAME = 5;

export interface LoopCallbacks {
  /** 프레임 시작 (물리 스텝 전) */
  begin?(): void;
  fixedUpdate(dt: number): void;
  render(dt: number, alpha: number): void;
}

export class FixedStepAccumulator {
  private acc = 0;

  /** 경과 시간을 누적하고 이번 프레임에 실행할 물리 스텝 수를 반환합니다. */
  advance(frameDt: number): number {
    this.acc += Math.min(Math.max(frameDt, 0), MAX_FRAME_DT);
    let steps = 0;
    while (this.acc >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.acc -= FIXED_DT;
      steps++;
    }
    // 처리하지 못한 시간은 버려서 "죽음의 나선"을 방지
    if (steps === MAX_STEPS_PER_FRAME && this.acc >= FIXED_DT) this.acc = 0;
    return steps;
  }

  get alpha(): number {
    return this.acc / FIXED_DT;
  }
}

export class GameLoop {
  private readonly stepper = new FixedStepAccumulator();
  private last = 0;
  private running = false;

  constructor(private readonly cb: LoopCallbacks) {}

  start(): void {
    this.running = true;
    this.last = performance.now();
    requestAnimationFrame(this.tick);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    const dt = (now - this.last) / 1000;
    this.last = now;
    this.cb.begin?.();
    const steps = this.stepper.advance(dt);
    for (let i = 0; i < steps; i++) this.cb.fixedUpdate(FIXED_DT);
    this.cb.render(Math.min(dt, MAX_FRAME_DT), this.stepper.alpha);
    requestAnimationFrame(this.tick);
  };
}
