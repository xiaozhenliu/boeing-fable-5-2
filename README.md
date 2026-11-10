# 波音 787-9 结构科普 · 交互式三维模型（Fable 5.2 版）

可交互的波音 787-9 结构科普 3D 模型：外观、透视、剖视、爆炸图与材料模式，附 16 步导览和飞行操纵面板。整机几何全部由代码按公开的机场规划手册尺寸程序化生成（three.js）。

**在线体验：** https://xiaozhenliu.github.io/boeing-fable-5-2/

## 本地开发

```bash
npm install
node build.mjs --watch     # 监听 src/ 变化，持续输出 dist/index.html
python3 -m http.server 8787 --directory dist
```

`node build.mjs --min` 生成压缩后的单文件 `dist/index.html`，可直接双击离线打开。

## 发布

推送到 `main` 后，GitHub Actions（`.github/workflows/pages.yml`）自动执行 `node build.mjs --min` 并发布到 GitHub Pages，约 1～2 分钟后线上更新。
