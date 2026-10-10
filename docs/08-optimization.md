# STEP 08. 최적화 및 배포

> 상태: **설계 초안 · 오피스아워 권장안 적용됨 · 구현 대기**
> 배포 파이프라인 자체는 STEP 01에서 먼저 구축합니다. 이 단계는 **품질·성능·호환성 완성**에 집중합니다.

## 1. 목표
- FPS·프레임 시간 개선, 렌더링(Draw Call, 셰이더, 그림자) 최적화
- 물리 연산 최적화(콜라이더 단순화, 슬립, 원거리 AI 비물리화)
- 모델·텍스처 압축(Meshopt, KTX2), 로딩 시간 개선(코드 분할, 지연 로딩, 프리로드)
- 브라우저 호환성(Chrome/Edge/Firefox/Safari, 저사양 노트북)
- 실제 사용자 체험 테스트(친구·지인 5명 이상)
- 최종 웹 배포(커스텀 도메인 선택)

## 2. 기술 및 오픈소스
| 기술 | URL | 라이선스 | 용도 | 대안 |
|---|---|---|---|---|
| glTF-Transform | https://github.com/donmccurdy/glTF-Transform | MIT | 압축 파이프라인 | gltfpack |
| KTX-Software | https://github.com/KhronosGroup/KTX-Software | Apache-2.0 | 텍스처 압축 | WebP |
| Spector.js | https://github.com/BabylonJS/Spector.js | MIT | WebGL 프레임 분석 | Chrome DevTools |
| Lighthouse | https://github.com/GoogleChrome/lighthouse | Apache-2.0 | 로딩 성능 | WebPageTest |
| Playwright | https://github.com/microsoft/playwright | Apache-2.0 | 크로스브라우저 스모크 | — |

## 3. 구현 설계
- `tools/optimize-assets.ts`: 원본 에셋 → 압축 결과 + 용량 리포트
- `debug/Benchmark.ts`: **고정 시나리오 벤치마크**(정해진 경로 자동 주행 60초) → 같은 조건 재측정 보장, 결과 JSON 다운로드
- 품질 자동 감지: 초기 5초 평균 FPS로 프리셋 결정
- 개선 절차(모든 항목 공통): 문제 발견 → 측정 → 원인 분석 → 개선 방법 비교 → 적용 → 같은 벤치마크로 재측정 → progress.md 기록

## 4. 구현 순서
- [ ] 1. Benchmark 시나리오(서울/서킷) 구축
- [ ] 2. 기준 측정
- [ ] 3. 렌더 최적화(인스턴싱, 머티리얼 공유, 그림자 범위, LOD, 프러스텀/거리 컬링)
- [ ] 4. 물리 최적화
- [ ] 5. 에셋 압축 + 지연 로딩
- [ ] 6. 크로스브라우저 테스트
- [ ] 7. 사용자 테스트(체험 설문)
- [ ] 8. 최종 배포, README 정리

## 5. 예상 문제
| 위험 | 대응 |
|---|---|
| Safari WebGL 차이·WASM 성능 차이 ⚠️ | 조기 테스트, 기능 저하 모드 |
| GitHub Pages 용량·대역폭 제한 ⚠️ | 에셋 총량 관리, 필요 시 Cloudflare Pages/R2 |
| 모바일 접속 | 지원 범위 명시, 최소 터치 조작 또는 안내 화면 |

## 6. 완료 기준
- 외부 사용자가 배포 URL로 접속해 쇼룸 → 탑승 → 서울/서킷 주행 → 랩타임까지 체험
- 목표: 초기 로딩 ≤ 5초(일반 유선/와이파이), 초기 다운로드 ≤ 15MB, 기준 PC 60 FPS, 내장 GPU 노트북 30 FPS(Low)

## 7. 테스트
| 지표 | 개선 전 | 개선 후 | 방법 |
|---|---|---|---|
| 평균 FPS / 1% Low | | | Benchmark |
| 프레임 ms | | | Benchmark |
| 물리 ms | | | PerfMonitor |
| Draw Call | | | renderer.info |
| 메모리(JS 힙/GPU 추정) | | | DevTools |
| 맵 로딩 시간 | | | performance.mark |
| 차량 GLB 용량 | | | 파일 크기 |

## 8. 오피스아워 질문 (권장안 적용됨)
| # | 질문 | 적용된 권장안 |
|---|---|---|
| Q8-1 | 커스텀 도메인? | 선택 사항. 기본은 github.io 주소 |
| Q8-2 | 모바일 지원? | 데스크톱 우선, 모바일은 "데스크톱 권장" 안내 + 쇼룸 감상만 |
| Q8-3 | 사용 통계 수집? | 하지 않음(개인정보 고지 부담), 피드백은 설문 링크로 |

## 9. 개발 결과
- (미착수)
