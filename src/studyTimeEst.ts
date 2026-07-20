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
import type { MovieEvent, ChapterSkels } from './movieInterp';
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

// ---- 第3層フォールバック: 学習量×換算値 ----
// 受験記録ベースの推定は詳細ログの抽出時点で止まる（今日・未抽出期間が抜ける）ため、
// 「当日も更新される学習量」を時間に換算して埋める。換算値はユーザー自身のデータで較正する。
const SEC_PER_LA_MIN = 60; // 較正のクランプ（1〜10分/学習）: 異常データで暴れない
const SEC_PER_LA_MAX = 600;
const clampSec = (v: number): number => Math.min(SEC_PER_LA_MAX, Math.max(SEC_PER_LA_MIN, v));

/** 遡及分の総学習秒: passed動画の総実尺（skels・日割り不要の既知量）＋ 受験回数×平均所要。
 *  日別に按分した estimateDailyStudySeconds と違い、補間できなかった動画も全て入る（較正の分子用）。 */
export function totalRetroSeconds(skels: ChapterSkels, entries: ResultEntry[], wt: WorkTimes): number {
  let sec = 0;
  for (const s of Object.values(skels)) for (const x of s.sections) if (x.kind === 'movie' && x.passed) sec += x.len;
  for (const a of attemptEvents(entries)) sec += avgWorkMinutes(wt, a.courseId, a.kind) * 60;
  return sec;
}

/** 「秒/学習(LA)」の較正値。
 *  1) 丸一日実測できた日（measured>0 かつ 受験推定以上・今日を除く）が3日以上 → Σ実測/ΣLA（行動の真値）
 *  2) 無ければ全期間トータル: totalRetroSeconds / ΣLA（動画の日割り不能でも総量は既知）
 *  どちらも作れなければ null（無理に表示しない）。 */
export function calibrateSecPerLA(
  la: { date: string; amount: number }[],
  measured: Record<string, number>,
  estDaily: Record<string, number>,
  retroTotalSec: number,
  todayISO: string
): number | null {
  let mLa = 0;
  let mSec = 0;
  let mDays = 0;
  for (const p of la) {
    if (p.date >= todayISO || p.amount <= 0) continue;
    const m = measured[p.date] ?? 0;
    if (m > 0 && m >= (estDaily[p.date] ?? 0)) {
      mLa += p.amount;
      mSec += m;
      mDays++;
    }
  }
  if (mDays >= 3 && mLa >= 30) return clampSec(mSec / mLa);
  const laSum = la.filter((p) => p.date < todayISO).reduce((a, p) => a + p.amount, 0);
  if (laSum >= 30 && retroTotalSec > 0) return clampSec(retroTotalSec / laSum);
  return null;
}

// ---- 教科構成を考慮した換算（コース集計キャッシュがあるとき）----
// 教材1つの重さは教科で大きく違う（長い動画の英語 vs 短い特別活動）。当日どの教科を
// 進めたかは coursePassedHist（ライブupsert）で分かるので、教科別の 秒/教材 で換算する。
export interface CourseVolLite {
  id: number;
  totalMaterials: number;
  movieSeconds: number;
  testCount: number;
  reportCount: number;
}

export function secPerMaterialByCourse(vols: CourseVolLite[], wt: WorkTimes): { byCourse: Map<number, number>; global: number | null } {
  const byCourse = new Map<number, number>();
  let secSum = 0;
  let matSum = 0;
  for (const v of vols) {
    if (v.totalMaterials <= 0) continue;
    const sec = v.movieSeconds + v.testCount * avgWorkMinutes(wt, v.id, 'test') * 60 + v.reportCount * avgWorkMinutes(wt, v.id, 'report') * 60;
    byCourse.set(v.id, sec / v.totalMaterials);
    secSum += sec;
    matSum += v.totalMaterials;
  }
  return { byCourse, global: matSum > 0 ? secSum / matSum : null };
}

/** 日別の「残り時間（秒）」系列（バーンダウンの時間表示用）。
 *  残り教材数の系列は既にある（正準系列）が、残りの中身は日々変わる（軽い教科から先に
 *  消化すると残りは重くなる）ため、教科別の残り×秒/教材で構成を考慮して換算する。
 *  - cph にある日: その日の教科別 passed から正確に算出
 *  - それ以前: 最初の既知点から教科別イベント（受験＋補間動画）を積み戻して復元
 *  - アンカーに乗らない消化（LA按分ぶん）: 全体残り教材数(remainingMat)に一致するよう
 *    比例スケール（日平均の構成で帰属） */
export function buildRemainingHoursSeries(args: {
  dates: string[]; // 昇順・対象日
  remainingMat: Map<string, number>; // 日→全体の残り教材（正準系列由来・正規化目標）
  courses: { id: number; total: number; passed: number }[];
  cph: { date: string; byCourse: Record<number, number> }[];
  events: { at: number; courseId: number }[];
  conv: { byCourse: Map<number, number>; global: number | null };
}): Map<string, number> {
  const out = new Map<string, number>();
  if (args.conv.global === null) return out;
  const spm = (cid: number): number => args.conv.byCourse.get(cid) ?? args.conv.global!;
  const zdayOf = (at: number): string => zenTodayISO(at * 1000);
  // 教科別イベント日次カウント
  const evByCourse = new Map<number, Map<string, number>>();
  for (const e of args.events) {
    let m = evByCourse.get(e.courseId);
    if (!m) evByCourse.set(e.courseId, (m = new Map()));
    const dd = zdayOf(e.at);
    m.set(dd, (m.get(dd) ?? 0) + 1);
  }
  const cphSorted = [...args.cph].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const d of args.dates) {
    let sec = 0;
    let knownMat = 0;
    for (const c of args.courses) {
      // その日以前の最新スナップ（教科値あり）
      let passedAt: number | null = null;
      for (let i = cphSorted.length - 1; i >= 0; i--) {
        if (cphSorted[i].date <= d && cphSorted[i].byCourse[c.id] !== undefined) {
          passedAt = cphSorted[i].byCourse[c.id];
          break;
        }
      }
      if (passedAt === null) {
        // 既知点（最初のスナップ or 現在値）からイベントを積み戻す
        const first = cphSorted.find((r) => r.byCourse[c.id] !== undefined);
        const baseDate = first?.date ?? null; // null = 現在値(今日)基準
        const basePassed = first ? first.byCourse[c.id] : c.passed;
        let back = 0;
        const evm = evByCourse.get(c.id);
        if (evm) for (const [dd, n] of evm) if (dd > d && (baseDate === null || dd <= baseDate)) back += n;
        passedAt = Math.max(0, basePassed - back);
      }
      const rem = Math.max(0, c.total - passedAt);
      sec += rem * spm(c.id);
      knownMat += rem;
    }
    // 全体残り教材数へ正規化（アンカー外の消化を日平均の構成で帰属）
    const target = args.remainingMat.get(d);
    if (target !== undefined && knownMat > 0) sec *= target / knownMat;
    out.set(d, sec);
  }
  return out;
}

/** 教科別passed履歴の隣接日差分 × 教科別秒/教材 → 日別推定秒。
 *  隣接しない日の差分は日割り不明なのでスキップ（誤帰属を作らない）。 */
export function estimateDailyByCourseDelta(
  cph: Record<string, Record<string, number>>,
  conv: { byCourse: Map<number, number>; global: number | null }
): Record<string, number> {
  const out: Record<string, number> = {};
  const dates = Object.keys(cph).sort();
  const nextDayOf = (iso: string): string => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i];
    const p = dates[i - 1];
    if (nextDayOf(p) !== d) continue; // 隣接日のみ（間の空白日へ按分しない）
    let sec = 0;
    const cur = cph[d];
    const prev = cph[p];
    for (const [cid, val] of Object.entries(cur)) {
      const diff = Math.max(0, val - (prev[cid] ?? 0));
      if (diff > 0) sec += diff * (conv.byCourse.get(Number(cid)) ?? conv.global ?? 0);
    }
    if (sec > 0) out[d] = sec;
  }
  return out;
}
