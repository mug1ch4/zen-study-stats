// 締切リスク判定（純関数）: 月次レポートの締切別・章内訳 × 教科別ペース から
// 「このペースだと締切に間に合わないかもしれない教科」を導出する。
// ペースは教科全体の passed 差分（coursePace）による近似。免除(exempted)章は対象外。
import type { MonthlyReportChapter } from './api';
import type { CoursePace } from './coursePace';
import { courseEtaDays } from './coursePace';

export type RiskLevel = 'late' | 'tight' | 'ok' | 'unknown';

export interface DeadlineGroupInput {
  daysLeft: number; // この締切まで（当日=0・負=経過）
  chapters: MonthlyReportChapter[];
}

export interface CourseDeadlineRisk {
  courseId: number;
  title: string;
  remaining: number; // この月の締切ぶんの残り教材数（免除除く・全締切合算）
  perWeek: number | null; // 教科別ペース（教材/週）。null=蓄積不足
  etaDays: number | null; // 現在ペースでの完了見込み日数。null=直近進んでいない
  daysLeft: number; // 判定の決め手になった（最も厳しい）締切までの日数
  risk: RiskLevel;
}

// ペースの最低サンプル数（隣接日ペア）。これ未満は「蓄積中」として判定しない。
const MIN_SAMPLES = 2;
// ETAが締切までの日数の7割を超えたら「余裕なし」。
const TIGHT_RATIO = 0.7;

const levelOrder: Record<RiskLevel, number> = { late: 0, tight: 1, unknown: 2, ok: 3 };

/** 締切グループ群から教科別のリスクを判定。危ない順（late→tight→unknown→ok・残多い順）。 */
export function computeCourseDeadlineRisks(
  groups: DeadlineGroupInput[],
  paces: Map<number, CoursePace>
): CourseDeadlineRisk[] {
  // 教科ごとに (daysLeft, 残教材) を締切順で集める
  const byCourse = new Map<number, { title: string; items: { daysLeft: number; remaining: number }[] }>();
  for (const g of [...groups].sort((a, b) => a.daysLeft - b.daysLeft)) {
    for (const ch of g.chapters) {
      if (ch.exempted) continue;
      const rem = Math.max(0, ch.total_count - ch.passed_count);
      if (rem <= 0) continue;
      const cur = byCourse.get(ch.course_id) ?? { title: ch.course_title, items: [] };
      const last = cur.items[cur.items.length - 1];
      if (last && last.daysLeft === g.daysLeft) last.remaining += rem;
      else cur.items.push({ daysLeft: g.daysLeft, remaining: rem });
      byCourse.set(ch.course_id, cur);
    }
  }

  const out: CourseDeadlineRisk[] = [];
  for (const [id, c] of byCourse) {
    const totalRem = c.items.reduce((a, x) => a + x.remaining, 0);
    const pace = paces.get(id);
    if (!pace || pace.samples < MIN_SAMPLES) {
      out.push({ courseId: id, title: c.title, remaining: totalRem, perWeek: null, etaDays: null, daysLeft: c.items[0]?.daysLeft ?? 0, risk: 'unknown' });
      continue;
    }
    // 各締切ごとに「そこまでの累積残り」を現在ペースで消化できるか（最も厳しい締切で判定）
    let worst: { level: RiskLevel; daysLeft: number; eta: number | null } | null = null;
    let cum = 0;
    for (const item of c.items) {
      cum += item.remaining;
      const eta = courseEtaDays(cum, pace.perDay);
      const level: RiskLevel = eta === null || eta > item.daysLeft ? 'late' : eta > item.daysLeft * TIGHT_RATIO ? 'tight' : 'ok';
      if (!worst || levelOrder[level] < levelOrder[worst.level]) worst = { level, daysLeft: item.daysLeft, eta };
    }
    if (!worst) continue; // items が空になることは無いが型上の防御
    out.push({ courseId: id, title: c.title, remaining: totalRem, perWeek: pace.perWeek, etaDays: worst.eta, daysLeft: worst.daysLeft, risk: worst.level });
  }
  return out.sort((a, b) => levelOrder[a.risk] - levelOrder[b.risk] || b.remaining - a.remaining);
}
