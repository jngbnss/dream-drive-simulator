/**
 * 목적지 검색
 *  1) 카카오 장소 검색 (Kakao Maps JavaScript SDK, services 라이브러리) — 앱 키가 있을 때
 *     · 키는 브라우저용 JavaScript 키이며 카카오 개발자 콘솔에서 사이트 도메인을 등록해야 동작합니다.
 *  2) 내장 목록 (OSM 역·명소·지역명 6,888곳) — 키가 없거나 카카오 검색이 실패하면 사용
 */
export interface Place {
  name: string;
  detail: string;
  lat?: number;
  lon?: number;
  x?: number;
  z?: number;
  source: 'kakao' | 'osm';
}

declare global {
  interface Window {
    kakao?: {
      maps: {
        load(cb: () => void): void;
        LatLng: new (lat: number, lon: number) => unknown;
        services: {
          Places: new () => {
            keywordSearch(q: string, cb: (data: KakaoPlace[], status: string) => void, opts?: Record<string, unknown>): void;
          };
          Status: { OK: string };
        };
      };
    };
  }
}
interface KakaoPlace { place_name: string; address_name: string; road_address_name: string; category_group_name: string; x: string; y: string }

const KEY_STORE = 'ddrive.kakaoKey';

export function getKakaoKey(): string {
  const fromUrl = new URLSearchParams(location.search).get('kakao');
  if (fromUrl) {
    try { localStorage.setItem(KEY_STORE, fromUrl); } catch { /* 무시 */ }
    return fromUrl;
  }
  try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; }
}

export function setKakaoKey(key: string) {
  try { localStorage.setItem(KEY_STORE, key.trim()); } catch { /* 무시 */ }
}

let kakaoReady: Promise<boolean> | null = null;
function loadKakao(key: string): Promise<boolean> {
  if (kakaoReady) return kakaoReady;
  kakaoReady = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&libraries=services&autoload=false`;
    s.onload = () => window.kakao ? window.kakao.maps.load(() => resolve(true)) : resolve(false);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
    setTimeout(() => resolve(false), 8000);
  });
  return kakaoReady;
}

export class DestinationSearch {
  private pois: [string, string, number, number][] | null = null;
  kakaoStatus: 'none' | 'ok' | 'failed' = 'none';

  constructor(private readonly baseUrl: string) {}

  private async loadPois() {
    if (!this.pois) this.pois = await (await fetch(`${this.baseUrl}pois.json`)).json();
    return this.pois!;
  }

  async search(q: string, near: { lat: number; lon: number; x: number; z: number }): Promise<Place[]> {
    q = q.trim();
    if (!q) return [];
    const key = getKakaoKey();
    if (key) {
      const ok = await loadKakao(key);
      if (ok && window.kakao) {
        this.kakaoStatus = 'ok';
        const k = window.kakao.maps;
        const places = new k.services.Places();
        const res = await new Promise<KakaoPlace[] | null>((resolve) => {
          places.keywordSearch(q, (data, status) => resolve(status === k.services.Status.OK ? data : null), {
            location: new k.LatLng(near.lat, near.lon),
            sort: 'accuracy',
            size: 15,
          });
          setTimeout(() => resolve(null), 6000);
        });
        if (res && res.length) {
          return res.map((p) => ({
            name: p.place_name,
            detail: [p.category_group_name, p.road_address_name || p.address_name].filter(Boolean).join(' · '),
            lat: Number(p.y),
            lon: Number(p.x),
            source: 'kakao' as const,
          }));
        }
      } else this.kakaoStatus = 'failed';
    }
    // 내장 목록: 포함 검색 + 거리 정렬
    const pois = await this.loadPois();
    const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
    const nq = norm(q);
    const hits = pois
      .filter(([name]) => norm(name).includes(nq))
      .map(([name, kind, x, z]) => ({ name, detail: kind, x, z, d: Math.hypot(x - near.x, z - near.z), exact: norm(name) === nq }))
      .sort((a, b) => Number(b.exact) - Number(a.exact) || a.d - b.d)
      .slice(0, 15);
    return hits.map((h) => ({ name: h.name, detail: `${h.detail} · ${(h.d / 1000).toFixed(1)}km`, x: h.x, z: h.z, source: 'osm' as const }));
  }
}
