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

// 本家 /my_course 準拠の「レポート締切」1件分。daysLeft: +=あとN日 / 負=N日経過。
export interface DeadlineItem {
  deadline: Date;
  total: number;
  passed: number;
  remaining: number; // 未完の章
  daysLeft: number; // 締切まで（当日=0・負=経過）
  overdue: boolean; // 締切を過ぎている
}

export interface DeadlineStatus {
  /** 本家「優先するレポート」= 締切超過(未完) ＋ 直近の未完締切 を月ごとに（締切順）。 */
  priority: DeadlineItem[];
  /** 本家「今後のレポート」= それ以降の未完締切（締切順）。 */
  upcoming: DeadlineItem[];
  next: DeadlineItem | null; // 直近で未完が残る締切（priority 内の最初の未来分）
  overdue: DeadlineItem[]; // 締切超過で未完（成績に影響）
  upcomingRemaining: number; // priority＋upcoming の未完章 合計
  allClear: boolean; // 未完の締切が一切無い
}

const DAY = 86400000;

export function reportDeadlineStatus(months: MonthDeadline[], nowMs: number): DeadlineStatus {
  const items: DeadlineItem[] = months
    .map((m) => {
      const d = new Date(m.deadline);
      return {
        deadline: d,
        total: m.total,
        passed: m.passed,
        remaining: Math.max(0, m.total - m.passed),
        daysLeft: Math.ceil((d.getTime() - nowMs) / DAY),
        overdue: d.getTime() < nowMs,
      };
    })
    .filter((m) => !isNaN(m.deadline.getTime()))
    .sort((a, b) => a.deadline.getTime() - b.deadline.getTime());

  const overdue = items.filter((m) => m.overdue && m.remaining > 0);
  const upcomingWithWork = items.filter((m) => !m.overdue && m.remaining > 0);
  const next = upcomingWithWork[0] ?? null;
  // 「優先」= 超過(未完) ＋ 直近の未完締切1件。「今後」= それ以降の未完締切。
  const priority = next ? [...overdue, next] : [...overdue];
  const upcoming = upcomingWithWork.slice(next ? 1 : 0);
  const upcomingRemaining = [...priority, ...upcoming].reduce((a, m) => a + m.remaining, 0);

  return { priority, upcoming, next, overdue, upcomingRemaining, allClear: overdue.length === 0 && upcomingWithWork.length === 0 };
}

export interface DeadlineAdherence {
  pastTotal: number; // 締切を過ぎた月の数
  pastMet: number; // うち期限内に全章完了できた数
  rate: number; // 遵守率（0〜1）
}

/** 過去の締切のうち、期限までに全章完了できた割合（＝締切遵守率・分析の主眼）。 */
export function deadlineAdherence(months: MonthDeadline[], nowMs: number): DeadlineAdherence {
  const past = months
    .map((m) => ({ d: new Date(m.deadline), met: m.passed >= m.total && m.total > 0 }))
    .filter((m) => !isNaN(m.d.getTime()) && m.d.getTime() < nowMs);
  const pastMet = past.filter((m) => m.met).length;
  return { pastTotal: past.length, pastMet, rate: past.length ? pastMet / past.length : 0 };
}
