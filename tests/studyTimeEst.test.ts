import { describe, it, expect } from 'vitest';
import { avgWorkMinutes, estimateDailyStudySeconds, estimateHourlyStudySeconds } from '../src/studyTimeEst';
import type { ResultEntry } from '../src/resultLog';
import type { MovieEvent } from '../src/movieInterp';
import type { WorkTimes } from '../src/history';

// JST 2026-07-15 の h時0分 の epoch秒
const at = (h: number) => Date.UTC(2026, 6, 15, h - 9) / 1000;

const entry = (over: Partial<ResultEntry>): ResultEntry =>
  ({ sectionId: 1, chapterId: 1, courseId: 2503, kind: 'test', passed: true, score: 80, totalScore: 100, firstAt: at(10), firstPassed: true, firstScore: 80, latestAt: at(10), ...over }) as ResultEntry;

const wt: WorkTimes = {
  '2503': { test: { min: 12, q: 15, n: 3 }, report: { min: 30, q: 40, n: 2 } }, // test 4分/回・report 15分/回
};

describe('avgWorkMinutes', () => {
  it('教科実測: min/n（分/回）', () => {
    expect(avgWorkMinutes(wt, 2503, 'test')).toBeCloseTo(4, 5);
    expect(avgWorkMinutes(wt, 2503, 'report')).toBeCloseTo(15, 5);
  });
  it('教科に実測が無ければ全教科平均・皆無なら既定値', () => {
    expect(avgWorkMinutes(wt, 9999, 'test')).toBeCloseTo(4, 5); // 全教科平均=同値
    expect(avgWorkMinutes({}, 9999, 'test')).toBe(5); // 既定
    expect(avgWorkMinutes({}, 9999, 'report')).toBe(15);
  });
});

describe('estimateDailyStudySeconds', () => {
  it('動画=実尺・受験=平均所要（初回/最新が別時刻なら2回ぶん）を zen-day に集計', () => {
    const entries = [
      entry({ sectionId: 1 }), // 10時 test 1回 = 4分
      entry({ sectionId: 2, firstAt: at(11), latestAt: at(13) }), // 別時刻の再受験 → 2回 = 8分
    ];
    const movies: MovieEvent[] = [{ at: at(12), courseId: 2503, len: 600, uncertaintySec: 0 }];
    const est = estimateDailyStudySeconds(entries, movies, wt);
    expect(est['2026-07-15']).toBeCloseTo(600 + 3 * 4 * 60, 5);
  });
  it('5:00前の受験は前日（zen-day）に帰属', () => {
    const est = estimateDailyStudySeconds([entry({ firstAt: at(3), latestAt: at(3) })], [], wt);
    expect(Object.keys(est)).toEqual(['2026-07-14']);
  });
});

describe('estimateHourlyStudySeconds', () => {
  it('JSTの時刻バケットへ計上（動画=完了時刻・受験=受験時刻）', () => {
    const est = estimateHourlyStudySeconds([entry({})], [{ at: at(22), courseId: 2503, len: 300, uncertaintySec: 0 }], wt);
    expect(est[10]).toBeCloseTo(240, 5); // test 4分
    expect(est[22]).toBeCloseTo(300, 5); // 動画5分
    expect(est.reduce((a, b) => a + b, 0)).toBeCloseTo(540, 5);
  });
});
