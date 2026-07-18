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
  year: number; // 月次詳細API(report_progresses/monthly)の参照に使う
  month: number;
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
        year: m.year,
        month: m.month,
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

// --- 締切アウトカム（遵守率の唯一の正しい源） ---
// 「拡張が有効な状態で締切をまたいだ月」だけを評価するための記録。
// 締切前に観測できた月の (passed,total) を更新し続け、締切を過ぎた時点の値で凍結する。
// 導入前・転入前に既に過ぎていた締切は記録が無い＝自動的に対象外（後から完了しても遡って met にならない）。
export interface DeadlineOutcome {
  deadline: string; // ISO
  total: number;
  passed: number; // 締切前の最終観測値（凍結後は不変）
  frozen?: boolean; // 締切をまたいで確定済み
}
export type DeadlineOutcomes = Record<string, DeadlineOutcome>; // key: "YYYY-M"

/** 月次サマリからアウトカムを更新（純関数）。凍結済みは触らない。初見で既に締切超過の月は記録しない。 */
export function updateDeadlineOutcomes(cur: DeadlineOutcomes, months: MonthDeadline[], nowMs: number): { next: DeadlineOutcomes; changed: boolean } {
  const next: DeadlineOutcomes = { ...cur };
  let changed = false;
  for (const m of months) {
    const d = new Date(m.deadline);
    if (isNaN(d.getTime()) || m.total <= 0) continue;
    const key = `${m.year}-${m.month}`;
    const prev = next[key];
    if (prev?.frozen) continue; // 確定済み
    if (d.getTime() > nowMs) {
      // 締切前: 最新値で更新（観測の証跡）
      if (!prev || prev.passed !== m.passed || prev.total !== m.total) {
        next[key] = { deadline: m.deadline, total: m.total, passed: m.passed };
        changed = true;
      }
    } else if (prev) {
      // 締切をまたいだ: 締切前の最終観測値で凍結（またいだ後の進捗は含めない）
      next[key] = { ...prev, frozen: true };
      changed = true;
    }
    // prev が無く締切も過ぎている＝観測できていない月 → 対象外（何も記録しない）
  }
  return { next, changed };
}

export interface DeadlineAdherence {
  pastTotal: number; // 観測下で締切をまたいだ月の数
  pastMet: number; // うち期限内に全章完了できた数
  rate: number; // 遵守率（0〜1）
}

/** 締切遵守率: 凍結済みアウトカム（＝拡張が観測していた締切）だけで算出。 */
export function deadlineAdherence(outcomes: DeadlineOutcomes): DeadlineAdherence {
  const past = Object.values(outcomes).filter((o) => o.frozen);
  const pastMet = past.filter((o) => o.passed >= o.total && o.total > 0).length;
  return { pastTotal: past.length, pastMet, rate: past.length ? pastMet / past.length : 0 };
}
