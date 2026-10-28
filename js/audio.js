// 電車の音。すべて WebAudio で合成する（音声ファイルなし）。
//  - 走行音：低いゴーッという音（ブラウンノイズ）＋風切り＋モーターのうなり（加速・減速で音程が動く）
//  - レールの継ぎ目：速さに応じて「タタン、タタン」
//  - 空調、停車中のコンプレッサー
//  - ブレーキのきしみ、空気の抜ける音、ドアチャイム、ドアの開閉、案内放送の前のチャイム
//  - 乗客の衣擦れ・足音・着信音・イヤホンの音漏れ（立体音響で、その人の位置から）
// チャイムや着信音のメロディーはこの作品のための自作（実在の鉄道・端末の音は使わない）。
// AudioContext はブラウザの制約上、ボタンを押したタイミングで init() すること。
export class TrainAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.silent = false; // 早送り中は鳴らさない
    this.speed = 0;      // 0〜1（1 ≒ 80km/h）
    this.target = 0;
    this.level = 0.5;    // 走行音の大きさ（混雑の段階で上げる）
    this.levelTarget = 0.5;
    this.running = false;
    this.dist = 0;
    this.nextJoint = 10;
    this.leaks = new Map();
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    // 車内の短い響き（金属の箱）
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(0.9);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.5;
    this.reverb.connect(this.wet).connect(this.master);
    // 走行音など、頭のまわり全体から聞こえる音
    this.bed = ctx.createGain();
    this.bed.gain.value = 1;
    this.bed.connect(this.master);
    this.noise = this._noiseBuffer(2, false);
    this.brown = this._noiseBuffer(4, true);
  }

  get ready() {
    return !!this.ctx;
  }

  _impulse(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.exp(-t * 6) * 1.5;
      }
    }
    return buf;
  }

  _noiseBuffer(sec, brown) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    const f = 3000;
    for (let i = 0; i < f; i++) {
      const k = i / f;
      d[len - f + i] = d[len - f + i] * (1 - k) + d[i] * k;
    }
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (!this.ctx || !this.running || this.muted) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  // 立体音響の出口（pos：ワールド座標）
  _out(pos, { ref = 0.6, wet = 0.25 } = {}) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    p.maxDistance = 30;
    setPos(p, pos);
    p.connect(this.master);
    const w = ctx.createGain();
    w.gain.value = wet;
    p.connect(w).connect(this.reverb);
    return p;
  }

  _src(buffer, loop = false) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    if (loop) s.loopStart = 0;
    s.playbackRate.value = 1;
    return s;
  }

  // ---------- ずっと鳴っている音 ----------
  start() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    this.stopLoops();
    this.running = true;
    this.muted = false;
    const now = ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(this.volume, now + 1.5);

    const loops = [];
    // ゴーッ（低い走行音）
    const rumble = this._src(this.brown, true);
    this.rumbleLP = ctx.createBiquadFilter();
    this.rumbleLP.type = 'lowpass';
    this.rumbleLP.frequency.value = 150;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(this.rumbleLP).connect(this.rumbleGain).connect(this.bed);
    // 風切り・車輪の転がる音
    const roar = this._src(this.noise, true);
    roar.playbackRate.value = 0.7;
    this.roarBP = ctx.createBiquadFilter();
    this.roarBP.type = 'bandpass';
    this.roarBP.frequency.value = 500;
    this.roarBP.Q.value = 0.6;
    this.roarGain = ctx.createGain();
    this.roarGain.gain.value = 0;
    roar.connect(this.roarBP).connect(this.roarGain).connect(this.bed);
    // モーターのうなり（2本のこぎり波を帯域フィルターに通す）
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0;
    this.motorBP = ctx.createBiquadFilter();
    this.motorBP.type = 'bandpass';
    this.motorBP.Q.value = 3;
    this.motor = [ctx.createOscillator(), ctx.createOscillator()];
    this.motor[0].type = 'sawtooth';
    this.motor[1].type = 'triangle';
    for (const o of this.motor) o.connect(this.motorBP);
    this.motorBP.connect(this.motorGain).connect(this.bed);
    // 空調（止まっていても鳴っている）
    const air = this._src(this.brown, true);
    air.playbackRate.value = 1.6;
    const airLP = ctx.createBiquadFilter();
    airLP.type = 'lowpass';
    airLP.frequency.value = 420;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0.12;
    air.connect(airLP).connect(this.airGain).connect(this.bed);
    for (const n of [rumble, roar, air, ...this.motor]) n.start(now);
    loops.push(rumble, roar, air, ...this.motor);
    this.loops = loops;
    this.dist = 0;
    this.nextJoint = 6;
  }

  stopLoops() {
    for (const n of this.loops || []) {
      try { n.stop(); } catch (e) { /* 止まっている */ }
    }
    this.loops = [];
    for (const k of [...this.leaks.keys()]) this.stopLeak(k);
  }

  stop() {
    if (!this.ctx) return;
    this.running = false;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(0, now, 0.1);
    const loops = this.loops;
    this.loops = [];
    for (const k of [...this.leaks.keys()]) this.stopLeak(k);
    setTimeout(() => {
      for (const n of loops) {
        try { n.stop(); } catch (e) { /* 止まっている */ }
      }
    }, 600);
  }

  // 完全な静寂（true）と、そこからの復帰
  mute(on, fade = 1.5) {
    if (!this.ctx) return;
    this.muted = on;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(on ? 0 : this.volume, now, fade / 3);
  }

  // 頭の位置と向き（three の matrixWorld の elements）
  setListener(e) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const px = e[12], py = e[13], pz = e[14];
    const fx = -e[8], fy = -e[9], fz = -e[10];
    const ux = e[4], uy = e[5], uz = e[6];
    if (L.positionX) {
      L.positionX.value = px; L.positionY.value = py; L.positionZ.value = pz;
      L.forwardX.value = fx; L.forwardY.value = fy; L.forwardZ.value = fz;
      L.upX.value = ux; L.upY.value = uy; L.upZ.value = uz;
    } else {
      L.setPosition(px, py, pz);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ---------- 走る・止まる ----------
  // 目標の速さ（0〜1）。rate：1秒あたりの変化（加速・減速の強さ）
  drive(target, rate = 0.06) {
    this.target = target;
    this.rate = rate;
  }

  setLevel(l) {
    this.levelTarget = l;
  }

  // 毎フレーム。戻り値：この瞬間の加速度（傾きの演出用）
  update(dt) {
    const prev = this.speed;
    const d = this.target - this.speed;
    this.speed += Math.sign(d) * Math.min(Math.abs(d), (this.rate || 0.06) * dt);
    const accel = (this.speed - prev) / Math.max(dt, 1e-3);
    this.level += (this.levelTarget - this.level) * Math.min(1, dt * 0.4);
    if (!this.ctx || !this.loops.length) return accel;
    const now = this.ctx.currentTime;
    const s = this.speed, L = this.level;
    this.rumbleGain.gain.setTargetAtTime(s * 0.75 * L + 0.02, now, 0.1);
    this.rumbleLP.frequency.setTargetAtTime(110 + s * 260, now, 0.2);
    this.roarGain.gain.setTargetAtTime(s * s * 0.16 * L, now, 0.1);
    this.roarBP.frequency.setTargetAtTime(300 + s * 700, now, 0.2);
    const f = 140 + s * 1300;
    this.motor[0].frequency.setTargetAtTime(f, now, 0.08);
    this.motor[1].frequency.setTargetAtTime(f * 1.498, now, 0.08);
    this.motorBP.frequency.setTargetAtTime(f * 1.2, now, 0.1);
    const whine = s > 0.01 ? (0.006 + Math.min(1, Math.abs(accel) * 14) * 0.03) * (0.4 + L * 0.6) : 0;
    this.motorGain.gain.setTargetAtTime(whine, now, 0.15);
    // レールの継ぎ目（25m ごと。車輪2組が続けて渡る）
    this.dist += s * 22 * dt;
    if (this.dist >= this.nextJoint) {
      this.nextJoint = this.dist + 25;
      if (!this.silent && !this.muted && s > 0.05) {
        const gap = 2.4 / Math.max(3, s * 22);
        const v = (0.25 + s * 0.5) * L;
        this._joint(now, v);
        this._joint(now + gap, v * 0.85);
        const later = 15 / Math.max(3, s * 22);
        this._joint(now + later, v * 0.7);
        this._joint(now + later + gap, v * 0.6);
      }
    }
    return accel;
  }

  _joint(t, v) {
    const ctx = this.ctx;
    const src = this._src(this.noise);
    src.playbackRate.value = 0.5;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    src.connect(lp).connect(g).connect(this.bed);
    src.start(t, Math.random());
    src.stop(t + 0.2);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(75, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const og = ctx.createGain();
    og.gain.setValueAtTime(v * 0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(this.bed);
    o.start(t);
    o.stop(t + 0.16);
  }

  // ---------- 一回だけ鳴る音 ----------
  _ok() {
    return this.ctx && this.running && !this.silent && !this.muted;
  }

  _tone(dest, t, freq, dur, peak, type = 'sine', attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  _noiseHit(dest, t, { freq = 1000, q = 1, type = 'bandpass', peak = 0.2, attack = 0.005, decay = 0.1, rate = 1 } = {}) {
    const ctx = this.ctx;
    const src = this._src(this.noise);
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + attack + decay + 0.05);
    return { src, f, g };
  }

  // 鐘のような音（倍音を少し足す）
  _bell(dest, t, freq, peak, dur = 1.2) {
    this._tone(dest, t, freq, dur, peak);
    this._tone(dest, t, freq * 2.01, dur * 0.5, peak * 0.25);
    this._tone(dest, t, freq * 3.02, dur * 0.25, peak * 0.08);
  }

  // 案内放送の前のチャイム（上がって、下がる）
  announceChime(pos) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 1.2, wet: 0.4 });
    const t = this.ctx.currentTime + 0.02;
    this._bell(out, t, 932.3, 0.22, 1.4);
    this._bell(out, t + 0.42, 698.5, 0.22, 1.8);
  }

  // ドアチャイム（3音で下がるのを2回）。close のときは少し速く
  doorChime(pos, close = false) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 1.2, wet: 0.35 });
    const t0 = this.ctx.currentTime + 0.02;
    const notes = [1046.5, 880, 698.5];
    const step = close ? 0.2 : 0.26;
    for (let r = 0; r < 2; r++) {
      notes.forEach((f, i) => this._bell(out, t0 + r * (step * 3 + 0.25) + i * step, f, 0.16, 0.9));
    }
  }

  // ドアの開閉（プシュッ、ガーッ、トン）
  door(pos, open = true) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 1.2, wet: 0.3 });
    const t = this.ctx.currentTime + 0.02;
    this._noiseHit(out, t, { type: 'highpass', freq: 2500, peak: 0.18, attack: 0.01, decay: 0.35 });
    const slide = this._noiseHit(out, t + 0.15, { freq: 380, q: 1.2, peak: 0.22, attack: 0.15, decay: 0.9, rate: 0.6 });
    slide.f.frequency.setValueAtTime(open ? 300 : 500, t + 0.15);
    slide.f.frequency.linearRampToValueAtTime(open ? 520 : 280, t + 1.1);
    this._noiseHit(out, t + 1.05, { type: 'lowpass', freq: 220, peak: open ? 0.25 : 0.45, decay: 0.18 });
    this._tone(out, t + 1.05, 70, 0.25, open ? 0.15 : 0.3);
  }

  // ブレーキのきしみ。hard：急ブレーキ
  brake(dur = 3, hard = false) {
    if (!this._ok()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const g = ctx.createGain();
    const peak = hard ? 0.075 : 0.03;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.4);
    g.gain.setValueAtTime(peak, t + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    g.connect(this.bed);
    for (const [f, k] of [[2870, 1], [3460, 0.6], [5740, 0.25]]) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f * (hard ? 1.04 : 1), t);
      o.frequency.linearRampToValueAtTime(f * 1.05, t + dur);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5 + Math.random() * 3;
      const lg = ctx.createGain();
      lg.gain.value = f * 0.004;
      lfo.connect(lg).connect(o.frequency);
      const og = ctx.createGain();
      og.gain.value = k;
      o.connect(og).connect(g);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.1);
      lfo.stop(t + dur + 0.1);
    }
    if (hard) this._noiseHit(this.bed, t, { type: 'lowpass', freq: 400, peak: 0.35, attack: 0.05, decay: 1.4 });
  }

  // 止まったあとの「プシュー」
  airRelease(pos) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 1.5, wet: 0.2 });
    this._noiseHit(out, this.ctx.currentTime + 0.02, { type: 'highpass', freq: 1800, peak: 0.16, attack: 0.04, decay: 1.6 });
  }

  // 停車中のコンプレッサー（ドッドッドッ…）
  compressor(pos, dur = 6) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 2, wet: 0.2 });
    const t0 = this.ctx.currentTime + 0.05;
    for (let t = 0; t < dur; t += 0.115) {
      const fade = Math.min(1, t / 0.8, (dur - t) / 0.8);
      this._tone(out, t0 + t, 58, 0.09, 0.22 * fade, 'triangle', 0.01);
    }
  }

  strapClack(pos, v = 1) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 0.5, wet: 0.2 });
    const t = this.ctx.currentTime + 0.02 + Math.random() * 0.05;
    this._noiseHit(out, t, { type: 'highpass', freq: 2500, peak: 0.12 * v, decay: 0.025 });
    this._tone(out, t, 1400 + Math.random() * 500, 0.05, 0.04 * v);
  }

  rustle(pos, v = 1) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 0.5, wet: 0.15 });
    const t = this.ctx.currentTime + 0.02;
    const d = 0.2 + Math.random() * 0.4;
    this._noiseHit(out, t, { freq: 2200 + Math.random() * 1500, q: 0.7, peak: 0.07 * v, attack: d * 0.4, decay: d });
  }

  footstep(pos, v = 1) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 0.6, wet: 0.2 });
    const t = this.ctx.currentTime + 0.02;
    this._noiseHit(out, t, { type: 'lowpass', freq: 700, peak: 0.2 * v, decay: 0.07 });
    this._tone(out, t, 95, 0.08, 0.08 * v);
  }

  // 着信音（自作の5種類）。dur 秒鳴らす
  ringtone(pos, kind, dur = 5) {
    if (!this._ok()) return;
    const out = this._out(pos, { ref: 0.5, wet: 0.2 });
    const t0 = this.ctx.currentTime + 0.05;
    const end = t0 + dur;
    const N = (n) => 440 * Math.pow(2, (n - 69) / 12);
    if (kind === 'marimba') {
      const seq = [72, 76, 79, 84, 79, 76, 74, 79];
      for (let r = t0; r < end; r += 1.4) seq.forEach((n, i) => r + i * 0.12 < end && this._tone(out, r + i * 0.12, N(n), 0.25, 0.09));
    } else if (kind === 'bell') {
      for (let r = t0; r < end; r += 2.6) {
        for (let i = 0; i < 20; i++) this._tone(out, r + i * 0.05, i % 2 ? 1320 : 1660, 0.06, 0.035, 'square', 0.002);
        for (let i = 0; i < 20; i++) this._tone(out, r + 1.2 + i * 0.05, i % 2 ? 1320 : 1660, 0.06, 0.035, 'square', 0.002);
      }
    } else if (kind === 'digital') {
      for (let r = t0; r < end; r += 1.1) for (let i = 0; i < 4; i++) this._tone(out, r + i * 0.14, 2100, 0.08, 0.04, 'square', 0.002);
    } else if (kind === 'melody') {
      const seq = [76, 79, 81, 79, 76, 74, 72, 74, 76, 76, 74];
      for (let r = t0; r < end; r += 2.2) seq.forEach((n, i) => r + i * 0.17 < end && this._tone(out, r + i * 0.17, N(n), 0.16, 0.04, 'square', 0.004));
    } else {
      // バイブレーション（ブーッ、ブーッ）
      for (let r = t0; r < end; r += 1.0) {
        const o = this._tone(out, r, 150, 0.45, 0.12, 'sawtooth', 0.02);
        o.detune.value = Math.random() * 50;
      }
    }
  }

  // イヤホンの音漏れ（シャカシャカ）。id ごとに1つ
  startLeak(id, pos) {
    if (!this._ok() || this.leaks.has(id)) return;
    const ctx = this.ctx;
    const out = this._out(pos, { ref: 0.35, wet: 0.05 });
    const src = this._src(this.noise, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 7500;
    bp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0.02;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 4.33; // 130bpm の8分音符
    const lg = ctx.createGain();
    lg.gain.value = 0.02;
    lfo.connect(lg).connect(g.gain);
    src.connect(bp).connect(g).connect(out);
    src.start();
    lfo.start();
    this.leaks.set(id, { src, lfo, out });
  }

  moveLeak(id, pos) {
    const l = this.leaks.get(id);
    if (l) setPos(l.out, pos);
  }

  stopLeak(id) {
    const l = this.leaks.get(id);
    if (!l) return;
    try { l.src.stop(); l.lfo.stop(); } catch (e) { /* 止まっている */ }
    this.leaks.delete(id);
  }
}

function setPos(p, v) {
  if (p.positionX) {
    p.positionX.value = v.x;
    p.positionY.value = v.y;
    p.positionZ.value = v.z;
  } else {
    p.setPosition(v.x, v.y, v.z);
  }
}
