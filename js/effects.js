/* =====================================================
   FPV KAMIKAZE — efekty (částicový systém, výbuchy, kouř)
   ===================================================== */
'use strict';

/* ---- částicový systém (THREE.Points + vlastní shader) ---- */
class PSys {
  constructor(scene, max, opts) {
    this.max = max; this.opts = opts;
    this.cursor = 0;
    this.alive = new Uint8Array(max);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uScale: { value: 600 }, uSoft: { value: opts.soft } },
      vertexShader: `
        attribute float aSize; attribute vec4 aColor;
        varying vec4 vColor; uniform float uScale;
        void main(){
          vColor = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (uScale / max(0.1, -mv.z));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec4 vColor; uniform float uSoft;
        void main(){
          vec2 d = gl_PointCoord - vec2(0.5);
          float r = length(d) * 2.0;
          float a = smoothstep(1.0, uSoft, r) * vColor.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vColor.rgb, a);
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  setView(px, fovDeg) {
    this.mat.uniforms.uScale.value = px / (2 * Math.tan(fovDeg * Math.PI / 360));
  }

  spawn(o) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.alive[i] = 1;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = o.pos.x; this.pos[i3 + 1] = o.pos.y; this.pos[i3 + 2] = o.pos.z;
    this.vel[i3] = o.vel.x; this.vel[i3 + 1] = o.vel.y; this.vel[i3 + 2] = o.vel.z;
    this.col[i4] = o.col[0]; this.col[i4 + 1] = o.col[1]; this.col[i4 + 2] = o.col[2]; this.col[i4 + 3] = 1;
    this.size[i] = o.size; this.grow[i] = o.grow || 0;
    this.life[i] = this.maxLife[i] = o.life;
    this.a0[i] = o.alpha !== undefined ? o.alpha : 0.8;
    this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0;
  }

  update(dt) {
    const n = this.max;
    for (let i = 0; i < n; i++) {
      if (!this.alive[i]) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alive[i] = 0; this.col[i * 4 + 3] = 0; this.size[i] = 0; continue; }
      const i3 = i * 3, i4 = i * 4;
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= dr; this.vel[i3 + 1] = this.vel[i3 + 1] * dr - this.grav[i] * dt; this.vel[i3 + 2] *= dr;
      this.pos[i3] += this.vel[i3] * dt; this.pos[i3 + 1] += this.vel[i3 + 1] * dt; this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];        // 1 -> 0
      this.col[i4 + 3] = this.a0[i] * Math.pow(k, 1.1);
      this.size[i] += this.grow[i] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }
  clear() { this.alive.fill(0); this.col.fill(0); for (let i = 0; i < this.max; i++) this.size[i] = 0; this.geo.attributes.aSize.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true; }
}

/* ---- hlavní správce efektů ---- */
const FX = {
  scene: null,
  add: null, smoke: null,
  rings: [], flashes: [], emitters: [], scorches: [],
  tracers: [], _tracerIdx: 0, _zAxis: new THREE.Vector3(0, 0, 1),
  shakeT: 0, shakeAmp: 0, _flashIdx: 0,

  init(scene) {
    this.scene = scene;
    this.add = new PSys(scene, 900, { additive: true, soft: 0.10 });
    this.smoke = new PSys(scene, 900, { additive: false, soft: 0.25 });
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 60, 2);
      l.visible = false; scene.add(l);
      this.flashes.push({ l, t: 0 });
    }
    /* svítící projektily (palba vojáků) — pool tažených boxů */
    const tGeo = new THREE.BoxGeometry(0.06, 0.06, 1);
    for (let i = 0; i < 20; i++) {
      const m = new THREE.Mesh(tGeo, new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      m.visible = false; scene.add(m);
      this.tracers.push({ m, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, s: 0, active: false });
    }
    this._ringGeo = new THREE.RingGeometry(0.78, 1.0, 26);
    this._scorchGeo = new THREE.CircleGeometry(1, 14);
    this.shakeT = 0;
  },

  setView(px, fovDeg) { this.add.setView(px, fovDeg); this.smoke.setView(px, fovDeg); },

  shake(amp, dur) { this.shakeAmp = Math.max(this.shakeAmp, amp); this.shakeT = Math.max(this.shakeT, dur); },

  /* letící svítící projektil (vizuální trasér) */
  tracer(from, to, speed = 340) {
    const tr = this.tracers[this._tracerIdx]; this._tracerIdx = (this._tracerIdx + 1) % this.tracers.length;
    tr.from.copy(from);
    tr.dir.copy(to).sub(from);
    tr.dist = tr.dir.length();
    if (tr.dist < 4) return;
    tr.dir.divideScalar(tr.dist);
    tr.s = 0; tr.speed = speed; tr.active = true;
    tr.m.visible = true;
    tr.m.scale.set(1, 1, 14);
    tr.m.quaternion.setFromUnitVectors(this._zAxis, tr.dir);
    tr.m.material.opacity = 0.9;
  },

  flash(pos, power) {
    const f = this.flashes[this._flashIdx]; this._flashIdx = (this._flashIdx + 1) % this.flashes.length;
    f.l.position.copy(pos); f.l.position.y += 1;
    f.l.intensity = 7 * power; f.l.distance = 55 * power;
    f.l.visible = true; f.t = 0.28;
  },

  ring(pos, r) {
    const m = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, pos.y + 0.25, pos.z);
    m.scale.setScalar(0.1);
    this.scene.add(m);
    this.rings.push({ m, t: 0, dur: 0.5, r });
  },

  scorch(pos, r) {
    let mesh;
    if (this.scorches.length >= 46) { mesh = this.scorches.shift(); }
    else {
      mesh = new THREE.Mesh(this._scorchGeo, new THREE.MeshBasicMaterial({
        color: 0x15130f, transparent: true, opacity: 0.82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
      }));
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
    }
    mesh.position.set(pos.x, pos.y + 0.06 + Math.random() * 0.02, pos.z);
    mesh.scale.setScalar(r);
    this.scorches.push(mesh);
  },

  explosion(pos, power = 1, camPos) {
    const dist = camPos ? pos.distanceTo(camPos) : 40;
    AudioSys.explosion(dist, power);
    this.shake(U.clamp(9 * power / (1 + dist * 0.06), 0.15, 4), 0.45 + 0.25 * power);
    this.flash(pos, power);
    this.ring(pos, 14 * power);
    const V = THREE.Vector3;
    const at = (rr) => new V(pos.x + U.rand(-rr, rr) * 0.4, pos.y + U.rand(0, rr) * 0.3, pos.z + U.rand(-rr, rr) * 0.4);
    /* ohnivá koule */
    for (let i = 0; i < Math.round(24 * power); i++) {
      const k = Math.random();
      this.add.spawn({
        pos: at(1), vel: new V(U.rand(-6, 6) * power, U.rand(1, 8) * power, U.rand(-6, 6) * power),
        size: U.rand(1.6, 3.2) * power, grow: 7 * power, life: U.rand(0.45, 0.9),
        col: [1 - k * 0.5, 0.45 + k * 0.15, 0.12], alpha: 0.95, drag: 2.4,
      });
    }
    /* jiskry */
    for (let i = 0; i < Math.round(46 * power); i++) {
      this.add.spawn({
        pos: at(0.6), vel: new V(U.rand(-1, 1) * 24 * power, U.rand(0.2, 1.4) * 24 * power, U.rand(-1, 1) * 24 * power),
        size: U.rand(0.16, 0.4), life: U.rand(0.4, 1.1),
        col: [1, 0.72, 0.3], alpha: 1, grav: 26, drag: 0.7,
      });
    }
    /* kouř */
    for (let i = 0; i < Math.round(16 * power); i++) {
      const g = U.rand(0.10, 0.2);
      this.smoke.spawn({
        pos: at(1.4), vel: new V(U.rand(-2.5, 2.5), U.rand(2, 5.5), U.rand(-2.5, 2.5)),
        size: U.rand(1.4, 2.6) * power, grow: 2.6, life: U.rand(2.2, 4.2),
        col: [g, g, g], alpha: 0.5, grav: -0.5, drag: 0.8,
      });
    }
    /* trosky */
    for (let i = 0; i < Math.round(10 * power); i++) {
      this.smoke.spawn({
        pos: at(0.8), vel: new V(U.rand(-1, 1) * 14 * power, U.rand(4, 15) * power, U.rand(-1, 1) * 14 * power),
        size: U.rand(0.3, 0.7), life: U.rand(0.9, 1.6),
        col: [0.16, 0.14, 0.12], alpha: 0.9, grav: 24, drag: 0.4,
      });
    }
  },

  /* trvalý kouř z vraku */
  wreck(pos, ttl = 120) {
    this.scorch(pos, 5.5);
    this.emitters.push({ pos: pos.clone().add(new THREE.Vector3(0, 0.8, 0)), ttl, acc: 0, rate: 1.4 });
  },

  update(dt) {
    this.add.update(dt);
    this.smoke.update(dt);
    /* projektily */
    for (const tr of this.tracers) {
      if (!tr.active) continue;
      tr.s += tr.speed * dt;
      const tail = Math.max(0, tr.s - 14);
      if (tail >= tr.dist) { tr.active = false; tr.m.visible = false; continue; }
      const head = Math.min(tr.s, tr.dist);
      tr.m.position.copy(tr.from).addScaledVector(tr.dir, (head + tail) * 0.5);
      tr.m.material.opacity = 0.9 * (1 - 0.45 * (tr.s / tr.dist));
    }
    /* záblesky */
    for (const f of this.flashes) {
      if (f.t <= 0) continue;
      f.t -= dt;
      f.l.intensity *= Math.pow(0.001, dt * 3.5);
      if (f.t <= 0) { f.l.visible = false; f.l.intensity = 0; }
    }
    /* vlnové kruhy */
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.t += dt;
      const k = r.t / r.dur;
      r.m.scale.setScalar(0.1 + r.r * k);
      r.m.material.opacity = 0.55 * (1 - k);
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); }
    }
    /* kouřové emitory (vraky) */
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.ttl -= dt;
      if (e.ttl <= 0) { this.emitters.splice(i, 1); continue; }
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        const g = U.rand(0.10, 0.17);
        this.smoke.spawn({
          pos: new THREE.Vector3(e.pos.x + U.rand(-0.5, 0.5), e.pos.y, e.pos.z + U.rand(-0.5, 0.5)),
          vel: new THREE.Vector3(U.rand(0.2, 0.8), U.rand(1.0, 1.9), U.rand(-0.3, 0.3)),
          size: U.rand(1.0, 1.7), grow: 0.8, life: U.rand(3.5, 6),
          col: [g, g, g], alpha: 0.42, grav: -0.4, drag: 0.5,
        });
      }
    }
    /* třes kamery */
    if (this.shakeT > 0) this.shakeT -= dt; else this.shakeAmp = 0;
  },

  clearMission() {
    this.add.clear(); this.smoke.clear();
    for (const tr of this.tracers) { tr.active = false; tr.m.visible = false; }
    for (const r of this.rings) { this.scene.remove(r.m); r.m.material.dispose(); }
    this.rings.length = 0;
    this.emitters.length = 0;
    for (const f of this.flashes) { f.l.visible = false; f.l.intensity = 0; f.t = 0; }
    for (const s of this.scorches) { this.scene.remove(s); }
    this.scorches.length = 0;
  },
};
