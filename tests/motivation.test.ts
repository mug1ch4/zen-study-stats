import { describe, it, expect } from 'vitest';
import { motivationNudges } from '../src/motivation';

const baseCtx = (over: Partial<Parameters<typeof motivationNudges>[0]> = {}) => ({
  today: new Date('2026-07-15T12:00:00'),
  todayAmount: 0,
  series: [],
  streak: { current: 5, longest: 9, todayDone: false },
  totalMaterials: 100,
  passedMaterials: 40,
  courses: [{ title: '数学', total: 50, passed: 20 }],
  hour: { study: new Array(24).fill(0), visit: new Array(24).fill(0) },
  nearChapter: null,
  ...over,
});

describe('motivationNudges: 全教材完了時の短絡', () => {
  it('remaining=0 なら祝福1件のみ（継続促し文言を出さない）', () => {
    const n = motivationNudges(baseCtx({ passedMaterials: 100, courses: [{ title: '数学', total: 50, passed: 50 }] }));
    expect(n).toHaveLength(1);
    expect(n[0].text).toContain('完了しました');
    expect(n.some((x) => x.text.includes('この調子で'))).toBe(false);
    expect(n.some((x) => x.text.includes('1件でも進めれば'))).toBe(false);
  });
  it('未完了なら通常ナッジが出る', () => {
    const n = motivationNudges(baseCtx());
    expect(n.length).toBeGreaterThan(0);
    expect(n.some((x) => x.text.includes('完了しました'))).toBe(false);
  });
  it('教材0（データ未取得）では完了扱いにしない', () => {
    const n = motivationNudges(baseCtx({ totalMaterials: 0, passedMaterials: 0, courses: [] }));
    expect(n.some((x) => x.text.includes('全0教材'))).toBe(false);
  });
});
