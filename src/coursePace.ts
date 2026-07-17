// 教科別ペース（教科ごとの passed 履歴から消化速度と完了見込みを算出・純関数）。
// 学年ロールオーバー等で passed が減少した区間は除外（構造を仮定せず防御）。
import type { CoursePassedHistory } from './history';

const DAY = 86400000;

export interface CoursePace {
  id: number;
  perDay: number; // その教科の教材/日
  perWeek: number; // 教材/週
  samples: number; // 使った区間数（信頼度）
}

/** 直近 windowDays 内の教科別ペース。samples>=minSamples の教科のみ返す。 */
export function computeCoursePaces(history: CoursePassedHistory, windowMs = 28 * DAY, nowMs = 0): Map<number, CoursePace> {
  const out = new Map<number, CoursePace>();
  if (history.length < 2) return out;
  const now = nowMs || new Date(history[history.length - 1].date + 'T12:00:00').getTime();
  // 各教科ごとに (date, passed) 系列を組み、隣接差分から消化/日を平均
  const ids = new Set<number>();
  for (const h of history) for (const k of Object.keys(h.byCourse)) ids.add(+k);

  for (const id of ids) {
    const pts = history
      .filter((h) => id in h.byCourse)
      .map((h) => ({ t: new Date(h.date + 'T12:00:00').getTime(), passed: h.byCourse[id] }))
      .filter((p) => now - p.t <= windowMs);
    if (pts.length < 2) continue;
    let delta = 0;
    let days = 0;
    let samples = 0;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      if (cur.passed < prev.passed) continue; // リセット/入替 → 除外
      const gap = Math.max(1, Math.round((cur.t - prev.t) / DAY));
      delta += cur.passed - prev.passed;
      days += gap;
      samples++;
    }
    if (samples < 1 || days <= 0) continue;
    const perDay = delta / days;
    out.set(id, { id, perDay, perWeek: perDay * 7, samples });
  }
  return out;
}

/** ペースと残りから完了見込み日数。perDay<=0 は null（このペースでは終わらない）。 */
export function courseEtaDays(remaining: number, perDay: number): number | null {
  if (remaining <= 0) return 0;
  if (perDay <= 0) return null;
  return Math.ceil(remaining / perDay);
}
