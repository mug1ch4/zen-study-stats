// src/popup.ts → dist/popup.js（IIFE）。MV3 のポップアップはインラインスクリプト不可のため
// popup.html から参照する独立ファイルとしてビルドする。
import { build } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
      input: resolve(root, 'src/popup.ts'),
      output: { format: 'iife', inlineDynamicImports: true },
    },
  },
});

const outputs = Array.isArray(result) ? result[0].output : result.output;
const chunk = outputs.find((o) => o.type === 'chunk');
if (!chunk) throw new Error('build-popup: no JS chunk produced');
writeFileSync(resolve(root, 'dist/popup.js'), chunk.code);
console.log(`popup built -> dist/popup.js (${(chunk.code.length / 1024).toFixed(1)} kB, v${pkg.version})`);
