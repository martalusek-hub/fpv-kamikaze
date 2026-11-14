/* =====================================================
   FPV KAMIKAZE — svět (terén, základna, cíle)
   ===================================================== */
'use strict';

const World = {
  scene: null,
  colliders: [], targets: [], movers: [],
  soldiers: [], onDroneHit: null, onPlayerHit: null,
  crates: [],
  walls: [],                  // kolizní segmenty zákopů
  /* zákopy: lomené linie, v nich bedny s drony */
  TRENCHES: [
    { pts: [[34, 570], [62, 556], [92, 566], [118, 552]], w: 4.2, h: 1.7, crates: [[40, 566], [59, 558], [94, 565]] },
    { pts: [[205, -70], [232, -104], [214, -140]], w: 4.2, h: 1.7, crates: [[212, -79], [221, -90], [225, -118]] },
    { pts: [[-235, -60], [-262, -22], [-244, 18]], w: 4.2, h: 1.7, crates: [[-249, -42], [-258, -15], [-250, 4]] },
    { pts: [[300, 210], [340, 240], [378, 214]], w: 4.2, h: 1.7, crates: [[312, 226], [327, 230], [359, 227]] },
  ],
  home: { x: 0, z: 620, y: 0, yaw: 0 },
  targetsAlive: 0, targetsTotal: 0,
  sunDir: new THREE.Vector3(-0.686, 0.374, 0.623).normalize(),
  light: null, lightTarget: null,
  _radarDish: null, _heliRotor: null, _spinning: [],
  _ambientFires: [],
  _matCache: new Map(),

  /* =================  TERÉN  ================= */
  n1: makeNoise2D(1337), n2: makeNoise2D(777), n3: makeNoise2D(4242), n4: makeNoise2D(99),

  rawHills(x, z) {
    let h = fbm(this.n1, x * 0.0042, z * 0.0042, 4) * 13
          + fbm(this.n2, x * 0.016, z * 0.016, 2) * 2.6;
    const r = Math.hypot(x, z);
    if (r > 950) {
      const mr = U.smoothstep(950, 1180, r);
      h += mr * (26 + 75 * Math.abs(fbm(this.n1, x * 0.005 + 31, z * 0.005 - 17, 3)) + mr * mr * 45);
    }
    return h;
  },

  PADS: null,
  ROAD: null, ROAD_E: null, _segs: null,

  _initGeo() {
    const P = this.PADS = [
      { x: 0, z: -280, r: 300 },   // základna
      { x: 0, z: 620, r: 90 },     // start
      { x: 185, z: -620, r: 55 },  // radarový kopec
      { x: 555, z: -505, r: 120 }, // východní sklad
      { x: -480, z: -160, r: 50 }, // AA pozice
    ];
    for (const p of P) p.h = this.rawHills(p.x, p.z);
    this.ROAD = [
      [0, 650], [4, 520], [-6, 420], [-2, 300], [2, 180], [-4, 60], [0, -60],
      [-6, -160], [4, -240], [0, -320], [-4, -400], [0, -480], [-6, -560], [-2, -660],
    ];
    this.ROAD_E = [
      [4, -240], [130, -270], [250, -310], [360, -360], [470, -415], [540, -460], [558, -490],
    ];
    // výšky podél silnice + vyhlazení
    const smooth = (pts) => {
      const hs = pts.map(p => this.rawHills(p[0], p[1]));
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < hs.length - 1; i++) hs[i] = (hs[i - 1] + hs[i] * 2 + hs[i + 1]) / 4;
      }
      return pts.map((p, i) => ({ x: p[0], z: p[1], h: hs[i] }));
    };
    const rpts = smooth(this.ROAD), epts = smooth(this.ROAD_E);
    // segmenty
    const segs = [];
    const mkSegs = (pts) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1e-6;
        segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ha: a.h, hb: b.h, dx: dx / len, dz: dz / len, len });
      }
    };
    mkSegs(rpts); mkSegs(epts);
    this._segs = segs;

    /* zákopy: pásy vyrovnaného terénu, aby stěny zákopu sedly na zem */
    for (const tr of this.TRENCHES) {
      for (const c of this.trenchChunks(tr, 8, 3)) {
        this.PADS.push({ x: c.x, z: c.z, r: 12, h: this.baseHeight(c.x, c.z) });
      }
    }
  },

  roadInfo(x, z) {
    let bd = 1e9, bh = 0;
    for (const s of this._segs) {
      const px = x - s.ax, pz = z - s.az;
      let t = px * s.dx + pz * s.dz;
      t = U.clamp(t, 0, s.len);
      const cx = s.ax + s.dx * t, cz = s.az + s.dz * t;
      const d = Math.hypot(x - cx, z - cz);
      if (d < bd) { bd = d; bh = U.lerp(s.ha, s.hb, t / s.len); }
    }
    return { d: bd, h: bh };
  },

  /* výška terénu bez zákopů (používá se i při stavbě) */
  baseHeight(x, z) {
    let h = this.rawHills(x, z);
    let padK = 0;
    for (const p of this.PADS) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r) {
        const k = 1 - U.smoothstep(p.r * 0.55, p.r, d);
        h = U.lerp(h, p.h, k * 0.96);
        padK = Math.max(padK, k);
      }
    }
    const ri = this.roadInfo(x, z);
    if (ri.d < 22) {
      const k = (1 - U.smoothstep(6, 22, ri.d)) * (1 - padK) * 0.85;
      h = U.lerp(h, ri.h, k);
    }
    return h;
  },

  groundHeight(x, z) {
    return this.baseHeight(x, z);
  },

  /* barva povrchu (terén + minimapa) */
  PAINTS: [
    { x: 0, z: 620, r: 10, c: [0.35, 0.33, 0.30] },
    { x: 100, z: -290, r: 9, c: [0.32, 0.31, 0.29] },
    { x: -75, z: -218, r: 15, c: [0.42, 0.41, 0.38] },
    { x: 120, z: -352, r: 13, c: [0.40, 0.38, 0.35] },
    { x: 540, z: -505, r: 62, c: [0.42, 0.40, 0.36] },
  ],
  CRATERS: [
    [30, -140, 6], [60, -250, 5], [-40, -330, 7], [90, -310, 4], [180, -200, 8],
    [-150, -150, 5], [240, -60, 9], [-260, -40, 7], [10, 80, 6], [-80, 300, 8],
    [120, 420, 5], [-200, 470, 7], [420, -120, 6], [-420, -320, 5], [650, -150, 8],
  ],

  groundColorAt(x, z, h) {
    if (h === undefined) h = this.groundHeight(x, z);
    const moist = fbm(this.n3, x * 0.0055 + 7, z * 0.0055 - 13, 3);
    const dirt = fbm(this.n4, x * 0.02 - 3, z * 0.02 + 5, 2);
    let r = U.lerp(0.62, 0.44, U.smoothstep(-0.32, 0.32, moist));
    let g = U.lerp(0.55, 0.47, U.smoothstep(-0.32, 0.32, moist));
    let b = U.lerp(0.37, 0.27, U.smoothstep(-0.32, 0.32, moist));
    const dk = U.smoothstep(0.22, 0.55, dirt) * 0.55;
    r = U.lerp(r, 0.40, dk); g = U.lerp(g, 0.35, dk); b = U.lerp(b, 0.26, dk);
    if (h > 24) {
      const rk = U.smoothstep(24, 52, h);
      r = U.lerp(r, 0.52, rk); g = U.lerp(g, 0.50, rk); b = U.lerp(b, 0.47, rk);
    }
    /* silnice */
    const ri = this.roadInfo(x, z);
    if (ri.d < 6.5) {
      const k = (1 - U.smoothstep(3.4, 6.5, ri.d)) * 0.85;
      r = U.lerp(r, 0.34, k); g = U.lerp(g, 0.32, k); b = U.lerp(b, 0.29, k);
    }
    /* beton základny */
    const bx = Math.max(Math.abs(x) - 150, 0) / 60, bz = Math.max(Math.abs(z + 280) - 100, 0) / 60;
    const bd = Math.hypot(bx, bz);
    if (bd < 1.15) {
      const k = (1 - U.smoothstep(0.55, 1.15, bd)) * 0.8;
      r = U.lerp(r, 0.47, k); g = U.lerp(g, 0.46, k); b = U.lerp(b, 0.43, k);
    }
    /* natřené plochy */
    for (const p of this.PAINTS) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r) {
        const k = 1 - U.smoothstep(p.r * 0.7, p.r, d);
        r = U.lerp(r, p.c[0], k * 0.9); g = U.lerp(g, p.c[1], k * 0.9); b = U.lerp(b, p.c[2], k * 0.9);
      }
    }
    /* krátery */
    for (const c of this.CRATERS) {
      const d = Math.hypot(x - c[0], z - c[1]);
      if (d < c[2]) {
        const k = 1 - U.smoothstep(c[2] * 0.25, c[2], d);
        r = U.lerp(r, 0.17, k * 0.8); g = U.lerp(g, 0.155, k * 0.8); b = U.lerp(b, 0.13, k * 0.8);
      }
    }
    return [r, g, b];
  },

  /* ---------- zákopy ---------- */
  trenchDist(x, z, tr) {
    let best = 1e9;
    const p = tr.pts;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], bx = p[i + 1][0], bz = p[i + 1][1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1e-6;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = t < 0 ? 0 : (t > 1 ? 1 : t);
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) best = d;
    }
    return best;
  },

  nearTrench(x, z, m) {
    for (const tr of this.TRENCHES) if (this.trenchDist(x, z, tr) < m) return true;
    return false;
  },

  /* rozdělení zákopu na úseky (vynechá konce = vstupy) */
  trenchChunks(tr, step, trim) {
    const out = [];
    const lens = [];
    let total = 0;
    for (let i = 0; i < tr.pts.length - 1; i++) {
      const a = tr.pts[i], b = tr.pts[i + 1];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      lens.push(l); total += l;
    }
    let acc = 0;
    for (let i = 0; i < tr.pts.length - 1; i++) {
      const a = tr.pts[i], b = tr.pts[i + 1];
      const len = lens[i];
      const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
      for (let s = 0; s < len - 0.01; s += step) {
        const L = Math.min(step, len - s);
        const mid = acc + s + L * 0.5;
        if (mid > trim && mid < total - trim) {
          out.push({ x: a[0] + ux * (s + L * 0.5), z: a[1] + uz * (s + L * 0.5), ux, uz, len: L });
        }
      }
      acc += len;
    }
    return out;
  },

  buildTrenches(scene) {
    const wallM = [], bermM = [], floorM = [], plankM = [], bagM = [], propM = [];
    const q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3(), eu = new THREE.Euler();
    const put = (arr, x, y, z, ry, sx, sy, sz) => {
      q.setFromEuler(eu.set(0, ry, 0));
      arr.push(new THREE.Matrix4().compose(pv.set(x, y, z), q, sv.set(sx, sy, sz)));
    };
    for (const tr of this.TRENCHES) {
      const half = tr.w * 0.5;
      const chunks = this.trenchChunks(tr, 5.2, 4.2);
      chunks.forEach((c, ci) => {
        const nx = -c.uz, nz = c.ux;
        const rot = Math.atan2(-c.uz, c.ux);
        const gy = this.groundHeight(c.x, c.z);
        const top = gy + tr.h;
        for (const sgn of [-1, 1]) {
          /* vnitřní stěna zákopu */
          const ox = c.x + nx * (half + 0.45) * sgn;
          const oz = c.z + nz * (half + 0.45) * sgn;
          put(wallM, ox, top - (tr.h + 0.75) / 2, oz, rot, c.len + 1.8, tr.h + 0.75, 0.9);
          /* vnější hliněný val */
          const bx = c.x + nx * (half + 1.55) * sgn;
          const bz = c.z + nz * (half + 1.55) * sgn;
          put(bermM, bx, gy + 0.16, bz, rot, c.len + 0.75, 0.5, 1.6);
          /* pytle s pískem na hraně */
          for (let k = -1; k <= 1; k++) {
            put(bagM, ox + c.ux * k * 1.7, top + 0.13, oz + c.uz * k * 1.7, rot + (k * 0.05), 0.8, 0.26, 0.42);
          }
          /* kolizní segment stěny */
          this.walls.push({
            ax: ox - c.ux * (c.len * 0.5 + 0.8), az: oz - c.uz * (c.len * 0.5 + 0.8),
            bx: ox + c.ux * (c.len * 0.5 + 0.8), bz: oz + c.uz * (c.len * 0.5 + 0.8),
            r: 0.65, y0: gy - 1.0, y1: top,
          });
        }
        /* zpevněná podlaha + prkna */
        put(floorM, c.x, gy + 0.03, c.z, rot, c.len + 0.15, 0.09, tr.w - 0.2);
        if (ci % 2 === 0) put(plankM, c.x, gy + 0.1, c.z, rot, c.len - 0.4, 0.08, 1.15);
        /* občas bedna s municí / sud u stěny */
        if (ci % 3 === 1) {
          const sgn = ci % 2 ? 1 : -1;
          put(propM, c.x + nx * (half - 0.55) * sgn, gy + 0.35, c.z + nz * (half - 0.55) * sgn,
            rot + 0.3, 0.75, 0.7, 0.55);
        }
      });
      /* rohové sloupky v ohybech */
      for (let i = 1; i < tr.pts.length - 1; i++) {
        const v = tr.pts[i], va = tr.pts[i - 1], vb = tr.pts[i + 1];
        const d1x = v[0] - va[0], d1z = v[1] - va[1];
        const d2x = vb[0] - v[0], d2z = vb[1] - v[1];
        const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
        let bxx = -d1z / l1 + -d2z / l2, bzz = d1x / l1 + d2x / l2;
        const bl = Math.hypot(bxx, bzz) || 1;
        bxx /= bl; bzz /= bl;
        const gy = this.groundHeight(v[0], v[1]);
        const top = gy + tr.h;
        for (const sgn of [-1, 1]) {
          const px = v[0] + bxx * (half + 0.45) * sgn;
          const pz = v[1] + bzz * (half + 0.45) * sgn;
          put(wallM, px, top - (tr.h + 0.75) / 2, pz, 0, 1.9, tr.h + 0.75, 1.9);
          put(bagM, px, top + 0.13, pz, 0.4, 1.2, 0.26, 0.8);
          this.colliders.push({ x: px, z: pz, r: 0.95, y: gy - 1.0, h: tr.h + 0.5, t: null, mover: null });
        }
      }
    }
    const mkIM = (color, list, shadow) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.97, metalness: 0 }), list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = !!shadow;
      im.receiveShadow = true;
      scene.add(im);
    };
    mkIM(0x4b3d2b, wallM, true);
    mkIM(0x5a4a34, bermM, true);
    mkIM(0x6d6252, floorM, false);
    mkIM(0x6b5638, plankM, false);
    mkIM(0x8b7d5b, bagM, true);
    mkIM(0x51462f, propM, true);
  },

  /* =================  STAVBA SVĚTA  ================= */
  stdMat(c) { return new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.95, metalness: 0 }); },
  matC(c) { if (!this._matCache.has(c)) this._matCache.set(c, this.stdMat(c)); return this._matCache.get(c); },
  box(w, h, d, c) { return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.matC(c)); },
  cyl(rt, rb, h, c, seg = 8) { return new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), this.matC(c)); },
  cone(r, h, c, seg = 6) { return new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), this.matC(c)); },
  prism(w, h, d, c) { // sedlová střecha
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(0, h); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return new THREE.Mesh(g, this.matC(c));
  },

  addCollider(x, z, r, h, t) {
    this.colliders.push({ x, z, r, y: this.groundHeight(x, z), h, t: t || null, mover: null });
  },

  build(scene) {
    this.scene = scene;
    this._initGeo();

    /* ---- terén ---- */
    const SIZE = 2400, SEG = 150;
    const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = this.groundHeight(x, z);
      pos.setY(i, h);
      const c = this.groundColorAt(x, z, h);
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, flatShading: true, roughness: 1, metalness: 0,
    }));
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    scene.add(terrain);

    /* ---- nebe ---- */
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(3200, 24, 14),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { uSun: { value: this.sunDir } },
        vertexShader: `varying vec3 vDir; void main(){ vDir=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `
          varying vec3 vDir; uniform vec3 uSun;
          void main(){
            vec3 d=normalize(vDir);
            float h=clamp(d.y,-0.08,1.0);
            vec3 col=mix(vec3(0.91,0.79,0.62), vec3(0.47,0.61,0.79), pow(max(h,0.0),0.6));
            float s=max(dot(d,uSun),0.0);
            col += vec3(1.0,0.62,0.30)*pow(s,7.0)*0.35;
            col += vec3(1.0,0.85,0.60)*pow(s,700.0)*1.4;
            gl_FragColor=vec4(col,1.0);
          }`,
      })
    );
    sky.frustumCulled = false; sky.renderOrder = -10;
    scene.add(sky);

    /* ---- světla ---- */
    const hemi = new THREE.HemisphereLight(0x9db8d8, 0x5c5a44, 0.55);
    scene.add(hemi);
    const light = this.light = new THREE.DirectionalLight(0xffd7a8, 1.25);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    const sc = light.shadow.camera;
    sc.left = -140; sc.right = 140; sc.top = 140; sc.bottom = -140; sc.near = 5; sc.far = 1600;
    light.shadow.bias = -0.0006;
    scene.add(light); scene.add(light.target);

    /* ---- objekty ---- */
    this.buildBase(scene);
    this.buildHome(scene);
    this.buildTrenches(scene);
    this.buildDepotEast(scene);
    this.buildOutposts(scene);
    this.buildTargets(scene);
    this.buildSoldiers(scene);
    this.buildCrates(scene);
    this.buildVegetation(scene);
    this.buildPowerLines(scene);
    this.buildAmbientWrecks(scene);

    this.targetsTotal = this.targets.length;
    this.targetsAlive = this.targets.length;
    this.home.y = this.groundHeight(this.home.x, this.home.z);
  },

  /* ---------- základna ---------- */
  buildBase(scene) {
    const add = (m, x, z, ry = 0) => {
      m.position.set(x, this.groundHeight(x, z), z);
      m.rotation.y = ry;
      m.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(m); return m;
    };

    /* obvodová zeď (s branami) */
    const wallC = 0x8a8578;
    const seg = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 10));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = U.lerp(x0, x1, t), z = U.lerp(z0, z1, t);
        const m = this.box(10.2, 2.6, 0.8, wallC);
        m.position.set(x, this.groundHeight(x, z) + 1.3, z);
        m.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
        m.castShadow = m.receiveShadow = true;
        scene.add(m);
        this.addCollider(x, z, 5.2, 2.6);
      }
    };
    // jih (brána uprostřed), východ (brána), sever, západ
    for (const [x0, z0, x1, z1] of [
      [-160, -170, -9, -170], [9, -170, 160, -170],
      [160, -390, 160, -288], [160, -272, 160, -170],
      [-160, -390, 160, -390],
      [-160, -390, -160, -170],
    ]) seg(x0, z0, x1, z1);

    /* strážní věže */
    const tower = (x, z) => {
      const g = new THREE.Group();
      for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
        const leg = this.cyl(0.12, 0.16, 6, 0x6d6452, 5);
        leg.position.set(lx, 3, lz); g.add(leg);
      }
      const plat = this.box(3.4, 0.35, 3.4, 0x7a7466); plat.position.y = 6; g.add(plat);
      for (const [wx, wz, ww, dd] of [[0, 1.55, 3.4, 0.25], [0, -1.55, 3.4, 0.25], [1.55, 0, 0.25, 3.4], [-1.55, 0, 0.25, 3.4]]) {
        const wl = this.box(ww, 0.9, dd, 0x847d6d); wl.position.set(wx, 6.7, wz); g.add(wl);
      }
      const roof = this.prism(3.8, 1.1, 3.8, 0x5c5648); roof.position.y = 7.2; g.add(roof);
      add(g, x, z);
      this.addCollider(x, z, 2.6, 7.5);
    };
    tower(-160, -390); tower(160, -390); tower(-160, -170); tower(160, -170);

    /* kasárna ×3 */
    const barrack = (x, z, ry) => {
      const g = new THREE.Group();
      const b = this.box(6, 3, 14, 0x9a8f72); b.position.y = 1.5; g.add(b);
      const r = this.prism(6.6, 1.6, 14.6, 0x6b6152); r.position.y = 3; g.add(r);
      for (let i = -2; i <= 2; i++) {
        const w = this.box(0.1, 0.8, 1.1, 0x2c3438); w.position.set(3.02, 1.9, i * 2.4); g.add(w);
        const w2 = w.clone(); w2.position.x = -3.02; g.add(w2);
      }
      add(g, x, z, ry);
      this.addCollider(x, z, 6.4, 4.5);
    };
    barrack(-95, -245, Math.PI / 2); barrack(-95, -280, Math.PI / 2); barrack(-95, -315, Math.PI / 2);

    /* velitelství / cíl 11 */
    const cmd = new THREE.Group();
    const c1 = this.box(11, 3.4, 8, 0x8d8674); c1.position.y = 1.7; cmd.add(c1);
    const c2 = this.box(6, 2.8, 6, 0x827b69); c2.position.set(1.5, 4.8, -0.5); cmd.add(c2);
    const cr = this.prism(11.6, 1.2, 8.6, 0x5f5949); cr.position.y = 3.4; cmd.add(cr);
    const cr2 = this.prism(6.6, 0.9, 6.6, 0x5f5949); cr2.position.set(1.5, 6.2, -0.5); cmd.add(cr2);
    for (let i = -2; i <= 2; i++) {
      const w = this.box(0.1, 1.0, 1.4, 0x2c3438); w.position.set(5.52, 2.0, i * 1.9); cmd.add(w);
    }
    const door = this.box(0.12, 2.0, 1.2, 0x23201a); door.position.set(5.52, 1.0, 3.2); cmd.add(door);
    const ant = this.cyl(0.06, 0.09, 7, 0x4c4f48, 5); ant.position.set(-4.2, 7, -2.6); cmd.add(ant);
    this._cmdGroup = add(cmd, 0, -290);

    /* motor pool — krytá stání */
    const shelter = new THREE.Group();
    const roofS = this.box(20, 0.4, 9, 0x6f6959); roofS.position.y = 5.2; shelter.add(roofS);
    for (const [px, pz] of [[-9.5, -4], [9.5, -4], [-9.5, 4], [9.5, 4]]) {
      const p = this.cyl(0.16, 0.2, 5.2, 0x6d6452, 5); p.position.set(px, 2.6, pz); shelter.add(p);
    }
    add(shelter, -70, -218);
    this.addCollider(-70, -218, 3.2, 5.5); // jen sloupy — vozidla mají vlastní

    /* hangár + helipad */
    const hangarGeo = new THREE.CylinderGeometry(6, 6, 16, 12, 1, true, 0, Math.PI);
    hangarGeo.rotateZ(Math.PI / 2);
    const hangar = new THREE.Mesh(hangarGeo, new THREE.MeshStandardMaterial({ color: 0x7d5f42, flatShading: true, roughness: 0.9, side: THREE.DoubleSide }));
    hangar.rotation.y = Math.PI / 2;
    const hg = new THREE.Group(); hg.add(hangar);
    const slab = this.box(16, 0.3, 13, 0x6f6a5f); slab.position.y = 0.15; hg.add(slab);
    add(hg, 130, -262);
    this.addCollider(130, -262, 7.5, 5);
    const helipad = this.cyl(8, 8, 0.06, 0x4c4a44, 20); helipad.position.set(100, this.groundHeight(100, -290) + 0.08, -290);
    scene.add(helipad);
    const h1 = this.box(0.5, 0.05, 4.4, 0xd8d4c8); h1.position.set(100, this.groundHeight(100, -290) + 0.15, -290); scene.add(h1);
    const h2 = this.box(2.6, 0.05, 0.5, 0xd8d4c8); h2.position.copy(h1.position); scene.add(h2);

    /* stany + vybavení */
    const tent = (x, z, ry) => {
      const g = new THREE.Group();
      const t = this.prism(4.2, 2.0, 6, 0x6a6d52); t.position.y = 0.05; g.add(t);
      add(g, x, z, ry);
      this.addCollider(x, z, 3, 2.2);
      return g;
    };
    tent(45, -345, 0.3); tent(52, -340, -0.2); tent(-140, -250, 1.2);

    /* palivové sudy, bedny */
    for (let i = 0; i < 5; i++) {
      const d = this.cyl(0.35, 0.35, 0.9, i % 2 ? 0x8a5a3a : 0x5c6152, 8);
      const x = 92 + (i % 3) * 1.1, z = -362 - Math.floor(i / 3) * 1.1;
      d.position.set(x, this.groundHeight(x, z) + 0.45, z); d.castShadow = true;
      scene.add(d);
    }
    this.addCollider(93, -363, 2.2, 1);

    /* pytle na branách + zauzení tanku */
    this.sandbags(0, -166, 6, Math.PI, Math.PI * 1.5, 10);
    this.sandbags(22, -140, 5, Math.PI * 0.75, Math.PI * 1.35, 9);
    this.sandbags(164, -280, 6, -Math.PI / 2, Math.PI / 2, 10);
  },

  sandbags(cx, cz, r, a0, a1, n) {
    const y = this.groundHeight(cx, cz);
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const a = U.lerp(a0, a1, i / (n - 1));
      for (let row = 0; row < 2; row++) {
        const s = this.box(0.62, 0.28, 0.4, 0x8f8672);
        s.position.set(cx + Math.cos(a) * r, y + 0.16 + row * 0.28, cz + Math.sin(a) * r);
        s.rotation.y = -a + Math.PI / 2;
        s.castShadow = true;
        g.add(s);
      }
    }
    this.scene.add(g);
    this.addCollider(cx, cz, r + 0.5, 0.7);
  },

  /* ---------- startovní tábor ---------- */
  buildHome(scene) {
    const { x, z } = this.home;
    const y = this.groundHeight(x, z);
    this.home.y = y;

    const pad = this.cyl(9, 9, 0.05, 0x55524a, 24);
    pad.position.set(x, y + 0.06, z); scene.add(pad);
    const ha = this.box(0.4, 0.04, 4, 0xe8e4d8); ha.position.set(x, y + 0.13, z); scene.add(ha);
    const hb = this.box(2.4, 0.04, 0.4, 0xe8e4d8); hb.position.set(x, y + 0.13, z); scene.add(hb);

    /* stan GCS */
    const g = new THREE.Group();
    const t = this.prism(4.4, 2.2, 6.5, 0x5d6148); t.position.y = 0.05; g.add(t);
    g.position.set(x + 10, this.groundHeight(x + 10, z - 3), z - 3);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; });
    scene.add(g);
    this.addCollider(x + 10, z - 3, 3.2, 2.4);

    /* trojnožková anténa */
    const ant = new THREE.Group();
    for (const a of [0, 2.1, 4.2]) {
      const leg = this.cyl(0.05, 0.06, 4.4, 0x4c4f48, 5);
      leg.position.set(Math.cos(a) * 0.7, 2, Math.sin(a) * 0.7);
      leg.rotation.z = Math.cos(a) * 0.16; leg.rotation.x = Math.sin(a) * 0.16;
      ant.add(leg);
    }
    const box = this.box(0.5, 0.3, 0.4, 0x3a3d38); box.position.y = 4.3; ant.add(box);
    ant.position.set(x - 9, this.groundHeight(x - 9, z + 3), z + 3);
    scene.add(ant);
    this.addCollider(x - 9, z + 3, 0.8, 4.5);

    /* generátor + bedny + větrný rukáv */
    const gen = this.box(1.6, 1.1, 1.0, 0x5c6152);
    gen.position.set(x + 12, this.groundHeight(x + 12, z + 6) + 0.55, z + 6); gen.castShadow = true; scene.add(gen);
    this.addCollider(x + 12, z + 6, 1.2, 1.2);
    for (let i = 0; i < 3; i++) {
      const cr = this.box(1.0, 0.7, 1.2, 0x6d6452);
      cr.position.set(x - 11 + i * 1.3, this.groundHeight(x - 11 + i * 3, z + 9) + 0.35, z + 9 + i * 0.4);
      cr.rotation.y = U.rand(-0.4, 0.4); cr.castShadow = true; scene.add(cr);
    }
    const pole = this.cyl(0.05, 0.07, 5, 0x4c4f48, 5);
    pole.position.set(x - 8, y + 2.5, z + 11); scene.add(pole);
    const sock = this.cone(0.35, 1.6, 0xd97b2f, 6);
    sock.rotation.x = Math.PI / 2;
    sock.position.set(x - 8, y + 4.9, z + 11.8); scene.add(sock);
    this.addCollider(x - 8, z + 11, 0.4, 5);
  },

  /* ---------- východní sklad (SAM + municí) ---------- */
  buildDepotEast(scene) {
    const x = 555, z = -505;
    const berm = (bx, bz, w, ry) => {
      const b = this.box(w, 2.2, 3.4, 0x4c4436);
      b.position.set(bx, this.groundHeight(bx, bz) + 1.1, bz);
      b.rotation.y = ry; b.castShadow = true; scene.add(b);
      this.addCollider(bx, bz, Math.max(w, 3.4) * 0.55, 2.2);
    };
    berm(x - 30, z - 28, 46, 0.5); berm(x + 30, z - 30, 40, -0.3); berm(x - 34, z + 22, 40, 1.1);
    /* strážní bouda */
    const hut = this.box(3, 2.4, 3, 0x7a7466);
    hut.position.set(x - 20, this.groundHeight(x - 20, z) + 1.2, z); hut.castShadow = true; scene.add(hut);
    this.addCollider(x - 20, z, 2.4, 2.4);
  },

  /* ---------- předsunutá postavení ---------- */
  buildOutposts(scene) {
    /* AA pozice na západě — písečné valy */
    this.sandbags(-480, -160, 6, 0, Math.PI * 2, 12);
    /* radarový kopec — betonová deska */
    const rx = 185, rz = -620;
    const slab = this.cyl(9, 9, 0.4, 0x7d7a72, 18);
    slab.position.set(rx, this.groundHeight(rx, rz) + 0.2, rz); scene.add(slab);
    this.addCollider(rx, rz, 2.0, 0.6);
  },

  /* ---------- cíle ---------- */
  buildTargets(scene) {
    const T = (name, points, build, x, z, opts = {}) => {
      const group = typeof build === 'function' ? build() : build;
      const y = this.groundHeight(x, z);
      group.position.set(x, y, z);
      group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(group);
      const t = {
        name, points, group, alive: true,
        hitR: opts.hitR || 4,
        pos: new THREE.Vector3(x, y + (opts.hitY || 1.2), z),
        secondary: opts.secondary || null,
        orig: { x, y, z, ry: group.rotation.y },
      };
      this.targets.push(t);
      if (!opts.mover) this.addCollider(x, z, opts.colR || 2.6, opts.colH || 2.6, t);
      return t;
    };

    /* -- tanky -- */
    const mkTank = () => {
      const g = new THREE.Group();
      const hull = this.box(2.7, 0.95, 6.4, 0x5f6b4a); hull.position.y = 1.05; g.add(hull);
      const glacis = this.box(2.7, 0.9, 1.8, 0x55614a); glacis.position.set(0, 0.72, -2.9); glacis.rotation.x = -0.5; g.add(glacis);
      const turret = this.cyl(1.0, 1.25, 0.62, 0x57634c, 10); turret.position.set(0, 1.8, -0.3); g.add(turret);
      const barb = this.box(2.2, 0.35, 2.0, 0x57634c); barb.position.set(0, 1.55, -0.3); g.add(barb);
      const barrel = this.cyl(0.09, 0.11, 3.6, 0x3d4236, 6);
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 1.85, -3.0); g.add(barrel);
      const mg = this.cyl(0.05, 0.05, 0.9, 0x3d4236, 5);
      mg.rotation.x = Math.PI / 2; mg.position.set(0.55, 2.25, -1.1); g.add(mg);
      for (const s of [-1, 1]) {
        const track = this.box(0.72, 0.85, 6.6, 0x33352f); track.position.set(s * 1.32, 0.55, 0); g.add(track);
        const skirt = this.box(0.5, 0.5, 6.6, 0x4c5638); skirt.position.set(s * 1.05, 1.15, 0); g.add(skirt);
      }
      const hatch = this.cyl(0.4, 0.4, 0.15, 0x4c5638, 8); hatch.position.set(0.3, 2.15, 0.6); g.add(hatch);
      return g;
    };
    T('TANK', 100, mkTank, -60, -208, { hitR: 4.4, hitY: 1.4, colR: 3.2, colH: 2.6 });                    // 2
    const dug = T('TANK', 100, mkTank, 22, -140, { hitR: 4.4, hitY: 1.4, colR: 3.2, colH: 2.6 });        // 3
    dug.group.rotation.y = 0.3; dug.orig.ry = 0.3;

    /* -- APC -- */
    const mkAPC = () => {
      const g = new THREE.Group();
      const hull = this.box(2.4, 1.3, 5.6, 0x66705a); hull.position.y = 1.15; g.add(hull);
      const nose = this.box(2.4, 1.0, 1.4, 0x5c6650); nose.position.set(0, 0.85, -3.1); nose.rotation.x = -0.42; g.add(nose);
      const tur = this.cyl(0.55, 0.75, 0.5, 0x5c6650, 8); tur.position.set(0, 2.05, -0.6); g.add(tur);
      const gun = this.cyl(0.05, 0.05, 1.6, 0x3d4236, 5); gun.rotation.x = Math.PI / 2; gun.position.set(0, 2.05, -1.7); g.add(gun);
      for (const [wx, wz] of [[-1.05, -1.8], [1.05, -1.8], [-1.05, 1.8], [1.05, 1.8]]) {
        const wh = this.cyl(0.55, 0.55, 0.42, 0x2a2a28, 10);
        wh.rotation.z = Math.PI / 2; wh.position.set(wx, 0.55, wz); g.add(wh);
      }
      return g;
    };
    T('BTR', 80, mkAPC, -100, -232, { hitR: 3.8, hitY: 1.3, colR: 2.9, colH: 2.4 });                      // 4

    /* -- muniční truck -- */
    const mkTruck = () => {
      const g = new THREE.Group();
      const ch = this.box(2.3, 0.5, 6.4, 0x3d4236); ch.position.y = 0.85; g.add(ch);
      const cab = this.box(2.2, 1.3, 1.8, 0x6a7458); cab.position.set(0, 1.7, -2.3); g.add(cab);
      const glass = this.box(2.0, 0.5, 0.1, 0x2c3438); glass.position.set(0, 1.9, -3.15); g.add(glass);
      const bed = this.box(2.3, 1.5, 4.2, 0x8a8272); bed.position.set(0, 1.7, 1.0); g.add(bed);
      const canv = this.prism(2.5, 1.0, 4.2, 0x7d7566); canv.position.set(0, 2.45, 1.0); g.add(canv);
      for (const [wx, wz] of [[-1.05, -2.2], [1.05, -2.2], [-1.05, 0.6], [1.05, 0.6], [-1.05, 2.4], [1.05, 2.4]]) {
        const wh = this.cyl(0.55, 0.55, 0.4, 0x2a2a28, 10);
        wh.rotation.z = Math.PI / 2; wh.position.set(wx, 0.55, wz); g.add(wh);
      }
      return g;
    };
    const truckT = T('MUNICE', 80, mkTruck, -35, -240, { hitR: 4.0, hitY: 1.5, colR: 3.2, colH: 3.2 });
    truckT.secondary = [
      { pos: truckT.pos.clone().add(new THREE.Vector3(0, 1, 0)), delay: 0.30, power: 0.8 },
      { pos: truckT.pos.clone().add(new THREE.Vector3(0, 2, 1)), delay: 0.55, power: 0.9 },
    ];

    /* -- palivová základna (řetězová exploze) -- */
    const mkFuel = () => {
      const g = new THREE.Group();
      const mk = (x, z) => {
        const cradle = this.box(1.2, 0.7, 9.6, 0x4c4436); cradle.position.set(x, 0.35, z); g.add(cradle);
        const tank = this.cyl(2.1, 2.1, 9, 0x9a8a72, 12);
        tank.rotation.x = Math.PI / 2; tank.position.set(x, 2.2, z); g.add(tank);
        const band = this.cyl(2.16, 2.16, 0.55, 0xc7742a, 12);
        band.rotation.x = Math.PI / 2; band.position.set(x, 2.2, z + 3.4); g.add(band);
        const cap = this.cyl(0.3, 0.3, 0.5, 0x4c4f48, 8); cap.position.set(x, 4.35, z - 2.5); g.add(cap);
      };
      mk(-4.2, 0); mk(4.2, -1.5); mk(0, 4.5);
      const pipe = this.cyl(0.14, 0.14, 8, 0x6d7268, 6);
      pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 1.0, 1.5); g.add(pipe);
      const pump = this.box(1.4, 1.2, 1.0, 0x5c6152); pump.position.set(0, 0.6, 8.2); g.add(pump);
      return g;
    };
    const fuelT = T('PALIVO', 150, mkFuel, 120, -352, { hitR: 7, hitY: 2, colR: 6.5, colH: 4.5 });
    fuelT.secondary = [
      { pos: fuelT.pos.clone().add(new THREE.Vector3(-4.2, 1.6, 0)), delay: 0.35, power: 1.3 },
      { pos: fuelT.pos.clone().add(new THREE.Vector3(4.2, 1.6, -1.5)), delay: 0.75, power: 1.5 },
      { pos: fuelT.pos.clone().add(new THREE.Vector3(0, 1.6, 4.5)), delay: 1.15, power: 1.7 },
    ];

    /* -- radar -- */
    const mkRadar = () => {
      const g = new THREE.Group();
      const base = this.box(3.2, 1.6, 3.2, 0x7d7a72); base.position.y = 0.8; g.add(base);
      const mast = this.cyl(0.28, 0.4, 8.5, 0x6d7268, 6); mast.position.y = 5.6; g.add(mast);
      const plat = this.box(2.2, 0.3, 2.2, 0x5c6152); plat.position.y = 9.9; g.add(plat);
      const dishG = new THREE.Group(); dishG.position.y = 10.4;
      const dish = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 12, 6, 0, Math.PI * 2, 0, 0.62),
        new THREE.MeshStandardMaterial({ color: 0x9aa39a, flatShading: true, roughness: 0.85, side: THREE.DoubleSide })
      );
      dish.rotation.x = -0.9; dishG.add(dish);
      const feed = this.cyl(0.06, 0.06, 2.2, 0x4c4f48, 5);
      feed.rotation.x = Math.PI / 2 - 0.9; feed.position.set(0, 0.5, 0.8); dishG.add(feed);
      g.add(dishG);
      g.userData.dish = dishG;
      const ladder = this.box(0.5, 8, 0.12, 0x5c6152); ladder.position.set(1.2, 4.8, 0); g.add(ladder);
      return g;
    };
    T('RADAR', 120, mkRadar, 185, -620, { hitR: 4.6, hitY: 4, colR: 2.4, colH: 10 });                    // 8

    /* -- SAM -- */
    const mkSAM = () => {
      const g = new THREE.Group();
      const ch = this.box(2.4, 0.5, 6.6, 0x3d4236); ch.position.y = 0.9; g.add(ch);
      const cab = this.box(2.2, 1.2, 1.8, 0x6a7458); cab.position.set(0, 1.75, -2.5); g.add(cab);
      const radome = this.box(1.6, 0.9, 1.2, 0x5c6152); radome.position.set(0, 2.6, -2.5); g.add(radome);
      const rack = this.box(2.6, 0.4, 3.4, 0x4c5240); rack.position.set(0, 1.7, 1.2); rack.rotation.x = -0.35; g.add(rack);
      for (let i = 0; i < 4; i++) {
        const m = this.cyl(0.28, 0.28, 3.4, 0x8f9585, 8);
        m.rotation.x = Math.PI / 2 - 0.35;
        m.position.set(-0.8 + (i % 2) * 1.6, 2.2 + Math.floor(i / 2) * 0.75, 1.9 + Math.floor(i / 2) * 0.35);
        g.add(m);
        const tip = this.cone(0.28, 0.7, 0xc7742a, 8);
        tip.rotation.x = -Math.PI / 2 - 0.35;
        tip.position.set(-0.8 + (i % 2) * 1.6, 2.2 + Math.floor(i / 2) * 0.75 + 0.22, 3.85 + Math.floor(i / 2) * 0.3);
        g.add(tip);
      }
      for (const [wx, wz] of [[-1.1, -2.4], [1.1, -2.4], [-1.1, 0.8], [1.1, 0.8], [-1.1, 2.6], [1.1, 2.6]]) {
        const wh = this.cyl(0.55, 0.55, 0.42, 0x2a2a28, 10); wh.rotation.z = Math.PI / 2; wh.position.set(wx, 0.55, wz); g.add(wh);
      }
      return g;
    };
    T('SAM', 150, mkSAM, 560, -490, { hitR: 4.2, hitY: 1.6, colR: 3.4, colH: 3.4 });                     // 9

    /* -- AA kanón -- */
    const mkAA = () => {
      const g = new THREE.Group();
      const ring = this.cyl(1.8, 1.9, 0.5, 0x6d6452, 12); ring.position.y = 0.25; g.add(ring);
      const mount = this.cyl(0.5, 0.7, 1.1, 0x5c6152, 8); mount.position.y = 1.0; g.add(mount);
      const seat = this.box(0.6, 0.5, 0.5, 0x3d4236); seat.position.set(-0.8, 1.6, 0.9); g.add(seat);
      const shield = this.box(1.8, 1.0, 0.15, 0x66705a); shield.position.set(0, 1.9, -0.9); shield.rotation.x = 0.25; g.add(shield);
      for (const s of [-1, 1]) {
        const b = this.cyl(0.09, 0.11, 2.8, 0x3d4236, 6);
        b.rotation.x = Math.PI / 2 - 0.5; b.position.set(s * 0.28, 2.15, -1.6); g.add(b);
      }
      const mag = this.box(0.9, 0.7, 0.9, 0x66705a); mag.position.set(0.9, 1.7, 0.6); g.add(mag);
      return g;
    };
    T('AA KANON', 100, mkAA, -480, -160, { hitR: 3.4, hitY: 1.4, colR: 2.4, colH: 2.8 });                // 10

    /* -- vrtulník -- */
    const mkHeli = () => {
      const g = new THREE.Group();
      const fus = this.cyl(1.05, 1.15, 3.6, 0x5c6650, 10);
      fus.rotation.x = Math.PI / 2; fus.position.set(0, 1.75, -0.3); g.add(fus);
      const nose = new THREE.Mesh(new THREE.SphereGeometry(1.05, 10, 8), this.matC(0x5c6650));
      nose.position.set(0, 1.75, -2.1); nose.scale.set(1, 0.92, 1.15); g.add(nose);
      const glass = new THREE.Mesh(new THREE.SphereGeometry(0.95, 10, 8), this.matC(0x2c3438));
      glass.position.set(0, 1.85, -1.9); glass.scale.set(0.85, 0.7, 0.95); g.add(glass);
      const boom = this.cyl(0.28, 0.5, 3.6, 0x5c6650, 7);
      boom.rotation.x = Math.PI / 2; boom.position.set(0, 2.0, 2.4); g.add(boom);
      const fin = this.box(0.14, 1.2, 0.9, 0x5c6650); fin.position.set(0, 2.7, 4.0); g.add(fin);
      const tr = this.cyl(0.06, 0.06, 1.2, 0x3d4236, 5);
      tr.rotation.z = Math.PI / 2; tr.position.set(0.18, 2.6, 3.9); g.add(tr);
      const rotor = new THREE.Group(); rotor.position.set(0, 3.05, -0.3);
      const hub = this.cyl(0.22, 0.28, 0.5, 0x3d4236, 8); rotor.add(hub);
      for (const a of [0, Math.PI / 2]) {
        const blade = this.box(7.4, 0.06, 0.42, 0x2f332c);
        blade.rotation.y = a; rotor.add(blade);
      }
      g.add(rotor); g.userData.rotor = rotor;
      for (const s of [-1, 1]) {
        const skid = this.box(0.16, 0.14, 3.4, 0x3d4236); skid.position.set(s * 0.95, 0.25, -0.2); g.add(skid);
        const strut1 = this.box(0.12, 1.0, 0.12, 0x3d4236); strut1.position.set(s * 0.95, 0.75, -1.2); strut1.rotation.z = s * 0.25; g.add(strut1);
        const strut2 = this.box(0.12, 1.0, 0.12, 0x3d4236); strut2.position.set(s * 0.95, 0.75, 0.8); strut2.rotation.z = s * 0.25; g.add(strut2);
      }
      return g;
    };
    T('VRTULNIK', 150, mkHeli, 100, -290, { hitR: 4.6, hitY: 1.8, colR: 3.6, colH: 3.4 });               // 12

    /* -- muniční sklad -- */
    const mkAmmo = () => {
      const g = new THREE.Group();
      for (let i = 0; i < 14; i++) {
        const cr = this.box(1.1, 0.75, 1.5, i % 3 ? 0x6d6452 : 0x5c6152);
        const x = -6 + (i % 5) * 3.0 + U.rand(-0.15, 0.15);
        const z = -2 + Math.floor(i / 5) * 2.4 + U.rand(-0.15, 0.15);
        cr.position.set(x, 0.4 + (i >= 10 ? 0.78 : 0), z);
        cr.rotation.y = U.rand(-0.1, 0.1); g.add(cr);
      }
      const net = this.box(14, 0.1, 8, 0x4c5240); net.position.set(0, 1.6, 1); g.add(net);
      return g;
    };
    const ammoT = T('MUN. SKLAD', 100, mkAmmo, 525, -525, { hitR: 5.5, hitY: 1, colR: 5.2, colH: 2 });
    ammoT.secondary = [
      { pos: ammoT.pos.clone().add(new THREE.Vector3(-3, 1, 0)), delay: 0.4, power: 1.1 },
      { pos: ammoT.pos.clone().add(new THREE.Vector3(3, 1.5, 1)), delay: 0.8, power: 1.3 },
      { pos: ammoT.pos.clone().add(new THREE.Vector3(0, 2, -1)), delay: 1.25, power: 1.5 },
    ];

    /* -- velitelství (stávající budova) -- */
    T('VELENÍ', 150, this._cmdGroup, 0, -290, { hitR: 6.2, hitY: 2, colR: 6.4, colH: 8 });     // 11

    /* -- pohyblivé cíle -- */
    const perim = [];
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2;
      perim.push([Math.cos(a) * 250, -280 + Math.sin(a) * 205]);
    }
    this.addMover(T('TANK', 100, mkTank, 250, -280, { hitR: 4.4, hitY: 1.4, mover: true }), perim, 6, 'loop');     // 1
    this.addMover(T('BTR', 80, mkAPC, 558, -490, { hitR: 3.8, hitY: 1.3, mover: true }), this.ROAD_E.concat().reverse(), 7.5, 'pingpong'); // 5

    /* druhý tank — obíhá základnu proti směru hodinových ručiček */
    const perim2 = [];
    for (let i = 9; i >= 0; i--) {
      const a = i / 10 * Math.PI * 2;
      perim2.push([Math.cos(a) * 292, -280 + Math.sin(a) * 246]);
    }
    this.addMover(T('TANK', 100, mkTank, 292, -280, { hitR: 4.4, hitY: 1.4, mover: true }), perim2, 5.2, 'loop');

    /* druhá BTR — hlídka kolem východního skladu */
    const depotLoop = [];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      depotLoop.push([545 + Math.cos(a) * 40, -505 + Math.sin(a) * 34]);
    }
    this.addMover(T('BTR', 80, mkAPC, 585, -505, { hitR: 3.8, hitY: 1.3, mover: true }), depotLoop, 7, 'loop');

    /* zásobovací truck — hlavní silnice k základně */
    this.addMover(T('MUNICE', 80, mkTruck, 2, 180, { hitR: 4.0, hitY: 1.5, mover: true }), [[2, 180], [-4, 60], [0, -60], [-6, -160], [4, -240]], 8, 'pingpong');

    /* rotující věci */
    for (const t of this.targets) {
      if (t.group.userData.dish) this._radarDish = t.group.userData.dish;
      if (t.group.userData.rotor) this._heliRotor = t.group.userData.rotor;
    }
  },

  addMover(t, pathPts, speed, mode) {
    const pts = pathPts.map(p => new THREE.Vector3(p[0], 0, p[1]));
    for (const p of pts) p.y = this.groundHeight(p.x, p.z);
    let total = 0;
    const lens = [];
    for (let i = 0; i < pts.length - 1; i++) { const l = pts[i].distanceTo(pts[i + 1]); lens.push(l); total += l; }
    const m = { t, grp: t.group, pts, lens, total, speed, mode, dist: 0, dir: 1, heading: 0, dustAcc: 0 };
    this.movers.push(m);
    this.colliders.push({ x: t.pos.x, z: t.pos.z, r: 3.1, y: t.pos.y - 1.2, h: 2.6, t, mover: m });
    t.mover = m;
    return m;
  },

  /* ---------- vojáci (pěchota) ---------- */
  buildSoldiers(scene) {
    const mkSoldier = () => {
      const g = new THREE.Group();
      const legs = this.box(0.34, 0.78, 0.24, 0x4d5040); legs.position.y = 0.39; g.add(legs);
      const torso = this.box(0.46, 0.52, 0.28, 0x5a6248); torso.position.y = 1.02; g.add(torso);
      const vest = this.box(0.52, 0.3, 0.34, 0x454d38); vest.position.y = 1.06; g.add(vest);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), this.matC(0xc9a184));
      head.position.y = 1.42; g.add(head);
      const helm = this.cyl(0.16, 0.13, 0.16, 0x454d38, 8); helm.position.y = 1.52; g.add(helm);
      /* paže drží pušku vpřed */
      const armL = this.box(0.12, 0.12, 0.5, 0x5a6248); armL.position.set(0.16, 1.14, -0.24); g.add(armL);
      const armR = this.box(0.12, 0.12, 0.44, 0x5a6248); armR.position.set(-0.08, 1.08, -0.3); g.add(armR);
      const gun = this.box(0.07, 0.09, 0.86, 0x2a2a26);
      gun.position.set(0.07, 1.15, -0.5); gun.rotation.x = 0.08; g.add(gun);
      return g;
    };
    const spots = [
      [0, -162], [12, -165],        // jižní brána (venku)
      [-12, -179],                 // jižní brána (uvnitř)
      [170, -280], [150, -280],    // východní brána
      [10, -296], [-13, -292],     // velení
      [-52, -224],                 // motor pool
      [92, -282],                  // u vrtulníku
      [-474, -154], [-488, -166],  // AA pozice
      [176, -610], [196, -630],    // radar
      [540, -497], [552, -514], [562, -501], // východní sklad
    ];
    for (const [x, z] of spots) {
      const g = mkSoldier();
      const y = this.groundHeight(x, z);
      g.position.set(x, y, z);
      g.rotation.y = U.rand(0, Math.PI * 2);
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.userData.origMat = o.material; } });
      scene.add(g);
      const pos = new THREE.Vector3(x, y, z);
      const s = {
        g, pos, home: pos.clone(), alive: true, cool: U.rand(0.6, 3.5), ry: g.rotation.y, ry0: g.rotation.y,
        /* hlídka: pochoduje jen v okolí svého stanoviště */
        patrol: { wait: U.rand(0.8, 3.2), tx: x, tz: z, speed: U.rand(1.0, 1.55), r: U.rand(9, 16) },
      };
      this.soldiers.push(s);
      s.col = { x, z, r: 0.55, y: y - 1, h: 2.1, t: null, mover: null, soldier: s };
      this.colliders.push(s.col);
    }
  },

  /* hlídkování pěchoty v okruhu kolem stanoviště */
  walkPatrol(s, dt) {
    const pt = s.patrol;
    if (pt.wait > 0) { pt.wait -= dt; return; }
    const dx = pt.tx - s.pos.x, dz = pt.tz - s.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.9) {
      /* došel — chvíli stojí, pak vybere nový bod */
      pt.wait = U.rand(1.4, 4.2);
      const a = U.rand(0, Math.PI * 2), r = U.rand(2.0, pt.r);
      pt.tx = s.home.x + Math.cos(a) * r;
      pt.tz = s.home.z + Math.sin(a) * r;
      return;
    }
    const step = Math.min(d, pt.speed * dt);
    s.pos.x += dx / d * step;
    s.pos.z += dz / d * step;
    s.pos.y = this.groundHeight(s.pos.x, s.pos.z);
    const want = Math.atan2(-dx, -dz);
    s.ry += U.wrapPi(want - s.ry) * Math.min(1, dt * 5);
    s.g.position.copy(s.pos);
    s.g.rotation.y = s.ry;
    if (s.col) { s.col.x = s.pos.x; s.col.z = s.pos.z; s.col.y = s.pos.y; }
  },

  /* přímá viditelnost (hrubě: terén + budovy) */
  hasLOS(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const dist = Math.hypot(dx, dy, dz);
    const steps = Math.max(2, Math.min(60, Math.floor(dist / 8)));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
      if (y < this.groundHeight(x, z) + 0.35) return false;
      for (const c of this.colliders) {
        if (c.soldier || c.mover) continue;
        if (y < c.y || y > c.y + c.h) continue;
        const ddx = x - c.x, ddz = z - c.z;
        if (ddx * ddx + ddz * ddz < c.r * c.r) return false;
      }
    }
    return true;
  },

  /* zabití jednoho vojáka (střela pěšáka / exploze) */
  killSoldier(s) {
    if (!s || !s.alive) return false;
    s.alive = false;
    s.g.rotation.x = Math.PI / 2 * (Math.random() < 0.5 ? 1 : 0.94);
    s.g.position.y = s.pos.y - 0.08;
    s.g.traverse(o => { if (o.isMesh) o.material = this.matC(0x2e2a24); });
    return true;
  },

  /* zabití vojáků v okolí exploze */
  killSoldiersNear(pos, r) {
    let n = 0;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      if (s.pos.distanceTo(pos) > r) continue;
      if (this.killSoldier(s)) n++;
    }
    return n;
  },

  resetSoldiers() {
    for (const s of this.soldiers) {
      s.g.traverse(o => { if (o.isMesh && o.userData.origMat) o.material = o.userData.origMat; });
      s.pos.copy(s.home);
      s.g.rotation.set(0, s.ry0, 0);
      s.g.position.copy(s.home);
      s.alive = true;
      s.ry = s.ry0;
      s.cool = U.rand(0.6, 3.5);
      s.patrol.wait = U.rand(0.8, 3.2);
      s.patrol.tx = s.home.x;
      s.patrol.tz = s.home.z;
      if (s.col) { s.col.x = s.home.x; s.col.z = s.home.z; s.col.y = s.home.y; }
    }
  },

  /* ---------- bedny s drony ---------- */
  buildCrates(scene) {
    /* 3 bedny u domácí základny (jistota) + bedny v zákopech + rozeseté po mapě */
    const fixed = ['kamikaze', 'recon', 'bomber'];
    const keys = Object.keys(DRONES);
    const colors = { kamikaze: 0xd23c2e, recon: 0x2fb6c9, bomber: 0xe08a2a };
    /* každý zákop má všechny tři typy dronů (3 bedny: kamikaze, recon, bomber) */
    const spots = [
      [10, 609], [-13, 607], [22, 632],
      [212, -122], [-158, -418], [428, -182],
      [-518, 118], [618, 378], [-262, 616],
      [82, -618], [-688, -418], [778, -62],
    ].map(([x, z]) => ({ x, z, type: null, trench: false }));
    for (const tr of this.TRENCHES) {
      tr.crates.forEach((c, ci) => spots.push({ x: c[0], z: c[1], type: keys[ci % keys.length], trench: true }));
    }
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      const x = s.x, z = s.z;
      const type = s.type || (i < 3 ? fixed[i] : keys[Math.floor(Math.random() * keys.length)]);
      const respawn = s.trench ? 10 : 75;
      const g = new THREE.Group();
      const bx = this.box(0.9, 0.62, 0.9, 0x6b5638); bx.position.y = 0.31; g.add(bx);
      const lid = this.box(0.96, 0.09, 0.96, 0x7d6542); lid.position.y = 0.63; g.add(lid);
      const stripe = this.box(0.92, 0.12, 0.24, colors[type] || 0xd23c2e); stripe.position.y = 0.66; g.add(stripe);
      const mark = this.box(0.3, 0.04, 0.3, 0x9a9a9a); mark.position.y = 0.7; g.add(mark);
      g.traverse(o => { if (o.isMesh) o.castShadow = true; });
      const y = this.groundHeight(x, z);
      g.position.set(x, y, z);
      g.rotation.y = U.rand(0, Math.PI * 2);
      scene.add(g);
      this.crates.push({ g, pos: new THREE.Vector3(x, y + 0.4, z), type, active: true, t: 0, respawn });
      this.addCollider(x, z, 0.62, 1.1);
    }
  },

  updateCrates(dt) {
    for (const c of this.crates) {
      if (c.active) continue;
      c.t -= dt;
      if (c.t <= 0) { c.active = true; c.g.visible = true; }
    }
  },

  resetCrates() {
    for (const c of this.crates) { c.active = true; c.t = 0; c.g.visible = true; }
  },

  buildVegetation(scene) {
    const canPlace = (x, z, minRoad = 9) => {
      if (Math.hypot(x, z) > 1060) return false;
      if (this.roadInfo(x, z).d < minRoad) return false;
      if (this.nearTrench(x, z, 8.5)) return false;
      for (const p of this.PADS) if (Math.hypot(x - p.x, z - p.z) < p.r * 1.05) return false;
      const bx = Math.max(Math.abs(x) - 150, 0) / 60, bz = Math.max(Math.abs(z + 280) - 100, 0) / 60;
      if (Math.hypot(bx, bz) < 1.2) return false;
      return true;
    };

    /* stromy: kmen + koruna se sdílenými maticemi */
    const treeMats = [];
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.26, 3.4, 5);
    const crownGeo = new THREE.ConeGeometry(1.5, 3.2, 6);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
    let guard = 4000;
    while (treeMats.length < 120 && guard-- > 0) {
      const x = U.rand(-1080, 1080), z = U.rand(-1080, 1080);
      if (!canPlace(x, z, 14)) continue;
      const h = this.groundHeight(x, z);
      const s = U.rand(0.7, 1.5);
      const yaw = U.rand(0, Math.PI * 2);
      const tilt = U.rand(-0.06, 0.06);
      q.setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.7));
      treeMats.push({
        trunk: new THREE.Matrix4().compose(pv.set(x, h + 1.7 * s, z), q, sv.set(s, s, s)),
        crown: new THREE.Matrix4().compose(pv.set(x, h + (3.4 + 1.2) * s, z), q, sv.set(s, s, s)),
        tint: U.rand(0.75, 1.15),
      });
    }
    const mkInst = (geo, color, mats, key) => {
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 1 }), mats.length);
      const col = new THREE.Color();
      mats.forEach((mm, i) => {
        im.setMatrixAt(i, mm[key]);
        col.setScalar(mm.tint); im.setColorAt(i, col);
      });
      im.castShadow = true;
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      scene.add(im);
      return im;
    };
    mkInst(trunkGeo, 0x5c4a33, treeMats, 'trunk');
    mkInst(crownGeo, 0x4a5232, treeMats, 'crown');
    for (const mm of treeMats) {
      const p = new THREE.Vector3().setFromMatrixPosition(mm.trunk);
      this.colliders.push({ x: p.x, z: p.z, r: 0.55, y: p.y - 1.7, h: 4.5, t: null, mover: null });
    }

    /* kameny */
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rocks = [];
    guard = 5000;
    while (rocks.length < 150 && guard-- > 0) {
      const x = U.rand(-1080, 1080), z = U.rand(-1080, 1080);
      if (!canPlace(x, z, 12)) continue;
      const h = this.groundHeight(x, z);
      const s = U.rand(0.5, 2.8);
      rocks.push({
        mat: new THREE.Matrix4().compose(
          pv.set(x, h + s * 0.35, z),
          q.setFromEuler(new THREE.Euler(U.rand(0, 3), U.rand(0, 6), U.rand(0, 3))),
          sv.set(s, s * U.rand(0.5, 0.85), s * U.rand(0.7, 1.2))
        ),
        s, tint: U.rand(0.8, 1.1),
      });
    }
    const rockIM = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x7d786c, flatShading: true, roughness: 1 }), rocks.length);
    const col = new THREE.Color();
    rocks.forEach((r, i) => { rockIM.setMatrixAt(i, r.mat); col.setScalar(r.tint); rockIM.setColorAt(i, col); this.colliders.push({ x: new THREE.Vector3().setFromMatrixPosition(r.mat).x, z: new THREE.Vector3().setFromMatrixPosition(r.mat).z, r: r.s * 1.05, y: this.groundHeight(new THREE.Vector3().setFromMatrixPosition(r.mat).x, new THREE.Vector3().setFromMatrixPosition(r.mat).z), h: r.s, t: null, mover: null }); });
    rockIM.castShadow = true;
    rockIM.instanceMatrix.needsUpdate = true;
    if (rockIM.instanceColor) rockIM.instanceColor.needsUpdate = true;
    scene.add(rockIM);

    /* keře */
    const bushGeo = new THREE.IcosahedronGeometry(0.55, 0);
    const bushes = [];
    guard = 6000;
    while (bushes.length < 240 && guard-- > 0) {
      const x = U.rand(-1080, 1080), z = U.rand(-1080, 1080);
      if (!canPlace(x, z, 8)) continue;
      bushes.push(new THREE.Matrix4().compose(
        pv.set(x, this.groundHeight(x, z) + 0.22, z),
        q.setFromEuler(new THREE.Euler(0, U.rand(0, 6), 0)),
        sv.set(U.rand(0.7, 1.6), U.rand(0.4, 0.7), U.rand(0.7, 1.6))
      ));
    }
    const bushIM = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ color: 0x525c3a, flatShading: true, roughness: 1 }), bushes.length);
    bushes.forEach((b, i) => bushIM.setMatrixAt(i, b));
    bushIM.instanceMatrix.needsUpdate = true;
    scene.add(bushIM);
  },

  /* ---------- elektrické vedení podél silnice ---------- */
  buildPowerLines(scene) {
    const pts = [];
    for (const s of this._segs) {
      const n = Math.max(1, Math.round(s.len / 60));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const x = U.lerp(s.ax, s.bx, t), z = U.lerp(s.az, s.bz, t);
        pts.push({ x, z, h: this.groundHeight(x, z) });
      }
    }
    if (pts.length < 2) return;
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7, 5);
    const crossGeo = new THREE.BoxGeometry(1.7, 0.12, 0.12);
    const im = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x5c5445, flatShading: true }), pts.length);
    const imc = new THREE.InstancedMesh(crossGeo, im.material, pts.length);
    const m4 = new THREE.Matrix4();
    const wirePts = [];
    pts.forEach((p, i) => {
      m4.makeTranslation(p.x, p.h + 3.5, p.z); im.setMatrixAt(i, m4);
      m4.makeTranslation(p.x, p.h + 6.7, p.z); imc.setMatrixAt(i, m4);
      this.colliders.push({ x: p.x, z: p.z, r: 0.35, y: p.h, h: 7, t: null, mover: null });
      if (i > 0) {
        const a = pts[i - 1];
        for (const off of [-0.75, 0.75]) {
          for (let k = 0; k < 8; k++) {
            const t0 = k / 8, t1 = (k + 1) / 8;
            const sag = t => Math.sin(t * Math.PI) * 1.3;
            wirePts.push(
              U.lerp(a.x, p.x, t0) + off * 0.4, U.lerp(a.h + 6.6, p.h + 6.6, t0) - sag(t0), U.lerp(a.z, p.z, t0),
              U.lerp(a.x, p.x, t1) + off * 0.4, U.lerp(a.h + 6.6, p.h + 6.6, t1) - sag(t1), U.lerp(a.z, p.z, t1),
            );
          }
        }
      }
    });
    im.instanceMatrix.needsUpdate = true; imc.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    scene.add(im); scene.add(imc);
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1c1a16 })));
  },

  /* ---------- staré vraky (atmosféra) ---------- */
  buildAmbientWrecks(scene) {
    const burnt = (x, z, ry) => {
      const g = new THREE.Group();
      const hull = this.box(2.7, 0.95, 6.4, 0x2a2822); hull.position.y = 1.05; g.add(hull);
      const turret = this.cyl(1.0, 1.25, 0.6, 0x24221d, 10); turret.position.set(0, 1.8, -0.3); g.add(turret);
      const barrel = this.cyl(0.09, 0.11, 3.4, 0x1e1c18, 6);
      barrel.rotation.set(Math.PI / 2 + 0.15, 0, 0.2); barrel.position.set(0.4, 1.9, -2.8); g.add(barrel);
      for (const s of [-1, 1]) { const tr = this.box(0.72, 0.85, 6.6, 0x201f1b); tr.position.set(s * 1.32, 0.55, 0); g.add(tr); }
      g.position.set(x, this.groundHeight(x, z), z);
      g.rotation.y = ry;
      scene.add(g);
      const p = new THREE.Vector3(x, this.groundHeight(x, z) + 0.5, z);
      this._ambientFires.push(p);
      this.addCollider(x, z, 3.2, 2.4);
    };
    burnt(150, -238, 0.5);
    burnt(-60, -120, 2.4);
    const truckW = this.box(2.3, 1.5, 4.5, 0x332f27);
    truckW.position.set(310, this.groundHeight(310, -305) + 0.8, -305);
    truckW.rotation.y = -0.3; truckW.castShadow = true;
    scene.add(truckW);
    this._ambientFires.push(new THREE.Vector3(310, this.groundHeight(310, -305) + 0.5, -305));
    this.addCollider(310, -305, 2.8, 2);
  },

  addAmbientFires() {
    for (const p of this._ambientFires) FX.wreck(p.clone().add(new THREE.Vector3(0, 1, 0)), 1e9);
  },

  /* =================  UPDATE  ================= */
  update(dt, drone, player) {
    /* radar + rotor */
    if (this._radarDish) this._radarDish.rotation.y += dt * 0.6;
    if (this._heliRotor) this._heliRotor.rotation.y += dt * 9;

    /* pěchota — hlídky + palba na dron / na pěšáka */
    const playerMode = !!(player && typeof G !== 'undefined' && G.mode === 'soldier' && !player.dead);
    let tgt = null, tgtVel = null, tgtSpeed = 0, aimR = 0, fireR = 0;
    if (playerMode) {
      tgt = player.pos;
      tgtSpeed = Math.hypot(player.vel.x, player.vel.z);
      aimR = 400; fireR = 330;
    } else if (drone && drone.liftedOff && !drone.crashed) {
      tgt = drone.pos; tgtVel = drone.vel; tgtSpeed = drone.vel.length();
      aimR = 620; fireR = 520;
    }
    if (tgt) {
      const muzzle = new THREE.Vector3(), aim = new THREE.Vector3();
      for (const s of this.soldiers) {
        if (!s.alive) continue;
        const dx = tgt.x - s.pos.x, dz = tgt.z - s.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > aimR) { this.walkPatrol(s, dt); continue; }
        /* otočí se na cíl (stojí) */
        const want = Math.atan2(-dx, -dz);
        s.ry += U.wrapPi(want - s.ry) * Math.min(1, dt * 4);
        s.g.rotation.y = s.ry;
        if (d > fireR || d < 8) { s.cool = Math.max(s.cool, 0.4); continue; }
        if (!playerMode && tgt.y < s.pos.y + 1.4) { s.cool = Math.max(s.cool, 0.4); continue; }
        s.cool -= dt;
        if (s.cool > 0) continue;
        /* pěšák: palba jen s přímou viditelností */
        if (playerMode && !this.hasLOS(s.pos.x, s.pos.y + 1.2, s.pos.z, tgt.x, tgt.y + 1.25, tgt.z)) {
          s.cool = Math.max(s.cool, 0.5);
          continue;
        }
        s.cool = U.rand(1.3, 3.0);
        /* výstřel — ústí hlavně z lokálních souřadnic (0.07, 1.15, -0.93) */
        const cy = Math.cos(s.ry), sy = Math.sin(s.ry);
        muzzle.set(s.pos.x + 0.07 * cy - 0.93 * sy, s.pos.y + 1.15, s.pos.z - 0.07 * sy - 0.93 * cy);
        const tof = d / 340;
        /* pravděpodobnost zásahu klesá se vzdáleností i rychlostí cíle */
        const sf = U.clamp(1 - (tgtSpeed - 6) / 34, 0.25, 1);
        if (playerMode) {
          aim.set(tgt.x + U.rand(-1.2, 1.2), tgt.y + 1.25 + U.rand(-0.7, 0.7), tgt.z + U.rand(-1.2, 1.2));
          const p = U.clamp(0.15 - d / fireR * 0.13, 0.012, 0.15) * sf;
          if (Math.random() < p && this.onPlayerHit) this.onPlayerHit(tof, Math.round(U.rand(7, 13)));
        } else {
          aim.copy(drone.pos).addScaledVector(drone.vel, tof * U.rand(0.3, 0.8));
          aim.x += U.rand(-4, 4); aim.y += U.rand(-2, 2); aim.z += U.rand(-4, 4);
          const p = U.clamp(0.07 - d / 520 * 0.06, 0.004, 0.07) * sf;
          if (Math.random() < p && this.onDroneHit) this.onDroneHit(tof);
        }
        FX.tracer(muzzle, aim);
        FX.add.spawn({
          pos: muzzle.clone(), vel: new THREE.Vector3(0, 0.3, 0),
          size: 0.55, life: 0.07, col: [1, 0.82, 0.45], alpha: 1,
        });
        AudioSys.shot(d);
      }
    } else {
      for (const s of this.soldiers) if (s.alive) this.walkPatrol(s, dt);
    }
    this.updateCrates(dt);

    /* pohyblivá vozidla */
    for (const m of this.movers) {
      if (!m.t.alive) continue;
      m.dist += m.speed * m.dir * dt;
      if (m.mode === 'loop') {
        if (m.dist >= m.total) m.dist -= m.total;
      } else {
        if (m.dist >= m.total) { m.dist = m.total; m.dir = -1; }
        if (m.dist <= 0) { m.dist = 0; m.dir = 1; }
      }
      /* najdi pozici na polyline */
      let d = m.dist, i = 0;
      while (i < m.lens.length - 1 && d > m.lens[i]) { d -= m.lens[i]; i++; }
      const a = m.pts[i], b = m.pts[Math.min(i + 1, m.pts.length - 1)];
      const t = m.lens[i] > 0 ? U.clamp(d / m.lens[i], 0, 1) : 0;
      const x = U.lerp(a.x, b.x, t), z = U.lerp(a.z, b.z, t);
      const y = this.groundHeight(x, z);
      m.grp.position.set(x, y, z);
      const dx = (b.x - a.x) * m.dir, dz = (b.z - a.z) * m.dir;
      if (Math.abs(dx) + Math.abs(dz) > 1e-6) {
        const hd = Math.atan2(-dx, -dz);
        m.heading += U.wrapPi(hd - m.heading) * Math.min(1, dt * 2.5);
        m.grp.rotation.y = m.heading;
      }
      /* přizpůsobení terénu (náklon) */
      const hF = this.groundHeight(x + Math.sin(m.heading + Math.PI) * 2.4, z + Math.cos(m.heading + Math.PI) * 2.4);
      const hB = this.groundHeight(x - Math.sin(m.heading + Math.PI) * 2.4, z - Math.cos(m.heading + Math.PI) * 2.4);
      m.grp.rotation.x = U.damp(m.grp.rotation.x, Math.atan2(hB - hF, 4.8) * 0.7, 4, dt);
      m.t.pos.set(x, y + 1.2, z);
      /* synchronizace collideru */
      for (const c of this.colliders) if (c.mover === m) { c.x = x; c.z = z; c.y = y; }
      /* prach */
      m.dustAcc += dt;
      if (m.dustAcc > 0.22) {
        m.dustAcc = 0;
        FX.smoke.spawn({
          pos: new THREE.Vector3(x + U.rand(-1, 1), y + 0.4, z + U.rand(-1, 1)),
          vel: new THREE.Vector3(U.rand(-0.5, 0.5), U.rand(0.6, 1.4), U.rand(-0.5, 0.5)),
          size: U.rand(0.7, 1.1), grow: 0.9, life: U.rand(0.9, 1.6),
          col: [0.52, 0.47, 0.38], alpha: 0.28, grav: -0.3, drag: 0.6,
        });
      }
    }
  },

  /* =================  RESET MISE  ================= */
  wreckTarget(t) {
    t.group.traverse(o => {
      if (o.isMesh) {
        o.userData.origMat = o.material;
        const c = o.material.clone();
        c.color.multiplyScalar(0.14);
        c.roughness = 1;
        o.material = c;
      }
    });
    t.group.rotation.z += U.rand(-0.07, 0.07);
    t.group.rotation.x += U.rand(-0.05, 0.05);
    t.group.position.y -= 0.15;
    FX.wreck(t.pos.clone().add(new THREE.Vector3(0, -0.5, 0)), 1e9);
  },

  resetTargets() {
    for (const t of this.targets) {
      if (!t.alive) {
        t.group.traverse(o => { if (o.isMesh && o.userData.origMat) o.material = o.userData.origMat; });
        t.group.position.set(t.orig.x, t.orig.y, t.orig.z);
        t.group.rotation.set(0, t.orig.ry, 0);
        if (t.mover) { t.mover.dist = 0; t.mover.dir = 1; }
      }
      t.alive = true;
      t.spotted = false;
      if (t.mover && t.mover.t === t) {
        const m = t.mover;
        t.pos.set(m.pts[0].x, m.pts[0].y + 1.2, m.pts[0].z);
        m.grp.position.copy(m.pts[0]);
        m.heading = 0;
        for (const c of this.colliders) if (c.mover === m) { c.x = m.pts[0].x; c.z = m.pts[0].z; c.y = m.pts[0].y; }
      } else if (!t.mover) {
        t.pos.set(t.orig.x, t.orig.y + 1.2, t.orig.z);
      }
    }
    this.targetsAlive = this.targets.length;
  },
};
