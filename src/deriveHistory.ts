// 蓄積した履歴(series)から カレンダー / 長期トレンド / ストリーク を導出（純関数）。
import { parseDate } from './format';
import { todayISO } from './history';

export interface Series {
  date: string;
  amount: number;
}

// ---- カレンダー（GitHub風ヒートマップ） ----
export interface CalCell {
  date: string;
  amount: number | null; // null = 未記録
  weekday: number; // 0=日..6=土
  week: number; // 左からの週インデックス
}
export interface CalendarData {
  cells: CalCell[];
  weeks: number;
  max: number;
  start: string;
  end: string;
}

function addDays(iso: string, n: number): string {
  const d = parseDate(iso);
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function weekdayOf(iso: string): number {
  return parseDate(iso).getDay();
}

/** 記録開始（無ければ today-27d）〜today を、週開始(日曜)に整列してセル化。 */
export function calendarData(series: Series[]): CalendarData {
  const map = new Map(series.map((s) => [s.date, s.amount]));
  const end = todayISO();
  const firstRec = series.length ? series[0].date : addDays(end, -27);
  // 最低4週間ぶんは枠を見せる（初期でも“育つ器”を提示）
  const minStart = addDays(end, -27);
  let start = firstRec < minStart ? firstRec : minStart;
  // 週開始(日曜)に揃える
  start = addDays(start, -weekdayOf(start));

  const cells: CalCell[] = [];
  let max = 1;
  let cur = start;
  let week = 0;
  let guard = 0;
  while (cur <= end && guard++ < 800) {
    const wd = weekdayOf(cur);
    const amount = map.has(cur) ? map.get(cur)! : null;
    if (amount !== null && amount > max) max = amount;
    cells.push({ date: cur, amount, weekday: wd, week });
    if (wd === 6) week++;
    cur = addDays(cur, 1);
  }
  return { cells, weeks: week + 1, max, start, end };
}

// ---- ストリーク ----
export interface StreakInfo {
  current: number;
  longest: number;
  todayDone: boolean; // 今日すでに学習したか（false でも current は「昨日までの生存中の連続」）
}
export function streakInfo(series: Series[]): StreakInfo {
  if (!series.length) return { current: 0, longest: 0, todayDone: false };
  const map = new Map(series.map((s) => [s.date, s.amount]));
  const end = todayISO();
  const todayDone = (map.get(end) ?? 0) > 0;

  // current: 「生存中の連続」。今日未学習でも昨日までの連続は途切れていない
  // （途切れ確定は丸1日空いてから）。今日開いた時点で 0 と表示される違和感を避ける。
  let current = 0;
  let d = todayDone ? end : addDays(end, -1);
  let g = 0;
  while (g++ < 3660) {
    const a = map.get(d);
    if (a !== undefined && a > 0) {
      current++;
      d = addDays(d, -1);
    } else break;
  }

  // longest: 全期間の連続（カレンダー日基準）
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const s of series) {
    if (s.amount > 0) {
      if (prev && addDays(prev, 1) === s.date) run++;
      else run = 1;
      if (run > longest) longest = run;
      prev = s.date;
    } else {
      run = 0;
      prev = s.date;
    }
  }
  return { current: Math.max(current, 0), longest: Math.max(longest, current), todayDone };
}

// ---- 長期トレンド ----
export type TrendMode = 'day' | 'week' | 'month';
export interface TrendPoint {
  key: string; // バケットキー
  label: string; // 表示ラベル
  value: number; // 合計(週/月) or その日(日)
  ma?: number; // 7日移動平均（dayのみ）
}

function isoWeekKey(iso: string): string {
  // 週開始(日曜)の日付をキーに
  const start = addDays(iso, -weekdayOf(iso));
  return start;
}

export function trendPoints(series: Series[], mode: TrendMode): TrendPoint[] {
  if (mode === 'day') {
    const pts: TrendPoint[] = series.map((s) => {
      const d = parseDate(s.date);
      return { key: s.date, label: `${d.getMonth() + 1}/${d.getDate()}`, value: s.amount };
    });
    // 7点移動平均
    for (let i = 0; i < pts.length; i++) {
      const from = Math.max(0, i - 6);
      const slice = pts.slice(from, i + 1);
      pts[i].ma = slice.reduce((a, p) => a + p.value, 0) / slice.length;
    }
    return pts;
  }
  // week / month は合計バケット
  const buckets = new Map<string, number>();
  for (const s of series) {
    const key =
      mode === 'week' ? isoWeekKey(s.date) : s.date.slice(0, 7); // YYYY-MM
    buckets.set(key, (buckets.get(key) ?? 0) + s.amount);
  }
  return [...buckets.keys()].sort().map((key) => {
    const label =
      mode === 'week'
        ? `${parseDate(key).getMonth() + 1}/${parseDate(key).getDate()}週`
        : `${key.slice(0, 4)}/${key.slice(5, 7)}`;
    return { key, label, value: buckets.get(key)! };
  });
}
