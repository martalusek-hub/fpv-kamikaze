/* =====================================================
   FPV KAMIKAZE — zvuk (WebAudio, plně procedurální)
   ===================================================== */
'use strict';

const AudioSys = {
  ctx: null, master: null, noiseBuf: null,
  motor: null, wind: null, stat: null,
  volume: 0.8, muted: false,

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.master.connect(ctx.destination);
    // sdílený bílý šum
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._buildMotor(); this._buildWind(); this._buildStatic();
  },

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05); },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.05); },

  /* ---------- motory ---------- */
  _buildMotor() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0; g.connect(this.master);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 90;
    const f1 = ctx.createBiquadFilter(); f1.type = 'lowpass'; f1.frequency.value = 1400;
    o1.connect(f1); f1.connect(g);
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 185;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o2.connect(g2); g2.connect(g);
    // šum vrtulí
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.1;
    const ng = ctx.createGain(); ng.gain.value = 0.35;
    ns.connect(bp); bp.connect(ng); ng.connect(g);
    o1.start(); o2.start(); ns.start();
    this.motor = { g, o1, o2, bp, ng };
  },
  updateMotor(armed, throttle01) {
    if (!this.motor) return;
    const t = this.ctx.currentTime;
    const wob = 1 + (Math.random() - 0.5) * 0.02;
    const f = (78 + throttle01 * 340) * wob;
    this.motor.o1.frequency.setTargetAtTime(f, t, 0.06);
    this.motor.o2.frequency.setTargetAtTime(f * 2.02 + 3, t, 0.06);
    this.motor.bp.frequency.setTargetAtTime(260 + f * 6, t, 0.1);
    const vol = armed ? (0.05 + throttle01 * 0.30) : 0;
    this.motor.g.gain.setTargetAtTime(vol, t, 0.09);
  },

  /* ---------- vítr ---------- */
  _buildWind() {
    const ctx = this.ctx;
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const g = ctx.createGain(); g.gain.value = 0;
    ns.connect(lp); lp.connect(g); g.connect(this.master); ns.start();
    this.wind = { g, lp };
  },
  updateWind(speed) {
    if (!this.wind) return;
    const t = this.ctx.currentTime;
    const k = U.clamp(speed / 46, 0, 1);
    this.wind.g.gain.setTargetAtTime(k * k * 0.30, t, 0.15);
    this.wind.lp.frequency.setTargetAtTime(280 + speed * 26, t, 0.2);
  },

  /* ---------- statický šum (ztráta signálu) ---------- */
  _buildStatic() {
    const ctx = this.ctx;
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const g = ctx.createGain(); g.gain.value = 0;
    ns.connect(hp); hp.connect(g); g.connect(this.master); ns.start();
    this.stat = { g };
  },
  updateStatic(level) {
    if (!this.stat) return;
    this.stat.g.gain.setTargetAtTime(U.clamp(level, 0, 1) * 0.20, this.ctx.currentTime, 0.1);
  },

  /* ---------- jedno shoty ---------- */
  _beep(freq, dur, delay = 0, type = 'square', vol = 0.16) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.008);
    g.gain.setValueAtTime(vol, t0 + dur - 0.015);
    g.gain.linearRampToValueAtTime(0, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },
  beepArm() { this._beep(1046, 0.06); this._beep(1046, 0.06, 0.09); this._beep(1318, 0.14, 0.18); },
  beepDisarm() { this._beep(392, 0.30, 0, 'square', 0.12); },
  beepError() { this._beep(233, 0.12); this._beep(233, 0.12, 0.16); },
  beepLock() { this._beep(1568, 0.05); this._beep(1568, 0.05, 0.07); },
  beepBattery() { this._beep(880, 0.09); },
  click() { this._beep(660, 0.035, 0, 'triangle', 0.10); },

  /* výstřel z pušky (vzdálenost od dronu/kamery) */
  shot(dist) {
    if (!this.ctx) return;
    if (!isFinite(dist)) dist = 620;
    const vol = U.clamp(1.05 - dist / 620, 0.02, 0.55);
    const ctx = this.ctx, t0 = ctx.currentTime;
    // ostrá rána — filtrovaný šum
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf;
    ns.playbackRate.value = U.rand(0.85, 1.25);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    ns.connect(hp); hp.connect(g); g.connect(this.master);
    ns.start(t0); ns.stop(t0 + 0.09);
    // nízký úder
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(210, t0); o.frequency.exponentialRampToValueAtTime(85, t0 + 0.05);
    const og = ctx.createGain();
    og.gain.setValueAtTime(vol * 0.5, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.07);
    o.connect(og); og.connect(this.master); o.start(t0); o.stop(t0 + 0.08);
  },

  explosion(dist, power = 1) {
    if (!this.ctx) return;
    const vol = U.clamp(1.25 - dist / 550, 0.05, 1) * power;
    const ctx = this.ctx, t0 = ctx.currentTime;
    // sub bas
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(62, t0); o.frequency.exponentialRampToValueAtTime(26, t0 + 0.7);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.9 * vol, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.85);
    o.connect(og); og.connect(this.master); o.start(t0); o.stop(t0 + 0.9);
    // tělo
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2800, t0); lp.frequency.exponentialRampToValueAtTime(140, t0 + 0.8);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.001, t0);
    ng.gain.exponentialRampToValueAtTime(0.95 * vol, t0 + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 1.1);
    ns.connect(lp); lp.connect(ng); ng.connect(this.master);
    ns.start(t0); ns.stop(t0 + 1.2);
    // praskání
    for (let i = 0; i < 5; i++) {
      const d = t0 + U.rand(0.08, 0.6);
      const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
      s.playbackRate.value = U.rand(0.7, 1.4);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.22 * vol, d);
      g.gain.exponentialRampToValueAtTime(0.001, d + 0.06);
      s.connect(hp); hp.connect(g); g.connect(this.master);
      s.start(d); s.stop(d + 0.08);
    }
  },
  secondary(dist) { this.explosion(dist, 0.55); },

  /* odhoz pumy — kovové cvaknutí */
  bombDrop() {
    this._beep(190, 0.05, 0, 'square', 0.14);
    this._beep(120, 0.09, 0.03, 'triangle', 0.12);
  },

  /* pískání padající pumy */
  bombWhistle(dur = 1.6) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(1150, t0);
    o.frequency.exponentialRampToValueAtTime(340, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(0.085, t0 + 0.25);
    g.gain.setValueAtTime(0.085, t0 + Math.max(0.3, dur - 0.15));
    g.gain.linearRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  },

  /* ---- pěšák ---- */
  /* výstřel z vlastní pušky (blízko, ostrý) */
  rifle() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf;
    ns.playbackRate.value = U.rand(0.95, 1.15);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
    ns.connect(hp); hp.connect(g); g.connect(this.master);
    ns.start(t0); ns.stop(t0 + 0.11);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(160, t0); o.frequency.exponentialRampToValueAtTime(65, t0 + 0.06);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.32, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
    o.connect(og); og.connect(this.master); o.start(t0); o.stop(t0 + 0.09);
  },

  /* odpálení rakety — sykot a tlaková vlna */
  rocket() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const ns = ctx.createBufferSource(); ns.buffer = this.noiseBuf;
    ns.playbackRate.value = 0.8;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(1400, t0); bp.frequency.exponentialRampToValueAtTime(260, t0 + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.45, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.6);
    ns.connect(bp); bp.connect(g); g.connect(this.master);
    ns.start(t0); ns.stop(t0 + 0.65);
    this._beep(90, 0.12, 0, 'sawtooth', 0.16);
  },

  /* zásah nepřítele (hitmarker) */
  hitMark() {
    this._beep(1900, 0.035, 0, 'triangle', 0.12);
    this._beep(2500, 0.03, 0.04, 'triangle', 0.1);
  },

  /* rána při zásahu hráče */
  hurt() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t0); o.frequency.exponentialRampToValueAtTime(55, t0 + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.32);
  },

  /* přebíjení — kovové kliky */
  reload() {
    this._beep(320, 0.03, 0, 'square', 0.1);
    this._beep(180, 0.05, 0.22, 'square', 0.12);
    this._beep(420, 0.03, 0.45, 'square', 0.1);
  },

  /* sebrání bedny */
  pickup() {
    this._beep(660, 0.06, 0, 'triangle', 0.14);
    this._beep(880, 0.06, 0.08, 'triangle', 0.14);
    this._beep(1174, 0.1, 0.16, 'triangle', 0.14);
  },

  /* odraz střely od pancíře */
  ricochet() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(2200, t0); o.frequency.exponentialRampToValueAtTime(700, t0 + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.09, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + 0.15);
  },
};
