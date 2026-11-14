/* =====================================================
   FPV KAMIKAZE — OSD/HUD (2D canvas přes 3D scénou)
   ===================================================== */
'use strict';

const HUD = {
  canvas: null, ctx: null, W: 0, H: 0,
  minimapBaked: null, mapSize: 170,
  _v: new THREE.Vector3(), _e: new THREE.Euler(),

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  },

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    FX.setView(this.H, Settings.fov);
  },

  /* ---------- text s obrysem ---------- */
  text(str, x, y, size, color = '#dff3ff', align = 'left', bold = true) {
    const c = this.ctx;
    c.font = `${bold ? 'bold ' : ''}${Math.round(size)}px Consolas, "Courier New", monospace`;
    c.textAlign = align; c.textBaseline = 'middle';
    c.fillStyle = 'rgba(0,0,0,0.75)';
    c.fillText(str, x + 1.5, y + 1.5);
    c.fillStyle = color;
    c.fillText(str, x, y);
  },
  line(x0, y0, x1, y1, color, w = 1.5) {
    const c = this.ctx;
    c.strokeStyle = color; c.lineWidth = w;
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
  },

  /* ---------- minimapa ---------- */
  prebakeMinimap() {
    const S = 128;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    const img = c.createImageData(S, S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = (px / (S - 1) - 0.5) * 2400;
        const z = (py / (S - 1) - 0.5) * 2400;
        const col = World.groundColorAt(x, z);
        const i = (py * S + px) * 4;
        img.data[i] = col[0] * 255; img.data[i + 1] = col[1] * 255; img.data[i + 2] = col[2] * 255; img.data[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    this.minimapBaked = cv;
  },

  drawMinimap(d) {
    const c = this.ctx, S = this.mapSize;
    const x0 = 14, y0 = this.H - S - 14;
    c.save();
    c.globalAlpha = 0.92;
    c.fillStyle = 'rgba(8,10,12,0.75)';
    c.fillRect(x0 - 4, y0 - 4, S + 8, S + 8);
    c.strokeStyle = 'rgba(160,220,255,0.35)'; c.lineWidth = 1;
    c.strokeRect(x0 - 4, y0 - 4, S + 8, S + 8);
    if (this.minimapBaked) {
      c.imageSmoothingEnabled = true;
      c.drawImage(this.minimapBaked, x0, y0, S, S);
    }
    const k = S / 2400;
    const toMap = (wx, wz) => [x0 + (wx + 1200) * k, y0 + (wz + 1200) * k];
    /* zákopy */
    c.strokeStyle = 'rgba(150,116,70,0.95)'; c.lineWidth = 2;
    for (const tr of World.TRENCHES) {
      c.beginPath();
      tr.pts.forEach((pt, i) => {
        const [tx2, ty2] = toMap(pt[0], pt[1]);
        if (i) c.lineTo(tx2, ty2); else c.moveTo(tx2, ty2);
      });
      c.stroke();
    }
    for (const cr of World.crates) {
      if (!cr.active) continue;
      const [bx2, by2] = toMap(cr.pos.x, cr.pos.z);
      c.fillStyle = '#ffd24d';
      c.fillRect(bx2 - 1.6, by2 - 1.6, 3.2, 3.2);
    }
    /* domov */
    const [hx, hy] = toMap(World.home.x, World.home.z);
    c.fillStyle = '#9fe8ff'; c.fillRect(hx - 2.5, hy - 2.5, 5, 5);
    this.text('H', hx + 5, hy, 9, '#9fe8ff', 'left');
    /* cíle */
    for (const t of World.targets) {
      const [tx, ty] = toMap(t.pos.x, t.pos.z);
      if (t.alive) {
        c.fillStyle = '#ff5252'; c.beginPath(); c.arc(tx, ty, 2.4, 0, 7); c.fill();
        if (t.spotted) { c.strokeStyle = 'rgba(140,247,160,0.9)'; c.lineWidth = 1; c.beginPath(); c.arc(tx, ty, 4.5, 0, 7); c.stroke(); }
      }
      else { c.strokeStyle = 'rgba(120,120,120,0.7)'; c.lineWidth = 1; c.beginPath(); c.moveTo(tx - 2, ty - 2); c.lineTo(tx + 2, ty + 2); c.moveTo(tx + 2, ty - 2); c.lineTo(tx - 2, ty + 2); c.stroke(); }
    }
    /* dron + zorné pole */
    const dr = d.drone;
    const [ux, uy] = toMap(dr.pos.x, dr.pos.z);
    const dirx = -Math.sin(d.heading), dirz = -Math.cos(d.heading);
    c.strokeStyle = 'rgba(255,255,140,0.5)';
    c.beginPath(); c.moveTo(ux, uy); c.lineTo(ux + dirx * 260 * k * 2, uy + dirz * 260 * k * 2); c.stroke();
    c.fillStyle = '#ffe98a';
    c.save(); c.translate(ux, uy); c.rotate(Math.atan2(dirx, -dirz));
    c.beginPath(); c.moveTo(0, -4.2); c.lineTo(2.6, 3.4); c.lineTo(-2.6, 3.4); c.closePath(); c.fill();
    c.restore();
    /* sever */
    this.text('N', x0 + S - 10, y0 + 10, 10, '#9fe8ff', 'center');
    c.restore();
  },

  /* ---------- hlavní vykreslení ---------- */
  draw(d) {
    const c = this.ctx;
    c.clearRect(0, 0, this.W, this.H);
    if (d.state !== 'fly' && d.state !== 'crash') return;
    if (d.mode === 'soldier') { this.drawSoldier(d); return; }

    const W = this.W, H = this.H, cx = W / 2, cy = H / 2;
    const fs = Math.max(13, Math.round(H * 0.021));
    const green = '#8cf7a0', cyan = '#9fe8ff', white = '#dff3ff', warn = '#ffb84d', red = '#ff5252', dim = 'rgba(190,210,225,0.55)';

    /* ---- postoj kamery ---- */
    this._e.setFromQuaternion(d.camera.quaternion, 'YXZ');
    const pitchDeg = this._e.x / DEG;
    const rollRight = -this._e.z / DEG;

    /* ---- umělý horizont (jen FPV) ---- */
    if (d.cam === 'fpv') {
      const pxPerDeg = H / d.camera.fov;
      const maxLadder = Math.ceil(d.camera.fov / 2 / 10) * 10 + 10;
      c.save();
      c.beginPath(); c.arc(cx, cy, H * 0.30, 0, 7); c.clip();
      c.translate(cx, cy); c.rotate(rollRight * DEG);
      for (let deg = -maxLadder; deg <= maxLadder; deg += 10) {
        const y = (pitchDeg - deg) * pxPerDeg;
        if (Math.abs(y) > H * 0.42) continue;
        const major = deg === 0;
        const wLine = major ? H * 0.16 : H * 0.075;
        const gap = major ? H * 0.035 : H * 0.022;
        const col = deg > 0 ? 'rgba(120,190,230,0.8)' : 'rgba(230,150,120,0.8)';
        this.line(-wLine, y, -gap, y, col, major ? 2 : 1.3);
        this.line(gap, y, wLine, y, col, major ? 2 : 1.3);
        if (!major) {
          this.text(String(Math.abs(deg)), -wLine - 4, y, fs * 0.62, col, 'right');
          this.text(String(Math.abs(deg)), wLine + 4, y, fs * 0.62, col, 'left');
        }
      }
      c.restore();
      /* střed + zaměřovač */
      c.strokeStyle = 'rgba(223,243,255,0.9)'; c.lineWidth = 1.6;
      c.beginPath(); c.arc(cx, cy, 3, 0, 7); c.stroke();
      this.line(cx - 16, cy, cx - 6, cy, 'rgba(223,243,255,0.7)', 1.4);
      this.line(cx + 6, cy, cx + 16, cy, 'rgba(223,243,255,0.7)', 1.4);
      this.line(cx, cy - 16, cx, cy - 6, 'rgba(223,243,255,0.7)', 1.4);
      this.line(cx, cy + 6, cx, cy + 16, 'rgba(223,243,255,0.7)', 1.4);
    }

    /* ---- rychlost / výška ---- */
    const dr = d.drone;
    const spd = Math.round(dr.vel.length() * 3.6);
    const agl = Math.max(0, Math.round(dr.pos.y - World.groundHeight(dr.pos.x, dr.pos.z)));
    const distHome = Math.round(Math.hypot(dr.pos.x - World.home.x, dr.pos.z - World.home.z));
    this.text(String(spd).padStart(3, ' '), cx - H * 0.21, cy + fs * 3.2, fs * 1.35, white, 'right');
    this.text('km/h', cx - H * 0.21, cy + fs * 4.6, fs * 0.6, dim, 'right');
    this.text(String(agl).padStart(3, ' '), cx + H * 0.21, cy + fs * 3.2, fs * 1.35, white, 'left');
    this.text('ALT m', cx + H * 0.21, cy + fs * 4.6, fs * 0.6, dim, 'left');
    this.text(`${distHome} m`, cx + H * 0.21, cy + fs * 6.1, fs * 0.8, dim, 'left');

    /* ---- levý horní blok: baterie, režim, arm ---- */
    const lx = 16, ly = 20;
    const volt = 22.2 + dr.battery * 3.0;
    const bcol = dr.battery < 0.2 ? red : (dr.battery < 0.45 ? warn : green);
    this.text(`${volt.toFixed(1)}V`, lx + 8, ly, fs, bcol);
    /* lišta baterie */
    const bw = H * 0.14;
    c.strokeStyle = bcol; c.lineWidth = 1.4; c.strokeRect(lx + 8, ly + fs * 0.85, bw, fs * 0.55);
    c.fillStyle = bcol; c.fillRect(lx + 8, ly + fs * 0.85, bw * dr.battery, fs * 0.55);
    this.text(dr.armed ? 'ARMED' : 'DISARMED', lx + 8, ly + fs * 2.5, fs * 0.85, dr.armed ? warn : dim);
    if (dr.armed) { c.fillStyle = (performance.now() % 600 < 300) ? red : 'rgba(255,80,80,0.25)'; c.beginPath(); c.arc(lx + 8 + 3.5, ly + fs * 2.5, 3, 0, 7); c.fill(); this.text('PAYLOAD', lx + 18, ly + fs * 2.5, fs * 0.85, red, 'left'); }
    else { this.text('ARM: MEZERNÍK / A', lx + 8, ly + fs * 3.5, fs * 0.6, dim); }
    this.text((Settings.mode === 'acro' ? 'ACRO' : 'ANGLE') + ' · ' + dr.spec.label, lx + 8, ly + fs * 3.7, fs * 0.85, cyan);
    this.text(`THR ${Math.round(U.clamp((dr.lastThrottleCmd + 1) / 2, 0, 1) * 100)}%`, lx + 8, ly + fs * 4.9, fs * 0.8, dim);
    /* odolnost trupu (zásahy palbou) + výbiva dronu */
    let hy = fs * 6.0;
    if (dr.spec.bombs) {
      this.text(`PUMY ${d.bombs ?? 0}/${dr.spec.bombs}`, lx + 8, ly + hy, fs * 0.8, (d.bombs ?? 0) > 0 ? cyan : red);
      hy += fs * 1.25;
    }
    if (dr.spec.thermal) {
      this.text(d.thermal ? 'THERM ●' : 'THERM ○', lx + 8, ly + hy, fs * 0.8, d.thermal ? warn : dim);
      hy += fs * 1.25;
    }
    if (d.orbit && dr.orbit.active) {
      this.text(`ORBIT r=${Math.round(dr.orbit.r)}m`, lx + 8, ly + hy, fs * 0.8, green);
      hy += fs * 1.25;
    }
    this.text('TRUP', lx + 8, ly + hy, fs * 0.6, dim);
    const hpMax = dr.spec.hp;
    const hpFrac = dr.hp / hpMax;
    const hpCol = hpFrac > 0.66 ? green : (hpFrac > 0.34 ? warn : red);
    for (let i = 0; i < hpMax; i++) {
      c.fillStyle = i < dr.hp ? hpCol : 'rgba(120,130,140,0.3)';
      c.fillRect(lx + 8 + 42 + i * 13, ly + hy - fs * 0.3, 10, fs * 0.55);
    }

    /* ---- pravý horní blok: čas, skóre, signál ---- */
    const rx = W - 16;
    this.text(`T+${U.fmtTime(d.stats.time)}`, rx - 8, ly, fs * 0.85, white, 'right');
    this.text(`SKÓRE ${d.stats.score}`, rx - 8, ly + fs * 1.3, fs * 0.85, warn, 'right');
    this.text(`CÍLE ${d.stats.destroyed}/${d.stats.total}`, rx - 8, ly + fs * 2.6, fs * 0.85, cyan, 'right');
    /* signál */
    const sig = 1 - d.staticLevel;
    for (let i = 0; i < 5; i++) {
      const on = sig > i * 0.2 + 0.08;
      c.fillStyle = on ? (i < 2 ? red : (i < 4 ? warn : green)) : 'rgba(120,130,140,0.3)';
      c.fillRect(rx - 8 - (5 - i) * 9, ly + fs * 3.7, 6, 6 + i * 2.2);
    }
    this.text('RX', rx - 8 - 52, ly + fs * 4.1, fs * 0.6, dim, 'right');

    /* ---- kompas ---- */
    const hdgDeg = ((d.heading / DEG) % 360 + 360) % 360;
    const tapeY = 26, tapeHalf = Math.min(W * 0.16, 190);
    c.save();
    c.beginPath(); c.rect(cx - tapeHalf, tapeY - fs, tapeHalf * 2, fs * 2.4); c.clip();
    for (let deg = -75; deg <= 75; deg += 5) {
      const abs = (Math.round(hdgDeg / 5) * 5 + deg + 720) % 360;
      const xx = cx + (deg - (hdgDeg % 5)) * (tapeHalf / 55);
      const major = abs % 45 === 0;
      const col = major ? cyan : dim;
      this.line(xx, tapeY, xx, tapeY + (major ? 10 : 5), col, major ? 1.6 : 1);
      if (major) {
        const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
        this.text(names[abs] ?? abs, xx, tapeY + 18, fs * 0.62, col, 'center');
      }
    }
    /* značky cílů na kompasu */
    for (const t of World.targets) {
      if (!t.alive) continue;
      const b = Math.atan2(t.pos.x - dr.pos.x, -(t.pos.z - dr.pos.z)) / DEG;
      let rel = ((b - hdgDeg + 540) % 360) - 180;
      if (Math.abs(rel) < 55) {
        const xx = cx + rel * (tapeHalf / 55);
        c.fillStyle = '#ff7b6b';
        c.beginPath(); c.moveTo(xx, tapeY - 7); c.lineTo(xx + 3, tapeY - 1); c.lineTo(xx - 3, tapeY - 1); c.closePath(); c.fill();
      }
    }
    c.restore();
    /* ukazatel headingu */
    c.fillStyle = warn;
    c.beginPath(); c.moveTo(cx, tapeY - 3); c.lineTo(cx - 4, tapeY - 9); c.lineTo(cx + 4, tapeY - 9); c.closePath(); c.fill();
    this.text(String(Math.round(hdgDeg)).padStart(3, '0'), cx, tapeY - fs * 0.9, fs * 0.72, warn, 'center');

    /* ---- značky cílů ---- */
    if (d.showMarkers) {
      const cam = d.camera;
      let nearest = null, nearestD = 1e9;
      for (const t of World.targets) {
        if (!t.alive) continue;
        const dd = t.pos.distanceTo(dr.pos);
        if (dd < nearestD) { nearestD = dd; nearest = t; }
      }
      for (const t of World.targets) {
        if (!t.alive) continue;
        const v = this._v.copy(t.pos).project(cam);
        const onscreen = v.z < 1 && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.92;
        if (onscreen) {
          const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
          const dd = t.pos.distanceTo(dr.pos);
          const isNear = t === nearest && dd < 650;
          const col = isNear ? '#ffd24d' : '#7fe3ff';
          c.strokeStyle = col; c.lineWidth = 1.8;
          const s = isNear ? 11 : 8;
          c.beginPath();
          c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y); c.closePath();
          c.stroke();
          this.text(`${t.name} ${Math.round(dd)}m`, x, y + s + fs * 0.75, fs * 0.66, col, 'center');
        }
      }
      /* šipka k nejbližšímu cíli mimo obraz */
      if (nearest) {
        const v = this._v.copy(nearest.pos).project(cam);
        const behind = v.z >= 1;
        let sx = v.x, sy = -v.y;
        if (behind) { sx = -sx; sy = -sy; }
        const off = Math.abs(sx) > 0.85 || Math.abs(sy) > 0.8 || behind;
        if (off) {
          const ang = Math.atan2(sy, sx);
          const rr = Math.min(W, H) * 0.33;
          const ax = cx + Math.cos(ang) * rr, ay = cy + Math.sin(ang) * rr;
          c.save(); c.translate(ax, ay); c.rotate(ang);
          c.fillStyle = '#ffd24d';
          c.beginPath(); c.moveTo(12, 0); c.lineTo(-6, -7); c.lineTo(-2, 0); c.lineTo(-6, 7); c.closePath(); c.fill();
          c.restore();
          this.text(`${Math.round(nearestD)}m`, ax - Math.cos(ang) * 24, ay - Math.sin(ang) * 24, fs * 0.6, '#ffd24d', 'center');
        }
      }
      /* zámek */
      if (d.lock) {
        const v = this._v.copy(d.lock.pos).project(cam);
        if (v.z < 1) {
          const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
          const s = 26 + Math.sin(performance.now() * 0.02) * 3;
          c.strokeStyle = red; c.lineWidth = 2;
          for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            c.beginPath();
            c.moveTo(x + dx * s, y + dy * s - dy * 8); c.lineTo(x + dx * s, y + dy * s);
            c.lineTo(x + dx * s - dx * 8, y + dy * s); c.stroke();
          }
          this.text('LOCK', x, y + s + fs * 0.8, fs * 0.7, red, 'center');
        }
      }
    }

    /* ---- termokamera: tepelné signatury (pěchota + technika) ---- */
    if (d.thermal) {
      const cam2 = d.camera;
      /* vojáci = horké tečky */
      c.fillStyle = 'rgba(255,150,40,0.95)';
      for (const s of World.soldiers) {
        if (!s.alive) continue;
        if (s.pos.distanceToSquared(dr.pos) > 800 * 800) continue;
        const v = this._v.copy(s.pos).project(cam2);
        if (v.z < 1 && Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.93) {
          const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
          c.fillRect(x - 1.5, y - 3, 3, 6.5);
        }
      }
      /* technika/cíle = teplé rámečky (i skrz mlhu, nezávisle na značkách) */
      c.strokeStyle = 'rgba(255,110,30,0.9)'; c.lineWidth = 1.6;
      for (const t of World.targets) {
        if (!t.alive) continue;
        if (t.pos.distanceToSquared(dr.pos) > 900 * 900) continue;
        const v = this._v.copy(t.pos).project(cam2);
        if (v.z < 1 && Math.abs(v.x) < 0.97 && Math.abs(v.y) < 0.93) {
          const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
          c.strokeRect(x - 9, y - 6, 18, 12);
        }
      }
    }

    /* ---- CCIP: předpokládaný dopad pumy (bombardér) ---- */
    if (dr.spec.bombs && (d.bombs ?? 0) > 0 && !dr.crashed && !dr.holdOnPad) {
      const bp = this._ccip || (this._ccip = new THREE.Vector3());
      const bv = this._ccipv || (this._ccipv = new THREE.Vector3());
      bp.copy(dr.pos); bp.y -= 0.25;
      bv.copy(dr.vel); bv.y -= 2;
      let ok = false;
      for (let i = 0; i < 300; i++) {
        const sdt = 1 / 30;
        bv.y -= 9.81 * sdt;
        bv.multiplyScalar(Math.max(0, 1 - 0.03 * sdt));
        bp.addScaledVector(bv, sdt);
        if (bp.y <= World.groundHeight(bp.x, bp.z) + 0.12) { ok = true; break; }
      }
      if (ok) {
        const pv = this._v.copy(bp).project(d.camera);
        if (pv.z < 1 && Math.abs(pv.x) < 0.98 && Math.abs(pv.y) < 0.95) {
          const x = (pv.x * 0.5 + 0.5) * W, y = (-pv.y * 0.5 + 0.5) * H;
          c.strokeStyle = 'rgba(255,190,60,0.95)'; c.lineWidth = 1.6;
          c.setLineDash([5, 3]);
          c.beginPath(); c.arc(x, y, 10, 0, 7); c.stroke();
          c.setLineDash([]);
          this.line(x - 16, y, x - 11, y, 'rgba(255,190,60,0.9)', 1.4);
          this.line(x + 11, y, x + 16, y, 'rgba(255,190,60,0.9)', 1.4);
          this.line(x, y - 16, x, y - 11, 'rgba(255,190,60,0.9)', 1.4);
          this.line(x, y + 11, x, y + 16, 'rgba(255,190,60,0.9)', 1.4);
        }
      }
    }

    /* ---- minimapa ---- */
    if (d.showMinimap) this.drawMinimap(d);

    /* ---- indikátor páček ---- */
    if (d.showSticks && d.cam === 'fpv') {
      const sq = Math.max(34, H * 0.055);
      const drawStick = (x, y, vx, vy, label) => {
        c.strokeStyle = 'rgba(160,220,255,0.4)'; c.lineWidth = 1.2;
        c.strokeRect(x, y, sq, sq);
        c.beginPath(); c.moveTo(x + sq / 2, y); c.lineTo(x + sq / 2, y + sq); c.moveTo(x, y + sq / 2); c.lineTo(x + sq, y + sq / 2); c.stroke();
        c.fillStyle = '#9fe8ff';
        c.beginPath(); c.arc(x + sq / 2 + vx * (sq / 2 - 3), y + sq / 2 + vy * (sq / 2 - 3), 3.2, 0, 7); c.fill();
        this.text(label, x + sq / 2, y + sq + 8, fs * 0.55, dim, 'center');
      };
      const st = Input.state;
      drawStick(W / 2 - sq * 1.8 - 10, H - sq - 34, st.yaw, -st.throttle, 'Y/T');
      drawStick(W / 2 + sq * 0.8 + 10, H - sq - 34, st.roll, -st.pitch, 'R/P');
    }

    /* ---- REC + call sign ---- */
    if ((performance.now() % 1000) < 600) { c.fillStyle = red; c.beginPath(); c.arc(W - 96, this.H - 22, 4, 0, 7); c.fill(); }
    const cs = { kamikaze: 'KAMIKAZE-7', recon: 'RECON-2', bomber: 'BOMBER-5' }[Settings.droneType] || 'KAMIKAZE-7';
    this.text(`REC  ${cs}`, W - 88, this.H - 22, fs * 0.62, 'rgba(223,243,255,0.8)', 'left');

    /* ---- dolní lišta: throttle ---- */
    const tbw = W * 0.16, tbh = 5;
    const tx = cx - tbw / 2, ty = this.H - 16;
    c.strokeStyle = 'rgba(160,220,255,0.35)'; c.lineWidth = 1;
    c.strokeRect(tx, ty, tbw, tbh);
    const thr = U.clamp((dr.lastThrottleCmd + 1) / 2, 0, 1);
    c.fillStyle = thr > 0.9 ? red : warn;
    c.fillRect(tx, ty, tbw * thr, tbh);
  },

  /* ---------- HUD pěšáka ---------- */
  drawSoldier(d) {
    const c = this.ctx;
    const W = this.W, H = this.H, cx = W / 2, cy = H / 2;
    const fs = Math.max(13, Math.round(H * 0.021));
    const green = '#8cf7a0', cyan = '#9fe8ff', white = '#dff3ff', warn = '#ffb84d', red = '#ff5252', dim = 'rgba(190,210,225,0.55)';
    const p = d.player, cam = d.camera;

    /* ---- kompas ---- */
    const hdgDeg = ((-p.yaw / DEG) % 360 + 360) % 360;
    const tapeY = 26, tapeHalf = Math.min(W * 0.16, 190);
    c.save();
    c.beginPath(); c.rect(cx - tapeHalf, tapeY - fs, tapeHalf * 2, fs * 2.4); c.clip();
    for (let deg = -75; deg <= 75; deg += 5) {
      const abs = (Math.round(hdgDeg / 5) * 5 + deg + 720) % 360;
      const xx = cx + (deg - (hdgDeg % 5)) * (tapeHalf / 55);
      const major = abs % 45 === 0;
      const col = major ? cyan : dim;
      this.line(xx, tapeY, xx, tapeY + (major ? 10 : 5), col, major ? 1.6 : 1);
      if (major) {
        const names = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
        this.text(names[abs] ?? abs, xx, tapeY + 18, fs * 0.62, col, 'center');
      }
    }
    for (const t of World.targets) {
      if (!t.alive) continue;
      const b = Math.atan2(t.pos.x - p.pos.x, -(t.pos.z - p.pos.z)) / DEG;
      const rel = ((b - hdgDeg + 540) % 360) - 180;
      if (Math.abs(rel) < 55) {
        const xx = cx + rel * (tapeHalf / 55);
        c.fillStyle = '#ff7b6b';
        c.beginPath(); c.moveTo(xx, tapeY - 7); c.lineTo(xx + 3, tapeY - 1); c.lineTo(xx - 3, tapeY - 1); c.closePath(); c.fill();
      }
    }
    c.restore();
    c.fillStyle = warn;
    c.beginPath(); c.moveTo(cx, tapeY - 3); c.lineTo(cx - 4, tapeY - 9); c.lineTo(cx + 4, tapeY - 9); c.closePath(); c.fill();
    this.text(String(Math.round(hdgDeg)).padStart(3, '0'), cx, tapeY - fs * 0.9, fs * 0.72, warn, 'center');

    /* ---- zaměřovač + hitmarker ---- */
    if (!p.dead) {
      const mv = Math.hypot(p.vel.x, p.vel.z);
      const spread = p.weapon === 'rocket' ? 13 : (6 + mv * 0.9);
      this.line(cx - spread - 7, cy, cx - spread, cy, 'rgba(223,243,255,0.85)', 1.5);
      this.line(cx + spread, cy, cx + spread + 7, cy, 'rgba(223,243,255,0.85)', 1.5);
      this.line(cx, cy - spread - 7, cx, cy - spread, 'rgba(223,243,255,0.85)', 1.5);
      this.line(cx, cy + spread, cx, cy + spread + 7, 'rgba(223,243,255,0.85)', 1.5);
      c.fillStyle = 'rgba(223,243,255,0.9)';
      c.beginPath(); c.arc(cx, cy, 1.4, 0, 7); c.fill();
      if (p.hitT > 0) {
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          this.line(cx + sx * 7, cy + sy * 7, cx + sx * 11, cy + sy * 11, '#ff7b6b', 2);
        }
      }
    }

    /* ---- značky techniky ---- */
    if (d.showMarkers && !p.dead) {
      for (const t of World.targets) {
        if (!t.alive) continue;
        const dd = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
        if (dd > 650) continue;
        const v = this._v.copy(t.pos).project(cam);
        if (v.z < 1 && Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.92) {
          const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
          c.strokeStyle = '#7fe3ff'; c.lineWidth = 1.6;
          c.beginPath(); c.moveTo(x, y - 8); c.lineTo(x + 8, y); c.lineTo(x, y + 8); c.lineTo(x - 8, y); c.closePath(); c.stroke();
          this.text(`${t.name} ${Math.round(dd)}m`, x, y + 16, fs * 0.62, '#7fe3ff', 'center');
        }
      }
    }

    /* ---- minimapa ---- */
    if (d.showMinimap) this.drawMinimap({ drone: { pos: p.pos }, heading: -p.yaw });

    /* ---- zdraví + munice ---- */
    const bw = Math.min(W * 0.26, 320), bh = 13;
    const bx = cx - bw / 2, by = H - 88;
    const hpFrac = U.clamp(p.hp / p.maxHp, 0, 1);
    const hpCol = hpFrac > 0.55 ? green : (hpFrac > 0.25 ? warn : red);
    c.fillStyle = 'rgba(8,10,12,0.55)'; c.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    c.strokeStyle = 'rgba(160,220,255,0.35)'; c.lineWidth = 1; c.strokeRect(bx - 2, by - 2, bw + 4, bh + 4);
    c.fillStyle = hpCol; c.fillRect(bx, by, bw * hpFrac, bh);
    this.text(`TRUP ${Math.ceil(p.hp)}`, bx, by - 6, fs * 0.62, hpCol);

    const wy = by + bh + fs * 1.35;
    if (p.weapon === 'rifle') {
      this.text('▸ PUŠKA', bx, wy, fs * 0.82, white);
      if (p.reloadT > 0) this.text('PŘEBÍJÍ…', bx + fs * 6.2, wy, fs * 0.72, warn);
      else this.text(`${p.rifleMag} / ${p.rifleReserve}`, bx + fs * 6.2, wy, fs * 0.82, p.rifleMag > 0 ? cyan : red);
    } else {
      this.text('▸ RAKETOMET', bx, wy, fs * 0.82, white);
      this.text(`×${p.rockets}`, bx + fs * 8.5, wy, fs * 0.82, p.rockets > 0 ? warn : red);
    }
    this.text(p.weapon === 'rifle' ? `2 = RAKETOMET ×${p.rockets}` : '1 = PUŠKA', bx, wy + fs * 1.15, fs * 0.58, dim);

    /* ---- drony v batohu / bedna ---- */
    const py = by - fs * 4.1;
    const inv = p.inv || [];
    if (inv.length) {
      const slotW = fs * 8.2, gap = fs * 0.55;
      const totalW = inv.length * slotW + (inv.length - 1) * gap;
      let sx = cx - totalW / 2;
      for (let i = 0; i < inv.length; i++) {
        const on = i === p.sel;
        c.strokeStyle = on ? 'rgba(140,247,160,0.9)' : 'rgba(150,180,200,0.35)';
        c.lineWidth = on ? 2 : 1;
        c.strokeRect(sx, py - fs * 1.0, slotW, fs * 1.6);
        if (on) { c.fillStyle = 'rgba(140,247,160,0.10)'; c.fillRect(sx, py - fs * 1.0, slotW, fs * 1.6); }
        this.text(DRONES[inv[i]].label, sx + slotW / 2, py, fs * 0.64, on ? green : dim, 'center');
        sx += slotW + gap;
      }
      this.text(inv.length > 1 ? `Q = VYBRAT (${p.sel + 1}/${inv.length}) · G = VYPUSTIT` : 'G = VYPUSTIT DRON',
        cx, py + fs * 1.45, fs * 0.6, dim, 'center');
      if (p.crate) this.text(`E — VZÍT ${DRONES[p.crate.type].label} (${inv.length}/${p.invMax})`, cx, py + fs * 2.5, fs * 0.62, warn, 'center');
    } else if (p.crate) {
      this.text(`E — VZÍT DRON: ${DRONES[p.crate.type].label}`, cx, py, fs * 0.85, warn, 'center');
    } else {
      this.text('HLEDEJ BEDNY S DRONY (E)', cx, py, fs * 0.62, dim, 'center');
    }

    /* ---- pravý horní blok ---- */
    const rx = W - 16, ly = 20;
    this.text(`T+${U.fmtTime(d.stats.time)}`, rx - 8, ly, fs * 0.85, white, 'right');
    this.text(`SKÓRE ${d.stats.score}`, rx - 8, ly + fs * 1.3, fs * 0.85, warn, 'right');
    this.text(`CÍLE ${d.stats.destroyed}/${d.stats.total}`, rx - 8, ly + fs * 2.6, fs * 0.85, cyan, 'right');

    /* ---- poškození / smrt ---- */
    const hurt = d.hurtT || 0;
    if (hurt > 0) {
      c.strokeStyle = `rgba(255,50,50,${U.clamp(hurt / 0.35, 0, 1) * 0.5})`;
      c.lineWidth = 26; c.strokeRect(0, 0, W, H);
    }
    if (hpFrac < 0.3 && !p.dead) {
      const a = 0.14 + 0.09 * Math.sin(performance.now() * 0.006);
      c.strokeStyle = `rgba(255,40,40,${a})`; c.lineWidth = 18; c.strokeRect(0, 0, W, H);
    }
    if (p.dead) {
      c.fillStyle = 'rgba(45,0,0,0.4)'; c.fillRect(0, 0, W, H);
      this.text('PADL JSI', cx, cy - fs * 1.6, fs * 2.3, red, 'center');
      this.text(`RESPAWN ZA ${Math.max(1, Math.ceil(p.deadT))}`, cx, cy + fs * 1.6, fs * 0.9, white, 'center');
    }
  },
};
