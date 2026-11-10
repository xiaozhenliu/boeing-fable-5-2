// 真实指针交互自检：悬停提示 → 点击选中 → 控制台页签 → 尺寸 → 日光主题 → 键盘
// 用法：ego-browser nodejs < scripts/ui-test.mjs
const task = await taskSpace("b787-dev");
const page = task.page("p1");
const [vw, vh] = (process.env.VIEW || "1600x900").split("x").map(Number);
await page.cdp("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
await page.goto("http://localhost:8787/index.html?t=" + Date.now());
await page.waitForFunction(() => !!window.__app, undefined, { timeout: 60000 });
const shot = async (n) => { await page.waitForTimeout(250); await page.screenshot({ path: "/tmp/b787/" + n + ".png" }); };
const state = () => page.evaluate(() => { const a = window.__app; return { mode: a.S.mode, sel: a.S.selected, hov: a.S.hovered, tip: document.querySelector('#tip').hidden ? null : document.querySelector('#tip').textContent, errs: window.__errors, tgt: a.aircraft.tgt, lights: a.aircraft.lights }; });
const log = (k, v) => console.log(k, JSON.stringify(v));

if (vw >= 1180) {
  // 1) 悬停发动机
  await page.mouse.move(790, 530, { label: "hover the engine" });
  await page.waitForTimeout(500);
  log("hover", await state()); await shot("i1");
  // 2) 点击选中
  await page.mouse.click(790, 530, { label: "select the engine part" });
  await page.waitForTimeout(400);
  log("click", await state()); await shot("i2");
  // 3) 点空白取消
  await page.mouse.click(700, 250, { label: "click empty space" });
  log("deselect", await state());
  // 4) 控制台：动画页签
  await page.click("#console [data-tab=anim]");
  await page.click("#console [data-tg=flight]");
  await page.click("#console [data-tg=strobe]");
  await page.waitForTimeout(3000);
  log("flight", await state()); await shot("i3");
  await page.click("#console [data-tg=flight]");
  // 5) 显示页签 + 尺寸 + 日光
  await page.click("#console [data-tab=view]");
  await page.click("#btn-dims");
  await page.click("#btn-theme");
  await page.waitForTimeout(7000);
  log("dims", await state()); await shot("i4");
  // 6) 键盘：襟翼两档、起落架
  await page.click("#btn-dims");
  await page.keyboard.press("f"); await page.keyboard.press("f"); await page.keyboard.press("2");
  await page.waitForTimeout(600);
  log("keys", await state());
  // 7) 搜索
  await page.fill("#q", "APU");
  await page.waitForTimeout(200);
  log("search", await page.evaluate(() => [...document.querySelectorAll('#tree .item span')].map(e => e.textContent)));
  await page.click("#tree .item[data-id=apu]");
  await page.waitForTimeout(1800);
  log("tree", await state()); await shot("i5");
  await page.click("#btn-help");
  await shot("i6");
} else {
  await shot("n1");
  await page.mouse.click(Math.round(vw * 0.5), Math.round(vh * 0.52), { label: "select a part" });
  await page.waitForTimeout(500);
  log("click", await state()); await shot("n2");
  await page.evaluate(() => window.__app.tourGo(7));
  await page.waitForTimeout(2800);
  await shot("n3");
}
