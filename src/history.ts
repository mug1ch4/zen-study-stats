// 学習数の長期履歴を自前で蓄積する層（chrome.storage.local）。
// 【第一原則】GETのみ・read-only。取得したデータをローカルに保存するだけ。
//
// 学習数APIは「直近14日」しか返さないため、サイトを開いた日に1回スナップショットして
// 14日窓をマージ蓄積する。14日以内に一度でも開けば穴は空かない。
import type { DailyAmount } from './api';
import { zenTodayISO } from './format';

const KEY_HISTORY = 'zss:history'; // { "YYYY-MM-DD": number } 学習数
const KEY_REPORTHIST = 'zss:reportHist'; // { "YYYY-MM-DD": number } 完了レポート累計
const KEY_LASTSNAP = 'zss:lastSnap'; // "YYYY-MM-DD"

export type History = Record<string, number>;

/** ZEN Study の「学習上の今日」 "YYYY-MM-DD"（日別データは 5:00 AM JST に切替）。
 *  ストリーク・カレンダー・予測基点・スナップショットの日付キーを本家の日境界に揃える。 */
export function todayISO(): string {
  return zenTodayISO();
}

// --- ストレージ抽象（chrome.storage が無い環境=プレビュー用に差し替え可能） ---
let memOverride: History | null = null;
/** プレビュー/テスト用にメモリ履歴を注入。 */
export function __setMockHistory(h: History): void {
  memOverride = { ...h };
}

async function loadRaw(): Promise<History> {
  if (memOverride) return { ...memOverride };
  try {
    const r = await chrome.storage.local.get([KEY_HISTORY]);
    return (r?.[KEY_HISTORY] as History) ?? {};
  } catch {
    return {};
  }
}
async function saveRaw(h: History): Promise<void> {
  if (memOverride) {
    memOverride = { ...h };
    return;
  }
  try {
    await chrome.storage.local.set({ [KEY_HISTORY]: h });
  } catch {
    /* ignore */
  }
}

/** 14日窓の非nullな日別値を履歴にマージ（最新値で上書き＝gap埋め・今日の値更新）。 */
export async function mergeWindow(days: DailyAmount[]): Promise<History> {
  const h = await loadRaw();
  for (const d of days) {
    if (d.amount === null) continue;
    h[d.date] = d.amount;
  }
  await saveRaw(h);
  return h;
}

/** 完了レポート累計を今日の値として記録。 */
export async function snapshotReports(passed: number): Promise<void> {
  if (memOverride) return;
  try {
    const r = await chrome.storage.local.get([KEY_REPORTHIST]);
    const h = (r?.[KEY_REPORTHIST] as History) ?? {};
    h[todayISO()] = passed;
    await chrome.storage.local.set({ [KEY_REPORTHIST]: h });
  } catch {
    /* ignore */
  }
}

/** 完了レポート累計の履歴（日付昇順）。 */
export async function getReportSeries(): Promise<{ date: string; passed: number }[]> {
  if (mockReportHist) {
    return Object.keys(mockReportHist)
      .sort()
      .map((date) => ({ date, passed: mockReportHist![date] }));
  }
  try {
    const r = await chrome.storage.local.get([KEY_REPORTHIST]);
    const h = (r?.[KEY_REPORTHIST] as History) ?? {};
    return Object.keys(h)
      .sort()
      .map((date) => ({ date, passed: h[date] }));
  } catch {
    return [];
  }
}

let mockReportHist: History | null = null;
export function __setMockReportHist(h: History): void {
  mockReportHist = { ...h };
}

// --- 教材消化（passed_materials）の履歴 ---
const KEY_MATHIST = 'zss:materialHist'; // { "YYYY-MM-DD": passed }
const KEY_MATTOTAL = 'zss:materialTotal'; // 最新 total

let mockMatHist: History | null = null;
let mockMatTotal: number | null = null;
export function __setMockMaterialHist(h: History, total: number): void {
  mockMatHist = { ...h };
  mockMatTotal = total;
}

/** 教材消化の累計(passed)と総数(total)を今日の値として記録。 */
export async function snapshotMaterials(passed: number, total: number): Promise<void> {
  if (mockMatHist) return;
  try {
    const r = await chrome.storage.local.get([KEY_MATHIST]);
    const h = (r?.[KEY_MATHIST] as History) ?? {};
    h[todayISO()] = passed;
    await chrome.storage.local.set({ [KEY_MATHIST]: h, [KEY_MATTOTAL]: total });
  } catch {
    /* ignore */
  }
}

/** 教材消化履歴（日付昇順）＋最新total。 */
export async function getMaterialHistory(): Promise<{ series: { date: string; passed: number }[]; total: number }> {
  if (mockMatHist) {
    return {
      series: Object.keys(mockMatHist).sort().map((date) => ({ date, passed: mockMatHist![date] })),
      total: mockMatTotal ?? 0,
    };
  }
  try {
    const r = await chrome.storage.local.get([KEY_MATHIST, KEY_MATTOTAL]);
    const h = (r?.[KEY_MATHIST] as History) ?? {};
    return {
      series: Object.keys(h).sort().map((date) => ({ date, passed: h[date] })),
      total: (r?.[KEY_MATTOTAL] as number) ?? 0,
    };
  } catch {
    return { series: [], total: 0 };
  }
}

/** 1日1回だけ、渡された処理を実行（サイトを開いた日を記録）。学習数＋レポートをまとめて。 */
export async function maybeDailySnapshot(work: () => Promise<void>): Promise<void> {
  const today = todayISO();
  try {
    if (memOverride) return; // プレビューでは何もしない
    const r = await chrome.storage.local.get([KEY_LASTSNAP]);
    if (r?.[KEY_LASTSNAP] === today) return; // 今日は取得済み
  } catch {
    return;
  }
  try {
    await work();
    await chrome.storage.local.set({ [KEY_LASTSNAP]: today });
  } catch (e) {
    console.warn('[ZSS] 日次スナップショット失敗:', e);
  }
}

/** 履歴を日付昇順の配列で取得。 */
export async function getSeries(): Promise<{ date: string; amount: number }[]> {
  const h = await loadRaw();
  return Object.keys(h)
    .sort()
    .map((date) => ({ date, amount: h[date] }));
}

/** 記録開始日（最古の記録日）。無ければ null。 */
export async function firstDate(): Promise<string | null> {
  const h = await loadRaw();
  const keys = Object.keys(h).sort();
  return keys.length ? keys[0] : null;
}
