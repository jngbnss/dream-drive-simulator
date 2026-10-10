import * as THREE from 'three';
import type { CarMaterials } from './materials';
import { arc, panelYZ, roundedBox, roundedRect, sculpt, shapeFrom, smooth, smoothstep, type Vec2 } from './geometry';

/**
 * GLC Coupé(C254) 비율을 참고한 절차적 외관.
 * 좌표: +X 전방, +Y 위, +Z 오른쪽, 지면 y = 0. 전장 4.76m / 전폭 1.89m / 전고 1.60m / 휠베이스 2.89m.
 * 엠블럼·로고는 넣지 않습니다.
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

function distToPolys(x: number, y: number, polys: Vec2[][]): number {
  let best = Infinity;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const dx = x2 - x1, dy = y2 - y1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
    }
  }
  return best;
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
  // 유리: 바깥면(반사·짙은 틴트) + 안쪽면(옅은 틴트, 실내에서 밖이 잘 보이도록)
  const addGlass = (geo: THREE.BufferGeometry, name: string) => {
    const outer = add(geo, m.glass, name, false);
    outer.renderOrder = 2;
    const inner = add(geo, m.glassInner, `${name}_Inner`, false);
    inner.renderOrder = 2;
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
    depth: GH_DEPTH, bevelEnabled: true, bevelThickness: GH_BEVEL_T, bevelSize: 0.05, bevelSegments: 5, steps: 1, curveSegments: 8,
  });
  ghGeo.translate(0, 0, -GH_DEPTH / 2);
  const gh = sculpt(ghGeo, deformGreenhouse, (t) => {
    const nearHole = t.group === 1 && distToPolys(t.c0.x, t.c0.y, WINDOWS) < 0.075;
    if (nearHole) return Math.abs(t.c0.z) <= GH_DEPTH / 2 + 0.002 ? null : 'trim';
    if (t.group === 1 && t.n.y < -0.5) return null;
    if (t.group === 0) return 'cap';
    if (t.n.y > 0.5 && t.c.x < -0.08 && t.c.x > -1.12) return 'paint';
    if (Math.abs(t.n.z) > 0.45) return 'paint';
    return 'glass';
  });
  add(gh.paint!, m.paint, 'Paint_Roof');
  analyticCapNormals(gh.cap!, deformGreenhouse, GH_CAP_Z);
  add(gh.cap!, m.paint, 'Paint_Pillars');
  if (gh.trim) add(gh.trim, m.blackGloss, 'WindowFrame');
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

  // ── 휠 아치 라이너 ───────────────────────────────────────
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 1, side: THREE.BackSide });
  for (const ax of [AXLE_X, -AXLE_X]) {
    // 회전 후 theta = π 가 위쪽 → 아치 윗부분만
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(0.445, 0.445, 1.74, 24, 1, true, Math.PI - 1.45, 2.9), linerMat);
    liner.rotation.x = Math.PI / 2;
    liner.position.set(ax, 0.36, 0);
    group.add(liner);
  }

  // ── 전면 ─────────────────────────────────────────────────
  const grille = new THREE.Mesh(panelYZ(roundedRect(1.04, 0.3, 0.07), 0.02), m.grille);
  grille.position.set(2.37, 0.655, 0);
  grille.rotation.z = 0.15;
  normalizeUV(grille.geometry);
  group.add(grille);
  // 그릴 크롬 테두리
  const gFrame = new THREE.Mesh(panelYZ(frameShape(1.08, 0.335, 0.08, 0.018), 0.025), m.chrome);
  gFrame.position.copy(grille.position).add(new THREE.Vector3(0.004, 0, 0));
  gFrame.rotation.z = grille.rotation.z;
  group.add(gFrame);

  // 하단 공기흡입구 + 에어커튼
  const intake = new THREE.Mesh(panelYZ(roundedRect(1.3, 0.16, 0.05), 0.02), m.blackMatte);
  intake.position.set(2.345, 0.39, 0);
  group.add(intake);
  for (const s of [-1, 1]) {
    const curtain = new THREE.Mesh(roundedBox(0.05, 0.2, 0.09, 0.02), m.blackGloss);
    curtain.position.set(2.29, 0.5, s * 0.74);
    curtain.rotation.y = s * 0.5;
    group.add(curtain);
  }

  // 헤드라이트 (슬림 LED + DRL)
  const headlightAnchors: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const hl = new THREE.Group();
    hl.position.set(2.255, 0.815, s * 0.66);
    hl.rotation.y = s * 0.28;
    hl.rotation.z = 0.25;
    hl.add(new THREE.Mesh(roundedBox(0.12, 0.085, 0.38, 0.03), m.headlightInner));
    hl.add(new THREE.Mesh(roundedBox(0.125, 0.09, 0.385, 0.032), m.lensClear));
    // 프로젝터 2개 + DRL 눈썹
    for (const dz of [-0.06, 0.06]) {
      const proj = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16), m.headBeam);
      proj.rotation.z = Math.PI / 2;
      proj.position.set(0.05, -0.005, dz - s * 0.03);
      hl.add(proj);
    }
    const drl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.01, 0.3), m.drl);
    drl.position.set(0.058, 0.026, 0);
    hl.add(drl);
    const drlHook = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.045, 0.01), m.drl);
    drlHook.position.set(0.058, 0.006, s * 0.145);
    hl.add(drlHook);
    group.add(hl);
    const anchor = new THREE.Object3D();
    anchor.position.set(2.3, 0.8, s * 0.6);
    group.add(anchor);
    headlightAnchors.push(anchor);
  }

  // 앞 번호판
  const fPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), m.plate);
  fPlate.position.set(2.372, 0.4, 0);
  fPlate.rotation.y = Math.PI / 2;
  group.add(fPlate);

  // ── 후면 ─────────────────────────────────────────────────
  for (const s of [-1, 1]) {
    const tl = new THREE.Mesh(roundedBox(0.07, 0.07, 0.52, 0.025), m.taillight);
    tl.position.set(-2.255, 0.975, s * 0.6);
    tl.rotation.y = -s * 0.2;
    tl.rotation.z = -0.35;
    group.add(tl);
    const tlInner = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.012, 0.44), m.taillight);
    tlInner.position.set(-2.29, 0.99, s * 0.6);
    tlInner.rotation.y = -s * 0.2;
    group.add(tlInner);
    // 후진등
    const rev = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.08), m.reverseLight);
    rev.position.set(-2.33, 0.62, s * 0.45);
    group.add(rev);
    // 머플러 팁 (크롬 사각)
    const ex = new THREE.Mesh(roundedBox(0.03, 0.07, 0.3, 0.02), m.chrome);
    ex.position.set(-2.345, 0.355, s * 0.56);
    group.add(ex);
  }
  // 트렁크 리드 블랙 스트립 + 보조 제동등
  const strip = new THREE.Mesh(roundedBox(0.04, 0.05, 0.62, 0.015), m.blackGloss);
  strip.position.set(-2.262, 0.98, 0);
  strip.rotation.z = -0.35;
  group.add(strip);
  const cbl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.36), m.taillight);
  cbl.position.set(-2.13, 1.075, 0);
  group.add(cbl);
  // 디퓨저
  const diff = new THREE.Mesh(panelYZ(roundedRect(1.45, 0.14, 0.05), 0.04), m.blackMatte);
  diff.position.set(-2.33, 0.33, 0);
  group.add(diff);
  // 뒤 번호판
  const rPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), m.plate);
  rPlate.position.set(-2.346, 0.66, 0);
  rPlate.rotation.y = -Math.PI / 2;
  group.add(rPlate);

  // ── 측면 디테일 ──────────────────────────────────────────
  for (const s of [-1, 1]) {
    // 사이드 미러
    const mirror = new THREE.Group();
    mirror.position.set(0.5, 1.13, s * 0.93);
    const cap = new THREE.Mesh(roundedBox(0.16, 0.12, 0.22, 0.05), m.paint);
    cap.position.set(-0.02, 0.0, s * 0.1);
    cap.castShadow = true;
    mirror.add(cap);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.095), m.chrome);
    glass.rotation.y = -Math.PI / 2;
    glass.position.set(-0.102, 0, s * 0.1);
    mirror.add(glass);
    const arm = new THREE.Mesh(roundedBox(0.1, 0.05, 0.1, 0.02), m.blackGloss);
    arm.position.set(0, -0.04, 0);
    mirror.add(arm);
    const turn = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.12), m.drl);
    turn.position.set(0.0, -0.05, s * 0.12);
    mirror.add(turn);
    group.add(mirror);

    // 벨트라인 크롬
    const belt = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.012, 0.012), m.chrome);
    belt.position.set(-0.52, 1.075, s * 0.785);
    group.add(belt);
    // 사이드 스커트 크롬
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.02, 0.012), m.chrome);
    skirt.position.set(0, 0.33, s * 0.925);
    group.add(skirt);
    // 도어 손잡이
    for (const hx of [-0.22, -1.2]) {
      const h = new THREE.Mesh(roundedBox(0.22, 0.03, 0.025, 0.012), m.chrome);
      h.position.set(hx, 0.95, s * 0.893);
      group.add(h);
    }
    // 도어 분할선
    for (const sx of [0.74, -0.56, -1.47]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.66, 0.006), m.blackMatte);
      seam.position.set(sx, 0.68, s * 0.918);
      seam.rotation.x = s * -0.07;
      group.add(seam);
    }
  }

  return { group, headlightAnchors };
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

function frameShape(w: number, h: number, r: number, t: number): THREE.Shape {
  const outer = roundedRect(w, h, r);
  const inner = roundedRect(w - 2 * t, h - 2 * t, Math.max(0.01, r - t));
  outer.holes.push(new THREE.Path(inner.getPoints(12).reverse()));
  return outer;
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
