# STEP 02. 차량 물리 시스템

> 상태: **설계 초안 · 오피스아워 권장안 적용됨 · 구현 대기**

## 1. 목표
- Rapier `DynamicRayCastVehicleController` 기반 4륜 차량 생성
- WASD/방향키 주행: 가속, 브레이크, 후진, 조향, 핸드브레이크(Space)
- 기어(자동 변속), 엔진 토크 곡선, 속도 감응 조향
- 장애물 충돌, 기본 서스펜션, 리셋(R: 바로 세우기, 마지막 안전 위치 복귀)

사용자 경험: 박스 형태의 차량이지만 무게감 있게 가속하고, 코너에서 서스펜션이 눌리고, 벽에 부딪히면 튕기는 "운전하는 느낌".

## 2. 기술 및 오픈소스
| 기술 | URL | 라이선스 | 선택 이유 | 대안 |
|---|---|---|---|---|
| Rapier Vehicle Controller | https://github.com/dimforge/rapier.js | Apache-2.0 | 내장 레이캐스트 서스펜션 | cannon-es RaycastVehicle, Jolt WheeledVehicle |
| 커스텀 Drivetrain | (직접 구현) | — | 엔진/기어는 Rapier 범위 밖 | — |

차량 파라미터(질량·휠베이스·토크) 출처 ⚠️: 공개 제원표(제조사 보도자료 등)를 STEP 02 착수 시 확인해 `VehicleConfig`에 출처 주석과 함께 기록합니다. 확인 전에는 "GLC 300 4MATIC Coupé급 추정치"로 표기합니다.

## 3. 구현 설계
### 핵심 모듈
- `vehicle/VehicleConfig.ts`: 파라미터 정의(아키텍처 문서 참조), 기본 프리셋 `GLC_COUPE_INSPIRED`
- `vehicle/Drivetrain.ts`: 토크 곡선 보간, 자동 변속, RPM 계산 (순수 함수 → 단위 테스트)
- `vehicle/Vehicle.ts`: 섀시 강체 + 컨트롤러, `applyControls(ControlState)`, `getTelemetry()`
- `input/InputSystem.ts`, `input/KeyboardSource.ts`: 키 → ControlState, 입력 램프(급격한 0→1 방지)
- `vehicle/VehicleDebugVisual.ts`: 박스 섀시 + 실린더 휠 (STEP 04에서 GLB로 교체)

### 데이터 흐름
Keyboard → ControlState(스무딩) → Drivetrain(엔진 토크 → 휠 힘) → VehicleController(engineForce, brake, steering) → Rapier step → Telemetry(속도, RPM, 기어) → HUD

### 주요 인터페이스
```ts
interface VehicleTelemetry { speedKmh: number; rpm: number; gear: number; wheelContact: boolean[]; suspensionCompression: number[]; }
```

## 4. 구현 순서
- [ ] 1. InputSystem + KeyboardSource (STEP 01 엔진 위)
- [ ] 2. VehicleConfig 프리셋 + 제원 출처 조사
- [ ] 3. Drivetrain 순수 로직 + 단위 테스트
- [ ] 4. Vehicle: 섀시 + 4휠 + 컨트롤러 (1–3 이후)
- [ ] 5. 무게중심 낮추기, 안티롤 보정(전복 방지)
- [ ] 6. 테스트 트랙: 경사로, 범프, 벽, 콘
- [ ] 7. 리셋 로직
- [ ] 8. 간이 HUD(속도, 기어, RPM 숫자)
- [ ] 9. lil-gui로 파라미터 실시간 튜닝
- [ ] 10. 측정값 기록

## 5. 예상 문제
| 위험 | 대응 |
|---|---|
| 고속 코너링 시 쉽게 전복 | 무게중심 하향, 롤 영향 계수, 저속/고속 조향각 분리 |
| 레이캐스트 휠이 얇은 물체를 통과 | 섀시 콜라이더 보강, 필요 시 CCD |
| 실제 차량 같은 미끄러짐 부족 | 횡마찰 커브 튜닝 → 부족하면 STEP 06 커스텀 타이어 모델 |
| 정지 상태에서 차량이 미끄러짐 | 저속 시 브레이크 홀드 |
| 물리 파라미터 튜닝에 시간 소요 | GUI 튜닝 + 프리셋 저장 |

## 6. 완료 기준
- 성공: 0→100km/h 가속 시간이 설정값(목표 약 6~7초 ⚠️ 제원 확인 후 조정)의 ±20% 이내, 최고 속도 제한 동작, 시속 60km에서 급조향 시 전복하지 않음, 벽 충돌 후 리셋 가능
- 실패: 정지 상태 떨림, 조작 지연이 체감되거나(>100ms) 물리 시간 > 4ms/프레임

## 7. 테스트
- 기능: 가속 테스트, 제동 거리(100→0), 원 선회, 범프 통과, 리셋
- 성능: 차량 1대 + 장애물 50개에서 물리 ms
- 단위: Drivetrain 기어 변속 시점, RPM 계산

## 8. 오피스아워 질문 (권장안 적용됨)
| # | 질문 | 적용된 권장안 |
|---|---|---|
| Q2-1 | 아케이드 vs 시뮬레이션 조작감? | **세미 아케이드**: 실제 제원 기반이지만 미끄러짐·전복은 관대하게 |
| Q2-2 | 변속 방식? | 자동 기본, 수동(Q/E)은 옵션 |
| Q2-3 | 구동 방식? | 4MATIC 참고 AWD(앞 40 : 뒤 60 토크 분배, 가정) |
| Q2-4 | 손상 모델? | 넣지 않음 |
| Q2-5 | 레이싱 휠 지원 시점? | 입력 추상화만 지금 만들고, 실제 매핑은 STEP 06 이후 |

## 9. 개발 결과
- (미착수)
