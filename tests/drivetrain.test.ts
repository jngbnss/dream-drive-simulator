import { describe, expect, it } from 'vitest';
import { FixedStepAccumulator, FIXED_DT } from '../src/core/GameLoop';
import { Drivetrain, torqueAt, wheelSpeedToRpm } from '../src/vehicle/Drivetrain';
import { GLC_COUPE_INSPIRED as cfg } from '../src/vehicle/VehicleConfig';

describe('FixedStepAccumulator', () => {
  it('누적 시간만큼 고정 스텝을 실행', () => {
    const a = new FixedStepAccumulator();
    expect(a.advance(FIXED_DT * 2.5)).toBe(2);
    expect(a.alpha).toBeCloseTo(0.5, 5);
  });
  it('긴 정지(탭 전환 등) 후 과도한 스텝을 막음', () => {
    const a = new FixedStepAccumulator();
    expect(a.advance(10)).toBeLessThanOrEqual(5);
  });
});

describe('Drivetrain', () => {
  it('토크 곡선 보간', () => {
    expect(torqueAt(cfg.engine.torqueCurve, 3000)).toBe(400);
    expect(torqueAt(cfg.engine.torqueCurve, 100)).toBe(220);
    expect(torqueAt(cfg.engine.torqueCurve, 5400)).toBeCloseTo(341.5, 1);
  });
  it('1단 레드라인 속도가 약 55~65km/h', () => {
    const rpmAt60 = wheelSpeedToRpm(60 / 3.6, cfg.gearbox.ratios[0], cfg.gearbox.finalDrive, cfg.wheelRadius);
    expect(rpmAt60).toBeGreaterThan(5500);
    expect(rpmAt60).toBeLessThan(6800);
  });
  it('가속하면 단계적으로 업시프트', () => {
    const d = new Drivetrain(cfg);
    let speed = 0;
    for (let i = 0; i < 60 * 20; i++) {
      d.update(FIXED_DT, speed, 1, false);
      speed += 3 * FIXED_DT;
    }
    expect(d.gear).toBeGreaterThanOrEqual(5);
  });
});
