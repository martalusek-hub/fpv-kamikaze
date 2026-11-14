/* =====================================================
   FPV KAMIKAZE — pomocné funkce, šum, nastavení
   ===================================================== */
'use strict';

const U = {
  clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  rand: (a, b) => a + Math.random() * (b - a),
  randi: (a, b) => Math.floor(a + Math.random() * (b - a + 1)),
  pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
  smoothstep: (a, b, x) => { const t = U.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); },
  wrapPi: (a) => { a = a % (Math.PI * 2); if (a > Math.PI) a -= Math.PI * 2; if (a < -Math.PI) a += Math.PI * 2; return a; },
  fmtTime: (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); },
};
// exponenciální vyhlazování (nezávislé na FPS)
U.damp = (cur, target, lambda, dt) => U.lerp(cur, target, 1 - Math.exp(-lambda * dt));

/* ---- deterministický generátor ---- */
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* ---- hodnotový šum 2D (pro terén) ---- */
function makeNoise2D(seed) {
  function hash(ix, iz) {
    let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + seed | 0;
    n = (n ^ (n >>> 13)) | 0;
    n = Math.imul(n, 1274126177) | 0;
    n = (n ^ (n >>> 16)) >>> 0;
    return n / 4294967296;
  }
  const noise = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    return U.lerp(U.lerp(a, b, u), U.lerp(c, d, u), v) * 2 - 1; // -1..1
  };
  noise.hash = hash;
  return noise;
}

/* fraktální šum */
function fbm(noise, x, z, oct = 4, lac = 2.03, gain = 0.5) {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, z * f); norm += a; a *= gain; f *= lac; }
  return s / norm;
}

/* =====================================================
   NASTAVENÍ (perzistentní v localStorage)
   ===================================================== */
const SETTINGS_KEY = 'fpvkami.settings.v1';

/* =================  TYPY DRONŮ (HANGÁR)  ================= */
const DRONES = {
  kamikaze: {
    key: 'kamikaze', label: 'KAMIKAZE',
    desc: 'Ostrý jednorázový nálet. Plná rychlost, nálož na přídi — zásah cíle = zničení.',
    hp: 3, battMul: 1.0, ratesMul: 1.0, thrustMul: 1.0,
    warhead: true, bombs: 0, thermal: false, orbit: false, spotR: 0,
  },
  recon: {
    key: 'recon', label: 'PRŮZKUM',
    desc: 'Tichý průzkumný dron. Termokamera, dvojnásobná výdrž, značí cíle do 260 m.',
    hp: 4, battMul: 2.4, ratesMul: 0.72, thrustMul: 0.7,
    warhead: false, bombs: 0, thermal: true, orbit: true, spotR: 260,
  },
  bomber: {
    key: 'bomber', label: 'BOMBARDÉR',
    desc: 'Těžký dron se 4 pumami. Umí kroužit kolem bodu (orbit) a shazovat pumy z výšky.',
    hp: 6, battMul: 1.5, ratesMul: 0.8, thrustMul: 0.78,
    warhead: false, bombs: 4, thermal: true, orbit: true, spotR: 0,
  },
};

const Settings = {
  // let
  mode: 'acro',          // 'acro' | 'angle'
  droneType: 'kamikaze', // 'kamikaze' | 'recon' | 'bomber'
  rates: 480,            // deg/s roll+pitch
  yawRate: 300,          // deg/s yaw
  expo: 0.25,
  angleMax: 33,          // deg (angle režim)
  levelGain: 5.0,
  rateGain: 9.0,
  maxThrust: 44,         // m/s^2 (~4.5 g)
  tilt: 20,              // deg náklon FPV kamery
  fov: 95,
  autoArm: false,
  assist: true,          // zvýraznění zaměřeného cíle
  markers: true,         // značky cílů
  minimap: true,
  sticks: true,          // indikátor páček
  fpvFx: true,           // statický šum / scanlines / vinětace
  shadows: true,
  volume: 0.8,
  muted: false,
  // gamepad / RC rádio
  pad: {
    enabled: true,
    preset: 'mode2',    // 'mode2' | 'aetr' | 'custom'
    axes: { roll: 2, pitch: 3, yaw: 0, throttle: 1 },
    inv: { roll: false, pitch: false, yaw: false, throttle: false },
    deadband: 0.05,
    armButton: 0,
    resetButton: 1,
    pauseButton: 9,
    bombButton: 2,      // odhoz pumy (bombardér)
    thermalButton: 3,    // termokamera
    orbitButton: 4,      // orbit kroužení
  },

  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        Object.assign(this, o);
        if (o.pad) Object.assign(this.pad, o.pad);
      }
    } catch (e) { /* ignore */ }
  },
  save() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this)); } catch (e) { /* ignore */ }
  },
};
