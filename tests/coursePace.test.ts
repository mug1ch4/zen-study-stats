import { describe, it, expect } from 'vitest';
import { computeCoursePaces, courseEtaDays, overallForecast } from '../src/coursePace';
import type { CoursePassedHistory } from '../src/history';

const hist = (rows: [string, Record<number, number>][]): CoursePassedHistory =>
  rows.map(([date, byCourse]) => ({ date, byCourse }));

describe('computeCoursePaces', () => {
  it('教科ごとに消化/日を算出', () => {
    // course 1: +2/日, course 2: +1/日（4日間）
    const h = hist([
      ['2026-07-01', { 1: 10, 2: 5 }],
      ['2026-07-02', { 1: 12, 2: 6 }],
      ['2026-07-03', { 1: 14, 2: 7 }],
      ['2026-07-04', { 1: 16, 2: 8 }],
    ]);
    const paces = computeCoursePaces(h, 28 * 86400000, new Date('2026-07-04T12:00:00').getTime());
    expect(paces.get(1)?.perDay).toBeCloseTo(2, 5);
    expect(paces.get(2)?.perDay).toBeCloseTo(1, 5);
    expect(paces.get(1)?.perWeek).toBeCloseTo(14, 5);
    expect(paces.get(1)?.samples).toBe(3);
  });
  it('passed が減少した区間（学年入替）は除外', () => {
    const h = hist([
      ['2026-07-01', { 1: 100 }],
      ['2026-07-02', { 1: 5 }], // リセット（新学年）→ この差分は捨てる
      ['2026-07-03', { 1: 8 }],
    ]);
    const p = computeCoursePaces(h, 28 * 86400000, new Date('2026-07-03T12:00:00').getTime()).get(1);
    expect(p?.perDay).toBeCloseTo(3, 5); // 5→8 の +3 のみ採用
    expect(p?.samples).toBe(1);
  });
  it('履歴1点以下は空', () => {
    expect(computeCoursePaces(hist([['2026-07-01', { 1: 5 }]])).size).toBe(0);
  });
});

describe('courseEtaDays', () => {
  it('残り10・ペース2/日 → 5日', () => {
    expect(courseEtaDays(10, 2)).toBe(5);
  });
  it('残り0 → 0・ペース0 → null', () => {
    expect(courseEtaDays(0, 2)).toBe(0);
    expect(courseEtaDays(10, 0)).toBeNull();
  });
});

describe('overallForecast（必修以外の完了見込み）', () => {
  const now = new Date('2026-07-04T12:00:00').getTime();
  it('全体ペースと残りから完了見込み日数', () => {
    // 全体 compDone: 15→18→21→24（+3/日）。残り30 → 10日。
    const h = hist([
      ['2026-07-01', { 1: 10, 2: 5 }],
      ['2026-07-02', { 1: 12, 2: 6 }],
      ['2026-07-03', { 1: 14, 2: 7 }],
      ['2026-07-04', { 1: 16, 2: 8 }],
    ]);
    const fc = overallForecast(h, 30, 28 * 86400000, now);
    expect(fc?.perDay).toBeCloseTo(3, 5);
    expect(fc?.perWeek).toBeCloseTo(21, 5);
    expect(fc?.etaDays).toBe(10);
    expect(fc?.samples).toBe(3);
  });
  it('減少区間は除外して純増だけで推定', () => {
    const h = hist([
      ['2026-07-02', { 1: 100 }],
      ['2026-07-03', { 1: 3 }], // リセット → 除外
      ['2026-07-04', { 1: 6 }],
    ]);
    const fc = overallForecast(h, 9, 28 * 86400000, now);
    expect(fc?.perDay).toBeCloseTo(3, 5); // 3→6 の +3 のみ
    expect(fc?.etaDays).toBe(3);
  });
  it('履歴不足は null・ペース0は etaDays null', () => {
    expect(overallForecast(hist([['2026-07-04', { 1: 5 }]]), 10, 28 * 86400000, now)).toBeNull();
    const flat = overallForecast(hist([['2026-07-03', { 1: 5 }], ['2026-07-04', { 1: 5 }]]), 10, 28 * 86400000, now);
    expect(flat?.etaDays).toBeNull(); // 全く進んでいない
  });
});
