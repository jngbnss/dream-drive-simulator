import TinyQueue from 'tinyqueue';

/** tools/osm-region.mjs 가 만든 CSR 도로 그래프 (좌표 단위: 0.1m) */
export class RoadGraph {
  readonly N: number;
  readonly E: number;
  readonly names: string[];
  readonly nodeXZ: Int32Array;
  readonly off: Uint32Array;
  readonly to: Uint32Array;
  readonly len: Float32Array;
  readonly geom: Uint32Array;
  readonly cnt: Uint16Array;
  readonly cls: Uint8Array;
  readonly rev: Uint8Array;
  readonly name: Uint16Array;
  readonly geomXZ: Int32Array;
  private readonly cells = new Map<string, number[]>();

  constructor(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    const hlen = dv.getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
    const align = (n: number) => (n + 3) & ~3;
    let o = 4 + align(hlen);
    const take = <T>(Ctor: { new (b: ArrayBuffer, off: number, len: number): T; BYTES_PER_ELEMENT: number }, count: number): T => {
      const arr = new Ctor(buf, o, count);
      o += align(count * Ctor.BYTES_PER_ELEMENT);
      return arr;
    };
    this.N = header.N;
    this.E = header.E;
    this.names = header.names;
    this.nodeXZ = take(Int32Array, this.N * 2);
    this.off = take(Uint32Array, this.N + 1);
    this.to = take(Uint32Array, this.E);
    this.len = take(Float32Array, this.E);
    this.geom = take(Uint32Array, this.E);
    this.cnt = take(Uint16Array, this.E);
    this.cls = take(Uint8Array, this.E);
    this.rev = take(Uint8Array, this.E);
    this.name = take(Uint16Array, this.E);
    this.geomXZ = take(Int32Array, header.G * 2);
    // 노드 공간 격자 (500m)
    for (let i = 0; i < this.N; i++) {
      if (this.off[i + 1] === this.off[i]) continue; // 나가는 간선 없는 노드 제외
      const k = `${Math.floor(this.nodeXZ[i * 2] / 5000)},${Math.floor(this.nodeXZ[i * 2 + 1] / 5000)}`;
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(i);
    }
  }

  static async load(url: string, onProgress?: (f: number) => void): Promise<RoadGraph> {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`내비게이션 데이터를 불러오지 못했습니다 (${res.status})`);
    const total = Number(res.headers.get('content-length')) || 12e6;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress?.(Math.min(1, got / total));
    }
    const buf = new Uint8Array(got);
    let p = 0;
    for (const c of chunks) { buf.set(c, p); p += c.length; }
    return new RoadGraph(buf.buffer);
  }

  x(i: number) { return this.nodeXZ[i * 2] / 10; }
  z(i: number) { return this.nodeXZ[i * 2 + 1] / 10; }

  /** 가장 가까운 노드 (최대 maxDist m) */
  nearest(x: number, z: number, maxDist = 3000): number {
    let best = -1, bd = maxDist;
    const r = Math.ceil(maxDist / 500);
    const gx = Math.floor(x / 500), gz = Math.floor(z / 500);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const l = this.cells.get(`${gx + i},${gz + j}`);
      if (!l) continue;
      for (const n of l) {
        const d = Math.hypot(this.x(n) - x, this.z(n) - z);
        if (d < bd) { bd = d; best = n; }
      }
    }
    return best;
  }

  /** 간선 e의 형상점 (진행 방향 순서) */
  edgePoints(e: number, out: number[]) {
    const s = this.geom[e], c = this.cnt[e];
    if (this.rev[e]) for (let k = c - 1; k >= 0; k--) out.push(this.geomXZ[(s + k) * 2] / 10, this.geomXZ[(s + k) * 2 + 1] / 10);
    else for (let k = 0; k < c; k++) out.push(this.geomXZ[(s + k) * 2] / 10, this.geomXZ[(s + k) * 2 + 1] / 10);
  }

  /**
   * A* 최단 시간 경로 (등급별 예상 속도 사용). 반환: 간선 인덱스 배열
   */
  route(from: number, goal: number): number[] | null {
    const SPEED = [27, 20, 15, 13, 11, 8, 14]; // m/s
    const VMAX = 27;
    const g = new Float32Array(this.N).fill(Infinity);
    const prevEdge = new Int32Array(this.N).fill(-1);
    const closed = new Uint8Array(this.N);
    const gx = this.x(goal), gz = this.z(goal);
    const h = (n: number) => Math.hypot(this.x(n) - gx, this.z(n) - gz) / VMAX;
    const q = new TinyQueue<[number, number]>([], (a, b) => a[0] - b[0]);
    g[from] = 0;
    q.push([h(from), from]);
    let iter = 0;
    while (q.length) {
      const [, n] = q.pop()!;
      if (closed[n]) continue;
      closed[n] = 1;
      if (n === goal) break;
      if (++iter > 400000) return null;
      for (let e = this.off[n]; e < this.off[n + 1]; e++) {
        const m = this.to[e];
        if (closed[m]) continue;
        const cost = g[n] + this.len[e] / SPEED[this.cls[e]];
        if (cost < g[m]) {
          g[m] = cost;
          prevEdge[m] = e;
          q.push([cost + h(m), m]);
        }
      }
    }
    if (!closed[goal]) return null;
    const edges: number[] = [];
    // 간선의 출발 노드를 찾기 위해 off 역탐색
    const fromOf = (e: number) => {
      let lo = 0, hi = this.N - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (this.off[mid] <= e) lo = mid; else hi = mid - 1;
      }
      return lo;
    };
    let cur = goal;
    while (cur !== from) {
      const e = prevEdge[cur];
      if (e < 0) return null;
      edges.push(e);
      cur = fromOf(e);
    }
    return edges.reverse();
  }
}
