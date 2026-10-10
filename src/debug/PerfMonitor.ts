import type { WebGLRenderer } from 'three';

/** FPS·프레임 시간·물리 시간·Draw Call·메모리를 측정해 오버레이에 표시합니다. F3 또는 ?debug로 표시. */
export class PerfMonitor {
  private frames = 0;
  private frameMsSum = 0;
  private physicsMsSum = 0;
  private worstFrameMs = 0;
  private windowStart = performance.now();
  private frameStart = 0;
  private physicsMsThisFrame = 0;
  private visible: boolean;
  private readonly el = document.getElementById('perf')!;

  /** 최근 측정 구간(0.5초) 결과 */
  readonly latest = { fps: 0, frameMs: 0, worstFrameMs: 0, physicsMs: 0, drawCalls: 0, triangles: 0, heapMB: 0 };

  constructor(private readonly renderer: WebGLRenderer) {
    this.visible = new URLSearchParams(location.search).has('debug');
    this.el.classList.toggle('hidden', !this.visible);
    addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        e.preventDefault();
        this.visible = !this.visible;
        this.el.classList.toggle('hidden', !this.visible);
      }
    });
  }

  beginFrame(): void {
    this.frameStart = performance.now();
    this.physicsMsThisFrame = 0;
  }

  measurePhysics<T>(fn: () => T): T {
    const t = performance.now();
    const r = fn();
    this.physicsMsThisFrame += performance.now() - t;
    return r;
  }

  endFrame(extra = ''): void {
    const now = performance.now();
    const ms = now - this.frameStart;
    this.frames++;
    this.frameMsSum += ms;
    this.physicsMsSum += this.physicsMsThisFrame;
    this.worstFrameMs = Math.max(this.worstFrameMs, ms);

    const elapsed = now - this.windowStart;
    if (elapsed < 500) return;
    const info = this.renderer.info.render;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    Object.assign(this.latest, {
      fps: (this.frames * 1000) / elapsed,
      frameMs: this.frameMsSum / this.frames,
      worstFrameMs: this.worstFrameMs,
      physicsMs: this.physicsMsSum / this.frames,
      drawCalls: info.calls,
      triangles: info.triangles,
      heapMB: mem ? mem.usedJSHeapSize / 1048576 : 0,
    });
    this.frames = 0;
    this.frameMsSum = 0;
    this.physicsMsSum = 0;
    this.worstFrameMs = 0;
    this.windowStart = now;

    if (!this.visible) return;
    const l = this.latest;
    this.el.textContent =
      `FPS      ${l.fps.toFixed(0)}\n` +
      `CPU ms   ${l.frameMs.toFixed(2)} (max ${l.worstFrameMs.toFixed(1)})\n` +
      `물리 ms  ${l.physicsMs.toFixed(2)}\n` +
      `Draw     ${l.drawCalls}\n` +
      `삼각형   ${(l.triangles / 1000).toFixed(0)}k\n` +
      (l.heapMB ? `JS 힙    ${l.heapMB.toFixed(0)} MB\n` : '') +
      extra;
  }
}
