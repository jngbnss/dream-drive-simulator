import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export type TimeOfDay = 'day' | 'sunset' | 'night';

interface Preset {
  elevation: number;
  azimuth: number;
  sunColor: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  exposure: number;
  fog: number;
  fogDensity: number;
  turbidity: number;
  rayleigh: number;
}

const PRESETS: Record<TimeOfDay, Preset> = {
  day: { elevation: 52, azimuth: 160, sunColor: 0xfff4e5, sunIntensity: 3.2, hemiSky: 0xcfe3ff, hemiGround: 0x6b6458, hemiIntensity: 1.1, exposure: 0.75, fog: 0xbcd0e0, fogDensity: 0.00045, turbidity: 6, rayleigh: 1.4 },
  sunset: { elevation: 5, azimuth: 250, sunColor: 0xffb06a, sunIntensity: 2.6, hemiSky: 0xf2b6a0, hemiGround: 0x403040, hemiIntensity: 0.7, exposure: 0.62, fog: 0xd99a7a, fogDensity: 0.0006, turbidity: 9, rayleigh: 2.6 },
  night: { elevation: 30, azimuth: 120, sunColor: 0x9fb4ff, sunIntensity: 0.45, hemiSky: 0x2c3c5c, hemiGround: 0x1a1a20, hemiIntensity: 0.75, exposure: 1.15, fog: 0x0b1020, fogDensity: 0.0009, turbidity: 2, rayleigh: 0.2 },
};

/** 하늘, 태양, 반구광, 안개, 반사 환경맵, 차량 주변을 따라가는 그림자 */
export class Environment {
  readonly sun = new THREE.DirectionalLight(0xffffff, 3);
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  private readonly sky = new Sky();
  private readonly pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private readonly sunDir = new THREE.Vector3();
  private nightSky: THREE.Mesh;
  current: TimeOfDay = 'sunset';

  constructor(private readonly scene: THREE.Scene, private readonly renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky.scale.setScalar(20000);
    scene.add(this.sky);
    this.nightSky = makeNightSky();
    scene.add(this.nightSky);

    this.sun.castShadow = true;
    const s = matchMedia('(pointer: coarse)').matches ? 1024 : 2048; // 모바일은 그림자 해상도 절반
    this.sun.shadow.mapSize.set(s, s);
    const cam = this.sun.shadow.camera;
    cam.left = -70; cam.right = 70; cam.top = 70; cam.bottom = -70;
    cam.near = 1; cam.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = new THREE.FogExp2(0xffffff, 0.0005);
  }

  set(time: TimeOfDay) {
    this.current = time;
    const p = PRESETS[time];
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const theta = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = p.turbidity;
    u.rayleigh.value = p.rayleigh;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    this.sky.visible = time !== 'night';
    this.nightSky.visible = time === 'night';

    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    this.renderer.toneMappingExposure = p.exposure;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.set(p.fog);
    fog.density = p.fogDensity;

    // 반사용 환경맵: 하늘만 담은 장면에서 생성
    const envScene = new THREE.Scene();
    if (time === 'night') {
      envScene.background = new THREE.Color(0x0a0e18);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(50, 16, 8), new THREE.MeshBasicMaterial({ color: 0x1a2236, side: THREE.BackSide }));
      envScene.add(glow);
      // 도시 불빛 반사
      for (let i = 0; i < 24; i++) {
        const l = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5), new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffc27a : 0x9fd0ff, side: THREE.DoubleSide }));
        const a = (i / 24) * Math.PI * 2;
        l.position.set(Math.cos(a) * 40, 2 + (i % 4), Math.sin(a) * 40);
        l.lookAt(0, 0, 0);
        envScene.add(l);
      }
    } else {
      const sky = new Sky();
      sky.scale.setScalar(1000);
      const su = sky.material.uniforms;
      su.sunPosition.value.copy(this.sunDir);
      su.turbidity.value = p.turbidity;
      su.rayleigh.value = p.rayleigh;
      su.mieCoefficient.value = 0.005;
      su.mieDirectionalG.value = 0.8;
      envScene.add(sky);
      const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a3a3c }));
      ground.position.y = -5;
      envScene.add(ground);
    }
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = time === 'night' ? 0.6 : 1;
  }

  /** 그림자 카메라가 차량을 따라가도록 */
  follow(target: THREE.Vector3) {
    // 텍셀 단위로 스냅해 그림자 떨림 방지
    const snap = 140 / 2048;
    const tx = Math.round(target.x / snap) * snap;
    const tz = Math.round(target.z / snap) * snap;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunDir.x * 300, Math.max(30, this.sunDir.y * 300), tz + this.sunDir.z * 300);
  }
}

function makeNightSky(): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, '#02040a');
  grd.addColorStop(0.62, '#0b1324');
  grd.addColorStop(1, '#2a2438');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1024, 512);
  // 도시 하늘이라 별은 적고 희미하게 (구 전체에 늘어나므로 아주 작게)
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * 260;
    const r = Math.random() < 0.1 ? 0.6 : 0.35;
    g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.45})`;
    g.beginPath();
    g.arc(Math.random() * 1024, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // 달
  const mg = g.createRadialGradient(780, 120, 0, 780, 120, 40);
  mg.addColorStop(0, '#fffbe8');
  mg.addColorStop(0.45, '#f4efd8');
  mg.addColorStop(0.5, 'rgba(244,239,216,0.25)');
  mg.addColorStop(1, 'rgba(244,239,216,0)');
  g.fillStyle = mg;
  g.fillRect(700, 40, 160, 160);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(15000, 32, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  mesh.renderOrder = -1;
  return mesh;
}
