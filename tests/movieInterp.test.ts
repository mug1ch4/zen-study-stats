import { describe, it, expect } from 'vitest';
import { interpolateMovieEvents, movieHours, type ChapterSkels } from '../src/movieInterp';
import type { ResultEntry } from '../src/resultLog';

const entry = (sectionId: number, firstAt: number): ResultEntry => ({
  courseId: 1,
  chapterId: 10,
  sectionId,
  kind: 'test',
  passed: true,
  score: 2,
  totalScore: 2,
  firstAt,
  firstPassed: true,
  firstScore: 2,
  latestAt: firstAt,
});

// 章: テストA(101) → 動画600秒(201) → 動画300秒(202) → テストB(102)
const skel = (movie1Passed = true): ChapterSkels => ({
  '10': {
    courseId: 1,
    sections: [
      { id: 101, kind: 'anchor', len: 0, passed: true },
      { id: 201, kind: 'movie', len: 600, passed: movie1Passed },
      { id: 202, kind: 'movie', len: 300, passed: true },
      { id: 102, kind: 'anchor', len: 0, passed: true },
    ],
  },
});

const T0 = 1_784_000_000;

describe('interpolateMovieEvents', () => {
  it('幅が動画合計と整合（合計+休憩少）→ Aの直後から順に積んだ時刻を採用', () => {
    // gap = 600+300+600(テストB解答等) = 1500秒。S=900 ≤ gap ≤ S+3600 → 採用
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 1500)]);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ at: T0 + 600, courseId: 1 });
    expect(ev[1]).toMatchObject({ at: T0 + 900 });
  });
  it('幅が明らかに超過（数時間の中断）→ 不採用', () => {
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 5 * 3600)]);
    expect(ev).toHaveLength(0);
  });
  it('幅が動画合計より短い（この窓では見ていない）→ 不採用', () => {
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 300)]);
    expect(ev).toHaveLength(0);
  });
  it('章の順序と逆順に受験 → 不採用', () => {
    const ev = interpolateMovieEvents(skel(), [entry(101, T0 + 2000), entry(102, T0)]);
    expect(ev).toHaveLength(0);
  });
  it('未視聴(passed=false)の動画は数えない（残りの動画で幅判定）', () => {
    // movie1 未視聴 → S=300。gap=600 → 300 ≤ 600 ≤ 300+3600 → movie2 のみ採用
    const ev = interpolateMovieEvents(skel(false), [entry(101, T0), entry(102, T0 + 600)]);
    expect(ev).toHaveLength(1);
    expect(ev[0].at).toBe(T0 + 300);
  });
  it('アンカーが1つしか無い章は対象外', () => {
    const ev = interpolateMovieEvents(skel(), [entry(101, T0)]);
    expect(ev).toHaveLength(0);
  });
});

describe('movieHours', () => {
  it('JSTの時間帯に集計', () => {
    // epoch T: JST = UTC+9。T0+600 の JST 時刻の時間帯に1
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 1500)]);
    const h = movieHours(ev);
    expect(h.reduce((a, b) => a + b, 0)).toBe(2);
  });
});
