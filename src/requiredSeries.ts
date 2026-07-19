// 必修の日次消化系列（正準ソース）ビルダー。設計は CALC_DESIGN.md。
// 【原則】導出のみ・保存しない／不明(null)と0を区別／出所(source)を保持／必修のみ。
// 手法の裏付け: 被覆内ゼロ推定=アクティグラフィのwear-time法・ゼロ過剰データの presumed negative。
//              MHスナップ間の整合=temporal disaggregation の pro-rata（合計の厳密一致）。
import { parseDate, isoLocal, zenTodayISO } from './format';

const DAY = 86400000;
const MAX_DAYS = 366; // 系列の最大長（1年で区切る＝メモリ/描画の上限）

export interface SeriesPoint {
  date: string; // zen-day (5:00境界)
  delta: number | null; // その日の必修消化。null=不明（0ではない）
  cum: number; // その日終了時点の必修passed（推定含む）
  source: 'observed' | 'anchor' | 'approx';
  estimated: boolean; // cum が推定（外挿/線形補間/近似）＝UIは点線
}

export interface RequiredSeries {
  points: SeriesPoint[]; // 日付昇順・範囲内の全日
  total: number;
  quality: {
    observedDays: number; // MH/ライブ由来の有効日
    anchorDays: number; // アンカー由来の有効日（イベントあり）
    presumedZeroDays: number; // 被覆窓内の推定ゼロ日（anchorDays に含めない）
    approxDays: number; // LA近似の有効日
    validDays: number; // delta!=null の日数（モンテカルロ発動判定用）
  };
  /** S=0 なのに消化がある区間（日割り不明）。ペース計算に「総量/日数」で使う。曜日統計には入れない。 */
  gapSamples: { days: number; total: number }[];
}

export interface RequiredSeriesInput {
  /** 必修passedの日次スナップ（観測・穴あり・日付昇順）。 */
  mh: { date: string; passed: number; total?: number }[];
  /** 必修の「教材がpassedになった時刻」イベント（受験アンカー＋補間動画・epoch秒）。 */
  anchorEvents: { at: number }[];
  passedNow: number;
  totalNow: number;
  todayISO: string;
  /** 近似の最後の砦（学習数=必修+課外の合算）。MHもアンカーも無いときのみ使用。 */
  la?: { date: string; amount: number }[];
}

const addDaysISO = (iso: string, n: number): string => isoLocal(new Date(parseDate(iso).getTime() + n * DAY));
const daysBetween = (a: string, b: string): number => Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / DAY);

/** 必修の日次消化系列を構築（純関数）。 */
export function buildRequiredSeries(input: RequiredSeriesInput): RequiredSeries {
  const today = input.todayISO;
  const quality = { observedDays: 0, anchorDays: 0, presumedZeroDays: 0, approxDays: 0, validDays: 0 };
  const gapSamples: { days: number; total: number }[] = [];

  // --- §3.1 ロールオーバー境界で切断（total変化 or passed減少 より前は捨てる） ---
  let mhSeg = input.mh.filter((p) => p.date <= today);
  let rolledOver = false; // 切断が実際に起きたか（起きた場合のみ境界前のアンカーも旧課程として捨てる）
  for (let i = mhSeg.length - 1; i >= 1; i--) {
    const prev = mhSeg[i - 1];
    const cur = mhSeg[i];
    const totalChanged = prev.total !== undefined && cur.total !== undefined && prev.total !== cur.total;
    if (totalChanged || cur.passed < prev.passed) {
      mhSeg = mhSeg.slice(i);
      rolledOver = true;
      break;
    }
  }
  const boundaryDate = mhSeg.length ? mhSeg[0].date : null;

  // --- §3.2 アンカー日別Δ（未来・旧課程ぶんは捨てる） ---
  const anchorDelta = new Map<string, number>();
  for (const ev of input.anchorEvents) {
    const d = zenTodayISO(ev.at * 1000);
    if (d > today) continue;
    if (rolledOver && boundaryDate && d < boundaryDate) continue; // 学年入替前のアンカーは現行課程と比較不能
    anchorDelta.set(d, (anchorDelta.get(d) ?? 0) + 1);
  }
  const anchorDates = [...anchorDelta.keys()].sort();
  const coverFrom = anchorDates[0] ?? null;
  const coverTo = anchorDates[anchorDates.length - 1] ?? null;
  const inCoverage = (d: string): boolean => coverFrom !== null && coverTo !== null && d >= coverFrom && d <= coverTo;

  // --- チェックポイント（cum が確定している日）: MHスナップ ＋ 今日=passedNow(ライブ) ---
  const cps: { date: string; cum: number }[] = mhSeg.filter((p) => p.date < today).map((p) => ({ date: p.date, cum: p.passed }));
  cps.push({ date: today, cum: input.passedNow });

  // --- 系列範囲: min(被覆開始, 最古チェックポイント) 〜 今日。上限 MAX_DAYS ---
  let startDate = cps[0].date;
  if (coverFrom && coverFrom < startDate) startDate = coverFrom;
  if (daysBetween(startDate, today) > MAX_DAYS - 1) startDate = addDaysISO(today, -(MAX_DAYS - 1));

  const points = new Map<string, SeriesPoint>();
  const setPoint = (p: SeriesPoint): void => {
    points.set(p.date, p);
  };

  // --- LAフォールバック（§3.6）: MHが実質無く（今日ぶんのみ）アンカーも無い ---
  const noAnchors = anchorDelta.size === 0;
  const noMh = cps.length <= 1; // 今日(ライブ)しか無い
  if (noAnchors && noMh) {
    // 系列範囲はチェックポイント（=今日のみ）でなく LA の全期間（上限 MAX_DAYS）。
    const laAll = (input.la ?? []).filter((p) => p.date <= today).sort((a, b) => (a.date < b.date ? -1 : 1));
    let laStart = laAll.length ? laAll[0].date : today;
    if (daysBetween(laStart, today) > MAX_DAYS - 1) laStart = addDaysISO(today, -(MAX_DAYS - 1));
    const la = laAll.filter((p) => p.date >= laStart);
    let cum = input.passedNow;
    const rev: SeriesPoint[] = [];
    rev.push({ date: today, delta: la.find((p) => p.date === today)?.amount ?? null, cum, source: 'approx', estimated: false });
    for (let d = addDaysISO(today, -1); d >= laStart; d = addDaysISO(d, -1)) {
      const amt = la.find((p) => p.date === d)?.amount ?? null;
      cum = Math.max(0, cum - (rev[rev.length - 1].delta ?? 0));
      rev.push({ date: d, delta: amt, cum, source: 'approx', estimated: true });
    }
    const pts = rev.reverse();
    for (const p of pts) {
      if (p.delta !== null) quality.approxDays++;
    }
    quality.validDays = quality.approxDays;
    return { points: pts, total: input.totalNow, quality, gapSamples };
  }

  // --- §3.3 チェックポイント区間の整合（pro-rata benchmarking） ---
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp.date >= startDate) {
      setPoint({ date: cp.date, delta: null, cum: cp.cum, source: 'observed', estimated: false });
    }
    if (i === 0) continue;
    const prev = cps[i - 1];
    const diff = Math.max(0, cp.cum - prev.cum);
    const dayCount = daysBetween(prev.date, cp.date);
    if (dayCount <= 0) continue;
    // 区間内の日（prev.date の翌日〜cp.date）
    const dates: string[] = [];
    for (let k = 1; k <= dayCount; k++) dates.push(addDaysISO(prev.date, k));
    const S = dates.reduce((a, d) => a + (anchorDelta.get(d) ?? 0), 0);
    if (S > 0) {
      const scale = diff / S; // 合計を観測(diff)に厳密一致させる（aggregation constraint）
      let cum = prev.cum;
      for (const d of dates) {
        const a = anchorDelta.get(d) ?? 0;
        const isLast = d === cp.date;
        const delta = a > 0 ? a * scale : inCoverage(d) ? 0 : null;
        cum = isLast ? cp.cum : cum + (delta ?? 0);
        if (d < startDate) continue;
        setPoint({
          date: d,
          delta,
          cum,
          source: isLast ? 'observed' : 'anchor',
          estimated: !isLast, // チェックポイント日のみ確定・間は按分（点線）
        });
      }
    } else if (diff > 0) {
      // 日割り不明: delta=null・cum線形補間。ペースには gapSample として渡す（曜日統計を汚さない）
      gapSamples.push({ days: dayCount, total: diff });
      for (let k = 1; k <= dayCount; k++) {
        const d = dates[k - 1];
        if (d < startDate) continue;
        const isLast = d === cp.date;
        setPoint({
          date: d,
          delta: null,
          cum: Math.round(prev.cum + (diff * k) / dayCount),
          source: isLast ? 'observed' : 'anchor',
          estimated: !isLast,
        });
      }
    } else {
      // diff=0: 全日 真のゼロ（観測に裏付けられた休息）
      for (const d of dates) {
        if (d < startDate) continue;
        const isLast = d === cp.date;
        setPoint({ date: d, delta: 0, cum: cp.cum, source: isLast ? 'observed' : 'observed', estimated: !isLast });
      }
    }
  }

  // --- §3.4 最古チェックポイント以前（導入前）: アンカーΔの後方積み戻し外挿 ---
  const firstCp = cps[0];
  if (coverFrom && coverFrom < firstCp.date) {
    let cum = firstCp.cum;
    for (let d = addDaysISO(firstCp.date, -1); d >= coverFrom && d >= startDate; d = addDaysISO(d, -1)) {
      const a = anchorDelta.get(d) ?? 0;
      const delta = a > 0 ? a : inCoverage(d) ? 0 : null;
      setPoint({ date: d, delta, cum: Math.max(0, cum), source: 'anchor', estimated: true });
      cum = Math.max(0, cum - a);
    }
  }

  // --- 出力整形・品質集計 ---
  const pts = [...points.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const p of pts) {
    if (p.delta === null) continue;
    quality.validDays++;
    if (p.source === 'observed') quality.observedDays++;
    else if (p.source === 'approx') quality.approxDays++;
    else if (p.delta === 0) quality.presumedZeroDays++;
    else quality.anchorDays++;
  }
  return { points: pts, total: input.totalNow, quality, gapSamples };
}

/** 系列の直近 windowDays のペース（教材/日）。cum差分ベース（null日も日数に含む＝正しい平均）。 */
export function seriesRecentPace(series: RequiredSeries, windowDays = 28): number | null {
  const pts = series.points;
  if (pts.length < 2) return null;
  const end = pts[pts.length - 1];
  const startIdx = pts.findIndex((p) => daysBetween(p.date, end.date) <= windowDays);
  if (startIdx < 0 || startIdx >= pts.length - 1) return null;
  const start = pts[startIdx];
  const days = daysBetween(start.date, end.date);
  if (days <= 0) return null;
  const diff = end.cum - start.cum;
  return diff >= 0 ? diff / days : null;
}
