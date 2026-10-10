import * as THREE from 'three';
import type { MapDrawer } from '../world/MiniMap';
import type { Guidance } from '../nav/Navigator';
import { buildExterior } from './model/CarExterior';
import { buildInterior } from './model/CarInterior';
import { CenterDisplay, ClusterDisplay, type DisplayState } from './model/Displays';
import { AMBIENTS, CarMaterials } from './model/materials';
import { buildWheel, type WheelVisual } from './model/Wheel';
import type { VehiclePhysics } from './VehiclePhysics';

const STEERING_RATIO = 13;

/** 물리 차량을 따라가는 시각 모델 (보간, 휠, 차체 롤·피치, 조명, 계기판) */
export class CarVisual {
  readonly root = new THREE.Group();
  /** 차체 롤/피치가 적용되는 그룹 (지면 기준 좌표) */
  readonly body = new THREE.Group();
  readonly materials: CarMaterials;
  readonly cluster = new ClusterDisplay();
  readonly center: CenterDisplay;
  readonly cockpitAnchor = new THREE.Object3D();
  private readonly wheels: WheelVisual[] = [];
  private readonly steeringSpin: THREE.Object3D;
  private readonly headlights: THREE.SpotLight[] = [];
  private readonly interiorGlow: THREE.PointLight;
  private roll = 0;
  private pitch = 0;
  private rollVel = 0;
  private pitchVel = 0;
  private displayTimer = 0;
  private accent: string = AMBIENTS[0].color;
  odometerKm = 0;
  lightsOn = false;
  night = false;
  roadName = '';

  /** 진행 중인 내비 안내 (MBUX 화면 표시용) */
  navText: Guidance | null = null;

  constructor(private readonly physics: VehiclePhysics, raster: MapDrawer | null, plateText?: string) {
    this.materials = new CarMaterials(plateText);
    this.center = new CenterDisplay(raster);
    const cfg = physics.cfg;
    this.root.add(this.body);
    this.body.position.y = -cfg.rideHeight;

    const ext = buildExterior(this.materials);
    this.body.add(ext.group);
    const int = buildInterior(this.materials, this.cluster.texture, this.center.texture);
    this.body.add(int.group);
    this.steeringSpin = int.steeringWheel.userData.spin as THREE.Object3D;

    // 휠: 섀시 로컬 좌표(서스펜션 장착점 y = 0)
    physics.wheelPositions.forEach((p, i) => {
      const side = p.z < 0 ? -1 : 1;
      const w = buildWheel(this.materials, cfg.wheelRadius, side, i < 2);
      w.root.position.set(p.x, -cfg.suspension.restLength, p.z);
      this.root.add(w.root);
      this.wheels.push(w);
    });

    // 헤드라이트 빔 (야간에만)
    for (const a of ext.headlightAnchors) {
      const spot = new THREE.SpotLight(0xfff2dc, 0, 70, 0.5, 0.45, 1.4);
      spot.position.copy(a.position);
      spot.target.position.copy(a.position).add(new THREE.Vector3(12, -1.6, a.position.z * 0.3));
      spot.castShadow = false;
      this.body.add(spot, spot.target);
      this.headlights.push(spot);
    }
    this.interiorGlow = new THREE.PointLight(AMBIENTS[0].color, 0, 1.6, 2);
    this.interiorGlow.position.set(0.0, 0.95, 0);
    this.body.add(this.interiorGlow);

    this.cockpitAnchor.position.set(-0.45, 1.24, -0.37);
    this.body.add(this.cockpitAnchor);
  }

  setPaint(i: number) {
    this.materials.setPaint(i);
  }

  setAmbient(i: number) {
    this.materials.setAmbient(i);
    this.accent = AMBIENTS[i].color;
    this.interiorGlow.color.set(this.accent);
  }

  setLights(on: boolean) {
    this.lightsOn = on;
    for (const h of this.headlights) h.intensity = on ? 60 : 0;
    this.materials.headBeam.emissiveIntensity = on ? 3 : 0;
  }

  setNight(night: boolean) {
    this.night = night;
    this.materials.ambient.emissiveIntensity = night ? 1.5 : 0.9;
    this.interiorGlow.intensity = night ? 0.25 : 0;
  }

  update(dt: number, alpha: number): void {
    const p = this.physics;
    const a = p.prevPose, b = p.pose;
    this.root.position.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
    const qa = new THREE.Quaternion(a.qx, a.qy, a.qz, a.qw);
    const qb = new THREE.Quaternion(b.qx, b.qy, b.qz, b.qw);
    this.root.quaternion.copy(qa.slerp(qb, alpha));

    const t = p.telemetry;
    this.odometerKm += (Math.abs(t.forwardSpeed) * dt) / 1000;

    // 차체 롤/피치 (스프링-댐퍼): 가속 시 뒤로, 제동 시 앞으로, 코너링 시 바깥으로
    const targetRoll = THREE.MathUtils.clamp(-t.latAccel * 0.0065, -0.06, 0.06);
    const targetPitch = THREE.MathUtils.clamp(t.longAccel * 0.0048, -0.045, 0.045);
    // 느린 기기(긴 프레임)에서도 발산하지 않도록 작은 스텝으로 나눠 적분
    const k = 70, c = 11;
    const n = Math.min(30, Math.ceil(dt / (1 / 120)));
    const h = n > 0 ? dt / n : 0;
    for (let i = 0; i < n; i++) {
      this.rollVel += ((targetRoll - this.roll) * k - this.rollVel * c) * h;
      this.pitchVel += ((targetPitch - this.pitch) * k - this.pitchVel * c) * h;
      this.roll += this.rollVel * h;
      this.pitch += this.pitchVel * h;
    }
    if (!Number.isFinite(this.roll + this.pitch)) this.roll = this.pitch = this.rollVel = this.pitchVel = 0;
    this.roll = THREE.MathUtils.clamp(this.roll, -0.08, 0.08);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.06, 0.06);
    this.body.rotation.set(this.roll, 0, this.pitch);

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.root.position.y = -p.wheelSuspension[i];
      w.steer.rotation.y = p.wheelSteer[i];
      w.spin.rotation.z = -p.wheelSpin[i];
    }
    this.steeringSpin.rotation.x = -(p.wheelSteer[0] ?? 0) * STEERING_RATIO;

    // 제동등·후진등
    this.materials.taillight.emissiveIntensity = (t.braking ? 4.5 : this.lightsOn ? 1.6 : 0.9);
    this.materials.taillightLed.emissiveIntensity = t.braking ? 7 : this.lightsOn ? 3.5 : 2.2;
    this.materials.reverseLight.emissiveIntensity = t.reversing ? 2 : 0;

    // 계기판은 20Hz로 갱신
    this.displayTimer -= dt;
    if (this.displayTimer <= 0) {
      this.displayTimer = 0.05;
      const s: DisplayState = {
        speedKmh: t.speedKmh, rpm: t.rpm, gear: t.gearLabel, x: b.x, z: b.z, heading: p.heading,
        roadName: this.roadName, accent: this.accent, odometerKm: this.odometerKm, night: this.night, braking: t.braking, nav: this.navText,
      };
      this.cluster.draw(s);
      this.cluster.texture.needsUpdate = true;
      this.center.draw(s);
      this.center.texture.needsUpdate = true;
    }
  }
}
