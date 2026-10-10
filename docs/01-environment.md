# STEP 01. 프로젝트 환경 구축

> 상태: **설계 완료 · 오피스아워 권장안 적용됨 · 구현 대기 (사용자 지시 필요)**

## 1. 목표
- Vite + TypeScript 프로젝트를 초기화하고 Three.js 렌더링과 Rapier 물리를 연결합니다.
- 기본 지면, 조명, 하늘을 만들고 떨어지는 박스로 물리 동작을 확인합니다.
- FPS·프레임 시간·물리 시간·Draw Call을 화면에 표시합니다.
- **GitHub Pages 자동 배포를 구성해 친구가 주소만으로 접속할 수 있게 합니다.**

사용자 경험: 링크를 열면 하늘과 지면이 있는 3D 공간에서 박스가 떨어져 바닥에 부딪히고, 마우스로 시점을 돌려 볼 수 있습니다.

## 2. 기술 및 오픈소스
| 기술 | URL | 라이선스 | 선택 이유 | 대안 |
|---|---|---|---|---|
| Vite | https://github.com/vitejs/vite | MIT | 빠른 개발 서버, 정적 빌드 | Webpack |
| TypeScript | https://github.com/microsoft/TypeScript | Apache-2.0 | 타입 안전성 | JS + JSDoc |
| Three.js | https://github.com/mrdoob/three.js | MIT | 렌더링 | Babylon.js |
| @dimforge/rapier3d-compat | https://github.com/dimforge/rapier.js | Apache-2.0 | WASM 내장으로 배포 간단 | `@dimforge/rapier3d`(번들러 플러그인 필요) |
| Vitest | https://github.com/vitest-dev/vitest | MIT | Vite와 설정 공유 | Jest |
| GitHub Actions + Pages | — | — | 무료 자동 배포 | Vercel |

라이브러리 버전은 착수 시점의 최신 안정판으로 `package.json`에 **정확한 버전으로 고정**합니다.

## 3. 구현 설계
### 핵심 모듈
- `core/Engine`: 렌더러·씬·물리 월드 소유, 리사이즈 처리
- `core/GameLoop`: 60Hz 고정 스텝 + 보간 알파, dt 클램프(0.25s)
- `physics/PhysicsWorld`: Rapier 초기화(`await RAPIER.init()`), 바디와 메시 동기화
- `debug/PerfMonitor`: 프레임 시간, 물리 시간(`performance.now()`), `renderer.info.render.calls`, `performance.memory`(Chromium만)
- `ui/PerfOverlay`: 측정값 표시 (`?debug` 쿼리 또는 F3으로 토글)

### 파일 구조
```text
index.html
vite.config.ts            # base: '/dream-drive-simulator/'
src/main.ts
src/core/{Engine,GameLoop}.ts
src/physics/PhysicsWorld.ts
src/world/{Ground,Lighting}.ts
src/debug/PerfMonitor.ts
src/ui/PerfOverlay.ts
tests/GameLoop.test.ts
.github/workflows/deploy.yml
```

### 데이터 흐름
`main.ts` → `RAPIER.init()` → `Engine` 생성 → `GameLoop.start()` → (fixedUpdate: physics.step) → (render: 보간 동기화 → render → PerfMonitor)

## 4. 구현 순서
- [ ] 1. `feature/step-01-environment` 브랜치 생성
- [ ] 2. Vite vanilla-ts 템플릿 초기화, 불필요 파일 제거
- [ ] 3. three, @dimforge/rapier3d-compat, vitest 설치 및 버전 고정
- [ ] 4. Engine: 렌더러(antialias, sRGB, ACES 톤매핑), 카메라, 리사이즈
- [ ] 5. 지면(평면 + 그리드 텍스처), 하늘(Sky 셰이더 또는 그라디언트), 방향광 + 반구광, 그림자
- [ ] 6. PhysicsWorld: 지면 콜라이더, 박스 10개 낙하 (4·5 이후)
- [ ] 7. GameLoop 고정 스텝 + 보간 (6 이후)
- [ ] 8. PerfMonitor + PerfOverlay
- [ ] 9. OrbitControls 임시 카메라 (STEP 03에서 교체)
- [ ] 10. GameLoop 단위 테스트 (스텝 횟수, 클램프)
- [ ] 11. `vite.config.ts` base 설정, GitHub Actions 배포 워크플로
- [ ] 12. README에 실행 방법과 배포 주소 작성
- [ ] 13. 성능 기준값 측정 → progress.md 기록

## 5. 예상 문제
| 위험 | 영향 | 대응 |
|---|---|---|
| Rapier WASM 로딩 실패/지연 | 첫 화면 지연 | compat 패키지 사용, 로딩 표시 |
| GitHub Pages 하위 경로에서 에셋 404 | 배포본 깨짐 | `base` 설정, 에셋은 `import.meta.env.BASE_URL` 기준 경로 사용 |
| 저장소가 Private이면 무료 Pages 불가 | 공유 불가 | 저장소 Public 유지 확인 |
| 고주사율(144Hz) 모니터에서 물리 지터 | 시각 떨림 | 보간 렌더링 |
| `performance.memory`는 Chromium 전용 | 메모리 측정 불가 브라우저 | 지원 시에만 표시, Chrome DevTools로 보완 |

## 6. 완료 기준
- 성공: 배포 주소에서 3D 씬이 열리고, 박스가 떨어져 지면과 충돌하며, 오버레이에 FPS·ms·물리 ms·Draw Call이 표시됩니다. 콘솔 에러가 없습니다.
- 실패: 배포본이 빈 화면이거나 에셋이 404이거나, 기준 PC에서 60 FPS 미만입니다(빈 씬 기준).

## 7. 테스트
- 기능: `npm run dev` 로컬 확인, `npm run build && npm run preview`로 배포본 확인, 배포 URL을 다른 기기(휴대폰 포함)에서 열기
- 성능: 30초간 평균/최저 FPS, 평균 프레임 ms, 물리 ms, Draw Call, 초기 로딩 시간(DOMContentLoaded → 첫 렌더)
- 결과 기록: progress.md "성능 기록" 표

## 8. 오피스아워 질문 (권장안 적용됨)
| # | 질문 | 적용된 권장안 |
|---|---|---|
| Q1-1 | 패키지 매니저는? | npm (Node 24 설치 확인됨, 추가 도구 불필요) |
| Q1-2 | Rapier `compat` vs 일반 패키지? | compat — 번들 크기가 약간 커져도 배포 단순성 우선 |
| Q1-3 | 배포를 STEP 08까지 미룰까? | **STEP 01부터 자동 배포** — 친구 공유 요구사항 |
| Q1-4 | 호스팅은? | GitHub Pages(저장소 Public 전제). LLM 프록시가 필요해지면 STEP 07에서 Cloudflare Workers 추가 |
| Q1-5 | 기준 성능 측정 기기는? | 사용자의 현재 Windows PC를 기준 기기로 하고 사양을 progress.md에 기록 |
| Q1-6 | 렌더러는 WebGL2 vs WebGPU? | WebGL2 (호환성), WebGPU는 STEP 08 이후 검토 |
| Q1-7 | 코드 스타일 도구? | ESLint + Prettier 최소 설정 |

## 9. 개발 결과
- 구현 완료 기능: (미착수)
- 미완료 기능: —
- 발견된 문제: —
- 다음 단계에 미치는 영향: —
