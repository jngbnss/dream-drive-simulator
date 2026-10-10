import * as THREE from 'three';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

/**
 * 건물 외벽: 8칸 × 8층을 한 장에 담아 반복. 낮에는 창(어두운 유리), 밤에는 일부 창이 켜짐(emissive).
 * UV: u = 둘레 거리 / (3.6m × 8), v = 높이 / (3.3m × 8)
 */
export function makeFacadeTextures(): { map: THREE.Texture; emissive: THREE.Texture } {
  const N = 8, cell = 64;
  const { c, g } = canvas(N * cell, N * cell);
  const { c: ce, g: ge } = canvas(N * cell, N * cell);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  ge.fillStyle = '#000000';
  ge.fillRect(0, 0, ce.width, ce.height);
  for (let fy = 0; fy < N; fy++) {
    for (let bx = 0; bx < N; bx++) {
      const x = bx * cell, y = fy * cell;
      // 층 사이 띠
      g.fillStyle = 'rgba(0,0,0,0.08)';
      g.fillRect(x, y + cell - 7, cell, 7);
      // 창 (유리 반사 그라디언트)
      const wx = x + 7, wy = y + 12, ww = cell - 14, wh = cell - 26;
      const grd = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
      grd.addColorStop(0, '#5f7487');
      grd.addColorStop(0.55, '#2b3846');
      grd.addColorStop(1, '#1b232c');
      g.fillStyle = grd;
      g.fillRect(wx, wy, ww, wh);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(wx + ww / 2 - 1, wy, 2, wh);
      // 야간 조명 (약 35% 창)
      if (Math.random() < 0.35) {
        const warm = Math.random() < 0.7;
        ge.fillStyle = warm ? `hsl(${35 + Math.random() * 10}, 80%, ${55 + Math.random() * 20}%)` : `hsl(200, 40%, ${70 + Math.random() * 15}%)`;
        ge.fillRect(wx, wy, ww, wh);
      }
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(ce);
  emissive.colorSpace = THREE.SRGBColorSpace;
  for (const t of [map, emissive]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  return { map, emissive };
}

/** 보도·광장 바닥 (보도블록 느낌) */
export function makeGroundTexture(): THREE.Texture {
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#8f8b84';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 120 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v - 4},${v - 10},0.25)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  g.strokeStyle = 'rgba(60,58,55,0.35)';
  g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
