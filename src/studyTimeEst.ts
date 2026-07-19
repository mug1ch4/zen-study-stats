// 受験記録（詳細ログ）＋動画補間＋所要時間実測から「学習時間」を推定する（純関数）。
// 用途: アクティブタイム実測（studyTime）が無い日＝計測開始前・他端末（スマホ等）の日を埋める。
// 【二重計上の禁止】実測がある日は実測がテスト/レポート/動画の時間を既に含むため、
//   推定は実測に「加算」せず、日ごとに max(実測, 推定) で統合すること（呼び出し側の責務）。
// 根拠:
//   動画  = 補間イベントの実尺 len（必修動画は倍速不可＝視聴時間そのもの）
//   受験  = 1回の受験につき 教科×種別の実測平均 min/n（無ければ全教科平均→既定値）。
//           初回と最新が別時刻なら別受験として各1回ぶん計上。
import { zenTodayISO } from './format';
import type { ResultEntry } from './resultLog';
import type { MovieEvent } from './movieInterp';
import type { WorkTimes } from './history';

// 実測が無いときの既定所要（分）。ユーザー実測（min/n）が貯まり次第そちらを使う。
const DEFAULT_MIN = { test: 5, report: 15 } as const;

const jstHour = (ms: number): number => new Date(ms + 9 * 3600 * 1000).getUTCHours();

/** 教科×種別の平均所要（分/回）。教科実測 → 全教科実測 → 既定値の順で解決。 */
export function avgWorkMinutes(wt: WorkTimes, courseId: number, kind: 'test' | 'report'): number {
  const c = wt[String(courseId)]?.[kind] ?? wt[courseId as unknown as string]?.[kind];
  if (c && c.n > 0) return c.min / c.n;
  let min = 0;
  let n = 0;
  for (const stats of Object.values(wt)) {
    const s = stats[kind];
    if (s && s.n > 0) {
      min += s.min;
      n += s.n;
    }
  }
  if (n > 0) return min / n;
  return DEFAULT_MIN[kind];
}

/** 受験1回ぶんのイベント列（epoch秒・種別・教科）。初回/最新が別時刻なら2回。 */
function attemptEvents(entries: ResultEntry[]): { at: number; courseId: number; kind: 'test' | 'report' }[] {
  const out: { at: number; courseId: number; kind: 'test' | 'report' }[] = [];
  for (const e of entries) {
    const kind: 'test' | 'report' = e.kind === 'report' ? 'report' : 'test';
    if (e.firstAt) out.push({ at: e.firstAt, courseId: e.courseId, kind });
    if (e.latestAt && e.latestAt !== e.firstAt) out.push({ at: e.latestAt, courseId: e.courseId, kind });
  }
  return out;
}

/** 日別（zen-day）の推定学習秒数。 */
export function estimateDailyStudySeconds(entries: ResultEntry[], movieEvents: MovieEvent[], wt: WorkTimes): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (day: string, sec: number): void => {
    out[day] = (out[day] ?? 0) + sec;
  };
  for (const m of movieEvents) add(zenTodayISO(m.at * 1000), m.len);
  for (const a of attemptEvents(entries)) add(zenTodayISO(a.at * 1000), avgWorkMinutes(wt, a.courseId, a.kind) * 60);
  return out;
}

/** 時間帯別（JST 24バケット）の推定学習秒数。動画は尺ぶんを完了時刻のバケットへ計上。 */
export function estimateHourlyStudySeconds(entries: ResultEntry[], movieEvents: MovieEvent[], wt: WorkTimes): number[] {
  const out = new Array(24).fill(0) as number[];
  for (const m of movieEvents) out[jstHour(m.at * 1000)] += m.len;
  for (const a of attemptEvents(entries)) out[jstHour(a.at * 1000)] += avgWorkMinutes(wt, a.courseId, a.kind) * 60;
  return out;
}
