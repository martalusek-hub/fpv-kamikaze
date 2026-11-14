/* =====================================================
   FPV KAMIKAZE — fyzika dronu
   Konvence THREE: -Z vpřed, +Y nahoru, +X vpravo
   cmds: roll +1 = vpravo, pitch +1 = nahoru, yaw +1 = doprava
   ===================================================== */
'use strict';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const XAXIS = new THREE.Vector3(1, 0, 0);
const ZAXIS = new THREE.Vector3(0, 0, 1);

const Drone = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  quat: new THREE.Quaternion(),
  rates: new THREE.Vector3(),   // tělesné otáčky rad/s (x=+,y=+,z=+ dle konvence výš)
  armed: false, crashed: false, liftedOff: false, holdOnPad: true,
  hp: 3,                          // odolnost trupu (zásahy palbou)
  orbit: { active: false, cx: 0, cz: 0, alt: 0, r: 70, speed: 13, dir: 1 },
  throttleOut: 0,               // 0..maxThrust (skutečný tah po náběhu)
  battery: 1, batteryDead: false, batteryTime: 0,
  spawn: { pos: new THREE.Vector3(), yaw: 0 },
  lastThrottleCmd: -1,

  /* parametry zvoleného dronu (hangár) */
  get spec() { return DRONES[Settings.droneType] || DRONES.kamikaze; },

  _dq: new THREE.Quaternion(),
  _q: new THREE.Quaternion(),
  _up: new THREE.Vector3(),
  _acc: new THREE.Vector3(),
  _fwd: new THREE.Vector3(),

  reset(x, y, z, yaw) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.quat.setFromAxisAngle(UP, yaw);
    this.rates.set(0, 0, 0);
    this.armed = false; this.crashed = false;
    this.liftedOff = false; this.holdOnPad = true;
    this.hp = this.spec.hp;
    this.orbit.active = false;
    this.throttleOut = 0;
    this.battery = 1; this.batteryDead = false; this.batteryTime = 0;
    this.spawn.pos.copy(this.pos); this.spawn.yaw = yaw;
    Input.resetThrottle();
  },

  arm() {
    if (this.crashed || this.armed) return false;
    // bezpečnost: v acro režimu nesmí být plyn nahoru
    if (Settings.mode === 'acro' && Input.state.throttle > 0.15) {
      AudioSys.beepError();
      return false;
    }
    this.armed = true;
    AudioSys.beepArm();
    return true;
  },
  disarm() { if (!this.armed) return; this.armed = false; this.throttleOut = 0; this.orbit.active = false; AudioSys.beepDisarm(); },

  /* orbit autopilot — započne kroužit kolem bodu ~90 m před dronem */
  toggleOrbit() {
    const o = this.orbit;
    if (o.active) { o.active = false; return false; }
    if (this.crashed || this.holdOnPad || !this.spec.orbit) return false;
    const f = this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
    const fl = Math.hypot(f.x, f.z) || 1; f.x /= fl; f.z /= fl; f.y = 0;
    const agl = Math.max(30, this.pos.y - World.groundHeight(this.pos.x, this.pos.z));
    const d = U.clamp(agl * 0.9, 60, 240);
    o.cx = this.pos.x + f.x * d; o.cz = this.pos.z + f.z * d;
    o.alt = this.pos.y;
    o.r = Math.max(45, d * 0.55);
    const cross = (this.pos.x - o.cx) * this.vel.z - (this.pos.z - o.cz) * this.vel.x;
    o.dir = cross >= 0 ? 1 : -1;
    o.active = true;
    return true;
  },

  forward(out) { return out.set(0, 0, -1).applyQuaternion(this.quat); },
  heading() {
    const f = this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
    return Math.atan2(f.x, -f.z); // 0 = sever (-Z), kladem na východ
  },

  update(dt, inp) {
    const S = Settings;
    const spec = this.spec;
    const MT = S.maxThrust * spec.thrustMul;   // efektivní max tah dle typu dronu

    /* baterie (výdrž dle typu: kamikaze ~5 min hover, recon ~12 min, bomber ~8 min) */
    if (this.armed && !this.batteryDead) {
      const drain = (0.002 + (this.throttleOut / MT) * 0.0055) / spec.battMul;
      this.battery = Math.max(0, this.battery - drain * dt);
      this.batteryTime += dt;
      if (this.battery <= 0) this.batteryDead = true; // motory zhasnou
    }

    if (!this.armed || this.crashed) {
      this.throttleOut = Math.max(0, this.throttleOut - Settings.maxThrust * dt);
      if (this.crashed) return;
      if (this.holdOnPad) {
        this.pos.copy(this.spawn.pos);
        this.quat.setFromAxisAngle(UP, this.spawn.yaw);
        this.vel.set(0, 0, 0);
        return;
      }
      /* disarm ve vzduchu = volný pád (motory dobíhají na nulu, bez řízení) */
      this.rates.multiplyScalar(Math.max(0, 1 - 0.4 * dt));
      const h = dt * 0.5;
      this._dq.set(this.rates.x * h, this.rates.y * h, this.rates.z * h, 1).normalize();
      this.quat.multiply(this._dq).normalize();
      const acc = this._acc.set(0, -9.81, 0);
      acc.addScaledVector(this._up.set(0, 1, 0).applyQuaternion(this.quat), this.throttleOut);
      const sp = this.vel.length();
      acc.addScaledVector(this.vel, -(0.05 + 0.014 * sp));
      this.vel.addScaledVector(acc, dt);
      this.pos.addScaledVector(this.vel, dt);
      return;
    }
    if (this.batteryDead) { this.armed = false; this.throttleOut = 0; return; }

    const expo = x => x * (1 - S.expo) + x * x * x * S.expo;
    let cR = expo(inp.roll), cP = expo(inp.pitch), cY = expo(inp.yaw);
    const thrRaw = inp.throttle; // -1..1 (střed = hover v angle režimu)
    this.lastThrottleCmd = thrRaw;

    /* ---- orbit autopilot: syntetizované páčky (kroužení kolem bodu) ---- */
    let orbitCtl = false, orbitVy = 0;
    const o = this.orbit;
    if (o.active && spec.orbit && !this.holdOnPad) {
      orbitCtl = true;
      const dx = this.pos.x - o.cx, dz = this.pos.z - o.cz;
      let rr = Math.hypot(dx, dz); if (rr < 1) rr = 1;
      const ix = dx / rr, iz = dz / rr;            // jednotka od středu ven
      const tx = -iz * o.dir, tz = ix * o.dir;     // tečnový směr kroužení
      const rErr = U.clamp((o.r - rr) * 0.22, -3, 3);   // korekce rádiusu
      const dvx = tx * o.speed + ix * rErr, dvz = tz * o.speed + iz * rErr;
      const ex = dvx - this.vel.x, ez = dvz - this.vel.z;
      const psi = this.heading();
      const sn = Math.sin(psi), cs = Math.cos(psi);
      const fComp = ex * sn - ez * cs;   // chyba ve směru letu
      const rComp = ex * cs + ez * sn;   // chyba doprava
      cP = U.clamp(-fComp * 0.055, -0.85, 0.85);
      cR = U.clamp(rComp * 0.055, -0.85, 0.85);
      cY = 0;
      orbitVy = U.clamp((o.alt - this.pos.y) * 0.4, -4, 3.5);
      /* výrazný zásah do páček = pilot převezme řízení */
      if (Math.abs(inp.roll) > 0.92 || Math.abs(inp.pitch) > 0.92) o.active = false;
    }

    /* cílové otáčky */
    const tw = this._tw || (this._tw = new THREE.Vector3());
    tw.set(0, 0, 0);
    if (S.mode === 'acro' && !orbitCtl) {
      tw.x = cP * S.rates * DEG;
      tw.z = -cR * S.rates * DEG;
      tw.y = -cY * S.yawRate * DEG;
    } else {
      /* angle: držení vodorovné úrovně přes chybový kvaternion */
      const fwd = this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
      const psi = Math.atan2(-fwd.x, -fwd.z);
      const maxA = S.angleMax * DEG;
      const qt = this._q.setFromAxisAngle(UP, psi)
        .multiply(new THREE.Quaternion().setFromAxisAngle(XAXIS, cP * maxA))
        .multiply(new THREE.Quaternion().setFromAxisAngle(ZAXIS, -cR * maxA));
      const qInv = this.quat.clone().invert();
      const qe = qt.multiply(qInv);            // world-frame korekce
      if (qe.w < 0) qe.set(-qe.x, -qe.y, -qe.z, -qe.w);
      const ang = 2 * Math.acos(U.clamp(qe.w, -1, 1));
      if (ang > 1e-4) {
        const s = Math.sin(ang / 2);
        const wWorld = this._ww || (this._ww = new THREE.Vector3());
        wWorld.set(qe.x / s, qe.y / s, qe.z / s).multiplyScalar(ang * S.levelGain);
        wWorld.applyQuaternion(qInv);          // do tělesné soustavy
        tw.copy(wWorld);
        const lim = S.rates * DEG;
        tw.x = U.clamp(tw.x, -lim, lim); tw.z = U.clamp(tw.z, -lim, lim);
      }
      tw.y -= cY * S.yawRate * DEG;
    }
    /* větší drony se otáčí pomaleji */
    const RM = spec.ratesMul;
    tw.x *= RM; tw.y *= RM; tw.z *= RM;

    /* P-regulátor otáček */
    const g = Math.min(1, S.rateGain * dt);
    this.rates.x += (tw.x - this.rates.x) * g;
    this.rates.y += (tw.y - this.rates.y) * g;
    this.rates.z += (tw.z - this.rates.z) * g;

    /* integrace orientace */
    const h = dt * 0.5;
    this._dq.set(this.rates.x * h, this.rates.y * h, this.rates.z * h, 1).normalize();
    this.quat.multiply(this._dq).normalize();

    /* tah */
    const up = this._up.set(0, 1, 0).applyQuaternion(this.quat);
    let thrust;
    if (S.mode === 'acro' && !orbitCtl) {
      thrust = U.clamp((thrRaw + 1) / 2, 0, 1) * MT;
    } else {
      const targetVy = orbitCtl ? orbitVy : thrRaw * (thrRaw < 0 ? 10 : 6.5);  // cíl stoupavosti m/s (sestup rychlejší — ponor)
      const aNeed = (targetVy - this.vel.y) * 2.6;
      thrust = (9.81 + aNeed) / Math.max(up.y, 0.35);
      thrust = U.clamp(thrust, 0, MT);
    }
    this.throttleOut += (thrust - this.throttleOut) * Math.min(1, 10 * dt);

    /* na startovní ploše držíme dron, dokud nepřidá plyn */
    if (this.holdOnPad) {
      if (this.throttleOut > 9.5) { this.holdOnPad = false; this.liftedOff = true; }
      else {
        this.vel.set(0, 0, 0);
        this.pos.copy(this.spawn.pos);
        this.quat.setFromAxisAngle(UP, this.spawn.yaw);
        return;
      }
    }

    /* síly: gravitace + tah + odpor */
    const acc = this._acc.set(0, -9.81, 0);
    acc.addScaledVector(up, this.throttleOut);
    const sp = this.vel.length();
    acc.addScaledVector(this.vel, -(0.05 + 0.014 * sp));
    this.vel.addScaledVector(acc, dt);
    this.pos.addScaledVector(this.vel, dt);
  },
};
