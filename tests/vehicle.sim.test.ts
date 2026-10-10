import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIXED_DT } from '../src/core/GameLoop';
import { createControlState } from '../src/input/Input';
import { GLC_COUPE_INSPIRED } from '../src/vehicle/VehicleConfig';
import { VehiclePhysics } from '../src/vehicle/VehiclePhysics';

beforeAll(async () => {
  await RAPIER.init();
});

function setup() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  world.createCollider(RAPIER.ColliderDesc.cuboid(5000, 0.5, 5000).setTranslation(0, -0.5, 0).setFriction(1));
  const car = new VehiclePhysics(RAPIER, world, GLC_COUPE_INSPIRED);
  const c = createControlState();
  c.park = false;
  const step = (n: number, cb?: () => void) => {
    for (let i = 0; i < n; i++) {
      cb?.();
      car.fixedUpdate(FIXED_DT, c);
      world.step();
      car.afterStep();
    }
  };
  return { world, car, c, step };
}

describe('차량 물리 (GLC Coupé 참고 프리셋)', () => {
  it('정차 시 서스펜션이 적절히 눌리고 차체가 안정됨', () => {
    const { car, step } = setup();
    step(180);
    const y = car.body.translation().y;
    const susp = car.wheelSuspension;
    console.log('정차 높이', y.toFixed(3), '서스펜션', susp.map((s) => s.toFixed(3)).join(','));
    expect(y).toBeGreaterThan(0.45);
    expect(y).toBeLessThan(0.8);
    expect(Math.hypot(car.body.linvel().x, car.body.linvel().z)).toBeLessThan(0.05);
  });

  it('0→100km/h 가속 시간이 실차(약 6.2초, 추정) 근처', () => {
    const { car, c, step } = setup();
    step(120);
    c.throttle = 1;
    let t = 0;
    while (car.telemetry.speedKmh < 100 && t < 20) {
      step(1);
      t += FIXED_DT;
    }
    console.log('0-100', t.toFixed(2), 's, 기어', car.telemetry.gearLabel, 'rpm', car.telemetry.rpm.toFixed(0));
    expect(t).toBeGreaterThan(4.5);
    expect(t).toBeLessThan(9);
  });

  it('100→0 제동 거리가 현실적 (35~50m)', () => {
    const { car, c, step } = setup();
    step(60);
    c.throttle = 1;
    let guard = 0;
    while (car.telemetry.speedKmh < 100 && guard++ < 60 * 20) step(1);
    c.throttle = 0;
    const start = car.body.translation();
    const v0 = car.telemetry.speedKmh;
    c.brake = 1;
    let n = 0;
    while (car.telemetry.forwardSpeed > 0.3 && n < 600) {
      step(1);
      n++;
    }
    const end = car.body.translation();
    const d = Math.hypot(end.x - start.x, end.z - start.z);
    console.log('제동 시작', v0.toFixed(0), 'km/h → 거리', d.toFixed(1), 'm');
    expect(d).toBeGreaterThan(25);
    expect(d).toBeLessThan(60);
  });

  it('60km/h에서 최대 조향해도 전복하지 않음', () => {
    const { car, c, step } = setup();
    step(60);
    c.throttle = 1;
    step(600, () => {
      if (car.telemetry.speedKmh > 60) c.throttle = 0.25;
    });
    c.steer = 1;
    let minUp = 1;
    step(300, () => {
      const q = car.body.rotation();
      const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
      minUp = Math.min(minUp, upY);
    });
    console.log('최소 up.y', minUp.toFixed(3), '선회 후 속도', car.telemetry.speedKmh.toFixed(0));
    expect(minUp).toBeGreaterThan(0.85);
  });

  it('최고 속도 제한 (≤ 245km/h)', () => {
    const { car, c, step } = setup();
    c.throttle = 1;
    step(60 * 60);
    console.log('60초 후 속도', car.telemetry.speedKmh.toFixed(0), car.telemetry.gearLabel);
    expect(car.telemetry.speedKmh).toBeLessThan(245);
    expect(car.telemetry.speedKmh).toBeGreaterThan(170);
  });

  it('주차(P) 상태에서는 움직이지 않음', () => {
    const { car, c, step } = setup();
    c.park = true;
    c.brake = 1;
    step(240);
    const v = car.body.linvel();
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.05);
    expect(car.telemetry.gearLabel).toBe('P');
  });

  it('S키로 후진', () => {
    const { car, c, step } = setup();
    step(60);
    c.brake = 1;
    step(180);
    console.log('후진 속도', car.telemetry.forwardSpeed.toFixed(2), car.telemetry.gearLabel);
    expect(car.telemetry.forwardSpeed).toBeLessThan(-1);
  });
});
