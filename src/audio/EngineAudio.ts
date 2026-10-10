/**
 * Web Audio API로 엔진음을 실시간 합성합니다 (외부 녹음 파일 없음 → 라이선스 문제 없음).
 * 직렬 4기통: 점화 주파수 = rpm / 60 × 2. 하모닉 + 소프트 클리핑 + 부하에 따른 필터로 음색을 만듭니다.
 * 추가로 흡기 노이즈, 타이어 스키드, 풍절음.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private cabinFilter!: BiquadFilterNode;
  private oscs: OscillatorNode[] = [];
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private intakeGain!: GainNode;
  private intakeFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private windGain!: GainNode;
  private muted = false;
  private volume = 0.7;

  /** 브라우저 자동재생 정책 때문에 사용자 클릭 후 시작해야 합니다. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 12000;
    this.cabinFilter.connect(this.master);
    this.master.connect(ctx.destination);

    // 엔진: 기본 + 하모닉 → 웨이브셰이퍼 → 로우패스
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.2);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 2.5;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const harmonics: [OscillatorType, number, number][] = [
      ['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2, 0.18], ['triangle', 3, 0.08], ['sine', 0.25, 0.4],
    ];
    for (const [type, mult, gain] of harmonics) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 30 * mult;
      o.detune.value = (Math.random() - 0.5) * 12;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(mix);
      o.start();
      (o as OscillatorNode & { mult: number }).mult = mult;
      this.oscs.push(o);
    }
    mix.connect(shaper).connect(this.engineFilter).connect(this.engineGain).connect(this.cabinFilter);

    const noise = noiseBuffer(ctx);
    // 흡기음
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.Q.value = 1.2;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    loop(ctx, noise).connect(this.intakeFilter).connect(this.intakeGain).connect(this.cabinFilter);
    // 타이어 스키드
    const skidF = ctx.createBiquadFilter();
    skidF.type = 'bandpass';
    skidF.frequency.value = 1100;
    skidF.Q.value = 3;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    loop(ctx, noise).connect(skidF).connect(this.skidGain).connect(this.cabinFilter);
    // 바람
    const windF = ctx.createBiquadFilter();
    windF.type = 'lowpass';
    windF.frequency.value = 500;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    loop(ctx, noise).connect(windF).connect(this.windGain).connect(this.master);
  }

  get running(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  update(rpm: number, load: number, speedKmh: number, skid: number, inCabin: boolean, active: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const fire = (rpm / 60) * 2;
    for (const o of this.oscs) o.frequency.setTargetAtTime(fire * (o as OscillatorNode & { mult: number }).mult, t, 0.03);
    const on = active ? 1 : 0;
    this.engineGain.gain.setTargetAtTime(on * (0.1 + load * 0.22 + (rpm / 7000) * 0.08), t, 0.05);
    this.engineFilter.frequency.setTargetAtTime(220 + load * 1800 + rpm * 0.35, t, 0.05);
    this.intakeFilter.frequency.setTargetAtTime(500 + rpm * 0.5, t, 0.05);
    this.intakeGain.gain.setTargetAtTime(on * load * (rpm / 7000) * 0.12, t, 0.05);
    this.skidGain.gain.setTargetAtTime(on * Math.min(1, skid) * 0.22, t, 0.04);
    const w = Math.min(1, speedKmh / 200);
    this.windGain.gain.setTargetAtTime(on * w * w * (inCabin ? 0.06 : 0.22), t, 0.2);
    this.cabinFilter.frequency.setTargetAtTime(inCabin ? 2200 : 12000, t, 0.15);
  }
}

function softClip(k: number): Float32Array {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function loop(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(0, Math.random() * 1.5);
  return s;
}
