import * as THREE from 'three';

/**
 * 삼각별 엠블럼 (개인 비상업 용도, 사용자 요청).
 * 로컬 좌표: 엠블럼 면이 +Z를 향함, 지름 = size.
 */
export function starShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  const inner = r * 0.14;
  for (let i = 0; i < 6; i++) {
    const outer = i % 2 === 0;
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    const rr = outer ? r : inner;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  return s;
}

export function buildEmblem(size: number, mat: THREE.Material, opts: { ring?: boolean; depth?: number; backing?: THREE.Material } = {}): THREE.Group {
  const g = new THREE.Group();
  const r = size / 2;
  const ringT = r * 0.075;
  const starR = opts.ring === false ? r : r - ringT * 1.2;
  const depth = opts.depth ?? size * 0.06;
  const star = new THREE.Mesh(
    new THREE.ExtrudeGeometry(starShape(starR), { depth, bevelEnabled: true, bevelThickness: depth * 0.5, bevelSize: starR * 0.03, bevelSegments: 2 }),
    mat,
  );
  g.add(star);
  if (opts.ring !== false) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r - ringT, ringT, 10, 48), mat);
    ring.position.z = depth * 0.5;
    g.add(ring);
  }
  if (opts.backing) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r - ringT, 40), opts.backing);
    disc.position.z = -0.001;
    g.add(disc);
  }
  return g;
}
