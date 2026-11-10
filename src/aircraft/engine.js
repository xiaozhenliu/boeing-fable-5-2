// 动力装置：GEnx-1B 风格的高涵道比涡扇发动机短舱、风扇、核心机（示意）、反推平移罩、吊挂
import * as THREE from 'three';
import { gridGeo, loft, merge, lathe, solidPatch, rod, box, tf, linspace, lerp, clamp, smooth, pchip, DEG } from '../core/geo.js';
import { M } from '../core/materials.js';
import { wingSection, airfoil, wingLocal } from './shape.js';
import { mk, grp } from './registry.js';

export const ENG = {
  z: 9.91,            // 发动机中心线距机身对称面（ACAP：9.91 m）
  xInlet: 20.80,      // 进气道唇口前缘 x（ACAP：机头至短舱前缘 20.80 m）
  yAxis: 2.585,       // 唇口处轴线离地高度（短舱最低点离地约 0.72 m）
  sx: 1.07,           // 轴向比例（短舱全长约 5.7 m，含尾锥约 7.9 m）
  pitch: 1.8 * DEG,   // 安装仰角（进气口略上仰）
  toe: 1.5 * DEG,     // 内偏角
  fanR: 1.41,         // 风扇半径（直径 2.82 m / 111 in）
  nBlades: 18,
  sleeveTravel: 0.58,
};
const NSEG = 128, NCHEV = 16;

// 唇口非轴对称：上唇前伸（进气口下垂修形）
const scarf = (x, r, a) => [x - 0.11 * Math.cos(a) * (1 - smooth(x / 1.7)), r * Math.cos(a), r * Math.sin(a)];

function lipProfile() {
  const p = [];
  for (const t of linspace(1, 0, 12)) { const x = 0.30 * t; p.push([x, 1.46 - 0.125 * Math.sqrt(1 - (1 - t) * (1 - t))]); }
  for (const t of linspace(0, 1, 16).slice(1)) { const x = 0.45 * t; p.push([x, 1.46 + 0.19 * Math.sqrt(1 - (1 - t) * (1 - t)) + 0.04 * t]); }
  return p;
}
const outerR = pchip([[0.45, 1.69], [0.9, 1.742], [1.45, 1.773], [2.0, 1.788], [2.6, 1.784], [3.05, 1.765], [3.8, 1.70], [4.5, 1.60], [4.95, 1.525], [5.3, 1.468]]);
const ductOuterR = pchip([[0.30, 1.335], [0.6, 1.342], [1.0, 1.375], [1.45, 1.412], [2.2, 1.43], [3.05, 1.485], [4.0, 1.50], [4.95, 1.485], [5.3, 1.455]]);
const coreR = pchip([[2.0, 0.74], [2.3, 0.86], [2.9, 1.02], [3.6, 1.08], [4.4, 1.05], [5.3, 0.95], [5.9, 0.80], [6.35, 0.655]]);

// 锯齿（chevron）后缘：把 x>xc 的部分按周向锯齿收缩
const xc = 4.93, xt = 5.3;
function chevMap(inner) {
  return (x, r, a) => {
    if (x <= xc) return [x, r * Math.cos(a), r * Math.sin(a)];
    const f = (a / (2 * Math.PI) * NCHEV) % 1, tri = 0.1 + 0.9 * Math.abs(2 * f - 1);
    const x2 = xc + (x - xc) * tri;
    const rr = inner ? ductOuterR(x2) : outerR(x2);
    return [x2, rr * Math.cos(a), rr * Math.sin(a)];
  };
}
const prof = (fn, x0, x1, n) => linspace(x0, x1, n).map(x => [x, fn(x)]);

function fanBlades() {
  const hubR = 0.40, tipR = ENG.fanR - 0.006, NR = 14, NC = 9;
  const P = [], PL = [];
  for (let i = 0; i <= NR; i++) {
    const t = i / NR, r = lerp(hubR, tipR, t);
    const c = lerp(0.30, 0.52, Math.pow(t, 0.8)) * (1 - 0.12 * smooth((t - 0.85) / 0.15));
    const beta = lerp(22, 63, Math.pow(t, 0.85)) * DEG;
    const xle = 1.50 + 0.07 * Math.sin(Math.PI * t * 0.9) - 0.10 * t * t;       // 后掠宽弦
    const row = [], rowL = [];
    for (let k = 0; k <= NC; k++) {
      const u = k / NC;
      const camb = 0.035 * c * Math.sin(Math.PI * u) * (1 - 0.6 * t);
      const tang = (u - 0.42) * c * Math.sin(beta) + camb;
      const x = xle + u * c * Math.cos(beta);
      const ph = tang / r;
      const pt = [x, r * Math.cos(ph), r * Math.sin(ph)];
      row.push(pt);
      if (u <= 0.12) rowL.push(pt);
    }
    P.push(row);
    // 钛合金包边
    const u2 = 0.1, tang2 = (u2 - 0.42) * c * Math.sin(beta) + 0.035 * c * Math.sin(Math.PI * u2) * (1 - 0.6 * t), ph2 = tang2 / r;
    PL.push([[row[0][0] - 0.004, row[0][1], row[0][2]], [xle + u2 * c * Math.cos(beta), r * Math.cos(ph2), r * Math.sin(ph2)]]);
  }
  const one = solidPatch(P, 0.014, {}), le = solidPatch(PL, 0.019, {});
  le.translate(0, 0, 0);
  const blades = [], les = [];
  for (let k = 0; k < ENG.nBlades; k++) {
    const a = k * 2 * Math.PI / ENG.nBlades;
    blades.push(one.clone().rotateX(a)); les.push(le.clone().rotateX(a));
  }
  return { blades: merge(blades), les: merge(les) };
}

function bladeRow(x, rh, rt, n, chord, stagger, thick = 0.006) {
  const geos = [];
  const b = new THREE.BoxGeometry(chord, rt - rh, thick);
  b.rotateY(stagger); b.translate(x, (rt + rh) / 2, 0);
  for (let k = 0; k < n; k++) geos.push(b.clone().rotateX(k * 2 * Math.PI / n));
  return merge(geos);
}

function buildEngine(reg, side) {
  const S = side > 0 ? 'L' : 'R';
  const g = grp('engine' + S);            // 发动机局部坐标：原点=唇口中心，+x 向后
  const R = (id, obj, layer, mc) => reg.reg(id, obj, { layer, mc, side: S });

  // ---- 进气道 ----
  const lip = mk(lathe(lipProfile(), NSEG, { map: scarf }), M.polished, { name: 'lip' });
  const inletOuter = mk(lathe(prof(outerR, 0.45, 1.45, 10), NSEG, { map: scarf }), M.nacelle);
  const inletInner = mk(lathe(prof(ductOuterR, 0.30, 1.45, 12), NSEG, { map: scarf, inward: true }), M.liner);
  const inlet = grp('inlet', lip, inletOuter, inletInner);
  R('engInlet', inlet, 'skin', 'alu'); inletOuter.userData.mc = 'sandwich'; inletInner.userData.mc = 'sandwich';
  g.add(inlet);

  // ---- 风扇整流罩 ----
  const fc = mk(merge([lathe(prof(outerR, 1.45, 3.05, 12), NSEG), lathe(prof(ductOuterR, 1.45, 3.05, 10), NSEG, { inward: true })]), M.nacelle, { name: 'fanCowl' });
  R('engFanCowl', fc, 'skin', 'sandwich'); g.add(fc);
  // 整流罩分缝线与锁扣（细节）
  {
    const lines = [];
    for (const x of [0.45, 1.45, 3.05]) lines.push(lathe([[x - 0.006, outerR(Math.max(x, 0.45)) + 0.002], [x + 0.006, outerR(Math.max(x, 0.45)) + 0.002]], NSEG, x < 1.7 ? { map: scarf } : {}));
    const lm = mk(merge(lines), M.jointLine, { shadow: false, noPick: true }); lm.userData.layer = 'skin';
    g.add(lm);
  }

  // ---- 反推平移罩（带锯齿后缘）----
  const sleeveG = grp('sleeve');
  const outerP = [...prof(outerR, 3.05, xc, 12), ...prof(outerR, xc, xt, 6).slice(1)];
  const innerP = [...prof(ductOuterR, 3.05, xc, 10), ...prof(ductOuterR, xc, xt, 6).slice(1)];
  const sleeve = mk(merge([lathe(outerP, NSEG, { map: chevMap(false) }), lathe(innerP, NSEG, { map: chevMap(true), inward: true }),
  lathe([[3.05, ductOuterR(3.05)], [3.05, outerR(3.05)]], NSEG)]), M.nacelle, { name: 'sleeve' });
  sleeveG.add(sleeve);
  R('engReverser', sleeveG, 'skin', 'sandwich'); g.add(sleeveG);
  // 叶栅（平移罩后移后露出）
  {
    const geos = [lathe([[3.06, 1.70], [3.62, 1.672]], 96), lathe([[3.06, 1.50], [3.62, 1.50]], 96, { inward: true })];
    for (let k = 0; k < 9; k++) { const x = 3.08 + k * 0.066; geos.push(lathe([[x, 1.50], [x + 0.02, 1.705 - k * 0.003]], 96)); }
    for (let k = 0; k < 40; k++) { const a = k / 40 * Math.PI * 2; geos.push(tf(box(0.56, 0.2, 0.012), [3.34, 1.6 * Math.cos(a), 1.6 * Math.sin(a)], [a, 0, 0])); }
    const cas = mk(merge(geos), M.cascade, { name: 'cascade' });
    R('engCascade', cas, 'skin', 'sandwich'); g.add(cas);
  }

  // ---- 核心机整流罩 / 尾喷管 / 尾锥 ----
  const coreCowl = mk(merge([lathe(prof(coreR, 2.0, 6.35, 30), 72), lathe([[6.35, 0.655], [6.35, 0.63]], 72), lathe([[6.35, 0.63], [5.6, 0.70], [5.0, 0.73]], 72, { inward: true })]), M.titanium, { name: 'coreCowl' });
  R('engCoreCowl', coreCowl, 'skin', 'ti'); g.add(coreCowl);
  const plug = mk(lathe([[5.0, 0.38], [5.5, 0.44], [6.0, 0.42], [6.5, 0.32], [7.0, 0.17], [7.3, 0.06], [7.38, 0.0]], 48), M.titaniumHot, { name: 'plug' });
  R('engPlug', plug, 'skin', 'ti'); g.add(plug);
  // 涡轮后机匣支板（从尾喷口可见）
  {
    const geos = [];
    for (let k = 0; k < 12; k++) geos.push(tf(box(0.34, 0.30, 0.02), [5.75, 0.56, 0], [0, 0.25, 0]).rotateX(k * Math.PI / 6));
    geos.push(lathe([[5.55, 0.001], [5.55, 0.72]], 48));
    const trf = mk(merge(geos), M.ductDark, { name: 'trf', noPick: true }); trf.userData.layer = 'skin';
    g.add(trf);
  }

  // ---- 外涵道内的出口导向叶片 (OGV) 与分流环 ----
  {
    const geos = [];
    const N = 40;
    for (let k = 0; k < N; k++) {
      const v = box(0.34, 0.60, 0.012); v.rotateY(-0.32); v.rotateZ(-0.12); v.translate(2.62, 1.15, 0); v.rotateX(k * 2 * Math.PI / N);
      geos.push(v);
    }
    const ogv = mk(merge(geos), M.liner, { name: 'ogv' });
    R('engOGV', ogv, 'skin', 'sandwich'); g.add(ogv);
    // 内涵进口（增压级进口导叶处，深色）
    const ci = mk(merge([lathe([[2.02, 0.44], [2.02, 0.735]], 64), lathe([[1.76, 0.42], [2.02, 0.44]], 64)]), M.ductDark, { noPick: true });
    ci.userData.layer = 'skin'; g.add(ci);
    // 上下分叉（吊挂/附件通道穿过外涵）
    const bif = [];
    for (const s of [1, -1]) bif.push(tf(box(2.3, 0.62, 0.16), [4.1, s * 1.24, 0]));
    const bm = mk(merge(bif), M.ductDark, { noPick: true }); bm.userData.layer = 'skin'; g.add(bm);
  }

  // ---- 低压转子 (N1)：整流锥 + 风扇 + 增压级 + 低压涡轮 ----
  const n1 = grp('n1'), n2 = grp('n2');
  const rot = grp('rotors', n1, n2);
  if (side < 0) rot.scale.z = -1;           // 抵消镜像，保持叶片旋向一致
  g.add(rot);
  {
    const sp = mk(lathe([[0.60, 0.0], [0.63, 0.035], [0.72, 0.10], [0.90, 0.20], [1.12, 0.30], [1.36, 0.385], [1.44, 0.40]], 48), M.black, { name: 'spinner' });
    // 整流锥上的螺旋标记（提醒地勤发动机在转动）
    const spiral = [];
    const pr = pchip([[0.60, 0.0], [0.72, 0.10], [0.90, 0.20], [1.12, 0.30], [1.36, 0.385]]);
    const pts = linspace(0.64, 1.34, 60).map((x, i) => { const a = i / 60 * Math.PI * 3.2, r = pr(x) + 0.003; return [x, r * Math.cos(a), r * Math.sin(a)]; });
    const rib = [];
    for (let i = 0; i < pts.length; i++) { const p = pts[i]; const l = Math.hypot(p[1], p[2]) || 1; rib.push({ p, n: [-0.45, p[1] / l * 0.9, p[2] / l * 0.9] }); }
    spiral.push(gridGeo(rib.map((s, i) => { const w = 0.012 + 0.03 * i / rib.length; return [[s.p[0] - w, s.p[1], s.p[2]], [s.p[0] + w, s.p[1], s.p[2]]]; }), {}));
    const spm = mk(merge(spiral), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { shadow: false });
    const spg = grp('spinner', sp, spm);
    R('engSpinner', spg, 'skin', 'alu'); n1.add(spg);
    const fb = fanBlades();
    const hub = lathe([[1.44, 0.40], [1.70, 0.42], [1.76, 0.42]], 48);
    const fan = grp('fan', mk(fb.blades, M.fanBlade), mk(fb.les, M.fanLE), mk(hub, M.black));
    fan.children[0].userData.mc = 'cfrp'; fan.children[1].userData.mc = 'ti';
    R('engFan', fan, 'skin', 'cfrp'); n1.add(fan);
  }
  // ---- 核心机内部（示意）----
  const coreG = grp('core');
  {
    const cmat = (c, e = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.6, emissive: e, emissiveIntensity: e ? 0.9 : 0, side: THREE.DoubleSide });
    const mLPC = cmat(0x5b93dd), mHPC = cmat(0x3fb8b0), mComb = cmat(0xff8a2a, 0xff5a00), mHPT = cmat(0xe0483c), mLPT = cmat(0xd9953a), mShaft = cmat(0x9aa2ab);
    // 低压轴
    n1.add(R('engShaft', mk(rod([1.5, 0, 0], [6.15, 0, 0], 0.07, 0.07, 16), mShaft, { name: 'lpShaft' }), 'core', 'steel'));
    // 增压级（低压压气机）4 级
    const lpc = [];
    for (let i = 0; i < 4; i++) { const x = 2.14 + i * 0.17; lpc.push(bladeRow(x, 0.47 + i * 0.012, 0.72 - i * 0.012, 44, 0.07, 0.6)); }
    lpc.push(lathe([[2.05, 0.30], [2.05, 0.46], [2.75, 0.50], [2.75, 0.30]], 40));
    n1.add(R('engLPC', mk(merge(lpc), mLPC, { name: 'lpc' }), 'core', 'ti'));
    // 高压压气机 10 级
    const hpc = [];
    for (let i = 0; i < 10; i++) { const t = i / 9, x = 3.02 + i * 0.128; hpc.push(bladeRow(x, lerp(0.25, 0.305, t), lerp(0.53, 0.37, t), 52, lerp(0.07, 0.04, t), 0.75)); }
    hpc.push(lathe([[2.96, 0.12], [2.96, 0.24], [4.22, 0.30], [4.22, 0.12]], 40));
    n2.add(R('engHPC', mk(merge(hpc), mHPC, { name: 'hpc' }), 'core', 'ti'));
    // 环形燃烧室
    const comb = lathe([[4.28, 0.36], [4.36, 0.30], [4.70, 0.31], [4.76, 0.40], [4.70, 0.52], [4.36, 0.535], [4.28, 0.47], [4.28, 0.36]], 48);
    coreG.add(R('engCombustor', mk(comb, mComb, { name: 'combustor' }), 'core', 'other'));
    // 高压涡轮 2 级
    const hpt = [bladeRow(4.86, 0.36, 0.52, 64, 0.06, -0.8), bladeRow(5.0, 0.36, 0.54, 64, 0.06, -0.8), lathe([[4.80, 0.12], [4.80, 0.36], [5.06, 0.36], [5.06, 0.12]], 40)];
    n2.add(R('engHPT', mk(merge(hpt), mHPT, { name: 'hpt' }), 'core', 'other'));
    // 低压涡轮 7 级
    const lpt = [];
    for (let i = 0; i < 7; i++) { const t = i / 6, x = 5.18 + i * 0.13; lpt.push(bladeRow(x, lerp(0.36, 0.40, t), lerp(0.56, 0.70, t), 70, 0.07, -0.7)); }
    lpt.push(lathe([[5.12, 0.10], [5.12, 0.35], [6.06, 0.39], [6.06, 0.10]], 40));
    n1.add(R('engLPT', mk(merge(lpt), mLPT, { name: 'lpt' }), 'core', 'other'));
    // 高压轴鼓筒
    n2.add(mk(rod([4.2, 0, 0], [4.82, 0, 0], 0.13, 0.13, 20), mShaft, { noPick: true }));
    // 附件齿轮箱 + 两台变频起动发电机 (VFSG)
    const agb = [lathe([[1.95, 1.47], [1.95, 1.70], [2.55, 1.72], [2.55, 1.47], [1.95, 1.47]], 16, { a0: Math.PI - 0.55, a1: Math.PI + 0.55 })];
    const agbM = mk(merge(agb), M.steelDark, { name: 'agb' });
    const vf = [];
    for (const a of [Math.PI - 0.3, Math.PI + 0.3]) { const y = 1.6 * Math.cos(a), z = 1.6 * Math.sin(a); vf.push(rod([2.55, y, z], [3.02, y, z], 0.115, 0.115, 16)); vf.push(rod([3.02, y, z], [3.1, y, z], 0.07, 0.05, 12)); }
    const vfM = mk(merge(vf), M.sysElec, { name: 'vfsg' });
    coreG.add(R('engAGB', agbM, 'core', 'alu'));
    coreG.add(R('engVFSG', vfM, 'sys', 'other'));
  }
  g.add(coreG);

  // ---- 短舱扰流片 (strake / chine)，位于内侧 ----
  {
    const a0 = -52 * DEG;                    // 朝内侧上方（左发的 -z 方向）
    const xs = linspace(1.0, 2.9, 14);
    const P = xs.map((x) => {
      const t = (x - 1.0) / 1.9, h = 0.30 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.6)), 0.8);
      const r0 = outerR(x) - 0.01, a = a0 - 0.05 * t;
      return [[x, r0 * Math.cos(a), r0 * Math.sin(a)], [x + 0.08 * h, (r0 + h) * Math.cos(a), (r0 + h) * Math.sin(a)]];
    });
    const st = mk(solidPatch(P, 0.014, {}), M.nacelle, { name: 'strake' });
    R('engStrake', st, 'skin', 'alu'); g.add(st);
  }

  return { g, n1, n2, sleeve: sleeveG };
}

// ------------------------------------------------------------------ 吊挂（在飞机坐标系中构建）
function buildPylon(reg, side) {
  const S = side > 0 ? 'L' : 'R';
  const z = ENG.z, xI = ENG.xInlet, yA = ENG.yAxis;
  const w = wingSection(z), xLE = w.xLE;
  const axisY = (x) => yA - Math.tan(ENG.pitch) * (x - xI);
  const k = ENG.sx, oR = (d) => outerR(d / k);
  const lowY = (x) => { const s = clamp((x - xLE) / w.c, 0.001, 1); return wingLocal(z, s, airfoil(s, w.tc)[1])[1]; };
  const midY = (x) => { const s = clamp((x - xLE) / w.c, 0.001, 1); const [u, l] = airfoil(s, w.tc); return wingLocal(z, s, lerp(l, u, 0.45))[1]; };
  const xEnd = xLE + 0.66 * w.c;
  const leY = wingLocal(z, 0, 0)[1];
  const top = pchip([[xI + 0.8, axisY(xI + 0.8) + oR(0.8) - 0.06], [xI + 1.7, axisY(xI + 1.7) + oR(1.7) + 0.07], [xI + 3.4, lerp(axisY(xI + 3.4) + oR(3.4) + 0.12, leY, 0.4)], [xLE - 0.6, leY - 0.2], [xLE + 0.05, leY - 0.02]]);
  const topY = (x) => x <= xLE + 0.05 ? top(x) : midY(x);
  const bot = pchip([[xI + 0.8, axisY(xI + 0.8) + 1.35], [xI + 4.9 * k, axisY(xI + 4.9 * k) + 1.30], [xI + 5.35 * k, axisY(xI + 5.35 * k) + 1.05], [xI + 6.25 * k, axisY(xI + 6.25 * k) + 0.80], [xI + 7.2 * k, axisY(xI + 7.2 * k) + 0.95],
  [xEnd - 1.3, lowY(xEnd - 1.3) - 0.2], [xEnd, lowY(xEnd) + 0.03]]);
  const hw = pchip([[xI + 0.8, 0.0], [xI + 1.3, 0.17], [xI + 2.6, 0.31], [xI + 4.8, 0.34], [xI + 6.7, 0.30], [xEnd - 1.6, 0.2], [xEnd, 0.03]]);
  const xs = linspace(xI + 0.8, xEnd, 64), n = 2.7, NS = 28;
  const secs = xs.map(x => {
    const t = topY(x), b = Math.min(bot(x), t - 0.02), c = (t + b) / 2, h = (t - b) / 2, ww = hw(x), row = [];
    for (let k = 0; k < NS; k++) { const a = k / NS * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a); row.push([x, c + h * Math.sign(cs) * Math.pow(Math.abs(cs), 2 / n), z + ww * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n)]); }
    return row;
  });
  const P0 = [xLE, leY, z];
  const geo = loft(secs, { caps: 'end' }); geo.translate(-P0[0], -P0[1], -P0[2]);
  const m = mk(geo, M.nacelle, { name: 'pylon' });
  reg.reg('pylon', m, { layer: 'skin', mc: 'ti', side: S });
  return { m, P0 };
}

export function buildEngines(reg) {
  const root = grp('engines');
  const out = { root, L: null, R: null };
  for (const side of [1, -1]) {
    const e = buildEngine(reg, side);
    const py = buildPylon(reg, side);
    // 发动机安装：唇口位置 + 仰角 + 内偏
    const mount = grp('engineMount', e.g);
    e.g.rotation.order = 'YZX';
    e.g.rotation.z = -ENG.pitch; e.g.rotation.y = -ENG.toe;      // 左发：进气口朝内偏
    e.g.scale.x = ENG.sx;
    e.g.position.set(ENG.xInlet - py.P0[0], ENG.yAxis - py.P0[1], ENG.z - py.P0[2]);
    const station = grp('engineStation' + (side > 0 ? 'L' : 'R'), mount, py.m);
    station.position.set(...py.P0);
    const sideG = grp('engSide', station); sideG.scale.z = side;
    reg.flexItems.push({ g: station, z: py.P0[2], y0: py.P0[1] });
    root.add(sideG);
    out[side > 0 ? 'L' : 'R'] = { ...e, station, sideG };
  }
  return out;
}
