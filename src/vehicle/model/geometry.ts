import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export type Vec2 = [number, number];

export function shapeFrom(points: Vec2[]): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) s.lineTo(points[i][0], points[i][1]);
  s.closePath();
  return s;
}

/** 원호 점 생성 (각도 a0 → a1) */
export function arc(cx: number, cy: number, r: number, a0: number, a1: number, n: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** Catmull-Rom 스플라인으로 제어점을 부드럽게 보간 */
export function smooth(points: Vec2[], perSegment = 6): Vec2[] {
  const curve = new THREE.SplineCurve(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return curve.getPoints((points.length - 1) * perSegment).map((p) => [p.x, p.y] as Vec2);
}

export interface TriInfo {
  /** 원본 그룹 (ExtrudeGeometry: 0 = 측면 캡, 1 = 외곽 벽/베벨) */
  group: number;
  /** 변형 전 무게중심 */
  c0: THREE.Vector3;
  /** 삼각형 x 범위의 중간 (같은 사각형의 두 삼각형이 같은 값을 가져 경계가 톱니 모양이 되지 않음) */
  xmid: number;
  /** 변형 후 무게중심 / 법선 */
  c: THREE.Vector3;
  n: THREE.Vector3;
}

/**
 * ExtrudeGeometry 같은 비인덱스 지오메트리를 변형하고, 삼각형을 재질 클래스로 분류해
 * 클래스별로 부드러운 법선을 가진 지오메트리로 나눕니다. classify가 null을 반환하면 삼각형을 제거합니다.
 */
export function sculpt<K extends string>(
  src: THREE.BufferGeometry,
  deform: (v: THREE.Vector3) => void,
  classify: (t: TriInfo) => K | null,
): Partial<Record<K, THREE.BufferGeometry>> {
  const geo = src.index ? src.toNonIndexed() : src;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const triCount = pos.count / 3;
  const groupOf = new Int8Array(triCount);
  for (const g of geo.groups) {
    for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) groupOf[t] = g.materialIndex ?? 0;
  }
  const buckets = new Map<K, number[]>();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const a0 = new THREE.Vector3(), b0 = new THREE.Vector3(), c0 = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const info: TriInfo = { group: 0, xmid: 0, c0: new THREE.Vector3(), c: new THREE.Vector3(), n: new THREE.Vector3() };
  for (let t = 0; t < triCount; t++) {
    a0.fromBufferAttribute(pos, t * 3);
    b0.fromBufferAttribute(pos, t * 3 + 1);
    c0.fromBufferAttribute(pos, t * 3 + 2);
    a.copy(a0); b.copy(b0); c.copy(c0);
    deform(a); deform(b); deform(c);
    info.group = groupOf[t];
    info.c0.copy(a0).add(b0).add(c0).multiplyScalar(1 / 3);
    info.xmid = (Math.min(a0.x, b0.x, c0.x) + Math.max(a0.x, b0.x, c0.x)) / 2;
    info.c.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    info.n.crossVectors(e1, e2);
    if (info.n.lengthSq() < 1e-14) continue;
    info.n.normalize();
    const k = classify(info);
    if (k === null) continue;
    let arr = buckets.get(k);
    if (!arr) buckets.set(k, (arr = []));
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
  const out: Partial<Record<K, THREE.BufferGeometry>> = {};
  for (const [k, arr] of buckets) {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    g = mergeVertices(g, 1e-4);
    g.computeVertexNormals();
    out[k] = g;
  }
  return out;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** 둥근 모서리 사각형 Shape */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.min(r, w / 2, h / 2);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** 둥근 박스 (ExtrudeGeometry 기반, 중심 정렬) */
export function roundedBox(w: number, h: number, d: number, r: number, seg = 3): THREE.BufferGeometry {
  const bev = Math.min(r, d / 2 - 0.001);
  const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * bev, h - 2 * bev, r), {
    depth: Math.max(0.001, d - 2 * bev),
    bevelEnabled: true,
    bevelThickness: bev,
    bevelSize: bev,
    bevelSegments: seg,
    curveSegments: seg * 2,
  });
  g.translate(0, 0, -(d - 2 * bev) / 2);
  return g;
}

/** 단면 Shape를 경로를 따라 X축 방향으로 놓은 패널 (YZ 평면) */
export function panelYZ(shape: THREE.Shape, thickness: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -thickness / 2);
  g.rotateY(Math.PI / 2); // 이제 두께는 X축, shape의 x → -Z
  return g;
}
