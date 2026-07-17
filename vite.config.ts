import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// content script は単一の IIFE として出力（ページに1ファイルで注入）。
// dev 時 (`vite`) は dev/preview.html を普通に配信してカードのプレビューができる。
export default defineConfig({
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
