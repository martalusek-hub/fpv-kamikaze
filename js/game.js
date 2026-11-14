/* =====================================================
   FPV KAMIKAZE — hlavní hra
   ===================================================== */
'use strict';

const G = {
  renderer: null, scene: null, camera: null,
  state: 'menu', mode: 'soldier', curCam: 'fpv',
  stats: { score: 0, destroyed: 0, total: 0, launches: 0, hits: 0, time: 0 },
  staticLevel: 0, crashStatic: false,
  lock: null, crashTimer: 0, menuT: 0, winPending: false,
  droneModel: null, props: [], droneModels: {}, propsByType: {},
  bombs: [], bombsLeft: 0, thermalOn: false, _spotT: 0,
  rockets: [], hurtT: 0,
  crashPos: new THREE.Vector3(),
  scheduled: [], _schedT: 0,
  _last: 0, _warned: { bat20: false, bat0: false, bounds: 0 },
  settingsOpen: false, _helpFrom: 'menu',
  _qt: new THREE.Quaternion(), _v1: new THREE.Vector3(), _v2: new THREE.Vector3(), _v3: new THREE.Vector3(),
  _homeV: new THREE.Vector3(),
  _padSig: '', _staticJitT: 0,
  _settingsFrom: 'menu',

  /* =================  INIT  ================= */
  init() {
    Settings.load();
    const el = id => document.getElementById(id);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = Settings.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el('app').appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xd8bd96, 0.0006);
    this.camera = new THREE.PerspectiveCamera(Settings.fov, window.innerWidth / window.innerHeight, 0.1, 6000);

    World.build(this.scene);
    FX.init(this.scene);
    World.addAmbientFires();
    /* pěchota ohlašuje zásahy dronu (s letovým zpožděním projektilu) */
    World.onDroneHit = (delay) => this.schedule(delay, () => this.damageDrone());
    World.onPlayerHit = (delay, dmg) => this.schedule(delay, () => Player.damage(dmg));
    HUD.init(el('hud'));
    HUD.prebakeMinimap();

    this.buildDroneModel();
    this._homeV.set(World.home.x, World.home.y, World.home.z);
    Drone.reset(World.home.x, World.home.y + 0.45, World.home.z, 0);

    Input.init();
    Player.init();
    this.makeStaticTile();
    this.bindUI(el);

    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('blur', () => { if (this.state === 'fly') this.pause(); });
    document.addEventListener('pointerdown', () => AudioSys.ensure());
    document.addEventListener('keydown', () => AudioSys.ensure());

    el('boot').style.display = 'none';
    window.G = this; // debug
    requestAnimationFrame(t => this.loop(t));
  },

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    HUD.resize();
  },

  /* dlaždice šumu pro překryv signálu */
  makeStaticTile() {
    const s = 160, cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c = cv.getContext('2d');
    const img = c.createImageData(s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    document.getElementById('static').style.backgroundImage = `url(${cv.toDataURL()})`;
  },

  /* =================  MODEL DRONU (TPS) — podle typu z hangáru  ================= */
  buildDroneModel() {
    const mat = c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.7 });
    const bx = (w, h, d, c) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    for (const key in DRONES) {
      const spec = DRONES[key];
      const g = new THREE.Group();
      const scale = key === 'bomber' ? 1.45 : (key === 'recon' ? 0.85 : 1);
      const bodyCol = key === 'recon' ? 0x9aa4ad : (key === 'bomber' ? 0x3b4a3a : 0x22252a);
      const armCol = key === 'bomber' ? 0x2f3b2e : 0x2c3038;
      const plate = bx(0.30, 0.045, 0.36, bodyCol); g.add(plate);
      for (const a of [Math.PI / 4, -Math.PI / 4]) {
        const arm = bx(0.56, 0.03, 0.06, armCol); arm.rotation.y = a; arm.position.y = 0.012; g.add(arm);
      }
      const props = [];
      for (const [mx, mz] of [[0.2, -0.2], [-0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]]) {
        const mot = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.05, 6), mat(0x151517));
        mot.position.set(mx, 0.045, mz); g.add(mot);
        const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.008, 3),
          new THREE.MeshBasicMaterial({ color: 0x666f78, transparent: true, opacity: 0.55 }));
        prop.position.set(mx, 0.08, mz); g.add(prop);
        props.push(prop);
      }
      const cam = bx(0.07, 0.06, 0.06, 0x101114); cam.position.set(0, 0.02, -0.17); cam.rotation.x = 0.3; g.add(cam);
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4), mat(0x888888));
      ant.position.set(0, 0.15, 0.13); ant.rotation.x = -0.4; g.add(ant);
      if (key === 'recon') {
        /* velká gyrostabilizovaná koule kamery pod přídí */
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mat(0x0e1116));
        ball.position.set(0, -0.06, -0.13); g.add(ball);
      }
      if (key === 'bomber') {
        /* dva pumové závěsníky */
        for (const px of [0.09, -0.09]) {
          const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.24, 6), mat(0x1d211f));
          pod.rotation.x = Math.PI / 2; pod.position.set(px, -0.07, 0); g.add(pod);
        }
      }
      g.scale.setScalar(scale);
      g.visible = false;
      this.scene.add(g);
      this.droneModels[key] = g;
      this.propsByType[key] = props;
    }
    this.setDroneModel(Settings.droneType);
  },

  setDroneModel(type) {
    const key = this.droneModels[type] ? type : 'kamikaze';
    if (this.droneModel) this.droneModel.visible = false;
    this.droneModel = this.droneModels[key];
    this.props = this.propsByType[key];
    this.droneModel.visible = (this.curCam === 'tps') && this.state === 'fly' && !Drone.crashed;
  },

  /* =================  SMYČKA  ================= */
  loop(t) {
    requestAnimationFrame(tt => this.loop(tt));
    const dt = U.clamp((t - this._last) / 1000, 0, 0.05);
    this._last = t;
    if (this._schedT === 0) this._schedT = t;
    const now = t;

    Input.update(dt);
    this.runScheduled(now);
    this.checkPadToast();

    switch (this.state) {
      case 'fly': {
        this.stats.time += dt;
        this.processButtons();
        if (this.mode === 'soldier') {
          Player.update(dt);
          Player._updateWeaponModel(dt);
        } else {
          Drone.update(dt, Input.state);
          Player._updateWeaponModel(dt);
          if (!Drone.crashed && !Drone.holdOnPad) this.collide(dt);
          this.updateLock();
          this.checkBattery();
          this.updateSpotting(dt);
        }
        break;
      }
      case 'crash': {
        this.crashTimer -= dt;
        if (this.crashTimer <= 0) this.afterCrash();
        break;
      }
      case 'menu': this.menuT += dt; break;
    }

    /* pumy a rakety ve vzduchu pokračují i během havárie dronu */
    if (this.bombs.length && (this.state === 'fly' || this.state === 'crash')) this.updateBombs(dt);
    if (this.rockets.length && (this.state === 'fly' || this.state === 'crash')) this.updateRockets(dt);
    if (this.hurtT > 0) this.hurtT -= dt;

    World.update(dt, this.mode === 'drone' ? Drone : null, Player);
    FX.update(dt);
    this.updateCamera(dt);
    this.updateAudio();
    this.updateStatic(now);
    if (this.settingsOpen) this.updatePadUI();

    HUD.draw({
      state: this.state, mode: this.mode, player: Player, cam: this.curCam,
      drone: Drone, camera: this.camera,
      stats: this.stats, lock: Settings.assist ? this.lock : null,
      staticLevel: this.staticLevel, hurtT: this.hurtT,
      showMarkers: Settings.markers, showMinimap: Settings.minimap, showSticks: Settings.sticks,
      thermal: this.thermalOn, bombs: this.bombsLeft,
      heading: this.mode === 'drone' ? Drone.heading() : -Player.yaw,
    });
    this.renderer.render(this.scene, this.camera);
  },

  runScheduled(now) {
    for (let i = this.scheduled.length - 1; i >= 0; i--) {
      if (now >= this.scheduled[i].t) { const f = this.scheduled[i].fn; this.scheduled.splice(i, 1); f(); }
    }
  },
  schedule(delay, fn) { this.scheduled.push({ t: performance.now() + delay * 1000, fn }); },

  /* =================  TLAČÍTKA / AKCE  ================= */
  processButtons() {
    if (Input.consume('pause')) { this.pause(); return; }
    if (this.state !== 'fly') return;

    if (this.mode === 'soldier') {
      /* pěšák */
      if (Input.consume('use')) Player.takeCrate();
      if (Input.consume('droneNext')) Player.cycleDrone(1);
      if (Input.consume('dronePrev')) Player.cycleDrone(-1);
      if (Input.consume('launch')) this.launchCarried();
      if (Input.consume('reset')) Player.reload();
      if (Input.consume('w1')) Player.switchWeapon('rifle');
      if (Input.consume('w2')) Player.switchWeapon('rocket');
      if (Input.consume('rocket')) Player.fireRocket();
      /* vyprázdnit hrany, které patří dronu */
      Input.consume('arm'); Input.consume('bomb'); Input.consume('thermal'); Input.consume('orbit');
      if (Input.consume('camera')) {
        /* v režimu pěšáka nic — kamera je vždy první osoba */
      }
    } else {
      /* dron */
      if (Input.consume('arm')) {
        if (Drone.armed) Drone.disarm();
        else if (!Drone.arm()) this.bigMsg('SNÍŽ PLYN PŘED ARM', 1400, true);
      }
      if (Input.consume('reset')) {
        if (!Drone.crashed) { this.toast('DRON ODVOLÁN', '#9fe8ff'); this.returnToSoldier(); }
      }
      if (Input.consume('camera')) {
        this.curCam = this.curCam === 'fpv' ? 'tps' : 'fpv';
        this.droneModel.visible = (this.curCam === 'tps') && this.state === 'fly' && !Drone.crashed;
      }
      if (Input.consume('bomb')) this.dropBomb();
      if (Input.consume('thermal')) this.toggleThermal();
      if (Input.consume('orbit')) this.toggleOrbit();
      /* hrany pěšáka */
      Input.consume('use'); Input.consume('launch'); Input.consume('w1'); Input.consume('w2'); Input.consume('rocket');
      Input.consume('droneNext'); Input.consume('dronePrev');
    }

    /* společné */
    if (Input.consume('minimap')) { Settings.minimap = !Settings.minimap; Settings.save(); this.toast(Settings.minimap ? 'MINIMAPA: ZAP' : 'MINIMAPA: VYP', '#9fe8ff'); }
    if (Input.consume('markers')) { Settings.markers = !Settings.markers; Settings.save(); this.toast(Settings.markers ? 'ZNAČKY CÍLŮ: ZAP' : 'ZNAČKY CÍLŮ: VYP', '#9fe8ff'); }
    if (Input.consume('mute')) { Settings.muted = !Settings.muted; AudioSys.setMuted(Settings.muted); Settings.save(); this.toast(Settings.muted ? 'ZVUK VYP' : 'ZVUK ZAP', '#9fe8ff'); }
    if (Input.consume('help')) { this.showHelp('pause'); this.pause(true); }
  },

  checkBattery() {
    if (!Drone.armed) return;
    if (Drone.battery < 0.2 && !this._warned.bat20) {
      this._warned.bat20 = true;
      this.bigMsg('NÍZKÁ BATERIE', 2200, true);
      AudioSys.beepBattery();
    }
    if (Drone.batteryDead && !this._warned.bat0) {
      this._warned.bat0 = true;
      this.bigMsg('BATERIE VYBITÁ — MOTORY ZASTAVENY', 2600, true);
    }
  },

  /* =================  KOLIZE  ================= */
  collide(dt) {
    const p = Drone.pos;
    /* hranice světa */
    const rr = Math.hypot(p.x, p.z);
    if (rr > 1130) {
      const nx = -p.x / rr, nz = -p.z / rr;
      Drone.vel.x += nx * 26 * dt; Drone.vel.z += nz * 26 * dt;
      if (performance.now() - this._warned.bounds > 2500) {
        this._warned.bounds = performance.now();
        this.toast('HRANICE PŘEDMĚTU', '#ffb84d');
      }
    }
    /* země */
    const gy = World.groundHeight(p.x, p.z);
    if (p.y < gy + 0.16) { this.crash('ZEMĚ', null); return; }
    /* překážky */
    for (const c of World.colliders) {
      if (c.t && !c.t.alive) continue;
      if (c.soldier && !c.soldier.alive) continue;
      const dx = p.x - c.x, dz = p.z - c.z;
      const rr2 = c.r + 0.32;
      if (dx * dx + dz * dz < rr2 * rr2 && p.y < c.y + c.h + 0.12 && p.y > c.y - 1) {
        this.crash(c.t ? c.t.name : 'PŘEKÁŽKA', c.t);
        return;
      }
    }
    /* cíle (velké rádiusy zásahu) */
    for (const t of World.targets) {
      if (!t.alive) continue;
      const dx = p.x - t.pos.x, dz = p.z - t.pos.z, dy = p.y - t.pos.y;
      const r = t.hitR;
      if (dx * dx + dz * dz < r * r && dy > -r * 0.9 && dy < r * 1.7) {
        this.crash(t.name, t);
        return;
      }
    }
  },

  crash(reason, target) {
    if (this.state !== 'fly' || Drone.crashed) return;
    Drone.crashed = true;
    Drone.armed = false;
    Drone.orbit.active = false;
    this.crashPos.copy(Drone.pos);
    this.droneModel.visible = false;
    const armed = target && Drone.spec.warhead;
    FX.explosion(Drone.pos, armed ? 1.15 : 0.6, this.camera.position);
    if (target) {
      if (Drone.spec.warhead) this.destroyTarget(target);
      else this.toast(`NÁLET BEZ NÁLOŽE — ${target.name} ODOLAL`, '#ffb84d');
    }
    /* pěchota zabitá výbuchem (+bonus za přímý nálet na vojáky) */
    const kills = World.killSoldiersNear(Drone.pos, armed ? 16 : 10);
    if (kills > 0) {
      this.stats.score += kills * 20;
      this.toast(`PECHOTA ×${kills}  +${kills * 20}`, '#ffb84d');
    }
    this.state = 'crash';
    this.crashTimer = 2.1;
    this.crashStatic = true;
    this.bigMsg('SIGNÁL ZTRACEN', 2000, true);
    if (!target) this.toast(`ZTRÁTA DRONU — ${reason}`, '#ff7b6b');
  },

  /* zásah dronu palbou pěchoty */
  damageDrone() {
    if (this.state !== 'fly' || Drone.crashed) return;
    Drone.hp--;
    if (Drone.hp <= 0) {
      this.toast('DRON SESTŘELEN PALBOU', '#ff7b6b');
      this.crash('SESTŘELEN', null);
      return;
    }
    this.toast(`ZÁSAH — TRUP ${Drone.hp}/${Drone.spec.hp}`, '#ff7b6b');
    AudioSys.beepError();
    FX.shake(0.9, 0.3);
    FX.add.spawn({
      pos: Drone.pos.clone(), vel: new THREE.Vector3(U.rand(-2, 2), U.rand(-1, 2), U.rand(-2, 2)),
      size: 0.4, life: 0.25, col: [1, 0.6, 0.2], alpha: 1, grav: 10, drag: 1,
    });
    this.dmgFlash(0.5);
  },

  /* červený záblesk poškození (pěšák i dron) */
  dmgFlash(alpha = 0.5) {
    const d = document.getElementById('dmg');
    if (!d) return;
    d.style.transition = 'none'; d.style.opacity = String(alpha);
    requestAnimationFrame(() => { d.style.transition = 'opacity 0.5s'; d.style.opacity = '0'; });
  },

  /* =================  PUMY (BOMBARDÉR)  ================= */
  clearBombs() {
    for (const b of this.bombs) this.scene.remove(b.mesh);
    this.bombs.length = 0;
  },
  dropBomb() {
    const spec = Drone.spec;
    if (!spec.bombs) { this.toast('TENTO DRON NENOSÍ PUMY', '#ffb84d'); return; }
    if (Drone.crashed || !Drone.armed || Drone.holdOnPad) return;
    if (this.bombsLeft <= 0) { this.toast('PUMY VYČERPÁNY', '#ffb84d'); AudioSys.beepError(); return; }
    this.bombsLeft--;
    const mat = new THREE.MeshStandardMaterial({ color: 0x23262a, flatShading: true, roughness: 0.6 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.30, 6), mat);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.11, 6), mat);
    nose.position.y = 0.2; nose.rotation.x = Math.PI; g.add(body); g.add(nose);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.14), mat);
    fin.position.y = -0.18; g.add(fin);
    g.position.copy(Drone.pos); g.position.y -= 0.25;
    this.scene.add(g);
    const b = { mesh: g, pos: g.position.clone(), vel: Drone.vel.clone(), t: 0 };
    b.vel.y -= 2;
    this.bombs.push(b);
    AudioSys.bombDrop();
    AudioSys.bombWhistle(1.5);
  },

  updateBombs(dt) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t += dt;
      b.vel.y -= 9.81 * dt;
      b.vel.multiplyScalar(Math.max(0, 1 - 0.03 * dt));   /* aerodynamika pumy */
      b.pos.addScaledVector(b.vel, dt);
      b.mesh.position.copy(b.pos);
      const sp = b.vel.length();
      if (sp > 2) b.mesh.quaternion.setFromUnitVectors(UP, this._v1.copy(b.vel).divideScalar(sp));
      /* přímý zásah cíle za letu */
      let hit = null;
      for (const t of World.targets) {
        if (!t.alive) continue;
        if (b.pos.distanceToSquared(t.pos) < (t.hitR + 1) * (t.hitR + 1)) { hit = t; break; }
      }
      const gy = World.groundHeight(b.pos.x, b.pos.z);
      if (hit || b.pos.y <= gy + 0.12 || b.t > 12) {
        this.explodeBomb(b, hit);
        this.bombs.splice(i, 1);
      }
    }
  },

  explodeBomb(b, directTarget, label = 'PUMA') {
    this.scene.remove(b.mesh);
    FX.explosion(b.pos, 1.0, this.camera.position);
    let n = 0;
    for (const t of World.targets) {
      if (!t.alive) continue;
      if (t === directTarget || t.pos.distanceTo(b.pos) < t.hitR + 6) { this.destroyTarget(t); n++; }
    }
    const kills = World.killSoldiersNear(b.pos, 15);
    if (kills > 0) {
      this.stats.score += kills * 20;
      this.toast(`PECHOTA ×${kills}  +${kills * 20}`, '#ffb84d');
    }
    if (n === 0 && kills === 0) this.toast(`${label} MINULA CÍL`, '#ffb84d');
  },

  /* =================  TERMOKAMERA  ================= */
  toggleThermal() {
    if (!Drone.spec.thermal) { this.toast('TENTO DRON NEMÁ TERMOKAMERU', '#ffb84d'); return; }
    this.setThermal(!this.thermalOn);
    AudioSys.click();
    this.toast(this.thermalOn ? 'TERMOKAMERA: ZAP' : 'TERMOKAMERA: VYP', '#8cf7a0');
  },
  setThermal(on) {
    this.thermalOn = !!on && !!Drone.spec.thermal;
    document.body.classList.toggle('thermal', this.thermalOn);
  },

  /* =================  ORBIT  ================= */
  toggleOrbit() {
    if (!Drone.spec.orbit) { this.toast('TENTO DRON NEMÁ ORBIT', '#ffb84d'); return; }
    if (Drone.crashed || !Drone.armed || Drone.holdOnPad) { this.toast('ORBIT AŽ VE VZDUCHU', '#ffb84d'); return; }
    if (Drone.toggleOrbit()) {
      this.toast(`ORBIT ZAP — krouží r=${Math.round(Drone.orbit.r)} m kolem bodu před dronem`, '#8cf7a0');
    } else {
      this.toast('ORBIT VYP', '#9fe8ff');
    }
  },

  /* =================  PRŮZKUM (RECON): značení cílů  ================= */
  updateSpotting(dt) {
    const spec = Drone.spec;
    if (!spec.spotR || !Drone.liftedOff || Drone.crashed) return;
    this._spotT -= dt;
    if (this._spotT > 0) return;
    this._spotT = 0.4;
    for (const t of World.targets) {
      if (!t.alive || t.spotted) continue;
      if (t.pos.distanceTo(Drone.pos) < spec.spotR) {
        t.spotted = true;
        this.stats.score += 15;
        this.toast(`CÍL ZJIŠTĚN: ${t.name}  +15`, '#8cf7a0');
        AudioSys.beepLock();
      }
    }
  },

  destroyTarget(t) {
    if (!t.alive) return;
    t.alive = false;
    World.targetsAlive--;
    this.stats.destroyed++;
    this.stats.score += t.points;
    /* počet VYUŽITÝCH startů (bombardér může jedním startem zničit více cílů) */
    if (!this.stats._scored) { this.stats.hits++; this.stats._scored = true; }
    World.wreckTarget(t);
    World.killSoldiersNear(t.pos, 18);
    for (const s of (t.secondary || [])) {
      this.schedule(s.delay, () => { if (this.state !== 'menu') FX.explosion(s.pos, s.power, this.camera.position); });
    }
    this.toast(`ZNIČEN CÍL: ${t.name}  +${t.points}`, '#ffb84d');
    AudioSys.beepLock();
    if (this.stats.destroyed >= this.stats.total && !this.winPending) {
      this.winPending = true;
      this.schedule(2.0, () => this.endMission(true));
    }
  },

  afterCrash() {
    if (this.stats.destroyed >= this.stats.total) { this.endMission(true); return; }
    this.returnToSoldier(true);
    this.state = 'fly';
    this.crashStatic = false;
  },

  /* zpět k pěšákovi (po havárii / odvolání dronu) */
  returnToSoldier(afterCrash) {
    this.mode = 'soldier';
    this.droneModel.visible = false;
    this.setThermal(false);
    Drone.armed = false;
    Drone.orbit.active = false;
    Player.syncCarried();
    this.lock = null;
    Player._mouse = false;
    Player._mouseSeen = false;
    if (document.exitPointerLock) document.exitPointerLock();
    if (afterCrash) this.toast(Player.carried ? 'JSI ZPĚT NA ZEMI — VYBÍREJ DALŠÍ DRON (Q)' : 'JSI ZPĚT NA ZEMI — NAJDI DALŠÍ DRON', '#9fe8ff');
  },

  /* vypuštění dronu z ruky pěšáka */
  launchCarried() {
    if (this.mode !== 'soldier' || Player.dead) return;
    if (!Player.carried) { this.toast('NEMÁŠ DRON — NAJDI BEDNU (E)', '#ffb84d'); AudioSys.beepError(); return; }
    const type = Player.carried;
    Settings.droneType = type;
    Settings.save();
    Player.inv.splice(Player.sel, 1);
    Player.syncCarried();
    this.mode = 'drone';
    this.curCam = 'fpv';
    this.spawnDrone(true);
    if (document.exitPointerLock) document.exitPointerLock();
  },

  spawnDrone(fromPlayer) {
    this.stats.launches++;
    if (fromPlayer) {
      Drone.reset(Player.pos.x, Player.pos.y + 0.7, Player.pos.z, Player.yaw);
    } else {
      Drone.reset(World.home.x, World.home.y + 0.45, World.home.z, 0);
    }
    this.setDroneModel(Settings.droneType);
    this.bombsLeft = Drone.spec.bombs;
    this.stats._scored = false;
    this._spotT = 0;
    if (!Drone.spec.thermal && this.thermalOn) this.setThermal(false);
    this.clearBombs();
    this.droneModel.visible = (this.curCam === 'tps');
    this._warned.bat20 = false; this._warned.bat0 = false;
    if (Settings.autoArm) Drone.arm();
    this.crashStatic = false;
    this.bigMsg('', 0);
    this.toast(`DRON #${this.stats.launches}: ${Drone.spec.label}`, '#9fe8ff');
  },

  /* =================  PĚŠÁK: smrt / respawn  ================= */
  onPlayerDeath() {
    this.bigMsg('PADL JSI', 2600, true);
    this.dmgFlash(0.7);
  },
  onPlayerRespawn() {
    this.bigMsg('', 0);
    this.toast('RESPAWN NA ZÁKLADNĚ', '#8cf7a0');
  },

  /* =================  RAKETY (PĚŠÁK)  ================= */
  clearRockets() {
    for (const r of this.rockets) this.scene.remove(r.mesh);
    this.rockets.length = 0;
  },

  spawnRocket(origin, dir) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a3d33, flatShading: true, roughness: 0.7 });
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 6), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), new THREE.MeshStandardMaterial({ color: 0x6b2f28, flatShading: true }));
    head.position.y = 0.29; g.add(body); g.add(head);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.12, 0.14), mat);
    fin.position.y = -0.2; g.add(fin);
    g.position.copy(origin);
    this.scene.add(g);
    const r = { mesh: g, pos: origin.clone(), vel: dir.clone().multiplyScalar(52), t: 0, smokeT: 0 };
    r.vel.y += 1.5;
    this.rockets.push(r);
  },

  updateRockets(dt) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.t += dt;
      r.vel.y -= 3.5 * dt;
      r.pos.addScaledVector(r.vel, dt);
      r.mesh.position.copy(r.pos);
      const sp = r.vel.length();
      if (sp > 2) r.mesh.quaternion.setFromUnitVectors(UP, this._v1.copy(r.vel).divideScalar(sp));
      /* kouřová stopa */
      r.smokeT -= dt;
      if (r.smokeT <= 0) {
        r.smokeT = 0.028;
        FX.smoke.spawn({
          pos: r.pos.clone(), vel: new THREE.Vector3(U.rand(-0.4, 0.4), U.rand(-0.2, 0.5), U.rand(-0.4, 0.4)),
          size: 0.5, life: 1.1, col: [0.7, 0.67, 0.6], alpha: 0.4, grow: 0.5, drag: 1.4,
        });
      }
      /* zásah */
      let hit = null;
      if (r.t > 0.06) {
        for (const t of World.targets) {
          if (!t.alive) continue;
          if (r.pos.distanceToSquared(t.pos) < (t.hitR + 0.4) * (t.hitR + 0.4)) { hit = t; break; }
        }
      }
      let hitSoldier = false;
      if (!hit) for (const s of World.soldiers) {
        if (!s.alive) continue;
        const dx = r.pos.x - s.pos.x, dz = r.pos.z - s.pos.z, dy = r.pos.y - (s.pos.y + 1.0);
        if (dx * dx + dz * dz + dy * dy < 1.1) { hitSoldier = true; break; }
      }
      let hitWall = false;
      if (!hit && !hitSoldier) for (const c of World.colliders) {
        if (c.soldier || (c.t && !c.t.alive)) continue;
        if (r.pos.y < c.y || r.pos.y > c.y + c.h) continue;
        const dx = r.pos.x - c.x, dz = r.pos.z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) { hitWall = true; break; }
      }
      const gy = World.groundHeight(r.pos.x, r.pos.z);
      if (hit || hitSoldier || hitWall || r.pos.y <= gy + 0.1 || r.t > 9) {
        /* raketa: velký výbuch, zničí techniku v okolí a zabije pěchotu */
        this.explodeBomb(r, hit, 'RAKETA');
        /* zpětný ráz — zranění vlastního pěšáka v blízkosti */
        const dp = r.pos.distanceTo(Player.pos);
        if (dp < 7.5) Player.damage(Math.round(55 * (1 - dp / 7.5)) + 15);
        this.rockets.splice(i, 1);
      }
    }
  },

  /* =================  MISE  ================= */
  startMission() {
    FX.clearMission();
    World.resetTargets();
    World.resetSoldiers();
    World.resetCrates();
    World.addAmbientFires();
    this.clearBombs();
    this.clearRockets();
    this.stats = { score: 0, destroyed: 0, total: World.targetsTotal, launches: 0, hits: 0, time: 0 };
    this.winPending = false;
    this.scheduled.length = 0;
    this._warned = { bat20: false, bat0: false, bounds: 0 };
    this.mode = 'soldier';
    this.curCam = 'fpv';
    Player.reset(Player.spawn.x, Player.spawn.z);
    Player.inv = [Settings.droneType];
    Player.sel = 0;
    Player.syncCarried();
    Player._initWeaponModels();
    Drone.reset(World.home.x, World.home.y + 0.45, World.home.z, 0);
    this.setDroneModel(Settings.droneType);
    this.droneModel.visible = false;
    this.setThermal(false);
    this.state = 'fly';
    this.hideAll();
    AudioSys.ensure();
    this.toast(`PĚŠÁK NA ZÁKLADNĚ — batoh: ${DRONES[Settings.droneType].label}`, '#8cf7a0');
    this.schedule(1.7, () => {
      if (this.state === 'fly' && this.mode === 'soldier') {
        this.toast('MYŠ = ROZHLÉDNUTÍ · E = BEDNA · Q = VÝBĚR DRONU', '#9fe8ff');
      }
    });
  },

  endMission(win) {
    this.state = 'end';
    this.crashStatic = false;
    this.clearBombs();
    this.clearRockets();
    this.setThermal(false);
    this.mode = 'soldier';
    if (document.exitPointerLock) document.exitPointerLock();
    const s = this.stats;
    const acc = s.launches > 0 ? s.hits / s.launches : 0;
    const bonus = Math.round(acc * 400) + Math.max(0, Math.round(540 - s.time)) * 2;
    const total = s.score + bonus;
    let rating = 'C';
    if (acc >= 0.75 && s.time <= 480) rating = 'S';
    else if (acc >= 0.6) rating = 'A';
    else if (acc >= 0.45) rating = 'B';
    const el = id => document.getElementById(id);
    el('endTitle').textContent = win ? 'MISE SPLNĚNA' : 'MISE PŘERUŠENA';
    el('endRating').textContent = rating;
    el('endStats').innerHTML = `
      <div class="srow"><span>ZNIČENÉ CÍLE</span><b>${s.destroyed} / ${s.total}</b></div>
      <div class="srow"><span>POUŽITÉ DRONY</span><b>${s.launches}</b></div>
      <div class="srow"><span>ZÁSAHY CÍLŮ</span><b>${s.hits}</b></div>
      <div class="srow"><span>PŘESNOST</span><b>${Math.round(acc * 100)} %</b></div>
      <div class="srow"><span>ČAS</span><b>${U.fmtTime(s.time)}</b></div>
      <div class="srow"><span>SKÓRE CÍLŮ</span><b>${s.score}</b></div>
      <div class="srow"><span>BONUS</span><b>+${bonus}</b></div>
      <div class="srow total"><span>CELKEM</span><b>${total}</b></div>`;
    this.hideAll();
    el('end').classList.add('show');
    this.bigMsg('', 0);
  },

  pause(silent) {
    if (this.state !== 'fly') return;
    this.state = 'paused';
    this.hideAll();
    document.getElementById('pause').classList.add('show');
    if (document.exitPointerLock) document.exitPointerLock();
    if (!silent) AudioSys.click();
  },
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'fly';
    this.hideAll();
  },

  /* =================  KAMERA  ================= */
  updateCamera(dt) {
    const cam = this.camera;
    if (this.state === 'menu') {
      const a = this.menuT * 0.05;
      const r = 430;
      cam.position.set(Math.cos(a) * r, 175 + Math.sin(this.menuT * 0.11) * 25, -280 + Math.sin(a) * r);
      cam.lookAt(0, 5, -280);
      if (cam.fov !== 62) { cam.fov = 62; cam.updateProjectionMatrix(); }
      this.droneModel.visible = false;
      if (Player._rifleModel) Player._rifleModel.visible = false;
      if (Player._rocketModel) Player._rocketModel.visible = false;
      return;
    }
    if (cam.fov !== Settings.fov) { cam.fov = Settings.fov; cam.updateProjectionMatrix(); FX.setView(HUD.H, Settings.fov); }

    /* ---- pěšák: první osoba ---- */
    if (this.mode === 'soldier') {
      if (Player.dead) {
        cam.position.set(Player.pos.x, Player.pos.y + 0.45, Player.pos.z);
        cam.rotation.set(-0.55, Player.yaw, 0.55, 'YXZ');
      } else {
        Player.eyePos(this._v1);
        cam.position.copy(this._v1);
        if (FX.shakeT > 0 && this.state === 'fly') {
          const k = FX.shakeAmp * U.clamp(FX.shakeT * 1.6, 0, 1);
          cam.position.x += U.rand(-1, 1) * k * 0.03;
          cam.position.y += U.rand(-1, 1) * k * 0.03;
          cam.position.z += U.rand(-1, 1) * k * 0.03;
        }
        cam.rotation.set(Player.pitch, Player.yaw, 0, 'YXZ');
      }
      this.droneModel.visible = false;
      const l2 = World.light;
      if (l2) {
        l2.position.set(
          Math.round(Player.pos.x / 4) * 4 + World.sunDir.x * 700,
          World.sunDir.y * 700 + 120,
          Math.round(Player.pos.z / 4) * 4 + World.sunDir.z * 700
        );
        l2.target.position.set(Math.round(Player.pos.x / 4) * 4, 0, Math.round(Player.pos.z / 4) * 4);
      }
      return;
    }

    if (this.curCam === 'fpv') {
      cam.position.copy(Drone.pos);
      cam.quaternion.copy(Drone.quat).multiply(this._qt.setFromAxisAngle(XAXIS, Settings.tilt * DEG));
      if (FX.shakeT > 0 && this.state === 'fly') {
        const k = FX.shakeAmp * U.clamp(FX.shakeT * 1.6, 0, 1);
        cam.rotateX(U.rand(-1, 1) * k * 0.006);
        cam.rotateY(U.rand(-1, 1) * k * 0.005);
        cam.rotateZ(U.rand(-1, 1) * k * 0.008);
        cam.position.x += U.rand(-1, 1) * k * 0.04;
        cam.position.y += U.rand(-1, 1) * k * 0.04;
        cam.position.z += U.rand(-1, 1) * k * 0.04;
      }
    } else {
      if (this.state === 'fly' && !Drone.crashed) {
        const fwd = Drone.forward(this._v1);
        this._v2.copy(Drone.pos).addScaledVector(fwd, -8).add(this._v3.set(0, 3, 0));
        cam.position.lerp(this._v2, 1 - Math.exp(-6 * dt));
        this._v2.copy(Drone.pos).addScaledVector(fwd, 6);
        cam.lookAt(this._v2);
        /* vrtule */
        const thr = Drone.armed ? 0.3 + Drone.throttleOut / Settings.maxThrust : 0;
        for (const p of this.props) p.rotation.y += thr * 60 * dt;
      } else {
        cam.lookAt(this.crashPos);
      }
    }
    this.droneModel.visible = (this.curCam === 'tps') && this.state === 'fly' && !Drone.crashed;
    if (this.droneModel.visible) {
      this.droneModel.position.copy(Drone.pos);
      this.droneModel.quaternion.copy(Drone.quat);
    }
    /* stín slunce sleduje dron */
    const l = World.light;
    if (l) {
      l.position.set(
        Math.round(Drone.pos.x / 4) * 4 + World.sunDir.x * 700,
        World.sunDir.y * 700 + 120,
        Math.round(Drone.pos.z / 4) * 4 + World.sunDir.z * 700
      );
      l.target.position.set(Math.round(Drone.pos.x / 4) * 4, 0, Math.round(Drone.pos.z / 4) * 4);
    }
  },

  updateLock() {
    this.lock = null;
    if (!Settings.assist || this.state !== 'fly' || Drone.crashed) return;
    const fwd = Drone.forward(this._v1);
    let best = null, bestA = 9 * DEG;
    for (const t of World.targets) {
      if (!t.alive) continue;
      this._v2.copy(t.pos).sub(Drone.pos);
      const d = this._v2.length();
      if (d > 720 || d < 5) continue;
      this._v2.divideScalar(d);
      const ang = Math.acos(U.clamp(this._v2.dot(fwd), -1, 1));
      if (ang < bestA) { bestA = ang; best = t; }
    }
    if (best && best !== this.lock) AudioSys.beepLock();
    this.lock = best;
  },

  updateAudio() {
    const droneOn = this.mode === 'drone' && this.state === 'fly' && Drone.armed && !Drone.crashed;
    if (droneOn) {
      AudioSys.updateMotor(true, Drone.throttleOut / Settings.maxThrust);
    } else {
      AudioSys.updateMotor(false, 0);
    }
    const spd = this.mode === 'drone'
      ? (this.state === 'fly' && !Drone.crashed ? Drone.vel.length() : 0)
      : (this.state === 'fly' ? Math.hypot(Player.vel.x, Player.vel.z) : 0);
    AudioSys.updateWind(spd);
  },

  updateStatic(now) {
    const isDrone = this.mode === 'drone';
    let lvl = 0;
    if (isDrone && (this.crashStatic || this.state === 'crash')) lvl = 1;
    else if (isDrone && this.state === 'fly') {
      const d = Drone.pos.distanceTo(this._homeV);
      lvl = Math.pow(U.clamp((d - 560) / 900, 0, 1), 1.35);
    }
    this.staticLevel = lvl;
    const elS = document.getElementById('static');
    const show = Settings.fpvFx && isDrone && (this.state === 'fly' || this.state === 'crash');
    elS.style.opacity = show ? (lvl * 0.85).toFixed(3) : '0';
    if (show && lvl > 0.03 && now - this._staticJitT > 75) {
      this._staticJitT = now;
      elS.style.backgroundPosition = `${Math.floor(Math.random() * 160)}px ${Math.floor(Math.random() * 160)}px`;
    }
    document.getElementById('scan').style.opacity = show && Settings.fpvFx ? '0.5' : '0';
    document.getElementById('vig').style.opacity = show && Settings.fpvFx ? '1' : '0';
    AudioSys.updateStatic(lvl);
  },

  checkPadToast() {
    const sig = Input.padList.map(p => p.id).join('|');
    if (sig !== this._padSig) {
      if (this._padSig !== '' && sig !== '') this.toast('GAMEPAD/RÁDIO PŘIPOJENO', '#8cf7a0');
      if (this._padSig !== '' && sig === '') this.toast('GAMEPAD/RÁDIO ODPOJENO', '#ffb84d');
      this._padSig = sig;
      const elS = document.getElementById('padStatus');
      if (elS) elS.textContent = sig ? `PŘIPOJENO: ${sig.slice(0, 40)}` : 'GAMEPAD / RC RÁDIO: nepřipojeno';
    }
  },

  /* =================  UI  ================= */
  hideAll() {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('show'));
    this.settingsOpen = false;
  },
  show(id) { this.hideAll(); document.getElementById(id).classList.add('show'); },

  toast(text, color = '#dff3ff') {
    const box = document.getElementById('toasts');
    const div = document.createElement('div');
    div.className = 'toast';
    div.textContent = text;
    div.style.borderColor = color;
    div.style.color = color;
    box.appendChild(div);
    while (box.children.length > 4) box.removeChild(box.firstChild);
    setTimeout(() => { div.style.opacity = '0'; }, 2200);
    setTimeout(() => div.remove(), 2700);
  },
  bigMsg(text, ms, blink) {
    const el = document.getElementById('bigmsg');
    el.textContent = text;
    el.classList.toggle('blink', !!blink);
    el.style.opacity = text ? '1' : '0';
    if (this._bigT) clearTimeout(this._bigT);
    if (ms) this._bigT = setTimeout(() => { el.classList.remove('blink'); el.style.opacity = '0'; }, ms);
  },

  /* ---------- napojení UI ---------- */
  bindUI(el) {
    const $ = id => el(id);
    const click = (id, fn) => $(id).addEventListener('click', () => { AudioSys.ensure(); AudioSys.click(); fn(); });

    click('btnPlay', () => { $('briefTargets').textContent = World.targetsTotal; this.buildHangar(); this.show('briefing'); this.state = 'menu'; });
    click('btnLaunch', () => this.startMission());
    click('btnBriefBack', () => this.show('menu'));
    click('btnSettings', () => { this._settingsFrom = (this.state === 'paused') ? 'pause' : 'menu'; this.show('settings'); this.settingsOpen = true; this.syncSettingsUI(); });
    click('btnHelp', () => this.showHelp('menu'));
    click('btnHelpBack', () => { if (this._helpFrom === 'pause') { this.show('pause'); } else this.show('menu'); });
    click('btnResume', () => this.resume());
    click('btnPauseSettings', () => { this._settingsFrom = 'pause'; this.show('settings'); this.settingsOpen = true; this.syncSettingsUI(); });
    click('btnRestart', () => this.startMission());
    click('btnHangar', () => { $('briefTargets').textContent = World.targetsTotal; this.buildHangar(); this.clearBombs(); this.clearRockets(); this.setThermal(false); this.state = 'menu'; this.show('briefing'); });
    click('btnQuit', () => { this.clearBombs(); this.clearRockets(); this.setThermal(false); this.state = 'menu'; this.show('menu'); });
    click('btnAgain', () => this.startMission());
    click('btnEndMenu', () => { this.state = 'menu'; this.show('menu'); });
    click('btnSettingsBack', () => {
      this.settingsOpen = false;
      if (this._settingsFrom === 'pause') this.show('pause'); else this.show('menu');
    });

    /* ---- let ---- */
    const bindRange = (id, key, fmt, after) => {
      const r = $(id), lab = $(id + 'Val');
      const set = v => { Settings[key] = v; lab.textContent = fmt(v); Settings.save(); if (after) after(); };
      r.addEventListener('input', () => set(+r.value));
      lab.textContent = fmt(Settings[key]);
    };
    $('selMode').value = Settings.mode;
    $('selMode').addEventListener('change', () => { Settings.mode = $('selMode').value; Settings.save(); });
    bindRange('rngRates', 'rates', v => v + '°/s');
    bindRange('rngYaw', 'yawRate', v => v + '°/s');
    bindRange('rngExpo', 'expo', v => v.toFixed(2));
    bindRange('rngTilt', 'tilt', v => v + '°');
    bindRange('rngFov', 'fov', v => v + '°', () => { this.camera.fov = Settings.fov; this.camera.updateProjectionMatrix(); FX.setView(HUD.H, Settings.fov); });
    const bindChk = (id, key, after) => {
      const c = $(id);
      c.checked = Settings[key];
      c.addEventListener('change', () => { Settings[key] = c.checked; Settings.save(); if (after) after(); });
    };
    bindChk('chkAutoArm', 'autoArm');
    bindChk('chkAssist', 'assist');
    bindChk('chkMarkers', 'markers');
    bindChk('chkMinimap', 'minimap');
    bindChk('chkSticks', 'sticks');
    bindChk('chkFpvFx', 'fpvFx');
    bindChk('chkShadows', 'shadows', () => {
      this.renderer.shadowMap.enabled = Settings.shadows;
      this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    });
    bindRange('rngVolume', 'volume', v => Math.round(v * 100) + ' %', () => { AudioSys.setVolume(Settings.volume); });
    $('chkMute').checked = Settings.muted;
    $('chkMute').addEventListener('change', () => { Settings.muted = $('chkMute').checked; AudioSys.setMuted(Settings.muted); Settings.save(); });

    /* ---- gamepad / RC rádio ---- */
    this.buildPadUI(el);
  },

  /* ---------- hangár: karty dronů ---------- */
  buildHangar() {
    const host = document.getElementById('droneRow');
    if (!host) return;
    host.innerHTML = '';
    for (const key in DRONES) {
      const s = DRONES[key];
      const card = document.createElement('div');
      card.className = 'drone-card' + (Settings.droneType === key ? ' sel' : '');
      card.innerHTML = `
        <h4>${s.label}</h4>
        <p>${s.desc}</p>
        <ul>
          <li><span>TRUP</span><b>${'▮'.repeat(s.hp)}${s.hp}</b></li>
          <li><span>VÝDRŽ BATERIE</span><b>${s.battMul >= 2 ? 'DLOUHÁ' : (s.battMul > 1 ? 'STŘEDNÍ' : 'NORMÁLNÍ')}</b></li>
          <li><span>NÁLOŽ (NÁLET)</span><b>${s.warhead ? 'ANO' : 'NE'}</b></li>
          <li><span>PUMY</span><b>${s.bombs ? s.bombs + '×' : '—'}</b></li>
          <li><span>TERMOKAMERA</span><b>${s.thermal ? 'ANO' : 'NE'}</b></li>
          <li><span>ORBIT KROUŽENÍ</span><b>${s.orbit ? 'ANO' : 'NE'}</b></li>
        </ul>`;
      card.addEventListener('click', () => {
        AudioSys.ensure(); AudioSys.click();
        Settings.droneType = key; Settings.save();
        for (const ch of host.children) ch.classList.remove('sel');
        card.classList.add('sel');
      });
      host.appendChild(card);
    }
  },

  buildPadUI(el) {
    const $ = id => el(id);
    const pad = Settings.pad;
    $('chkPad').checked = pad.enabled;
    $('chkPad').addEventListener('change', () => { pad.enabled = $('chkPad').checked; Settings.save(); });
    $('rngDead').value = pad.deadband;
    $('rngDead').addEventListener('input', () => { pad.deadband = +$('rngDead').value; $('rngDeadVal').textContent = pad.deadband.toFixed(2); Settings.save(); });
    $('rngDeadVal').textContent = pad.deadband.toFixed(2);

    $('selPad').addEventListener('change', () => { Input.padId = $('selPad').value || null; this.refreshPadAxes(); });

    const presetBtn = (id, name, label) => $(id).addEventListener('click', () => {
      Input.setPreset(name);
      this.syncPadUI();
      this.toast(`PŘEDNASTAVENÍ: ${label}`, '#9fe8ff');
    });
    presetBtn('btnPresetMode2', 'mode2', 'GAMEPAD MODE 2');
    presetBtn('btnPresetAetr', 'aetr', 'RC RÁDIO AETR');

    /* řádky mapování kanálů */
    const chans = [['roll', 'KŘIDÉLKA / ROLL'], ['pitch', 'VÝŠKOVKA / PITCH'], ['yaw', 'SMĚROVKA / YAW'], ['throttle', 'PLYN / THROTTLE']];
    const host = $('padChans');
    host.innerHTML = '';
    this._padRows = {};
    for (const [key, label] of chans) {
      const row = document.createElement('div');
      row.className = 'padrow';
      row.innerHTML = `
        <span class="pl">${label}</span>
        <select data-ch="${key}"></select>
        <label class="pl"><input type="checkbox" data-inv="${key}"> OBRÁTIT</label>`;
      host.appendChild(row);
      row.querySelector('select').addEventListener('change', e => {
        pad.axes[key] = +e.target.value; pad.preset = 'custom'; Settings.save(); this.syncPadUI();
      });
      row.querySelector('input').addEventListener('change', e => {
        pad.inv[key] = e.target.checked; pad.preset = 'custom'; Settings.save(); this.syncPadUI();
      });
      this._padRows[key] = row;
    }

    /* živý náhled */
    const live = $('padLive');
    const bar = (label, key) => {
      const d = document.createElement('div');
      d.className = 'padbar';
      d.innerHTML = `<span>${label}</span><div class="track"><div class="fill" data-bar="${key}"></div></div><b data-val="${key}">0</b>`;
      live.appendChild(d);
    };
    bar('ROLL', 'roll'); bar('PITCH', 'pitch'); bar('YAW', 'yaw'); bar('THROTTLE', 'throttle');

    const raw = document.createElement('div');
    raw.className = 'padraw';
    raw.innerHTML = '<span class="pl">SUROVÉ OSY:</span><div class="axes" data-axes></div><div class="pl" style="margin-top:6px">TLAČÍTKA:</div><div class="btns" data-btns></div>';
    live.appendChild(raw);
    this._padAxesHost = raw.querySelector('[data-axes]');
    this._padBtnsHost = raw.querySelector('[data-btns]');
  },

  refreshPadAxes() {
    const n = Math.max(4, Input.padLive.nAxes || 0, (Input.padList[0] ? Input.padList[0].axes : 0));
    for (const key in this._padRows) {
      const sel = this._padRows[key].querySelector('select');
      sel.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const o = document.createElement('option');
        o.value = i; o.textContent = `osa ${i + 1}`;
        sel.appendChild(o);
      }
    }
    this.syncPadUI();
  },

  syncPadUI() {
    const pad = Settings.pad;
    /* zvýraznění aktivního presetu */
    document.getElementById('btnPresetMode2').classList.toggle('active', pad.preset === 'mode2');
    document.getElementById('btnPresetAetr').classList.toggle('active', pad.preset === 'aetr');
    for (const key in this._padRows) {
      const sel = this._padRows[key].querySelector('select');
      if (sel.options.length <= pad.axes[key]) this.refreshPadAxes();
      sel.value = String(pad.axes[key]);
      this._padRows[key].querySelector('input').checked = !!pad.inv[key];
    }
  },

  syncSettingsUI() {
    const $ = id => document.getElementById(id);
    $('selMode').value = Settings.mode;
    $('rngRates').value = Settings.rates; $('rngRatesVal').textContent = Settings.rates + '°/s';
    $('rngYaw').value = Settings.yawRate; $('rngYawVal').textContent = Settings.yawRate + '°/s';
    $('rngExpo').value = Settings.expo; $('rngExpoVal').textContent = (+Settings.expo).toFixed(2);
    $('rngTilt').value = Settings.tilt; $('rngTiltVal').textContent = Settings.tilt + '°';
    $('rngFov').value = Settings.fov; $('rngFovVal').textContent = Settings.fov + '°';
    $('rngVolume').value = Settings.volume; $('rngVolumeVal').textContent = Math.round(Settings.volume * 100) + ' %';
    for (const [id, key] of [['chkAutoArm', 'autoArm'], ['chkAssist', 'assist'], ['chkMarkers', 'markers'], ['chkMinimap', 'minimap'], ['chkSticks', 'sticks'], ['chkFpvFx', 'fpvFx'], ['chkShadows', 'shadows'], ['chkMute', 'muted'], ['chkPad', 'enabled']]) {
      $(id).checked = !!Settings[key];
    }
    /* seznam padů */
    const sel = $('selPad');
    const sig = Input.padList.map(p => p.id).join('|');
    if (sel.dataset.sig !== sig) {
      sel.dataset.sig = sig;
      sel.innerHTML = '<option value="">— žádný —</option>';
      for (const p of Input.padList) {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = `${p.id.slice(0, 34)} (${p.axes} os, ${p.buttons} tl.)`;
        sel.appendChild(o);
      }
      if (Input.padId) sel.value = Input.padId;
      this.refreshPadAxes();
    }
    this.syncPadUI();
  },

  updatePadUI() {
    /* živé pruhy kanálů */
    const st = Input.state;
    for (const key of ['roll', 'pitch', 'yaw', 'throttle']) {
      const fill = document.querySelector(`[data-bar="${key}"]`);
      const val = document.querySelector(`[data-val="${key}"]`);
      if (!fill) continue;
      const v = U.clamp(st[key], -1, 1);
      const pct = (v + 1) / 2 * 100;
      fill.style.left = Math.min(50, pct) + '%';
      fill.style.width = Math.abs(pct - 50) + '%';
      val.textContent = v.toFixed(2);
    }
    /* surové osy */
    const ax = Input.padLive.axes;
    if (this._padAxesHost.children.length !== ax.length) {
      this._padAxesHost.innerHTML = '';
      for (let i = 0; i < ax.length; i++) {
        const d = document.createElement('div');
        d.className = 'axis';
        d.innerHTML = `<span>${i + 1}</span><div class="track"><div class="fill"></div></div>`;
        this._padAxesHost.appendChild(d);
      }
    }
    for (let i = 0; i < ax.length; i++) {
      const d = this._padAxesHost.children[i];
      const v = U.clamp(ax[i], -1, 1);
      const fill = d.querySelector('.fill');
      const pct = (v + 1) / 2 * 100;
      fill.style.left = Math.min(50, pct) + '%';
      fill.style.width = Math.abs(pct - 50) + '%';
    }
    /* tlačítka */
    const bt = Input.padLive.buttons;
    if (this._padBtnsHost.children.length !== bt.length) {
      this._padBtnsHost.innerHTML = '';
      for (let i = 0; i < Math.min(bt.length, 20); i++) {
        const b = document.createElement('span');
        b.className = 'padbtn'; b.textContent = i;
        this._padBtnsHost.appendChild(b);
      }
    }
    for (let i = 0; i < Math.min(bt.length, 20); i++) {
      this._padBtnsHost.children[i].classList.toggle('on', !!bt[i]);
    }
  },

  showHelp(from) {
    this._helpFrom = from;
    this.show('help');
  },
};

/* start */
window.addEventListener('DOMContentLoaded', () => G.init());
