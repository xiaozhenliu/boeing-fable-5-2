// 机身外部细节：风挡、舷窗、客舱门、货舱门、天线、大气数据探头、灯光、冲压空气涡轮、空调进气口
import * as THREE from 'three';
import { gridGeo, merge, loft, rod, sphere, box, tf, linspace, lerp, DEG } from '../core/geo.js';
import { M } from '../core/materials.js';
import { F, fuseSample, fuseSection, fuseThetaAtY, fairPoint, fairTAtZ, wingPoint } from './shape.js';
import { mk, grp } from './registry.js';
import { sectionOf } from './fuselage.js';

const TAU = Math.PI * 2;

// 客舱门（中心 x，ACAP 数据）、货舱门
export const DOORS = [6.30, 18.36, 35.43, 49.66];
export const DOOR_W = 1.07, DOOR_H = 1.88;
export const CARGO_DOORS = [
  { id: 'cargoDoorFwd', x: 11.00, w: 2.69, y0: F.cargoFloorY, y1: F.cargoFloorY + 1.70, side: -1 },
  { id: 'cargoDoorAft', x: 43.31, w: 2.69, y0: F.cargoFloorY + 0.06, y1: F.cargoFloorY + 1.76, side: -1 },
  { id: 'bulkDoor', x: 47.75, w: 1.02, y0: 3.06, y1: 4.18, side: 1 },
];
export const WIN_Y = F.floorY + 1.04;       // 舷窗中心高度
export const FRAME_PITCH = 0.61;            // 隔框间距 24 in
export const FRAME_X0 = 1.55 + 0.245;       // 框站位起点（使各客舱门位于两框之间）

/** 舷窗 x 站位（每个框距一扇，避开舱门） */
export function windowStations() {
  const xs = [];
  for (let k = 0; ; k++) {
    const x = FRAME_X0 + (k + 0.5) * FRAME_PITCH;
    if (x > 52.3) break;
    if (x < 7.6) continue;
    if (DOORS.some(d => Math.abs(x - d) < 1.02)) continue;
    xs.push(x);
  }
  return xs;
}

/**
 * 贴合机身表面的参数面片。c：4 个角点 [x, th]，顺序 前下→后下→后上→前上（th 以左舷为准）
 * o: side(±1) lift(外抬) n(圆角超椭圆指数) nu nv grow(外扩 m) livery(使用涂装 UV)
 */
function fusePatch(c, o = {}) {
  const { side = 1, lift = 0.004, n = 8, nu = 8, nv = 8, grow = 0, livery = false } = o;
  const at = (u, v) => {
    const a = (1 - u) / 2, b = (1 + u) / 2, d = (1 - v) / 2, e = (1 + v) / 2;
    const x = (c[0][0] * a + c[1][0] * b) * d + (c[3][0] * a + c[2][0] * b) * e;
    const th = (c[0][1] * a + c[1][1] * b) * d + (c[3][1] * a + c[2][1] * b) * e;
    return [x, side > 0 ? th : TAU - th];
  };
  const pos = (u, v) => { const [x, th] = at(u, v); const s = fuseSample(x, th); return [s.p[0] + s.n[0] * lift, s.p[1] + s.n[1] * lift, s.p[2] + s.n[2] * lift]; };
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const su = 1 + grow / (dist(pos(-1, 0), pos(1, 0)) / 2), sv = 1 + grow / (dist(pos(0, -1), pos(0, 1)) / 2);
  const P = [], UV = [];
  for (let i = 0; i <= nu; i++) {
    const row = [], ur = [];
    for (let j = 0; j <= nv; j++) {
      let u = i / nu * 2 - 1, v = j / nv * 2 - 1;
      const m = Math.max(Math.abs(u), Math.abs(v));
      if (m > 1e-9) { const l = Math.pow(Math.abs(u) ** n + Math.abs(v) ** n, 1 / n); u *= m / l; v *= m / l; }
      u *= su; v *= sv;
      row.push(pos(u, v));
      const [x, th] = at(u, v); ur.push([x / F.L, 1 - th / TAU]);
    }
    P.push(row); UV.push(ur);
  }
  const [xm] = at(0, 0);
  return gridGeo(P, { inside: [xm, fuseSection(xm).yC, 0], uv: livery ? (i, j) => UV[i][j] : undefined });
}
/** 以 x 范围与高度范围定义的矩形面片 */
function rectPatch(x0, x1, y0, y1, o) {
  const th = (x, y) => fuseThetaAtY(x, y);
  return fusePatch([[x0, th(x0, y0)], [x1, th(x1, y0)], [x1, th(x1, y1)], [x0, th(x0, y1)]], o);
}
/** 贴合翼身整流罩的面片（x 范围、z 范围；side=±1） */
function fairPatch(x0, x1, z0, z1, o = {}) {
  const { side = 1, lift = 0.004, n = 6, nu = 8, nv = 6 } = o;
  const P = [];
  for (let i = 0; i <= nu; i++) {
    const row = [];
    for (let j = 0; j <= nv; j++) {
      let u = i / nu * 2 - 1, v = j / nv * 2 - 1;
      const m = Math.max(Math.abs(u), Math.abs(v));
      if (m > 1e-9) { const l = Math.pow(Math.abs(u) ** n + Math.abs(v) ** n, 1 / n); u *= m / l; v *= m / l; }
      const x = lerp(x0, x1, (u + 1) / 2), z = lerp(z0, z1, (v + 1) / 2);
      const p = fairPoint(x, fairTAtZ(z));
      const q = fairPoint(x, fairTAtZ(z) - 0.02);
      // 近似外法线：朝下并略向外
      const dy = q[1] - p[1], dz = q[2] - p[2], l = Math.hypot(dy, dz) || 1;
      const ny = -dz / l, nz = dy / l;
      const sgn = ny < 0 ? 1 : -1;
      row.push([p[0], p[1] + sgn * ny * lift, side * (p[2] + sgn * nz * lift)]);
    }
    P.push(row);
  }
  return gridGeo(P, { inside: [(x0 + x1) / 2, F.YC, 0] });
}

/** 把局部几何（+x 沿机身向后，+y 沿外法线）安放到机身表面 */
function onFuse(geo, x, th, lift = 0) {
  const s = fuseSample(x, th);
  const n = new THREE.Vector3(...s.n);
  const t = new THREE.Vector3(1, 0, 0); t.addScaledVector(n, -t.dot(n)).normalize();
  const b = new THREE.Vector3().crossVectors(t, n);
  const m = new THREE.Matrix4().makeBasis(t, n, b);
  m.setPosition(s.p[0] + n.x * lift, s.p[1] + n.y * lift, s.p[2] + n.z * lift);
  geo.applyMatrix4(m);
  return geo;
}
/** 刀形天线 / 探头支柱 */
function blade(h, c0, c1, sweep, t = 0.022) {
  const secs = linspace(0, 1, 5).map(k => {
    const y = k * h, c = lerp(c0, c1, k), x0 = sweep * y, loop = [];
    for (let i = 0; i < 14; i++) { const a = i / 14 * TAU; loop.push([x0 + c / 2 + c / 2 * Math.cos(a), y, t / 2 * lerp(1, 0.45, k) * Math.sin(a)]); }
    return loop;
  });
  return loft(secs, { caps: 'end' });
}

export function buildDetails(reg, fus) {
  const sec = (x) => fus.secGroups[sectionOf(x).id];
  const add = (x, id, obj, o) => { sec(x).add(obj); if (id) reg.reg(id, obj, o); return obj; };
  const rig = {};

  // ---------------------------------------------------------------- 驾驶舱风挡（4 块）
  {
    const panes = [
      [[2.62, 1.5 * DEG], [3.12, 31 * DEG], [4.36, 27 * DEG], [4.20, 1.2 * DEG]],        // 前风挡
      [[3.30, 35 * DEG], [5.25, 63 * DEG], [4.95, 40 * DEG], [4.50, 31 * DEG]],          // 侧窗
    ];
    const glass = [], frame = [];
    for (const side of [1, -1]) for (const c of panes) {
      glass.push(fusePatch(c, { side, lift: 0.008, n: 5, nu: 14, nv: 14 }));
      frame.push(fusePatch(c, { side, lift: 0.004, n: 5, nu: 14, nv: 14, grow: 0.035 }));
    }
    const g = grp('windshield',
      mk(merge(frame), M.doorSeal, { shadow: false, layer: 'skin', mc: 'other' }),
      mk(merge(glass), M.cabinWindow, { shadow: false, layer: 'skin', mc: 'other' }));
    // 雨刷
    const wip = [];
    for (const side of [1, -1]) {
      const th = (d) => side > 0 ? d * DEG : TAU - d * DEG;
      const a = fuseSample(2.74, th(5)), b = fuseSample(3.10, th(25));
      const up = (s, l) => [s.p[0] + s.n[0] * l, s.p[1] + s.n[1] * l, s.p[2] + s.n[2] * l];
      wip.push(rod(up(a, 0.03), up(b, 0.03), 0.008, 0.006, 6));
      wip.push(sphere(0.022, up(a, 0.02), 8, 6));
    }
    g.add(mk(merge(wip), M.black, { layer: 'skin', mc: 'steel', noPick: true }));
    add(3.5, 'windshield', g);
  }

  // ---------------------------------------------------------------- 客舱舷窗
  {
    const bySec = new Map();
    for (const x of windowStations()) for (const side of [1, -1]) {
      const id = sectionOf(x).id;
      if (!bySec.has(id)) bySec.set(id, { glass: [], rim: [] });
      const b = bySec.get(id);
      b.glass.push(rectPatch(x - 0.135, x + 0.135, WIN_Y - 0.235, WIN_Y + 0.235, { side, lift: 0.005, n: 3.4, nu: 6, nv: 8 }));
      b.rim.push(rectPatch(x - 0.135, x + 0.135, WIN_Y - 0.235, WIN_Y + 0.235, { side, lift: 0.0025, n: 3.4, nu: 6, nv: 8, grow: 0.014 }));
    }
    for (const [id, b] of bySec) {
      const g = grp('windows',
        mk(merge(b.rim), M.doorSeal, { shadow: false, layer: 'skin', mc: 'other' }),
        mk(merge(b.glass), M.cabinWindow, { shadow: false, layer: 'skin', mc: 'other' }));
      fus.secGroups[id].add(g); reg.reg('cabinWindow', g);
    }
  }

  // ---------------------------------------------------------------- 客舱门（每侧 4 扇 A 型门）
  DOORS.forEach((xc, i) => {
    for (const side of [1, -1]) {
      const x0 = xc - DOOR_W / 2, x1 = xc + DOOR_W / 2, y0 = F.floorY - 0.03, y1 = F.floorY + DOOR_H;
      const g = grp('door' + (i + 1) + (side > 0 ? 'L' : 'R'));
      g.add(mk(rectPatch(x0, x1, y0, y1, { side, lift: 0.002, n: 14, nu: 12, nv: 18, grow: 0.02 }), M.doorSeal, { shadow: false, layer: 'skin', mc: 'other' }));
      g.add(mk(rectPatch(x0, x1, y0, y1, { side, lift: 0.006, n: 14, nu: 12, nv: 18, livery: true }), M.fusePaintTop, { layer: 'skin', mc: 'cfrp' }));
      g.add(mk(rectPatch(xc - 0.115, xc + 0.115, F.floorY + 1.3, F.floorY + 1.62, { side, lift: 0.011, n: 3.2, nu: 6, nv: 6, grow: 0.012 }), M.doorSeal, { shadow: false, layer: 'skin', mc: 'other' }));
      g.add(mk(rectPatch(xc - 0.115, xc + 0.115, F.floorY + 1.3, F.floorY + 1.62, { side, lift: 0.014, n: 3.2, nu: 6, nv: 6 }), M.cabinWindow, { shadow: false, layer: 'skin', mc: 'other' }));
      // 外部手柄凹槽
      g.add(mk(rectPatch(xc - 0.36, xc - 0.12, F.floorY + 0.93, F.floorY + 1.03, { side, lift: 0.011, n: 5, nu: 4, nv: 3 }), M.markDark, { shadow: false, layer: 'skin', mc: 'steel', noPick: true }));
      add(xc, 'paxDoor', g);
    }
  });

  // ---------------------------------------------------------------- 货舱门
  for (const d of CARGO_DOORS) {
    const x0 = d.x - d.w / 2, x1 = d.x + d.w / 2;
    const g = grp(d.id);
    const nu = d.w > 2 ? 22 : 10;
    g.add(mk(rectPatch(x0, x1, d.y0, d.y1, { side: d.side, lift: 0.002, n: 16, nu, nv: 14, grow: 0.022 }), M.doorSeal, { shadow: false, layer: 'skin', mc: 'other' }));
    g.add(mk(rectPatch(x0, x1, d.y0, d.y1, { side: d.side, lift: 0.006, n: 16, nu, nv: 14, livery: true }), M.fusePaintTop, { layer: 'skin', mc: 'cfrp' }));
    // 锁闩观察窗 / 手柄
    const marks = [];
    const nL = d.w > 2 ? 6 : 2;
    for (let k = 0; k < nL; k++) { const x = lerp(x0 + 0.25, x1 - 0.25, nL > 1 ? k / (nL - 1) : 0.5); marks.push(rectPatch(x - 0.035, x + 0.035, d.y0 + 0.07, d.y0 + 0.14, { side: d.side, lift: 0.01, n: 2, nu: 3, nv: 3 })); }
    marks.push(rectPatch(d.x - 0.14, d.x + 0.14, d.y0 + 0.36, d.y0 + 0.46, { side: d.side, lift: 0.01, n: 5, nu: 4, nv: 3 }));
    g.add(mk(merge(marks), M.markDark, { shadow: false, layer: 'skin', mc: 'steel', noPick: true }));
    add(d.x, d.id, g);
  }

  // ---------------------------------------------------------------- 天线
  {
    const put = (x, geo, mat = M.white, mc = 'glass') => { const m = mk(geo, mat, { layer: 'skin', mc }); add(x, 'antenna', m); };
    // VHF 刀形天线：背部 1、腹部 2
    put(13.6, onFuse(blade(0.34, 0.36, 0.16, 0.55), 13.6, 0, -0.01));
    put(15.2, onFuse(blade(0.32, 0.34, 0.15, 0.55), 15.2, Math.PI, -0.01));
    put(40.6, onFuse(blade(0.32, 0.34, 0.15, 0.55), 40.6, Math.PI, -0.01));
    // ATC/DME/TCAS 等小型刀形与贴片天线
    put(9.4, onFuse(blade(0.1, 0.16, 0.1, 0.4, 0.016), 9.4, Math.PI, -0.005));
    put(12.3, onFuse(blade(0.1, 0.16, 0.1, 0.4, 0.016), 12.3, Math.PI + 0.12, -0.005));
    put(8.6, onFuse(sphere(1, [0, 0, 0], 16, 8, [0.2, 0.035, 0.13]), 8.6, 0));
    put(10.1, onFuse(sphere(1, [0, 0, 0], 16, 8, [0.075, 0.03, 0.075]), 10.1, 0.07));
    put(10.1, onFuse(sphere(1, [0, 0, 0], 16, 8, [0.075, 0.03, 0.075]), 10.1, TAU - 0.07));
    put(50.4, onFuse(blade(0.12, 0.2, 0.1, 0.6, 0.016), 50.4, 0, -0.005));        // ELT
    // 卫星通信天线罩（背部）
    const sat = mk(onFuse(sphere(1, [0, 0, 0], 28, 12, [1.15, 0.2, 0.46]), 37.2, 0, -0.035), M.white, { layer: 'skin', mc: 'glass' });
    add(37.2, 'satcom', sat);
  }

  // ---------------------------------------------------------------- 大气数据探头（空速管、迎角传感器、总温探头）
  {
    const geos = [];
    const pitot = (x, th) => {
      const s = blade(0.085, 0.07, 0.045, -0.35, 0.014);
      const t = rod([-0.03, 0.085, 0], [-0.19, 0.085, 0], 0.0075, 0.006, 8);
      geos.push(onFuse(merge([s, t]), x, th));
    };
    pitot(2.28, 100 * DEG); pitot(2.36, 113 * DEG); pitot(2.28, TAU - 100 * DEG);
    const aoa = (x, th) => {
      const base = rod([0, 0, 0], [0, 0.012, 0], 0.045, 0.045, 16);
      const vane = blade(0.075, 0.07, 0.05, 0.9, 0.008);
      geos.push(onFuse(merge([base, vane]), x, th));
    };
    aoa(2.86, 96 * DEG); aoa(2.86, TAU - 96 * DEG);
    geos.push(onFuse(blade(0.06, 0.08, 0.06, 0.2, 0.02), 3.1, TAU - 118 * DEG));   // 总温探头
    add(2.4, 'airData', mk(merge(geos), M.steel, { layer: 'skin', mc: 'steel' }));
  }

  // ---------------------------------------------------------------- 灯光
  const lights = { beacons: [], strobes: [], landing: [] };
  {
    const dome = (r) => sphere(r, [0, 0, 0], 16, 10, [1.5, 1, 1]);
    const top = mk(onFuse(dome(0.075), 27.6, 0, -0.01), M.lightBeacon, { layer: 'skin', mc: 'other', shadow: false });
    add(27.6, 'beacon', top);
    const pb = fairPoint(27.6, 1);
    const bot = mk(tf(dome(0.075), [pb[0], pb[1] + 0.01, 0]), M.lightBeacon, { layer: 'skin', mc: 'other', shadow: false });
    fus.fairing.add(bot); reg.reg('beacon', bot);
    lights.beacons.push(top, bot);
    // 尾部白色航行灯 / 频闪灯
    const tl = [];
    for (const s of [1, -1]) tl.push(onFuse(sphere(0.05, [0, 0, 0], 10, 8, [1.6, 0.6, 1]), F.L - 0.55, s > 0 ? 95 * DEG : TAU - 95 * DEG));
    const tail = mk(merge(tl), M.lightStrobe, { layer: 'skin', mc: 'other', shadow: false });
    add(F.L - 0.5, 'tailLight', tail); lights.strobes.push(tail);
    // 翼根着陆灯
    const ll = [];
    for (const s of [1, -1]) { const p = wingPoint(3.32, 0.004, 1); ll.push(sphere(1, [p[0] + 0.02, p[1] - 0.05, s * p[2]], 14, 10, [0.07, 0.085, 0.2])); }
    const land = mk(merge(ll), M.lightLanding, { layer: 'skin', mc: 'other', shadow: false });
    fus.fairing.add(land); reg.reg('landingLight', land); lights.landing.push(land);
  }

  // ---------------------------------------------------------------- 空调系统冲压空气进气口 / 排气口（翼身整流罩下方）
  {
    const dark = [];
    for (const side of [1, -1]) {
      dark.push(fairPatch(19.35, 19.95, 1.05, 1.5, { side, lift: 0.006, n: 4 }));      // 座舱空气压缩机进气口
      dark.push(fairPatch(20.3, 21.2, 1.0, 1.62, { side, lift: 0.006, n: 5 }));        // 冲压空气进气口
      dark.push(fairPatch(27.0, 27.7, 0.95, 1.6, { side, lift: 0.006, n: 8 }));        // 换热器排气口
    }
    const m = mk(merge(dark), M.darkWell, { layer: 'skin', mc: 'other', shadow: false });
    fus.fairing.add(m); reg.reg('packInlet', m);
  }

  // ---------------------------------------------------------------- APU 进气门（尾锥右上）
  {
    const c = [[58.75, 28 * DEG], [59.45, 28 * DEG], [59.45, 62 * DEG], [58.75, 62 * DEG]];
    const g = grp('apuInlet',
      mk(fusePatch(c, { side: -1, lift: 0.002, n: 10, grow: 0.015 }), M.doorSeal, { shadow: false, layer: 'skin', mc: 'other' }),
      mk(fusePatch(c, { side: -1, lift: 0.005, n: 10, livery: true }), M.fusePaintTop, { layer: 'skin', mc: 'cfrp' }));
    add(59, 'apuInlet', g);
  }

  // ---------------------------------------------------------------- 冲压空气涡轮 RAT（右后翼身整流罩内，应急时放出）
  {
    const zc = -2.05, xh = 35.7;
    const ph = fairPoint(xh, fairTAtZ(-zc));
    const H = [xh, ph[1] + 0.32, zc];
    const arm = grp('ratArm'); arm.position.set(...H);
    const L = 1.0;
    arm.add(mk(merge([rod([0, 0, 0], [L, 0, 0], 0.055, 0.045, 12), rod([0, 0, -0.1], [0, 0, 0.1], 0.07, 0.07, 12),
      rod([L - 0.16, 0, 0], [L + 0.2, 0, 0], 0.085, 0.07, 14), box(0.3, 0.12, 0.16, [0.3, 0.02, 0])]), M.gearWhite, { layer: 'sys', mc: 'alu' }));
    const prop = grp('ratProp'); prop.position.set(L, -0.15, 0);       // 桨盘垂直于来流：放出后桨轴朝前
    const bl = [sphere(0.085, [0, -0.02, 0], 12, 8, [1, 1.5, 1])];
    for (const s of [1, -1]) {
      const b = blade(0.56, 0.13, 0.07, 0, 0.02); b.translate(-0.065, 0.05, 0); b.rotateY(s * 0.5); b.rotateX(s * Math.PI / 2);
      bl.push(b);
    }
    prop.add(mk(merge(bl), M.steelDark, { layer: 'sys', mc: 'alu' }));
    arm.add(prop);
    // 舱门（整流罩表面的一块面板，沿内侧边铰接）
    const dx0 = xh - 0.2, dx1 = xh + 1.45, dz0 = 1.7, dz1 = 2.4;
    const doorGeo = fairPatch(dx0, dx1, dz0, dz1, { side: -1, lift: 0.006, n: 14, nu: 12 });
    const hp = fairPoint((dx0 + dx1) / 2, fairTAtZ(dz1));
    const hingeP = [(dx0 + dx1) / 2, hp[1], -hp[2]];
    doorGeo.translate(-hingeP[0], -hingeP[1], -hingeP[2]);
    const door = mk(doorGeo, M.fairGrey, { layer: 'skin', mc: 'sandwich' });
    const doorH = grp('ratDoor', door); doorH.position.set(...hingeP);
    const seal = mk(fairPatch(dx0, dx1, dz0, dz1, { side: -1, lift: 0.003, n: 14, nu: 12 }), M.doorSeal, { layer: 'skin', mc: 'other', shadow: false, noPick: true });
    const g = grp('rat', arm, doorH, seal);
    fus.fairing.add(g); reg.reg('rat', g);
    rig.rat = {
      prop, t: 0,
      set(t) {
        this.t = t;
        doorH.rotation.x = Math.min(1, t * 2.2) * 100 * DEG;
        arm.rotation.z = -Math.max(0, (t - 0.25) / 0.75) * 96 * DEG;
        seal.visible = t < 0.01;
      },
    };
    rig.rat.set(0);
  }

  return { rig, lights };
}
