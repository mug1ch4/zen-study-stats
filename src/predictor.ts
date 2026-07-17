// 年度レポート完了予測（教材消化ベース）。
// レポート提出数は「最後にまとめて提出」型だと実態を誤るため、日々の教材消化(passed_materials)を
// 主指標にする。残レポートは補足として表示（教材を消化しきった後に提出できる想定）。
import { parseDate, isoLocal } from './format';
import { todayISO } from './history';
import { isHoliday } from './holidays';
import { simulate, type MonteCarloResult } from './montecarlo';

const DAY = 86400000;

/** 指数平滑移動平均（直近ほど重い）。単純平均より変化への追随が良い（定石）。 */
function ewma(values: number[], alpha = 0.3): number | null {
  if (!values.length) return null;
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = alpha * values[i] + (1 - alpha) * e;
  return e;
}

/** 曜日リズム＋祝日を考慮した階段状の予測カーブ（各日の消化量を曜日重みで変える）。 */
function projectCurve(remaining: number, perDay: number, weights: number[], today: Date): { date: string; remaining: number }[] {
  const pts = [{ date: isoLocal(today), remaining }];
  if (perDay <= 0) return pts;
  let rem = remaining;
  let d = today;
  let guard = 0;
  while (rem > 1e-6 && guard++ < 500) {
    d = new Date(d.getTime() + DAY);
    const iso = isoLocal(d);
    const w = isHoliday(iso) ? weights[0] : weights[d.getDay()]; // 祝日は日曜の重み
    rem = Math.max(0, rem - perDay * w);
    pts.push({ date: iso, remaining: rem });
  }
  return pts;
}

export interface PacePoint {
  date: string;
  passed: number; // その日時点の passed_materials 累計
}

export interface PredInput {
  totalMaterials: number;
  passedMaterials: number;
  materialSeries: PacePoint[];
  finalDeadline: string; // ISO（12/15）
  months: { year: number; month: number; deadline: string }[]; // バーンダウンの月次ティック用
  remainingReports: number; // 補足
  /** 教材スナップショットが貯まる前の暫定ペース（直近の学習活動 = learning_amounts の日平均, 教材/日の近似）。 */
  fallbackPerDay?: number;
  /** 各教科（コース）ごとの教材総数/完了数（教科別ボトルネック法用）。 */
  courses?: { total: number; passed: number }[];
  /** 曜日別の重み [日..土]（学習履歴の曜日平均を平均1に正規化）。予測カーブに使う。 */
  weekdayWeights?: number[];
  /** 日次消化の実測サンプル（モンテカルロ＆EWMA用）。value=その日の消化数, weekday=0..6。 */
  dailySamples?: { weekday: number; value: number }[];
}

/** 手法別の見立て。 */
export interface PaceEstimate {
  key: 'material' | 'activity' | 'average' | 'subject';
  label: string;
  perDay: number; // 0 = 未着手教科ありで到達不能
  projectedFinish: Date | null;
  onTrack: boolean;
}

export interface Prediction {
  total: number;
  passed: number;
  remaining: number;
  finalDeadline: Date;
  daysLeft: number;
  requiredPerWeek: number;
  currentPerWeek: number | null;
  paceSource: 'recent' | 'activity' | 'average' | 'none';
  projectedFinish: Date | null;
  daysVsDeadline: number | null; // +遅れ / -余裕
  onTrack: boolean;
  months: { year: number; month: number; deadline: Date }[];
  startDate: Date;
  remainingReports: number;
  estimates: PaceEstimate[]; // 手法別の見立て（併記用）
  untouchedSubjects: number; // 未着手（passed=0, total>0）の教科数
  projectionCurve: { date: string; remaining: number }[]; // 曜日/祝日考慮の予測カーブ（MC無し時のフォールバック）
  montecarlo: MonteCarloResult | null; // モンテカルロ（確率・パーセンタイル帯）
  pOnTime: number | null; // 締切に間に合う確率
  confidence: { level: 'low' | 'medium' | 'high'; days: number }; // 予測の確度（データ成熟度）
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / DAY;
}

/** 教材消化ベースの完了予測。 */
export function computePrediction(input: PredInput): Prediction {
  const today = parseDate(todayISO());
  const finalDeadline = new Date(input.finalDeadline);
  const total = input.totalMaterials;
  const passed = input.passedMaterials;
  const remaining = Math.max(0, total - passed);
  const daysLeft = Math.max(0, daysBetween(today, finalDeadline));
  const weeksLeft = daysLeft / 7;
  const requiredPerWeek = weeksLeft > 0 ? remaining / weeksLeft : Infinity;

  const months = input.months.map((m) => ({ year: m.year, month: m.month, deadline: new Date(m.deadline) }));
  const series = input.materialSeries;
  // 学習の「開始日」はAPIに存在しないため、我々の記録開始（最古スナップショット）のみを基準にできる。
  // 生涯平均は算出不能なので使わない（推定は直近ベース＋モンテカルロに寄せる）。
  const trackStart = series.length ? parseDate(series[0].date) : null;
  const startDate = trackStart ?? today;
  const trackElapsed = trackStart ? Math.max(1, daysBetween(trackStart, today)) : 0;
  const finishOf = (perDay: number): Date | null =>
    perDay > 0 && remaining > 0 ? new Date(today.getTime() + (remaining / perDay) * DAY) : remaining === 0 ? today : null;
  const est = (key: PaceEstimate['key'], label: string, perDay: number): PaceEstimate => {
    const pf = finishOf(perDay);
    return { key, label, perDay, projectedFinish: pf, onTrack: pf !== null && pf.getTime() <= finalDeadline.getTime() };
  };

  // ---- 手法別の見立てを全て算出 ----
  const estimates: PaceEstimate[] = [];

  // ① 教材消化の直近差分（スナップショットが貯まると有効・最も正確）
  const recent = series.filter((p) => daysBetween(parseDate(p.date), today) <= 28);
  let matPerDay: number | null = null;
  if (recent.length >= 2) {
    const a = recent[0], b = recent[recent.length - 1];
    const dd = daysBetween(parseDate(a.date), parseDate(b.date));
    if (dd >= 3 && b.passed >= a.passed) matPerDay = (b.passed - a.passed) / dd;
  }
  if (matPerDay && matPerDay > 0) estimates.push(est('material', '教材消化(直近)', matPerDay));

  // ② 直近の学習活動（暫定・初回から出せる）
  if (input.fallbackPerDay && input.fallbackPerDay > 0) estimates.push(est('activity', '学習活動(直近14日)', input.fallbackPerDay));

  // ③ 記録開始からの平均（我々が記録し始めてからの平均。開始日APIが無いため生涯平均は不可）
  if (trackStart && trackElapsed >= 3) {
    const consumed = series[series.length - 1].passed - series[0].passed;
    if (consumed > 0) estimates.push(est('average', '記録開始からの平均', consumed / trackElapsed));
  }

  // ④ 各教科の未着手チェック（未着手教科は現状ペースでは終わらない、を明示）
  let untouchedSubjects = 0;
  if (input.courses && input.courses.length) {
    for (const c of input.courses) {
      if (Math.max(0, c.total - c.passed) > 0 && c.passed === 0) untouchedSubjects++;
    }
    if (untouchedSubjects > 0) {
      estimates.push({ key: 'subject', label: '各教科の状況', perDay: 0, projectedFinish: null, onTrack: false });
    }
  }

  // ---- 主指標: 教材消化(直近) > 学習活動 > 開始平均 の優先 ----
  const primary = estimates.find((e) => e.key === 'material')
    ?? estimates.find((e) => e.key === 'activity')
    ?? estimates.find((e) => e.key === 'average')
    ?? null;
  const paceSource: Prediction['paceSource'] =
    primary?.key === 'material' ? 'recent' : primary?.key === 'activity' ? 'activity' : primary?.key === 'average' ? 'average' : 'none';

  // 現在ペース: EWMA(直近ほど重い)を優先、無ければ主指標の平均
  const ewmaPerDay = input.dailySamples && input.dailySamples.length
    ? ewma(input.dailySamples.map((s) => s.value))
    : null;
  const currentPerWeek = ewmaPerDay !== null ? ewmaPerDay * 7 : primary ? primary.perDay * 7 : null;

  // 曜日リズム＋祝日を考慮した予測カーブ（モンテカルロが無い時のフォールバック）
  const weights = normalizeWeekdayWeights(input.weekdayWeights);
  const detPerDay = ewmaPerDay ?? (primary ? primary.perDay : 0);
  const projectionCurve =
    remaining > 0 && detPerDay > 0
      ? projectCurve(remaining, detPerDay, weights, today)
      : [{ date: todayISO(), remaining }];

  // ---- モンテカルロ: 日次消化を曜日別にサンプリングして完了日の分布を得る ----
  let montecarlo: MonteCarloResult | null = null;
  if (remaining > 0 && input.dailySamples && input.dailySamples.length >= 5) {
    const byWd: number[][] = [[], [], [], [], [], [], []];
    const overall: number[] = [];
    for (const s of input.dailySamples) {
      byWd[s.weekday].push(s.value);
      overall.push(s.value);
    }
    const horizon = Math.ceil(daysLeft) + 21;
    montecarlo = simulate(remaining, byWd, overall, today, finalDeadline, horizon);
  }

  // 完了見込み: モンテカルロの中央値(P50)を主とし、無ければ決定カーブ
  const detFinish =
    projectionCurve.length && projectionCurve[projectionCurve.length - 1].remaining <= 1e-6
      ? parseDate(projectionCurve[projectionCurve.length - 1].date)
      : null;
  const projectedFinish = remaining === 0 ? today : montecarlo ? montecarlo.p50 : detFinish;
  const daysVsDeadline = projectedFinish ? daysBetween(finalDeadline, projectedFinish) : null;
  const pOnTime = remaining === 0 ? 1 : montecarlo ? montecarlo.pOnTime : null;
  // 間に合う判定: モンテカルロがあれば確率85%以上、無ければ見込み日が締切以内
  const onTrack =
    remaining === 0
      ? true
      : montecarlo
        ? montecarlo.pOnTime >= 0.85
        : projectedFinish !== null && projectedFinish.getTime() <= finalDeadline.getTime();

  // 予測の確度（データ成熟度）: 日次サンプル数と母数不確実性から。新規ユーザーに「暫定」を明示。
  const sampleDays = input.dailySamples?.length ?? 0;
  const relSE = montecarlo?.relSE ?? 1;
  const level: Prediction['confidence']['level'] =
    sampleDays >= 14 && relSE < 0.22 ? 'high' : sampleDays >= 6 ? 'medium' : 'low';

  return {
    total, passed, remaining, finalDeadline, daysLeft,
    requiredPerWeek, currentPerWeek, paceSource,
    projectedFinish, daysVsDeadline, onTrack, months, startDate,
    remainingReports: input.remainingReports, estimates, untouchedSubjects, projectionCurve,
    montecarlo, pOnTime,
    confidence: { level, days: sampleDays },
  };
}

/** 曜日重みを平均1に正規化。未指定/不十分なら均一。 */
function normalizeWeekdayWeights(raw?: number[]): number[] {
  if (!raw || raw.length !== 7) return [1, 1, 1, 1, 1, 1, 1];
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum <= 0) return [1, 1, 1, 1, 1, 1, 1];
  const avg = sum / 7;
  return raw.map((w) => (avg > 0 ? w / avg : 1));
}

/** 目標日までに完了させるのに必要な1日/週あたりペース。 */
export function recommendedPace(remaining: number, target: Date): { perDay: number; perWeek: number; days: number } {
  const today = parseDate(todayISO());
  const days = Math.max(1, daysBetween(today, target));
  return { perDay: remaining / days, perWeek: (remaining / days) * 7, days };
}
