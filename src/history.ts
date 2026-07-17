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

// --- 時間帯の傾向（APIに時刻が無いため、/setting を開くたびに自前記録） ---
// study[h]: 同一学習日内の連続訪問で増えた学習数を、後の訪問の時間(JST)に帰属（=その頃に進めた）。
// visit[h]: その時間にサイトを開いた回数（アクセス傾向・弱い代理指標）。
const KEY_HOUR = 'zss:hourStats'; // { study:number[24], visit:number[24], lastDay, lastAmount, lastTs }
interface HourStore { study: number[]; visit: number[]; lastDay: string; lastAmount: number; lastTs: number }
const zeros24 = () => new Array(24).fill(0) as number[];
function jstHour(nowMs: number): number {
  return new Date(nowMs + 9 * 3600 * 1000).getUTCHours();
}
/** 訪問を記録。ストレージ永続の20分ゲートを「取得前」に判定し、過剰なリクエストを防ぐ。
 *  todayAmount は遅延取得（getAmount）にし、ゲート通過時のみ fetch する（連続リロードでも取得は最大20分に1回）。 */
export async function recordVisit(nowMs: number, getAmount: () => Promise<number>): Promise<void> {
  if (memOverride) return;
  try {
    const r = await chrome.storage.local.get([KEY_HOUR]);
    const s = (r?.[KEY_HOUR] as HourStore) ?? { study: zeros24(), visit: zeros24(), lastDay: '', lastAmount: 0, lastTs: 0 };
    if (nowMs - (s.lastTs ?? 0) < 20 * 60 * 1000) return; // 直近20分は同一訪問扱い（fetchもしない）
    const todayAmount = await getAmount(); // ゲート通過時のみ当日学習数を取得
    const h = jstHour(nowMs);
    const day = zenTodayISO(nowMs);
    s.visit[h] = (s.visit[h] ?? 0) + 1;
    if (s.lastDay === day && todayAmount > s.lastAmount) {
      s.study[h] = (s.study[h] ?? 0) + (todayAmount - s.lastAmount); // 同日内の増分を帰属
    }
    s.lastDay = day;
    s.lastAmount = todayAmount;
    s.lastTs = nowMs;
    await chrome.storage.local.set({ [KEY_HOUR]: s });
  } catch {
    /* ignore */
  }
}
export async function getHourStats(): Promise<{ study: number[]; visit: number[] }> {
  if (memOverride) return { study: mockHour?.study ?? zeros24(), visit: mockHour?.visit ?? zeros24() };
  try {
    const r = await chrome.storage.local.get([KEY_HOUR]);
    const s = r?.[KEY_HOUR] as HourStore | undefined;
    return { study: s?.study ?? zeros24(), visit: s?.visit ?? zeros24() };
  } catch {
    return { study: zeros24(), visit: zeros24() };
  }
}
let mockHour: { study: number[]; visit: number[] } | null = null;
export function __setMockHour(study: number[], visit: number[]): void {
  mockHour = { study, visit };
}

// --- 目標日（「目標日から逆算」の設定値を記憶） ---
const KEY_TARGET = 'zss:targetDate'; // "YYYY-MM-DD"
export async function getTargetDate(): Promise<string | null> {
  if (memOverride) return null;
  try {
    const r = await chrome.storage.local.get([KEY_TARGET]);
    return (r?.[KEY_TARGET] as string) ?? null;
  } catch {
    return null;
  }
}
export async function setTargetDate(iso: string): Promise<void> {
  if (memOverride) return;
  try {
    await chrome.storage.local.set({ [KEY_TARGET]: iso });
  } catch {
    /* ignore */
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
