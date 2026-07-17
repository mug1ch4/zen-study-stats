// 学習数の長期履歴を自前で蓄積する層（chrome.storage.local）。
// 【第一原則】GETのみ・read-only。取得したデータをローカルに保存するだけ。
//
// 学習数APIは「直近14日」しか返さないため、サイトを開いた日に1回スナップショットして
// 14日窓をマージ蓄積する。14日以内に一度でも開けば穴は空かない。
import type { DailyAmount } from './api';
import { zenTodayISO, zenMondayISO } from './format';

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

// 当日始点の passed_materials（デイリー目標の「今日の完了数」を確実に差分算出するため）。
const KEY_DAYSTART = 'zss:dayStart'; // { date:"YYYY-MM-DD", passed:number }
export async function getDayStart(): Promise<{ date: string; passed: number } | null> {
  if (memOverride) return null;
  try {
    const r = await chrome.storage.local.get([KEY_DAYSTART]);
    const v = r?.[KEY_DAYSTART] as { date: string; passed: number } | undefined;
    return v && typeof v.passed === 'number' ? v : null;
  } catch {
    return null;
  }
}
/** 新しい学習日になったら当日始点を記録（同じ日なら何もしない＝始点は動かさない）。 */
export async function ensureDayStart(currentPassed: number): Promise<void> {
  if (memOverride) return;
  try {
    const today = todayISO();
    const cur = await getDayStart();
    if (!cur || cur.date !== today) {
      await chrome.storage.local.set({ [KEY_DAYSTART]: { date: today, passed: currentPassed } });
    }
  } catch {
    /* ignore */
  }
}

// --- 週の始点・週間目標（週目標バー/週次レビュー用） ---
const KEY_WEEKSTART = 'zss:weekStart'; // { week: 月曜"YYYY-MM-DD", passed: number }
const KEY_WEEKGOAL = 'zss:weekGoal'; // number（教材/週）

export interface WeekStart { week: string; passed: number }
export async function getWeekStart(): Promise<WeekStart | null> {
  if (memOverride) return null;
  try {
    const r = await chrome.storage.local.get([KEY_WEEKSTART]);
    const v = r?.[KEY_WEEKSTART] as WeekStart | undefined;
    return v && typeof v.passed === 'number' ? v : null;
  } catch {
    return null;
  }
}
/** 新しい週（月曜・5:00境界）になったら週始点を記録。rolled=切替が起きたか、prev=前週の始点。 */
export async function ensureWeekStart(currentPassed: number): Promise<{ rolled: boolean; prev: WeekStart | null }> {
  if (memOverride) return { rolled: false, prev: null };
  try {
    const week = zenMondayISO();
    const cur = await getWeekStart();
    if (!cur || cur.week !== week) {
      await chrome.storage.local.set({ [KEY_WEEKSTART]: { week, passed: currentPassed } });
      return { rolled: !!cur, prev: cur }; // 初回設置(cur=null)はレビュー対象外
    }
    return { rolled: false, prev: null };
  } catch {
    return { rolled: false, prev: null };
  }
}
export async function getWeekGoal(): Promise<number | null> {
  if (memOverride) return null;
  try {
    const r = await chrome.storage.local.get([KEY_WEEKGOAL]);
    const v = r?.[KEY_WEEKGOAL];
    return typeof v === 'number' && v > 0 ? v : null;
  } catch {
    return null;
  }
}
export async function setWeekGoal(n: number): Promise<void> {
  if (memOverride) return;
  try {
    await chrome.storage.local.set({ [KEY_WEEKGOAL]: n });
  } catch {
    /* ignore */
  }
}

// --- 予測スナップショット（的中率＝キャリブレーション検証用） ---
// 予測時点の「d日後の残数バンド」を保存し、後日の実績と突き合わせる。1日1件・直近180日分。
const KEY_PREDLOG = 'zss:predLog';
export interface PredCheckpoint { off: number; p15: number; p50: number; p85: number }
export interface PredLogEntry { remaining: number; cp: PredCheckpoint[] }
export type PredLog = Record<string, PredLogEntry>;

export async function getPredLog(): Promise<PredLog> {
  if (memOverride) return {};
  try {
    const r = await chrome.storage.local.get([KEY_PREDLOG]);
    return (r?.[KEY_PREDLOG] as PredLog) ?? {};
  } catch {
    return {};
  }
}
/** その日の予測スナップショットを保存（既にあれば何もしない・180日で剪定）。 */
export async function savePredSnapshot(entry: PredLogEntry): Promise<void> {
  if (memOverride) return;
  try {
    const log = await getPredLog();
    const today = todayISO();
    if (log[today]) return;
    log[today] = entry;
    const keys = Object.keys(log).sort();
    while (keys.length > 180) delete log[keys.shift()!];
    await chrome.storage.local.set({ [KEY_PREDLOG]: log });
  } catch {
    /* ignore */
  }
}

// --- 表示設定: 視聴任意の補助教材（supplement動画）を残り学習量に含めるか ---
// 本家準拠の進捗（完了%・予測・今日の目標）には影響しない。拡張の自前集計の表示のみ。
const KEY_INCSUPP = 'zss:includeSupp';
export async function getIncludeSupp(): Promise<boolean> {
  if (memOverride) return false;
  try {
    const r = await chrome.storage.local.get([KEY_INCSUPP]);
    return !!r?.[KEY_INCSUPP];
  } catch {
    return false;
  }
}
export async function setIncludeSupp(v: boolean): Promise<void> {
  if (memOverride) return;
  try {
    await chrome.storage.local.set({ [KEY_INCSUPP]: v });
  } catch {
    /* ignore */
  }
}

// --- テスト/レポートの所要時間 実測（教科×種別の 分/問） ---
// 完了検知の「直前の完了からの間隔」を所要時間の近似として蓄積し、
// 残り学習量シェアの時間換算を固定目安→教科別実測へ精緻化する。
const KEY_WORKTIME = 'zss:workTime';
export interface WorkStat { min: number; q: number; n: number } // 合計分・合計問題数・サンプル数
export type WorkTimes = Record<string, { test?: WorkStat; report?: WorkStat }>;

export async function getWorkTimes(): Promise<WorkTimes> {
  if (memOverride) return {};
  try {
    const r = await chrome.storage.local.get([KEY_WORKTIME]);
    return (r?.[KEY_WORKTIME] as WorkTimes) ?? {};
  } catch {
    return {};
  }
}
export async function recordWorkTime(courseId: number, kind: 'test' | 'report', minutes: number, questions: number): Promise<void> {
  if (memOverride || minutes <= 0) return;
  try {
    const wt = await getWorkTimes();
    const c = (wt[courseId] ??= {});
    const s = (c[kind] ??= { min: 0, q: 0, n: 0 });
    s.min += minutes;
    s.q += Math.max(1, questions);
    s.n += 1;
    await chrome.storage.local.set({ [KEY_WORKTIME]: wt });
  } catch {
    /* ignore */
  }
}

// --- 実績バッジの解除記録（初達成日を残す） ---
const KEY_ACH = 'zss:achievements'; // { [id]: 達成日"YYYY-MM-DD" }
export async function getAchievementDates(): Promise<Record<string, string>> {
  if (memOverride) return {};
  try {
    const r = await chrome.storage.local.get([KEY_ACH]);
    return (r?.[KEY_ACH] as Record<string, string>) ?? {};
  } catch {
    return {};
  }
}
/** 新規達成のみ記録（達成日は初回のみ・巻き戻さない）。 */
export async function recordAchievements(ids: string[]): Promise<void> {
  if (memOverride || !ids.length) return;
  try {
    const cur = await getAchievementDates();
    let changed = false;
    for (const id of ids) {
      if (!cur[id]) {
        cur[id] = todayISO();
        changed = true;
      }
    }
    if (changed) await chrome.storage.local.set({ [KEY_ACH]: cur });
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

// --- 時間帯の傾向 ---
// study[h]: 完了検知(observer.js が本家の完了PUTを観測→content.js)で、完了した"その時刻"に +1。
//   ＝正確な時刻。以前の「学習数の増分を観測時刻へ帰属」は別デバイス/久々訪問で誤帰属したため廃止。
// visit[h]: その時間にサイトを開いた回数（アクセス傾向・補助指標）。
const KEY_HOUR = 'zss:hourStats';
interface HourStore { study: number[]; visit: number[]; lastTs: number }
const zeros24 = () => new Array(24).fill(0) as number[];
function jstHour(nowMs: number): number {
  return new Date(nowMs + 9 * 3600 * 1000).getUTCHours();
}
async function loadHour(): Promise<HourStore> {
  const r = await chrome.storage.local.get([KEY_HOUR]);
  return (r?.[KEY_HOUR] as HourStore) ?? { study: zeros24(), visit: zeros24(), lastTs: 0 };
}
/** 訪問時間帯のみ記録（学習数は取得しない＝fetch不要）。20分ゲートで冪等。 */
export async function recordVisit(nowMs: number): Promise<void> {
  if (memOverride) return;
  try {
    const s = await loadHour();
    if (nowMs - (s.lastTs ?? 0) < 20 * 60 * 1000) return;
    s.visit[jstHour(nowMs)] = (s.visit[jstHour(nowMs)] ?? 0) + 1;
    s.lastTs = nowMs;
    await chrome.storage.local.set({ [KEY_HOUR]: s });
  } catch {
    /* ignore */
  }
}
/** 完了検知時に、完了した"その時刻"へ学習を +count（時間帯 study の唯一の源・正確）。 */
export async function recordCompletion(nowMs: number, count = 1): Promise<void> {
  if (memOverride || count <= 0) return;
  try {
    const s = await loadHour();
    s.study[jstHour(nowMs)] = (s.study[jstHour(nowMs)] ?? 0) + count;
    await chrome.storage.local.set({ [KEY_HOUR]: s });
  } catch {
    /* ignore */
  }
}

// 完了検知の"実カウント"照合用: 直近の passed_materials 合計を記憶。
const KEY_LASTPASSED = 'zss:lastPassed';
export async function getLastPassed(): Promise<number | null> {
  if (memOverride) return null;
  try {
    const r = await chrome.storage.local.get([KEY_LASTPASSED]);
    const v = r?.[KEY_LASTPASSED];
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}
export async function setLastPassed(n: number): Promise<void> {
  if (memOverride) return;
  try {
    await chrome.storage.local.set({ [KEY_LASTPASSED]: n });
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
