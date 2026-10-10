import type { VehicleConfig } from './VehicleConfig';

/** 토크 곡선 선형 보간 (Nm) */
export function torqueAt(curve: [number, number][], rpm: number): number {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [r1, t1] = curve[i];
    if (rpm <= r1) {
      const [r0, t0] = curve[i - 1];
      return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0);
    }
  }
  return curve[curve.length - 1][1];
}

/** 바퀴 속도(m/s) → 엔진 RPM */
export function wheelSpeedToRpm(speed: number, ratio: number, finalDrive: number, wheelRadius: number): number {
  return (Math.abs(speed) / wheelRadius) * ratio * finalDrive * (60 / (2 * Math.PI));
}

/**
 * 자동 변속기 + 엔진 모델. 출력은 바퀴에 전달되는 총 구동력(N).
 * gear: -1 = R, 0 = N/P, 1.. = 전진 기어
 */
export class Drivetrain {
  gear = 1;
  rpm: number;
  private shiftTimer = 0;
  /** 0..1 엔진 부하 (사운드용) */
  load = 0;

  constructor(private readonly cfg: VehicleConfig) {
    this.rpm = cfg.engine.idleRpm;
  }

  get ratio(): number {
    const g = this.cfg.gearbox;
    if (this.gear < 0) return g.reverse;
    if (this.gear === 0) return 0;
    return g.ratios[this.gear - 1];
  }

  get shifting(): boolean {
    return this.shiftTimer > 0;
  }

  /**
   * @param speed 차량 전진 속도 (m/s, 후진이면 음수)
   * @param throttle 0..1
   * @param wantReverse 후진 요청 여부
   */
  update(dt: number, speed: number, throttle: number, wantReverse: boolean): number {
    const { engine, gearbox, wheelRadius } = this.cfg;

    // 방향 전환은 거의 정지 상태에서만
    if (wantReverse && this.gear > 0 && speed < 1) this.gear = -1;
    if (!wantReverse && this.gear < 0 && speed > -1) this.gear = 1;

    const wheelRpm = wheelSpeedToRpm(speed, this.ratio || gearbox.ratios[0], gearbox.finalDrive, wheelRadius);
    // 저속에서는 토크컨버터 슬립을 흉내내 RPM이 스로틀에 따라 오름
    const slipRpm = engine.idleRpm + throttle * 1800 * Math.max(0, 1 - Math.abs(speed) / 6);
    const targetRpm = Math.min(engine.redlineRpm + 100, Math.max(wheelRpm, slipRpm));
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * 12);

    if (this.shiftTimer > 0) this.shiftTimer -= dt;
    else if (this.gear > 0) {
      if (this.rpm > gearbox.upshiftRpm && this.gear < gearbox.ratios.length) this.shift(+1);
      else if (this.gear > 1) {
        const lowerRpm = wheelSpeedToRpm(speed, gearbox.ratios[this.gear - 2], gearbox.finalDrive, wheelRadius);
        // 킥다운: 강하게 밟으면 더 일찍 내림
        const kickdown = throttle > 0.85 ? 3800 : gearbox.downshiftRpm + throttle * 1400;
        if (this.rpm < gearbox.downshiftRpm || (lowerRpm < kickdown && lowerRpm < gearbox.upshiftRpm - 600)) {
          if (this.rpm < kickdown) this.shift(-1);
        }
      }
    }

    this.load = throttle;
    if (this.shifting || this.gear === 0) return 0;
    const limiter = this.rpm >= engine.redlineRpm ? 0 : 1;
    const torque = torqueAt(engine.torqueCurve, this.rpm) * throttle * limiter;
    const force = (torque * this.ratio * gearbox.finalDrive * gearbox.efficiency) / wheelRadius;
    return this.gear < 0 ? -force : force;
  }

  private shift(dir: number): void {
    this.gear += dir;
    this.shiftTimer = this.cfg.gearbox.shiftTime;
  }

  get gearLabel(): string {
    if (this.gear < 0) return 'R';
    if (this.gear === 0) return 'N';
    return `D${this.gear}`;
  }
}
