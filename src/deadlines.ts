// 月次レポート締切の状態（純関数）。report_progresses の monthly_summaries から、
// 「次の締切」「締切超過で未完」「今後の残り章」を算出する。追加リクエスト不要。
// 学業の実態は年度末一発でなく毎月の締切に追いつくリズムで、各締切が成績に関わる。

export interface MonthDeadline {
  year: number;
  month: number;
  deadline: string; // ISO
  total: number; // その月の章 総数
  passed: number; // 完了数
}

export interface NextDeadline {
  deadline: Date;
  total: number;
  passed: number;
  remaining: number; // 未完の章
  daysLeft: number; // 締切まで（当日=0）
}

export interface DeadlineStatus {
  next: NextDeadline | null; // 直近で「未完の章が残る」締切
  overdue: { deadline: Date; remaining: number }[]; // 締切を過ぎたのに未完（成績に影響）
  upcomingRemaining: number; // 今後の締切ぶんの未完章 合計
  allClear: boolean; // 締切超過も今後の残りも無い
}

const DAY = 86400000;

export function reportDeadlineStatus(months: MonthDeadline[], nowMs: number): DeadlineStatus {
  const parsed = months
    .map((m) => {
      const d = new Date(m.deadline);
      return { d, total: m.total, passed: m.passed, remaining: Math.max(0, m.total - m.passed) };
    })
    .filter((m) => !isNaN(m.d.getTime()));

  const overdue = parsed
    .filter((m) => m.d.getTime() < nowMs && m.remaining > 0)
    .sort((a, b) => a.d.getTime() - b.d.getTime())
    .map((m) => ({ deadline: m.d, remaining: m.remaining }));

  const upcoming = parsed.filter((m) => m.d.getTime() >= nowMs).sort((a, b) => a.d.getTime() - b.d.getTime());
  const nextWork = upcoming.find((m) => m.remaining > 0) ?? null;
  const next: NextDeadline | null = nextWork
    ? {
        deadline: nextWork.d,
        total: nextWork.total,
        passed: nextWork.passed,
        remaining: nextWork.remaining,
        daysLeft: Math.max(0, Math.ceil((nextWork.d.getTime() - nowMs) / DAY)),
      }
    : null;

  const upcomingRemaining = upcoming.reduce((a, m) => a + m.remaining, 0);
  return { next, overdue, upcomingRemaining, allClear: overdue.length === 0 && upcomingRemaining === 0 };
}
