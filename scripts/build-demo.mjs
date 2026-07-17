// dev/demo.ts を単一の自己完結HTML(docs/demo.html)にバンドルする。
// モックデータを実際の描画コードに通した「本物のカード」を、GitHub Pages で配信するため。
import { build } from 'vite';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const result = await build({
  root,
  configFile: false,
  logLevel: 'warn',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    write: false,
    target: 'es2021',
    minify: true,
    rollupOptions: {
      input: resolve(root, 'dev/demo.ts'),
      output: { format: 'iife', entryFileNames: 'demo.js', inlineDynamicImports: true },
    },
  },
});

const outputs = Array.isArray(result) ? result[0].output : result.output;
const chunk = outputs.find((o) => o.type === 'chunk');
if (!chunk) throw new Error('build-demo: no JS chunk produced');
const js = chunk.code;

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ZEN Study 学習統計 — ライブデモ</title>
<meta name="description" content="自分のZEN Study学習データを可視化する表示専用Chrome拡張のライブデモ（サンプルデータ）。">
</head>
<body>
<noscript>このデモの表示には JavaScript が必要です。</noscript>
<script>${js}</script>
</body>
</html>
`;

mkdirSync(resolve(root, 'docs'), { recursive: true });
writeFileSync(resolve(root, 'docs/index.html'), html); // GitHub Pages(/docs)のルート＝ライブデモ
console.log(`demo built -> docs/index.html (js ${(js.length / 1024).toFixed(1)} kB, v${pkg.version})`);
