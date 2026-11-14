/* =====================================================
   FPV KAMIKAZE — pěšák (FPS)
   Pohyb po zemi, puška + raketomet, sbírání dronů z beden.
   Ovládání: WASD + myš (pointer lock), LMB = palba,
             RMB = raketa, 1/2 = zbraň, R = přebít,
             E = vzít dron z bedny, G = vypustit dron, Space = skok.
   ===================================================== */
'use strict';

const Player = {
  pos: new THREE.Vector3(),
  vel: new THREE.Vector3(),
  yaw: 0, pitch: 0,
  eye: 1.72, bob: 0, bobY: 0,
  onGround: false,
  maxHp: 100, hp: 100,
  weapon: 'rifle',            // 'rifle' | 'rocket'
  weaponModel: null,
  _rifleModel: null,
  _rocketModel: null,
  weaponBobPhase: 0,
  weaponRecoil: 0,
  weaponMuzzleT: 0,
  _muzzleFlash: null,
  rifleMag: 30, rifleMagMax: 30, rifleReserve: 240,
  rockets: 5, rocketsMax: 5,
  fireCd: 0, reloadT: 0, reloadDur: 1.7,
  sinceHit: 99,
  dead: false, deadT: 0,
  carried: null,              // typ dronu v ruce ('kamikaze' | 'recon' | 'bomber')
  inv: [],                    // drony v batohu (max 3)
  invMax: 3,
  sel: 0,                     // vybraný dron
  crate: null,                // nejbližší bedna k sebrání
  spawn: { x: 2, z: 640 },
  hitT: 0,                    // hitmarker pro HUD
  _mouse: false,
  _mx: 0, _my: 0, _mouseSeen: false,
  _hintShown: false,
  _v: new THREE.Vector3(),
  _v2: new THREE.Vector3(),
  _up: new THREE.Vector3(0, 1, 0),
  _boundsT: 0,

  init() {
    const el = () => G.renderer.domElement;
    const lock = () => {
      try {
        const p = el().requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* některá vložená prostředí zámek kurzoru nepodporují */ }
    };
    const locked = () => document.pointerLockElement === el();
    el().addEventListener('click', () => {
      if (G.mode !== 'soldier' || G.state !== 'fly' || this.dead) return;
      if (!locked()) lock();
    });
    /* rozhlížení myší — se zámkem kurzoru i bez něj (záložní režim) */
    document.addEventListener('mousemove', e => {
      if (G.mode !== 'soldier' || G.state !== 'fly' || this.dead) return;
      this._mx = e.clientX; this._my = e.clientY; this._mouseSeen = true;
      const sens = locked() ? 0.0021 : 0.0018;
      this.yaw -= (e.movementX || 0) * sens;
      this.pitch = U.clamp(this.pitch - (e.movementY || 0) * sens, -1.45, 1.45);
    });
    window.addEventListener('mousedown', e => {
      if (G.mode !== 'soldier' || G.state !== 'fly' || this.dead) return;
      if (!locked() && e.target !== el()) return;   // klik mimo herní plochu (UI)
      if (e.button === 0) this._mouse = true;
      if (e.button === 2) this.fireRocket();
    });
    window.addEventListener('mouseup', () => { this._mouse = false; });
    window.addEventListener('contextmenu', e => {
      if (G.mode === 'soldier') e.preventDefault();
    });
  },

  reset(x, z) {
    this.pos.set(x, World.groundHeight(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = 0; this.pitch = 0;   // hledí na jih (k základně)
    this.hp = this.maxHp;
    this.dead = false; this.deadT = 0;
    this.weapon = 'rifle';
    this.rifleMag = this.rifleMagMax;
    this.rifleReserve = 240;
    this.rockets = this.rocketsMax;
    this.fireCd = 0; this.reloadT = 0;
    this.sinceHit = 99;
    this.crate = null;
    this.bob = 0; this.bobY = 0;
    this.hitT = 0;
    this._mouse = false;
    this._mouseSeen = false;
    this.weaponRecoil = 0;
    this.weaponBobPhase = 0;
    this.weaponMuzzleT = 0;
    this.syncCarried();
  },

  eyePos(out) {
    return out.set(this.pos.x, this.pos.y + this.eye + this.bobY, this.pos.z);
  },

  viewDir(out) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, sp, -Math.cos(this.yaw) * cp);
  },

  /* =================  UPDATE  ================= */
  update(dt) {
    if (this.fireCd > 0) this.fireCd -= dt;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.finishReload();
    }
    this.sinceHit += dt;

    if (this.dead) {
      this.deadT -= dt;
      if (this.deadT <= 0) this.respawn();
      return;
    }

    /* ---- rozhlížení (klávesnice / gamepad) ---- */
    let lookX = 0, lookY = 0;
    if (Input.state.source === 'pad') {
      const dz = v => (Math.abs(v) < 0.12 ? 0 : v);
      lookX = dz(Input.state.roll);
      lookY = -dz(Input.state.pitch);
    } else {
      lookX = Input.kb.roll;
      lookY = -Input.kb.pitch;
    }
    this.yaw -= lookX * 2.1 * dt;
    this.pitch = U.clamp(this.pitch + lookY * 1.5 * dt, -1.45, 1.45);

    /* ---- bez zámku kurzoru: plynulé otáčení u okrajů obrazovky ---- */
    if (this._mouseSeen && document.pointerLockElement !== G.renderer.domElement) {
      const edge = 56;
      const w = window.innerWidth, h = window.innerHeight;
      let ex = 0, ey = 0;
      if (this._mx < edge) ex = -(edge - this._mx) / edge;
      else if (this._mx > w - edge) ex = (this._mx - (w - edge)) / edge;
      if (this._my < edge) ey = -(edge - this._my) / edge;
      else if (this._my > h - edge) ey = (this._my - (h - edge)) / edge;
      if (ex) this.yaw -= ex * 1.7 * dt;
      if (ey) this.pitch = U.clamp(this.pitch - ey * 1.3 * dt, -1.45, 1.45);
    }

    /* ---- pohyb ---- */
    let fwdIn = 0, strIn = 0;
    if (Input.keys['KeyW']) fwdIn += 1;
    if (Input.keys['KeyS']) fwdIn -= 1;
    if (Input.keys['KeyD']) strIn += 1;
    if (Input.keys['KeyA']) strIn -= 1;
    if (Input.state.source === 'pad') {
      const dz = v => (Math.abs(v) < 0.12 ? 0 : v);
      fwdIn += -dz(Input.state.throttle);
      strIn += dz(Input.state.yaw);
    }
    fwdIn = U.clamp(fwdIn, -1, 1);
    strIn = U.clamp(strIn, -1, 1);

    const sprint = !!(Input.keys['ShiftLeft'] || Input.keys['ShiftRight']);
    const spd = sprint ? 8.2 : 5.2;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let tx = -sy * fwdIn + cy * strIn;
    let tz = -cy * fwdIn - sy * strIn;
    const l = Math.hypot(tx, tz);
    if (l > 1) { tx /= l; tz /= l; }
    const k = 1 - Math.exp(-13 * dt);
    this.vel.x += (tx * spd - this.vel.x) * k;
    this.vel.z += (tz * spd - this.vel.z) * k;

    /* skok + gravitace */
    if (this.onGround && Input.keys['Space']) { this.vel.y = 5.4; this.onGround = false; }
    this.vel.y -= 20 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    /* země */
    const gy = World.groundHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      this.pos.y = gy;
      if (this.vel.y < 0) this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y > gy + 0.05) {
      this.onGround = false;
    }

    /* kolize s budovami / bednami / živými vojáky */
    for (const c of World.colliders) {
      if (c.soldier && !c.soldier.alive) continue;
      const rr = c.r + 0.34;
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      if (dx * dx + dz * dz > rr * rr) continue;
      if (this.pos.y > c.y + c.h - 0.05 || this.pos.y + 1.7 < c.y) continue;
      const d = Math.sqrt(dx * dx + dz * dz) || 0.001;
      this.pos.x = c.x + dx / d * rr;
      this.pos.z = c.z + dz / d * rr;
    }

    /* kolize se zákopy (stěny = úsečky) */
    if (World.walls.length) {
      for (const w of World.walls) {
        if (this.pos.y > w.y1 + 0.05) continue;
        const dx = w.bx - w.ax, dz = w.bz - w.az;
        const l2 = dx * dx + dz * dz || 1e-6;
        let t = ((this.pos.x - w.ax) * dx + (this.pos.z - w.az) * dz) / l2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const cx = w.ax + dx * t, cz = w.az + dz * t;
        const ox = this.pos.x - cx, oz = this.pos.z - cz;
        const rr = w.r + 0.34;
        const d2 = ox * ox + oz * oz;
        if (d2 > rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-4;
        this.pos.x = cx + ox / d * rr;
        this.pos.z = cz + oz / d * rr;
      }
    }

    /* hranice bojiště */
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > 1110) {
      this.pos.x *= 1110 / rr;
      this.pos.z *= 1110 / rr;
      if (performance.now() - this._boundsT > 2500) {
        this._boundsT = performance.now();
        G.toast('OPUSTIL JSI BOJIŠTĚ', '#ffb84d');
      }
    }

    /* head bob */
    const hspd = Math.hypot(this.vel.x, this.vel.z);
    this.bob += hspd * dt * 2.2;
    const bobAmp = this.onGround ? U.clamp(hspd / 8, 0, 1) * 0.035 : 0;
    this.bobY = Math.sin(this.bob) * bobAmp;

    /* regenerace */
    if (this.sinceHit > 7 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + 5 * dt);
    }

    /* nejbližší bedna */
    this.crate = null;
    if (this.inv.length < this.invMax) {
      let best = null, bd = 2.8;
      for (const c of World.crates) {
        if (!c.active) continue;
        const d = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z);
        if (d < bd && Math.abs(c.pos.y - this.pos.y) < 3) { bd = d; best = c; }
      }
      this.crate = best;
    }

    /* palba puškou (držená spoušť) */
    if (this.weapon === 'rifle' && (this._mouse || Input.padFire)) this.fire();
  },

  /* =================  ZBRANĚ  ================= */
  fire() {
    if (this.dead || this.fireCd > 0 || this.reloadT > 0) return;
    if (this.weapon === 'rifle') this.fireRifle();
    else this.fireRocket();
  },

  fireRifle() {
    if (this.rifleMag <= 0) { this.reload(); return; }
    this.rifleMag--;
    this.fireCd = 0.085;
    this.pitch = U.clamp(this.pitch + 0.0035, -1.45, 1.45);
    AudioSys.rifle();
    FX.shake(0.12, 0.05);
    this.weaponRecoil = 0.16;
    this.weaponMuzzleT = 0.08;

    const dir = this.viewDir(this._v).clone();
    dir.x += U.rand(-0.006, 0.006);
    dir.y += U.rand(-0.006, 0.006);
    dir.z += U.rand(-0.006, 0.006);
    dir.normalize();
    const o = this.eyePos(this._v2).clone();

    /* střela po krocích — vojáci, cíle, překážky, terén */
    const p = new THREE.Vector3();
    let hitSoldier = null, hitTarget = null;
    for (let t = 1.2; t < 520; t += 2.6) {
      p.copy(o).addScaledVector(dir, t);
      if (p.y < World.groundHeight(p.x, p.z)) break;
      let stop = false;
      for (const s of World.soldiers) {
        if (!s.alive) continue;
        const dx = p.x - s.pos.x, dz = p.z - s.pos.z, dy = p.y - (s.pos.y + 1.1);
        if (dx * dx + dz * dz + dy * dy < 0.42) { hitSoldier = s; stop = true; break; }
      }
      if (!stop) for (const tg of World.targets) {
        if (!tg.alive) continue;
        if (p.distanceToSquared(tg.pos) < tg.hitR * tg.hitR) { hitTarget = tg; stop = true; break; }
      }
      if (!stop) for (const c of World.colliders) {
        if (c.soldier || c.mover || (c.t && !c.t.alive)) continue;
        if (p.y < c.y || p.y > c.y + c.h) continue;
        const dx = p.x - c.x, dz = p.z - c.z;
        if (dx * dx + dz * dz < c.r * c.r * 0.72) { stop = true; break; }
      }
      if (stop) break;
    }
    const end = p.clone();
    /* úsťová záře */
    FX.add.spawn({
      pos: o.clone().addScaledVector(dir, 0.5), vel: new THREE.Vector3(0, 0.2, 0),
      size: 0.5, life: 0.05, col: [1, 0.85, 0.5], alpha: 1,
    });
    FX.tracer(o.clone().addScaledVector(dir, 0.6), end, 900);

    if (hitSoldier) {
      World.killSoldier(hitSoldier);
      G.stats.score += 20;
      this.hitT = 0.2;
      AudioSys.hitMark();
      FX.add.spawn({
        pos: new THREE.Vector3(hitSoldier.pos.x, hitSoldier.pos.y + 1.1, hitSoldier.pos.z),
        vel: new THREE.Vector3(U.rand(-1, 1), U.rand(0.5, 2), U.rand(-1, 1)),
        size: 0.5, life: 0.3, col: [0.85, 0.15, 0.1], alpha: 0.9, grav: 9, drag: 1,
      });
    } else if (hitTarget) {
      FX.flash(end, 0.6);
      AudioSys.ricochet();
    } else {
      FX.smoke.spawn({
        pos: end, vel: new THREE.Vector3(0, 0.6, 0),
        size: 0.5, life: 0.5, col: [0.62, 0.58, 0.48], alpha: 0.55, grav: -1, drag: 2,
      });
    }
  },

  fireRocket() {
    if (this.dead || this.fireCd > 0) return;
    if (this.rockets <= 0) { G.toast('RAKETY VYČERPÁNY', '#ffb84d'); AudioSys.beepError(); return; }
    this.fireCd = 1.0;
    this.rockets--;
    const dir = this.viewDir(this._v).clone();
    const origin = this.eyePos(this._v2).addScaledVector(dir, 0.9).clone();
    if (G.spawnRocket) G.spawnRocket(origin, dir);
    AudioSys.rocket();
    FX.shake(0.6, 0.2);
    this.weaponRecoil = 0.28;
    this.weaponMuzzleT = 0.1;
    this.pitch = U.clamp(this.pitch + 0.012, -1.45, 1.45);
  },

  reload() {
    if (this.reloadT > 0 || this.rifleMag >= this.rifleMagMax || this.rifleReserve <= 0) return;
    this.reloadT = this.reloadDur;
    AudioSys.reload();
  },

  finishReload() {
    const need = this.rifleMagMax - this.rifleMag;
    const take = Math.min(need, this.rifleReserve);
    this.rifleMag += take;
    this.rifleReserve -= take;
  },

  switchWeapon(w) {
    if (this.weapon === w) return;
    this.weapon = w;
    this.fireCd = Math.max(this.fireCd, 0.25);
    AudioSys.click();
    G.toast(w === 'rifle' ? 'PUŠKA' : 'RAKETOMET', '#9fe8ff');
    if (this._rifleModel && this._rocketModel) {
      this._rifleModel.visible = (w === 'rifle') && !this.dead && G.mode === 'soldier';
      this._rocketModel.visible = (w === 'rocket') && !this.dead && G.mode === 'soldier';
      this.weaponSwitchT = 0.22;
    }
  },

  /* =================  3D MODELY ZBRANÍ  ================= */
  _mat(c, r = 0.85, m = 0.2) { return new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: r, metalness: m }); },
  _box(g, w, h, d, c, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._mat(c));
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  },
  _cyl(g, r, h, c, x, y, z, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), this._mat(c));
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; g.add(m); return m;
  },

  _makeRifle() {
    const g = new THREE.Group();
    const metal = 0x3a3a3a, wood = 0x6b4a2b, dark = 0x222222, brass = 0x8a7a3a;
    /* pažba */
    this._box(g, 0.055, 0.045, 0.20, wood, 0, -0.022, 0.19);
    /* tělo */
    this._box(g, 0.048, 0.055, 0.16, metal, 0, 0.012, -0.01);
    /* hlaveň */
    this._cyl(g, 0.011, 0.34, metal, 0, 0.022, -0.29, Math.PI / 2);
    /* závěr */
    this._box(g, 0.04, 0.04, 0.06, dark, 0, 0.035, -0.06);
    /* zásobník */
    this._box(g, 0.036, 0.11, 0.055, dark, 0, -0.075, -0.01);
    /* rukojeť */
    this._box(g, 0.034, 0.095, 0.038, wood, 0, -0.09, 0.065);
    /* muška */
    this._box(g, 0.008, 0.028, 0.008, dark, 0, 0.042, -0.44);
    /* hledí */
    this._box(g, 0.012, 0.022, 0.012, dark, 0, 0.048, -0.09);
    /* objímka */
    this._box(g, 0.02, 0.02, 0.03, brass, 0, 0.022, -0.16);
    /* úsťový plamen (skrytý) */
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.9 }));
    flash.position.set(0, 0.022, -0.47); flash.visible = false; g.add(flash);
    g.userData.flash = flash;
    g.userData.muzzle = new THREE.Vector3(0, 0.022, -0.47);
    return g;
  },

  _makeRocket() {
    const g = new THREE.Group();
    const metal = 0x4a4a4a, dark = 0x2a2a2a, rocket = 0x8a3a2a, olive = 0x5f6b4a;
    /* tubus */
    this._cyl(g, 0.048, 0.52, olive, 0, 0.02, -0.12, Math.PI / 2);
    /* rukojeť */
    this._box(g, 0.038, 0.12, 0.05, dark, 0, -0.085, 0.06);
    /* opěrka ramene */
    this._box(g, 0.06, 0.04, 0.13, dark, 0, 0.0, 0.22);
    /* hledí */
    this._box(g, 0.012, 0.025, 0.012, dark, 0, 0.065, -0.05);
    /* raketa v tubusu */
    this._cyl(g, 0.038, 0.16, rocket, 0, 0.02, -0.46, Math.PI / 2);
    /* křidélka */
    for (const s of [-1, 1]) {
      this._box(g, 0.006, 0.06, 0.04, rocket, s * 0.045, 0.02, -0.52);
    }
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffb84d, transparent: true, opacity: 0.9 }));
    flash.position.set(0, 0.02, -0.56); flash.visible = false; g.add(flash);
    g.userData.flash = flash;
    g.userData.muzzle = new THREE.Vector3(0, 0.02, -0.56);
    return g;
  },

  _initWeaponModels() {
    /* odstranit staré */
    if (this._rifleModel) { G.camera.remove(this._rifleModel); this._rifleModel = null; }
    if (this._rocketModel) { G.camera.remove(this._rocketModel); this._rocketModel = null; }
    this._rifleModel = this._makeRifle();
    this._rocketModel = this._makeRocket();
    const pos = new THREE.Vector3(0.22, -0.18, -0.35);
    this._rifleModel.position.copy(pos);
    this._rocketModel.position.copy(pos);
    G.camera.add(this._rifleModel);
    G.camera.add(this._rocketModel);
    this._rifleModel.visible = (this.weapon === 'rifle') && !this.dead;
    this._rocketModel.visible = (this.weapon === 'rocket') && !this.dead;
    this.weaponBobPhase = 0;
    this.weaponRecoil = 0;
    this.weaponMuzzleT = 0;
  },

  _updateWeaponModel(dt) {
    if (!this._rifleModel || !this._rocketModel) return;
    const rifleV = (this.weapon === 'rifle') && !this.dead && G.mode === 'soldier';
    const rocketV = (this.weapon === 'rocket') && !this.dead && G.mode === 'soldier';
    this._rifleModel.visible = rifleV;
    this._rocketModel.visible = rocketV;
    const m = rifleV ? this._rifleModel : (rocketV ? this._rocketModel : null);
    if (!m) return;
    /* bob */
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.weaponBobPhase += speed * dt * 6.5;
    const bobAmp = Math.min(1, speed / 4.5);
    const bobY = Math.sin(this.weaponBobPhase) * 0.007 * bobAmp;
    const bobX = Math.cos(this.weaponBobPhase * 0.5) * 0.004 * bobAmp;
    /* recoil */
    this.weaponRecoil = Math.max(0, this.weaponRecoil - dt * 5.5);
    const r = this.weaponRecoil;
    m.position.set(0.22 + bobX, -0.18 + bobY - r * 0.025, -0.35 + r * 0.07);
    m.rotation.x = -r * 0.18;
    m.rotation.z = r * 0.04 * (this.weapon === 'rifle' ? 1 : -1);
    /* úsťový plamen */
    const flash = m.userData.flash;
    if (flash) {
      if (this.weaponMuzzleT > 0) {
        this.weaponMuzzleT = Math.max(0, this.weaponMuzzleT - dt);
        flash.visible = true;
        const s = 0.6 + (1 - this.weaponMuzzleT / 0.08) * 0.9;
        flash.scale.set(s, s, s);
        flash.material.opacity = 0.9 * (this.weaponMuzzleT / 0.08);
      } else {
        flash.visible = false;
      }
    }
  },

  /* =================  BEDNY  ================= */
  syncCarried() {
    if (this.sel >= this.inv.length) this.sel = Math.max(0, this.inv.length - 1);
    if (this.sel < 0) this.sel = 0;
    this.carried = this.inv.length ? this.inv[this.sel] : null;
  },

  addDrone(type) {
    if (this.inv.length >= this.invMax) return false;
    this.inv.push(type);
    this.sel = this.inv.length - 1;
    this.syncCarried();
    return true;
  },

  cycleDrone(dir) {
    if (this.inv.length < 2) {
      if (this.inv.length === 1) G.toast(`NESEŠ JEN ${DRONES[this.inv[0]].label}`, '#9fe8ff');
      return false;
    }
    this.sel = (this.sel + (dir < 0 ? -1 : 1) + this.inv.length) % this.inv.length;
    this.syncCarried();
    AudioSys.click();
    G.toast(`${this.sel + 1}/${this.inv.length} — ${DRONES[this.carried].label}`, '#9fe8ff');
    return true;
  },

  takeCrate() {
    if (this.dead || !this.crate) return false;
    if (this.inv.length >= this.invMax) {
      G.toast(`NEMÁŠ MÍSTO — ${this.invMax} DRONY V BATOHU`, '#ffb84d');
      AudioSys.beepError();
      return false;
    }
    const c = this.crate;
    c.active = false;
    c.t = c.respawn || 75;    // respawn (zákopy 10 s, ostatní 75 s)
    c.g.visible = false;
    this.addDrone(c.type);
    AudioSys.pickup();
    G.toast(`VZAL JSI DRON: ${DRONES[c.type].label} (${this.inv.length}/${this.invMax}) — Q = VÝBĚR, G = VZLET`, '#8cf7a0');
    this.crate = null;
    return true;
  },

  /* =================  ZRANĚNÍ  ================= */
  damage(n) {
    if (this.dead || G.state !== 'fly') return;
    this.hp = Math.max(0, this.hp - n);
    this.sinceHit = 0;
    G.dmgFlash(0.55);
    FX.shake(0.35, 0.25);
    AudioSys.hurt();
    G.hurtT = 0.35;
    if (this.hp <= 0) this.die();
  },

  die() {
    this.dead = true;
    this.deadT = 3.2;
    this._mouse = false;
    AudioSys.hurt();
    G.onPlayerDeath();
  },

  respawn() {
    this.reset(this.spawn.x, this.spawn.z);
    G.onPlayerRespawn();
  },
};
