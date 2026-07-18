// 学習数データから表示用の指標を導出する（純関数・テストしやすい単位）。
import type { LearningAmounts, DailyAmount } from './api';
import { weekdayIndex } from './format';

export interface LearningKpis {
  total: number; // 累計 (API値)
  average2w: number; // 2週平均 (API値)
  maxDay: { value: number; date: string } | null;
  studiedDays: number; // 直近14日で amount>0 の日数
  windowDays: number; // 記録のある窓の日数(=amount非null件数)
  streak: number; // 末尾から連続で amount>0 の日数
}

export interface WeekdayStat {
  weekday: number; // 0=日..6=土
  avg: number | null; // 平均(サンプルが無ければ null)
  samples: { date: string; amount: number }[];
}

export function computeKpis(d: LearningAmounts): LearningKpis {
  const days = d.daily_amount;
  let maxDay: LearningKpis['maxDay'] = null;
  let studiedDays = 0;
  let windowDays = 0;
  for (const day of days) {
    if (day.amount === null) continue;
    windowDays++;
    if (day.amount > 0) studiedDays++;
    if (!maxDay || day.amount > maxDay.value) maxDay = { value: day.amount, date: day.date };
  }
  return {
    total: d.total_amount,
    average2w: d.average_amount,
    maxDay,
    studiedDays,
    windowDays,
    streak: computeStreak(days),
  };
}

/** 末尾(最新日)から遡り、amount>0 が連続する日数（＝「生存中の連続」）。null/0 で途切れる。
 *  今日未学習でも昨日までの連続を返す（今日開いた時点で 0日と出る違和感の修正・v0.3.1）。
 *  ※14日窓データ(learning_amounts)の配列末尾基準。全期間・カレンダー基準の streakInfo(deriveHistory)
 *   とは「アンカーが実日付か配列末尾か」で役割が異なるため、あえて別実装（重複ではない）。 */
export function computeStreak(days: DailyAmount[]): number {
  let i = days.length - 1;
  if (i >= 0 && !((days[i].amount ?? 0) > 0)) i--;
  let streak = 0;
  for (; i >= 0; i--) {
    const a = days[i].amount;
    if (a !== null && a > 0) streak++;
    else break;
  }
  return streak;
}

/** 曜日別の平均（2週間ぶんなので各曜日おおむね2サンプル）。 */
export function computeWeekdayStats(d: LearningAmounts): WeekdayStat[] {
  const buckets: { date: string; amount: number }[][] = Array.from({ length: 7 }, () => []);
  for (const day of d.daily_amount) {
    if (day.amount === null) continue;
    buckets[weekdayIndex(day.date)].push({ date: day.date, amount: day.amount });
  }
  return buckets.map((samples, weekday) => ({
    weekday,
    samples,
    avg: samples.length ? samples.reduce((s, x) => s + x.amount, 0) / samples.length : null,
  }));
}
