// 几何工具层：插值、参数化网格、放样、实体面片等
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (6 * t - 15) + 10); };
export const remap = (x, a, b, c, d) => c + (d - c) * clamp((x - a) / (b - a), 0, 1);
export const spow = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);
export const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * (i / (n - 1)));
// 两端加密（余弦分布）
export const cosspace = (a, b, n) => Array.from({ length: n }, (_, i) => a + (b - a) * 0.5 * (1 - Math.cos(Math.PI * i / (n - 1))));
// 仅起点加密
export const headspace = (a, b, n, p = 2) => Array.from({ length: n }, (_, i) => a + (b - a) * Math.pow(i / (n - 1), p));

/** 单调三次 Hermite 插值 (PCHIP)，pts: [[x,y],...] 按 x 递增 */
export function pchip(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  const m = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
    const i = lo, t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

/** 分段线性插值 */
export function plin(pts) {
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return lerp(pts[i - 1][1], pts[i][1], t);
    }
    return pts[pts.length - 1][1];
  };
}

// ---------- 网格法线 ----------
function wrapIdx(i, n, close, seam) {
  if (close) return ((i % n) + n) % n;
  if (seam) { const m = n - 1; return ((i % m) + m) % m; }
  return clamp(i, 0, n - 1);
}

/** 计算参数网格的法线（中心差分，支持闭合/接缝环绕） */
export function gridNormals(P, o = {}) {
  const nu = P.length, nv = P[0].length;
  const { closeU = false, closeV = false, seamU = false, seamV = false } = o;
  const N = [];
  for (let i = 0; i < nu; i++) {
    const row = [];
    const im = wrapIdx(i - 1, nu, closeU, seamU), ip = wrapIdx(i + 1, nu, closeU, seamU);
    for (let j = 0; j < nv; j++) {
      const jm = wrapIdx(j - 1, nv, closeV, seamV), jp = wrapIdx(j + 1, nv, closeV, seamV);
      const a = P[ip][j], b = P[im][j], c = P[i][jp], d = P[i][jm];
      const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2];
      const vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      const ref = Math.max(Math.hypot(ux, uy, uz), 1e-9) * Math.max(Math.hypot(vx, vy, vz), 1e-9);
      if (l < 1e-7 * ref || l < 1e-14) row.push(null);
      else row.push([nx / l, ny / l, nz / l]);
    }
    N.push(row);
  }
  // 修补退化点（极点等）
  for (let pass = 0; pass < 3; pass++) {
    let any = false;
    for (let i = 0; i < nu; i++) {
      const allBad = N[i].every(n => n === null);
      if (allBad) {
        const src = (i + 1 < nu && N[i + 1].some(n => n)) ? N[i + 1] : (i > 0 && N[i - 1].some(n => n)) ? N[i - 1] : null;
        if (src) {
          let sx = 0, sy = 0, sz = 0;
          for (const n of src) if (n) { sx += n[0]; sy += n[1]; sz += n[2]; }
          const l = Math.hypot(sx, sy, sz);
          if (l > 1e-9) { for (let j = 0; j < nv; j++) N[i][j] = [sx / l, sy / l, sz / l]; }
          else { for (let j = 0; j < nv; j++) N[i][j] = src[j] || [0, 1, 0]; }
        } else any = true;
        continue;
      }
      for (let j = 0; j < nv; j++) if (N[i][j] === null) {
        let sx = 0, sy = 0, sz = 0, c = 0;
        const cand = [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]];
        for (const [a, b] of cand) {
          if (a < 0 || a >= nu) continue;
          const bb = wrapIdx(b, nv, closeV, seamV);
          const n = N[a][bb];
          if (n) { sx += n[0]; sy += n[1]; sz += n[2]; c++; }
        }
        const l = Math.hypot(sx, sy, sz);
        if (c && l > 1e-9) N[i][j] = [sx / l, sy / l, sz / l]; else any = true;
      }
    }
    if (!any) break;
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) if (!N[i][j]) N[i][j] = [0, 1, 0];
  return N;
}

/** 判断法线整体是否朝外（远离 inside 点），返回 +1 / -1 */
function orientSign(P, N, inside) {
  let c = inside;
  if (!c || c === 'auto') {
    let sx = 0, sy = 0, sz = 0, k = 0;
    for (const r of P) for (const p of r) { sx += p[0]; sy += p[1]; sz += p[2]; k++; }
    c = [sx / k, sy / k, sz / k];
  }
  let s = 0;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P[0].length; j++) {
    const p = P[i][j], n = N[i][j];
    s += n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]);
  }
  return s >= 0 ? 1 : -1;
}

/**
 * 由点阵 P[i][j]=[x,y,z] 生成 BufferGeometry
 * o: closeU/closeV 环绕（共享顶点）; seamU/seamV 末行/列与首行/列重合（保留 UV 接缝）
 *    flip 翻转; inside: 'auto' | [x,y,z] 自动让法线背离该点; up: [x,y,z] 让法线与该方向同向
 *    uv(i,j)->[u,v]; skip(i,j)->bool 跳过四边形（开孔）
 */
export function gridGeo(P, o = {}) {
  const nu = P.length, nv = P[0].length;
  const { closeU = false, closeV = false, flip = false, uv = null, skip = null, inside = null, up = null } = o;
  const N = o.normals || gridNormals(P, o);
  let sign = 1, wind = 1;
  if (o.normals) { wind = windFlip(P, N) ? -1 : 1; }
  else {
    if (inside) sign = orientSign(P, N, inside);
    else if (up) {
      let s = 0; for (const r of N) for (const n of r) s += n[0] * up[0] + n[1] * up[1] + n[2] * up[2];
      sign = s >= 0 ? 1 : -1;
    }
    if (flip) sign = -sign;
    wind = sign;
  }
  const pos = new Float32Array(nu * nv * 3), nor = new Float32Array(nu * nv * 3);
  const uvs = new Float32Array(nu * nv * 2);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const k = (i * nv + j) * 3, p = P[i][j], n = N[i][j];
    pos[k] = p[0]; pos[k + 1] = p[1]; pos[k + 2] = p[2];
    nor[k] = n[0] * sign; nor[k + 1] = n[1] * sign; nor[k + 2] = n[2] * sign;
    if (uv) { const t = uv(i, j); uvs[(i * nv + j) * 2] = t[0]; uvs[(i * nv + j) * 2 + 1] = t[1]; }
  }
  const idx = [];
  const iMax = closeU ? nu : nu - 1, jMax = closeV ? nv : nv - 1;
  for (let i = 0; i < iMax; i++) for (let j = 0; j < jMax; j++) {
    if (skip && skip(i, j)) continue;
    const i2 = (i + 1) % nu, j2 = (j + 1) % nv;
    const a = i * nv + j, b = i2 * nv + j, c = i2 * nv + j2, d = i * nv + j2;
    if (wind > 0) idx.push(a, b, c, a, c, d); else idx.push(a, c, b, a, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** 沿法线偏移点阵 */
export function offsetGrid(P, N, d) {
  return P.map((r, i) => r.map((p, j) => [p[0] + N[i][j][0] * d, p[1] + N[i][j][1] * d, p[2] + N[i][j][2] * d]));
}

/** 将开放面片加厚为实体（外表面 + 内表面 + 四周封边） */
export function solidPatch(P, t, o = {}) {
  let N = gridNormals(P, o);
  let s = 1;
  if (o.inside) s = orientSign(P, N, o.inside);
  else if (o.up) { let q = 0; for (const r of N) for (const n of r) q += n[0] * o.up[0] + n[1] * o.up[1] + n[2] * o.up[2]; s = q >= 0 ? 1 : -1; }
  if (o.flip) s = -s;
  if (s < 0) N = N.map(r => r.map(n => [-n[0], -n[1], -n[2]]));
  const Q = offsetGrid(P, N, -t);
  const nu = P.length, nv = P[0].length;
  const Nq = N.map(r => r.map(n => [-n[0], -n[1], -n[2]]));
  const geos = [gridGeo(P, { normals: N, uv: o.uv }), gridGeo(Q, { normals: Nq })];
  let cx = 0, cy = 0, cz = 0, k = 0;
  for (const r of P) for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; k++; }
  for (const r of Q) for (const p of r) { cx += p[0]; cy += p[1]; cz += p[2]; k++; }
  const c = [cx / k, cy / k, cz / k];
  const edge = (A, B) => gridGeo([A, B], { inside: c });
  geos.push(edge(P[0], Q[0]), edge(P[nu - 1], Q[nu - 1]));
  geos.push(edge(P.map(r => r[0]), Q.map(r => r[0])), edge(P.map(r => r[nv - 1]), Q.map(r => r[nv - 1])));
  return merge(geos);
}

// 给定法线时，判断默认缠绕（cross(du,dv)）是否与法线相反
function windFlip(P, N) {
  const G = gridNormals(P);
  let s = 0;
  for (let i = 0; i < P.length; i++) for (let j = 0; j < P[0].length; j++) {
    const a = G[i][j], b = N[i][j]; s += a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  return s < 0;
}

/** 平面环封盖（质心扇形），outDir 为期望法线方向 */
export function capGeo(loop, outDir) {
  const n = loop.length;
  let cx = 0, cy = 0, cz = 0;
  for (const p of loop) { cx += p[0]; cy += p[1]; cz += p[2]; }
  cx /= n; cy /= n; cz /= n;
  // 环法线
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n];
    nx += (a[1] - cy) * (b[2] - cz) - (a[2] - cz) * (b[1] - cy);
    ny += (a[2] - cz) * (b[0] - cx) - (a[0] - cx) * (b[2] - cz);
    nz += (a[0] - cx) * (b[1] - cy) - (a[1] - cy) * (b[0] - cx);
  }
  const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
  let flip = false;
  if (outDir && (nx * outDir[0] + ny * outDir[1] + nz * outDir[2]) < 0) { flip = true; nx = -nx; ny = -ny; nz = -nz; }
  const pos = [cx, cy, cz], nor = [nx, ny, nz], uv = [0, 0], idx = [];
  for (const p of loop) { pos.push(p[0], p[1], p[2]); nor.push(nx, ny, nz); uv.push(0, 0); }
  for (let i = 0; i < n; i++) {
    const a = 1 + i, b = 1 + (i + 1) % n;
    if (flip) idx.push(0, b, a); else idx.push(0, a, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** 闭合截面放样：sections[i] 为同点数的闭合环；caps: 'both' | 'start' | 'end' | null */
export function loft(sections, o = {}) {
  const geos = [gridGeo(sections, { closeV: true, inside: o.inside || 'auto', closeU: !!o.closeU })];
  const n = sections.length;
  const ctr = (L) => { let x = 0, y = 0, z = 0; for (const p of L) { x += p[0]; y += p[1]; z += p[2]; } return [x / L.length, y / L.length, z / L.length]; };
  if (o.caps === 'both' || o.caps === 'start') {
    const a = ctr(sections[0]), b = ctr(sections[1]);
    geos.push(capGeo(sections[0], [a[0] - b[0], a[1] - b[1], a[2] - b[2]]));
  }
  if (o.caps === 'both' || o.caps === 'end') {
    const a = ctr(sections[n - 1]), b = ctr(sections[n - 2]);
    geos.push(capGeo(sections[n - 1], [a[0] - b[0], a[1] - b[1], a[2] - b[2]]));
  }
  return merge(geos);
}

/** 旋转体，轴为 +X；profile: [[x,r],...]；重复点形成硬边；map 可自定义 (x,r,phi)->[x,y,z] */
export function lathe(profile, seg = 48, o = {}) {
  const map = o.map || ((x, r, a) => [x, r * Math.cos(a), r * Math.sin(a)]);
  const a0 = o.a0 ?? 0, a1 = o.a1 ?? Math.PI * 2;
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const P = profile.map(([x, r]) => {
    const row = [];
    const m = full ? seg : seg + 1;
    for (let j = 0; j < m; j++) row.push(map(x, r, a0 + (a1 - a0) * j / seg));
    return row;
  });
  // 朝外：以轴线为内
  const N = gridNormals(P, { closeV: full });
  let s = 0;
  for (let i = 0; i < P.length; i++) {
    const [x, r] = profile[i];
    const c = map(x, 0, 0);
    for (let j = 0; j < P[0].length; j++) { const p = P[i][j], n = N[i][j]; s += n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) + n[2] * (p[2] - c[2]); }
  }
  let flip = s < 0;
  if (o.inward) flip = !flip;
  return gridGeo(P, { closeV: full, normals: flip ? N.map(r => r.map(n => [-n[0], -n[1], -n[2]])) : N });
}

// ---------- 合并 / 变换 ----------
export function merge(geos) {
  const list = [];
  for (let g of geos) {
    if (!g) continue;
    if (!g.index) { const n = g.attributes.position.count; g.setIndex(Array.from({ length: n }, (_, i) => i)); }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    list.push(g);
  }
  if (list.length === 1) return list[0];
  return mergeGeometries(list, false);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
/** 平移/旋转/缩放几何体（rot 为欧拉角 XYZ，弧度） */
export function tf(g, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]) {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  _m.compose(new THREE.Vector3(...pos), _q, new THREE.Vector3(...scl));
  g.applyMatrix4(_m);
  if (scl[0] * scl[1] * scl[2] < 0) flipWinding(g);
  return g;
}
export function flipWinding(g) {
  const ix = g.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
  g.index.needsUpdate = true;
  return g;
}
/** 镜像 z -> -z（返回新几何） */
export function mirrorZ(g) {
  const c = g.clone();
  c.applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1));
  return flipWinding(c);
}

// ---------- 基本体 ----------
export const box = (w, h, d, pos, rot) => tf(new THREE.BoxGeometry(w, h, d), pos, rot);
export const sphere = (r, pos, ws = 20, hs = 14, scl) => tf(new THREE.SphereGeometry(r, ws, hs), pos, [0, 0, 0], scl);
/** 两点之间的圆柱/圆台 */
export function rod(a, b, r1, r2 = r1, seg = 16, capped = true) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A), len = d.length();
  const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1, !capped);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  return g;
}
/** 两点间的矩形截面梁（w 沿 side 方向，h 垂直） */
export function beam(a, b, w, h, upHint = [0, 1, 0]) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = new THREE.Vector3().subVectors(B, A), len = d.length();
  const z = d.clone().normalize();
  let up = new THREE.Vector3(...upHint);
  let x = new THREE.Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-8) { up = new THREE.Vector3(1, 0, 0); x.crossVectors(up, z); }
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(A.clone().add(B).multiplyScalar(0.5));
  const g = new THREE.BoxGeometry(w, h, len);
  g.applyMatrix4(m);
  return g;
}
export function torus(R, r, pos, rot, seg = 32, tub = 12) { return tf(new THREE.TorusGeometry(R, r, tub, seg), pos, rot); }
export function tube(points, r, seg = 8, closed = false, tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'catmullrom', tension);
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 6), r, seg, closed);
}

/** 圆角矩形轮廓点（局部 2D，中心原点），返回 [[u,v],...] 逆时针 */
export function roundRect(w, h, r, segCorner = 6) {
  const pts = [];
  const hw = w / 2, hh = h / 2; r = Math.min(r, hw, hh);
  const corners = [[hw - r, hh - r, 0], [-hw + r, hh - r, 90], [-hw + r, -hh + r, 180], [hw - r, -hh + r, 270]];
  for (const [cx, cy, a0] of corners) {
    for (let k = 0; k <= segCorner; k++) {
      const a = (a0 + 90 * k / segCorner) * DEG;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/**
 * 在任意曲面上生成贴合的带状线条（门缝、分段线等）
 * samples: [{p:[x,y,z], n:[x,y,z]}...]，width 线宽，lift 抬起高度
 */
export function ribbon(samples, width, lift = 0.003, closed = false) {
  const n = samples.length, A = [], B = [];
  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const a = samples[closed ? (i - 1 + n) % n : Math.max(0, i - 1)].p, b = samples[closed ? (i + 1) % n : Math.min(n - 1, i + 1)].p;
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const nn = s.n;
    let sx = nn[1] * tz - nn[2] * ty, sy = nn[2] * tx - nn[0] * tz, sz = nn[0] * ty - nn[1] * tx;
    const l = Math.hypot(sx, sy, sz) || 1; sx /= l; sy /= l; sz /= l;
    const h = width / 2;
    A.push([s.p[0] + sx * h + nn[0] * lift, s.p[1] + sy * h + nn[1] * lift, s.p[2] + sz * h + nn[2] * lift]);
    B.push([s.p[0] - sx * h + nn[0] * lift, s.p[1] - sy * h + nn[1] * lift, s.p[2] - sz * h + nn[2] * lift]);
  }
  if (closed) { A.push(A[0]); B.push(B[0]); }
  const Ns = samples.map(s => s.n); if (closed) Ns.push(Ns[0]);
  const P = A.map((a, i) => [a, B[i]]);
  const N = Ns.map(nn => [nn, nn]);
  return gridGeo(P, { normals: N, flip: windFlip(P, N) });
}

/** 曲面上的填充面片：outline 为曲面采样点环，center 为中心采样；扇形三角化 */
export function fanPatch(center, outline, lift = 0.003) {
  const pos = [], nor = [], uv = [], idx = [];
  const push = (s) => { pos.push(s.p[0] + s.n[0] * lift, s.p[1] + s.n[1] * lift, s.p[2] + s.n[2] * lift); nor.push(s.n[0], s.n[1], s.n[2]); uv.push(0, 0); };
  push(center); outline.forEach(push);
  const n = outline.length;
  // 判断缠绕
  const a = outline[0].p, b = outline[1].p, c = center.p;
  const ux = a[0] - c[0], uy = a[1] - c[1], uz = a[2] - c[2], vx = b[0] - c[0], vy = b[1] - c[1], vz = b[2] - c[2];
  const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
  const fl = (gx * center.n[0] + gy * center.n[1] + gz * center.n[2]) < 0;
  for (let i = 0; i < n; i++) { const p = 1 + i, q = 1 + (i + 1) % n; if (fl) idx.push(0, q, p); else idx.push(0, p, q); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

export { THREE };
