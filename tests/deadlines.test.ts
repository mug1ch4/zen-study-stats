import { describe, it, expect } from 'vitest';
import { reportDeadlineStatus, type MonthDeadline } from '../src/deadlines';

const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-15T23:59:59+09:00`;
const NOW = Date.UTC(2026, 6, 20, 3, 0); // JST 2026-07-20 正午ごろ（7/15 は過ぎ・8/15 は未来）

const months = (spec: [number, number, number, number][]): MonthDeadline[] =>
  spec.map(([y, m, total, passed]) => ({ year: y, month: m, deadline: iso(y, m), total, passed }));

describe('reportDeadlineStatus', () => {
  it('次の締切＝未来で未完が残る最初の月', () => {
    const st = reportDeadlineStatus(months([[2026, 7, 5, 5], [2026, 8, 8, 3], [2026, 9, 6, 0]]), NOW);
    expect(st.next?.total).toBe(8);
    expect(st.next?.passed).toBe(3);
    expect(st.next?.remaining).toBe(5);
    expect(st.next && st.next.deadline.getMonth() + 1).toBe(8);
    expect(st.next?.daysLeft).toBeGreaterThan(20); // 7/20 → 8/15
  });
  it('締切超過で未完 → overdue に載る', () => {
    const st = reportDeadlineStatus(months([[2026, 7, 5, 2], [2026, 8, 8, 8]]), NOW);
    expect(st.overdue.length).toBe(1);
    expect(st.overdue[0].remaining).toBe(3);
    expect(st.next).toBeNull(); // 8月は完了済み
  });
  it('完了済みの直近締切はスキップして次の未完へ', () => {
    const st = reportDeadlineStatus(months([[2026, 8, 8, 8], [2026, 9, 6, 1]]), NOW);
    expect(st.next && st.next.deadline.getMonth() + 1).toBe(9);
  });
  it('すべて完了 → allClear', () => {
    const st = reportDeadlineStatus(months([[2026, 7, 5, 5], [2026, 8, 8, 8]]), NOW);
    expect(st.allClear).toBe(true);
    expect(st.next).toBeNull();
    expect(st.overdue.length).toBe(0);
  });
  it('upcomingRemaining は今後の未完章の合計', () => {
    const st = reportDeadlineStatus(months([[2026, 8, 8, 3], [2026, 9, 6, 1]]), NOW);
    expect(st.upcomingRemaining).toBe(5 + 5);
  });
});
