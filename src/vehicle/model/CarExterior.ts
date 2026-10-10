import * as THREE from 'three';
import type { CarMaterials } from './materials';
import { arc, panelYZ, roundedBox, roundedRect, sculpt, shapeFrom, smooth, smoothstep, type Vec2 } from './geometry';
import { buildEmblem } from './Emblem';

/**
 * GLC Coupé(C254) 비율을 참고한 절차적 외관.
 * 좌표: +X 전방, +Y 위, +Z 오른쪽, 지면 y = 0. 전장 4.76m / 전폭 1.89m / 전고 1.60m / 휠베이스 2.89m.
 * 삼각별 엠블럼은 개인 비상업 용도로 사용자 요청에 따라 포함합니다.
 */
export const AXLE_X = 2.89 / 2;
const BODY_DEPTH = 1.69; // + 베벨 0.10 × 2 = 전폭 1.89
const BODY_BEVEL_T = 0.1;
const GH_DEPTH = 1.4;
const GH_BEVEL_T = 0.08;
export const GH_CAP_Z = GH_DEPTH / 2 + GH_BEVEL_T;

/** 하부 차체 변형: 평면상 앞뒤 라운딩 + 위로 갈수록 좁아짐 */
export function deformBody(v: THREE.Vector3): void {
  const ax = v.x;
  let k = 1 - 0.095 * smoothstep(1.7, 2.42, ax) - 0.075 * smoothstep(-1.85, -2.42, ax);
  k *= 1 - 0.065 * smoothstep(0.55, 1.08, v.y);
  k *= 1 - 0.035 * smoothstep(0.45, 0.25, v.y);
  // 보닛 크라운
  if (v.y > 0.8 && ax > 0.6) v.y += 0.028 * Math.max(0, 1 - (v.z / 0.95) ** 2) * smoothstep(0.6, 1.2, ax);
  v.z *= k;
}

/** 그린하우스(캐빈 상부) 변형: 텀블홈 + 앞뒤 좁아짐 */
export function deformGreenhouse(v: THREE.Vector3): void {
  let k = 1 - 0.24 * smoothstep(1.0, 1.6, v.y);
  k *= 1 - 0.12 * smoothstep(-1.3, -2.05, v.x);
  k *= 1 - 0.05 * smoothstep(0.2, 0.7, v.x);
  v.z *= k;
}

function bodyOutline(): Vec2[] {
  const a = Math.asin(0.06 / 0.5);
  const pts: Vec2[] = [
    [-2.3, 0.5], [-2.26, 0.36], [-2.12, 0.3],
    ...arc(-AXLE_X, 0.36, 0.5, Math.PI + a, -a, 16),
    ...arc(AXLE_X, 0.36, 0.5, Math.PI + a, -a, 16),
    [2.12, 0.3], [2.27, 0.36], [2.32, 0.5],
    ...smooth([[2.335, 0.62], [2.32, 0.74], [2.26, 0.815], [2.12, 0.865], [1.7, 0.935], [1.2, 0.985], [0.72, 1.012]], 5),
    [0.3, 1.022], [-0.6, 1.038], [-1.5, 1.058], [-1.95, 1.07],
    [-2.12, 1.062], [-2.2, 1.035],
    ...smooth([[-2.27, 0.96], [-2.31, 0.81], [-2.325, 0.65]], 4),
  ];
  return dedupe(pts);
}

export const GH_TOP: Vec2[] = smooth(
  [[0.62, 1.05], [0.25, 1.3], [-0.1, 1.52], [-0.45, 1.555], [-0.85, 1.54], [-1.25, 1.46], [-1.6, 1.31], [-1.88, 1.15], [-2.02, 1.07]],
  7,
);

function greenhouseOutline(): Vec2[] {
  return dedupe([[0.7, 0.97], [0.66, 1.0], ...GH_TOP, [-2.05, 1.0], [-2.02, 0.97]]);
}

/** 옆 창문(DLO) 윤곽: 앞문, 뒷문 */
export const WINDOWS: Vec2[][] = [
  [[0.5, 1.085], ...smooth([[0.47, 1.12], [0.2, 1.3], [-0.1, 1.462], [-0.3, 1.488]], 5), [-0.52, 1.49], [-0.52, 1.085]],
  [[-0.6, 1.085], [-0.6, 1.49], ...smooth([[-0.85, 1.485], [-1.15, 1.42], [-1.42, 1.27], [-1.56, 1.14]], 5), [-1.5, 1.085]],
];

function dedupe(pts: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-3) out.push(p);
  }
  const f = out[0], l = out[out.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-3) out.pop();
  return out;
}

/** 창문 구멍 근처 판정: 거리 + 법선이 구멍 중심을 향하는지 (외곽 베벨과 구분) */
function nearWindowHole(x: number, y: number, nx: number, ny: number, maxDist: number): boolean {
  for (const poly of WINDOWS) {
    let best = Infinity, cx = 0, cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      cx += x1; cy += y1;
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
    }
    cx /= poly.length; cy /= poly.length;
    if (best < maxDist && (cx - x) * nx + (cy - y) * ny > 0) return true;
  }
  return false;
}

export interface ExteriorParts {
  group: THREE.Group;
  headlightAnchors: THREE.Object3D[];
}

export function buildExterior(m: CarMaterials): ExteriorParts {
  const group = new THREE.Group();
  group.name = 'Exterior';
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, cast = true) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  // 유리: 양면. 투명도는 카메라가 실내/실외인지에 따라 CarVisual에서 바꿈
  const addGlass = (geo: THREE.BufferGeometry, name: string) => {
    const outer = add(geo, m.glass, name, false);
    outer.renderOrder = 2;
  };

  // ── 하부 차체 ────────────────────────────────────────────
  const bodyGeo = new THREE.ExtrudeGeometry(shapeFrom(bodyOutline()), {
    depth: BODY_DEPTH, bevelEnabled: true, bevelThickness: BODY_BEVEL_T, bevelSize: 0.06, bevelSegments: 6, steps: 26, curveSegments: 8,
  });
  bodyGeo.translate(0, 0, -BODY_DEPTH / 2);
  const body = sculpt(bodyGeo, deformBody, (t) => {
    // 캐빈 위 뚜껑 제거 (실내가 보이도록)
    if (t.group === 1 && t.n.y > 0.5 && t.c0.x > -1.93 && t.c0.x < 0.69 && Math.abs(t.c0.z) < 0.7) return null;
    // 측면 캡은 법선을 따로 계산해야 큰 삼각형에 음영 줄무늬가 생기지 않음
    return t.group === 0 ? 'cap' : 'paint';
  });
  add(body.paint!, m.paint, 'Paint_Body');
  analyticCapNormals(body.cap!, deformBody, BODY_DEPTH / 2 + BODY_BEVEL_T);
  add(body.cap!, m.paint, 'Paint_BodySide');

  // ── 그린하우스 (지붕 + 유리 + 필러) ──────────────────────
  const ghShape = shapeFrom(greenhouseOutline());
  for (const w of WINDOWS) ghShape.holes.push(new THREE.Path(w.map(([x, y]) => new THREE.Vector2(x, y))));
  const ghGeo = new THREE.ExtrudeGeometry(ghShape, {
    depth: GH_DEPTH, bevelEnabled: true, bevelThickness: GH_BEVEL_T, bevelSize: 0.05, bevelSegments: 5, steps: 10, curveSegments: 8,
  });
  ghGeo.translate(0, 0, -GH_DEPTH / 2);
  const gh = sculpt(ghGeo, deformGreenhouse, (t) => {
    const nearHole = t.group === 1 && nearWindowHole(t.c0.x, t.c0.y, t.n.x, t.n.y, 0.075);
    if (nearHole) return Math.abs(t.c0.z) <= GH_DEPTH / 2 + 0.002 ? null : 'trim';
    if (t.group === 1 && t.n.y < -0.5) return null;
    if (t.group === 0) return 'cap';
    // 파노라믹 선루프 (지붕 가운데 어두운 유리)
    if (t.n.y > 0.8 && t.xmid < -0.2 && t.xmid > -1.05 && Math.abs(t.c.z) < 0.4) return 'sunroof';
    if (t.n.y > 0.5 && t.xmid < -0.08 && t.xmid > -1.12) return 'paint';
    if (Math.abs(t.n.z) > 0.45) return 'paint';
    return 'glass';
  });
  add(gh.paint!, m.paint, 'Paint_Roof');
  analyticCapNormals(gh.cap!, deformGreenhouse, GH_CAP_Z);
  add(gh.cap!, m.paint, 'Paint_Pillars');
  if (gh.trim) add(gh.trim, m.chrome, 'WindowFrame_Chrome');
  if (gh.sunroof) add(gh.sunroof, m.sunroof, 'Sunroof', false);
  addGlass(gh.glass!, 'Glass_Screens');

  // 옆 유리 (프레임 안쪽으로 살짝 들어감)
  for (const side of [-1, 1]) {
    for (const w of WINDOWS) {
      const g = new THREE.ShapeGeometry(shapeFrom(w), 4);
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        v.z = side * (GH_CAP_Z - 0.035);
        deformGreenhouse(v);
        pos.setXYZ(i, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      // ShapeGeometry 법선은 +Z → 왼쪽(-Z) 유리는 뒤집어 바깥을 향하게
      if (side < 0) {
        const idx = g.getIndex()!;
        for (let i = 0; i < idx.count; i += 3) {
          const a = idx.getX(i + 1);
          idx.setX(i + 1, idx.getX(i + 2));
          idx.setX(i + 2, a);
        }
        g.computeVertexNormals();
      }
      addGlass(g, 'Glass_Side');
    }
    // B필러 블랙 하이글로스
    const bp = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.42, 0.01), m.blackGloss);
    const top = new THREE.Vector3(-0.56, 1.5, side * GH_CAP_Z);
    deformGreenhouse(top);
    const bot = new THREE.Vector3(-0.56, 1.08, side * GH_CAP_Z);
    deformGreenhouse(bot);
    bp.position.set(-0.56, 1.29, (top.z + bot.z) / 2 + side * 0.004);
    bp.rotation.x = -side * Math.atan2(Math.abs(bot.z) - Math.abs(top.z), 0.42);
    group.add(bp);
  }


  // ── 휠 아치 라이너 + 블랙 클래딩 (C254 특징) ─────────────
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 1, side: THREE.BackSide });
  const archA = Math.asin(0.04 / 0.5);
  for (const ax of [AXLE_X, -AXLE_X]) {
    // 회전 후 theta = π 가 위쪽 → 아치 윗부분만
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.445, 0.445, 1.74, 24, 1, true, Math.PI - 1.45, 2.9), linerMat);
    liner.rotation.x = Math.PI / 2;
    liner.position.set(ax, 0.36, 0);
    group.add(liner);
    for (const s of [-1, 1]) {
      const flare = new THREE.Mesh(extrudeZ(annulusSector(0.445, 0.53, Math.PI + archA, -archA), 0.045), m.cladding);
      flare.position.set(ax, 0.36, s * 0.905 - 0.0225);
      flare.castShadow = true;
      group.add(flare);
    }
  }
  for (const s of [-1, 1]) {
    // 로커 클래딩 + 크롬 스트립
    const rocker = new THREE.Mesh(roundedBox(1.98, 0.12, 0.06, 0.025), m.cladding);
    rocker.position.set(0, 0.3, s * 0.905);
    group.add(rocker);
    const strip = new THREE.Mesh(roundedBox(1.9, 0.016, 0.012, 0.005), m.chrome);
    strip.position.set(0, 0.368, s * 0.93);
    group.add(strip);
  }

  // ── 전면 ─────────────────────────────────────────────────
  const tilt = 0.14; // 앞면 위쪽이 뒤로 기울어짐
  // 다이아몬드 그릴 (사다리꼴)
  const grille = new THREE.Mesh(panelYZ(trapezoid(1.16, 0.98, 0.3, 0.07), 0.02), m.grille);
  normalizeUV(grille.geometry);
  grille.position.set(2.372, 0.655, 0);
  grille.rotation.z = tilt;
  group.add(grille);
  const gFrame = new THREE.Mesh(panelYZ(trapezoidFrame(1.2, 1.02, 0.335, 0.08, 0.022), 0.03), m.chrome);
  gFrame.position.set(2.378, 0.655, 0);
  gFrame.rotation.z = tilt;
  group.add(gFrame);
  // 가로 크롬 루버 (별 양쪽)
  for (const s of [-1, 1]) {
    const louver = new THREE.Mesh(roundedBox(0.03, 0.034, 0.36, 0.012), m.chrome);
    louver.position.set(2.392, 0.66, s * 0.32);
    louver.rotation.z = tilt;
    group.add(louver);
    const louver2 = new THREE.Mesh(roundedBox(0.02, 0.012, 0.3, 0.005), m.chrome);
    louver2.position.set(2.39, 0.632, s * 0.32);
    group.add(louver2);
  }
  // 그릴 중앙 삼각별
  const gStar = buildEmblem(0.23, m.chrome, { backing: m.blackGloss });
  gStar.position.set(2.405, 0.655, 0);
  gStar.rotation.set(0, Math.PI / 2, 0);
  group.add(gStar);
  // 보닛 스탠딩 스타
  const hood = buildEmblem(0.065, m.chrome, { depth: 0.004 });
  hood.position.set(2.12, 0.925, 0);
  hood.rotation.set(0, Math.PI / 2, 0);
  group.add(hood);
  const hoodBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.012, 20), m.chrome);
  hoodBase.position.set(2.12, 0.888, 0);
  group.add(hoodBase);

  // 헤드라이트: 그릴 윗모서리에서 시작해 펜더 쪽으로 감기는 슬림 램프 (앞면 + 코너 두 조각)
  const headlightAnchors: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pieces: [number, number, number, number, number][] = [
      // [중심 z, 폭, 위치 x, 회전 y(바깥쪽이 뒤로), 높이]
      [0.66, 0.28, 2.37, 0.28, 0.095],
      [0.8, 0.12, 2.315, 0.85, 0.07],
    ];
    for (const [cz, w, px, ry, h] of pieces) {
      const lamp = new THREE.Group();
      lamp.position.set(px, 0.765, s * cz);
      lamp.rotation.order = 'YZX';
      lamp.rotation.y = -s * ry;
      lamp.rotation.z = tilt;
      const housing = new THREE.Mesh(roundedBox(0.05, h, w, 0.02), m.headlightChrome);
      lamp.add(housing);
      const lens = new THREE.Mesh(roundedBox(0.052, h + 0.006, w + 0.006, 0.022), m.lensClear);
      lamp.add(lens);
      // DRL: 아래쪽 테두리 라인
      const drl = new THREE.Mesh(roundedBox(0.008, 0.008, w - 0.02, 0.003), m.drl);
      drl.position.set(0.026, -h / 2 + 0.012, 0);
      lamp.add(drl);
      if (w > 0.15) {
        for (const u of [-0.06, 0.0, 0.06]) {
          const proj = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 16), m.headBeam);
          proj.rotation.z = Math.PI / 2;
          proj.position.set(0.024, 0.01, u);
          lamp.add(proj);
        }
      }
      group.add(lamp);
    }
    const anchor = new THREE.Object3D();
    anchor.position.set(2.3, 0.8, s * 0.65);
    group.add(anchor);
    headlightAnchors.push(anchor);
  }

  // 하단 범퍼: 크롬 스마일 트림 + 흡기구 + 코너 인테이크
  const smile = new THREE.CatmullRomCurve3([
    new THREE.Vector3(2.3, 0.47, -0.74), new THREE.Vector3(2.35, 0.33, -0.62), new THREE.Vector3(2.37, 0.3, 0),
    new THREE.Vector3(2.35, 0.33, 0.62), new THREE.Vector3(2.3, 0.47, 0.74),
  ]);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(smile, 48, 0.014, 8), m.chrome));
  const intake = new THREE.Mesh(panelYZ(trapezoid(1.18, 1.1, 0.12, 0.04), 0.02), m.blackMatte);
  intake.position.set(2.358, 0.385, 0);
  group.add(intake);
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, 1.08), m.blackGloss);
    slat.position.set(2.366, 0.35 + i * 0.033, 0);
    group.add(slat);
  }
  for (const s of [-1, 1]) {
    const corner = new THREE.Mesh(panelYZ(roundedRect(0.16, 0.13, 0.05), 0.02), m.grilleMesh);
    normalizeUV(corner.geometry);
    corner.position.set(2.29, 0.52, s * 0.74);
    corner.rotation.y = -s * 0.55;
    group.add(corner);
  }
  // 앞 번호판
  const fPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), m.plate);
  fPlate.position.set(2.372, 0.39, 0);
  fPlate.rotation.y = Math.PI / 2;
  group.add(fPlate);

  // ── 후면 ─────────────────────────────────────────────────
  // 테일램프: 트렁크 위 슬림 램프(안쪽) + 펜더로 감기는 코너 조각, LED 라인
  for (const s of [-1, 1]) {
    const pieces: [number, number, number, number][] = [
      // [중심 z, 폭, x, 회전 y]
      [0.56, 0.34, -2.348, 0.12],
      [0.8, 0.13, -2.29, 0.85],
    ];
    for (const [cz, w, px, ry] of pieces) {
      const tl = new THREE.Group();
      tl.position.set(px, 0.935, s * cz);
      tl.rotation.order = 'YZX';
      tl.rotation.y = s * ry; // 바깥쪽 끝이 앞으로 감김
      tl.rotation.z = -0.3;
      tl.add(new THREE.Mesh(roundedBox(0.05, 0.06, w, 0.02), m.taillight));
      const led = new THREE.Mesh(roundedBox(0.008, 0.009, w - 0.03, 0.004), m.taillightLed);
      led.position.set(-0.026, -0.006, 0);
      tl.add(led);
      group.add(tl);
    }
    // 범퍼 반사판, 후진등
    const refl = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.018, 0.2), m.taillight);
    refl.position.set(-2.355, 0.47, s * 0.68);
    group.add(refl);
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.025, 0.08), m.reverseLight);
    rev.position.set(-2.35, 0.43, s * 0.45);
    group.add(rev);
    // 사다리꼴 크롬 머플러 팁
    const tip = new THREE.Mesh(panelYZ(trapezoidFrame(0.26, 0.2, 0.075, 0.03, 0.014), 0.03), m.chrome);
    tip.position.set(-2.37, 0.3, s * 0.6);
    tip.rotation.y = Math.PI;
    group.add(tip);
    const tipIn = new THREE.Mesh(panelYZ(trapezoid(0.23, 0.17, 0.05, 0.02), 0.01), m.blackMatte);
    tipIn.position.set(-2.36, 0.3, s * 0.6);
    group.add(tipIn);
  }
  const band = new THREE.Mesh(roundedBox(0.05, 0.045, 0.82, 0.015), m.blackGloss);
  band.position.set(-2.34, 0.95, 0);
  band.rotation.z = -0.3;
  group.add(band);
  const cbl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.36), m.taillight);
  cbl.position.set(-2.13, 1.075, 0);
  group.add(cbl);
  // 트렁크 삼각별 + 모델 배지
  const tStar = buildEmblem(0.14, m.chrome, { backing: m.paint });
  tStar.position.set(-2.372, 0.79, 0);
  tStar.rotation.set(0, -Math.PI / 2, -0.12);
  group.add(tStar);
  for (const [text, z] of [['GLC 300', 0.5], ['4MATIC', -0.52]] as [string, number][]) {
    const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.034), badgeMaterial(text));
    badge.position.set(-2.265, 1.012, z);
    badge.rotation.set(0, -Math.PI / 2, 0);
    badge.rotateX(-0.35);
    group.add(badge);
  }
  // 하단 블랙 범퍼 + 크롬 디퓨저
  const lowerRear = new THREE.Mesh(roundedBox(0.08, 0.2, 1.74, 0.04), m.cladding);
  lowerRear.position.set(-2.33, 0.34, 0);
  group.add(lowerRear);
  const diffuser = new THREE.Mesh(roundedBox(0.04, 0.03, 1.0, 0.012), m.chrome);
  diffuser.position.set(-2.37, 0.27, 0);
  group.add(diffuser);
  // 뒤 번호판
  const rPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), m.plate);
  rPlate.position.set(-2.385, 0.54, 0);
  rPlate.rotation.y = -Math.PI / 2;
  group.add(rPlate);

  // ── 측면 디테일 ──────────────────────────────────────────
  for (const s of [-1, 1]) {
    // 사이드 미러 (바디 컬러 캡 + 블랙 베이스 + 방향지시등)
    const mirror = new THREE.Group();
    mirror.position.set(0.52, 1.1, s * 0.9);
    const base = new THREE.Mesh(roundedBox(0.14, 0.06, 0.08, 0.02), m.blackGloss);
    mirror.add(base);
    const cap = new THREE.Mesh(roundedBox(0.13, 0.13, 0.24, 0.055), m.paint);
    cap.position.set(-0.01, 0.07, s * 0.13);
    cap.rotation.y = s * 0.12;
    cap.castShadow = true;
    mirror.add(cap);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), m.mirrorGlass);
    glass.rotation.y = -Math.PI / 2;
    glass.position.set(-0.077, 0.07, s * 0.13);
    mirror.add(glass);
    const turn = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.008, 0.13), m.drl);
    turn.position.set(0.04, 0.02, s * 0.16);
    mirror.add(turn);
    group.add(mirror);

    // 벨트라인 크롬
    const belt = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.012, 0.012), m.chrome);
    belt.position.set(-0.52, 1.075, s * 0.785);
    group.add(belt);
    // 도어 손잡이 (크롬 그립형)
    for (const hx of [-0.12, -1.12]) {
      const h = new THREE.Mesh(roundedBox(0.2, 0.035, 0.03, 0.014), m.chrome);
      h.position.set(hx, 0.975, s * 0.885);
      group.add(h);
      const recess = new THREE.Mesh(roundedBox(0.22, 0.05, 0.01, 0.02), m.blackMatte);
      recess.position.set(hx, 0.975, s * 0.872);
      group.add(recess);
    }
    // 도어 분할선
    for (const sx of [0.74, -0.56, -1.47]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.62, 0.006), m.blackMatte);
      seam.position.set(sx, 0.7, s * 0.918);
      seam.rotation.x = s * -0.07;
      group.add(seam);
    }
    // 주유구 (오른쪽 뒤)
    if (s > 0) {
      const fuel = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), m.paintSeam);
      fuel.position.set(-1.9, 0.92, 0.905);
      group.add(fuel);
    }
  }

  return { group, headlightAnchors };
}

/** 사다리꼴(위 넓고 아래 좁음) 둥근 모서리 Shape, 중심 정렬 */
function trapezoid(topW: number, botW: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const t = topW / 2, b = botW / 2, y0 = -h / 2, y1 = h / 2;
  s.moveTo(-b + r, y0);
  s.lineTo(b - r, y0);
  s.quadraticCurveTo(b, y0, b + (t - b) * (r / h), y0 + r);
  s.lineTo(t - (t - b) * (r / h), y1 - r);
  s.quadraticCurveTo(t, y1, t - r, y1);
  s.lineTo(-t + r, y1);
  s.quadraticCurveTo(-t, y1, -t + (t - b) * (r / h), y1 - r);
  s.lineTo(-b - (t - b) * (r / h), y0 + r);
  s.quadraticCurveTo(-b, y0, -b + r, y0);
  return s;
}

function trapezoidFrame(topW: number, botW: number, h: number, r: number, t: number): THREE.Shape {
  const outer = trapezoid(topW, botW, h, r);
  const inner = trapezoid(topW - 2 * t, botW - 2 * t, h - 2 * t, Math.max(0.01, r - t));
  outer.holes.push(new THREE.Path(inner.getPoints(8).reverse()));
  return outer;
}

/** 환형 부채꼴 (휠 아치 클래딩) */
function annulusSector(r0: number, r1: number, a0: number, a1: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    if (i === 0) s.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
    else s.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
  }
  for (let i = n; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / n;
    s.lineTo(Math.cos(a) * r0, Math.sin(a) * r0);
  }
  s.closePath();
  return s;
}

function extrudeZ(shape: THREE.Shape, depth: number): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 12 });
}

const badgeCache = new Map<string, THREE.Material>();
function badgeMaterial(text: string): THREE.Material {
  let m = badgeCache.get(text);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 88;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 10, 0, 78);
  grd.addColorStop(0, '#ffffff');
  grd.addColorStop(0.5, '#8d9196');
  grd.addColorStop(1, '#e8e8e8');
  g.fillStyle = grd;
  g.font = '600 66px "Noto Sans KR", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 256, 46);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, metalness: 0.9, roughness: 0.2, alphaTest: 0.2 });
  badgeCache.set(text, m);
  return m;
}

/**
 * 측면 캡은 earcut 삼각형이 길고 가늘어 보간 법선에 줄무늬가 생김 →
 * 변형 함수의 편미분으로 정점마다 정확한 법선을 계산
 */
function analyticCapNormals(geo: THREE.BufferGeometry, deform: (v: THREE.Vector3) => void, capZ: number) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
  const e = 0.01;
  const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  const tx = new THREE.Vector3(), ty = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const z0 = Math.sign(p.z) * capZ;
    a.set(p.x + e, p.y, z0); deform(a);
    b.set(p.x - e, p.y, z0); deform(b);
    c.set(p.x, p.y + e, z0); deform(c);
    d.set(p.x, p.y - e, z0); deform(d);
    tx.subVectors(a, b);
    ty.subVectors(c, d);
    n.crossVectors(tx, ty).normalize();
    if (Math.sign(n.z) !== Math.sign(p.z)) n.negate();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  nrm.needsUpdate = true;
}

function normalizeUV(geo: THREE.BufferGeometry): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < uv.count; i++) {
    minU = Math.min(minU, uv.getX(i)); maxU = Math.max(maxU, uv.getX(i));
    minV = Math.min(minV, uv.getY(i)); maxV = Math.max(maxV, uv.getY(i));
  }
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - minU) / (maxU - minU || 1), (uv.getY(i) - minV) / (maxV - minV || 1));
  }
}
