// 机载系统（示意）：气象雷达、电子设备舱与电池、电源馈线、环控组件与风管、惰化系统、液压、APU、水/废水、飞行记录器
import { merge, box, rod, tube, lathe, tf, sphere, DEG } from '../core/geo.js';
import { M } from '../core/materials.js';
import { F, wingMid } from './shape.js';
import { mk, grp } from './registry.js';
import { SECTIONS, sectionOf } from './fuselage.js';
import { ENG } from './engine.js';
import { BOX } from './structure.js';
import { addFlexMorph } from './wing.js';

/** 伸入机翼的管线：加上与机翼相同的上挠变形，飞行状态下才不会"掉出"机翼 */
function flexLine(mesh) { addFlexMorph(mesh.geometry); mesh.morphTargetInfluences = [0]; mesh.userData.flexMorph = true; return mesh; }

const FY = F.floorY, CY = F.cargoFloorY;

export function buildSystems(reg, fus) {
  const secG = fus.secGroups;
  const SY = { layer: 'sys', mc: 'other' };
  const addAt = (x, id, mesh) => { secG[sectionOf(x).id].add(mesh); reg.reg(id, mesh); return mesh; };
  // 跨越多个机身段的管线：爆炸图中隐藏
  const lines = grp('sysLines'); lines.userData.noExplode = true; fus.root.add(lines);
  const addLine = (id, mesh) => { lines.add(mesh); reg.reg(id, mesh); return mesh; };
  // 位于翼身整流罩 / 中央翼盒下方的设备
  const belly = grp('sysBelly'); fus.root.add(belly);
  const addBelly = (id, mesh) => { belly.add(mesh); reg.reg(id, mesh); return mesh; };

  // ---------------------------------------------------------------- 气象雷达（雷达罩内）
  {
    const yc = 3.64;
    const plate = merge([rod([1.0, yc, 0], [0.965, yc, 0], 0.37, 0.37, 40), rod([1.0, yc, 0], [1.08, yc, 0], 0.12, 0.09, 16)]);
    tf(plate, [0, 0, 0], [0, 0, 0]);
    const g = grp('radar',
      mk(plate, M.radarDish, { ...SY, name: 'radarPlate' }),
      mk(merge([rod([1.08, yc, 0], [1.62, yc, 0], 0.05, 0.06, 12), box(0.16, 0.3, 0.3, [1.2, yc, 0])]), M.steelDark, { ...SY, mc: 'alu' }));
    addAt(1.0, 'radar', g);
  }

  // ---------------------------------------------------------------- 前电子设备舱 + 主电池 + 前飞行记录器
  {
    const racks = [];
    for (const x of [7.0, 7.78]) for (const z of [-0.95, 0.95]) {
      racks.push(box(0.5, 1.35, 0.85, [x, CY + 0.72, z]));
      for (let k = 1; k < 5; k++) racks.push(box(0.52, 0.02, 0.87, [x, CY + 0.05 + k * 0.27, z]));
    }
    addAt(7.4, 'fwdEEBay', mk(merge(racks), M.sysAvionics, { ...SY, name: 'fwdEEBay' }));
    addAt(7.4, 'mainBattery', mk(merge([box(0.45, 0.36, 0.5, [7.4, CY + 0.2, 0]), box(0.1, 0.05, 0.1, [7.4, CY + 0.4, 0.12]), box(0.1, 0.05, 0.1, [7.4, CY + 0.4, -0.12])]), M.battery, { ...SY, mc: 'steel', name: 'mainBattery' }));
    addAt(6.9, 'eafr', mk(box(0.32, 0.17, 0.2, [6.9, FY - 0.45, 0.45]), M.recorder, { ...SY, name: 'eafrFwd' }));
  }
  // ---------------------------------------------------------------- 后电子设备舱 + APU 电池 + 后飞行记录器
  {
    const racks = [];
    for (const x of [33.75, 34.5]) for (const z of [-0.95, 0.95]) {
      racks.push(box(0.5, 1.35, 0.85, [x, CY + 0.72, z]));
      for (let k = 1; k < 5; k++) racks.push(box(0.52, 0.02, 0.87, [x, CY + 0.05 + k * 0.27, z]));
    }
    addAt(34.1, 'aftEEBay', mk(merge(racks), M.sysElec, { ...SY, name: 'aftEEBay' }));
    addAt(34.1, 'apuBattery', mk(merge([box(0.45, 0.36, 0.5, [34.12, CY + 0.2, 0]), box(0.1, 0.05, 0.1, [34.12, CY + 0.4, 0.12]), box(0.1, 0.05, 0.1, [34.12, CY + 0.4, -0.12])]), M.battery, { ...SY, mc: 'steel', name: 'apuBattery' }));
    addAt(51.5, 'eafr', mk(box(0.32, 0.17, 0.2, [51.5, FY + 2.32, 0]), M.recorder, { ...SY, name: 'eafrAft' }));
  }

  // ---------------------------------------------------------------- 电源馈线：发动机起动发电机 → 后电子舱；APU → 后电子舱
  {
    const geos = [];
    for (const s of [1, -1]) {
      // 走向：风扇机匣底部的附件齿轮箱 → 沿机匣外侧（短舱夹层内，不进外涵道）绕到顶部 → 吊挂内部
      //       → 机翼前梁后方（弦长 19% 处，躲开缝翼/克鲁格襟翼收放留出的前缘开口）→ 机身
      const zs = [ENG.z - 0.5, 7.2, 4.4, 3.1];
      const axY = d => ENG.yAxis - Math.tan(ENG.pitch) * d, dR = 2.55, zR = ENG.z + Math.sin(ENG.toe) * dR;
      const pts = [-90, -60, -30, 0, 30, 60, 82].map(a => [ENG.xInlet + dR, axY(dR) + 1.6 * Math.sin(a * DEG), s * (zR - 1.6 * Math.cos(a * DEG))]);
      pts.push([ENG.xInlet + 3.0, axY(3.0) + 1.6, s * ENG.z], [ENG.xInlet + 3.9, axY(3.9) + 1.52, s * ENG.z], [ENG.xInlet + 4.8, 3.87, s * ENG.z],
        [ENG.xInlet + 5.5, 3.74, s * ENG.z], [ENG.xInlet + 6.2, 3.74, s * ENG.z]);
      { const p = wingMid(ENG.z - 0.12, 0.08, 0.42); pts.push([p[0], p[1], s * (ENG.z - 0.12)]); }
      for (const z of zs) { const p = wingMid(z, 0.19, 0.5); pts.push([p[0], p[1], s * z]); }
      pts.push([24.7, 3.72, s * 2.45], [26.5, 4.3, s * 2.3], [31.5, 4.33, s * 2.1], [33.4, 3.9, s * 1.5], [33.75, 3.6, s * 1.0]);
      geos.push(tube(pts, 0.035, 6));
    }
    geos.push(tube([[58.6, 5.75, 0.35], [56, 5.2, 0.5], [52.3, 4.35, 0.6], [44, 4.32, 0.75], [35.6, 4.3, 0.85], [34.7, 3.8, 0.9]], 0.03, 6));
    addLine('powerFeeder', flexLine(mk(merge(geos), M.sysElecWire, { ...SY, mc: 'alu', shadow: false, name: 'feeders' })));
  }

  // ---------------------------------------------------------------- 环控：空调组件（2 套）+ 座舱空气压缩机（4 台）+ 风管
  {
    const pack = [], cac = [], duct = [];
    for (const s of [1, -1]) {
      pack.push(box(1.0, 0.5, 0.95, [25.4, 2.22, s * 1.17]));                                  // 换热器
      pack.push(rod([27.15, 2.2, s * 1.17], [27.65, 2.2, s * 1.17], 0.17, 0.15, 16));          // 空气循环机
      pack.push(tube([[21.3, 2.12, s * 1.2], [22.9, 2.12, s * 1.2], [24.9, 2.17, s * 1.2]], 0.11, 8));   // 冲压空气进气道
      pack.push(tube([[25.9, 2.1, s * 1.2], [26.9, 1.95, s * 1.5], [27.3, 1.88, s * 1.3]], 0.1, 8));    // 冲压空气排气
      for (const z of [0.82, 1.52]) {
        cac.push(rod([26.15, 2.2, s * z], [26.95, 2.2, s * z], 0.2, 0.2, 18));
        cac.push(rod([26.0, 2.2, s * z], [26.15, 2.2, s * z], 0.1, 0.2, 18));
        cac.push(tube([[20.4, 2.18, s * 1.12], [22.8, 2.2, s * (z * 0.6 + 0.45)], [26.0, 2.2, s * z]], 0.06, 6));
      }
      // 送风立管：组件 → 翼盒前方 → 侧壁 → 客舱顶部
      duct.push(tube([[24.9, 2.4, s * 1.17], [24.05, 2.9, s * 1.6], [23.95, 3.9, s * 2.3], [23.9, FY + 0.4, s * 2.55], [23.9, FY + 1.5, s * 2.28], [23.9, FY + 2.2, s * 1.68], [23.9, FY + 2.32, s * 1.05]], 0.085, 8));
    }
    addBelly('ecsPack', mk(merge(pack), M.sysAir, { ...SY, mc: 'alu', name: 'packs' }));
    addBelly('cac', mk(merge(cac), M.sysElec, { ...SY, mc: 'alu', name: 'cac' }));
    addLine('airDuct', mk(merge(duct), M.sysAir, { ...SY, shadow: false, name: 'risers' }));
    // 客舱顶部配气总管（按机身分段）
    for (const sc of SECTIONS) {
      const a = Math.max(7.8, sc.x0), b = Math.min(51.6, sc.x1);     // 7.8 m 之前机头顶部还在收窄，风管会顶出蒙皮
      if (b - a < 0.3) continue;
      const g = merge([1, -1].map(s => rod([a, FY + 2.32, s * 1.05], [b, FY + 2.32, s * 1.05], 0.085, 0.085, 10, false)));
      const m = mk(g, M.sysAir, { ...SY, shadow: false, name: 'overheadDuct' });
      secG[sc.id].add(m); reg.reg('airDuct', m);
    }
  }

  // ---------------------------------------------------------------- 氮气发生系统（油箱惰化）
  {
    const g = [];
    for (const z of [0.85, 1.13, 1.41]) g.push(rod([28.0, 2.2, z], [29.3, 2.2, z], 0.11, 0.11, 14));
    g.push(box(0.3, 0.25, 0.8, [27.85, 2.2, 1.13]));
    g.push(tube([[29.3, 2.2, 1.13], [29.45, 2.5, 1.6], [29.2, 2.95, 2.2]], 0.03, 6));
    addBelly('ngs', mk(merge(g), M.sysAvionics, { ...SY, mc: 'alu', name: 'ngs' }));
  }

  // ---------------------------------------------------------------- 液压系统（左 / 中 / 右，5000 psi）
  {
    const res = [], ln = [];
    const R = [[34.0, 2.55, 2.5], [34.0, 2.55, -2.5], [34.75, 2.55, -2.45]];
    for (const p of R) {
      res.push(rod([p[0], p[1] - 0.28, p[2]], [p[0], p[1] + 0.28, p[2]], 0.15, 0.15, 16));
      res.push(sphere(0.15, [p[0], p[1] + 0.28, p[2]], 14, 8));
      res.push(rod([p[0] + 0.3, p[1] - 0.2, p[2]], [p[0] + 0.62, p[1] - 0.2, p[2]], 0.09, 0.09, 12));       // 电动泵
    }
    for (const s of [1, -1]) {
      const pts = [[34.0, 2.9, s * 2.5], [33.3, 3.55, s * 3.0]];
      for (const z of [3.5, 6, 9.3, 14, 20, 24.5]) { const p = wingMid(z, 0.635, 0.5); pts.push([p[0], p[1], s * z]); }
      ln.push(tube(pts, 0.022, 5));
      ln.push(tube([[34.3, 2.9, s * 2.3], [40, 3.0, s * 1.6], [50, 4.3, s * 0.5], [55.5, 5.75, s * 0.25], [57.2, 6.0, s * 0.2]], 0.022, 5));
    }
    ln.push(tube([[34.75, 2.9, -2.4], [33.4, 4.33, -1.1], [24, 4.33, -0.95], [9, 4.3, -0.8], [7.0, 3.9, -0.5], [6.45, 3.3, -0.25]], 0.022, 5));
    addBelly('hydraulics', mk(merge(res), M.sysHyd, { ...SY, mc: 'ti', name: 'hydReservoirs' }));
    addLine('hydraulics', flexLine(mk(merge(ln), M.sysHyd, { ...SY, mc: 'ti', shadow: false, name: 'hydLines' })));
  }

  // ---------------------------------------------------------------- APU（尾锥内）
  {
    const yc = 5.93;
    const body = lathe([[58.78, 0.001], [58.78, 0.2], [58.98, 0.3], [59.65, 0.33], [60.1, 0.27], [60.5, 0.2], [61.25, 0.2]], 28);
    tf(body, [0, yc, 0]);
    const acc = merge([
      rod([58.5, yc - 0.05, 0.17], [58.8, yc - 0.05, 0.17], 0.105, 0.105, 14), rod([58.5, yc - 0.05, -0.17], [58.8, yc - 0.05, -0.17], 0.105, 0.105, 14),   // 两台起动发电机
      tube([[59.3, yc + 0.25, -0.12], [59.25, yc + 0.5, -0.4], [59.12, yc + 0.68, -0.68]], 0.13, 10),                                                      // 进气道
      box(0.5, 0.12, 0.3, [59.5, yc - 0.36, 0]),
    ]);
    const g = grp('apu', mk(body, M.apu, { ...SY, mc: 'ti' }), mk(acc, M.steelDark, { ...SY, mc: 'alu' }));
    addAt(59.5, 'apu', g);
  }

  // ---------------------------------------------------------------- 饮用水箱 / 废水箱（散货舱之后）
  {
    const water = merge([1, -1].map(s => rod([50.65, 3.95, s * 1.05], [51.85, 3.95, s * 1.05], 0.24, 0.24, 16)));
    const waste = merge([1, -1].map(s => rod([50.65, 3.75, s * 0.42], [51.85, 3.75, s * 0.42], 0.3, 0.3, 16)));
    const g = grp('waterWaste', mk(water, M.water, { ...SY }), mk(waste, M.waste, { ...SY }));
    addAt(51.2, 'waterWaste', g);
  }

  return { lines, belly, boxRef: BOX };
}
