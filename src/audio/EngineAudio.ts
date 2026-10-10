/**
 * GLC 300 (2.0L 직렬 4기통 터보 + 48V ISG) 성격의 엔진음을 Web Audio로 실시간 합성합니다.
 * 고급 SUV 쿠페는 실내 방음이 좋아 엔진음이 낮고 부드럽고, 고속에서는 노면·풍절음이 더 크게 들립니다.
 *  - 엔진: 점화 주파수(rpm/60×2) 중심의 사인·삼각파 하모닉 + 부드러운 포화 + 강한 로우패스 (레이싱 톱니파 제거)
 *  - 터보: 부하·회전수에 비례하는 고음 휘슬 + 가속 페달을 뗄 때 짧은 블로우오프
 *  - 노면: 속도에 비례하는 저역 브라운 노이즈 (타이어 굴림 소음)
 *  - 바람·스키드
 * 외부 녹음 파일을 쓰지 않아 라이선스 문제가 없습니다.
 */
export class EngineAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private cabinFilter!: BiquadFilterNode;
  private oscs: { o: OscillatorNode; mult: number }[] = [];
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private turboOsc!: OscillatorNode;
  private turboGain!: GainNode;
  private blowGain!: GainNode;
  private roadGain!: GainNode;
  private roadFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private windGain!: GainNode;
  private muted = false;
  private volume = 0.8;
  private lastLoad = 0;

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
    this.cabinFilter.frequency.value = 9000;
    this.cabinFilter.connect(this.master);
    this.master.connect(ctx.destination);

    // ── 엔진 ──
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    // [파형, 배수(점화 주파수 기준), 크기]: 4기통 특유의 2차 성분 + 낮은 크랭크 성분, 높은 차수는 약하게
    const harmonics: [OscillatorType, number, number][] = [
      ['sine', 0.5, 0.55], ['sine', 1, 0.9], ['triangle', 1, 0.25], ['sine', 2, 0.32], ['sine', 3, 0.1], ['sine', 1.5, 0.12],
    ];
    for (const [type, mult, gain] of harmonics) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 25 * mult;
      o.detune.value = (Math.random() - 0.5) * 6;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(mix);
      o.start();
      this.oscs.push({ o, mult });
    }
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(1.3);
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.Q.value = 0.7;
    const body = ctx.createBiquadFilter(); // 차체 공명 (저역을 둥글게)
    body.type = 'peaking';
    body.frequency.value = 110;
    body.gain.value = 5;
    body.Q.value = 1;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    mix.connect(shaper).connect(this.engineFilter).connect(body).connect(this.engineGain).connect(this.cabinFilter);

    const noise = whiteNoise(ctx);
    const brown = brownNoise(ctx);

    // ── 터보 휘슬 + 블로우오프 ──
    this.turboOsc = ctx.createOscillator();
    this.turboOsc.type = 'sine';
    this.turboOsc.frequency.value = 2500;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turboOsc.connect(this.turboGain).connect(this.cabinFilter);
    this.turboOsc.start();
    const blowF = ctx.createBiquadFilter();
    blowF.type = 'bandpass';
    blowF.frequency.value = 1800;
    blowF.Q.value = 0.8;
    this.blowGain = ctx.createGain();
    this.blowGain.gain.value = 0;
    loop(ctx, noise).connect(blowF).connect(this.blowGain).connect(this.cabinFilter);

    // ── 노면 소음 (타이어) ──
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 260;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    loop(ctx, brown).connect(this.roadFilter).connect(this.roadGain).connect(this.master);

    // ── 스키드 ──
    const skidF = ctx.createBiquadFilter();
    skidF.type = 'bandpass';
    skidF.frequency.value = 1100;
    skidF.Q.value = 3;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    loop(ctx, noise).connect(skidF).connect(this.skidGain).connect(this.cabinFilter);

    // ── 바람 ──
    const windF = ctx.createBiquadFilter();
    windF.type = 'bandpass';
    windF.frequency.value = 500;
    windF.Q.value = 0.5;
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
    const on = active ? 1 : 0;
    const fire = (rpm / 60) * 2;
    for (const { o, mult } of this.oscs) o.frequency.setTargetAtTime(fire * mult, t, 0.04);
    const r = Math.min(1, rpm / 6300);
    // 조용한 공회전, 밟을 때만 존재감 (고급차 방음)
    this.engineGain.gain.setTargetAtTime(on * (0.05 + load * 0.11 + r * 0.05), t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(160 + rpm * 0.13 + load * 520, t, 0.08);
    // 터보: 부스트가 걸리는 2,000rpm 이상 + 부하
    const boost = Math.max(0, Math.min(1, (rpm - 1800) / 3500)) * load;
    this.turboOsc.frequency.setTargetAtTime(1800 + rpm * 0.55, t, 0.15);
    this.turboGain.gain.setTargetAtTime(on * boost * 0.012, t, 0.2);
    // 페달을 갑자기 뗄 때 블로우오프
    if (this.lastLoad - load > 0.5 && rpm > 2600 && on) {
      this.blowGain.gain.cancelScheduledValues(t);
      this.blowGain.gain.setValueAtTime(0.05, t);
      this.blowGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    }
    this.lastLoad = load;
    // 노면: 속도에 비례, 고속일수록 음색이 밝아짐
    const v = Math.min(1, speedKmh / 160);
    this.roadGain.gain.setTargetAtTime(on * (v * 0.22 + (speedKmh > 2 ? 0.01 : 0)), t, 0.2);
    this.roadFilter.frequency.setTargetAtTime(180 + v * 380, t, 0.3);
    this.skidGain.gain.setTargetAtTime(on * Math.min(1, skid) * 0.18, t, 0.04);
    const w = Math.min(1, speedKmh / 200);
    this.windGain.gain.setTargetAtTime(on * w * w * (inCabin ? 0.05 : 0.16), t, 0.25);
    // 실내에서는 고음을 더 걸러냄 (차음 유리·흡음재)
    this.cabinFilter.frequency.setTargetAtTime(inCabin ? 1400 : 9000, t, 0.15);
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

function whiteNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function brownNoise(ctx: AudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return buf;
}

function loop(ctx: AudioContext, buf: AudioBuffer): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(0, Math.random() * 1.5);
  return s;
}
