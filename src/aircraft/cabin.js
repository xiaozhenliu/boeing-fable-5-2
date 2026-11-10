// 客舱与货舱：座椅（两舱 290 座）、厨房、盥洗室、行李架、机组休息室、驾驶舱、LD3 集装箱
import * as THREE from 'three';
import { gridGeo, merge, box, rod, torus, loft, linspace } from '../core/geo.js';
import { M } from '../core/materials.js';
import { F, fuseHalfWidthAtY } from './shape.js';
import { mk, grp } from './registry.js';
import { SECTIONS, sectionOf } from './fuselage.js';
import { HOLDS } from './structure.js';

const FY = F.floorY;
/** 客舱布局（典型两舱 290 座：公务舱 28 + 经济舱 262） */
export const LAYOUT = {
  biz: { x0: 8.75, pitch: 1.25, rows: 7, z: [-2.25, -0.55, 0.55, 2.25] },                 // 1-2-1
  eco1: { x0: 20.35, pitch: 0.8128, rows: 16 },                                            // 3-3-3
  eco2: { x0: 37.25, pitch: 0.8128, rows: 14, narrowFrom: 10 },                            // 后 4 排 2-3-2
  eco9: [-2.45, -1.95, -1.45, -0.5, 0, 0.5, 1.45, 1.95, 2.45],
  eco7: [-2.2, -1.7, -0.5, 0, 0.5, 1.7, 2.2],
};

function ecoSeatGeo() {
  return merge([
    box(0.45, 0.1, 0.43, [0, 0.43, 0]),
    box(0.07, 0.66, 0.43, [0.27, 0.8, 0], [0, 0, -0.17]),
    box(0.08, 0.2, 0.3, [0.335, 1.16, 0], [0, 0, -0.17]),
    box(0.36, 0.035, 0.045, [0.05, 0.62, 0.232]), box(0.36, 0.035, 0.045, [0.05, 0.62, -0.232]),
    box(0.04, 0.36, 0.38, [0.12, 0.2, 0]),
  ]);
}
function bizSeatGeo() {
  return merge([
    box(0.52, 0.14, 0.56, [0.12, 0.42, 0]),
    box(0.1, 0.7, 0.56, [0.47, 0.82, 0], [0, 0, -0.2]),
    box(0.09, 0.22, 0.36, [0.55, 1.2, 0], [0, 0, -0.2]),
    box(0.3, 0.36, 0.5, [-0.4, 0.2, 0]),
  ]);
}
function bizShellGeo() {
  return merge([
    box(0.05, 1.22, 0.76, [0.585, 0.61, 0]),
    box(1.17, 0.74, 0.04, [0, 0.37, 0.38]), box(1.17, 0.74, 0.04, [0, 0.37, -0.38]),
    box(0.3, 0.5, 0.72, [-0.43, 0.25, 0]),
  ]);
}
/** 一对 LD3 集装箱（左右并排，下外角削斜） */
function uldPairGeo() {
  const D = 1.534, H = 1.626;
  const prof = (s) => [[s * 0.02, 0], [s * 1.554, 0], [s * 2.027, 0.52], [s * 2.027, H], [s * 0.02, H]];
  const geos = [];
  for (const s of [1, -1]) {
    const g = loft([-D / 2, D / 2].map(x => prof(s).map(([z, y]) => [x, y, z])), { caps: 'both' }).toNonIndexed();
    g.computeVertexNormals();
    geos.push(g);
  }
  return merge(geos);
}

/** 按机身分段生成 InstancedMesh */
function instBySection(fus, reg, id, geo, mat, items, o = {}) {
  const by = {};
  for (const it of items) (by[sectionOf(it.x).id] ||= []).push(it);
  const m4 = new THREE.Matrix4();
  for (const sid in by) {
    const arr = by[sid];
    const im = new THREE.InstancedMesh(geo, mat, arr.length);
    arr.forEach((it, i) => { m4.makeTranslation(it.x, it.y, it.z); im.setMatrixAt(i, m4); });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = true;
    im.userData.layer = o.layer || 'cabin'; im.userData.mc = o.mc || 'other';
    im.name = id + '-' + sid;
    im.computeBoundingSphere(); im.computeBoundingBox();
    fus.secGroups[sid].add(im); reg.reg(id, im);
  }
}

export function buildCabin(reg, fus) {
  const secG = fus.secGroups;
  const CB = { layer: 'cabin', mc: 'other' };
  const addAt = (x, id, mesh) => { secG[sectionOf(x).id].add(mesh); reg.reg(id, mesh); return mesh; };
  const counts = { biz: 0, eco: 0 };

  // ---------------------------------------------------------------- 座椅
  {
    const L = LAYOUT, biz = [], eco = [];
    for (let r = 0; r < L.biz.rows; r++) for (const z of L.biz.z) biz.push({ x: L.biz.x0 + r * L.biz.pitch, y: FY, z });
    for (let r = 0; r < L.eco1.rows; r++) for (const z of L.eco9) eco.push({ x: L.eco1.x0 + r * L.eco1.pitch, y: FY, z });
    for (let r = 0; r < L.eco2.rows; r++) for (const z of (r >= L.eco2.narrowFrom ? L.eco7 : L.eco9)) eco.push({ x: L.eco2.x0 + r * L.eco2.pitch, y: FY, z });
    counts.biz = biz.length; counts.eco = eco.length;
    instBySection(fus, reg, 'seatBiz', bizShellGeo(), M.seatShell, biz);
    instBySection(fus, reg, 'seatBiz', bizSeatGeo(), M.seatBiz, biz);
    instBySection(fus, reg, 'seatEco', ecoSeatGeo(), M.seatEco, eco);
  }

  // ---------------------------------------------------------------- 厨房 / 盥洗室
  {
    const mon = (id, x0, x1, z0, z1, h, mat) => {
      const xm = (x0 + x1) / 2;
      const lim = fuseHalfWidthAtY(xm, FY + h) - 0.2;
      const a = Math.max(-lim, Math.min(z0, z1)), b = Math.min(lim, Math.max(z0, z1));
      const geos = [box(x1 - x0, h, b - a, [xm, FY + h / 2, (a + b) / 2])];
      addAt(xm, id, mk(merge(geos), mat, { ...CB, name: id }));
    };
    const G = M.galley, Lv = M.lav;
    mon('galley', 6.98, 7.82, -0.85, 0.85, 2.0, G);
    for (const s of [1, -1]) mon('lavatory', 6.98, 7.9, s * 1.45, s * 2.6, 1.95, Lv);
    for (const s of [1, -1]) mon('lavatory', 17.0, 17.76, s * 0.04, s * 0.95, 2.0, Lv);
    mon('galley', 19.0, 19.75, -1.0, 1.0, 2.0, G);
    for (const s of [1, -1]) mon('lavatory', 33.72, 34.78, s * 0.04, s * 0.95, 2.0, Lv);
    for (const s of [1, -1]) mon('lavatory', 36.1, 36.85, s * 1.45, s * 2.6, 1.95, Lv);
    for (const s of [1, -1]) mon('lavatory', 48.3, 49.05, s * 1.35, s * 2.35, 1.9, Lv);
    mon('galley', 50.35, 52.1, -1.1, 1.1, 2.0, G);
    for (const s of [1, -1]) mon('galley', 50.9, 52.1, s * 1.35, s * 2.1, 1.8, G);
  }

  // ---------------------------------------------------------------- 顶部行李架
  {
    const zones = [[7.95, 17.0, false], [19.9, 33.6, true], [36.9, 48.25, true]];
    for (const [x0, x1, center] of zones) for (const s of SECTIONS) {
      const a = Math.max(x0, s.x0), b = Math.min(x1, s.x1);
      if (b - a < 0.2) continue;
      const xs = linspace(a, b, Math.max(2, Math.ceil((b - a) / 0.6) + 1));
      const geos = [];
      for (const sd of [1, -1]) {
        const P = xs.map(x => {
          const h1 = fuseHalfWidthAtY(x, FY + 1.66) - 0.14, h2 = fuseHalfWidthAtY(x, FY + 2.15) - 0.14;
          return [[x, FY + 1.66, sd * h1], [x, FY + 1.72, sd * (h1 - 0.62)], [x, FY + 2.02, sd * (h1 - 0.66)], [x, FY + 2.15, sd * Math.min(h2, h1 - 0.2)]];
        });
        geos.push(gridGeo(P, { inside: [(a + b) / 2, FY + 2.4, sd * 2.6] }));
      }
      if (center) geos.push(box(b - a, 0.34, 1.0, [(a + b) / 2, FY + 1.97, 0]));
      const m = mk(merge(geos), M.bin, { ...CB, name: 'bins', shadow: false });
      secG[s.id].add(m); reg.reg('overheadBin', m);
    }
  }

  // ---------------------------------------------------------------- 机组休息室（客舱天花板上方）
  {
    const cr = (x0, x1) => {
      for (const s of SECTIONS) {
        const a = Math.max(x0, s.x0), b = Math.min(x1, s.x1);
        if (b - a < 0.2) continue;
        const m = mk(box(b - a, 0.5, 1.6, [(a + b) / 2, FY + 2.46, 0]), M.lav, { ...CB, name: 'crewRest' });
        secG[s.id].add(m); reg.reg('crewRest', m);
      }
    };
    cr(8.6, 10.9); cr(46.2, 49.6);
  }

  // ---------------------------------------------------------------- 驾驶舱
  {
    const dark = [], grey = [], scr = [], seat = [];
    // 主仪表板 + 遮光罩 + 中央操纵台 + 顶板
    dark.push(box(0.06, 0.42, 2.05, [3.42, FY + 0.66, 0], [0, 0, 0.26]));
    {
      // 遮光罩：前缘贴着风挡下沿，平面外形随机头收窄（矩形板会从风挡下方穿出蒙皮）
      const row = dy => linspace(3.1, 3.5, 9).map(x => { const y = FY + 0.845 + 0.05 * (x - 3.1) + dy, h = Math.max(0.03, Math.min(1.1, fuseHalfWidthAtY(x, y + 0.05) - 0.1)); return [[x, y, -h], [x, y, h]]; });
      dark.push(gridGeo(row(0), { up: [0, 1, 0] }), gridGeo(row(-0.03), { up: [0, -1, 0] }));
    }
    dark.push(box(0.1, 0.07, 0.9, [3.44, FY + 0.93, 0]));                                  // 方式控制板 MCP
    dark.push(box(0.95, 0.5, 0.44, [3.92, FY + 0.27, 0]));                                 // 中央操纵台
    dark.push(box(0.6, 0.05, 0.8, [4.95, FY + 1.72, 0], [0, 0, 0.3]));                     // 顶板
    for (const s of [1, -1]) dark.push(box(1.3, 0.5, 0.16, [3.9, FY + 0.3, s * 1.05]));    // 侧操纵台
    for (const s of [1, -1]) grey.push(box(0.03, 0.2, 0.035, [3.9, FY + 0.6, s * 0.05], [0, 0, 0.25]));   // 油门杆
    // 5 块 15 英寸显示器：左右各 2 块 + 中央操纵台前部 1 块
    for (const z of [-0.72, -0.28, 0.28, 0.72]) scr.push(box(0.012, 0.25, 0.38, [3.458, FY + 0.67, z], [0, 0, 0.26]));
    scr.push(box(0.3, 0.012, 0.36, [3.6, FY + 0.535, 0], [0, 0, 0.12]));
    for (const s of [1, -1]) {
      // 驾驶盘
      grey.push(rod([3.72, FY + 0.05, s * 0.53], [3.66, FY + 0.72, s * 0.53], 0.03, 0.03, 8));
      grey.push(torus(0.15, 0.017, [3.66, FY + 0.76, s * 0.53], [0, Math.PI / 2, 0], 16, 6));
      // 驾驶员座椅 + 观察员座椅
      const st = (x, z) => seat.push(bizSeatGeo().scale(0.9, 1, 0.82).translate(x, FY, z));
      st(4.1, s * 0.53); st(5.02, s * 0.36);
    }
    // 驾驶舱后隔墙（含防弹舱门）：外形随机身截面收窄，矩形板的上角会穿出蒙皮
    for (const [x, fwd] of [[5.5, -1], [5.545, 1]]) {
      const P = linspace(FY + 0.005, FY + 2.02, 14).map(y => { const h = Math.max(0.04, fuseHalfWidthAtY(x, y) - 0.15); return [[x, y, -h], [x, y, h]]; });
      dark.push(gridGeo(P, { inside: [x - fwd, FY + 1, 0] }));
    }
    const g = grp('cockpit',
      mk(merge(dark), M.cockpitPanel, { ...CB }), mk(merge(grey), M.steel, { ...CB, mc: 'alu' }),
      mk(merge(scr), M.screen, { ...CB, shadow: false }), mk(merge(seat), M.seatBiz, { ...CB }));
    // 平视显示器 HUD（787 标配双 HUD）
    const hud = [];
    for (const s of [1, -1]) hud.push(box(0.008, 0.16, 0.22, [3.86, FY + 1.2, s * 0.53], [0, 0, 0.35]));
    const hm = mk(merge(hud), M.lens, { ...CB, shadow: false }); hm.renderOrder = 4;
    g.add(hm);
    addAt(3.8, 'cockpit', g);
  }

  // ---------------------------------------------------------------- 货舱 LD3 集装箱：前 20 + 后 16
  {
    const items = [];
    for (let k = 0; k < 10; k++) items.push({ x: HOLDS.fwd.x0 + 0.79 + k * 1.555, y: HOLDS.fwd.y + 0.01, z: 0 });
    for (let k = 0; k < 8; k++) items.push({ x: HOLDS.aft.x0 + 0.78 + k * 1.555, y: HOLDS.aft.y + 0.01, z: 0 });
    instBySection(fus, reg, 'uld', uldPairGeo(), M.uld, items, { mc: 'alu' });
  }

  return { counts };
}
