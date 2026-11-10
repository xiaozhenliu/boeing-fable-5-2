// 机翼：固定翼盒蒙皮、缝翼、襟翼、襟副翼、副翼、扰流板、斜削翼尖、襟翼滑轨整流罩、内部结构与油箱
import * as THREE from 'three';
import { gridGeo, loft, merge, ribbon, solidPatch, rod, sphere, tf, linspace, lerp, clamp, DEG } from '../core/geo.js';
import { M } from '../core/materials.js';
import { W, wingSection, airfoil, wingLocal, wingFlex, wingFlexSlope, wingMid, wingPoint } from './shape.js';
import { mk, grp } from './registry.js';

// 展向分区边界
const Z = { root: 1.4, a: 3.5, b: 9.31, c: 11.53, d: 21.23, e: 25.58, tip0: W.zTipBreak, tip: W.zTip };
const GAP = 0.018;

/** 给几何体添加"机翼上挠"变形目标（竖向剪切）；p0 为几何体局部原点在机翼坐标中的位置；zm 为刚体参考站位 */
export function addFlexMorph(geo, p0 = null, zm = null) {
  const pos = geo.attributes.position, n = pos.count;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let dy;
    if (p0) { const zw = z + p0[2]; dy = wingFlex(zw, 1) - wingFlex(zm, 1) - wingFlexSlope(zm, 1) * (zw - zm); }
    else dy = wingFlex(z, 1);
    out[i * 3] = x; out[i * 3 + 1] = y + dy; out[i * 3 + 2] = z;
  }
  geo.morphAttributes.position = [new THREE.BufferAttribute(out, 3)];
  geo.morphTargetsRelative = false;
  return geo;
}
function flexMesh(geo, mat, o) { const m = mk(addFlexMorph(geo), mat, o); m.morphTargetInfluences = [0]; m.userData.flexMorph = true; return m; }

// ---------- 剖面轮廓 ----------
const NU = 30, NL = 24;
function fixedLoop(z, sU, sL, full) {
  const tc = wingSection(z).tc, pts = [];
  for (let i = 0; i <= NU; i++) { const t = i / NU, s = sU * (1 - t) * (1 - t); pts.push(wingLocal(z, s, airfoil(s, tc)[0])); }
  for (let i = 1; i <= NL; i++) { const t = i / NL, s = sL * t * t; pts.push(wingLocal(z, s, airfoil(s, tc)[1])); }
  const a = pts[pts.length - 1], b = pts[0];
  pts.push(a.slice());                                   // 硬边
  if (!full) { pts.push([lerp(a[0], b[0], 0.5), lerp(a[1], b[1], 0.5), z]); }
  pts.push(b.slice());
  return pts;
}
// 后缘活动面（襟翼/副翼）剖面：上表面 sU..1，下表面 sL..1，前缘为半椭圆鼻
function teLoop(z, sU, sL, bulge, off = 0) {
  const w = wingSection(z), tc = w.tc, pts = [], N = 12;
  const hu = airfoil(sU, tc)[0] + off / w.c, hl = airfoil(sL, tc)[1] - off / w.c;
  for (let i = 0; i <= 10; i++) { const s = lerp(1, sU, i / 10); pts.push(wingLocal(z, s, airfoil(s, tc)[0] + off / w.c)); }
  for (let i = 1; i < N; i++) {
    const ph = Math.PI / 2 - Math.PI * i / N, k = (Math.sin(ph) + 1) / 2;
    pts.push(wingLocal(z, lerp(sL, sU, k) - bulge * Math.cos(ph), lerp(hl, hu, k)));
  }
  for (let i = 0; i <= 10; i++) { const s = lerp(sL, 1, i / 10); pts.push(wingLocal(z, s, airfoil(s, tc)[1] - off / w.c)); }
  pts.push(pts[pts.length - 1].slice());
  pts.unshift(pts[0].slice());
  return pts;
}
function slatLoop(z) {
  const w = wingSection(z), tc = w.tc, pts = [], off = 0.006 / w.c, N = 16;
  for (let i = 0; i <= N; i++) { const t = i / N, s = W.sSlatU * (1 - t) * (1 - t); pts.push(wingLocal(z, s - (s < 0.01 ? off * (1 - s / 0.01) : 0), airfoil(s, tc)[0] + off)); }
  for (let i = 1; i <= 10; i++) { const t = i / 10, s = W.sSlatL * t * t; pts.push(wingLocal(z, s, airfoil(s, tc)[1] - off)); }
  const a = [W.sSlatL, airfoil(W.sSlatL, tc)[1] - off], b = [W.sSlatU, airfoil(W.sSlatU, tc)[0] + off];
  pts.push(pts[pts.length - 1].slice());
  for (let i = 1; i < 8; i++) {                           // 内凹的缝翼"凹腔"
    const k = i / 8;
    pts.push(wingLocal(z, lerp(a[0], b[0], k) - 0.045 * Math.sin(Math.PI * k) * (1 - 0.5 * k), lerp(a[1], b[1], k) + 0.004 * Math.sin(Math.PI * k)));
  }
  pts.push(wingLocal(z, b[0], b[1] - 0.0008));
  return pts;
}
const zone = (z) => z < Z.b ? W.inb : W.outb;
function spoilerLoop(z) {
  const w = wingSection(z), tc = w.tc, up = [], lo = [], N = 8, zn = zone(z);
  for (let i = 0; i <= N; i++) {
    const s = lerp(zn.hinge + 0.002, zn.te, i / N), h = airfoil(s, tc)[0];
    up.push(wingLocal(z, s, h + 0.003 / w.c));
    lo.push(wingLocal(z, s, h - lerp(0.05, 0.005, i / N) / w.c));
  }
  return [up[0].slice(), ...up, up[N].slice(), ...lo.reverse()];
}

// ---------- 铰接部件 ----------
function hinged(geo, pA, pB, mat, o = {}) {
  const P0 = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2];
  geo.translate(-P0[0], -P0[1], -P0[2]);
  addFlexMorph(geo, P0, P0[2]);
  const mesh = mk(geo, mat, o); mesh.morphTargetInfluences = [0]; mesh.userData.flexMorph = true;
  const hinge = grp('hinge', mesh);
  const station = grp('station', hinge);
  station.position.set(...P0);
  const axis = new THREE.Vector3(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]).normalize();
  return { station, hinge, mesh, axis, P0, set(a) { hinge.quaternion.setFromAxisAngle(axis, a); } };
}
function flexStation(reg, st, P0) { reg.flexItems.push({ g: st, z: P0[2], y0: P0[1] }); }

const zsOf = (a, b, step = 0.9) => linspace(a, b, Math.max(2, Math.ceil((b - a) / step) + 1));
const lowerPt = (z, s, drop) => { const w = wingSection(z); return wingLocal(z, s, airfoil(s, w.tc)[1] - drop); };
const midPt = (z, s) => { const w = wingSection(z); const [u, l] = airfoil(s, w.tc); return wingLocal(z, s, (u + l) / 2); };
const upPt = (z, s) => { const w = wingSection(z); return wingLocal(z, s, airfoil(s, w.tc)[0]); };

// ------------------------------------------------------------------ 单侧机翼
function buildSide(reg, side) {
  const S = side > 0 ? 'L' : 'R';
  const g = grp('wing' + S);
  g.scale.z = side;
  const rig = { slats: [], flapsIn: null, flapsOut: null, flaperon: null, aileron: null, spoilers: [], fairAft: [] };

  // ---- 固定翼盒蒙皮 ----
  const fixed = [];
  const seg = (z0, z1, sU, sL, full) => fixed.push(loft(zsOf(z0, z1).map(z => fixedLoop(z, sU, sL, full)), { caps: 'both' }));
  seg(Z.root, Z.a, 1, 1, true);
  seg(Z.a, Z.b - 1e-4, W.inb.hinge, W.inb.flapLE, false);
  seg(Z.b, Z.c, W.sFixedTE, W.sFixedTE, false);
  seg(Z.c, Z.d, W.outb.hinge, W.outb.flapLE, false);
  seg(Z.d, Z.e, W.sFixedTE, W.sFixedTE, false);
  seg(Z.e, Z.tip0, 1, 1, true);
  // 扰流板区两端的固定盖板
  const filler = (z0, z1) => fixed.push(loft([z0, z1].map(spoilerLoop), { caps: 'both' }));
  filler(Z.a, W.spoilIn[0] - GAP); filler(W.spoilIn[1] + GAP, Z.b - 1e-4);
  filler(Z.c, W.spoilOut[0] - GAP); filler(W.spoilOut[1] + GAP, Z.d);
  const box = flexMesh(merge(fixed), M.wingGrey, { name: 'wingbox' });
  g.add(reg.reg('wingBox', box, { layer: 'skin', mc: 'cfrp', side: S }));

  // ---- 斜削式翼尖 ----
  {
    const zs = linspace(Z.tip0, Z.tip, 22).map((z, i, a) => i === a.length - 1 ? Z.tip - 0.004 : z);
    const secs = zs.map(z => fixedLoop(z, 1, 1, true));
    const tip = flexMesh(loft(secs, { caps: 'end' }), M.wingGrey, { name: 'rakedTip' });
    g.add(reg.reg('rakedTip', tip, { layer: 'skin', mc: 'cfrp', side: S }));
  }

  // ---- 缝翼 ----
  const slatSpans = [W.slatIn];
  const ds = (W.slatOut[1] - W.slatOut[0]) / W.nSlatOut;
  for (let i = 0; i < W.nSlatOut; i++) slatSpans.push([W.slatOut[0] + i * ds, W.slatOut[0] + (i + 1) * ds]);
  slatSpans.forEach(([z0, z1], i) => {
    const a = z0 + GAP, b = z1 - GAP;
    const geo = loft(zsOf(a, b, 0.8).map(slatLoop), { caps: 'both' });
    const h = hinged(geo, lowerPt(a, 0.09, 0.105), lowerPt(b, 0.09, 0.105), M.wingGreyLE, { name: 'slat' + i });
    reg.reg(i === 0 ? 'slatIn' : 'slatOut', h.mesh, { layer: 'skin', mc: 'alu', side: S });
    flexStation(reg, h.station, h.P0); g.add(h.station); rig.slats.push(h);
  });

  // ---- 克鲁格襟翼（内侧缝翼与吊挂之间，封住缝翼与短舱间的缺口）----
  {
    const [a, b] = W.krueger;
    const loop = (z) => {
      const ss = linspace(0.012, 0.1, 7);
      return [...ss.map(s => wingPoint(z, s, -1, 0.004)), ...ss.slice().reverse().map(s => wingPoint(z, s, -1, -0.022))];
    };
    const geo = loft(linspace(a, b, 3).map(loop), { caps: 'both' });
    const h = hinged(geo, wingPoint(a, 0.014, -1, -0.01), wingPoint(b, 0.014, -1, -0.01), M.wingGreyLE, { name: 'krueger' });
    reg.reg('krueger', h.mesh, { layer: 'skin', mc: 'alu', side: S });
    flexStation(reg, h.station, h.P0); g.add(h.station); rig.krueger = h;
  }

  // ---- 襟翼 / 襟副翼 / 副翼 ----
  const teDevice = (z0, z1, id, sU, sL, bulge, hingeS, hingeDrop, mat, mc) => {
    const a = z0 + GAP, b = z1 - GAP;
    const geo = loft(zsOf(a, b, 0.8).map(z => teLoop(z, sU, sL, bulge)), { caps: 'both' });
    const pA = hingeDrop > 0 ? lowerPt(a, hingeS, hingeDrop) : midPt(a, hingeS);
    const pB = hingeDrop > 0 ? lowerPt(b, hingeS, hingeDrop) : midPt(b, hingeS);
    const h = hinged(geo, pA, pB, mat, { name: id });
    reg.reg(id, h.mesh, { layer: 'skin', mc, side: S });
    flexStation(reg, h.station, h.P0); g.add(h.station);
    return h;
  };
  rig.flapsIn = teDevice(W.flapIn[0], W.flapIn[1], 'flapIn', W.inb.te, W.inb.flapLE, 0.016, 0.85, 0.04, M.wingGrey, 'sandwich');
  rig.flapsOut = teDevice(W.flapOut[0], W.flapOut[1], 'flapOut', W.outb.te, W.outb.flapLE, 0.022, 0.80, 0.055, M.wingGrey, 'sandwich');
  rig.flaperon = teDevice(W.flaperon[0], W.flaperon[1], 'flaperon', 0.724, 0.724, 0.007, 0.738, 0, M.wingGrey, 'sandwich');
  rig.aileron = teDevice(W.aileron[0], W.aileron[1], 'aileron', 0.724, 0.724, 0.007, 0.738, 0, M.wingGrey, 'sandwich');

  // ---- 扰流板 ----
  const spoil = (span, n, base) => {
    const d = (span[1] - span[0]) / n;
    for (let i = 0; i < n; i++) {
      const a = span[0] + i * d + GAP * 0.6, b = span[0] + (i + 1) * d - GAP * 0.6;
      const geo = loft(zsOf(a, b, 0.9).map(spoilerLoop), { caps: 'both' });
      const h = hinged(geo, upPt(a, zone(a).hinge), upPt(b, zone(b).hinge), M.wingGrey, { name: 'spoiler' });
      h.index = base + i;
      reg.reg(base === 0 ? 'spoilerIn' : 'spoilerOut', h.mesh, { layer: 'skin', mc: 'sandwich', side: S });
      flexStation(reg, h.station, h.P0); g.add(h.station); rig.spoilers.push(h);
    }
  };
  spoil(W.spoilIn, W.nSpoilIn, 0);
  spoil(W.spoilOut, W.nSpoilOut, W.nSpoilIn);

  // ---- 襟翼滑轨（铰链）整流罩 ----
  const fairings = [[8.9, rig.flapsIn, 1.0, 0.85], [14.3, rig.flapsOut, 0.9, 0.80], [18.7, rig.flapsOut, 0.78, 0.80]];
  for (const [z, dev, sc, sH] of fairings) {
    const w = wingSection(z);
    const len = 3.0 * sc, x0 = w.xLE + sH * w.c - len * 0.52, sSplit = sH - 0.03;
    const mkPod = (ta, tb) => {
      const n = 12, secs = [];
      for (let i = 0; i <= n; i++) {
        const T = lerp(ta, tb, i / n), x = x0 + T * len, s = (x - w.xLE) / w.c;
        const r = Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(T, 0.75))), 0.62);
        const hw = 0.15 * sc * r + 0.002, dp = 0.36 * sc * r + 0.002;
        const sc2 = Math.min(s, 1);
        const top = wingLocal(z, sc2, airfoil(sc2, w.tc)[1] + 0.006);
        if (s > 1) top[0] += (s - 1) * w.c;
        const row = [];
        for (let k = 0; k < 20; k++) { const a = k / 20 * Math.PI * 2, c = Math.cos(a); row.push([top[0], top[1] - dp * 0.42 + dp * 0.58 * c * (c > 0 ? 0.3 : 1), z + hw * Math.sin(a)]); }
        secs.push(row);
      }
      return loft(secs, { caps: 'both' });
    };
    const tSplit = (w.xLE + sSplit * w.c - x0) / len;
    const P0 = lowerPt(z, 0.7, 0);
    const front = mkPod(0, tSplit); front.translate(-P0[0], -P0[1], -P0[2]);
    const fm = mk(front, M.wingGrey, { name: 'flapFairing' });
    const st = grp('station', fm); st.position.set(...P0);
    reg.reg('flapFairing', fm, { layer: 'skin', mc: 'sandwich', side: S });
    flexStation(reg, st, P0); g.add(st);
    // 后段随襟翼转动
    const aft = mkPod(tSplit, 1); aft.translate(-dev.P0[0], -dev.P0[1], -dev.P0[2]);
    const am = mk(aft, M.wingGrey, { name: 'flapFairingAft' });
    reg.reg('flapFairing', am, { layer: 'skin', mc: 'sandwich', side: S });
    dev.hinge.add(am);
  }

  // ---- 翼尖航行灯 / 频闪灯、后缘放电刷 ----
  {
    const lg = grp('tipLights');
    const zN = 27.05, pN = wingLocal(zN, 0.004, 0.0), pS = wingLocal(27.6, 0.004, 0);
    const nav = mk(sphere(0.085, pN, 14, 10, [2.4, 0.7, 1.6]), side > 0 ? M.lightRed : M.lightGreen, { shadow: false });
    nav.geometry.rotateY(0);
    const strobe = mk(sphere(0.07, pS, 12, 8, [2.0, 0.7, 1.4]), M.lightStrobe, { shadow: false });
    const pT = wingLocal(Z.tip - 0.25, 1.0, 0.004);
    const tail = mk(sphere(0.05, pT, 10, 8, [1.6, 0.8, 1]), M.lightWhite, { shadow: false });
    lg.add(nav, strobe, tail);
    const P0 = wingLocal(27.3, 0.3, 0); lg.children.forEach(c => c.geometry.translate(-P0[0], -P0[1], -P0[2]));
    const st = grp('station', lg); st.position.set(...P0);
    reg.reg('navLight', lg, { layer: 'skin', mc: 'other', side: S });
    flexStation(reg, st, P0); g.add(st);
    // 放电刷
    const wicks = [];
    for (const z of [22.2, 23.4, 24.6, 26.6, 27.6, 28.6, 29.4]) {
      const p = wingLocal(z, 1.0, 0.002);
      wicks.push(rod(p, [p[0] + 0.24, p[1] - 0.01, p[2] + 0.02], 0.006, 0.003, 6));
    }
    const wk = flexMesh(merge(wicks), M.black, { name: 'staticWicks', shadow: false });
    g.add(reg.reg('staticWick', wk, { layer: 'skin', mc: 'other', side: S }));
  }

  // ---- 内部结构：前后梁、翼肋、长桁 ----
  const sg = grp('wingStructure');
  {
    const zs = zsOf(Z.root - 1.4, Z.tip0, 0.7);
    const spar = (s, id) => {
      const P = zs.map(z => [wingMid(z, s, 0.03), wingMid(z, s, 0.97)]);
      const m = flexMesh(solidPatch(P, 0.05, { up: [1, 0, 0] }), M.spar, { name: id });
      sg.add(reg.reg(id, m, { layer: 'struct', mc: 'cfrp', side: S }));
    };
    spar(W.sFrontSpar, 'frontSpar'); spar(W.sRearSpar, 'rearSpar');
    // 翼肋
    const ribs = [];
    const ribZ = [];
    for (let z = 3.4; z < Z.tip0 - 0.2; z += (z < 12 ? 0.82 : 0.74)) ribZ.push(z);
    for (const z of ribZ) {
      const ss = linspace(W.sFrontSpar, W.sRearSpar, 12);
      ribs.push(gridGeo([ss.map(s => wingMid(z, s, 0.035)), ss.map(s => wingMid(z, s, 0.965))], {}));
    }
    const rb = flexMesh(merge(ribs), M.rib, { name: 'ribs' });
    sg.add(reg.reg('wingRib', rb, { layer: 'struct', mc: 'alu', side: S }));
    // 长桁（上下蒙皮内侧）
    const str = [];
    for (let k = 1; k <= 9; k++) {
      const s = lerp(W.sFrontSpar, W.sRearSpar, k / 10);
      const zEnd = lerp(Z.tip0, 12, Math.abs(k - 5) / 5 * 0.55);       // 靠近梁的长桁较早终止
      const zz = zsOf(Z.root, zEnd, 0.9);
      str.push(ribbon(zz.map(z => ({ p: wingMid(z, s, 0.04), n: [0, 1, 0] })), 0.07, 0.0));
      str.push(ribbon(zz.map(z => ({ p: wingMid(z, s, 0.96), n: [0, -1, 0] })), 0.07, 0.0));
    }
    const sm = flexMesh(merge(str), M.wingStringer, { name: 'wingStringers', shadow: false });
    sm.material = M.wingStringer; sm.userData.doubleSide = true;
    sg.add(reg.reg('wingStringer', sm, { layer: 'struct', mc: 'cfrp', side: S }));
  }
  g.add(sg);

  // ---- 油箱（示意体积）----
  const tg = grp('fuelTanks');
  {
    const tank = (z0, z1, id, mat) => {
      const zs = zsOf(z0, z1, 0.9);
      const secs = zs.map(z => {
        const ss = linspace(W.sFrontSpar + 0.012, W.sRearSpar - 0.012, 10), row = [];
        for (const s of ss) row.push(wingMid(z, s, 0.9));
        for (const s of ss.slice().reverse()) row.push(wingMid(z, s, 0.1));
        return row;
      });
      const m = flexMesh(loft(secs, { caps: 'both' }), mat, { name: id, shadow: false });
      m.renderOrder = 3;
      tg.add(reg.reg(id, m, { layer: 'sys', mc: 'other', side: S }));
    };
    tank(3.0, 8.72, 'fuelCenter', M.fuelCenter);      // 中央油箱向外延伸进内翼段
    tank(8.86, 22.3, 'fuelMain', M.fuel);
    tank(22.45, 25.6, 'fuelSurge', M.fuelSurge);
  }
  g.add(tg);

  return { g, rig };
}

export function buildWings(reg) {
  const L = buildSide(reg, 1), R = buildSide(reg, -1);
  const root = grp('wings', L.g, R.g);
  return { root, L, R };
}
