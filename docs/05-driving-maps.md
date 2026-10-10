# STEP 05. 서울 및 서킷 구현

> 상태: **설계 초안 · 오피스아워 권장안 적용됨 · 구현 대기**

## 1. 목표
- **서울 스타일 도심(절차적)**: 격자+간선 도로, 교차로, 차선 표시, 횡단보도, 다양한 높이의 건물, 한글 간판 느낌의 텍스처, 신호등(사이클 동작)
- **서울 실제 도로(OSM, 단계 적용)**: 1차로 약 1~2km² 지역(후보: 강남 테헤란로 일대 — 비교적 평탄한 격자형)
- **레이싱 서킷(오리지널)**: 약 3~4km, 고속 직선 + 헤어핀 + S자, 연석, 런오프
- 맵 선택 메뉴, 서킷 랩타임(체크포인트, 최고 기록 localStorage 저장)

사용자 경험: 메뉴에서 "서울 도심 / 서킷"을 고르고, 서울에서는 신호를 지키며 크루징하고, 서킷에서는 랩타임 기록에 도전합니다.

## 2. 기술 및 오픈소스
| 기술 | URL | 라이선스 | 선택 이유 | 대안 |
|---|---|---|---|---|
| OpenStreetMap 데이터 | https://www.openstreetmap.org | ODbL 1.0 | 실제 도로망 | V-World ⚠️ |
| Overpass API / Geofabrik | https://overpass-api.de / https://download.geofabrik.de | 이용 정책 있음 | 추출 | — |
| osmtogeojson | https://github.com/tyrasd/osmtogeojson | MIT | 변환 보조 | 직접 파싱 |
| Three.js InstancedMesh / BatchedMesh | three.js | MIT | 건물 Draw Call 감소 | 메시 병합 |
| CatmullRom 스플라인 | three.js | MIT | 서킷 트랙 생성 | Blender 수작업 |

## 3. 구현 설계
- `world/MapLoader.ts`: `MapDefinition` 로드/해제, 로딩 진행률
- `world/roads/RoadGraph.ts`: 노드(교차로)·엣지(도로, 차선 수, 제한속도) — 교통(STEP 07)·내비게이션 공용
- `world/roads/RoadMeshBuilder.ts`: 그래프 → 도로·교차로 메시 + 물리 콜라이더(TriMesh)
- `world/maps/seoul-procedural/`: 시드 기반 생성(재현 가능)
- `world/maps/seoul-osm/`: `tools/osm-to-map.ts`가 만든 JSON 로드
- `world/maps/circuit/`: 스플라인 정의 → 트랙 메시, 연석, 체크포인트
- `world/TrafficLights.ts`: 교차로별 위상 사이클
- `game/LapTimer.ts`: 체크포인트 순서 검증, 섹터 타임
- **청크 분할**: 도시를 200m 청크로 나눠 거리 기반 로드/언로드(STEP 08과 연계)

## 4. 구현 순서
- [ ] 1. MapDefinition + MapLoader + 맵 선택 메뉴
- [ ] 2. 오리지널 서킷(가장 단순하고 리스크 낮음) + 랩타이머
- [ ] 3. RoadGraph + 절차적 서울 도로망
- [ ] 4. 건물 생성(인스턴싱), 간판 텍스처 아틀라스
- [ ] 5. 신호등
- [ ] 6. `tools/osm-to-map.ts` 프로토타입(강남 소규모 지역)
- [ ] 7. OSM 맵 품질 평가 후 적용 여부 결정
- [ ] 8. OSM 출처 표기 UI
- [ ] 9. 맵 로딩 시간·Draw Call 측정

## 5. 예상 문제
| 위험 | 대응 |
|---|---|
| OSM 교차로·차선 형상 생성이 어려움 | 절차적 도시를 기본으로 두고 OSM은 선택 맵으로 |
| 서울 지형 고도·고가도로 | 1차 범위는 평탄 지역, 고도는 무시 |
| 건물 수가 많아 Draw Call 폭증 | InstancedMesh/BatchedMesh, 청크 컬링, 목표 ≤ 300 calls |
| 도로 TriMesh 콜라이더 이음새에서 휠이 튐 | 콜라이더 단순화(평면 + 연석 분리) |
| 실제 서킷 재현 권리 문제 | 오리지널 서킷 |

## 6. 완료 기준
- 두 맵(+ 선택적 OSM 맵) 선택 후 주행 가능, 서킷에서 랩타임 기록, 서울 맵에서 신호등 동작
- 맵 로딩 ≤ 5초, 도심 주행 시 기준 PC 60 FPS

## 7. 테스트
- 기능: 맵 전환 메모리 누수(전환 10회 후 힙 비교), 랩 체크포인트 역주행·지름길 방지
- 성능: 맵별 로딩 시간, Draw Call, 삼각형 수, 물리 ms

## 8. 오피스아워 질문 (권장안 적용됨)
| # | 질문 | 적용된 권장안 |
|---|---|---|
| Q5-1 | 실제 서울 vs 서울 스타일? | 서울 스타일 먼저, OSM 강남 소규모 지역은 실험 후 추가 |
| Q5-2 | 실제 서킷 재현? | 오리지널 서킷 |
| Q5-3 | 신호 위반 페널티? | 경고 표시만(게임성보다 드라이브 감상 우선) |
| Q5-4 | 랩타임 온라인 랭킹? | 하지 않음(서버 필요), localStorage 개인 기록만 |

## 9. 개발 결과
- (미착수)
