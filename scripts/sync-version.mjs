// manifest.json の version を package.json から同期する。
// 手動での二重管理を防ぎ、package.json を単一のバージョンソースにする。
// 使い方: node scripts/sync-version.mjs （build スクリプトの先頭で呼ばれる）
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const manifestPath = resolve(root, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

if (manifest.version !== pkg.version) {
  manifest.version = pkg.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest.json version synced -> ${pkg.version}`);
} else {
  console.log(`manifest.json already at v${pkg.version}`);
}
