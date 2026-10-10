import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CarVisual } from '../vehicle/CarVisual';
import type { VehiclePhysics } from '../vehicle/VehiclePhysics';

export type CameraMode = 'showroom' | 'interior' | 'chase' | 'cockpit';
type Rapier = typeof RAPIER;

/**
 * 쇼룸(360° 오빗) / 실내 감상 / 3인칭 추적(GTA 스타일) / 운전석 1인칭.
 * 모드 전환은 0.6초 블렌딩. 마우스 드래그로 둘러보기, 놓으면 천천히 원위치.
 */
export class CameraSystem {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'showroom';
  private readonly orbit: OrbitControls;
  private readonly tmp = new THREE.Vector3();
  private readonly chasePos = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private blend = 1;
  private readonly fromPos = new THREE.Vector3();
  private readonly fromQuat = new THREE.Quaternion();
  private lookYaw = 0;
  private lookPitch = 0;
  private dragging = false;
  private lastDrag = 0;
  private lastX = 0;
  private lastY = 0;
  private autoRotateResume = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly car: CarVisual,
    private readonly physics: VehiclePhysics,
    private readonly R: Rapier,
    private readonly world: RAPIER.World,
  ) {
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 30000);
    this.camera.position.set(6, 2, 6);
    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 3.2;
    this.orbit.maxDistance = 18;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.enablePan = false;
    this.orbit.autoRotate = true;
    this.orbit.autoRotateSpeed = 0.6;
    this.orbit.addEventListener('start', () => {
      this.orbit.autoRotate = false;
      this.autoRotateResume = 6;
    });

    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    addEventListener('pointerup', () => (this.dragging = false));
    addEventListener('pointermove', (e) => {
      if (!this.dragging || this.mode === 'showroom') return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.lookYaw -= dx * 0.005;
      this.lookPitch -= dy * 0.004;
      const maxYaw = this.mode === 'chase' ? Math.PI : 1.9;
      this.lookYaw = THREE.MathUtils.clamp(this.lookYaw, -maxYaw, maxYaw);
      this.lookPitch = THREE.MathUtils.clamp(this.lookPitch, -0.6, 0.5);
      this.lastDrag = performance.now();
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.mode === 'chase') this.chaseZoom = THREE.MathUtils.clamp(this.chaseZoom + e.deltaY * 0.002, 0.7, 1.8);
    }, { passive: true });
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  private chaseZoom = 1;

  setMode(mode: CameraMode) {
    if (mode === this.mode) return;
    this.fromPos.copy(this.camera.position);
    this.fromQuat.copy(this.camera.quaternion);
    this.blend = 0;
    this.mode = mode;
    this.lookYaw = 0;
    this.lookPitch = mode === 'interior' ? -0.05 : 0;
    this.orbit.enabled = mode === 'showroom';
    if (mode === 'showroom') {
      this.orbit.autoRotate = true;
      this.orbit.target.copy(this.car.root.position).add(new THREE.Vector3(0, 0.3, 0));
    }
    if (mode === 'chase') this.chasePos.copy(this.desiredChasePos(new THREE.Vector3()));
  }

  /** 쇼룸 시작 구도: 차량 앞 3/4 각도 */
  frameCar(offset = new THREE.Vector3(4.6, 1.35, 3.4)) {
    const p = this.car.root.position;
    // 세로 화면(휴대폰)은 화면 폭이 좁고 아래쪽을 패널이 가리므로 더 멀리서, 차를 화면 위쪽에 둠
    const portrait = this.camera.aspect < 1;
    const off = offset.clone().multiplyScalar(portrait ? 1.9 : 1);
    this.camera.position.copy(p).add(off.applyQuaternion(this.car.root.quaternion));
    this.orbit.target.copy(p).add(new THREE.Vector3(0, portrait ? -1.4 : 0.3, 0));
    this.orbit.update();
    this.blend = 1;
  }

  cycleDriveView() {
    this.setMode(this.mode === 'chase' ? 'cockpit' : 'chase');
  }

  update(dt: number) {
    const cam = this.camera;
    const carPos = this.car.root.position;
    const q = this.car.root.quaternion;
    const speed = Math.abs(this.physics.telemetry.forwardSpeed);

    // 마우스를 놓으면 시선이 천천히 정면으로 돌아옴 (실내 감상 모드 제외)
    if (!this.dragging && this.mode !== 'interior' && performance.now() - this.lastDrag > 1200) {
      const k = 1 - Math.exp(-dt * 2.2);
      this.lookYaw += (0 - this.lookYaw) * k;
      this.lookPitch += (0 - this.lookPitch) * k;
    }

    let fov = 50;
    if (this.mode === 'showroom') {
      this.orbit.target.lerp(this.tmp.copy(carPos).add(new THREE.Vector3(0, this.camera.aspect < 1 ? -1.4 : 0.3, 0)), 1 - Math.exp(-dt * 6));
      if (!this.orbit.autoRotate && (this.autoRotateResume -= dt) <= 0) this.orbit.autoRotate = true;
      this.orbit.update(dt);
      fov = 45;
    } else if (this.mode === 'chase') {
      const desired = this.desiredChasePos(this.tmp);
      // 임계 감쇠에 가까운 추종 (고속일수록 단단하게)
      const k = 1 - Math.exp(-dt * (5 + speed * 0.08));
      this.chasePos.lerp(desired, k);
      cam.position.copy(this.chasePos);
      this.avoidWalls(carPos, cam.position);
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize();
      this.lookTarget.copy(carPos).addScaledVector(fwd, 2.5).add(new THREE.Vector3(0, 0.35, 0));
      cam.lookAt(this.lookTarget);
      fov = 58 + Math.min(16, speed * 0.28);
    } else {
      // cockpit / interior: 운전석 눈 위치
      this.car.cockpitAnchor.getWorldPosition(cam.position);
      const steerLook = this.mode === 'cockpit' ? (this.physics.wheelSteer[0] ?? 0) * 0.35 : 0;
      const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lookPitch - 0.12,this.lookYaw + steerLook - Math.PI / 2, 0, 'YXZ'));
      cam.quaternion.copy(this.car.body.getWorldQuaternion(new THREE.Quaternion())).multiply(local);
      fov = this.mode === 'interior' ? 72 : 68;
    }

    // 세로 화면은 가로 시야가 좁아지므로 세로 FOV를 넓혀 비슷한 가로 시야를 확보
    if (this.camera.aspect < 1 && this.mode !== 'showroom') fov = Math.min(100, fov * 1.4);

    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.6);
      const t = this.blend * this.blend * (3 - 2 * this.blend);
      cam.position.lerpVectors(this.fromPos, cam.position.clone(), t);
      cam.quaternion.slerpQuaternions(this.fromQuat, cam.quaternion.clone(), t);
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (1 - Math.exp(-dt * 4));
      cam.updateProjectionMatrix();
    }
  }

  private desiredChasePos(out: THREE.Vector3): THREE.Vector3 {
    const q = this.car.root.quaternion;
    const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0).normalize();
    const speed = Math.abs(this.physics.telemetry.forwardSpeed);
    const dist = (6.4 + Math.min(1.8, speed * 0.03)) * this.chaseZoom;
    const height = 2.0 * this.chaseZoom + this.lookPitch * -3;
    const yaw = this.lookYaw;
    const back = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiplyScalar(-dist);
    return out.copy(this.car.root.position).add(back).add(new THREE.Vector3(0, height, 0));
  }

  /** 카메라가 건물을 뚫지 않도록 차 → 카메라 레이캐스트 */
  private avoidWalls(from: THREE.Vector3, camPos: THREE.Vector3) {
    const origin = { x: from.x, y: from.y + 1.0, z: from.z };
    const dir = new THREE.Vector3(camPos.x - origin.x, camPos.y - origin.y, camPos.z - origin.z);
    const len = dir.length();
    if (len < 0.01) return;
    dir.divideScalar(len);
    const ray = new this.R.Ray(origin, { x: dir.x, y: dir.y, z: dir.z });
    const hit = this.world.castRay(ray, len, true, this.R.QueryFilterFlags.EXCLUDE_DYNAMIC);
    if (hit && hit.timeOfImpact < len) {
      const d = Math.max(1.2, hit.timeOfImpact - 0.3);
      camPos.set(origin.x + dir.x * d, origin.y + dir.y * d, origin.z + dir.z * d);
    }
  }
}
