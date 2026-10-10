# 00. 시스템 아키텍처

## 1. 설계 원칙

1. **고정 시간 간격 물리 + 가변 렌더링**: 물리는 60Hz 고정 스텝, 렌더링은 모니터 주사율에 맞추고 두 물리 상태 사이를 보간합니다. 프레임레이트가 달라도 주행 감각이 일정합니다.
2. **물리와 시각 분리**: 물리 바디(단순 박스·레이캐스트 휠)와 시각 모델(GLB)을 분리합니다. 차량 모델을 바꿔도 주행 특성은 `VehicleConfig`로만 바뀝니다.
3. **입력 추상화**: 키보드·마우스·게임패드·레이싱 휠 → 공통 `ControlState { throttle, brake, steer, handbrake }`.
4. **맵은 데이터**: 맵은 `MapDefinition`(도로 그래프, 스폰 지점, 체크포인트, 건물 메시)으로 표현하고, 절차적 생성이든 OSM 변환이든 같은 인터페이스로 로드합니다.
5. **측정 가능성 우선**: 모든 단계에서 `PerfMonitor`로 FPS·프레임 시간·물리 시간·Draw Call·메모리를 볼 수 있어야 합니다.
6. **정적 배포 가능**: 서버 없이 GitHub Pages에서 동작. 서버가 필요한 기능(LLM 호출)은 선택적 외부 프록시로 분리하고, 없어도 핵심 경험은 동작합니다.

## 2. 전체 구조

```text
┌──────────────────────────────── Browser ────────────────────────────────┐
│                                                                         │
│  UI Layer (HTML/CSS 오버레이)                                            │
│   ├─ MainMenu (맵 선택, 차량 색상)   ├─ HUD (속도, RPM, 기어, 랩타임)        │
│   └─ PerfOverlay (FPS, ms, draw calls)                                  │
│                                                                         │
│  Game Core                                                              │
│   ├─ Engine ── GameLoop (fixed 60Hz physics / variable render)          │
│   ├─ SceneManager ── 상태: Showroom ↔ Driving ↔ Menu                     │
│   └─ EventBus (타입 안전 이벤트)                                         │
│                                                                         │
│  Systems                                                                │
│   ├─ InputSystem ───────► ControlState                                  │
│   ├─ VehicleSystem ─────► Rapier DynamicRayCastVehicleController        │
│   ├─ CameraSystem (Orbit / Chase / Cockpit)                             │
│   ├─ WorldSystem (MapLoader, Lighting, Weather, TimeOfDay)              │
│   ├─ AudioSystem (EngineAudio, SFX)                                     │
│   ├─ TrafficSystem (규칙 기반 IDM, 도로 그래프)                           │
│   └─ GuideSystem (자연어 목적지 → 경로 → 음성 안내)                         │
│                                                                         │
│  Engines / Libraries                                                    │
│   Three.js (WebGL2)   Rapier (WASM)   Web Audio   Web Speech            │
└─────────────────────────────────────────────────────────────────────────┘
          │ 정적 에셋 (GLB, KTX2, 맵 JSON)            │ (선택) LLM 프록시
          ▼                                          ▼
   GitHub Pages (CDN)                       Cloudflare Worker 등 (STEP 07)
```

## 3. 디렉터리 구조 (목표)

```text
dream-drive-simulator/
├── docs/                      # 설계 문서 (이 폴더)
├── public/
│   └── assets/
│       ├── models/            # GLB (압축 후)
│       ├── textures/          # KTX2
│       ├── audio/             # 엔진음 샘플
│       └── maps/              # 맵 JSON (OSM 변환 결과 포함)
├── tools/                     # 오프라인 스크립트 (OSM 변환, 에셋 압축)
├── src/
│   ├── main.ts                # 부트스트랩
│   ├── core/                  # Engine, GameLoop, EventBus, SceneManager
│   ├── physics/               # PhysicsWorld(Rapier 래퍼), 충돌 그룹
│   ├── vehicle/               # Vehicle, VehicleConfig, Drivetrain, VehicleVisual
│   ├── input/                 # InputSystem, KeyboardSource, GamepadSource
│   ├── camera/                # CameraSystem, OrbitMode, ChaseMode, CockpitMode
│   ├── world/                 # MapLoader, maps/seoul, maps/circuit, Lighting, Weather
│   ├── audio/                 # AudioSystem, EngineAudio
│   ├── ai/                    # TrafficSystem, Pedestrians, GuideSystem
│   ├── ui/                    # HUD, Menu, PerfOverlay
│   ├── assets/                # AssetLoader (GLTF + Draco/Meshopt + KTX2)
│   └── debug/                 # PerfMonitor, 디버그 GUI
├── tests/                     # Vitest 단위 테스트
├── .github/workflows/         # 배포 파이프라인
└── vite.config.ts             # base: '/dream-drive-simulator/'
```

## 4. 프레임 데이터 흐름

```text
requestAnimationFrame(t)
 │
 ├─ InputSystem.poll()                 → ControlState
 │
 ├─ accumulator += dt  (최대 0.25s로 클램프)
 │   while accumulator >= 1/60:
 │     ├─ VehicleSystem.applyControls(ControlState)
 │     ├─ TrafficSystem.fixedUpdate()
 │     ├─ PhysicsWorld.step()          ← 물리 시간 측정
 │     └─ 이전/현재 Transform 저장
 │
 ├─ alpha = accumulator / (1/60)
 ├─ VehicleVisual.sync(alpha)          ← 보간된 위치·회전, 휠 회전/서스펜션
 ├─ CameraSystem.update(dt)
 ├─ AudioSystem.update(rpm, load, speed)
 ├─ HUD.update()
 ├─ renderer.render(scene, camera)     ← draw call/삼각형 수 측정
 └─ PerfMonitor.endFrame()
```

## 5. 주요 인터페이스 (초안)

```ts
interface ControlState { throttle: number; brake: number; steer: number; handbrake: boolean; }

interface InputSource { poll(out: ControlState): void; dispose(): void; }

interface VehicleConfig {
  massKg: number;                // GLC Coupé 참고: 약 1,800–1,900kg (가정, STEP 02에서 출처 확인)
  wheelbase: number; trackWidth: number;
  engine: { maxTorqueNm: number; redlineRpm: number; torqueCurve: [rpm: number, nm: number][] };
  gearbox: { ratios: number[]; finalDrive: number; shiftTime: number };
  suspension: { restLength: number; stiffness: number; damping: number; maxTravel: number };
  tire: { frictionSlip: number; sideFrictionStiffness: number };
  steering: { maxAngleRad: number; speedSensitivity: number };
}

interface CameraMode { enter(ctx: CameraContext): void; update(dt: number): void; exit(): void; }

interface MapDefinition {
  id: string; name: string;
  spawn: { position: Vec3; heading: number };
  roadGraph?: RoadGraph;         // 교통·내비게이션용
  checkpoints?: Checkpoint[];    // 서킷 랩타임용
  load(ctx: WorldContext): Promise<void>;
  dispose(): void;
}

interface PerfSample { fps: number; frameMs: number; physicsMs: number; drawCalls: number; triangles: number; heapMB?: number; }
```

## 6. 상태 전환

```text
[Boot/Loading] → [Showroom: 오빗 카메라, 색상 선택]
       ↓ "탑승" 버튼 / E키
[Driving: Chase ↔ Cockpit (C키)]  ⇄  [Pause/Menu: 맵 변경, 설정]
```

## 7. 배포 아키텍처

- `main` 브랜치 push → GitHub Actions: `npm ci → npm test → npm run build → Pages 배포`
- 기능 브랜치(`feature/step-XX-*`)는 로컬·PR에서 검증 후 `main`에 머지
- 친구에게 공유할 주소: `https://jngbnss.github.io/dream-drive-simulator/` (저장소가 Public이어야 무료 Pages 사용 가능)
- 캐시: Vite 해시 파일명으로 장기 캐시, `index.html`만 짧은 캐시

## 8. 확장 포인트

| 확장 | 방법 |
|---|---|
| 다른 차량 | `VehicleConfig` + GLB 경로만 추가 |
| 레이싱 휠 | `GamepadSource`에 축 매핑 프로필 추가 (포스 피드백은 브라우저 지원 제한, 별도 검토) |
| 새 맵 | `MapDefinition` 구현체 추가 |
| WebGPU | Three.js `WebGPURenderer`로 교체 검토 (STEP 08 이후) |
