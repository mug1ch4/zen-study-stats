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
  it('幅が整合 → 実行可能区間の中点に配置（前詰め＝下限補完の早バイアスを排除）', () => {
    // gap=1500秒・S=900 → slack=600(10分)・半幅300。
    // m1: 最早T0+600 → 中点T0+900 / m2: 最早T0+900 → 中点T0+1200
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 1500)]);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ at: T0 + 900, courseId: 1, uncertaintySec: 300 });
    expect(ev[1]).toMatchObject({ at: T0 + 1200, uncertaintySec: 300 });
  });
  it('幅が明らかに超過（数時間の中断）→ 不採用', () => {
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 5 * 3600)]);
    expect(ev).toHaveLength(0);
  });
  it('スラックがセッション閾値(30分)を超える → 不採用（従来の60分許容から厳格化）', () => {
    // gap = S + 40分 → slack 2400s > 1800s → reject
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 900 + 2400)]);
    expect(ev).toHaveLength(0);
  });
  it('幅が動画合計より短い（物理制約違反＝この窓では見ていない）→ 不採用', () => {
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 300)]);
    expect(ev).toHaveLength(0);
  });
  it('章の順序と逆順に受験 → 不採用', () => {
    const ev = interpolateMovieEvents(skel(), [entry(101, T0 + 2000), entry(102, T0)]);
    expect(ev).toHaveLength(0);
  });
  it('未視聴(passed=false)の動画は数えない（残りの動画で幅判定・中点配置）', () => {
    // movie1 未視聴 → S=300。gap=600 → slack=300・半幅150 → m2 中点 = T0+300+150
    const ev = interpolateMovieEvents(skel(false), [entry(101, T0), entry(102, T0 + 600)]);
    expect(ev).toHaveLength(1);
    expect(ev[0].at).toBe(T0 + 450);
    expect(ev[0].uncertaintySec).toBe(150);
  });
  it('スラック0（完全に密着した視聴）→ 誤差0で確定', () => {
    const ev = interpolateMovieEvents(skel(), [entry(101, T0), entry(102, T0 + 900)]);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ at: T0 + 600, uncertaintySec: 0 });
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
