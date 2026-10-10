import type { RoadGraph } from './Graph';

export interface Maneuver {
  /** 경로 시작부터의 거리 (m) */
  at: number;
  type: 'left' | 'right' | 'slight-left' | 'slight-right' | 'uturn' | 'arrive';
  road: string;
}

export interface Guidance {
  active: boolean;
  remainingM: number;
  etaMin: number;
  next: Maneuver | null;
  nextInM: number;
  offRoute: boolean;
  arrived: boolean;
}

/**
 * 경로 생성·추종·음성 안내.
 * 회전 안내는 그래프 노드에서 진입·진출 방향 각도로 계산합니다.
 */
export class Navigator {
  route: Float32Array | null = null;
  private cum: Float32Array | null = null;
  private maneuvers: Maneuver[] = [];
  private progress = 0;
  private seg = 0;
  private offTimer = 0;
  private lastSpoken = '';
  destName = '';
  dest: { x: number; z: number } | null = null;
  readonly guidance: Guidance = { active: false, remainingM: 0, etaMin: 0, next: null, nextInM: 0, offRoute: false, arrived: false };
  voice = true;
  onReroute: (() => void) | null = null;

  constructor(private readonly graph: RoadGraph) {}

  /** 출발점·목적지로 경로 계산. 실패하면 false */
  plan(fromX: number, fromZ: number, toX: number, toZ: number, destName: string): boolean {
    const a = this.graph.nearest(fromX, fromZ, 4000);
    const b = this.graph.nearest(toX, toZ, 4000);
    if (a < 0 || b < 0) return false;
    const edges = a === b ? [] : this.graph.route(a, b);
    if (!edges) return false;
    const pts: number[] = [fromX, fromZ];
    const names: number[] = [];
    const turns: { idx: number; name: string }[] = [];
    for (const e of edges) {
      const before = pts.length;
      this.graph.edgePoints(e, pts);
      // 중복 점 제거
      if (pts.length > before && pts[before] === pts[before - 2] && pts[before + 1] === pts[before - 1]) pts.splice(before, 2);
      turns.push({ idx: before / 2, name: this.graph.names[this.graph.name[e]] || '' });
      names.push(this.graph.name[e]);
    }
    pts.push(toX, toZ);
    this.route = Float32Array.from(pts);
    const n = pts.length / 2;
    this.cum = new Float32Array(n);
    for (let i = 1; i < n; i++) this.cum[i] = this.cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    // 회전 안내: 간선 경계(그래프 노드)에서 방향 변화 계산
    this.maneuvers = [];
    for (let t = 1; t < turns.length; t++) {
      const i = Math.min(n - 2, Math.max(1, turns[t].idx - 1));
      const ang = this.turnAngle(i);
      const prevName = turns[t - 1].name, name = turns[t].name;
      let type: Maneuver['type'] | null = null;
      const abs = Math.abs(ang);
      if (abs > 150) type = 'uturn';
      else if (abs > 45) type = ang > 0 ? 'left' : 'right';
      else if (abs > 20 && name !== prevName) type = ang > 0 ? 'slight-left' : 'slight-right';
      if (type) this.maneuvers.push({ at: this.cum[i], type, road: name });
    }
    this.maneuvers.push({ at: this.cum[n - 1], type: 'arrive', road: destName });
    this.progress = 0;
    this.seg = 0;
    this.offTimer = 0;
    this.lastSpoken = '';
    this.destName = destName;
    this.dest = { x: toX, z: toZ };
    Object.assign(this.guidance, { active: true, arrived: false, offRoute: false });
    this.say(`${destName}까지 안내를 시작합니다. 약 ${formatDist(this.cum[n - 1])}입니다.`);
    return true;
  }

  clear() {
    this.route = null;
    this.cum = null;
    this.dest = null;
    this.guidance.active = false;
    speechSynthesis?.cancel();
  }

  /** i번째 점에서의 방향 변화 (도, 왼쪽 +) */
  private turnAngle(i: number): number {
    const r = this.route!;
    // 짧은 점 간격에 흔들리지 않도록 앞뒤 20m 지점 사용
    const back = this.pointAtDist(this.cum![i] - 20), fwd = this.pointAtDist(this.cum![i] + 20);
    const ax = r[i * 2] - back[0], az = r[i * 2 + 1] - back[1];
    const bx = fwd[0] - r[i * 2], bz = fwd[1] - r[i * 2 + 1];
    // 화면상 왼쪽 회전이 양수가 되도록 (x 동, z 남)
    const cross = ax * bz - az * bx;
    const dot = ax * bx + az * bz;
    return (-Math.atan2(cross, dot) * 180) / Math.PI;
  }

  private pointAtDist(d: number): [number, number] {
    const r = this.route!, c = this.cum!;
    d = Math.max(0, Math.min(c[c.length - 1], d));
    let lo = 0, hi = c.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (c[m] <= d) lo = m; else hi = m; }
    const t = (d - c[lo]) / ((c[hi] - c[lo]) || 1);
    return [r[lo * 2] + (r[hi * 2] - r[lo * 2]) * t, r[lo * 2 + 1] + (r[hi * 2 + 1] - r[lo * 2 + 1]) * t];
  }

  update(dt: number, x: number, z: number, speed: number) {
    const g = this.guidance;
    if (!this.route || !this.cum || !g.active) return;
    const r = this.route, c = this.cum, n = c.length;
    // 현재 위치를 경로에 투영 (앞쪽 창에서만 탐색)
    let best = Infinity, bestSeg = this.seg, bestProg = this.progress;
    for (let i = Math.max(0, this.seg - 3); i < Math.min(n - 1, this.seg + 60); i++) {
      const x1 = r[i * 2], z1 = r[i * 2 + 1], x2 = r[i * 2 + 2], z2 = r[i * 2 + 3];
      const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
      const d = Math.hypot(x1 + dx * t - x, z1 + dz * t - z);
      if (d < best) { best = d; bestSeg = i; bestProg = c[i] + Math.sqrt(L2) * t; }
    }
    this.seg = bestSeg;
    this.progress = Math.max(this.progress - 5, bestProg);
    g.remainingM = c[n - 1] - this.progress;
    g.etaMin = g.remainingM / Math.max(8, speed) / 60;
    g.offRoute = best > 45;
    this.offTimer = g.offRoute ? this.offTimer + dt : 0;
    if (this.offTimer > 2.5) {
      this.offTimer = 0;
      this.say('경로를 다시 탐색합니다.');
      this.onReroute?.();
      return;
    }
    const next = this.maneuvers.find((m) => m.at > this.progress - 5) ?? null;
    g.next = next;
    g.nextInM = next ? next.at - this.progress : 0;
    if (next && next.type === 'arrive' && g.nextInM < 30) {
      g.arrived = true;
      g.active = false;
      this.say(`목적지 ${this.destName} 부근에 도착했습니다. 안내를 종료합니다.`);
      return;
    }
    // 음성: 500m, 200m, 직전
    if (next && next.type !== 'arrive') {
      for (const th of [500, 200, 40]) {
        const key = `${next.at}|${th}`;
        if (g.nextInM < th && g.nextInM > th - 60 && this.lastSpoken !== key) {
          this.lastSpoken = key;
          const when = th === 40 ? '잠시 후' : `${th}미터 앞에서`;
          this.say(`${when} ${maneuverText(next.type)}${next.road ? `, ${next.road} 방면` : ''}입니다.`);
          break;
        }
      }
    }
  }

  private say(text: string) {
    if (!this.voice || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 1.05;
    const ko = speechSynthesis.getVoices().find((v) => v.lang.startsWith('ko'));
    if (ko) u.voice = ko;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}

export function maneuverText(t: Maneuver['type']): string {
  switch (t) {
    case 'left': return '좌회전';
    case 'right': return '우회전';
    case 'slight-left': return '왼쪽 방향';
    case 'slight-right': return '오른쪽 방향';
    case 'uturn': return '유턴';
    default: return '목적지';
  }
}

export function maneuverIcon(t: Maneuver['type']): string {
  switch (t) {
    case 'left': return '↰';
    case 'right': return '↱';
    case 'slight-left': return '↖';
    case 'slight-right': return '↗';
    case 'uturn': return '↶';
    default: return '⚑';
  }
}

export function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)}km` : `${Math.max(0, Math.round(m / 10) * 10)}m`;
}
