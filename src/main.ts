import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { EngineAudio } from './audio/EngineAudio';
import { CameraSystem } from './camera/CameraSystem';
import { FIXED_DT, GameLoop } from './core/GameLoop';
import { PerfMonitor } from './debug/PerfMonitor';
import { InputSystem } from './input/Input';
import { RoadGraph } from './nav/Graph';
import { Navigator } from './nav/Navigator';
import { DestinationSearch, getKakaoKey, setKakaoKey, type Place } from './nav/Search';
import { Hud } from './ui/Hud';
import { NavPanel } from './ui/NavPanel';
import { isTouchDevice, TouchControls } from './ui/TouchControls';
import { CarVisual } from './vehicle/CarVisual';
import { AMBIENTS, PAINTS } from './vehicle/model/materials';
import { GLC_COUPE_INSPIRED } from './vehicle/VehicleConfig';
import { VehiclePhysics } from './vehicle/VehiclePhysics';
import { Environment, type TimeOfDay } from './world/Environment';
import { ROAD_CLASS_NAMES } from './world/MapData';
import { MapDrawer } from './world/MiniMap';
import { Region } from './world/Region';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const recipient = params.get('to')?.slice(0, 20) ?? '';
const plate = params.get('plate')?.slice(0, 12) ?? '123가 4567';
const BASE = `${import.meta.env.BASE_URL}region/`;

/** 출발 장소 (위경도) */
const SPAWNS = [
  { id: 'lotte-tower', name: '잠실 롯데월드타워', lat: 37.5112, lon: 127.0995 },
  { id: 'gangnam', name: '강남역', lat: 37.4981, lon: 127.0279 },
  { id: 'coex', name: '코엑스 · 삼성역', lat: 37.5089, lon: 127.0612 },
  { id: 'yeouido', name: '여의도 · 63빌딩', lat: 37.5216, lon: 126.9385 },
  { id: 'gwanghwamun', name: '광화문', lat: 37.5714, lon: 126.9768 },
  { id: 'seongsu', name: '성수동', lat: 37.5446, lon: 127.0557 },
  { id: 'pangyo', name: '판교 테크노밸리', lat: 37.4015, lon: 127.1086 },
  { id: 'suwon', name: '수원 화성행궁', lat: 37.2818, lon: 127.0136 },
  { id: 'ilsan', name: '일산 호수공원', lat: 37.6566, lon: 126.7667 },
  { id: 'incheon-airport', name: '인천 송도', lat: 37.3925, lon: 126.6392 },
];

const loadingBar = $('loading-bar');
const loadingText = $('loading-text');
function progress(f: number, label: string) {
  loadingBar.style.width = `${Math.round(f * 100)}%`;
  loadingText.textContent = label;
}

const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(`ddrive.${k}`); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(`ddrive.${k}`, v); } catch { /* 저장 불가 환경 무시 */ }
  },
};

const mobile = isTouchDevice();
if (mobile) document.body.classList.add('touch');

async function boot() {
  const tStart = performance.now();
  progress(0.03, '물리 엔진 준비');
  await RAPIER.init();

  // ── 렌더러·장면 ──────────────────────────────────────────
  const canvas = $<HTMLCanvasElement>('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
  const scene = new THREE.Scene();

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;

  // ── 서울·경기 지역 (타일 스트리밍) ───────────────────────
  progress(0.1, '서울·경기 지도 준비');
  const region = await Region.load(BASE, RAPIER, world);
  scene.add(region.group);
  const mapDrawer = new MapDrawer(region);

  // ── 차량 ────────────────────────────────────────────────
  progress(0.2, '드림카 준비');
  const physics = new VehiclePhysics(RAPIER, world, GLC_COUPE_INSPIRED);
  const car = new CarVisual(physics, mapDrawer, plate);
  scene.add(car.root);
  if (recipient) car.center.greeting = `${recipient}님, 오늘도 행복한 드라이브 ♥`;

  const env = new Environment(scene, renderer);
  const showroomLight = new THREE.SpotLight(0xfff4e8, 0, 22, 0.75, 0.6, 1.2);
  const showroomFill = new THREE.PointLight(0xc8d8ff, 0, 14, 1.5);
  scene.add(showroomLight, showroomLight.target, showroomFill);
  const cameras = new CameraSystem(canvas, car, physics, RAPIER, world);
  const input = new InputSystem();
  const audio = new EngineAudio();
  const hud = new Hud(mapDrawer);
  const perf = new PerfMonitor(renderer);

  // 목적지 표시: GTA 스타일 빛 기둥
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 120, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, fog: false }),
  );
  beacon.visible = false;
  scene.add(beacon);

  // ── 쇼룸 UI ─────────────────────────────────────────────
  $('welcome').textContent = recipient ? `${recipient}님의 드림카` : '당신의 드림카';
  let paintIdx = Number(store.get('paint') ?? 0) % PAINTS.length;
  let ambientIdx = Number(store.get('ambient') ?? 0) % AMBIENTS.length;
  const paintBox = $('paint-swatches');
  const paintName = $('paint-name');
  PAINTS.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = `radial-gradient(circle at 35% 30%, #ffffff55, ${p.color} 45%)`;
    b.title = p.name;
    b.setAttribute('aria-label', p.name);
    b.onclick = () => setPaint(i);
    paintBox.appendChild(b);
  });
  const ambientBox = $('ambient-swatches');
  AMBIENTS.forEach((a, i) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = a.color;
    b.title = a.name;
    b.setAttribute('aria-label', a.name);
    b.onclick = () => setAmbient(i);
    ambientBox.appendChild(b);
  });
  function setPaint(i: number) {
    paintIdx = i;
    car.setPaint(i);
    [...paintBox.children].forEach((c, k) => c.classList.toggle('active', k === i));
    paintName.textContent = PAINTS[i].name;
    store.set('paint', String(i));
  }
  function setAmbient(i: number) {
    ambientIdx = i;
    car.setAmbient(i);
    [...ambientBox.children].forEach((c, k) => c.classList.toggle('active', k === i));
    store.set('ambient', String(i));
  }
  setPaint(paintIdx);
  setAmbient(ambientIdx);

  const spawnSel = $<HTMLSelectElement>('spawn-select');
  for (const p of SPAWNS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    spawnSel.appendChild(o);
  }
  const savedSpawn = store.get('spawn');
  spawnSel.value = SPAWNS.some((p) => p.id === savedSpawn) ? savedSpawn! : SPAWNS[0].id;

  /** 지점 주변 타일을 불러온 뒤 가장 가까운 도로 위(오른쪽 차로)에 차를 놓음 */
  async function placeNear(x: number, z: number, heading?: number) {
    loadingText.textContent = '주변 도로 불러오는 중';
    await region.ready(x, z, 1200);
    const near = region.nearestRoad(x, z, 400);
    if (near) {
      let h = heading ?? near.heading;
      const diff = Math.atan2(Math.sin(h - near.heading), Math.cos(h - near.heading));
      h = Math.abs(diff) > Math.PI / 2 && !near.road.o ? near.heading + Math.PI : near.heading;
      const off = near.road.o ? 0 : Math.min(near.road.w / 4, 4);
      physics.place(near.x + Math.sin(h) * off, near.z + Math.cos(h) * off, h);
    } else physics.place(x, z, heading ?? 0);
    for (let i = 0; i < 90; i++) {
      physics.fixedUpdate(FIXED_DT, input.state);
      world.step();
      physics.afterStep();
    }
    car.update(0, 1);
  }
  async function spawnAt(id: string) {
    const p = SPAWNS.find((q) => q.id === id) ?? SPAWNS[0];
    const [x, z] = region.project(p.lat, p.lon);
    await placeNear(x, z);
    if (cameras.mode === 'showroom') cameras.frameCar();
    store.set('spawn', p.id);
  }
  spawnSel.onchange = () => void spawnAt(spawnSel.value);

  let time: TimeOfDay = (store.get('time') as TimeOfDay) || 'sunset';
  const timeBtns = [...$('time-buttons').querySelectorAll('button')];
  function setTime(t: TimeOfDay) {
    time = t;
    env.set(t);
    const night = t === 'night';
    region.setNight(night);
    car.setNight(night);
    car.setLights(night);
    timeBtns.forEach((b) => b.classList.toggle('active', b.dataset.time === t));
    store.set('time', t);
  }
  timeBtns.forEach((b) => (b.onclick = () => setTime(b.dataset.time as TimeOfDay)));
  setTime(time);
  progress(0.35, '출발 장소 주변 지도 불러오는 중');
  await spawnAt(spawnSel.value);
  cameras.frameCar();

  // ── 내비게이션 ─────────────────────────────────────────
  let graph: RoadGraph | null = null;
  let nav: Navigator | null = null;
  const search = new DestinationSearch(BASE);
  async function ensureGraph(onProgress: (f: number) => void) {
    if (!graph) {
      graph = await RoadGraph.load(`${BASE}graph.bin`, onProgress);
      nav = new Navigator(graph);
      nav.onReroute = () => routeTo(nav!.dest!.x, nav!.dest!.z, nav!.destName, true);
    }
    return nav!;
  }
  function routeTo(x: number, z: number, name: string, reroute = false): boolean {
    if (!nav) return false;
    const p = physics.body.translation();
    const ok = nav.plan(p.x, p.z, x, z, name);
    mapDrawer.route = ok ? nav.route : null;
    mapDrawer.destination = ok ? { x, z } : null;
    beacon.visible = ok;
    beacon.position.set(x, 60, z);
    if (!ok && !reroute) hud.toast('경로를 찾지 못했습니다 (서울·경기 큰길 기준)');
    return ok;
  }
  const navPanel = new NavPanel({
    async onSearch(q) {
      const p = physics.body.translation();
      const [lat, lon] = region.unproject(p.x, p.z);
      return search.search(q, { lat, lon, x: p.x, z: p.z });
    },
    async onPick(place: Place, setStatus) {
      let x = place.x, z = place.z;
      if (place.lat !== undefined && place.lon !== undefined) [x, z] = region.project(place.lat, place.lon);
      if (x === undefined || z === undefined) return false;
      const [minX, minZ, maxX, maxZ] = region.index.bounds;
      if (x < minX || x > maxX || z < minZ || z > maxZ) {
        setStatus('서울·경기 밖의 장소예요. 지도 범위 안에서 골라 주세요.');
        return false;
      }
      setStatus('내비게이션 데이터 준비 중… (처음 한 번만)');
      await ensureGraph((f) => setStatus(`내비게이션 데이터 내려받는 중 ${Math.round(f * 100)}%`));
      setStatus('경로 탐색 중…');
      await new Promise((r) => setTimeout(r, 20));
      const ok = routeTo(x, z, place.name);
      if (!ok) { setStatus('경로를 찾지 못했어요. 다른 장소를 골라 주세요.'); return false; }
      if (!driving) startDriving();
      hud.toast(`${place.name}(으)로 안내를 시작합니다`, 3);
      return true;
    },
    onClear() {
      nav?.clear();
      mapDrawer.route = null;
      mapDrawer.destination = null;
      beacon.visible = false;
      hud.setGuidance(null);
    },
    kakaoKey: getKakaoKey,
    setKakaoKey,
    kakaoStatus: () => search.kakaoStatus,
  });

  // ── 상태: 쇼룸 ↔ 주행 ──────────────────────────────────
  let driving = false;
  const btnInterior = $('btn-interior');
  btnInterior.onclick = () => {
    const toInterior = cameras.mode !== 'interior';
    cameras.setMode(toInterior ? 'interior' : 'showroom');
    btnInterior.textContent = toInterior ? '외관 보기' : '실내 보기';
  };
  function startDriving() {
    driving = true;
    input.enabled = true;
    audio.start();
    $('showroom').classList.add('hidden');
    hud.show(true);
    cameras.setMode('chase'); // GTA처럼 3인칭이 기본
    if (mobile && innerHeight > innerWidth) hud.toast('휴대폰을 가로로 돌리면 더 편해요', 4);
    else hud.toast(mobile ? '‘목적지’로 내비 안내 · ‘시점’으로 운전석' : 'N 목적지 · C 운전석 시점', 3.5);
    canvas.focus();
  }
  function stopDriving() {
    driving = false;
    input.enabled = false;
    $('showroom').classList.remove('hidden');
    hud.show(false);
    navPanel.close();
    cameras.setMode('showroom');
    cameras.frameCar();
    btnInterior.textContent = '실내 보기';
  }
  $('btn-drive').onclick = startDriving;
  $('btn-nav').onclick = () => navPanel.open();
  $('hud-nav').onclick = () => navPanel.open();

  function resetToRoad() {
    const t = physics.body.translation();
    const near = region.nearestRoad(t.x, t.z, 300);
    if (!near) {
      physics.resetUpright();
      return;
    }
    let h = near.heading;
    const diff = Math.atan2(Math.sin(physics.heading - h), Math.cos(physics.heading - h));
    if (Math.abs(diff) > Math.PI / 2 && !near.road.o) h += Math.PI;
    const off = near.road.o ? 0 : Math.min(near.road.w / 4, 4);
    physics.place(near.x + Math.sin(h) * off, near.z + Math.cos(h) * off, h);
    hud.toast('도로로 복귀했습니다');
  }

  const toggleLights = () => {
    car.setLights(!car.lightsOn);
    hud.toast(car.lightsOn ? '헤드라이트 켜짐' : '헤드라이트 꺼짐');
  };
  if (mobile) {
    new TouchControls(input, { view: () => cameras.cycleDriveView(), lights: toggleLights, menu: stopDriving, reset: resetToRoad, nav: () => navPanel.open() });
  }

  addEventListener('keydown', (e) => {
    if (navPanel.isOpen) return; // 검색창 입력 중에는 단축키 무시
    if (!driving) return;
    switch (e.code) {
      case 'KeyC': cameras.cycleDriveView(); break;
      case 'KeyL': toggleLights(); break;
      case 'KeyR': resetToRoad(); break;
      case 'KeyN': e.preventDefault(); navPanel.open(); break;
      case 'KeyM': hud.toast(audio.toggleMute() ? '음소거' : '소리 켜짐'); break;
      case 'KeyH': hud.toggleHelp(); break;
      case 'KeyT': {
        const order: TimeOfDay[] = ['day', 'sunset', 'night'];
        setTime(order[(order.indexOf(time) + 1) % 3]);
        break;
      }
      case 'Escape': stopDriving(); break;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.suspend();
    else if (driving) audio.start();
  });

  // ── 자동 화질 ───────────────────────────────────────────
  const maxRatio = Math.min(devicePixelRatio, mobile ? 1.25 : 1.75);
  const minRatio = mobile ? 0.6 : 0.75;
  let qualityTimer = 3;
  function adaptQuality(dt: number) {
    if ((qualityTimer -= dt) > 0) return;
    qualityTimer = 1.5;
    const fps = perf.latest.fps;
    const r = renderer.getPixelRatio();
    let next = r;
    if (fps < 45) next = Math.max(minRatio, r * 0.85);
    else if (fps > 58 && r < maxRatio) next = Math.min(maxRatio, r * 1.08);
    if (Math.abs(next - r) > 0.01) {
      renderer.setPixelRatio(next);
      renderer.setSize(innerWidth, innerHeight);
    }
    const wantShadows = !(fps < 30 && next <= minRatio);
    if (renderer.shadowMap.enabled !== wantShadows && fps > 0) {
      renderer.shadowMap.enabled = wantShadows;
      scene.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (mat) mat.needsUpdate = true;
      });
    }
  }

  // ── 루프 ────────────────────────────────────────────────
  let roadTimer = 0;
  const camPos = new THREE.Vector3();
  const prof = { frame: 0, start: 0, region: 0, render: 0, total: 0, physics: 0 };
  (window as unknown as { __long: unknown[] }).__long = [];
  const loop = new GameLoop({
    begin() {
      perf.beginFrame();
      prof.frame = performance.now();
    },
    fixedUpdate(dt) {
      input.update(dt, physics.telemetry.forwardSpeed);
      physics.fixedUpdate(dt, input.state);
      perf.measurePhysics(() => world.step());
      physics.afterStep();
      if (physics.body.translation().y < -20) resetToRoad();
    },
    render(dt, alpha) {
      prof.start = performance.now();
      car.update(dt, alpha);
      cameras.update(dt);
      const p = car.root.position;
      const tu0 = performance.now();
      region.update(p.x, p.z);
      prof.region = performance.now() - tu0;
      {
        const showroomOn = !driving && cameras.mode === 'showroom';
        const target = showroomOn ? (time === 'night' ? 1 : time === 'sunset' ? 0.55 : 0.25) : 0;
        showroomLight.intensity += (target * 260 - showroomLight.intensity) * Math.min(1, dt * 3);
        showroomFill.intensity += (target * 40 - showroomFill.intensity) * Math.min(1, dt * 3);
        showroomLight.position.set(p.x + 2, p.y + 7, p.z + 3);
        showroomLight.target.position.copy(p);
        showroomFill.position.copy(cameras.camera.position).add(new THREE.Vector3(0, 1.5, 0));
      }
      env.follow(p);
      const inCabin = cameras.mode === 'cockpit' || cameras.mode === 'interior';
      car.materials.setCabinView(inCabin);
      car.screenInterval = inCabin ? 0.05 : driving ? 0.5 : 0.2;

      if ((roadTimer -= dt) <= 0) {
        roadTimer = 0.3;
        const near = region.nearestRoad(p.x, p.z, 30);
        car.roadName = near ? (near.road.n ?? ROAD_CLASS_NAMES[near.road.c]) : '';
      }
      const t = physics.telemetry;
      if (nav && nav.guidance.active) {
        nav.update(dt, p.x, p.z, Math.abs(t.forwardSpeed));
        mapDrawer.routeFrom = nav.current;
        mapDrawer.route = nav.route;
        hud.setGuidance(nav.guidance);
        car.navText = nav.guidance.next ? nav.guidance : null;
        if (nav.guidance.arrived) {
          hud.toast(`${nav.destName} 도착! 🎉`, 4);
          mapDrawer.route = null;
          beacon.visible = false;
          hud.setGuidance(null);
          car.navText = null;
        }
      }
      if (beacon.visible) (beacon.material as THREE.MeshBasicMaterial).opacity = 0.25 + Math.sin(performance.now() / 300) * 0.1;
      audio.update(t.rpm, t.load, t.speedKmh, t.skid, cameras.mode === 'cockpit', driving);
      if (driving) hud.update(dt, t.speedKmh, t.gearLabel, t.rpm, car.roadName, p.x, p.z, physics.heading, AMBIENTS[ambientIdx].color);
      const tr0 = performance.now();
      renderer.render(scene, cameras.camera);
      prof.render = performance.now() - tr0;
      prof.physics = prof.start - prof.frame;
      prof.total = performance.now() - prof.frame;
      if (prof.total > 30) (window as unknown as { __long: unknown[] }).__long?.push({ ...prof });
      cameras.camera.getWorldPosition(camPos);
      perf.endFrame(
        `타일     ${region.tileCount}\n건물     ${region.stats.buildings}\n타일 생성 ${region.stats.buildMs.toFixed(0)} ms\n` +
        `해상도   x${renderer.getPixelRatio().toFixed(2)}\n위치     ${camPos.x.toFixed(0)}, ${camPos.z.toFixed(0)}`,
      );
      adaptQuality(dt);
    },
  });

  progress(1, '출발 준비 완료');
  console.info(`[DreamDrive] 시작 ${(performance.now() - tStart).toFixed(0)}ms, 타일 ${region.tileCount}`);
  (window as unknown as { __dd: unknown }).__dd = { perf, region, physics, cameras, renderer, navPanel, get nav() { return nav; } };
  loop.start();
  $('loading').classList.add('fade');
  $('showroom').classList.remove('hidden');
  setTimeout(() => $('loading').classList.add('hidden'), 700);
}

boot().catch((e) => {
  console.error(e);
  loadingText.textContent = `오류: ${e instanceof Error ? e.message : String(e)}`;
  loadingBar.style.background = '#e53935';
});
