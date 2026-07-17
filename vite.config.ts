import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

// content script は単一の IIFE として出力（ページに1ファイルで注入）。
// dev 時 (`vite`) は dev/preview.html を普通に配信してカードのプレビューができる。
export default defineConfig({
  // ビルド時に package.json の version を埋め込む（拡張・プレビュー共通で使える）。
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2021',
    rollupOptions: {
      input: resolve(__dirname, 'src/content.ts'),
      output: {
        entryFileNames: 'content.js',
        format: 'iife',
        // 外部依存は無し（uplot はマイルストーン2でバンドル）
      },
    },
  },
});
