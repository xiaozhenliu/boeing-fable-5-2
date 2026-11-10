// 页面内检查：外观模式下是否有"内部件"（结构/系统/客舱图层）从蒙皮外可见。
// 把内部件临时换成纯品红材质，从多个机位直接渲染并统计品红像素；全为 0 才算干净。
// 有外露时再逐个网格归因（每次只把一个网格染成品红），输出"部件 id/网格名 → 像素数"。
// 用法：scripts/shot.sh "" reload "$(cat scripts/leak.js)"            —— 全部状态与机位，只计数
//      scripts/shot.sh "" "" "window.__lv='clean/nose'; $(cat scripts/leak.js)"  —— 指定 状态/机位 并逐网格归因（页面内执行有 14 s 上限）
(() => {
  const a = window.__app, T = a.THREE, r = a.stage.renderer, cam = a.stage.camera, root = a.aircraft.root, gl = r.getContext();
  a.tourEnd(); a.setMode('ext'); a.select(null);
  const mat = new T.MeshBasicMaterial({ color: 0xff00ff, toneMapped: false, fog: false });
  const inner = [];
  root.traverse(o => { if (o.isMesh && ['sys', 'struct', 'cabin'].includes(o.userData.layer) && o.userData.pid !== 'rat') inner.push([o, o.material]); });
  const paint = on => { for (const [o, m] of inner) o.material = on ? mat : m; };
  const views = {
    left: [-58, 20, 52, -1, 5, 0], right: [-58, 20, -52, -1, 5, 0], rearHi: [50, 22, 45, 0, 5, 0], lowFront: [-40, 1, 25, -5, 4, 5], lowRear: [35, 1, 28, 0, 4, 5],
    top: [0, 90, 0.1, 0, 0, 0], engIn: [-10, 2, 3.5, -6.8, 3.2, 8.8], engOut: [-14, 5, 18, -5, 3.5, 9], engRear: [2, 3, 16, -5, 3, 10], wingRear: [14, 8, 20, 2, 4, 10],
    wingLE: [-12, 6.5, 22, -2, 4, 14], nose: [-45, 4, 6, -28, 4.5, 0], tail: [45, 8, 10, 26, 6, 0], belly: [-6, 0.5, 6, 0, 3, 1], rootTop: [4, 6.5, 9, 1.5, 4.4, 2.6], tipLow: [-2, 1.2, 36, 4, 5, 22],
  };
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
  const count = () => {
    r.setRenderTarget(null); r.render(a.stage.scene, cam);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let n = 0; for (let i = 0; i < buf.length; i += 4) if (buf[i] > 215 && buf[i + 1] < 70 && buf[i + 2] > 215) n++;
    return n;
  };
  const states = { clean: { flaps: 0, speedbrake: 0, reverser: 0, gear: 0 }, landing: { flaps: 30, speedbrake: 1, reverser: 1, gear: 0 }, gearUp: { flaps: 5, speedbrake: 0, reverser: 0, gear: 1 } };
  const out = {}, only = (window.__lv || '').split('/'); window.__lv = '';
  for (const sn in states) {
    if (only[0] && only[0] !== sn) continue;
    Object.assign(a.aircraft.tgt, states[sn]); a.aircraft.snap(); root.updateMatrixWorld(true);
    for (const vn in views) {
      if (only[1] && only[1] !== vn) continue;
      a.setCam(...views[vn]); cam.near = 0.15; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);   // near 固定，避免沿用上个机位的动态值把蒙皮裁掉
      paint(true); const n = count(); paint(false);
      if (!n) continue;
      if (!only[1]) { out[sn + '/' + vn] = n; continue; }
      const by = {};
      for (const [o, m] of inner) {
        o.material = mat; const k = count(); o.material = m;
        if (k) { const id = (o.userData.pid || '?') + '/' + (o.name || o.parent?.name || ''); by[id] = (by[id] || 0) + k; }
      }
      out[sn + '/' + vn] = { n, by };
    }
  }
  Object.assign(a.aircraft.tgt, states.clean); a.aircraft.snap();
  return Object.keys(out).length ? out : 'clean: no interior part visible from outside';
})()
