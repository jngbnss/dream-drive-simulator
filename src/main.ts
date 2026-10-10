import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { EngineAudio } from './audio/EngineAudio';
import { CameraSystem } from './camera/CameraSystem';
import { FIXED_DT, GameLoop } from './core/GameLoop';
import { PerfMonitor } from './debug/PerfMonitor';
import { InputSystem } from './input/Input';
import { Hud } from './ui/Hud';
import { isTouchDevice, TouchControls } from './ui/TouchControls';
import { CarVisual } from './vehicle/CarVisual';
import { AMBIENTS, PAINTS } from './vehicle/model/materials';
import { GLC_COUPE_INSPIRED } from './vehicle/VehicleConfig';
import { VehiclePhysics } from './vehicle/VehiclePhysics';
import { City } from './world/City';
import { Environment, type TimeOfDay } from './world/Environment';
import { ROAD_CLASS_NAMES, type MapData } from './world/MapData';
import { MapRaster } from './world/MapRaster';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const recipient = params.get('to')?.slice(0, 20) ?? '';
const plate = params.get('plate')?.slice(0, 12) ?? '123가 4567';

const loadingBar = $('loading-bar');
const loadingText = $('loading-text');
function progress(f: number, label: string) {
  loadingBar.style.width = `${Math.round(f * 100)}%`;
  loadingText.textContent = label;
}
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

const store = {
  get(k: string): string | null {
    try { return localStorage.getItem(`ddrive.${k}`); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(`ddrive.${k}`, v); } catch { /* 저장 불가 환경 무시 */ }
  },
};

async function fetchMap(url: string, onProgress: (f: number) => void): Promise<MapData> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`맵 데이터를 불러오지 못했습니다 (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress(total ? Math.min(1, got / total) : Math.min(0.95, got / 8e6));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.length; }
  return JSON.parse(new TextDecoder().decode(buf));
}

const mobile = isTouchDevice();
if (mobile) document.body.classList.add('touch');

async function boot() {
  const tStart = performance.now();
  progress(0.02, '물리 엔진 준비');
  await RAPIER.init();

  progress(0.06, '강남·송파 지도 내려받는 중');
  const map = await fetchMap(`${import.meta.env.BASE_URL}maps/gangnam-songpa.json`, (f) => progress(0.06 + f * 0.3, '강남·송파 지도 내려받는 중'));
  const tMap = performance.now();

  // ── 렌더러·장면 ──────────────────────────────────────────
  const canvas = $<HTMLCanvasElement>('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  // 휴대폰은 해상도를 낮춰 발열·배터리 부담을 줄임
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

  // ── 도시 ────────────────────────────────────────────────
  await nextFrame();
  const city = new City(map, RAPIER, world, (f, label) => progress(0.4 + f * 0.4, label));
  scene.add(city.group);
  progress(0.82, '내비게이션 지도');
  await nextFrame();
  const raster = new MapRaster(map);

  // ── 차량 ────────────────────────────────────────────────
  progress(0.88, '드림카 준비');
  await nextFrame();
  const physics = new VehiclePhysics(RAPIER, world, GLC_COUPE_INSPIRED);
  const car = new CarVisual(physics, raster, plate);
  scene.add(car.root);
  if (recipient) car.center.greeting = `${recipient}님, 오늘도 행복한 드라이브 ♥`;

  const env = new Environment(scene, renderer);
  // 쇼룸 조명: 차를 감상할 때 위·앞에서 부드럽게 비춤 (밤·노을에 특히 효과)
  const showroomLight = new THREE.SpotLight(0xfff4e8, 0, 22, 0.75, 0.6, 1.2);
  const showroomFill = new THREE.PointLight(0xc8d8ff, 0, 14, 1.5);
  scene.add(showroomLight, showroomLight.target, showroomFill);
  const cameras = new CameraSystem(canvas, car, physics, RAPIER, world);
  // 첫 화면에서 차가 정지 상태로 자리 잡도록 물리를 미리 진행
  const settle = () => {
    for (let i = 0; i < 90; i++) {
      physics.fixedUpdate(FIXED_DT, input.state);
      world.step();
      physics.afterStep();
    }
    car.update(0, 1);
  };
  const input = new InputSystem();
  const audio = new EngineAudio();
  const hud = new Hud(raster);
  const perf = new PerfMonitor(renderer);

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
  for (const p of map.pois) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    spawnSel.appendChild(o);
  }
  const savedSpawn = store.get('spawn');
  spawnSel.value = map.pois.some((p) => p.id === savedSpawn) ? savedSpawn! : (map.pois[0]?.id ?? '');
  function spawnAt(id: string) {
    const p = map.pois.find((q) => q.id === id) ?? map.pois[0];
    if (!p) return;
    physics.place(p.x, p.z, p.heading);
    car.update(0, 1);
    if (cameras.mode === 'showroom') cameras.frameCar();
    store.set('spawn', id);
  }
  spawnSel.onchange = () => spawnAt(spawnSel.value);

  let time: TimeOfDay = (store.get('time') as TimeOfDay) || 'sunset';
  const timeBtns = [...$('time-buttons').querySelectorAll('button')];
  function setTime(t: TimeOfDay) {
    time = t;
    env.set(t);
    const night = t === 'night';
    city.setNight(night);
    car.setNight(night);
    car.setLights(night);
    timeBtns.forEach((b) => b.classList.toggle('active', b.dataset.time === t));
    store.set('time', t);
  }
  timeBtns.forEach((b) => (b.onclick = () => setTime(b.dataset.time as TimeOfDay)));
  setTime(time);
  spawnAt(spawnSel.value);
  settle();
  cameras.frameCar();

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
    else hud.toast(mobile ? '‘시점’ 버튼으로 운전석 시점' : 'C 키로 운전석 시점 ↔ 3인칭 전환', 3.5);
    canvas.focus();
  }
  function stopDriving() {
    driving = false;
    input.enabled = false;
    $('showroom').classList.remove('hidden');
    hud.show(false);
    cameras.setMode('showroom');
    cameras.frameCar();
    btnInterior.textContent = '실내 보기';
  }
  $('btn-drive').onclick = startDriving;

  function resetToRoad() {
    const t = physics.body.translation();
    const near = city.nearestRoad(t.x, t.z, 200);
    if (!near) {
      physics.resetUpright();
      return;
    }
    let h = near.heading;
    const diff = Math.atan2(Math.sin(physics.heading - h), Math.cos(physics.heading - h));
    if (Math.abs(diff) > Math.PI / 2 && !near.road.o) h += Math.PI;
    // 양방향 도로면 진행 방향 오른쪽 차로로
    const off = near.road.o ? 0 : Math.min(near.road.w / 4, 4);
    physics.place(near.x + Math.sin(h) * off, near.z + Math.cos(h) * off, h);
    hud.toast('도로로 복귀했습니다');
  }

  const toggleLights = () => {
    car.setLights(!car.lightsOn);
    hud.toast(car.lightsOn ? '헤드라이트 켜짐' : '헤드라이트 꺼짐');
  };
  if (mobile) {
    new TouchControls(input, { view: () => cameras.cycleDriveView(), lights: toggleLights, menu: stopDriving, reset: resetToRoad });
  }

  addEventListener('keydown', (e) => {
    if (!driving) return;
    switch (e.code) {
      case 'KeyC': cameras.cycleDriveView(); break;
      case 'KeyL': toggleLights(); break;
      case 'KeyR': resetToRoad(); break;
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

  // ── 자동 화질: 버벅이면 렌더 해상도를 낮추고, 여유가 있으면 다시 올림 ─────
  const maxRatio = Math.min(devicePixelRatio, mobile ? 1.25 : 1.75);
  const minRatio = mobile ? 0.6 : 0.75;
  let qualityTimer = 3; // 시작 직후(셰이더 컴파일)는 건너뜀
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
    // 그래도 느리면 그림자를 끔
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
  let clock = 0;
  const camPos = new THREE.Vector3();
  const loop = new GameLoop({
    begin() {
      perf.beginFrame();
    },
    fixedUpdate(dt) {
      input.update(dt, physics.telemetry.forwardSpeed);
      physics.fixedUpdate(dt, input.state);
      perf.measurePhysics(() => world.step());
      physics.afterStep();
      if (physics.body.translation().y < -20) resetToRoad();
    },
    render(dt, alpha) {
      clock += dt;
      car.update(dt, alpha);
      cameras.update(dt);
      {
        const showroomOn = !driving && cameras.mode === 'showroom';
        const p = car.root.position;
        const target = showroomOn ? (time === 'night' ? 1 : time === 'sunset' ? 0.55 : 0.25) : 0;
        showroomLight.intensity += (target * 260 - showroomLight.intensity) * Math.min(1, dt * 3);
        showroomFill.intensity += (target * 40 - showroomFill.intensity) * Math.min(1, dt * 3);
        showroomLight.position.set(p.x + 2, p.y + 7, p.z + 3);
        showroomLight.target.position.copy(p);
        showroomFill.position.copy(cameras.camera.position).add(new THREE.Vector3(0, 1.5, 0));
      }
      env.follow(car.root.position);
      car.materials.setCabinView(cameras.mode === 'cockpit' || cameras.mode === 'interior');

      if ((roadTimer -= dt) <= 0) {
        roadTimer = 0.3;
        const p = car.root.position;
        const near = city.nearestRoad(p.x, p.z, 30);
        car.roadName = near ? (near.road.n ?? ROAD_CLASS_NAMES[near.road.c]) : '';
      }
      const t = physics.telemetry;
      audio.update(t.rpm, t.load, t.speedKmh, t.skid, cameras.mode === 'cockpit', driving);
      if (driving) {
        const p = car.root.position;
        hud.update(dt, t.speedKmh, t.gearLabel, t.rpm, car.roadName, p.x, p.z, physics.heading, AMBIENTS[ambientIdx].color);
      }
      renderer.render(scene, cameras.camera);
      cameras.camera.getWorldPosition(camPos);
      perf.endFrame(
        `건물     ${city.stats.buildings}\n도로     ${city.stats.roads}\n해상도   x${renderer.getPixelRatio().toFixed(2)}\n` +
        `맵 생성  ${city.stats.buildMs.toFixed(0)} ms\n위치     ${camPos.x.toFixed(0)}, ${camPos.z.toFixed(0)}`,
      );
      adaptQuality(dt);
    },
  });

  progress(1, '출발 준비 완료');
  console.info(`[DreamDrive] 맵 다운로드 ${(tMap - tStart).toFixed(0)}ms, 도시 생성 ${city.stats.buildMs.toFixed(0)}ms, 전체 ${(performance.now() - tStart).toFixed(0)}ms`, city.stats);
  (window as unknown as { __dd: unknown }).__dd = { perf, city, physics, cameras, renderer };
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
