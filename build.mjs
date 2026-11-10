// 构建脚本：把 src/ 打包成单个自包含 HTML（dist/index.html），可直接双击离线打开
// 用法：node build.mjs [--min] [--watch]
import { build, context } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const minify = process.argv.includes('--min');
const watch = process.argv.includes('--watch');

const inlinePlugin = {
  name: 'inline-html',
  setup(b) {
    b.onEnd(async (res) => {
      if (res.errors.length) return;
      const js = res.outputFiles.find(f => f.path.endsWith('.js')).text;
      const html = await readFile(path.join(root, 'src/index.html'), 'utf8');
      const css = await readFile(path.join(root, 'src/styles.css'), 'utf8');
      const out = html
        .replace('/*__CSS__*/', () => css)
        .replace('/*__JS__*/', () => js.replace(/<\/script/g, '<\\/script'));
      await mkdir(path.join(root, 'dist'), { recursive: true });
      await writeFile(path.join(root, 'dist/index.html'), out);
      console.log(`[build] dist/index.html  ${(out.length / 1024).toFixed(0)} KB  ${new Date().toLocaleTimeString()}`);
    });
  },
};

const opts = {
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true, format: 'esm', target: 'es2022', write: false, outdir: 'out',
  minify, legalComments: 'none', logLevel: 'warning', plugins: [inlinePlugin],
};

if (watch) { const ctx = await context(opts); await ctx.watch(); console.log('[build] watching…'); }
else await build(opts);
