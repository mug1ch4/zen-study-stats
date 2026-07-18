import { describe, it, expect } from 'vitest';
import { reportDeadlineStatus, updateDeadlineOutcomes, deadlineAdherence, type MonthDeadline, type DeadlineOutcomes } from '../src/deadlines';

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

describe('updateDeadlineOutcomes / deadlineAdherence（観測ベースの締切遵守率）', () => {
  it('初見で既に締切超過の月は記録しない（導入前・転入前の締切を0%と断じない）', () => {
    // 7/20 時点で 6月・7月の締切(6/15・7/15)は過去 → 観測できていないので対象外
    const { next, changed } = updateDeadlineOutcomes({}, months([[2026, 6, 6, 1], [2026, 7, 7, 2], [2026, 8, 10, 2]]), NOW);
    expect(Object.keys(next)).toEqual(['2026-8']); // 未来の8月だけ観測開始
    expect(changed).toBe(true);
    expect(deadlineAdherence(next).pastTotal).toBe(0); // 凍結済みが無い＝遵守率の対象なし
  });
  it('締切前に観測 → またいだ時点で凍結され、締切後の進捗は含めない', () => {
    // 8/10 時点: 8月(締切8/15)を残2で観測
    const t0 = Date.UTC(2026, 7, 10, 3, 0);
    let o: DeadlineOutcomes = updateDeadlineOutcomes({}, months([[2026, 8, 10, 8]]), t0).next;
    // 8/20 時点: サマリ上は完了(10/10)に見えても、凍結値は締切前の 8/10
    const t1 = Date.UTC(2026, 7, 20, 3, 0);
    o = updateDeadlineOutcomes(o, months([[2026, 8, 10, 10]]), t1).next;
    expect(o['2026-8'].frozen).toBe(true);
    expect(o['2026-8'].passed).toBe(8);
    const adh = deadlineAdherence(o);
    expect(adh.pastTotal).toBe(1);
    expect(adh.pastMet).toBe(0); // 締切後に終わらせても met にはならない
  });
  it('締切前に完了を観測していれば met', () => {
    const t0 = Date.UTC(2026, 7, 14, 3, 0); // 締切前日に 10/10 を観測
    let o: DeadlineOutcomes = updateDeadlineOutcomes({}, months([[2026, 8, 10, 10]]), t0).next;
    const t1 = Date.UTC(2026, 7, 20, 3, 0);
    o = updateDeadlineOutcomes(o, months([[2026, 8, 10, 10]]), t1).next;
    const adh = deadlineAdherence(o);
    expect(adh.pastTotal).toBe(1);
    expect(adh.pastMet).toBe(1);
    expect(adh.rate).toBe(1);
  });
  it('凍結済みは以後変更されない・変化なしなら changed=false', () => {
    const t0 = Date.UTC(2026, 7, 10, 3, 0);
    let o: DeadlineOutcomes = updateDeadlineOutcomes({}, months([[2026, 8, 10, 8]]), t0).next;
    const t1 = Date.UTC(2026, 7, 20, 3, 0);
    o = updateDeadlineOutcomes(o, months([[2026, 8, 10, 10]]), t1).next;
    const again = updateDeadlineOutcomes(o, months([[2026, 8, 10, 10]]), t1);
    expect(again.changed).toBe(false);
    expect(again.next['2026-8'].passed).toBe(8);
  });
  it('total=0 の月は記録しない', () => {
    const { next } = updateDeadlineOutcomes({}, months([[2026, 8, 0, 0]]), NOW);
    expect(Object.keys(next)).toHaveLength(0);
  });
});
