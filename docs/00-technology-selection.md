# 00. 기술 선택

> **표기 규칙**
> - ✅ 확인: 공식 저장소·라이선스 파일 기준으로 일반적으로 알려진 사실
> - ⚠️ 가정/확인 필요: 버전, 유지보수 활동, 약관 등 변할 수 있거나 아직 직접 검증하지 않은 내용
>
> 유지보수 상태는 문서 작성 시점의 지식 기준입니다. **STEP 01 착수 시 각 저장소의 최근 릴리스 날짜를 다시 확인해 아래 표에 기록**합니다.

## 1. 요약 — 최종 선정

| 영역 | 선정 | 라이선스 | 대표 대안 |
|---|---|---|---|
| 빌드/개발 서버 | Vite + TypeScript | MIT ✅ | Webpack, Parcel, esbuild 단독 |
| 3D 렌더링 | Three.js | MIT ✅ | Babylon.js, PlayCanvas |
| 물리 | Rapier (`@dimforge/rapier3d-compat`) | Apache-2.0 ✅ | cannon-es, ammo.js, JoltPhysics.js |
| 3D 제작 | Blender | GPL-2.0-or-later ✅ (제작 결과물은 GPL 적용 안 됨) | — |
| 에셋 포맷 | glTF 2.0 / GLB | Khronos 공개 표준 ✅ | FBX, OBJ |
| 에셋 압축 | glTF-Transform + Meshopt/Draco + KTX2 | MIT / MIT / Apache-2.0 / Apache-2.0 ✅ | gltfpack 단독 |
| 지도 데이터 | OpenStreetMap | ODbL 1.0 ✅ | 국토부·V-World 데이터 ⚠️ |
| 오디오 | Web Audio API (직접 구현) | 웹 표준 | Tone.js, howler.js |
| 교통 | 규칙 기반 IDM + 도로 그래프 (직접 구현) | — | SUMO, Yuka |
| 보행자 | recast-navigation-js (필요 시) | MIT ✅ | Yuka |
| AI(자연어/음성) | LLM API(프록시 경유) + Web Speech API | 상용 약관 ⚠️ | 로컬 규칙 파서, WebLLM |
| 테스트 | Vitest (+ Playwright 스모크) | MIT / Apache-2.0 ✅ | Jest |
| 성능 측정 | `renderer.info` + 자체 PerfMonitor (+ stats.js) | MIT ✅ | Spector.js |
| 배포 | GitHub Pages + Actions | GitHub 약관 | Vercel, Netlify, Cloudflare Pages |

---

## 2. 항목별 검토

### 2.1 Vite + TypeScript
1. **필요 이유**: 빠른 HMR, WASM(Rapier)·GLB 정적 에셋 처리, 정적 사이트 빌드. TypeScript는 물리·차량 파라미터처럼 단위와 구조가 중요한 코드에서 실수를 줄여 줍니다.
2. **대안**: Webpack(설정 복잡), Parcel(제로 설정이지만 생태계 작음), esbuild 단독(개발 서버 기능 약함).
3. **성능/난이도**: 낮은 난이도, 개발 서버 매우 빠름.
4. **유지보수**: 매우 활발 ⚠️(릴리스 재확인).
5. **라이선스**: MIT ✅ — https://github.com/vitejs/vite
6. **선정 이유**: 사실상 표준이고, `base` 옵션 하나로 GitHub Pages 하위 경로 배포가 간단합니다.

### 2.2 Three.js
1. **필요 이유**: WebGL 렌더링, glTF 로더, PBR 재질, 그림자, 후처리.
2. **대안**
   - Babylon.js (Apache-2.0, https://github.com/BabylonJS/Babylon.js): 엔진 기능이 많고 물리 통합(Havok)·인스펙터가 강점. 번들이 크고 저수준 제어 자유도는 낮습니다.
   - PlayCanvas (MIT, https://github.com/playcanvas/engine): 에디터 중심 워크플로라 코드 중심 프로젝트에는 덜 맞습니다.
3. **성능/난이도**: 렌더러로서 가볍고 예제가 가장 많습니다. 게임 루프·씬 관리는 직접 만들어야 해서 구조 설계 부담이 있습니다.
4. **유지보수**: 월 단위 릴리스(r1xx) ⚠️ — 버전 고정 필요, 간혹 API 변경이 있습니다.
5. **라이선스**: MIT ✅ — https://github.com/mrdoob/three.js
6. **선정 이유**: 학습 자료·예제·생태계(three-mesh-bvh, postprocessing 등)가 가장 많고 렌더링을 세밀하게 제어할 수 있습니다. 차량 쇼룸 품질의 PBR 표현에 충분합니다.

### 2.3 Rapier
1. **필요 이유**: 강체 충돌, 지면 레이캐스트, 차량 컨트롤러.
2. **대안**
   - cannon-es (MIT, https://github.com/pmndrs/cannon-es): 순수 JS로 쉽고 RaycastVehicle 예제가 많습니다. 성능이 낮고 개발 활동이 적습니다 ⚠️.
   - ammo.js (zlib, https://github.com/kripken/ammo.js): Bullet 포팅으로 btRaycastVehicle을 제공합니다. API가 불편하고 메모리를 수동 관리해야 하며 활동이 적습니다 ⚠️.
   - JoltPhysics.js (MIT, https://github.com/jrouwe/JoltPhysics.js): 고급 차량 제약(WheeledVehicleController)이 있고 고성능입니다. 바인딩 API가 저수준이라 학습 비용이 큽니다.
3. **성능/난이도**: Rust → WASM으로 빠르고 결정적(deterministic) 옵션이 있습니다. `DynamicRayCastVehicleController`로 서스펜션·마찰을 바로 쓸 수 있습니다.
4. **유지보수**: dimforge에서 활발히 개발 중 ⚠️(릴리스 재확인).
5. **라이선스**: Apache-2.0 ✅ — https://github.com/dimforge/rapier.js
6. **선정 이유**: 성능, 유지보수, 차량 컨트롤러 내장의 균형이 가장 좋습니다. `-compat` 패키지는 WASM을 base64로 내장해 Vite·GitHub Pages에서 별도 설정 없이 동작합니다.
   - **위험 대비**: 레이캐스트 차량의 타이어 모델이 단순해 드리프트·고속 주행감이 부족할 수 있습니다. 이 경우 STEP 06에서 휠 힘을 직접 계산하는 커스텀 타이어 모델(Pacejka 간이식)로 교체할 수 있게 `Vehicle` 내부를 캡슐화합니다.

### 2.4 Blender + glTF/GLB
1. **필요 이유**: 차량·실내·건물 모델 제작 및 glTF 내보내기.
2. **대안**: 상용 툴(Maya, 3ds Max)은 오픈소스 원칙과 비용 면에서 제외합니다.
3. **난이도**: 차량 하드서피스 모델링은 시간이 많이 듭니다 → 가장 큰 일정 위험 중 하나입니다.
4. **유지보수**: 매우 활발 ✅.
5. **라이선스**: Blender는 GPL이지만 **Blender로 만든 결과물에는 GPL이 적용되지 않습니다** ✅. glTF는 Khronos 공개 표준입니다.
6. **선정 이유**: 무료이고 glTF 내보내기가 공식 지원됩니다.

### 2.5 에셋 압축 (STEP 04·08)
- glTF-Transform (MIT, https://github.com/donmccurdy/glTF-Transform): CLI·스크립트로 최적화 파이프라인을 만들 수 있습니다.
- meshoptimizer/gltfpack (MIT, https://github.com/zeux/meshoptimizer): 디코딩이 빠른 메시 압축.
- Draco (Apache-2.0, https://github.com/google/draco): 압축률이 높지만 디코딩 비용이 큽니다.
- KTX2/Basis (Apache-2.0, https://github.com/KhronosGroup/KTX-Software): GPU 압축 텍스처로 VRAM을 크게 줄입니다.
- **선정**: 메시는 Meshopt(디코딩 속도 우선), 텍스처는 KTX2. Draco는 비교 실험용으로 둡니다.

### 2.6 OpenStreetMap
1. **필요 이유**: 실제 서울 도로망·건물 윤곽.
2. **대안**: 국토교통부/V-World 3D 건물 데이터 ⚠️(라이선스·API 약관 미확인, 확인 전에는 사용 안 함), 절차적 생성.
3. **난이도**: OSM → 도로 메시 변환(차선 폭, 교차로 형상, 고가도로, 고도)이 까다롭습니다. 서울은 지형 기복과 다층 도로가 많습니다.
4. **유지보수**: 데이터는 지속 갱신 ✅. 데이터 추출은 Overpass API(공용 서버, 이용 정책 있음) 또는 Geofabrik 추출본을 씁니다.
5. **라이선스**: ODbL 1.0 ✅. 화면에 "© OpenStreetMap contributors" 표기가 필수입니다.
6. **선정 이유**: 합법적으로 쓸 수 있는 가장 현실적인 실제 도로 데이터입니다. **런타임 호출 없이 `tools/`에서 오프라인으로 변환한 JSON을 배포**해 로딩과 공용 서버 부하를 함께 줄입니다.
   - 변환 보조: osmtogeojson (MIT, https://github.com/tyrasd/osmtogeojson).

### 2.7 Web Audio API
1. **필요 이유**: RPM에 따른 엔진음, 타이어 스키드, 브레이크 소리.
2. **대안**: Tone.js (MIT, https://github.com/Tonejs/Tone.js) — 신시사이저 중심이라 무겁습니다. howler.js (MIT, https://github.com/goldfire/howler.js) — 단순 재생에 적합하지만 실시간 피치·크로스페이드 제어가 제한적입니다.
3. **난이도**: 중간. RPM 대역별 샘플 루프 크로스페이드 + 피치 조절을 직접 구현합니다.
4. **선정 이유**: 의존성이 없고 정밀하게 제어할 수 있습니다.
5. **에셋 위험** ⚠️: 실제 GLC 엔진 녹음은 확보하기 어렵습니다. CC0/CC-BY 엔진 샘플(freesound.org, 개별 라이선스 확인) 또는 절차적 합성으로 대체합니다.

### 2.8 교통 시뮬레이션 — "AI"가 필요한가?
- **결론: 교통 차량 주행에는 머신러닝을 쓰지 않습니다.** 차선 추종과 차간 거리 유지는 고전 모델(IDM: Intelligent Driver Model, Pure Pursuit 조향)로 충분하고, 예측 가능하고, 가볍습니다.
- 대안
  - SUMO (EPL-2.0, https://github.com/eclipse-sumo/sumo): 정밀 교통 시뮬레이터지만 네이티브 서버라 브라우저 내장이 어렵습니다. 오프라인 검증 도구로만 고려합니다.
  - Yuka (MIT, https://github.com/Mugen87/yuka): 게임 AI(steering, FSM) 라이브러리. 유지보수 활동이 적어 ⚠️ 필요한 알고리즘만 참고합니다.
- 보행자: recast-navigation-js (MIT, https://github.com/isaac-mason/recast-navigation-js) 내비메시. 처음에는 인도 경로 추종만으로 충분할 수 있습니다.

### 2.9 AI 기능 (STEP 07)
| 문제 | AI 필요성 | 접근 |
|---|---|---|
| "남산타워 가고 싶어" → 목적지 | **높음**: 자연어의 다양성 | LLM으로 의도·장소 추출 → 맵 POI 매칭 → 경로 탐색(A*, 규칙 기반) |
| 음성 드라이빙 가이드 | 중간 | 안내 문장은 템플릿, 음성은 Web Speech API `speechSynthesis`(브라우저 내장, 무료) |
| 교통 차량 행동 | 낮음 | 규칙 기반 (위 2.8) |
| 3D 에셋 제작 보조 | 보조적 | 아래 2.10 |

- LLM 선택 ⚠️: Claude API 등 상용 LLM은 **API 키를 브라우저에 넣으면 안 됩니다** → 서버리스 프록시(Cloudflare Workers 등)가 필요합니다. GitHub Pages만으로는 불가능합니다.
- 대안: WebLLM(브라우저 로컬 실행, 모델 다운로드가 수백 MB 이상 ⚠️) 또는 규칙 기반 키워드 파서.
- **권장 순서**: 규칙 기반 파서(베이스라인) → LLM 버전 → 같은 테스트 문장 세트로 정확도·지연·비용 비교. 프록시가 없을 때는 베이스라인으로 자동 폴백합니다.

### 2.10 AI 3D 에셋 생성 ⚠️
- 후보: Microsoft TRELLIS (https://github.com/microsoft/TRELLIS, MIT로 알려짐 ⚠️ 확인 필요), Tencent Hunyuan3D (https://github.com/Tencent/Hunyuan3D-2, 자체 커뮤니티 라이선스 — **적용 지역에서 한국 등 일부 국가를 제외하는 조항이 있었던 것으로 알려져 있어 사용 전 반드시 확인** ⚠️), 상용 서비스(Meshy 등, 약관 확인 필요).
- 판단: AI 생성 메시는 토폴로지와 UV가 불규칙해 **주인공 차량에는 부적합**하다고 가정합니다. 배경 소품(가로수, 벤치, 간판)에서 시험하고 품질·폴리곤 수·작업 시간을 직접 제작과 비교합니다.

### 2.11 테스트·측정·배포
- Vitest (MIT, https://github.com/vitest-dev/vitest): 차량 수학(기어비, 토크 곡선), 도로 그래프, 목적지 파서 단위 테스트.
- Playwright (Apache-2.0, https://github.com/microsoft/playwright): 배포본 스모크 테스트(페이지 로드, 캔버스 생성, 콘솔 에러 없음). STEP 08에서 도입합니다.
- stats.js (MIT, https://github.com/mrdoob/stats.js) / lil-gui (MIT, https://github.com/georgealways/lil-gui): 디버그 오버레이와 파라미터 튜닝.
- GitHub Pages: 무료 정적 호스팅, Actions로 자동 배포. **제약**: 서버 코드를 실행할 수 없음, Private 저장소는 유료 플랜 필요 ⚠️, 사이트 용량·대역폭 소프트 제한 있음 ⚠️(대용량 에셋은 STEP 08에서 재검토).
