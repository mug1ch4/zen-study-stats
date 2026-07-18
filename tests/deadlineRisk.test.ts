import { describe, it, expect } from 'vitest';
import { computeCourseDeadlineRisks, type DeadlineGroupInput } from '../src/deadlineRisk';
import type { CoursePace } from '../src/coursePace';
import type { MonthlyReportChapter } from '../src/api';

const ch = (course_id: number, title: string, total: number, passed: number, exempted = false): MonthlyReportChapter => ({
  course_id,
  chapter_id: course_id * 100 + total,
  course_title: title,
  chapter_title: `${title}の章`,
  subject_category_title: '教科',
  passed_count: passed,
  total_count: total,
  exempted,
});

const pace = (id: number, perDay: number, samples = 5): [number, CoursePace] => [id, { id, perDay, perWeek: perDay * 7, samples }];

describe('computeCourseDeadlineRisks', () => {
  it('ペースで間に合う教科は ok・間に合わない教科は late（危ない順に並ぶ）', () => {
    const groups: DeadlineGroupInput[] = [{ daysLeft: 10, chapters: [ch(1, '数学', 20, 10), ch(2, '国語', 6, 2)] }];
    // 数学: 残10 ÷ 0.5/日 = 20日 > 10日 → late。国語: 残4 ÷ 1/日 = 4日 ≤ 7日(=10×0.7) → ok
    const out = computeCourseDeadlineRisks(groups, new Map([pace(1, 0.5), pace(2, 1)]));
    expect(out.map((r) => [r.courseId, r.risk])).toEqual([[1, 'late'], [2, 'ok']]);
    expect(out[0].etaDays).toBe(20);
    expect(out[0].daysLeft).toBe(10);
  });

  it('締切ギリギリ（ETA が 7割超）は tight', () => {
    const groups: DeadlineGroupInput[] = [{ daysLeft: 10, chapters: [ch(1, '英語', 10, 2)] }];
    // 残8 ÷ 1/日 = 8日。10日以内だが 7日(=10×0.7) 超 → tight
    const out = computeCourseDeadlineRisks(groups, new Map([pace(1, 1)]));
    expect(out[0].risk).toBe('tight');
  });

  it('ペース未蓄積（samples不足/記録なし）は unknown', () => {
    const groups: DeadlineGroupInput[] = [{ daysLeft: 14, chapters: [ch(1, '理科', 5, 0), ch(2, '社会', 5, 0)] }];
    const out = computeCourseDeadlineRisks(groups, new Map([pace(1, 1, 1)])); // samples=1 は不足
    expect(out.every((r) => r.risk === 'unknown')).toBe(true);
    expect(out[0].perWeek).toBeNull();
  });

  it('直近進んでいない（perDay=0）は late・ETA は null', () => {
    const groups: DeadlineGroupInput[] = [{ daysLeft: 14, chapters: [ch(1, '情報', 5, 1)] }];
    const out = computeCourseDeadlineRisks(groups, new Map([pace(1, 0)]));
    expect(out[0].risk).toBe('late');
    expect(out[0].etaDays).toBeNull();
  });

  it('免除(exempted)章と完了済み章は残りに数えない', () => {
    const groups: DeadlineGroupInput[] = [
      { daysLeft: 10, chapters: [ch(1, '数学', 10, 10), ch(1, '数学', 8, 0, true), ch(1, '数学', 4, 2)] },
    ];
    const out = computeCourseDeadlineRisks(groups, new Map([pace(1, 1)]));
    expect(out).toHaveLength(1);
    expect(out[0].remaining).toBe(2);
    expect(out[0].risk).toBe('ok');
  });

  it('複数締切: 早い締切までの累積で最も厳しい判定を採用', () => {
    // 早い締切(5日後)に残5・遅い締切(20日後)にさらに残5。1/日 → 5日分は eta=5 > 3.5(=5×0.7) → tight、
    // 累積10は eta=10 ≤ 14(=20×0.7) → ok。最悪の tight・daysLeft=5 を採用する。
    const groups: DeadlineGroupInput[] = [
      { daysLeft: 20, chapters: [ch(1, '数学', 10, 5)] },
      { daysLeft: 5, chapters: [ch(1, '数学', 8, 3)] },
    ];
    const out = computeCourseDeadlineRisks(groups, new Map([pace(1, 1)]));
    expect(out[0].risk).toBe('tight');
    expect(out[0].daysLeft).toBe(5);
    expect(out[0].remaining).toBe(10);
  });

  it('全章完了の教科はリストに出ない', () => {
    const groups: DeadlineGroupInput[] = [{ daysLeft: 10, chapters: [ch(1, '体育', 5, 5)] }];
    expect(computeCourseDeadlineRisks(groups, new Map([pace(1, 1)]))).toHaveLength(0);
  });
});
