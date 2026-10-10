import * as THREE from 'three';
import type { CarMaterials } from './materials';
import { panelYZ, roundedBox, roundedRect } from './geometry';

/**
 * GLC(X254/C254) 실내 레이아웃 참고:
 *  - 독립형 12.3" 운전석 디스플레이 + 11.9" 세로형 중앙 디스플레이(운전석 쪽으로 기울어짐)
 *  - 날개형 대시보드, 우드 트림 띠 아래 앰비언트 라이트
 *  - 납작한 "제트 윙" 송풍구 (중앙 2 + 양끝 2)
 *  - 3-트윈스포크 스티어링(터치 컨트롤), 스티어링 칼럼 오른쪽 DIRECT SELECT 변속 레버
 *  - 앞좌석 일체형 헤드레스트 스포츠 시트, 플로팅 센터콘솔, 도어 장착형 시트 조절 스위치
 * 좌표: +X 전방, +Z 오른쪽, 지면 y=0. 왼쪽 핸들(운전석 z = -0.37)
 */
export const STEERING_CENTER = new THREE.Vector3(0.08, 0.915, -0.37);

export interface InteriorParts {
  group: THREE.Group;
  steeringWheel: THREE.Group;
  clusterScreen: THREE.Mesh;
  centerScreen: THREE.Mesh;
}

export function buildInterior(m: CarMaterials, clusterTex: THREE.Texture, centerTex: THREE.Texture): InteriorParts {
  const group = new THREE.Group();
  group.name = 'Interior';
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // ── 실내 셸 (안쪽에서 보이는 바닥·벽) ─────────────────────
  const shell = new THREE.Mesh(openTopBox(2.64, 0.72, 1.62), m.interiorShell);
  shell.position.set(-0.62, 0.4, 0);
  group.add(shell);
  add(new THREE.PlaneGeometry(2.5, 1.5).rotateX(-Math.PI / 2), m.carpet, -0.62, 0.42, 0);

  // 헤드라이너 (지붕 안쪽)
  const hl = add(roundedBox(1.25, 0.03, 1.12, 0.012), m.headliner, -0.62, 1.51, 0);
  hl.rotation.z = 0.02;
  for (const s of [-1, 1]) {
    // A필러 내장 트림
    const ap = add(roundedBox(0.72, 0.035, 0.03, 0.012), m.softDash, 0.26, 1.28, s * 0.635);
    ap.rotation.z = -0.58;
    ap.rotation.x = s * 0.2;
    // C필러 내장
    const cp = add(roundedBox(0.7, 0.07, 0.06, 0.02), m.headliner, -1.55, 1.3, s * 0.66);
    cp.rotation.z = 0.5;
  }

  // ── 대시보드 ──────────────────────────────────────────────
  add(roundedBox(0.42, 0.13, 1.5, 0.05), m.softDash, 0.6, 1.0, 0); // 상단 패드
  const wing = add(roundedBox(0.16, 0.06, 1.52, 0.025), m.leatherBlack, 0.42, 0.95, 0); // 날개형 중간 레이어
  wing.rotation.z = -0.12;
  const trim = add(roundedBox(0.05, 0.05, 1.48, 0.012), m.trimWood, 0.36, 0.895, 0); // 우드 트림 띠
  trim.rotation.z = -0.1;
  add(new THREE.BoxGeometry(0.004, 0.003, 1.46), m.ambient, 0.345, 0.868, 0); // 앰비언트 라인
  add(roundedBox(0.36, 0.34, 1.5, 0.06), m.softDash, 0.52, 0.68, 0); // 하단 대시
  const glove = add(roundedBox(0.03, 0.14, 0.5, 0.02), m.leatherBlack, 0.35, 0.74, 0.38);
  glove.rotation.z = -0.15;

  // 송풍구: 중앙 2개 + 양 끝 2개
  for (const vz of [-0.09, 0.09, -0.68, 0.68]) {
    const outer = Math.abs(vz) > 0.5;
    const v = new THREE.Group();
    v.position.set(outer ? 0.4 : 0.375, 0.945, vz);
    const w = outer ? 0.12 : 0.16;
    v.add(new THREE.Mesh(panelYZ(roundedRect(w, 0.055, 0.025), 0.02), m.chrome));
    const inner = new THREE.Mesh(panelYZ(roundedRect(w - 0.012, 0.043, 0.02), 0.022), m.blackMatte);
    inner.position.x = 0.002;
    v.add(inner);
    for (let i = -1; i <= 1; i++) {
      const louver = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, w - 0.02), m.satinAlu);
      louver.position.set(-0.012, i * 0.012, 0);
      v.add(louver);
    }
    v.rotation.z = -0.1;
    group.add(v);
  }

  // ── 운전석 디스플레이 (12.3", 독립형) ─────────────────────
  const clusterW = 0.29, clusterH = 0.112;
  const clusterG = new THREE.Group();
  clusterG.position.set(0.43, 1.08, -0.37);
  clusterG.rotation.z = -0.22; // 위쪽이 앞으로 (운전자 눈을 향함)
  clusterG.add(new THREE.Mesh(roundedBox(0.012, clusterH + 0.016, clusterW + 0.016, 0.006), m.pianoBlack));
  const clusterScreen = new THREE.Mesh(new THREE.PlaneGeometry(clusterW, clusterH), screenMaterial(clusterTex));
  clusterScreen.rotation.y = -Math.PI / 2;
  clusterScreen.position.x = -0.0065;
  clusterG.add(clusterScreen);
  group.add(clusterG);

  // ── 중앙 디스플레이 (11.9" 세로형) ───────────────────────
  const centerW = 0.175, centerH = 0.245;
  const centerG = new THREE.Group();
  centerG.position.set(0.345, 0.825, -0.015);
  centerG.rotation.order = 'YZX';
  centerG.rotation.y = -0.1; // 운전석 쪽으로
  centerG.rotation.z = -0.42;
  centerG.add(new THREE.Mesh(roundedBox(0.014, centerH + 0.014, centerW + 0.014, 0.008), m.pianoBlack));
  const centerScreen = new THREE.Mesh(new THREE.PlaneGeometry(centerW, centerH), screenMaterial(centerTex));
  centerScreen.rotation.y = -Math.PI / 2;
  centerScreen.position.x = -0.0075;
  centerG.add(centerScreen);
  group.add(centerG);

  // ── 센터 콘솔 ─────────────────────────────────────────────
  add(roundedBox(0.62, 0.2, 0.25, 0.05), m.softDash, 0.0, 0.55, 0).rotation.z = 0.12;
  add(roundedBox(0.5, 0.025, 0.21, 0.01), m.trimWood, -0.03, 0.665, 0).rotation.z = 0.12;
  add(roundedBox(0.16, 0.012, 0.12, 0.01), m.blackMatte, 0.12, 0.68, 0).rotation.z = 0.12; // 무선 충전
  add(roundedBox(0.08, 0.008, 0.06, 0.004), m.pianoBlack, -0.1, 0.682, 0.02); // 터치패드
  add(roundedBox(0.36, 0.1, 0.24, 0.05), m.leatherBlack, -0.55, 0.68, 0); // 암레스트
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.5, 0.003, 0.003), m.ambient, -0.05, 0.6, s * 0.128);

  // ── 스티어링 휠 ──────────────────────────────────────────
  const column = add(new THREE.CylinderGeometry(0.035, 0.05, 0.32, 16), m.blackMatte, 0.27, 0.92, -0.37);
  column.rotation.z = -(Math.PI / 2 + 0.35);
  const steeringWheel = new THREE.Group();
  steeringWheel.position.copy(STEERING_CENTER);
  const swTilt = new THREE.Group();
  swTilt.rotation.z = -0.4; // 위쪽이 앞으로 기울어진 림
  steeringWheel.add(swTilt);
  const swSpin = new THREE.Group();
  swSpin.name = 'SteeringSpin';
  swTilt.add(swSpin);
  steeringWheel.userData.spin = swSpin;
  buildSteeringWheel(m, swSpin);
  group.add(steeringWheel);
  // DIRECT SELECT 레버 (칼럼 오른쪽) + 왼쪽 콤비네이션 스위치
  add(new THREE.CylinderGeometry(0.006, 0.008, 0.075, 10), m.blackGloss, 0.2, 0.9, -0.255).rotation.x = Math.PI / 2 - 0.2;
  add(new THREE.CylinderGeometry(0.007, 0.009, 0.13, 10), m.blackMatte, 0.18, 0.9, -0.48).rotation.x = Math.PI / 2 + 0.25;
  // 페달
  for (const [pz, w] of [[-0.42, 0.06], [-0.3, 0.1]] as [number, number][]) {
    add(roundedBox(0.02, 0.1, w, 0.008), m.satinAlu, 0.62, 0.55, pz).rotation.z = -0.5;
  }

  // ── 시트 ─────────────────────────────────────────────────
  for (const s of [-1, 1]) buildSeat(m, group, -0.6, s * 0.37);
  add(roundedBox(0.5, 0.14, 1.32, 0.06), m.leatherBlack, -1.38, 0.66, 0); // 뒷좌석 쿠션
  add(roundedBox(0.14, 0.62, 1.34, 0.06), m.leatherBlack, -1.66, 1.0, 0).rotation.z = 0.32;
  for (const z of [-0.42, 0.42]) add(roundedBox(0.09, 0.16, 0.24, 0.04), m.leatherBlack, -1.72, 1.35, z).rotation.z = 0.32;

  // ── 도어 트림 ─────────────────────────────────────────────
  for (const s of [-1, 1]) {
    const z = s * 0.76;
    // 앞문
    add(roundedBox(1.1, 0.5, 0.06, 0.03), m.softDash, -0.02, 0.72, z);
    // 창틀 아래 도어 상단 가죽 (차체 윗면이 실내에서 보이지 않도록 덮음)
    add(roundedBox(2.45, 0.06, 0.26, 0.02), m.leatherBlack, -0.62, 1.05, s * 0.78);
    add(roundedBox(0.8, 0.035, 0.03, 0.012), m.trimWood, -0.05, 0.91, s * 0.725);
    add(new THREE.BoxGeometry(0.85, 0.003, 0.003), m.ambient, -0.05, 0.89, s * 0.71);
    add(roundedBox(0.42, 0.05, 0.1, 0.02), m.leatherBlack, -0.15, 0.78, s * 0.7).rotation.x = s * 0.1; // 팔걸이
    add(roundedBox(0.12, 0.02, 0.02, 0.008), m.chrome, 0.1, 0.86, s * 0.715); // 도어 핸들
    const spk = add(new THREE.CircleGeometry(0.075, 32), m.speakerGrille, 0.2, 0.58, s * 0.725); // 스피커
    spk.rotation.y = s > 0 ? Math.PI : 0;
    add(roundedBox(0.12, 0.012, 0.035, 0.006), m.satinAlu, -0.02, 0.815, s * 0.7).rotation.x = s * 0.1; // 시트 조절 스위치
    // 뒷문
    add(roundedBox(0.95, 0.5, 0.06, 0.03), m.softDash, -1.1, 0.72, z);
    add(roundedBox(0.85, 0.035, 0.03, 0.012), m.trimWood, -1.1, 0.91, s * 0.725);
    add(new THREE.BoxGeometry(0.8, 0.003, 0.003), m.ambient, -1.1, 0.89, s * 0.71);
  }

  // 룸미러 (프레임리스)
  add(roundedBox(0.03, 0.058, 0.22, 0.022), m.pianoBlack, 0.2, 1.45, 0).rotation.z = 0.1;
  add(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 8), m.blackMatte, 0.23, 1.5, 0);

  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = false;
  });
  return { group, steeringWheel, clusterScreen, centerScreen };
}

function screenMaterial(tex: THREE.Texture) {
  return new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
}

/** 위가 열린 박스 (BackSide 재질로 안쪽에서 보이는 셸) */
function openTopBox(lx: number, ly: number, lz: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(lx, ly, lz);
  g.translate(0, ly / 2, 0);
  // BoxGeometry 그룹 순서: +x, -x, +y, -y, +z, -z → +y(위) 제거
  const idx = g.getIndex()!;
  const keep: number[] = [];
  for (const grp of g.groups) {
    if (grp.materialIndex === 2) continue;
    for (let i = grp.start; i < grp.start + grp.count; i++) keep.push(idx.getX(i));
  }
  g.setIndex(keep);
  g.clearGroups();
  return g;
}

function buildSteeringWheel(m: CarMaterials, parent: THREE.Group) {
  // 림 (YZ 평면) + 아래쪽 D컷
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.017, 14, 64), m.leatherBlack);
  rim.rotation.y = Math.PI / 2;
  parent.add(rim);
  const flat = new THREE.Mesh(roundedBox(0.035, 0.035, 0.16, 0.016), m.leatherBlack);
  flat.position.set(0, -0.175, 0);
  parent.add(flat);
  // 허브 + 에어백 커버 (엠블럼 없음)
  const hub = new THREE.Mesh(roundedBox(0.07, 0.115, 0.15, 0.045), m.leatherBlack);
  hub.position.x = 0.01;
  parent.add(hub);
  const hubTrim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.004, 8, 32), m.satinAlu);
  hubTrim.rotation.y = Math.PI / 2;
  hubTrim.position.x = -0.017;
  parent.add(hubTrim);
  // 트윈 스포크 (좌·우·하단) + 터치 컨트롤 패드
  for (const [ang, len] of [[0, 0.13], [Math.PI, 0.13], [-Math.PI / 2, 0.12]] as [number, number][]) {
    for (const off of [-0.02, 0.02]) {
      const sp = new THREE.Mesh(roundedBox(0.016, 0.022, len, 0.008), m.satinAlu);
      const dir = new THREE.Vector3(0, Math.sin(ang), Math.cos(ang));
      const perp = new THREE.Vector3(0, Math.cos(ang), -Math.sin(ang));
      sp.position.copy(dir.multiplyScalar(0.05 + len / 2)).add(perp.multiplyScalar(off));
      sp.rotation.x = -ang;
      parent.add(sp);
    }
    if (ang !== -Math.PI / 2) {
      const pad = new THREE.Mesh(roundedBox(0.01, 0.035, 0.05, 0.008), m.pianoBlack);
      pad.position.set(-0.006, 0.0, Math.cos(ang) * 0.115);
      parent.add(pad);
    }
  }
}

function buildSeat(m: CarMaterials, parent: THREE.Group, x: number, z: number) {
  const seat = new THREE.Group();
  seat.position.set(x, 0, z);
  const cushion = new THREE.Mesh(roundedBox(0.5, 0.11, 0.42, 0.05), m.leatherBlack);
  cushion.position.set(0.02, 0.66, 0);
  cushion.rotation.z = 0.08;
  seat.add(cushion);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(roundedBox(0.46, 0.09, 0.08, 0.035), m.leatherBlack);
    b.position.set(0.02, 0.71, s * 0.22);
    b.rotation.z = 0.08;
    seat.add(b);
  }
  // 등받이 + 일체형 헤드레스트
  const back = new THREE.Group();
  back.position.set(-0.2, 0.68, 0);
  back.rotation.z = 0.32;
  seat.add(back);
  const bb = new THREE.Mesh(roundedBox(0.12, 0.62, 0.46, 0.05), m.leatherBlack);
  bb.position.y = 0.32;
  back.add(bb);
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(roundedBox(0.13, 0.48, 0.08, 0.035), m.leatherBlack);
    b.position.set(0.03, 0.28, s * 0.24);
    back.add(b);
  }
  // 등판 가운데 액센트 가죽
  const insert = new THREE.Mesh(roundedBox(0.01, 0.42, 0.26, 0.005), m.leatherAccent);
  insert.position.set(0.062, 0.28, 0);
  back.add(insert);
  const head = new THREE.Mesh(roundedBox(0.12, 0.2, 0.28, 0.06), m.leatherBlack);
  head.position.set(-0.01, 0.73, 0);
  back.add(head);
  parent.add(seat);
}
