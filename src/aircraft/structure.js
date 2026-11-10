// 机身内部结构：隔框、长桁、地板梁与地板、压力隔框、中央翼盒、龙骨梁、压力甲板
import { gridGeo, merge, box, beam, capGeo, ribbon, linspace, lerp, clamp } from '../core/geo.js';
import { M } from '../core/materials.js';
import { F, fusePoint, fuseSample, fuseSection, fuseThetaAtY, fuseHalfWidthAtY, fuseInner } from './shape.js';
import { mk, grp } from './registry.js';
import { SECTIONS, sectionOf, NLG_WELL, MLG_WELL } from './fuselage.js';
import { DOORS, DOOR_W, DOOR_H, CARGO_DOORS, FRAME_PITCH, FRAME_X0, WIN_Y } from './details.js';

const TAU = Math.PI * 2;
/** 中央翼盒（11 段）包络 */
export const BOX = { x0: 24.24, x1: 29.55, yL: 2.70, yU: 4.03, z: 2.9 };
export const AFT_BULKHEAD_X = 52.6;       // 后压力隔框（47/48 段交界）
export const FWD_BULKHEAD_X = 1.62;       // 前压力隔框（雷达罩之后）
export const DECK_Y = 4.2;                // 主起落架舱上方压力甲板高度
/** 货舱分区（x 范围、地板高度） */
export const HOLDS = {
  fwd: { x0: 8.3, x1: 23.95, y: F.cargoFloorY },
  aft: { x0: 35.0, x1: 47.45, y: F.cargoFloorY },
  bulk: { x0: 47.5, x1: 50.3, y: 3.0 },
};

export const frameStations = () => {
  const xs = [];
  for (let k = 0; ; k++) { const x = FRAME_X0 + k * FRAME_PITCH; if (x > 61.2) break; xs.push(x); }
  return xs;
};
const inBoxZone = (x) => x > BOX.x0 - 0.35 && x < MLG_WELL.x1 + 0.1;
const inNoseWell = (x) => x > NLG_WELL.x0 - 0.1 && x < NLG_WELL.x1 + 0.1;

function frameArc(x) {
  if (inNoseWell(x)) { const s = fuseSection(x); const d = Math.asin(Math.pow(clamp(0.72 / s.w, 0, 1), s.n / 2)); return [-(Math.PI - d), Math.PI - d]; }
  if (inBoxZone(x)) { const t = fuseThetaAtY(x, DECK_Y + 0.02); return [-t, t]; }
  return [-Math.PI, Math.PI];
}
function frameGeo(x, a, b, depth) {
  const n = Math.max(8, Math.round(72 * (b - a) / TAU));
  const o = [], i1 = [], f0 = [], f1 = [];
  for (let k = 0; k <= n; k++) {
    const th = lerp(a, b, k / n);
    o.push(fuseInner(x, th, 0.012));
    const q = fuseInner(x, th, depth); i1.push(q);
    f0.push([q[0] - 0.028, q[1], q[2]]); f1.push([q[0] + 0.028, q[1], q[2]]);
  }
  return merge([gridGeo([o, i1], {}), gridGeo([f0, f1], {})]);
}

/** 该处蒙皮内侧是否不能布置长桁（开口处） */
function blocked(x, th) {
  const p = fusePoint(x, th), y = p[1], z = p[2];
  if (inNoseWell(x) && Math.abs(z) < 0.72 && y < F.YC) return true;
  if (inBoxZone(x) && y < DECK_Y) return true;
  if (Math.abs(y - WIN_Y) < 0.3 && x > 7.3 && x < 52.3) return true;
  for (const d of DOORS) if (Math.abs(x - d) < DOOR_W / 2 + 0.07 && y > F.floorY - 0.1 && y < F.floorY + DOOR_H + 0.08) return true;
  for (const c of CARGO_DOORS) if (Math.abs(x - c.x) < c.w / 2 + 0.07 && y > c.y0 - 0.07 && y < c.y1 + 0.07 && Math.sign(z) === c.side) return true;
  // 驾驶舱风挡区域
  if (x > 2.5 && x < 5.4 && y > 5.25 && y < 6.35) return true;
  return false;
}

/** 按机身分段切分 [x0,x1]，回调 (secId, a, b) */
function bySection(x0, x1, fn) {
  for (const s of SECTIONS) { const a = Math.max(x0, s.x0), b = Math.min(x1, s.x1); if (b - a > 1e-3) fn(s.id, a, b); }
}

export function buildStructure(reg, fus) {
  const secG = fus.secGroups;
  const add = (secId, id, mesh, o) => { secG[secId].add(mesh); reg.reg(id, mesh, o); return mesh; };
  const ST = { layer: 'struct' };

  // ---------------------------------------------------------------- 隔框
  {
    const bySec = {};
    for (const x of frameStations()) {
      if (x < 1.9) continue;
      const [a, b] = frameArc(x);
      const sw = fuseSection(x).w;
      const depth = clamp(sw * 0.045, 0.045, 0.125);
      (bySec[sectionOf(x).id] ||= []).push(frameGeo(x, a, b, depth));
    }
    for (const id in bySec) add(id, 'frame', mk(merge(bySec[id]), M.frame, { ...ST, mc: 'cfrp', name: 'frames' }));
  }

  // ---------------------------------------------------------------- 长桁
  {
    const NS = 56, bySec = {};
    for (const s of SECTIONS) {
      if (s.id === 'radome' || s.id === 'tailcone') continue;
      const x0 = Math.max(s.x0, 1.75), x1 = Math.min(s.x1, 58.1);
      const xs = linspace(x0, x1, Math.max(2, Math.round((x1 - x0) / 0.305) + 1));
      for (let i = 0; i < NS; i++) {
        const th = (i + 0.5) * TAU / NS;
        let run = [];
        const flush = () => { if (run.length > 1) (bySec[s.id] ||= []).push(ribbon(run, 0.055, -0.03)); run = []; };
        for (const x of xs) { if (blocked(x, th)) flush(); else run.push(fuseSample(x, th)); }
        flush();
      }
    }
    for (const id in bySec) add(id, 'stringer', mk(merge(bySec[id]), M.stringer, { ...ST, mc: 'cfrp', shadow: false, name: 'stringers' }));
  }

  // ---------------------------------------------------------------- 客舱地板梁、立柱、地板
  {
    const fx0 = 2.35, fx1 = AFT_BULKHEAD_X - 0.08;
    const beams = {}, posts = {};
    for (const x of frameStations()) {
      if (x < fx0 || x > fx1) continue;
      const id = sectionOf(x).id;
      const hw = fuseHalfWidthAtY(x, F.floorY - 0.1) - 0.1;
      if (hw < 0.3) continue;
      (beams[id] ||= []).push(box(0.045, 0.16, 2 * hw, [x, F.floorY - 0.11, 0]));
      (beams[id]).push(box(0.09, 0.012, 2 * hw, [x, F.floorY - 0.03, 0]));
      const s = fuseSection(x);
      const inHold = (x > HOLDS.fwd.x0 - 1.6 && x < HOLDS.fwd.x1) || (x > MLG_WELL.x1 + 0.2 && x < HOLDS.aft.x1);
      if (inHold && s.w > 2.35) for (const sd of [1, -1]) {
        const zz = 2.14, th = Math.PI - Math.asin(Math.pow(zz / s.w, s.n / 2));
        const q = fuseInner(x, th, 0.1);
        (posts[id] ||= []).push(beam([x, F.floorY - 0.19, sd * zz], [x, q[1], sd * zz], 0.045, 0.035, [1, 0, 0]));
      }
    }
    for (const id in beams) add(id, 'floorBeam', mk(merge(beams[id]), M.floorBeam, { ...ST, mc: 'cfrp', name: 'floorBeams' }));
    for (const id in posts) add(id, 'floorBeam', mk(merge(posts[id]), M.floorBeam, { ...ST, mc: 'alu', name: 'stanchions' }));
    // 地板面板 + 座椅滑轨
    bySection(fx0, fx1, (id, a, b) => {
      const xs = linspace(a, b, Math.max(2, Math.ceil((b - a) / 0.4) + 1));
      const hw = (x) => Math.max(0.05, fuseHalfWidthAtY(x, F.floorY) - 0.05);
      const panel = gridGeo(xs.map(x => [[x, F.floorY - 0.02, -hw(x)], [x, F.floorY - 0.02, hw(x)]]), { up: [0, 1, 0] });
      add(id, 'cabinFloor', mk(panel, M.floorPanel, { ...ST, mc: 'sandwich', name: 'floor' }));
      const tracks = [];
      for (const z of [-2.45, -1.45, -0.72, 0.72, 1.45, 2.45]) {
        const xa = xs.filter(x => hw(x) > Math.abs(z) + 0.1);
        if (xa.length > 1) tracks.push(box(xa[xa.length - 1] - xa[0], 0.012, 0.04, [(xa[0] + xa[xa.length - 1]) / 2, F.floorY - 0.012, z]));
      }
      if (tracks.length) { const t = mk(merge(tracks), M.titanium, { ...ST, mc: 'ti', shadow: false, noPick: true }); secG[id].add(t); }
    });
  }

  // ---------------------------------------------------------------- 货舱地板
  for (const k in HOLDS) {
    const h = HOLDS[k];
    bySection(h.x0, h.x1, (id, a, b) => {
      const xs = linspace(a, b, Math.max(2, Math.ceil((b - a) / 0.5) + 1));
      const hw = (x) => Math.max(0.05, fuseHalfWidthAtY(x, h.y) - 0.04);
      const geo = gridGeo(xs.map(x => [[x, h.y - 0.01, -hw(x)], [x, h.y - 0.01, hw(x)]]), { up: [0, 1, 0] });
      add(id, 'cargoFloor', mk(geo, M.floorPanel, { ...ST, mc: 'sandwich', name: 'cargoFloor-' + k }));
    });
  }

  // ---------------------------------------------------------------- 压力隔框
  {
    // 前压力隔框（平板 + 加强筋）
    const x = FWD_BULKHEAD_X, s = fuseSection(x);
    const loop = linspace(0, TAU, 49).slice(0, 48).map(th => fuseInner(x, th, 0.02));
    const geos = [capGeo(loop, [-1, 0, 0])];
    for (const z of [-0.95, -0.32, 0.32, 0.95]) {
      const k = Math.pow(1 - Math.pow(Math.abs(z) / s.w, s.n), 1 / s.n);
      const yt = s.yC + (s.yT - s.yC) * k - 0.05, yb = s.yC - (s.yC - s.yB) * k + 0.05;
      geos.push(box(0.07, yt - yb, 0.03, [x + 0.04, (yt + yb) / 2, z]));
    }
    for (const y of [s.yC - 0.55, s.yC + 0.1, s.yC + 0.7]) { const hw = fuseHalfWidthAtY(x, y) - 0.05; geos.push(box(0.07, 0.03, 2 * hw, [x + 0.04, y, 0])); }
    add('sec41', 'fwdBulkhead', mk(merge(geos), M.bulkhead, { ...ST, mc: 'alu', name: 'fwdBulkhead' }));
  }
  {
    // 后压力隔框：一体成型的复合材料球面隔框，向后鼓出
    const x = AFT_BULKHEAD_X, s = fuseSection(x), c = [x, (s.yT + s.yB) / 2, 0];
    const ring = linspace(0, TAU, 57).slice(0, 56).map(th => fuseInner(x, th, 0.03));
    const P = linspace(0.02, 1, 12).map(r => ring.map(q => [x + 0.95 * (1 - r * r), c[1] + (q[1] - c[1]) * r, q[2] * r]));
    const geo = gridGeo(P, { closeV: true, inside: [x - 3, c[1], 0] });
    add('sec47', 'aftBulkhead', mk(geo, M.bulkhead, { ...ST, mc: 'cfrp', name: 'aftBulkhead' }));
  }
  {
    // APU 防火墙
    const x = 58.25;
    const loop = linspace(0, TAU, 41).slice(0, 40).map(th => fuseInner(x, th, 0.02));
    add('tailcone', 'apuFirewall', mk(capGeo(loop, [-1, 0, 0]), M.firewall, { ...ST, mc: 'ti', name: 'apuFirewall' }));
  }

  // ---------------------------------------------------------------- 中央翼盒 / 龙骨梁 / 压力甲板（独立成组，便于爆炸图单独移出）
  const sec11 = grp('sec11');
  fus.root.add(sec11);
  {
    const B = BOX, cx = (B.x0 + B.x1) / 2, cy = (B.yL + B.yU) / 2, h = B.yU - B.yL, len = B.x1 - B.x0;
    const geos = [];
    geos.push(box(len, 0.035, 2 * B.z, [cx, B.yL, 0]));                               // 下壁板
    for (const x of [25.35, 26.4, 27.45, 28.5]) geos.push(box(0.03, h - 0.04, 2 * B.z, [x, cy, 0]));   // 展向梁
    for (const z of [-B.z, B.z]) geos.push(box(len, h, 0.04, [cx, cy, z]));          // 机身侧肋（翼身对接处）
    for (const x of linspace(B.x0 + 0.35, B.x1 - 0.35, 9)) geos.push(box(0.07, 0.05, 2 * B.z, [x, B.yU - 0.025, 0]));  // 上壁板加筋条（上壁板省略以便观察内部）
    const m = mk(merge(geos), M.wingBoxC, { ...ST, mc: 'cfrp', name: 'centerWingBox' });
    sec11.add(m); reg.reg('centerWingBox', m);
    // 中央油箱（翼盒内部）
    const tank = mk(box(len - 0.12, h - 0.14, 2 * B.z - 0.12, [cx, cy, 0]), M.fuelCenter, { layer: 'sys', mc: 'other', shadow: false, name: 'centerTank' });
    tank.renderOrder = 3;
    sec11.add(tank); reg.reg('fuelCenter', tank);
    // 龙骨梁
    const kb = mk(merge([box(10.3, 0.4, 0.5, [29.0, B.yL - 0.24, 0]), box(10.3, 0.03, 0.62, [29.0, B.yL - 0.045, 0]), box(10.3, 0.03, 0.62, [29.0, B.yL - 0.44, 0])]), M.keel, { ...ST, mc: 'other', name: 'keelBeam' });
    sec11.add(kb); reg.reg('keelBeam', kb);
    // 压力甲板：主起落架舱顶板 + 前后压力隔墙
    const pg = [];
    const xs = linspace(B.x1, MLG_WELL.x1 + 0.04, 6);
    pg.push(gridGeo(xs.map(x => { const hw = fuseHalfWidthAtY(x, DECK_Y) - 0.03; return [[x, DECK_Y, -hw], [x, DECK_Y, hw]]; }), { up: [0, 1, 0] }));
    for (const x of [MLG_WELL.x1 + 0.04, B.x0 - 0.3]) {
      const t = fuseThetaAtY(x, x > 30 ? DECK_Y : F.floorY - 0.2);
      const loop = linspace(t, TAU - t, 40).map(th => fuseInner(x, th, 0.02));
      pg.push(capGeo(loop, [x > 30 ? 1 : -1, 0, 0]));
    }
    const pd = mk(merge(pg), M.bulkhead, { ...ST, mc: 'cfrp', name: 'pressureDeck' });
    sec11.add(pd); reg.reg('pressureDeck', pd);
  }

  return { sec11 };
}
