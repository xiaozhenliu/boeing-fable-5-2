// 尾翼：垂直安定面 + 方向舵、可配平水平安定面 + 升降舵
import * as THREE from 'three';
import { gridGeo, capGeo, merge, rod, linspace, lerp, clamp, smooth, pchip, DEG } from '../core/geo.js';
import { M } from '../core/materials.js';
import { F, AC } from './shape.js';
import { mk, grp } from './registry.js';

export const FIN = {
  y0: 6.85, y1: AC.height, xLE0: 49.2, sweep: 40 * DEG, cRoot: 8.7, cTip: 2.7,
  rudY: [7.72, 16.72], sRud: 0.685, tcRoot: 0.105, tcTip: 0.09,
};
export const STAB = {
  half: 9.905, xLE0: 53.9, sweep: 36 * DEG, cRoot: 6.15, cTip: 1.72, y0: F.YC + 0.74, dihedral: 7 * DEG,
  elevZ: [1.62, 9.5], sElev: 0.70, tcRoot: 0.10, tcTip: 0.09, pivotS: 0.62,
};

const thick = (s, tc) => 5 * tc * (0.2969 * Math.sqrt(s) - 0.1260 * s - 0.3516 * s * s + 0.2843 * s * s * s - 0.1036 * s * s * s * s) + 0.0012 * s;

// 垂尾：q = 高度 y
function finSec(y) {
  const t = clamp((y - FIN.y0) / (FIN.y1 - FIN.y0), 0, 1);
  let xLE = FIN.xLE0 + (y - FIN.y0) * Math.tan(FIN.sweep);
  let c = lerp(FIN.cRoot, FIN.cTip, t);
  // 背鳍：根部前缘前伸
  const d = clamp(1 - (y - FIN.y0) / 1.5, 0, 1); xLE -= 1.9 * d * d; c += 1.9 * d * d;
  // 翼尖修圆
  const k = smooth((y - (FIN.y1 - 0.32)) / 0.32); xLE += 0.75 * k * k; c -= 0.95 * k * k;
  return { xLE, c, tc: lerp(FIN.tcRoot, FIN.tcTip, t), v: t };
}
const finPt = (y, s, side, off = 0) => { const f = finSec(y); return [f.xLE + s * f.c, y, side * (f.c * thick(s, f.tc) + off)]; };
// 平尾：q = 展向 z
function stabSec(z) {
  const t = clamp(z / STAB.half, 0, 1);
  let xLE = STAB.xLE0 + z * Math.tan(STAB.sweep), c = lerp(STAB.cRoot, STAB.cTip, t);
  const k = smooth((z - (STAB.half - 0.3)) / 0.3); xLE += 0.6 * k * k; c -= 0.75 * k * k;
  return { xLE, c, tc: lerp(STAB.tcRoot, STAB.tcTip, t), yc: STAB.y0 + z * Math.tan(STAB.dihedral) };
}
const stabPt = (z, s, side, off = 0) => { const f = stabSec(z); return [f.xLE + s * f.c, f.yc + side * (f.c * thick(s, f.tc) + off), z]; };

const NU = 22;
function fixedLoop(pt, q, sEnd, full) {
  const p = [];
  for (let i = 0; i <= NU; i++) { const t = i / NU; p.push(pt(q, sEnd * (1 - t) * (1 - t), 1)); }
  for (let i = 1; i <= NU; i++) { const t = i / NU; p.push(pt(q, sEnd * t * t, -1)); }
  const a = p[p.length - 1], b = p[0];
  p.push(a.slice());
  if (!full) p.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  p.push(b.slice());
  return p;
}
function devLoop(pt, q, sA, bulge) {
  const p = [], N = 10;
  for (let i = 0; i <= 8; i++) p.push(pt(q, lerp(1, sA, i / 8), 1));
  const a = pt(q, sA, 1), b = pt(q, sA, -1), c0 = pt(q, sA - bulge, 1), c1 = pt(q, sA - bulge, -1);
  for (let i = 1; i < N; i++) {
    const ph = Math.PI / 2 - Math.PI * i / N, k = (Math.sin(ph) + 1) / 2, f = Math.cos(ph);
    p.push([lerp(b[0], a[0], k) + (lerp(c1[0], c0[0], k) - lerp(b[0], a[0], k)) * f, lerp(b[1], a[1], k), lerp(b[2], a[2], k)]);
  }
  for (let i = 0; i <= 8; i++) p.push(pt(q, lerp(sA, 1, i / 8), -1));
  p.push(p[p.length - 1].slice()); p.unshift(p[0].slice());
  return p;
}
const ctr = (L) => { let x = 0, y = 0, z = 0; for (const p of L) { x += p[0]; y += p[1]; z += p[2]; } return [x / L.length, y / L.length, z / L.length]; };
function loftUV(secs, uv, caps = 'both') {
  const geos = [gridGeo(secs, { inside: 'auto', uv })];
  const n = secs.length;
  if (caps === 'both' || caps === 'start') { const a = ctr(secs[0]), b = ctr(secs[1]); geos.push(capGeo(secs[0], [a[0] - b[0], a[1] - b[1], a[2] - b[2]])); }
  if (caps === 'both' || caps === 'end') { const a = ctr(secs[n - 1]), b = ctr(secs[n - 2]); geos.push(capGeo(secs[n - 1], [a[0] - b[0], a[1] - b[1], a[2] - b[2]])); }
  return merge(geos);
}

// 垂尾贴图：左半幅 = 左侧面，右半幅 = 右侧面
function makeFinTexture() {
  const S = 2048, cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const g = cv.getContext('2d');
  for (const half of [0, 1]) {
    g.save();
    g.beginPath(); g.rect(half * S / 2, 0, S / 2, S); g.clip();
    // 映射：u∈[0,1] 沿弦向（前缘->后缘），画布左半幅 u 向右，右半幅 u 向左
    const X = (u) => half === 0 ? u * S / 2 : S - u * S / 2;
    const Y = (v) => (1 - v) * S;
    g.fillStyle = '#12305c'; g.fillRect(half * S / 2, 0, S / 2, S);
    const band = (v0a, v0b, v1a, v1b, col) => {
      g.beginPath(); g.moveTo(X(-0.1), Y(v0a));
      g.bezierCurveTo(X(0.35), Y(v0a + 0.05), X(0.6), Y(v1a - 0.25), X(1.1), Y(v1a));
      g.lineTo(X(1.1), Y(v1b));
      g.bezierCurveTo(X(0.6), Y(v1b - 0.25), X(0.35), Y(v0b + 0.05), X(-0.1), Y(v0b));
      g.closePath(); g.fillStyle = col; g.fill();
    };
    band(-0.02, 0.05, 0.60, 0.74, '#2a6fba');
    band(0.075, 0.10, 0.78, 0.83, '#8fcdf0');
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 16;
  return tex;
}

function hingedDev(geo, pA, pB, mat, o) {
  const P0 = [(pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2, (pA[2] + pB[2]) / 2];
  geo.translate(-P0[0], -P0[1], -P0[2]);
  const mesh = mk(geo, mat, o), hinge = grp('hinge', mesh);
  hinge.position.set(...P0);
  const axis = new THREE.Vector3(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]).normalize();
  return { hinge, mesh, axis, P0, set(a) { hinge.quaternion.setFromAxisAngle(axis, a); } };
}

export function buildTail(reg) {
  const root = grp('tail');
  const rig = {};
  M.tailPaint.map = makeFinTexture(); M.tailPaint.needsUpdate = true;

  // ================= 垂直安定面 =================
  const finG = grp('fin');
  {
    const uvOf = (ys, sEnd) => (i, j) => {
      const f = finSec(ys[i]); const n = 2 * NU + 1;
      let s, side;
      if (j <= NU) { const t = j / NU; s = sEnd * (1 - t) * (1 - t); side = 1; } else if (j <= 2 * NU) { const t = (j - NU) / NU; s = sEnd * t * t; side = -1; } else { s = sEnd; side = j === n ? -1 : 1; }
      // 用绝对 x 坐标映射（使方向舵与安定面图案连续）
      const xx = f.xLE + s * f.c, u = clamp((xx - 47.6) / (61.2 - 47.6), 0, 1);
      return [side > 0 ? u * 0.5 : 1 - u * 0.5, f.v];
    };
    const geos = [];
    const seg = (y0, y1, sEnd, full, n, caps) => { const ys = linspace(y0, y1, n); geos.push(loftUV(ys.map(y => fixedLoop(finPt, y, sEnd, full)), uvOf(ys, sEnd), caps)); };
    seg(FIN.y0, FIN.rudY[0], 1, true, 8, 'end');
    seg(FIN.rudY[0], FIN.rudY[1], FIN.sRud - 0.012, false, 22, 'both');
    seg(FIN.rudY[1], FIN.y1 - 0.004, 1, true, 10, 'both');
    const fin = mk(merge(geos), M.tailPaint, { name: 'fin' });
    finG.add(reg.reg('fin', fin, { layer: 'skin', mc: 'cfrp' }));

    // 前缘：787-9 垂尾前缘带混合层流控制（HLFC）微孔蒙皮
    const ys = linspace(8.7, 16.3, 20), ss = linspace(0.05, 0, 9).map(t => t), P = [];
    for (const y of ys) { const row = []; for (const s of ss) row.push(finPt(y, s * (s / 0.05), 1, 0.004)); for (const s of ss.slice().reverse().slice(1)) row.push(finPt(y, s * (s / 0.05), -1, 0.004)); row.forEach(p => { p[0] -= 0.004; }); P.push(row); }
    const le = mk(gridGeo(P, { inside: [56, 12, 0] }), M.titaniumLE, { name: 'finLE' });
    finG.add(reg.reg('finLE', le, { layer: 'skin', mc: 'ti' }));

    // 方向舵
    const rys = linspace(FIN.rudY[0] + 0.03, FIN.rudY[1] - 0.03, 22);
    const uvR = (i, j) => {
      const f = finSec(rys[i]); const loop = devLoop(finPt, rys[i], FIN.sRud, 0.006);
      const p = loop[j], u = clamp((p[0] - 47.6) / (61.2 - 47.6), 0, 1);
      return [p[2] >= 0 ? u * 0.5 : 1 - u * 0.5, f.v];
    };
    const rg = loftUV(rys.map(y => devLoop(finPt, y, FIN.sRud, 0.006)), uvR, 'both');
    const fa = finSec(rys[0]), fb = finSec(rys[rys.length - 1]);
    const r = hingedDev(rg, [fa.xLE + (FIN.sRud + 0.012) * fa.c, rys[0], 0], [fb.xLE + (FIN.sRud + 0.012) * fb.c, rys[rys.length - 1], 0], M.tailPaint, { name: 'rudder' });
    finG.add(r.hinge); reg.reg('rudder', r.mesh, { layer: 'skin', mc: 'sandwich' });
    rig.rudder = r;

    // 垂尾内部：前后梁 + 肋
    const sg = [];
    for (const s of [0.16, 0.62]) {
      const yy = linspace(FIN.y0 + 0.3, FIN.y1 - 0.5, 14);
      sg.push(gridGeo(yy.map(y => [finPt(y, s, 0.9), finPt(y, s, -0.9)]), {}));
    }
    const sp = mk(merge(sg), new THREE.MeshStandardMaterial({ color: 0xd08a3c, roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide }), { name: 'finSpars' });
    finG.add(reg.reg('finStructure', sp, { layer: 'struct', mc: 'cfrp' }));
    const ribs = [];
    for (let y = 7.9; y < 16.6; y += 0.72) { const ss2 = linspace(0.16, 0.62, 8); ribs.push(gridGeo([ss2.map(s => finPt(y, s, 0.92)), ss2.map(s => finPt(y, s, -0.92))], {})); }
    finG.add(reg.reg('finStructure', mk(merge(ribs), M.rib, { name: 'finRibs' }), { layer: 'struct', mc: 'cfrp' }));

    // 顶部白色尾灯在机尾，垂尾顶部无灯；标志灯在平尾上。垂尾前缘内 HF 天线（示意略）
  }
  root.add(finG);

  // ================= 水平安定面（整体可配平）=================
  const stabG = grp('stabilizer');
  const sroot = stabSec(0);
  const pivot = [sroot.xLE + STAB.pivotS * sroot.c, STAB.y0, 0];
  stabG.position.set(...pivot);
  rig.elevators = [];
  for (const side of [1, -1]) {
    const S = side > 0 ? 'L' : 'R';
    const g = grp('stab' + S); g.scale.z = side;
    g.position.set(-pivot[0], -pivot[1], 0);
    const geos = [];
    const seg = (z0, z1, sEnd, full, n, caps) => geos.push(loftUV(linspace(z0, z1, n).map(z => fixedLoop(stabPt, z, sEnd, full)), null, caps));
    seg(0.0, STAB.elevZ[0], 1, true, 5, 'end');
    seg(STAB.elevZ[0], STAB.elevZ[1], STAB.sElev - 0.012, false, 16, 'both');
    seg(STAB.elevZ[1], STAB.half - 0.004, 1, true, 8, 'both');
    const st = mk(merge(geos), M.white, { name: 'stab' });
    g.add(reg.reg('stab', st, { layer: 'skin', mc: 'cfrp', side: S }));
    // 金属前缘
    const zs = linspace(1.7, 9.6, 16), ss = linspace(0.045, 0, 8), P = [];
    for (const z of zs) { const row = []; for (const s of ss) row.push(stabPt(z, s * (s / 0.045), 1, 0.004)); for (const s of ss.slice().reverse().slice(1)) row.push(stabPt(z, s * (s / 0.045), -1, 0.004)); row.forEach(p => { p[0] -= 0.004; }); P.push(row); }
    const le = mk(gridGeo(P, { inside: [58, STAB.y0 + 0.5, 5] }), M.polished, { name: 'stabLE' });
    g.add(reg.reg('stabLE', le, { layer: 'skin', mc: 'alu', side: S }));
    // 升降舵
    const ezs = linspace(STAB.elevZ[0] + 0.03, STAB.elevZ[1] - 0.03, 14);
    const eg = loftUV(ezs.map(z => devLoop(stabPt, z, STAB.sElev, 0.006)), null, 'both');
    const a = stabSec(ezs[0]), b = stabSec(ezs[ezs.length - 1]);
    const e = hingedDev(eg, [a.xLE + (STAB.sElev + 0.012) * a.c, a.yc, ezs[0]], [b.xLE + (STAB.sElev + 0.012) * b.c, b.yc, ezs[ezs.length - 1]], M.white, { name: 'elevator' });
    g.add(e.hinge); reg.reg('elevator', e.mesh, { layer: 'skin', mc: 'sandwich', side: S });
    rig.elevators.push(e);
    // 放电刷
    const wicks = [];
    for (const z of [3, 5, 7, 8.8]) { const p = stabPt(z, 1, 0); wicks.push(rod([p[0] - e.P0[0], p[1] - e.P0[1], p[2] - e.P0[2]], [p[0] + 0.22 - e.P0[0], p[1] - e.P0[1], p[2] - e.P0[2]], 0.006, 0.003, 6)); }
    const wk = mk(merge(wicks), M.black, { shadow: false, noPick: true }); wk.userData.layer = 'skin'; e.hinge.add(wk);
    // 内部梁
    const sg = [];
    for (const s of [0.15, 0.6]) { const zz = linspace(0, STAB.half - 0.5, 10); sg.push(gridGeo(zz.map(z => [stabPt(z, s, 0.9), stabPt(z, s, -0.9)]), {})); }
    const sp = mk(merge(sg), new THREE.MeshStandardMaterial({ color: 0xd08a3c, roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide }), { name: 'stabSpars' });
    g.add(reg.reg('stabStructure', sp, { layer: 'struct', mc: 'cfrp', side: S }));
    stabG.add(g);
  }
  rig.stab = stabG;
  root.add(stabG);
  return { root, rig, finG, stabG };
}
