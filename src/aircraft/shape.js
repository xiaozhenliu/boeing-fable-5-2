// 787-9 外形数学定义：机身、翼身整流罩、机翼的参数化曲面
// 坐标系：x 由机头指向机尾（机头 x=0），y 向上（地面 y=0），z 指向左翼（左舷为 +z）。单位：米
import { clamp, lerp, pchip, plin, smooth, spow, DEG } from '../core/geo.js';

// ------------------------------------------------------------------ 总体参数
export const AC = {
  length: 62.81,       // 全长
  span: 60.12,         // 翼展
  height: 17.02,       // 垂尾顶离地高
  fuseW: 5.77,         // 机身外宽
  fuseH: 5.94,         // 机身外高
};

// ------------------------------------------------------------------ 机身
export const F = {
  L: 62.0,             // 机身（至尾锥末端）长度（ACAP：62.00 m）
  W: 2.885,            // 等直段半宽
  RT: 2.93,            // 最大宽度线以上的半高
  RB: 3.01,            // 最大宽度线以下的半高
  YC: 4.73,            // 等直段最大宽度线离地高度（机腹离地约 1.72 m，机身顶约 7.66 m，对应 ACAP 中等载重状态）
  noseTipDrop: 1.05,   // 机头尖端低于最大宽度线的距离
  xNoseTop: 11.0, xNoseBot: 7.4, xNoseW: 9.2,
  xTailTop: 46.5, xTailBot: 42.0, xTailW: 44.5,
  tailTopDrop: 1.55,   // 尾锥末端上缘相对机身顶部下降量（由下方计算）
  floorY: 4.65,        // 客舱地板上表面离地高度（ACAP 各门槛高度 4.5~4.9 m）
  cargoFloorY: 2.62,   // 货舱地板（ACAP 货舱门槛 2.3~3.0 m）
};
F.top = F.YC + F.RT; F.bot = F.YC - F.RB;
const yTip = F.YC - F.noseTipDrop;
const tailEndC = F.YC + 1.38, tailEndR = 0.30;   // 尾锥末端（APU 排气口）中心与半径

// 机头上轮廓（相对最大宽度线的高度）：雷达罩—风挡—驾驶舱顶连续光顺，无"眉线"
const noseTopP = pchip([[0, -1.05], [0.01, -0.987], [0.03, -0.94], [0.06, -0.895], [0.12, -0.84], [0.4, -0.62], [1, -0.30], [2, 0.22], [3, 0.82],
  [3.6, 1.18], [4.5, 1.69], [5.5, 2.09], [6.5, 2.39], [8, 2.72], [9.5, 2.88], [11, 2.93]]);
const noseF = (u, a, b) => Math.pow(1 - Math.pow(1 - clamp(u, 0, 1), a), 1 / b);
const tailTopP = pchip([[0, 0], [0.12, 0.004], [0.3, 0.045], [0.5, 0.16], [0.7, 0.38], [0.85, 0.62], [1, 1]]);
const tailBotP = pchip([[0, 0], [0.08, 0.008], [0.2, 0.055], [0.35, 0.165], [0.5, 0.31], [0.7, 0.54], [0.85, 0.735], [1, 1]]);
const tailWP = pchip([[0, 0], [0.15, 0.012], [0.3, 0.07], [0.45, 0.19], [0.6, 0.36], [0.75, 0.56], [0.9, 0.78], [1, 1]]);

/** 机身 x 站位的截面参数 */
export function fuseSection(x) {
  let yT, yB, w;
  // 上轮廓
  if (x < F.xNoseTop) yT = F.YC + noseTopP(x);
  else if (x < F.xTailTop) yT = F.top;
  else yT = F.top - (F.top - (tailEndC + tailEndR)) * tailTopP((x - F.xTailTop) / (F.L - F.xTailTop));
  // 下轮廓
  if (x < F.xNoseBot) yB = yTip - (yTip - F.bot) * noseF(x / F.xNoseBot, 2.2, 1.75);
  else if (x < F.xTailBot) yB = F.bot;
  else yB = F.bot + ((tailEndC - tailEndR) - F.bot) * tailBotP((x - F.xTailBot) / (F.L - F.xTailBot));
  // 半宽
  if (x < F.xNoseW) w = F.W * noseF(x / F.xNoseW, 2.0, 1.72);
  else if (x < F.xTailW) w = F.W;
  else w = F.W - (F.W - tailEndR) * tailWP((x - F.xTailW) / (F.L - F.xTailW));
  const k = F.RB / (F.RT + F.RB);
  const yC = yB + (yT - yB) * k;
  // 驾驶舱段截面略"方"，更接近真实机头
  const n = 2 + 0.22 * smooth((x - 0.8) / 2.5) * (1 - smooth((x - 5.5) / 5));
  return { yT, yB, yC, w, n };
}

/** 机身表面点：th=0 顶部，th=π/2 左舷，th=π 底部 */
export function fusePoint(x, th) {
  const s = fuseSection(x), e = 2 / s.n;
  const c = Math.cos(th), sn = Math.sin(th);
  const y = s.yC + (c >= 0 ? (s.yT - s.yC) : (s.yC - s.yB)) * spow(c, e);
  return [x, y, s.w * spow(sn, e)];
}

/** 表面点 + 外法线 */
export function fuseSample(x, th) {
  const p = fusePoint(x, th);
  const ex = 2e-3, et = 2e-3;
  const xa = Math.max(1e-4, x - ex), xb = Math.min(F.L, x + ex);
  const a = fusePoint(xa, th), b = fusePoint(xb, th);
  const c = fusePoint(x, th - et), d = fusePoint(x, th + et);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = d[0] - c[0], vy = d[1] - c[1], vz = d[2] - c[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  const s = fuseSection(x);
  if (nx * 0 + ny * (p[1] - s.yC) + nz * p[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return { p, n: [nx, ny, nz] };
}

/** 给定高度 y，求左舷侧的 th（0..π） */
export function fuseThetaAtY(x, y) {
  const s = fuseSection(x);
  const r = y >= s.yC ? (s.yT - s.yC) : (s.yC - s.yB);
  const q = clamp((y - s.yC) / r, -1, 1);
  return Math.acos(spow(q, s.n / 2));
}
/** 给定高度的机身半宽 */
export function fuseHalfWidthAtY(x, y) {
  const s = fuseSection(x);
  const r = y >= s.yC ? (s.yT - s.yC) : (s.yC - s.yB);
  const q = Math.abs((y - s.yC) / r);
  if (q >= 1) return 0;
  return s.w * Math.pow(1 - Math.pow(q, s.n), 1 / s.n);
}
/** 沿周向走弧长 ds（正值向下/th 增大方向）后的 th */
export function fuseThetaArc(x, th, ds) {
  let t = th; const steps = 8;
  for (let i = 0; i < steps; i++) {
    const a = fusePoint(x, t - 1e-3), b = fusePoint(x, t + 1e-3);
    const dl = Math.hypot(b[1] - a[1], b[2] - a[2]) / 2e-3;
    t += (ds / steps) / dl;
  }
  return t;
}
/** 内缩后的机身点（用于内部结构/内饰），inset 为向内偏移量 */
export function fuseInner(x, th, inset) {
  const s = fuseSample(x, th);
  return [s.p[0], s.p[1] - s.n[1] * inset, s.p[2] - s.n[2] * inset];
}

// ------------------------------------------------------------------ 翼身整流罩
export const FAIR = { x0: 17.6, x1: 41.4, wMax: 3.46, yRef: F.bot + 0.78, depth: 0.07, tSplit: 0.4, n: 3.6 };
const fairM = pchip([[17.6, 0], [19.2, 0.1], [21.5, 0.55], [24.2, 0.97], [25.5, 1], [34.6, 1], [37, 0.72], [39.5, 0.25], [41.4, 0]]);
const fairYA = pchip([[17.6, F.bot + 0.85], [20.5, F.bot + 1.3], [23, F.bot + 2.05], [25.5, F.bot + 2.52], [28, F.bot + 2.6], [31.5, F.bot + 2.5], [35, F.bot + 1.95], [38.5, F.bot + 1.3], [41.4, F.bot + 0.8]]);
export function fairSection(x) {
  const m = fairM(x);
  return { m, yA: fairYA(x), yB: F.bot - FAIR.depth * Math.min(1, m * 1.3), wf: FAIR.wMax };
}
/** 整流罩左半截面点，t∈[0,1]：0=与机身相接处，1=腹部中线 */
export function fairPoint(x, t) {
  const fs = fairSection(x);
  const thA = fuseThetaAtY(x, fs.yA);
  // 贴合机身的基准形（略内缩）
  const base = fusePoint(x, lerp(thA, Math.PI, t));
  const sec = fuseSection(x);
  const bz = base[2] * 0.985, by = sec.yC + (base[1] - sec.yC) * 0.985;
  // 鼓包形
  const zA = fuseHalfWidthAtY(x, fs.yA) * 0.985;
  let z, y;
  if (t < FAIR.tSplit) {
    const ph = (t / FAIR.tSplit) * Math.PI / 2;
    z = zA + (fs.wf - zA) * Math.pow(Math.sin(ph), 0.85);
    y = FAIR.yRef + (fs.yA - FAIR.yRef) * Math.pow(Math.cos(ph), 0.85);
  } else {
    const ph = ((t - FAIR.tSplit) / (1 - FAIR.tSplit)) * Math.PI / 2, e = 2 / FAIR.n;
    z = fs.wf * Math.pow(Math.cos(ph), e);
    y = FAIR.yRef - (FAIR.yRef - fs.yB) * Math.pow(Math.sin(ph), e);
  }
  const m = fs.m;
  return [x, lerp(by, y, m), lerp(bz, z, m)];
}
/** 整流罩底部（下半段）给定 z 处的 t */
export function fairTAtZ(z) {
  const ph = Math.acos(Math.pow(clamp(z / FAIR.wMax, 0, 1), FAIR.n / 2));
  return FAIR.tSplit + (1 - FAIR.tSplit) * ph / (Math.PI / 2);
}

// ------------------------------------------------------------------ 机翼
export const W = {
  zSOB: 2.95,          // 机身侧面（翼根）
  zKink: 9.3,          // 后缘转折
  zTipBreak: 26.2,     // 斜削式翼尖起点
  zTip: 30.06,         // 半翼展
  xLE0: 20.55,         // 前缘延长线在对称面处的 x
  tanLE: Math.tan(34.5 * DEG),
  yQ0: 3.24,           // 翼根 1/4 弦线离地高度
  dihedral: 6.3 * DEG,
  flexTip: 3.1,        // 巡航状态翼尖上挠量
  // 展向分区（左翼，z）
  slatIn: [3.75, 8.42],
  krueger: [8.5, 9.12],  // 密封式克鲁格襟翼（内侧缝翼与吊挂之间，展长约 0.58 m）
  slatOut: [10.8, 26.0], nSlatOut: 5,
  flapIn: [3.52, 9.28],
  flaperon: [9.34, 11.5],
  flapOut: [11.56, 21.2],
  aileron: [21.26, 25.55],
  spoilIn: [3.9, 9.1], nSpoilIn: 3,
  spoilOut: [11.75, 21.0], nSpoilOut: 4,
  // 弦向分区（弦长百分比）
  sSlatU: 0.135, sSlatL: 0.055,
  // 外侧（襟翼弦长约 30%）与内侧（翼根弦长很大，襟翼弦长比例较小，主起落架位于其前方）
  sSpoilHinge: 0.615, sSpoilTE: 0.745, sFlapLE: 0.70,
  inb: { hinge: 0.705, te: 0.805, flapLE: 0.775 },
  outb: { hinge: 0.615, te: 0.745, flapLE: 0.70 },
  sFixedTE: 0.715,     // 无扰流板区固定段上表面终点
  sAilLE: 0.725,
  sFrontSpar: 0.14, sRearSpar: 0.60,
};
const dTip = W.zTip - W.zTipBreak;
const xLEb = W.xLE0 + W.zTipBreak * W.tanLE;
const teIn = [[0, 33.95], [W.zKink, 34.72], [W.zTipBreak, xLEb + 2.38]];
const teLin = plin(teIn);
const teSlopeOut = (teIn[2][1] - teIn[1][1]) / (teIn[2][0] - teIn[1][0]);
const kLE = (Math.tan(63 * DEG) - W.tanLE) / (2 * dTip);
const xLEtip = xLEb + W.tanLE * dTip + kLE * dTip * dTip;
const kTE = ((xLEtip + 0.32) - (teIn[2][1] + teSlopeOut * dTip)) / (dTip * dTip);

export function wingLE(z) {
  z = Math.abs(z);
  if (z <= W.zTipBreak) return W.xLE0 + z * W.tanLE;
  const d = z - W.zTipBreak;
  return xLEb + W.tanLE * d + kLE * d * d;
}
export function wingTE(z) {
  z = Math.abs(z);
  if (z <= W.zTipBreak) return teLin(z);
  const d = z - W.zTipBreak;
  return teIn[2][1] + teSlopeOut * d + kTE * d * d;
}
const twistP = pchip([[0, 2.6], [W.zSOB, 2.6], [W.zKink, 0.6], [18, -0.9], [W.zTipBreak, -2.4], [W.zTip, -3.2]]);
const tcP = pchip([[0, 0.14], [W.zSOB, 0.136], [W.zKink, 0.108], [18, 0.098], [W.zTipBreak, 0.092], [W.zTip, 0.085]]);

/** 翼弯曲（飞行状态上挠）：flex∈[0,1] */
export function wingFlex(z, flex = 0) {
  const e = clamp((Math.abs(z) - W.zSOB) / (W.zTip - W.zSOB), 0, 1);
  return flex * W.flexTip * Math.pow(e, 2.15);
}
export function wingFlexSlope(z, flex = 0) {
  const e = clamp((Math.abs(z) - W.zSOB) / (W.zTip - W.zSOB), 0, 1);
  return flex * W.flexTip * 2.15 * Math.pow(e, 1.15) / (W.zTip - W.zSOB);
}

export function wingSection(z) {
  z = Math.abs(z);
  const xLE = wingLE(z), c = wingTE(z) - xLE;
  const yQ = W.yQ0 + Math.max(0, z - W.zSOB) * Math.tan(W.dihedral);
  return { xLE, c, yQ, twist: twistP(z) * DEG, tc: tcP(z) };
}

/** 超临界风格翼型：返回 [上表面 y/c, 下表面 y/c] */
export function airfoil(s, tc, camber = 1) {
  s = clamp(s, 0, 1);
  const yt = 5 * tc * (0.2969 * Math.sqrt(s) - 0.1260 * s - 0.3516 * s * s + 0.2843 * s * s * s - 0.1036 * s * s * s * s) + 0.0011 * s;
  const yc = camber * (0.011 * 4 * s * (1 - s) + 0.016 * (256 / 27) * s * s * s * (1 - s));
  return [yc + yt, yc - yt];
}

/** 机翼剖面内的点：s 弦向百分比，h 为 y/c（剖面局部），返回世界坐标 [x,y,z] */
export function wingLocal(z, s, h, flex = 0) {
  const w = wingSection(z);
  const xq = 0.25 * w.c, xl = s * w.c, yl = h * w.c;
  const ca = Math.cos(w.twist), sa = Math.sin(w.twist);
  const x = w.xLE + xq + (xl - xq) * ca + yl * sa;
  const y = w.yQ - (xl - xq) * sa + yl * ca + wingFlex(z, flex);
  return [x, y, z];
}
/** 机翼表面点：surf=+1 上表面，-1 下表面；off 为法向外偏移（米，近似沿 y） */
export function wingPoint(z, s, surf, off = 0, flex = 0) {
  const w = wingSection(z);
  const [u, l] = airfoil(s, w.tc);
  return wingLocal(z, s, (surf > 0 ? u : l) + surf * off / w.c, flex);
}
/** 机翼中弧面上的点（k=0 下表面，k=1 上表面） */
export function wingMid(z, s, k = 0.5, flex = 0) {
  const w = wingSection(z);
  const [u, l] = airfoil(s, w.tc);
  return wingLocal(z, s, lerp(l, u, k), flex);
}

// ------------------------------------------------------------------ 起落架位置
export const GEAR = {
  noseX: 5.41, noseTyreR: 0.508, noseTyreW: 0.406, noseSpacing: 0.66,
  mainX: 31.24, track: 9.8, mainTyreR: 0.686, mainTyreW: 0.533, axleSpacing: 1.46, wheelSpacing: 1.37,
};
