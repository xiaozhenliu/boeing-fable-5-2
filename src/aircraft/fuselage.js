// 机身蒙皮（按真实分段）、雷达罩、尾锥、涂装贴图、翼身整流罩
import * as THREE from 'three';
import { gridGeo, merge, lathe, ribbon, tf, linspace, headspace, pchip, clamp, lerp, DEG } from '../core/geo.js';
import { M } from '../core/materials.js';
import { F, FAIR, fusePoint, fuseSample, fuseSection, fuseThetaAtY, fairPoint, fairTAtZ, wingLE, wingTE, wingPoint } from './shape.js';
import { mk, grp } from './registry.js';

// 机身分段（787 的机身由数个整体成型的复合材料筒段对接而成）
export const SECTIONS = [
  { id: 'radome', x0: 0, x1: 1.55, mc: 'glass' },
  { id: 'sec41', x0: 1.55, x1: 12.8, mc: 'cfrp' },
  { id: 'sec43', x0: 12.8, x1: 21.0, mc: 'cfrp' },
  { id: 'sec44', x0: 21.0, x1: 29.5, mc: 'cfrp' },
  { id: 'sec46', x0: 29.5, x1: 39.0, mc: 'cfrp' },
  { id: 'sec47', x0: 39.0, x1: 52.6, mc: 'cfrp' },
  { id: 'sec48', x0: 52.6, x1: 58.2, mc: 'cfrp' },
  { id: 'tailcone', x0: 58.2, x1: F.L, mc: 'cfrp' },
];
export const sectionOf = (x) => SECTIONS.find(s => x >= s.x0 && x < s.x1) || SECTIONS[SECTIONS.length - 1];

// 起落架舱开口
export const NLG_WELL = { x0: 3.0, x1: 6.5, xSplit: 5.05, z: 0.62 };
export const MLG_WELL = { x0: 29.5, x1: 33.0, z0: 0.3, z1: 3.2 };

// 周向网格：NV 段；底部 ±KW 列对应前起落架舱门边（按 z 常值扭曲，保证门缝笔直）
export const NV = 96, KW = 3;
const d0 = KW * (2 * Math.PI / NV);
function nlgDelta(x) {
  const s = fuseSection(x);
  const r = clamp(NLG_WELL.z / Math.max(s.w, 1e-3), 0, 0.9);
  return Math.asin(Math.pow(r, s.n / 2));
}
/** 规范角 c -> 实际角 th（仅在底部附近做线性扭曲） */
export function thetaWarp(x, c) {
  const d = nlgDelta(x), PI = Math.PI;
  if (c <= PI - d0) return c * (PI - d) / (PI - d0);
  if (c <= PI + d0) return PI + (c - PI) * d / d0;
  return 2 * PI - (2 * PI - c) * (PI - d) / (PI - d0);
}

function stations(x0, x1) {
  const xs = new Set([x0, x1]);
  const add = (v) => { if (v > x0 + 1e-6 && v < x1 - 1e-6) xs.add(+v.toFixed(5)); };
  // 机头、机尾加密
  let x = x0;
  while (x < x1) { add(x); x += (x < 12 || x > 41) ? 0.25 : 0.5; }
  [NLG_WELL.x0, NLG_WELL.x1, NLG_WELL.xSplit].forEach(add);
  return [...xs].sort((a, b) => a - b);
}

function skinGeo(x0, x1, hole) {
  const xs = stations(x0, x1);
  const P = xs.map(x => { const row = []; for (let j = 0; j <= NV; j++) row.push(fusePoint(x, thetaWarp(x, j * 2 * Math.PI / NV))); return row; });
  return gridGeo(P, {
    seamV: true, inside: 'auto',
    uv: (i, j) => [xs[i] / F.L, 1 - thetaWarp(xs[i], j * 2 * Math.PI / NV) / (2 * Math.PI)],
    skip: hole ? (i, j) => { const xm = (xs[i] + xs[i + 1]) / 2; return xm > hole.x0 && xm < hole.x1 && j >= NV / 2 - KW && j < NV / 2 + KW; } : null,
  });
}

// ------------------------------------------------------------------ 涂装贴图（Canvas 程序化绘制）
const CW = 8192, CH = 2048;
export function makeLivery(maxSize = 8192) {
  const k = Math.min(1, maxSize / CW);
  const cv = document.createElement('canvas'); cv.width = CW * k; cv.height = CH * k;
  const g = cv.getContext('2d');
  g.scale(k, k);
  const X = (x) => x / F.L * CW, Y = (th) => th / (2 * Math.PI) * CH;
  g.fillStyle = '#f3f4f6'; g.fillRect(0, 0, CW, CH);

  // 以"高度曲线"定义的环带：填充高度低于 curve(x) 的区域（左右对称，绕过机腹）
  const fillBelow = (curve, xa, xb, color) => {
    const n = 500; g.beginPath();
    for (let i = 0; i <= n; i++) { const x = lerp(xa, xb, i / n); const th = fuseThetaAtY(Math.max(x, 0.02), curve(x)); const px = X(x), py = Y(th); i ? g.lineTo(px, py) : g.moveTo(px, py); }
    for (let i = n; i >= 0; i--) { const x = lerp(xa, xb, i / n); const th = fuseThetaAtY(Math.max(x, 0.02), curve(x)); g.lineTo(X(x), Y(2 * Math.PI - th)); }
    g.closePath(); g.fillStyle = color; g.fill();
  };
  // 灰色机腹
  fillBelow(() => F.bot + 0.8, 0, F.L, '#c3c9d0');
  // 尾部上扬的色带：深蓝主色 + 两道渐浅的飘带
  const A = pchip([[30, 0.87], [34, 1.72], [38, 2.47], [42, 3.22], [45, 4.17], [47.5, 5.37], [49.5, 6.67], [51.2, 8.07], [52, 9.2]]);
  fillBelow((x) => A(x + 2.75), 26, F.L, '#8fcdf0');
  fillBelow((x) => A(x + 2.3), 26, F.L, '#f3f4f6');
  fillBelow((x) => A(x + 1.75), 26, F.L, '#2a6fba');
  fillBelow((x) => A(x + 0.85), 26, F.L, '#f3f4f6');
  fillBelow((x) => A(x), 26, F.L, '#12305c');
  // 灰色机腹在色带之前的部分重新压上（色带只在后机身出现）
  // 文字
  const pxX = CW / F.L, pxY = CH / 18.36;
  const text = (str, x, thDeg, h, color, font = 'italic 700', spacing = 0) => {
    for (const side of [1, -1]) {
      g.save();
      const th = thDeg * DEG;
      g.translate(X(x), side > 0 ? Y(th) : Y(2 * Math.PI - th));
      if (side < 0) g.rotate(Math.PI);
      g.scale(pxX / pxY, 1);
      const size = h * pxY / 0.72;
      g.font = `${font} ${size}px "Helvetica Neue", "Arial", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
      if (spacing && 'letterSpacing' in g) g.letterSpacing = `${spacing * size}px`;
      g.fillText(str, 0, 0);
      g.restore();
    }
  };
  text('BOEING 787-9', 12.4, 40, 0.9, '#12305c', 'italic 700', 0.02);
  text('DREAMLINER', 5.7, 99, 0.2, '#2a6fba', 'italic 600', 0.08);
  text('787-9', 45.4, 62, 0.55, '#f3f4f6', 'italic 700', 0.02);
  // 机腹应急/搬运提示小标记（纯装饰性细节）
  g.fillStyle = '#b3261e';
  for (const x of []) for (const s of [1, -1]) {
    const th = 100 * DEG; g.fillRect(X(x) - 3, (s > 0 ? Y(th) : Y(2 * Math.PI - th)) - 3, 6, 6);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// ------------------------------------------------------------------ 构建
export function buildFuselage(reg, opt = {}) {
  const root = grp('fuselage');
  const secGroups = {};
  M.fusePaint.map = makeLivery(opt.textureSize || 8192);
  M.fusePaint.needsUpdate = true;
  M.fusePaintTop.map = M.fusePaint.map; M.fusePaintTop.needsUpdate = true;

  for (const s of SECTIONS) {
    const g = grp(s.id);
    let geo;
    if (s.id === 'radome') {
      const xs = headspace(0, s.x1, 26, 1.9);
      const P = xs.map(x => { const row = []; for (let j = 0; j <= NV; j++) row.push(fusePoint(Math.max(x, 0), thetaWarp(Math.max(x, 1e-4), j * 2 * Math.PI / NV))); return row; });
      geo = gridGeo(P, { seamV: true, inside: [1.4, F.YC - 0.6, 0], uv: (i, j) => [xs[i] / F.L, 1 - j / NV] });
    } else {
      geo = skinGeo(s.x0, s.x1, s.id === 'sec41' ? NLG_WELL : null);
    }
    const skin = mk(geo, s.id === 'radome' ? M.fusePaint : M.fusePaint, { name: s.id + '-skin' });
    reg.reg(s.id, skin, { layer: 'skin', mc: s.mc });
    g.add(skin);
    secGroups[s.id] = g; root.add(g);
  }

  // 雷达罩防雷击分流条
  {
    const geos = [];
    for (let k = 0; k < 8; k++) {
      const th = (k + 0.5) * Math.PI / 4;
      const samples = linspace(0.12, 1.42, 24).map(x => fuseSample(x, th));
      geos.push(ribbon(samples, 0.012, 0.002));
    }
    const m = mk(merge(geos), M.markDark, { shadow: false, noPick: true });
    m.userData.layer = 'skin'; m.userData.mc = 'alu';
    secGroups.radome.add(m);
  }

  // 尾锥末端：APU 排气口
  {
    const c = fuseSection(F.L), yc = (c.yT + c.yB) / 2, r = c.w;
    const ring = lathe([[F.L - 0.02, r], [F.L + 0.05, r * 0.97], [F.L + 0.05, r * 0.97], [F.L + 0.05, r * 0.8], [F.L + 0.05, r * 0.8], [F.L - 0.9, r * 0.74]], 40);
    tf(ring, [0, yc, 0]);
    const ex = mk(ring, M.titaniumHot, { name: 'apu-exhaust' });
    const plugG = lathe([[F.L - 0.9, r * 0.74], [F.L - 0.9, 0.001]], 24); tf(plugG, [0, yc, 0]);
    const plug = mk(plugG, M.black, { shadow: false });
    const eg = grp('apuExhaust', ex, plug);
    reg.reg('apuExhaust', eg, { layer: 'skin', mc: 'ti' });
    secGroups.tailcone.add(eg);
  }

  // 前起落架舱内壁
  {
    const W = NLG_WELL, ceil = F.floorY - 0.42;
    const xs = linspace(W.x0, W.x1, 24);
    const edge = (side) => xs.map(x => { const p = fusePoint(x, thetaWarp(x, Math.PI + side * d0)); return p; });
    const geos = [];
    for (const side of [1, -1]) {
      const e = edge(side);
      geos.push(gridGeo([e, e.map(p => [p[0], ceil, p[2]])], {}));
    }
    const cross = (x) => { const row = []; for (let j = NV / 2 - KW; j <= NV / 2 + KW; j++) row.push(fusePoint(x, thetaWarp(x, j * 2 * Math.PI / NV))); return row; };
    for (const x of [W.x0, W.x1]) { const c = cross(x); geos.push(gridGeo([c, c.map(p => [p[0], ceil, p[2]])], {})); }
    geos.push(gridGeo([[[W.x0, ceil, -W.z], [W.x0, ceil, W.z]], [[W.x1, ceil, -W.z], [W.x1, ceil, W.z]]], {}));
    const well = mk(merge(geos), M.darkWell, { shadow: false, noPick: true, layer: 'skin' });
    secGroups.sec41.add(well);
  }

  // 翼身整流罩
  const fairing = buildFairing(reg);
  root.add(fairing);

  return { root, secGroups, fairing };
}

function buildFairing(reg) {
  const W = MLG_WELL;
  const xset = new Set([W.x0, W.x1]);
  for (let x = FAIR.x0; x <= FAIR.x1 + 1e-6; x += 0.28) xset.add(+x.toFixed(4));
  xset.add(FAIR.x1);
  const xs = [...xset].sort((a, b) => a - b);
  const tA = fairTAtZ(W.z1), tB = fairTAtZ(W.z0);
  const tset = new Set([tA, tB, 1]);
  for (const t of linspace(0, FAIR.tSplit, 15)) tset.add(+t.toFixed(5));
  for (const t of linspace(FAIR.tSplit, 1, 30)) tset.add(+t.toFixed(5));
  const ts = [...tset].sort((a, b) => a - b).filter((t, i, a) => i === 0 || t - a[i - 1] > 4e-3 || t === tA || t === tB);
  const nT = ts.length;
  // 列：左舷 t=0..1，再右舷 t=1..0（镜像）
  const P = xs.map(x => {
    const row = ts.map(t => fairPoint(x, t));
    for (let k = nT - 2; k >= 0; k--) { const p = fairPoint(x, ts[k]); row.push([p[0], p[1], -p[2]]); }
    return row;
  });
  const jA = ts.indexOf(tA), jB = ts.indexOf(tB);
  const nCol = 2 * nT - 1;
  const inHole = (j) => (j >= jA && j < jB) || (j >= nCol - 1 - jB && j < nCol - 1 - jA);
  const geo = gridGeo(P, {
    inside: [29, F.YC, 0],
    skip: (i, j) => { const xm = (xs[i] + xs[i + 1]) / 2; return xm > W.x0 && xm < W.x1 && inHole(j); },
  });
  const skin = mk(geo, M.fairGrey, { name: 'wbf-skin' });
  const g = grp('wbFairing', skin);
  reg.reg('wbFairing', skin, { layer: 'skin', mc: 'glass' });

  // 主起落架舱内壁（左右各一）
  // 舱顶：机身内部到客舱地板下方；伸到机身外侧（翼根后缘下方）的部分必须压到机翼上表面以下，否则会从翼根上方穿出
  const ceil = F.floorY - 0.3, zIn = 2.55;
  const wingTop = (x) => {
    const le = wingLE(W.z1), te = wingTE(W.z1);
    return wingPoint(W.z1, clamp((x - le) / (te - le), 0.02, 0.97), 1)[1];
  };
  const top = (x, z) => {
    z = Math.abs(z);
    const out = Math.min(ceil, wingTop(x) - 0.16);
    return z <= zIn ? ceil : lerp(ceil, out, clamp((z - zIn) / (W.z1 - zIn), 0, 1));
  };
  const geos = [];
  for (const side of [1, -1]) {
    const xl = linspace(W.x0, W.x1, 14);
    const tl = linspace(tA, tB, 12);
    const wall = (pts) => gridGeo([pts, pts.map(p => [p[0], Math.max(p[1], top(p[0], p[2])), p[2]])], {});
    const fp = (x, t) => { const p = fairPoint(x, t); return [p[0], p[1], side * p[2]]; };
    geos.push(wall(xl.map(x => fp(x, tA))), wall(xl.map(x => fp(x, tB))));
    geos.push(wall(tl.map(t => fp(W.x0, t))), wall(tl.map(t => fp(W.x1, t))));
    geos.push(gridGeo(xl.map(x => [W.z0, zIn, W.z1].map(z => [x, top(x, z), side * z])), {}));
  }
  const well = mk(merge(geos), M.darkWell, { shadow: false, noPick: true, layer: 'skin' });
  g.add(well);
  return g;
}
