import * as THREE from 'three';

/** 실제 GLC 옵션 색상을 참고한 외장 색 (명칭은 참고용) */
export const PAINTS = [
  { id: 'obsidian', name: '옵시디언 블랙 메탈릭', color: '#0d0f12', metal: 0.7, rough: 0.32 },
  { id: 'polar', name: '폴라 화이트', color: '#e9eaea', metal: 0.0, rough: 0.28 },
  { id: 'opalith', name: '오팔리스 화이트 브라이트', color: '#f2f0ea', metal: 0.25, rough: 0.25 },
  { id: 'selenite', name: '셀레나이트 그레이 메탈릭', color: '#5b5f63', metal: 0.75, rough: 0.3 },
  { id: 'hightech', name: '하이테크 실버 메탈릭', color: '#a9adb1', metal: 0.85, rough: 0.28 },
  { id: 'spectral', name: '스펙트럴 블루 메탈릭', color: '#1d3557', metal: 0.75, rough: 0.3 },
  { id: 'hyacinth', name: '히아신스 레드 메탈릭', color: '#6a0d1c', metal: 0.7, rough: 0.28 },
  { id: 'rose', name: '로즈 골드 (커스텀)', color: '#c99a8c', metal: 0.85, rough: 0.27 },
] as const;

/** 앰비언트 라이트 (실차는 64색 중 선택) */
export const AMBIENTS = [
  { id: 'pink', name: '핑크', color: '#ff4fa3' },
  { id: 'purple', name: '퍼플', color: '#9b5cff' },
  { id: 'blue', name: '아이스 블루', color: '#3fb6ff' },
  { id: 'amber', name: '앰버', color: '#ffad3b' },
  { id: 'white', name: '화이트', color: '#f4f1ea' },
  { id: 'red', name: '레드', color: '#ff2d3c' },
] as const;

export class CarMaterials {
  readonly paint = new THREE.MeshPhysicalMaterial({
    color: PAINTS[0].color, metalness: 0.7, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03,
  });
  readonly glass = new THREE.MeshPhysicalMaterial({
    color: 0x080a0e, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.78,
    side: THREE.DoubleSide, envMapIntensity: 2.2, depthWrite: false,
  });

  /** 실내 시점에서는 유리를 옅게, 외부에서는 실차처럼 짙은 틴트 + 반사 */
  setCabinView(inside: boolean): void {
    this.glass.opacity = inside ? 0.14 : 0.78;
  }
  readonly blackGloss = new THREE.MeshStandardMaterial({ color: 0x050506, metalness: 0.2, roughness: 0.12 });
  readonly blackMatte = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.75 });
  readonly chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 });
  readonly satinAlu = new THREE.MeshStandardMaterial({ color: 0xc8cacc, metalness: 1, roughness: 0.32 });
  readonly tire = new THREE.MeshStandardMaterial({ color: 0x141414, metalness: 0, roughness: 0.92, side: THREE.DoubleSide });
  readonly rim = new THREE.MeshStandardMaterial({ color: 0x9da1a6, metalness: 0.95, roughness: 0.22 });
  readonly rimDark = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.9, roughness: 0.3 });
  readonly brakeDisc = new THREE.MeshStandardMaterial({ color: 0x6d6d6d, metalness: 0.9, roughness: 0.5 });
  readonly caliper = new THREE.MeshStandardMaterial({ color: 0x3a3d42, metalness: 0.6, roughness: 0.35 });
  readonly lensClear = new THREE.MeshPhysicalMaterial({
    color: 0x9aa0a6, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1,
  });
  readonly headlightInner = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.95, roughness: 0.15 });
  readonly drl = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 2.2 });
  readonly headBeam = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e0, emissiveIntensity: 0 });
  readonly taillight = new THREE.MeshStandardMaterial({
    color: 0x3a0306, emissive: 0xff1424, emissiveIntensity: 0.9, metalness: 0.3, roughness: 0.2,
  });
  readonly reverseLight = new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0 });
  readonly plate: THREE.MeshStandardMaterial;
  readonly grille: THREE.MeshStandardMaterial;

  // 실내
  readonly leatherBlack = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.62, metalness: 0 });
  readonly leatherAccent = new THREE.MeshStandardMaterial({ color: 0x8a1b1f, roughness: 0.6, metalness: 0 });
  readonly softDash = new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.8 });
  readonly headliner = new THREE.MeshStandardMaterial({ color: 0x2a2a2b, roughness: 0.95, side: THREE.DoubleSide });
  readonly carpet = new THREE.MeshStandardMaterial({ color: 0x0f0f10, roughness: 1, side: THREE.DoubleSide });
  readonly trimWood: THREE.MeshStandardMaterial;
  readonly pianoBlack = new THREE.MeshPhysicalMaterial({ color: 0x030304, roughness: 0.08, metalness: 0.1, clearcoat: 1 });
  readonly ambient = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: AMBIENTS[0].color, emissiveIntensity: 2.4 });
  readonly speakerGrille: THREE.MeshStandardMaterial;
  readonly interiorShell = new THREE.MeshStandardMaterial({ color: 0x141415, roughness: 0.9, side: THREE.BackSide });

  constructor(plateText = '123가 4567') {
    this.plate = new THREE.MeshStandardMaterial({ map: makePlateTexture(plateText), roughness: 0.4 });
    this.grille = new THREE.MeshStandardMaterial({ map: makeGrilleTexture(), metalness: 0.6, roughness: 0.25 });
    this.trimWood = new THREE.MeshStandardMaterial({ map: makeWoodTexture(), roughness: 0.55, metalness: 0 });
    this.speakerGrille = new THREE.MeshStandardMaterial({ map: makeSpeakerTexture(), metalness: 1, roughness: 0.3 });
  }

  setPaint(index: number): void {
    const p = PAINTS[index];
    this.paint.color.set(p.color);
    this.paint.metalness = p.metal;
    this.paint.roughness = p.rough;
  }

  setAmbient(index: number): void {
    this.ambient.emissive.set(AMBIENTS[index].color);
  }
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 한국 신형 번호판(흰색, 520×110mm) */
function makePlateTexture(text: string) {
  return canvasTexture(520, 110, (g) => {
    g.fillStyle = '#f7f7f5';
    g.fillRect(0, 0, 520, 110);
    g.strokeStyle = '#111';
    g.lineWidth = 6;
    g.strokeRect(4, 4, 512, 102);
    // 왼쪽 태극/국가 표시 영역 (단순화)
    g.fillStyle = '#1f4fa0';
    g.fillRect(14, 22, 26, 66);
    g.fillStyle = '#111';
    g.font = '700 74px "Noto Sans KR", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 280, 60);
  });
}

/** 다이아몬드 패턴 그릴 (엠블럼 없음) */
function makeGrilleTexture() {
  return canvasTexture(512, 160, (g) => {
    g.fillStyle = '#050505';
    g.fillRect(0, 0, 512, 160);
    for (let y = 6; y < 160; y += 11) {
      for (let x = (y / 11) % 2 ? 6 : 12; x < 512; x += 12) {
        const grd = g.createRadialGradient(x - 1, y - 1, 0, x, y, 4);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(1, '#5d6066');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x, y - 3.5);
        g.lineTo(x + 3.5, y);
        g.lineTo(x, y + 3.5);
        g.lineTo(x - 3.5, y);
        g.fill();
      }
    }
    // 가운데 가로 크롬 루버
    const lg = g.createLinearGradient(0, 70, 0, 90);
    lg.addColorStop(0, '#f5f5f5');
    lg.addColorStop(0.5, '#7b7f85');
    lg.addColorStop(1, '#e5e5e5');
    g.fillStyle = lg;
    g.fillRect(0, 72, 512, 14);
  });
}

/** 오픈 포어 우드 트림 */
function makeWoodTexture() {
  return canvasTexture(1024, 64, (g) => {
    g.fillStyle = '#3b2618';
    g.fillRect(0, 0, 1024, 64);
    for (let i = 0; i < 160; i++) {
      const y = Math.random() * 64;
      g.strokeStyle = `rgba(${20 + Math.random() * 30},${10 + Math.random() * 15},5,${0.25 + Math.random() * 0.35})`;
      g.lineWidth = 0.5 + Math.random() * 1.5;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x / 90 + i) * 2.5);
      g.stroke();
    }
  });
}

function makeSpeakerTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#8c8f94';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#1a1a1a';
    for (let y = 3; y < 128; y += 6) for (let x = (y / 6) % 2 ? 3 : 6; x < 128; x += 6) {
      g.beginPath();
      g.arc(x, y, 1.6, 0, Math.PI * 2);
      g.fill();
    }
  });
}
