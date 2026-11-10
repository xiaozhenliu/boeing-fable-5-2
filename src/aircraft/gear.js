// 起落架：前起落架（双轮，向前收）、主起落架（四轮小车式，向内收）、舱门与收放时序
import * as THREE from 'three';
import { gridGeo, merge, lathe, solidPatch, rod, beam, box, torus, tf, linspace, lerp, clamp, smooth, DEG } from '../core/geo.js';
import { M } from '../core/materials.js';
import { F, GEAR, fusePoint, fairPoint, fairTAtZ } from './shape.js';
import { NLG_WELL, MLG_WELL, thetaWarp, NV, KW } from './fuselage.js';
import { mk, grp } from './registry.js';

// ---------- 机轮 ----------
function wheelGeo(R, w, rimR) {
  // 轮胎剖面（轴向 a，半径 r），带周向排水槽
  const hw = w / 2, prof = [];
  prof.push([-hw * 0.72, rimR]);
  prof.push([-hw * 0.93, rimR + (R - rimR) * 0.22], [-hw, rimR + (R - rimR) * 0.52], [-hw * 0.93, rimR + (R - rimR) * 0.82], [-hw * 0.78, R - 0.012]);
  const grooves = [-0.5, -0.18, 0.18, 0.5];
  let a = -hw * 0.78;
  for (const gq of grooves) {
    const ga = gq * hw; prof.push([ga - 0.012, R - (Math.abs(gq) > 0.3 ? 0.006 : 0)], [ga - 0.012, R - (Math.abs(gq) > 0.3 ? 0.006 : 0)], [ga - 0.008, R - 0.014], [ga + 0.008, R - 0.014], [ga + 0.012, R - (Math.abs(gq) > 0.3 ? 0.006 : 0)], [ga + 0.012, R - (Math.abs(gq) > 0.3 ? 0.006 : 0)]);
    a = ga;
  }
  prof.push([hw * 0.78, R - 0.012], [hw * 0.93, rimR + (R - rimR) * 0.82], [hw, rimR + (R - rimR) * 0.52], [hw * 0.93, rimR + (R - rimR) * 0.22], [hw * 0.72, rimR]);
  const tyre = lathe(prof, 56);
  // 轮毂（外侧面带减重孔位、螺栓）
  const rimP = [[hw * 0.72, rimR], [hw * 0.72, rimR], [hw * 0.66, rimR - 0.012], [hw * 0.52, rimR * 0.9], [hw * 0.40, rimR * 0.62], [hw * 0.44, rimR * 0.36], [hw * 0.56, rimR * 0.30], [hw * 0.58, rimR * 0.16], [hw * 0.58, 0.0]];
  const rimO = lathe(rimP, 40);
  const rimI = lathe(rimP.map(([x, r]) => [-x, r]), 40);
  const bolts = [];
  for (let k = 0; k < 12; k++) { const an = k / 12 * Math.PI * 2, r = rimR * 0.76; bolts.push(rod([hw * 0.44, r * Math.cos(an), r * Math.sin(an)], [hw * 0.50, r * Math.cos(an), r * Math.sin(an)], 0.012, 0.012, 6)); }
  const rim = merge([rimO, rimI, ...bolts]);
  const cap = lathe([[hw * 0.58, rimR * 0.16], [hw * 0.66, rimR * 0.12], [hw * 0.68, 0.0]], 20);
  // 让轮轴沿 z
  for (const g of [tyre, rim, cap]) g.rotateY(-Math.PI / 2);
  return { tyre, rim, cap };
}
function makeWheel(R, w, rimR, outward = 1) {
  const wg = wheelGeo(R, w, rimR);
  const g = grp('wheel', mk(wg.tyre, M.rubber), mk(wg.rim, M.alu), mk(wg.cap, M.steelDark));
  g.children[0].userData.mc = 'other'; g.children[1].userData.mc = 'alu';
  if (outward < 0) g.rotation.y = Math.PI;
  return g;
}

// ---------- 连杆 ----------
function linkMesh(r, mat) {
  const g = new THREE.CylinderGeometry(r, r, 1, 12); g.translate(0, 0.5, 0);
  return mk(g, mat);
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function setLink(m, p, q) {
  _a.set(...p); _b.set(...q).sub(_a);
  const len = _b.length();
  m.position.copy(_a); m.quaternion.setFromUnitVectors(_up, _b.normalize()); m.scale.set(1, len, 1);
}
// 平面两连杆求膝关节：A、B 为端点，l1 接 A，bend 为弯折方向（单位向量大致方向）
function knee(A, B, l1, l2, bend) {
  const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], D = Math.min(Math.hypot(...d), l1 + l2 - 1e-4);
  const u = d.map(v => v / (Math.hypot(...d) || 1));
  const a = (l1 * l1 - l2 * l2 + D * D) / (2 * D), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  // 垂直于 u 的方向（取 bend 在垂面内的分量）
  const dot = bend[0] * u[0] + bend[1] * u[1] + bend[2] * u[2];
  let n = [bend[0] - dot * u[0], bend[1] - dot * u[1], bend[2] - dot * u[2]]; const nl = Math.hypot(...n) || 1; n = n.map(v => v / nl);
  return [A[0] + u[0] * a + n[0] * h, A[1] + u[1] * a + n[1] * h, A[2] + u[2] * a + n[2] * h];
}

// ================================================================== 前起落架
function buildNose(reg) {
  const root = grp('noseGear');
  const pivot = [GEAR.noseX + 0.43, 2.76, 0];
  const axleY = GEAR.noseTyreR, L = Math.hypot(pivot[0] - GEAR.noseX, pivot[1] - axleY);
  const rake = Math.atan2(pivot[0] - GEAR.noseX, pivot[1] - axleY);
  const leg = grp('nlgLeg'); leg.position.set(...pivot);
  const inner = grp('nlgInner'); inner.rotation.z = -rake; leg.add(inner);   // 支柱前倾
  // 支柱局部：原点=转轴，-y 沿支柱向下
  const white = [], chrome = [], dark = [];
  white.push(rod([0, 0.1, -0.5], [0, 0.1, 0.5], 0.085));                        // 耳轴
  white.push(rod([0, 0.1, 0], [0, -1.18, 0], 0.115, 0.105, 20));                // 外筒
  white.push(beam([0, 0.05, -0.42], [0, -0.75, -0.08], 0.07, 0.09), beam([0, 0.05, 0.42], [0, -0.75, 0.08], 0.07, 0.09));   // 斜撑
  chrome.push(rod([0, -1.16, 0], [0, -L + 0.12, 0], 0.07, 0.07, 20));            // 活塞杆（镀铬）
  white.push(rod([0, -L + 0.2, 0], [0, -L - 0.1, 0], 0.095, 0.095, 16));        // 轮轴接头
  dark.push(rod([0, -L, -0.5], [0, -L, 0.5], 0.05));                            // 轮轴
  // 转弯作动（转向环 + 两个作动筒）
  dark.push(torus(0.135, 0.03, [0, -0.95, 0], [Math.PI / 2, 0, 0]));
  for (const s of [1, -1]) dark.push(rod([-0.05, -0.95, s * 0.17], [0.3, -0.88, s * 0.2], 0.035));
  // 防扭臂（前侧）
  for (const s of [1, -1]) {
    white.push(beam([-0.11, -1.1, s * 0.04], [-0.36, -1.55, s * 0.04], 0.05, 0.03, [0, 0, 1]));
    white.push(beam([-0.36, -1.55, s * 0.04], [-0.1, -L + 0.22, s * 0.04], 0.05, 0.03, [0, 0, 1]));
  }
  dark.push(rod([-0.36, -1.55, -0.07], [-0.36, -1.55, 0.07], 0.022));
  // 滑行灯
  const lightG = [];
  for (const s of [1, -1]) { lightG.push(tf(new THREE.CylinderGeometry(0.075, 0.06, 0.1, 16), [-0.16, -0.72, s * 0.17], [0, 0, Math.PI / 2])); dark.push(rod([0, -0.72, s * 0.1], [-0.1, -0.72, s * 0.17], 0.02)); }
  const strut = grp('nlgStrut', mk(merge(white), M.gearWhite), mk(merge(chrome), M.chrome), mk(merge(dark), M.steelDark), mk(merge(lightG), M.lightLanding, { shadow: false }));
  strut.children[0].userData.mc = 'steel'; strut.children[1].userData.mc = 'steel'; strut.children[2].userData.mc = 'ti';
  reg.reg('noseGear', strut, { layer: 'gear', mc: 'steel' });
  inner.add(strut);
  // 机轮
  const wheels = grp('nlgWheels');
  for (const s of [1, -1]) { const w = makeWheel(GEAR.noseTyreR, GEAR.noseTyreW, 0.205, s); w.position.set(0, -L, s * GEAR.noseSpacing / 2); wheels.add(w); }
  reg.reg('noseWheel', wheels, { layer: 'gear', mc: 'other' });
  inner.add(wheels);
  root.add(leg);

  // 阻力撑杆（两段折叠，IK 求解）
  const braceA = [-0.13, -1.0, 0], braceB = [pivot[0] - 1.36, pivot[1] + 0.12, 0];
  const l1 = 0.76, l2 = 0.76;
  const b1 = [], b2 = [];
  for (const s of [1, -1]) { b1.push(linkMesh(0.035, M.gearWhite)); b2.push(linkMesh(0.035, M.gearWhite)); }
  const brace = grp('nlgBrace', ...b1, ...b2);
  reg.reg('noseGear', brace, { layer: 'gear', mc: 'steel' });
  root.add(brace);

  // ---- 舱门（由机身曲面裁出，保证关闭时与蒙皮齐平）----
  const doors = [];
  const d0 = KW * (2 * Math.PI / NV);
  const doorPanel = (xa, xb, side, id) => {
    const xs = linspace(xa + 0.012, xb - 0.012, 12), cs = linspace(0.02, 0.98, 6);
    const P = xs.map(x => cs.map(c => fusePoint(x, thetaWarp(x, Math.PI - side * d0 * c))));   // side=+1 左舷
    const hA = fusePoint(xa, thetaWarp(xa, Math.PI - side * d0)), hB = fusePoint(xb, thetaWarp(xb, Math.PI - side * d0));
    const P0 = [(hA[0] + hB[0]) / 2, (hA[1] + hB[1]) / 2, (hA[2] + hB[2]) / 2];
    const geo = solidPatch(P, 0.03, { up: [0, -1, 0], uv: null }); geo.translate(-P0[0], -P0[1], -P0[2]);
    const m = mk(geo, M.white, { name: id });
    const hinge = grp('hinge', m); hinge.position.set(...P0);
    const axis = new THREE.Vector3(hB[0] - hA[0], hB[1] - hA[1], hB[2] - hA[2]).normalize();
    reg.reg('noseGearDoor', m, { layer: 'gear', mc: 'cfrp' });
    root.add(hinge);
    return { hinge, axis, side, set(a) { hinge.quaternion.setFromAxisAngle(axis, -side * a); } };
  };
  const W = NLG_WELL;
  const fwd = [doorPanel(W.x0, W.xSplit, 1, 'nlgDoorFL'), doorPanel(W.x0, W.xSplit, -1, 'nlgDoorFR')];
  const aft = [doorPanel(W.xSplit, W.x1, 1, 'nlgDoorAL'), doorPanel(W.xSplit, W.x1, -1, 'nlgDoorAR')];

  function set(t) {
    // t: 0=放下锁定, 1=收上锁定
    const swing = smooth(clamp((t - 0.16) / 0.64, 0, 1));
    const ang = swing * 87 * DEG;
    leg.rotation.z = -ang;
    const fo = t <= 0 ? 0 : t >= 1 ? 0 : (t < 0.16 ? smooth(t / 0.16) : t > 0.82 ? 1 - smooth((t - 0.82) / 0.18) : 1);
    for (const d of fwd) d.set(fo * 92 * DEG);
    const ao = 1 - smooth(clamp((swing - 0.55) / 0.45, 0, 1));
    for (const d of aft) d.set(ao * 88 * DEG);
    // 阻力撑杆 IK（在 x-y 平面内）
    const c = Math.cos(-ang - rake), s = Math.sin(-ang - rake);
    const A = [pivot[0] + braceA[0] * c - braceA[1] * s, pivot[1] + braceA[0] * s + braceA[1] * c, 0];
    const K = knee(A, braceB, l1, l2, [0, 1, 0.0]);
    [1, -1].forEach((sd, i) => {
      const z = sd * 0.1;
      setLink(b1[i], [A[0], A[1], z * 0.6], [K[0], K[1], z]); setLink(b2[i], [K[0], K[1], z], [braceB[0], braceB[1], z * 2.2]);
    });
  }
  return { root, set };
}

// ================================================================== 主起落架（单侧）
function buildMain(reg, side) {
  const S = side > 0 ? 'L' : 'R';
  const g = grp('mainGear' + S); g.scale.z = side;
  const zW = GEAR.track / 2, xM = GEAR.mainX;
  const pivot = [xM, 3.52, zW];
  const yB = GEAR.mainTyreR + 0.10;                // 小车梁中心高度
  const L = pivot[1] - yB;
  const leg = grp('mlgLeg'); leg.position.set(...pivot);
  const white = [], chrome = [], dark = [], hyd = [];
  // 耳轴（沿航向）与前/后撑
  white.push(rod([-1.05, 0, 0], [0.55, 0, 0], 0.11));
  white.push(rod([0, 0.05, 0], [0, -1.5, 0], 0.175, 0.165, 24));                     // 外筒
  white.push(beam([-0.95, 0, 0], [-0.08, -1.05, 0], 0.11, 0.13, [0, 0, 1]));         // 阻力撑杆（随支柱绕耳轴转）
  white.push(beam([0.5, 0, 0], [0.06, -0.7, 0], 0.09, 0.1, [0, 0, 1]));
  white.push(tf(new THREE.CylinderGeometry(0.21, 0.21, 0.16, 24), [0, -1.42, 0]));    // 下端密封箍
  chrome.push(rod([0, -1.45, 0], [0, -L + 0.25, 0], 0.115, 0.115, 24));               // 活塞杆
  white.push(rod([0, -L + 0.34, 0], [0, -L - 0.02, 0], 0.15, 0.17, 20));              // 活塞下端叉头
  // 防扭臂（后侧）
  for (const s of [1, -1]) {
    white.push(beam([0.17, -1.36, s * 0.07], [0.52, -1.9, s * 0.07], 0.07, 0.04, [0, 0, 1]));
    white.push(beam([0.52, -1.9, s * 0.07], [0.17, -L + 0.3, s * 0.07], 0.07, 0.04, [0, 0, 1]));
  }
  dark.push(rod([0.52, -1.9, -0.11], [0.52, -1.9, 0.11], 0.03));
  // 管路
  hyd.push(rod([-0.19, -0.1, 0.06], [-0.19, -1.4, 0.06], 0.014), rod([-0.19, -0.1, -0.06], [-0.19, -1.4, -0.06], 0.014), rod([0.03, -0.2, 0.19], [0.03, -1.35, 0.19], 0.012));
  const strut = grp('mlgStrut', mk(merge(white), M.gearWhite), mk(merge(chrome), M.chrome), mk(merge(dark), M.steelDark), mk(merge(hyd), M.steel));
  strut.children[0].userData.mc = 'ti'; strut.children[1].userData.mc = 'steel';
  reg.reg('mainGear', strut, { layer: 'gear', mc: 'ti', side: S });
  leg.add(strut);

  // 小车架（可俯仰）
  const truck = grp('truck'); truck.position.set(0, -L, 0);
  const tb = [], td = [];
  const ax = GEAR.axleSpacing / 2, ws = GEAR.wheelSpacing / 2;
  tb.push(beam([-ax - 0.12, 0, 0], [ax + 0.12, 0, 0], 0.22, 0.2, [0, 1, 0]));
  tb.push(rod([0, 0, -0.2], [0, 0, 0.2], 0.12));
  for (const sx of [1, -1]) { td.push(rod([sx * ax, 0, -ws - 0.3], [sx * ax, 0, ws + 0.3], 0.075)); }
  // 刹车拉杆
  for (const s of [1, -1]) td.push(rod([-ax, -0.19, s * 0.33], [ax, -0.19, s * 0.33], 0.02));
  const truckM = grp('truckBeam', mk(merge(tb), M.gearWhite), mk(merge(td), M.steelDark));
  truckM.children[0].userData.mc = 'ti';
  reg.reg('mainGear', truckM, { layer: 'gear', mc: 'ti', side: S });
  truck.add(truckM);
  const wheels = grp('mlgWheels'), brakes = [];
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const w = makeWheel(GEAR.mainTyreR, GEAR.mainTyreW, 0.292, sz); w.position.set(sx * ax, 0, sz * ws); wheels.add(w);
    // 电刹车：碳刹车盘组 + 4 个电作动器 (EBA)
    const zb = sz * (ws - GEAR.mainTyreW * 0.42);
    brakes.push(tf(new THREE.CylinderGeometry(0.235, 0.235, 0.2, 28), [sx * ax, 0, zb - sz * 0.02], [Math.PI / 2, 0, 0]));
    for (let k = 0; k < 4; k++) { const an = k * Math.PI / 2 + Math.PI / 4; brakes.push(rod([sx * ax + 0.16 * Math.cos(an), 0.16 * Math.sin(an), zb - sz * 0.1], [sx * ax + 0.16 * Math.cos(an), 0.16 * Math.sin(an), zb - sz * 0.25], 0.045, 0.045, 10)); }
  }
  reg.reg('mainWheel', wheels, { layer: 'gear', mc: 'other', side: S });
  const brakeM = mk(merge(brakes), M.steelDark, { name: 'brakes' });
  reg.reg('brake', brakeM, { layer: 'gear', mc: 'other', side: S });
  truck.add(wheels, brakeM);
  // 小车俯仰作动筒
  const posAct = linkMesh(0.04, M.steel); leg.add(posAct);
  leg.add(truck);

  // 支柱舱门（固定在支柱外侧）
  {
    const P = linspace(-0.62, 0.62, 6).map(x => linspace(-0.25, -2.05, 6).map(y => [x, y, 0.34 + 0.06 * Math.cos(x * 2.2)]));
    const dm = mk(solidPatch(P, 0.025, { up: [0, 0, 1] }), M.fairGrey, { name: 'strutDoor' });
    const links = mk(merge([rod([0, -0.6, 0.17], [0, -0.6, 0.36], 0.02), rod([0, -1.3, 0.17], [0, -1.3, 0.36], 0.02)]), M.steelDark);
    const sd = grp('strutDoor', dm, links);
    reg.reg('mainGearDoor', sd, { layer: 'gear', mc: 'cfrp', side: S });
    leg.add(sd);
  }
  g.add(leg);

  // 侧撑杆（两段折叠）
  const sbA = [0, -1.22, -0.16], sbB = [xM - 0.05, 3.3, zW - 1.62], sl1 = 0.9, sl2 = 0.9;
  const s1 = linkMesh(0.055, M.gearWhite), s2 = linkMesh(0.055, M.gearWhite);
  const sb = grp('sideBrace', s1, s2);
  reg.reg('mainGear', sb, { layer: 'gear', mc: 'ti', side: S });
  g.add(sb);

  // 机身主起舱门（铰链靠近龙骨梁，向下打开）
  const Wl = MLG_WELL, tA = fairTAtZ(Wl.z1), tB = fairTAtZ(Wl.z0);
  const xs = linspace(Wl.x0 + 0.015, Wl.x1 - 0.015, 14), ts = linspace(lerp(tA, tB, 0.008), lerp(tA, tB, 0.992), 12);
  const P = xs.map(x => ts.map(t => fairPoint(x, t)));
  const hA = fairPoint(Wl.x0, tB), hB = fairPoint(Wl.x1, tB);
  const P0 = [(hA[0] + hB[0]) / 2, (hA[1] + hB[1]) / 2, (hA[2] + hB[2]) / 2];
  const dgeo = solidPatch(P, 0.035, { up: [0, -1, 0] }); dgeo.translate(-P0[0], -P0[1], -P0[2]);
  const door = mk(dgeo, M.fairGrey, { name: 'mlgBodyDoor' });
  const dh = grp('hinge', door); dh.position.set(...P0);
  const dAxis = new THREE.Vector3(hB[0] - hA[0], hB[1] - hA[1], hB[2] - hA[2]).normalize();
  reg.reg('mainGearDoor', door, { layer: 'gear', mc: 'cfrp', side: S });
  g.add(dh);

  function set(t) {
    const swing = smooth(clamp((t - 0.18) / 0.62, 0, 1));
    const ang = swing * 77.5 * DEG;
    leg.rotation.x = ang;
    truck.rotation.z = -8 * DEG * Math.sin(Math.PI * clamp(swing * 1.0, 0, 1)) * 0 + (-10 * DEG) * smooth(clamp(t / 0.15, 0, 1)) * (1 - 0.6 * swing);
    const open = t <= 0 ? 0 : t >= 1 ? 0 : (t < 0.18 ? smooth(t / 0.18) : t > 0.82 ? 1 - smooth((t - 0.82) / 0.18) : 1);
    dh.quaternion.setFromAxisAngle(dAxis, open * 86 * DEG);
    // 侧撑杆 IK（y-z 平面）
    const c = Math.cos(ang), s = Math.sin(ang);
    const A = [pivot[0] + sbA[0], pivot[1] + sbA[1] * c - sbA[2] * s, pivot[2] + sbA[1] * s + sbA[2] * c];
    const K = knee(A, sbB, sl1, sl2, [0, 1, 0.2]);
    setLink(s1, A, K); setLink(s2, K, sbB);
    // 小车俯仰作动筒（支柱局部坐标）
    const tz = truck.rotation.z, fx = -0.55, fy = 0.08;
    setLink(posAct, [-0.16, -L + 0.75, 0], [fx * Math.cos(tz) - fy * Math.sin(tz), -L + fx * Math.sin(tz) + fy * Math.cos(tz), 0]);
  }
  return { g, set };
}

export function buildGear(reg) {
  const root = grp('landingGear');
  const nose = buildNose(reg), mL = buildMain(reg, 1), mR = buildMain(reg, -1);
  root.add(nose.root, mL.g, mR.g);
  const set = (t) => { nose.set(t); mL.set(t); mR.set(t); };
  set(0);
  return { root, set };
}
