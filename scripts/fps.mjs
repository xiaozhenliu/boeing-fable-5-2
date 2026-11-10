// 各显示模式帧率测量。用法：ego-browser nodejs < scripts/fps.mjs
const task = await taskSpace("b787-dev");
const page = task.page("p1");
const [vw, vh] = (process.env.VIEW || "1600x900").split("x").map(Number);
await page.cdp("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
await page.goto("http://localhost:8787/index.html?t=" + Date.now());
await page.waitForFunction(() => !!window.__app, undefined, { timeout: 60000 });
const fps = (ms = 2500) => page.evaluate((ms) => new Promise(res => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(+(n * 1000 / (performance.now() - t0)).toFixed(1)); };
  requestAnimationFrame(f);
}), ms);
const run = async (name, js) => { await page.evaluate(js); await page.waitForTimeout(1800); console.log(name, await fps()); };
console.log("info", JSON.stringify(await page.evaluate(() => { const a = window.__app, r = a.stage.renderer; const gl = r.getContext(); const e = gl.getExtension('WEBGL_debug_renderer_info'); return { gpu: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '?', dpr: r.getPixelRatio(), calls: r.info.render.calls, tris: r.info.render.triangles, vis: document.visibilityState }; })));
await run("ext", "window.__app.setMode('ext')");
await run("ext+sel", "window.__app.select('engInlet')");
await run("xray", "window.__app.select(null); window.__app.setMode('xray')");
await run("xray+sel", "window.__app.select('apu')");
await run("cut", "window.__app.select(null); window.__app.setMode('cut')");
await run("explode", "window.__app.setMode('explode')");
await run("material", "window.__app.setMode('material')");
console.log("info2", JSON.stringify(await page.evaluate(() => { const r = window.__app.stage.renderer; return { calls: r.info.render.calls, tris: r.info.render.triangles }; })));
