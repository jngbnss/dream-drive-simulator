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
    color: 0x080a0e, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.86,
    side: THREE.DoubleSide, envMapIntensity: 2.2, depthWrite: false,
  });

  /** 실내 시점에서는 유리를 옅게, 외부에서는 실차처럼 짙은 틴트 + 반사 */
  setCabinView(inside: boolean): void {
    this.glass.opacity = inside ? 0.14 : 0.86;
  }
  readonly blackGloss = new THREE.MeshStandardMaterial({ color: 0x050506, metalness: 0.2, roughness: 0.12 });
  readonly blackMatte = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, metalness: 0, roughness: 0.75 });
  readonly chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08 });
  readonly satinAlu = new THREE.MeshStandardMaterial({ color: 0x8e9196, metalness: 1, roughness: 0.3 });
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
  readonly taillightLed = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2a14, emissiveIntensity: 3 });
  readonly headlightChrome = new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 1, roughness: 0.18 });
  readonly cladding =new THREE.MeshStandardMaterial({ color: 0x141516, roughness: 0.8, metalness: 0 });
  readonly mirrorGlass = new THREE.MeshStandardMaterial({ color: 0x9aa4ad, metalness: 1, roughness: 0.02 });
  readonly sunroof = new THREE.MeshPhysicalMaterial({ color: 0x05070a, metalness: 0.1, roughness: 0.04, clearcoat: 1, envMapIntensity: 1.8 });
  readonly paintSeam = new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false });
  readonly grilleMesh: THREE.MeshStandardMaterial;
  readonly reverseLight =new THREE.MeshStandardMaterial({ color: 0x777777, emissive: 0xffffff, emissiveIntensity: 0 });
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
    this.grille = new THREE.MeshStandardMaterial({ map: makeGrilleTexture(), metalness: 0.7, roughness: 0.22 });
    this.grilleMesh = new THREE.MeshStandardMaterial({ map: makeMeshTexture(), roughness: 0.6 });
    const wood = makeWoodTexture();
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(1.6, 4);
    this.trimWood = new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5, metalness: 0.1 });
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

/** C254 그릴: 검은 바탕에 크롬 다이아몬드(작은 마름모) 패턴 */
function makeGrilleTexture() {
  return canvasTexture(1024, 288, (g) => {
    g.fillStyle = '#040405';
    g.fillRect(0, 0, 1024, 288);
    const step = 17;
    for (let row = 0, y = 8; y < 288; y += step * 0.8, row++) {
      for (let x = row % 2 ? 8 : 8 + step / 2; x < 1024; x += step) {
        const grd = g.createLinearGradient(x - 5, y - 5, x + 5, y + 5);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.5, '#9a9ea4');
        grd.addColorStop(1, '#3c3f44');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x, y - 5.5);
        g.lineTo(x + 6, y);
        g.lineTo(x, y + 5.5);
        g.lineTo(x - 6, y);
        g.closePath();
        g.fill();
      }
    }
  });
}

/** 범퍼 코너 인테이크용 블랙 메시 */
function makeMeshTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#0a0a0b';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#26282b';
    g.lineWidth = 2;
    for (let i = -128; i < 256; i += 10) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 128, 128); g.stroke();
      g.beginPath(); g.moveTo(i + 128, 0); g.lineTo(i, 128); g.stroke();
    }
  });
}

/** 핀스트라이프 우드 트림 (C254 실내: 회갈색 오픈포어 우드에 가는 알루미늄 라인) */
function makeWoodTexture() {
  return canvasTexture(1024, 256, (g) => {
    g.fillStyle = '#5a4c40';
    g.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 120; i++) {
      const y = Math.random() * 256;
      g.strokeStyle = `rgba(${40 + Math.random() * 30},${30 + Math.random() * 20},20,${0.08 + Math.random() * 0.12})`;
      g.lineWidth = 0.6 + Math.random() * 1.2;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 64) g.lineTo(x, y + Math.sin(x / 120 + i) * 2);
      g.stroke();
    }
    // 가는 금속 라인 (세로 방향 반복)
    for (let x = 6; x < 1024; x += 14) {
      g.fillStyle = 'rgba(214,214,210,0.55)';
      g.fillRect(x, 0, 1.6, 256);
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
