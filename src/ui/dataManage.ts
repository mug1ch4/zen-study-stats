// 蓄積データのバックアップ／復元（JSON/CSV）。
// 【第一原則】ZEN Study へは一切通信しない。読み書きは自分の chrome.storage.local のみ。
// 長期履歴（カレンダー/トレンド/予測の土台）は自前蓄積でAPIから復元不能な一点物のため、
// アンインストール/PC移行での喪失を防ぐ手段を提供する。
import { h } from '../dom';
import { isoLocal } from '../format';

const PREFIX = 'zss:';
// バックアップ対象外（再構築可能なキャッシュ／端末ごとの運用・セッション状態）。
// これらは復元するとむしろ不整合を招くため、書き出し・取り込みの両方で除外する:
//   courseVol3: コース集計キャッシュ（次回取得で再構築）
//   lastSnap  : 当日スナップ済みフラグ（復元すると復元先の当日スナップをスキップしてしまう）
//   lastPassed: 完了検知の基準passed（端末ごとに実測から再設定すべき。復元すると初回差分が壊れる）
//   dayStart  : 当日の始点passed（その日限り・カード表示時に再設定される）
//   notify    : 通知の既送dedup（端末ごと。復元先で未読の節目通知を抑制してしまう）
const SKIP_KEYS = new Set([
  'zss:courseVol3', // 旧キャッシュ（残っていても取り込まない）
  'zss:courseVol4',
  'zss:courseVol5',
  'zss:courseVol6',
  'zss:lastSnap',
  'zss:lastPassed',
  'zss:dayStart',
  'zss:notify',
  'zss:timerAcc', // 未提出タイマーの一時蓄積（端末ごとの進行中状態。確定分は workTime に入る）
]);
// 日付→数値の履歴系（インポート時に統合する）
const HIST_KEYS = new Set(['zss:history', 'zss:reportHist', 'zss:materialHist', 'zss:materialTotalHist', 'zss:coursePassedHist', 'zss:deadlineOutcomes', 'zss:resultLog']);
// 時間帯の学習記録（24時間バケットの加算カウンタ）。復元先が空＝そのまま、既存あり＝合算で統合。
const HOUR_KEY = 'zss:hourStats';

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
    if (k.startsWith(PREFIX) && !SKIP_KEYS.has(k)) out[k] = all[k];
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

/** 時間帯カウンタの統合: 24バケットとも「大きい方」を採用（重複取り込みでも二重計上せず・減らさない）。 */
function mergeHourStats(cur: unknown, inc: unknown): unknown {
  const z = (): number[] => new Array(24).fill(0);
  const c = (cur ?? {}) as { study?: number[]; visit?: number[]; lastTs?: number };
  const i = (inc ?? {}) as { study?: number[]; visit?: number[]; lastTs?: number };
  const maxArr = (a: number[] = [], b: number[] = []): number[] => z().map((_, k) => Math.max(a[k] ?? 0, b[k] ?? 0));
  return { study: maxArr(c.study, i.study), visit: maxArr(c.visit, i.visit), lastTs: Math.max(c.lastTs ?? 0, i.lastTs ?? 0) };
}

/** インポート: 履歴系は統合（同日付は取り込み側で上書き）、時間帯は大きい方で統合、他は置換。削除はしない。
 *  運用/セッション状態(SKIP_KEYS)は取り込まない（復元先の当日スナップや完了検知基準を壊さないため）。 */
async function importBackup(backup: Backup): Promise<number> {
  if (!hasStorage()) throw new Error('no-storage');
  const cur = (await chrome.storage.local.get(null)) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  let mergedDates = 0;
  for (const [k, v] of Object.entries(backup.data)) {
    if (!k.startsWith(PREFIX) || SKIP_KEYS.has(k)) continue;
    if (HIST_KEYS.has(k) && v && typeof v === 'object') {
      const merged = { ...((cur[k] as Record<string, number>) ?? {}), ...(v as Record<string, number>) };
      mergedDates += Object.keys(v as object).length;
      patch[k] = merged;
    } else if (k === HOUR_KEY && v && typeof v === 'object') {
      patch[k] = mergeHourStats(cur[k], v);
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
  // プレビュー/ライブデモ（chrome.storage なし）では、壊れたボタンを出さず案内のみ。
  if (!hasStorage()) {
    return h('details', { class: 'zss-fold zss-dm' }, [
      h('summary', {}, ['データのバックアップ / 復元']),
      h('p', { class: 'zss-dm-note' }, ['拡張機能として ZEN Study 上で動作しているときに利用できます（このデモでは無効です）。']),
    ]);
  }
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
    h('p', { class: 'zss-dm-note' }, [
      'JSONに含むもの: 学習数・完了レポート・教材消化の履歴、時間帯の学習記録、目標完了日、テーマ設定。',
      '（コース集計キャッシュや、当日限り／端末ごとの内部状態＝スナップ済みフラグ・完了検知の基準値・通知の既送記録は、復元時の不整合を避けるため除外）。CSVは日付×学習数・完了レポート・教材消化の一覧。',
    ]),
    h('div', { class: 'zss-dm-row' }, [jsonBtn, csvBtn, importBtn, reloadBtn]),
    fileInput,
    status,
  ]);
}
