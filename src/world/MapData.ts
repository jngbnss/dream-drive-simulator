/** tools/osm-to-map.mjs가 생성하는 맵 데이터 형식. 좌표 단위: 0.1m 정수, x = 동쪽, z = 남쪽 */
export interface MapRoad {
  /** 도로 등급: 0 고속도로, 1 도시고속(trunk), 2 주간선, 3 보조간선, 4 집산, 5 국지, 6 램프 */
  c: number;
  /** 차로 수 (방향별 합계) */
  l: number;
  /** 일방통행 */
  o: 0 | 1;
  /** 폭 (m) */
  w: number;
  n?: string;
  p: number[];
  /** 교차점(다른 도로와 공유하는 노드) 인덱스 */
  j: number[];
  /** 교량 */
  b?: 1;
  /** 터널 */
  t?: 1;
}

export interface MapBuilding {
  h: number;
  p: number[];
  /** 지붕 색 인덱스 등 변형 시드 */
  s?: number;
}

export interface MapPoi {
  id: string;
  name: string;
  x: number;
  z: number;
  heading: number;
}

export interface MapData {
  version: number;
  name: string;
  origin: { lat: number; lon: number };
  bounds: [number, number, number, number];
  roads: MapRoad[];
  buildings: MapBuilding[];
  water: number[][];
  parks: number[][];
  signals: number[];
  pois: MapPoi[];
  attribution: string;
}

export const ROAD_CLASS_NAMES = ['고속도로', '도시고속도로', '간선도로', '보조간선', '집산도로', '골목', '연결로'];
