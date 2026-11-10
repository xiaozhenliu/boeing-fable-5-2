// 整机装配 + 活动部件驱动（襟缝翼、飞控舵面、起落架、反推、转子、灯光、机翼弯曲、爆炸图）
import * as THREE from 'three';
import { Registry } from './registry.js';
import { buildFuselage } from './fuselage.js';
import { buildWings } from './wing.js';
import { buildEngines, ENG } from './engine.js';
import { buildTail } from './tail.js';
import { buildGear } from './gear.js';
import { buildDetails } from './details.js';
import { buildStructure } from './structure.js';
import { buildCabin } from './cabin.js';
import { buildSystems } from './systems.js';
import { wingFlex, wingFlexSlope } from './shape.js';
import { M } from '../core/materials.js';
import { clamp, DEG } from '../core/geo.js';

export const X_OFFSET = -30.5;   // 让机体大致以机翼为中心置于原点
/** 襟翼手柄卡位（度） */
export const FLAP_DETENTS = [0, 1, 5, 10, 15, 17, 18, 20, 25, 30];

export function buildAircraft(opt = {}) {
  const reg = new Registry();
  const root = new THREE.Group(); root.name = 'B787-9';
  root.position.x = X_OFFSET;

  const fus = buildFuselage(reg, opt); root.add(fus.root);
  const wings = buildWings(reg); root.add(wings.root);
  const engines = buildEngines(reg); root.add(engines.root);
  const tail = buildTail(reg); root.add(tail.root);
  const gear = buildGear(reg); root.add(gear.root);
  const details = buildDetails(reg, fus);
  const structure = buildStructure(reg, fus);
  const cabin = buildCabin(reg, fus);
  const systems = buildSystems(reg, fus);

  // ------------------------------------------------------------ 控制量：目标值 tgt / 当前值 cur / 变化速率 rate（每秒）
  const tgt = { flaps: 0, speedbrake: 0, roll: 0, pitch: 0, yaw: 0, trim: 0, gear: 0, reverser: 0, n1: 0, rat: 0, flex: 0, explode: 0 };
  const cur = { ...tgt };
  const rate = { flaps: 7, speedbrake: 1.6, roll: 3.5, pitch: 3.5, yaw: 3.5, trim: 1.2, gear: 1 / 6.5, reverser: 0.7, n1: 0.3, rat: 0.6, flex: 0.45, explode: 0.9 };
  const lights = { beacon: true, strobe: false, nav: true, landing: false };

  const flexMeshes = [];
  root.traverse(o => { if (o.userData.flexMorph && o.morphTargetInfluences) flexMeshes.push(o); });

  // ------------------------------------------------------------ 爆炸图分组
  const ex = [];
  const addEx = (obj, x, y, z) => { if (obj) ex.push({ obj, base: obj.position.clone(), dir: new THREE.Vector3(x, y, z) }); };
  const sx = { radome: -11, sec41: -7.5, sec43: -3.8, sec44: 0, sec46: 3.8, sec47: 7.5, sec48: 11, tailcone: 14.5 };
  for (const id in sx) addEx(fus.secGroups[id], sx[id], 0, 0);
  addEx(structure.sec11, 0, -2.4, 0);
  addEx(systems.belly, 0, -4.0, 0);
  addEx(fus.fairing, 0, -5.8, 0);
  addEx(wings.L.g, 0, 0, 7.5); addEx(wings.R.g, 0, 0, -7.5);
  addEx(engines.L.sideG, -5.5, -2.2, 12); addEx(engines.R.sideG, -5.5, -2.2, -12);
  addEx(tail.finG, 11, 5.5, 0); addEx(tail.stabG, 11, -5.2, 0);
  const gk = gear.root.children;
  addEx(gk[0], -7.5, -3.6, 0); addEx(gk[1], 0, -7.6, 3.2); addEx(gk[2], 0, -7.6, -3.2);

  function apply(dt, time) {
    // --- 襟翼 / 缝翼 / 克鲁格襟翼 ---
    const f = cur.flaps;
    const slatT = clamp(f, 0, 1) * 0.6 + clamp((f - 20) / 5, 0, 1) * 0.4;     // 1~20：密封位；25/30：开缝位
    const droop = Math.min(f, 20) * 0.72;
    for (const [w, sgn] of [[wings.L, 1], [wings.R, -1]]) {
      const r = w.rig;
      r.flapsIn.set(-f * DEG); r.flapsOut.set(-f * DEG);
      r.slats.forEach(s => s.set(slatT * 24 * DEG));
      r.krueger?.set(-clamp(f, 0, 1) * 122 * DEG);
      // 右滚（roll>0）：左副翼下偏、右副翼上偏；右侧扰流板升起辅助滚转
      const rl = cur.roll * sgn;
      r.aileron.set(-rl * 22 * DEG);
      r.flaperon.set(-(droop + rl * 14) * DEG);
      const rollUp = Math.max(0, -rl) * 32, sb = cur.speedbrake * 48;
      r.spoilers.forEach(s => s.set(Math.max(rollUp, sb) * DEG));
    }
    // --- 尾翼 ---
    tail.rig.rudder.set(cur.yaw * 28 * DEG);
    tail.rig.elevators.forEach(e => e.set(cur.pitch * 24 * DEG));
    tail.rig.stab.rotation.z = cur.trim * 5 * DEG;
    // --- 起落架 / 反推 / RAT ---
    gear.set(cur.gear);
    for (const e of [engines.L, engines.R]) e.sleeve.position.x = cur.reverser * ENG.sleeveTravel;
    details.rig.rat.set(cur.rat);
    // --- 转子 ---
    const w1 = cur.n1 * 13;
    for (const e of [engines.L, engines.R]) { e.n1.rotation.x -= w1 * dt; e.n2.rotation.x -= w1 * 2.7 * dt; }
    if (cur.rat > 0.97) details.rig.rat.prop.rotation.y += 38 * dt;
    // --- 机翼上挠 ---
    const fl = cur.flex;
    for (const m of flexMeshes) m.morphTargetInfluences[0] = fl;
    for (const it of reg.flexItems) { it.g.position.y = it.y0 + wingFlex(it.z, fl); it.g.rotation.x = -Math.atan(wingFlexSlope(it.z, fl)); }
    // --- 爆炸图 ---
    const k = cur.explode, ke = k * k * (3 - 2 * k);
    for (const e of ex) e.obj.position.copy(e.base).addScaledVector(e.dir, ke);
    root.position.y = ke * 8.5;
    systems.lines.visible = k < 0.02;
    // --- 灯光 ---
    const ph = time % 1.25;
    M.lightBeacon.emissiveIntensity = lights.beacon && ph < 0.11 ? 9 : 0;
    const ps = time % 1.1;
    M.lightStrobe.emissiveIntensity = lights.strobe && (ps < 0.05 || (ps > 0.14 && ps < 0.19)) ? 12 : 0;
    M.lightLanding.emissiveIntensity = lights.landing ? 6 : 0;
    const nv = lights.nav ? 2.2 : 0;
    M.lightRed.emissiveIntensity = nv; M.lightGreen.emissiveIntensity = nv; if (M.lightWhite) M.lightWhite.emissiveIntensity = nv;
  }

  let time = 0;
  function update(dt) {
    time += dt;
    for (const k in tgt) {
      const d = tgt[k] - cur[k], step = rate[k] * dt;
      cur[k] = Math.abs(d) <= step ? tgt[k] : cur[k] + Math.sign(d) * step;
    }
    apply(dt, time);
  }
  /** 立即到位（跳过过渡动画） */
  function snap() { Object.assign(cur, tgt); apply(0, time); }
  apply(0, 0);

  return { root, reg, fus, wings, engines, tail, gear, details, structure, cabin, systems, tgt, cur, lights, update, snap };
}
