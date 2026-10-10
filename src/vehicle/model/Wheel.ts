import * as THREE from 'three';
import type { CarMaterials } from './materials';
import { roundedBox } from './geometry';
import { buildEmblem } from './Emblem';

/**
 * 20인치 5-트윈스포크 휠 + 235/45 R20 근사 타이어 + 브레이크.
 * 구조: root(서스펜션 위치) → steer(조향, Y축) → spin(회전, Z축) / caliper(조향만)
 */
export interface WheelVisual {
  root: THREE.Group;
  steer: THREE.Group;
  spin: THREE.Group;
}

let shared: { tire: THREE.BufferGeometry; barrel: THREE.BufferGeometry; spoke: THREE.BufferGeometry; hub: THREE.BufferGeometry; disc: THREE.BufferGeometry; caliper: THREE.BufferGeometry; lip: THREE.BufferGeometry } | null = null;

function geometries(radius: number) {
  if (shared) return shared;
  const w = 0.245;
  const rimR = 0.254;
  // 타이어 단면 (Lathe: x = 반경, y = 축방향)
  const prof: THREE.Vector2[] = [];
  const sidewallTop = radius;
  const n = 14;
  prof.push(new THREE.Vector2(rimR - 0.005, -w / 2 + 0.02));
  prof.push(new THREE.Vector2(rimR + 0.02, -w / 2 + 0.005));
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / n;
    const r = sidewallTop - 0.035 + 0.035 * Math.cos(a) * 1.0;
    prof.push(new THREE.Vector2(Math.max(r, rimR + 0.03) + (i > 0 && i < n ? 0.0 : 0), (w / 2 - 0.01) * Math.sin(a)));
  }
  prof.push(new THREE.Vector2(rimR + 0.02, w / 2 - 0.005));
  prof.push(new THREE.Vector2(rimR - 0.005, w / 2 - 0.02));
  const tire = new THREE.LatheGeometry(prof, 48);
  tire.rotateX(Math.PI / 2); // 축 = Z

  const barrel = new THREE.CylinderGeometry(rimR, rimR, w - 0.03, 40, 1, true);
  barrel.rotateX(Math.PI / 2);

  const lip = new THREE.TorusGeometry(rimR - 0.004, 0.009, 8, 48);

  // 트윈 스포크 하나 (바깥면 쪽, 약간 오목)
  const spoke = roundedBox(rimR * 0.92, 0.028, 0.03, 0.01, 2);
  spoke.translate(rimR * 0.46 + 0.04, 0, 0);

  const hub = new THREE.CylinderGeometry(0.075, 0.08, 0.05, 24);
  hub.rotateX(Math.PI / 2);

  const disc = new THREE.CylinderGeometry(0.19, 0.19, 0.028, 36);
  disc.rotateX(Math.PI / 2);

  const caliper = roundedBox(0.16, 0.1, 0.07, 0.025);
  shared = { tire, barrel, spoke, hub, disc, caliper, lip };
  return shared;
}

/** side: -1 = 왼쪽(휠 바깥면이 -Z), 1 = 오른쪽 */
export function buildWheel(m: CarMaterials, radius: number, side: number, front: boolean): WheelVisual {
  const g = geometries(radius);
  const root = new THREE.Group();
  const steer = new THREE.Group();
  const spin = new THREE.Group();
  root.add(steer);
  steer.add(spin);

  const tire = new THREE.Mesh(g.tire, m.tire);
  tire.castShadow = true;
  spin.add(tire);
  const barrel = new THREE.Mesh(g.barrel, m.rimDark);
  spin.add(barrel);

  // 바깥면 (side 방향으로 오프셋)
  const face = new THREE.Group();
  face.position.z = side * 0.085;
  face.scale.z = side; // 좌우 대칭
  spin.add(face);
  const lip = new THREE.Mesh(g.lip, m.rim);
  lip.position.z = 0.02;
  face.add(lip);
  for (let i = 0; i < 5; i++) {
    for (const off of [-0.075, 0.075]) {
      const s = new THREE.Mesh(g.spoke, m.rim);
      s.rotation.z = (i / 5) * Math.PI * 2 + off;
      s.position.z = 0.006;
      s.castShadow = false;
      face.add(s);
    }
  }
  const hub = new THREE.Mesh(g.hub, m.rim);
  face.add(hub);
  // 센터캡 삼각별
  const cap = buildEmblem(0.07, m.chrome, { backing: m.blackGloss, depth: 0.003 });
  cap.position.z = 0.027;
  face.add(cap);

  // 브레이크 (회전하지 않음)
  const disc = new THREE.Mesh(g.disc, m.brakeDisc);
  disc.position.z = side * 0.02;
  steer.add(disc);
  const caliper = new THREE.Mesh(g.caliper, m.caliper);
  caliper.position.set(front ? -0.12 : 0.12, 0.1, side * 0.04);
  caliper.rotation.z = front ? 0.6 : -0.6;
  steer.add(caliper);

  return { root, steer, spin };
}
