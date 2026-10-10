# STEP 03. 카메라 시스템

> 상태: **설계 초안 · 오피스아워 권장안 적용됨 · 구현 대기**

## 1. 목표
- **Orbit(쇼룸)**: 정차 중 차량 주변 360도 회전·줌, 자동 회전 옵션
- **Chase(GTA 스타일 3인칭)**: 스프링 추종, 속도에 따른 거리·FOV 변화, 마우스로 일시 둘러보기 후 자동 복귀
- **Cockpit(운전석 1인칭)**: 운전자 눈 위치 고정, 마우스로 고개 돌리기(제한 각도)
- 모드 전환: C키 순환, 쇼룸 ↔ 주행은 E키 또는 버튼, 부드러운 전환(0.5s 블렌드)

사용자 경험: 차를 천천히 돌려 보며 감상한 뒤 "탑승"하면 카메라가 운전석으로 들어가고, 주행 중에는 GTA처럼 차 뒤에서 따라갑니다.

## 2. 기술 및 오픈소스
| 기술 | URL | 라이선스 | 선택 이유 | 대안 |
|---|---|---|---|---|
| Three.js PerspectiveCamera, Pointer Lock API | three.js / 웹 표준 | MIT | 기본 제공 | — |
| OrbitControls (three/addons) | three.js | MIT | 쇼룸 모드에 그대로 사용 | camera-controls (MIT, https://github.com/yomotsu/camera-controls) |
| three-mesh-bvh (선택) | https://github.com/gkjohnson/three-mesh-bvh | MIT | 카메라가 벽을 뚫지 않도록 빠른 레이캐스트 | Rapier 레이캐스트 |

## 3. 구현 설계
- `camera/CameraSystem.ts`: 모드 상태 머신, 블렌딩
- `camera/modes/{OrbitMode,ChaseMode,CockpitMode}.ts`: `CameraMode` 인터페이스 구현
- `camera/CameraCollision.ts`: 차량 → 카메라 레이캐스트(Rapier 쿼리 재사용), 장애물이 있으면 당겨오기
- 입력: `input/MouseSource.ts` (Pointer Lock, 감도, Y축 반전 옵션)
- 데이터 흐름: Vehicle 보간 Transform → CameraMode.update → camera.position/quaternion → 렌더

## 4. 구현 순서
- [ ] 1. CameraMode 인터페이스, CameraSystem 상태 머신
- [ ] 2. OrbitMode (OrbitControls 래핑, 거리·각도 제한)
- [ ] 3. ChaseMode (임계 감쇠 스프링, 속도 기반 FOV 60→75)
- [ ] 4. CockpitMode (차량 로컬 좌표 눈 위치, 요/피치 제한)
- [ ] 5. 모드 전환 블렌딩
- [ ] 6. 카메라 충돌 처리
- [ ] 7. 설정 UI(감도, 반전)

## 5. 예상 문제
| 위험 | 대응 |
|---|---|
| 1인칭에서 물리 진동이 그대로 전달돼 멀미 유발 | 카메라 저역통과 필터, 흔들림 강도 옵션 |
| 3인칭 카메라가 건물을 뚫음 | 레이캐스트로 거리 단축 |
| Pointer Lock UX 혼란 | 클릭해서 잠금, ESC 안내 문구 |
| 1인칭 근거리 클리핑 | near 0.05, 실내 모델 스케일 검증 |

## 6. 완료 기준
- 세 모드가 모두 동작하고 전환 시 튀는 현상이 없으며, 120km/h 주행 중에도 Chase 카메라가 안정적입니다.

## 7. 테스트
- 기능: 각 모드 진입·이탈, 벽 근처 주행 시 카메라 충돌, 고속 주행 흔들림 체감 평가
- 성능: 카메라 충돌 레이캐스트 비용(0.1ms 이하 목표)

## 8. 오피스아워 질문 (권장안 적용됨)
| # | 질문 | 적용된 권장안 |
|---|---|---|
| Q3-1 | 쇼룸 전용 화면을 둘까? | 둡니다 — 첫 진입은 쇼룸(드림카 감상이 핵심 경험) |
| Q3-2 | 하차 후 걸어다니기(GTA식)? | 하지 않음, 하차 = 쇼룸 모드 |
| Q3-3 | 후방 거울/백미러 렌더링? | STEP 06 이후 선택(추가 렌더 패스 비용) |

## 9. 개발 결과
- (미착수)
