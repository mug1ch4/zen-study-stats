// 学習時間データの統合パイプライン（推移タブ・予測タブ共用）。
// 実測（アクティブタイム）を軸に、受験記録推定・教科別推定・LA×較正値で欠けを埋める。
// 各層の性質と統合規則（max/min）は learningCard での経緯と studyTimeEst.ts を参照。
import { getStudyTime, getStudyTimeHours } from './studyTime';
import { getResultLog, getChapterSkels } from './resultLog';
import { getWorkTimes, getCoursePassedHistory, type WorkTimes, type CoursePassedHistory } from './history';
import { getCachedCourseVolumes } from './courseStats';
import { interpolateMovieEvents } from './movieInterp';
import {
  estimateDailyStudySeconds,
  estimateHourlyStudySeconds,
  calibrateSecPerLA,
  totalRetroSeconds,
  secPerMaterialByCourse,
  estimateDailyByCourseDelta,
} from './studyTimeEst';
import type { ResultEntry } from './resultLog';
import { parseDate, isoLocal } from './format';

export interface StudyTimeData {
  /** 日別の学習秒数（実測∨推定の統合値・zen-dayキー） */
  combined: Record<string, number>;
  /** 推定が実測を上回った日（UIで半透明・「推定」表記） */
  estSet: Set<string>;
  hoursMeasured: number[]; // 実測の時間帯分布（JST24バケット・秒）
  hoursEst: number[]; // 推定の時間帯分布
  /** 教科別 秒/教材（残り時間の換算などに使う） */
  conv: { byCourse: Map<number, number>; global: number | null };
}

/** 学習時間データを構築。la = 日別学習数（長期履歴＋14日窓のマージ済み）。 */
export async function computeStudyTimeData(la: { date: string; amount: number }[], todayISO: string): Promise<StudyTimeData> {
  const [st, rlogT, skelsT, wtT, hoursMeasured, cphT, volsT] = await Promise.all([
    getStudyTime().catch(() => ({}) as Record<string, number>),
    getResultLog().catch(() => [] as ResultEntry[]),
    getChapterSkels().catch(() => ({})),
    getWorkTimes().catch(() => ({}) as WorkTimes),
    getStudyTimeHours().catch(() => new Array(24).fill(0) as number[]),
    getCoursePassedHistory().catch(() => [] as CoursePassedHistory),
    getCachedCourseVolumes().catch(() => []),
  ]);
  const movT = interpolateMovieEvents(skelsT, rlogT);
  const estDaily = estimateDailyStudySeconds(rlogT, movT, wtT);
  const laMap = new Map(la.map((p) => [p.date, p.amount]));
  const secPerLA = calibrateSecPerLA(la, st, estDaily, totalRetroSeconds(skelsT, rlogT, wtT), todayISO);
  const conv = secPerMaterialByCourse(
    volsT.map((v) => ({ id: v.id, totalMaterials: v.totalMaterials, movieSeconds: v.total.movieSeconds, testCount: v.total.testCount, reportCount: v.total.reportCount })),
    wtT
  );
  const cphMap: Record<string, Record<string, number>> = {};
  for (const p of cphT) cphMap[p.date] = p.byCourse as unknown as Record<string, number>;
  const estCourse = estimateDailyByCourseDelta(cphMap, conv);
  const combined: Record<string, number> = {};
  const estSet = new Set<string>();
  const allDays = new Set([...Object.keys(st), ...Object.keys(estDaily), ...Object.keys(estCourse), ...(secPerLA ? laMap.keys() : [])]);
  for (const d of allDays) {
    const m = st[d] ?? 0;
    const e = estDaily[d] ?? 0;
    const ec = estCourse[d] ?? 0;
    const f = secPerLA ? (laMap.get(d) ?? 0) * secPerLA : 0;
    // 学習量ベースの2推定は逆方向に偏る: 教科別（平均×件数）は短い教材を速攻した日に過大、
    // LA×較正値は当日のLA集計ラグで過小。両方あるときは min で相殺（実データ検証済み）。
    const eLearn = ec > 0 && f > 0 ? Math.min(ec, f) : Math.max(ec, f);
    combined[d] = Math.max(m, e, eLearn);
    if (combined[d] > m) estSet.add(d);
  }
  return { combined, estSet, hoursMeasured, hoursEst: estimateHourlyStudySeconds(rlogT, movT, wtT), conv };
}

/** 直近 windowDays（昨日まで）の平均学習秒/日。記録がその窓に3日未満なら null。 */
export function recentStudySecPerDay(combined: Record<string, number>, todayISO: string, windowDays = 14): number | null {
  const keys = Object.keys(combined).filter((d) => d < todayISO).sort();
  if (!keys.length) return null;
  const yest = isoLocal(new Date(parseDate(todayISO).getTime() - 86400000));
  const winStart = isoLocal(new Date(parseDate(todayISO).getTime() - windowDays * 86400000));
  const start = keys[0] > winStart ? keys[0] : winStart;
  const days = Math.round((parseDate(yest).getTime() - parseDate(start).getTime()) / 86400000) + 1;
  if (days < 3) return null;
  let sum = 0;
  for (const d of keys) if (d >= start && d <= yest) sum += combined[d];
  return sum / days;
}
