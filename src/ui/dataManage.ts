// 蓄積データのバックアップ／復元（JSON/CSV）。
// 【第一原則】ZEN Study へは一切通信しない。読み書きは自分の chrome.storage.local のみ。
// 長期履歴（カレンダー/トレンド/予測の土台）は自前蓄積でAPIから復元不能な一点物のため、
// アンインストール/PC移行での喪失を防ぐ手段を提供する。
import { h } from '../dom';
import { isoLocal } from '../format';

const PREFIX = 'zss:';
const CACHE_KEYS = new Set(['zss:courseVol3']); // 再構築可能なキャッシュはバックアップ対象外
// 日付→数値の履歴系（インポート時に統合する）
const HIST_KEYS = new Set(['zss:history', 'zss:reportHist', 'zss:materialHist']);

interface Backup {
  app: 'zen-study-stats';
  version: 1;
  exportedAt: string;
  data: Record<string, unknown>;
}

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local;
}

async function readAll(): Promise<Record<string, unknown>> {
  if (!hasStorage()) return {};
  const all = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(all)) {
    if (k.startsWith(PREFIX) && !CACHE_KEYS.has(k)) out[k] = all[k];
  }
  return out;
}

function triggerDownload(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 学習数・完了レポート累計・教材消化累計を日付で結合した1枚のCSV。 */
function toCsv(data: Record<string, unknown>): string {
  const learn = (data['zss:history'] as Record<string, number>) ?? {};
  const rep = (data['zss:reportHist'] as Record<string, number>) ?? {};
  const mat = (data['zss:materialHist'] as Record<string, number>) ?? {};
  const dates = Array.from(new Set([...Object.keys(learn), ...Object.keys(rep), ...Object.keys(mat)])).sort();
  const head = ['日付', '学習数', '完了レポート累計', '教材消化累計'];
  const lines = [head.map(csvCell).join(',')];
  for (const d of dates) {
    lines.push([d, learn[d] ?? '', rep[d] ?? '', mat[d] ?? ''].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\r\n'); // BOM付き（Excelの文字化け防止）
}

/** インポート: 履歴系は統合（同日付は取り込み側で上書き）、スカラーは置換。削除はしない。 */
async function importBackup(backup: Backup): Promise<number> {
  if (!hasStorage()) throw new Error('no-storage');
  const cur = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  let mergedDates = 0;
  for (const [k, v] of Object.entries(backup.data)) {
    if (!k.startsWith(PREFIX) || CACHE_KEYS.has(k)) continue;
    if (HIST_KEYS.has(k) && v && typeof v === 'object') {
      const merged = { ...((cur[k] as Record<string, number>) ?? {}), ...(v as Record<string, number>) };
      mergedDates += Object.keys(v as object).length;
      patch[k] = merged;
    } else {
      patch[k] = v;
    }
  }
  await chrome.storage.local.set(patch);
  return mergedDates;
}

function parseBackup(text: string): Backup {
  const j = JSON.parse(text);
  if (!j || j.app !== 'zen-study-stats' || typeof j.data !== 'object') {
    throw new Error('形式が違います（このツールのバックアップJSONではありません）');
  }
  return j as Backup;
}

/** データ管理セクション（カード末尾に控えめに配置）。 */
export function renderDataManage(): HTMLElement {
  const status = h('div', { class: 'zss-dm-status' }, []);
  const setStatus = (msg: string, kind: 'ok' | 'err' | '' = '') => {
    status.textContent = msg;
    status.className = 'zss-dm-status' + (kind ? ' ' + kind : '');
  };

  const jsonBtn = h('button', { class: 'zss-dm-btn' }, ['JSONで書き出す']);
  jsonBtn.addEventListener('click', async () => {
    try {
      const data = await readAll();
      const n = Object.keys(data['zss:history'] ?? {}).length;
      const backup: Backup = { app: 'zen-study-stats', version: 1, exportedAt: new Date().toISOString(), data };
      triggerDownload(`zen-study-stats-backup-${isoLocal(new Date())}.json`, 'application/json', JSON.stringify(backup, null, 2));
      setStatus(`書き出しました（学習記録 ${n} 日ぶん）`, 'ok');
    } catch (e) {
      console.warn('[ZSS] エクスポート失敗:', e);
      setStatus('書き出しに失敗しました', 'err');
    }
  });

  const csvBtn = h('button', { class: 'zss-dm-btn' }, ['CSVで書き出す']);
  csvBtn.addEventListener('click', async () => {
    try {
      const data = await readAll();
      triggerDownload(`zen-study-stats-${isoLocal(new Date())}.csv`, 'text/csv', toCsv(data));
      setStatus('CSVを書き出しました', 'ok');
    } catch (e) {
      console.warn('[ZSS] CSV書き出し失敗:', e);
      setStatus('CSVの書き出しに失敗しました', 'err');
    }
  });

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', class: 'zss-dm-file' }) as HTMLInputElement;
  const importBtn = h('button', { class: 'zss-dm-btn' }, ['JSONから復元']);
  const reloadBtn = h('button', { class: 'zss-dm-btn primary', style: 'display:none' }, ['再読み込みして反映']);
  reloadBtn.addEventListener('click', () => location.reload());
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const backup = parseBackup(text);
      const n = await importBackup(backup);
      setStatus(`復元しました（${n} 日ぶんを統合）。反映するには再読み込みしてください。`, 'ok');
      (reloadBtn as HTMLElement).style.display = '';
    } catch (e) {
      console.warn('[ZSS] インポート失敗:', e);
      setStatus(e instanceof Error ? e.message : '復元に失敗しました', 'err');
    } finally {
      fileInput.value = '';
    }
  });

  return h('details', { class: 'zss-fold zss-dm' }, [
    h('summary', {}, ['データのバックアップ / 復元']),
    h('p', { class: 'zss-dm-note' }, [
      '長期の学習履歴（カレンダー・トレンド・予測の土台）はこの端末だけに保存され、アンインストールで消えます。定期的な書き出しを推奨します。復元は既存データと統合します（削除はしません）。',
    ]),
    h('div', { class: 'zss-dm-row' }, [jsonBtn, csvBtn, importBtn, reloadBtn]),
    fileInput,
    status,
  ]);
}
