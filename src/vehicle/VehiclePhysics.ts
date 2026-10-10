import type RAPIER from '@dimforge/rapier3d-compat';
import type { ControlState } from '../input/Input';
import { Drivetrain } from './Drivetrain';
import type { VehicleConfig } from './VehicleConfig';

type Rapier = typeof RAPIER;

/** 휠 순서: 0 FL, 1 FR, 2 RL, 3 RR. 섀시 로컬 좌표: +X 전방, +Y 위, +Z 오른쪽 */
export const WHEEL_FL = 0;
export const WHEEL_FR = 1;

export interface Pose {
  x: number; y: number; z: number;
  qx: number; qy: number; qz: number; qw: number;
}

export interface VehicleTelemetry {
  speedKmh: number;
  forwardSpeed: number;
  rpm: number;
  gearLabel: string;
  load: number;
  /** 0..1 타이어 미끄러짐 정도 (스키드 사운드용) */
  skid: number;
  /** 차체 로컬 가속도 (m/s²): 종방향, 횡방향 */
  longAccel: number;
  latAccel: number;
  braking: boolean;
  reversing: boolean;
}

/** Rapier 레이캐스트 차량 + 드라이브트레인. Three.js에 의존하지 않아 Node에서 테스트할 수 있습니다. */
export class VehiclePhysics {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly drivetrain: Drivetrain;
  readonly telemetry: VehicleTelemetry = {
    speedKmh: 0, forwardSpeed: 0, rpm: 0, gearLabel: 'P', load: 0, skid: 0,
    longAccel: 0, latAccel: 0, braking: false, reversing: false,
  };
  /** 보간용 이전/현재 자세 */
  readonly prevPose: Pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  readonly pose: Pose = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
  readonly wheelSteer = [0, 0, 0, 0];
  readonly wheelSpin = [0, 0, 0, 0];
  readonly wheelSuspension = [0, 0, 0, 0];
  readonly wheelPositions: { x: number; y: number; z: number }[];

  private lastVel = { fwd: 0, lat: 0 };
  private brakeLights = false;

  constructor(R: Rapier, world: RAPIER.World, readonly cfg: VehicleConfig) {
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setTranslation(0, cfg.rideHeight + 0.2, 0)
      .setLinearDamping(0)
      .setAngularDamping(0.6)
      .setCanSleep(false)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);

    const hl = cfg.length / 2;
    const hw = cfg.width / 2 - 0.04;
    // 하부 차체 + 캐빈 두 개의 박스. 질량은 아래에서 직접 지정
    const lower = R.ColliderDesc.cuboid(hl, 0.36, hw).setTranslation(0, 0.02, 0).setDensity(0).setFriction(0.4).setRestitution(0.05);
    const cabin = R.ColliderDesc.cuboid(hl * 0.55, 0.3, hw * 0.82).setTranslation(-0.25, 0.65, 0).setDensity(0).setFriction(0.4);
    world.createCollider(lower, this.body);
    world.createCollider(cabin, this.body);
    const m = cfg.massKg;
    const L = cfg.length, H = 1.2, W = cfg.width;
    this.body.setAdditionalMassProperties(
      m,
      { x: 0, y: cfg.comY, z: 0 },
      { x: (m / 12) * (H * H + W * W), y: (m / 12) * (L * L + W * W), z: (m / 12) * (L * L + H * H) },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );

    this.controller = world.createVehicleController(this.body);
    const fx = cfg.wheelbase / 2;
    const tz = cfg.track / 2;
    this.wheelPositions = [
      { x: fx, y: 0, z: -tz }, // FL (왼쪽 = -Z)
      { x: fx, y: 0, z: tz }, // FR
      { x: -fx, y: 0, z: -tz }, // RL
      { x: -fx, y: 0, z: tz }, // RR
    ];
    const s = cfg.suspension;
    this.wheelPositions.forEach((p, i) => {
      this.controller.addWheel(p, { x: 0, y: -1, z: 0 }, { x: 0, y: 0, z: 1 }, s.restLength, cfg.wheelRadius);
      this.controller.setWheelSuspensionStiffness(i, s.stiffness);
      this.controller.setWheelMaxSuspensionTravel(i, s.maxTravel);
      this.controller.setWheelSuspensionCompression(i, s.compression);
      this.controller.setWheelSuspensionRelaxation(i, s.relaxation);
      this.controller.setWheelMaxSuspensionForce(i, 1e6);
      this.controller.setWheelFrictionSlip(i, cfg.tire.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, cfg.tire.sideFrictionStiffness);
    });

    this.drivetrain = new Drivetrain(cfg);
    this.capturePose(this.pose);
    this.capturePose(this.prevPose);
  }

  /** 위치와 진행 방향(라디안, 0 = +X, 반시계)으로 차를 배치합니다. */
  place(x: number, z: number, heading: number, y = this.cfg.rideHeight + 0.15): void {
    const half = heading / 2;
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.drivetrain.gear = 1;
    this.capturePose(this.pose);
    this.capturePose(this.prevPose);
  }

  /** 현재 위치에서 바로 세우기 */
  resetUpright(): void {
    const t = this.body.translation();
    this.place(t.x, t.z, this.heading, t.y + 0.6);
  }

  get heading(): number {
    const q = this.body.rotation();
    // 전방(+X) 벡터를 회전시켜 수평 각도를 구함
    const fx = 1 - 2 * (q.y * q.y + q.z * q.z);
    const fz = 2 * (q.x * q.z - q.w * q.y);
    return Math.atan2(-fz, fx);
  }

  get isBrakeLightOn(): boolean {
    return this.brakeLights;
  }

  fixedUpdate(dt: number, c: ControlState): void {
    const cfg = this.cfg;
    const ctrl = this.controller;
    const v = this.body.linvel();
    const q = this.body.rotation();
    // 로컬 축
    const fwd = rotate(q, 1, 0, 0);
    const right = rotate(q, 0, 0, 1);
    const fwdSpeed = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
    const latSpeed = v.x * right.x + v.y * right.y + v.z * right.z;
    const speed = Math.hypot(v.x, v.y, v.z);

    // S키: 전진 중이면 브레이크, 거의 정지했으면 후진
    const dtn = this.drivetrain;
    let throttle = c.throttle;
    let brake = c.brake;
    let wantReverse = dtn.gear < 0;
    if (dtn.gear >= 0 && c.brake > 0.1 && fwdSpeed < 0.6 && c.throttle < 0.1) wantReverse = true;
    if (dtn.gear < 0 && c.throttle > 0.1 && fwdSpeed > -0.6) wantReverse = false;
    if (c.park) {
      // P: 전진 기어로 두고 전륜·후륜 모두 제동
      wantReverse = false;
      throttle = 0;
      brake = 1;
    } else if (wantReverse) {
      // 후진 기어에서는 S가 가속, W가 브레이크
      throttle = c.brake;
      brake = c.throttle;
    }

    const topSpeed = cfg.topSpeedKmh / 3.6;
    if (Math.abs(fwdSpeed) > topSpeed) throttle = 0;
    if (wantReverse && fwdSpeed < -25 / 3.6) throttle = 0; // 후진 최고 약 25km/h
    const driveForce = dtn.update(dt, fwdSpeed, throttle, wantReverse);
    const front = (driveForce * cfg.frontTorqueSplit) / 2;
    const rear = (driveForce * (1 - cfg.frontTorqueSplit)) / 2;
    ctrl.setWheelEngineForce(0, front);
    ctrl.setWheelEngineForce(1, front);
    ctrl.setWheelEngineForce(2, rear);
    ctrl.setWheelEngineForce(3, rear);

    // 브레이크: Rapier 브레이크 값은 스텝당 임펄스(N·s)
    const brakeImpulse = (brake * cfg.maxBrakeForceN * dt) / 4;
    // 정지 상태 유지(언덕/미끄러짐 방지)
    const hold = throttle < 0.05 && Math.abs(fwdSpeed) < 0.4 ? (cfg.massKg * 3 * dt) / 4 : 0;
    for (let i = 0; i < 4; i++) {
      const rearHand = c.handbrake && i >= 2 ? (cfg.maxBrakeForceN * 0.6 * dt) / 2 : 0;
      ctrl.setWheelBrake(i, Math.max(brakeImpulse, hold, rearHand));
    }
    // 핸드브레이크 시 뒷바퀴 횡마찰을 줄여 드리프트 유도
    const rearSide = c.handbrake ? 0.45 : cfg.tire.sideFrictionStiffness;
    ctrl.setWheelSideFrictionStiffness(2, rearSide);
    ctrl.setWheelSideFrictionStiffness(3, rearSide);

    // 속도 감응 조향
    const st = cfg.steering;
    const k = Math.min(1, Math.abs(fwdSpeed) / st.falloffSpeed);
    const maxAngle = st.maxAngleRad + (st.highSpeedAngleRad - st.maxAngleRad) * k * (2 - k);
    const steer = c.steer * maxAngle;
    ctrl.setWheelSteering(0, steer);
    ctrl.setWheelSteering(1, steer);

    // 공기저항 + 구름저항
    if (speed > 0.1) {
      const drag = 0.5 * 1.2 * cfg.aero.cdA * speed * speed + cfg.aero.rollingResistance * cfg.massKg * 9.81 * Math.min(1, speed);
      const s = (drag * dt) / speed;
      this.body.applyImpulse({ x: -v.x * s, y: 0, z: -v.z * s }, true);
    }

    // 다운포스로 고속 안정성 보강 (실차의 공력 효과를 과장)
    const down = 0.9 * speed * speed;
    this.body.applyImpulse({ x: 0, y: -down * dt, z: 0 }, true);

    ctrl.updateVehicle(dt);

    // 전복 방지: 크게 기울면 바로 세우는 토크
    const up = rotate(q, 0, 1, 0);
    if (up.y < 0.75) {
      const ax = -up.z, az = up.x; // up × worldUp
      const kTorque = cfg.massKg * 6 * (0.75 - up.y);
      this.body.applyTorqueImpulse({ x: ax * kTorque * dt, y: 0, z: az * kTorque * dt }, true);
    }

    // 텔레메트리
    const t = this.telemetry;
    t.forwardSpeed = fwdSpeed;
    t.speedKmh = Math.abs(fwdSpeed) * 3.6;
    t.rpm = dtn.rpm;
    t.gearLabel = c.park ? 'P' : Math.abs(fwdSpeed) < 0.3 && throttle < 0.05 && dtn.gear > 0 ? 'D' : dtn.gearLabel;
    t.load = throttle;
    t.reversing = dtn.gear < 0;
    t.braking = !c.park && (brake > 0.1 || c.handbrake);
    this.brakeLights = t.braking;
    t.longAccel += ((fwdSpeed - this.lastVel.fwd) / dt - t.longAccel) * 0.15;
    t.latAccel += ((latSpeed - this.lastVel.lat) / dt - t.latAccel) * 0.15;
    this.lastVel.fwd = fwdSpeed;
    this.lastVel.lat = latSpeed;
    let skid = 0;
    for (let i = 0; i < 4; i++) {
      if (ctrl.wheelIsInContact(i)) skid = Math.max(skid, Math.abs(ctrl.wheelSideImpulse(i) ?? 0));
    }
    const slide = Math.min(1, Math.max(0, (Math.abs(latSpeed) - 1.2) / 5));
    const lock = brake > 0.9 && Math.abs(fwdSpeed) > 5 ? 0.4 : 0;
    t.skid = Math.max(slide, lock, c.handbrake && speed > 4 ? 0.7 : 0);

    for (let i = 0; i < 4; i++) {
      this.wheelSteer[i] = ctrl.wheelSteering(i) ?? 0;
      this.wheelSpin[i] = ctrl.wheelRotation(i) ?? 0;
      this.wheelSuspension[i] = ctrl.wheelSuspensionLength(i) ?? cfg.suspension.restLength;
    }
  }

  /** world.step() 직후 호출: 보간용 자세 저장 */
  afterStep(): void {
    Object.assign(this.prevPose, this.pose);
    this.capturePose(this.pose);
  }

  private capturePose(p: Pose): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    p.x = t.x; p.y = t.y; p.z = t.z;
    p.qx = r.x; p.qy = r.y; p.qz = r.z; p.qw = r.w;
  }
}

/** 쿼터니언으로 벡터 회전 */
function rotate(q: { x: number; y: number; z: number; w: number }, x: number, y: number, z: number) {
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
