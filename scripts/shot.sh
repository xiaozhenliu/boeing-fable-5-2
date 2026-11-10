#!/bin/bash
# 开发用截图脚本：scripts/shot.sh <name> "<px,py,pz,tx,ty,tz>" [reload] ["<额外在页面内执行的 JS>"]
# 多个机位：name 与机位可用 ; 分隔成对，如 "a:1,2,3,0,0,0;b:4,5,6,0,0,0"
SHOTS="$1"; RELOAD="${2:-}"; EXTRA="${3:-}"
mkdir -p /tmp/b787
if [ -n "$EXTRA" ]; then EXTRA_JSON=$(printf '%s' "$EXTRA" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'); else EXTRA_JSON=null; fi
ego-browser nodejs <<EOF
const task = await taskSpace("b787-dev");
const page = task.page("p1");
const url = "http://localhost:8787/index.html";
const [vw, vh] = "${VIEW:-1600x900}".split("x").map(Number);
await page.cdp("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
if ("$RELOAD" === "reload" || !(await page.url()).startsWith(url)) {
  await page.goto(url + "?t=" + Date.now());
}
await page.waitForFunction(() => !!(window.__app || (window.__errors && window.__errors.length)), undefined, { timeout: 60000 });
const errs = await page.evaluate(() => window.__errors);
if (errs && errs.length) console.log("ERRORS:", JSON.stringify(errs.slice(0, 8), null, 1));
const extra = $EXTRA_JSON;
if (extra) { const r = await page.evaluate(extra); if (r !== undefined && r !== null) console.log("extra ->", JSON.stringify(r)); }
for (const item of "$SHOTS".split(";")) {
  if (!item) continue;
  const [name, cam] = item.split(":");
  if (cam) await page.evaluate((c) => { const a = c.split(",").map(Number); window.__app.setCam(...a); }, cam);
  await page.waitForTimeout(350);
  const p = await page.screenshot({ path: "/tmp/b787/" + name + ".png" });
  console.log("shot", p);
}
const errs2 = await page.evaluate(() => window.__errors);
if (errs2 && errs2.length > (errs ? errs.length : 0)) console.log("ERRORS2:", JSON.stringify(errs2.slice(-5), null, 1));
EOF
