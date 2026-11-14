/* =====================================================
   FPV KAMIKAZE — vstupy
   Klávesnice + gamepad / RC rádio (USB Joystick = Gamepad API)

   Rozložení kanálů (Mode 2):
     levá páčka  = plyn (Y) + yaw/směr (X)
     pravá páčka = pitch výškovka (Y) + křidélka/roll (X)
   RC rádio v režimu USB Joystick obvykle hlásí AETR:
     osa0=ch1 křidélka, osa1=ch2 výškovka, osa2=ch3 plyn, osa3=ch4 směrovka
   ===================================================== */
'use strict';

const Input = {
  keys: Object.create(null),
  kb: { roll: 0, pitch: 0, yaw: 0, throttle: -1 }, // vyhlazené klávesové "páčky"
  state: { roll: 0, pitch: 0, yaw: 0, throttle: -1, source: 'kb' },
  buttons: { arm: false, reset: false, pause: false, camera: false, minimap: false, markers: false, mute: false, help: false, bomb: false, thermal: false, orbit: false, use: false, launch: false, w1: false, w2: false, rocket: false, droneNext: false, dronePrev: false },
  padId: null, padList: [],
  padLive: { axes: [], buttons: [], nAxes: 0, nButtons: 0, active: false, id: '' },
  padFire: false,
  _prevPadBtns: [],
  _edgeKeys: Object.create(null),

  init() {
    const block = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      this._edgeKeys[e.code] = true;
      if (block.includes(e.code) && !e.target.closest?.('input,select,textarea')) e.preventDefault();
    });
    window.addEventListener('keyup', e => { delete this.keys[e.code]; });
    window.addEventListener('blur', () => { for (const k in this.keys) delete this.keys[k]; });

    window.addEventListener('gamepadconnected', e => {
      if (!this.padId) this.padId = e.gamepad.id;
      // toast:  připojeno — spravuje game přes polling padList
    });
    window.addEventListener('gamepaddisconnected', e => {
      if (this.padId === e.gamepad.id) this.padId = null;
    });

    /* kolečko myši = výběr dronu v batohu */
    window.addEventListener('wheel', e => {
      if (typeof G === 'undefined' || G.state !== 'fly' || G.mode !== 'soldier' || G.settingsOpen) return;
      if (Math.abs(e.deltaY) < 1) return;
      if (e.deltaY > 0) this.buttons.droneNext = true; else this.buttons.dronePrev = true;
    }, { passive: true });
  },

  resetThrottle() { this.kb.throttle = -1; },

  getPads() {
    if (!navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads()).filter(Boolean);
  },

  /* přepnutí přednastaveného mapování */
  setPreset(name) {
    const p = Settings.pad;
    if (name === 'mode2') { p.axes = { roll: 2, pitch: 3, yaw: 0, throttle: 1 }; }
    else if (name === 'aetr') { p.axes = { roll: 0, pitch: 1, yaw: 3, throttle: 2 }; }
    p.preset = name;
    Settings.save();
  },

  consume(name) { const v = this.buttons[name]; this.buttons[name] = false; return v; },

  update(dt) {
    /* ---- klávesnice ---- */
    const k = this.keys;
    let tr = 0, tp = 0, ty = 0, tt = 0;
    if (k['ArrowLeft']) tr -= 1;
    if (k['ArrowRight']) tr += 1;
    if (k['ArrowUp']) tp -= 1;     // páčka dopředu = nos dolů
    if (k['ArrowDown']) tp += 1;   // přitáhnout = nos nahoru
    if (k['KeyA']) ty -= 1;
    if (k['KeyD']) ty += 1;
    if (k['KeyW']) tt += 1;
    if (k['KeyS']) tt -= 1;
    this.kb.roll = U.damp(this.kb.roll, tr, 14, dt);
    this.kb.pitch = U.damp(this.kb.pitch, tp, 14, dt);
    this.kb.yaw = U.damp(this.kb.yaw, ty, 14, dt);
    this.kb.throttle = U.clamp(this.kb.throttle + tt * 1.7 * dt, -1, 1); // "drží" se jako páčka bez pružiny

    /* ---- gamepad / RC rádio ---- */
    const pads = this.getPads();
    this.padList = pads.map(p => ({ id: p.id, axes: p.axes.length, buttons: p.buttons.length, mapping: p.mapping }));
    let pad = this.padId ? pads.find(p => p.id === this.padId) : null;
    if (!pad && pads.length) { pad = pads[0]; this.padId = pad.id; }

    let padActive = false;
    if (pad && Settings.pad.enabled) {
      const c = Settings.pad, a = pad.axes;
      const ax = (i, inv) => { let v = (i < a.length) ? a[i] : 0; return inv ? -v : v; };
      const db = v => {
        const s = v < 0 ? -1 : 1, m = Math.abs(v);
        if (m < c.deadband) return 0;
        return s * (m - c.deadband) / (1 - c.deadband);
      };
      const ch = {
        roll: db(ax(c.axes.roll, c.inv.roll)),
        pitch: db(ax(c.axes.pitch, c.inv.pitch)),
        yaw: db(ax(c.axes.yaw, c.inv.yaw)),
        throttle: U.clamp(ax(c.axes.throttle, c.inv.throttle), -1, 1),
      };
      const btns = pad.buttons.map(b => !!(b.pressed || b.value > 0.5));
      padActive =
        Math.abs(ch.roll) > 0.02 || Math.abs(ch.pitch) > 0.02 || Math.abs(ch.yaw) > 0.02 ||
        Math.abs(ch.throttle + 1) > 0.04 || btns.some(b => b);

      if (padActive) {
        this.state.roll = ch.roll; this.state.pitch = ch.pitch;
        this.state.yaw = ch.yaw; this.state.throttle = ch.throttle;
        this.state.source = 'pad';
      }
      this.padLive = { axes: Array.from(a), buttons: btns, nAxes: a.length, nButtons: btns.length, active: padActive, id: pad.id };

      /* hrany tlačítek */
      const pb = this._prevPadBtns;
      const press = (i) => btns[i] && !(pb && pb[i]);
      if (press(c.armButton)) this.buttons.arm = true;
      if (press(c.resetButton)) this.buttons.reset = true;
      if (press(c.pauseButton)) this.buttons.pause = true;
      if (c.bombButton >= 0 && press(c.bombButton)) this.buttons.bomb = true;
      if (c.thermalButton >= 0 && press(c.thermalButton)) this.buttons.thermal = true;
      if (c.orbitButton >= 0 && press(c.orbitButton)) this.buttons.orbit = true;
      /* spouště pro pěšáka: R2 = palba, L2 = raketa */
      this.padFire = !!btns[7];
      if (btns[6] && !(pb && pb[6])) this.buttons.rocket = true;
      /* pěšák: Y = vzít bednu, X = vypustit dron */
      if (press(3)) this.buttons.use = true;
      if (press(2)) this.buttons.launch = true;
      /* pěšák: D-pad = výběr dronu v batohu */
      if (press(14)) this.buttons.dronePrev = true;
      if (press(15)) this.buttons.droneNext = true;
      this._prevPadBtns = btns;
    } else {
      this.padFire = false;
      this.padLive = { axes: [], buttons: [], nAxes: 0, nButtons: 0, active: false, id: '' };
    }

    /* klávesnice = záloha, když pad nic nedělá */
    if (!padActive) {
      this.state.roll = this.kb.roll; this.state.pitch = this.kb.pitch;
      this.state.yaw = this.kb.yaw; this.state.throttle = this.kb.throttle;
      this.state.source = 'kb';
    }

    /* hrany kláves (jen když hra běží — UI má vlastní obsluhu) */
    const ek = this._edgeKeys;
    if (ek['Space']) this.buttons.arm = true;
    if (ek['KeyR']) this.buttons.reset = true;
    if (ek['Escape'] || ek['KeyP']) this.buttons.pause = true;
    if (ek['KeyC']) this.buttons.camera = true;
    if (ek['KeyN']) this.buttons.minimap = true;
    if (ek['KeyF']) this.buttons.markers = true;
    if (ek['KeyM']) this.buttons.mute = true;
    if (ek['KeyH']) this.buttons.help = true;
    if (ek['KeyB']) this.buttons.bomb = true;
    if (ek['KeyT']) this.buttons.thermal = true;
    if (ek['KeyO']) this.buttons.orbit = true;
    /* pěšák */
    if (ek['KeyE']) this.buttons.use = true;
    if (ek['KeyG']) this.buttons.launch = true;
    if (ek['KeyQ']) this.buttons.droneNext = true;
    if (ek['KeyZ']) this.buttons.dronePrev = true;
    if (ek['Digit1']) this.buttons.w1 = true;
    if (ek['Digit2']) this.buttons.w2 = true;
    this._edgeKeys = Object.create(null);
  },
};
