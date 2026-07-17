import { describe, it, expect } from 'vitest';
import { computeUnlocked, ACHIEVEMENTS, type AchInput } from '../src/achievements';

const base: AchInput = {
  longestStreak: 0, studiedDays: 0, passedMaterials: 0, totalMaterials: 1500,
  completedCourses: 0, totalCourses: 9,
};

describe('実績バッジの判定', () => {
  it('初期状態は何も解除されない', () => {
    expect(computeUnlocked(base)).toEqual([]);
  });
  it('連続7日 → streak3/7 のみ（14は未達）', () => {
    const ids = computeUnlocked({ ...base, longestStreak: 7 });
    expect(ids).toContain('streak3');
    expect(ids).toContain('streak7');
    expect(ids).not.toContain('streak14');
  });
  it('教材320・全体21% → mat50/100/300 は解除・pct25 は未達', () => {
    const ids = computeUnlocked({ ...base, passedMaterials: 320 });
    expect(ids).toEqual(expect.arrayContaining(['mat50', 'mat100', 'mat300']));
    expect(ids).not.toContain('mat500');
    expect(ids).not.toContain('pct25');
  });
  it('完走は total>0 が必要（0/0 で誤解除しない）', () => {
    expect(computeUnlocked({ ...base, totalMaterials: 0, passedMaterials: 0 })).not.toContain('pct100');
    const ids = computeUnlocked({ ...base, totalMaterials: 100, passedMaterials: 100 });
    expect(ids).toContain('pct100');
    expect(ids).toContain('pct25');
  });
  it('全教科完了は totalCourses>0 が必要', () => {
    expect(computeUnlocked({ ...base, totalCourses: 0, completedCourses: 0 })).not.toContain('courseAll');
    expect(computeUnlocked({ ...base, totalCourses: 3, completedCourses: 3 })).toContain('courseAll');
  });
  it('定義に重複IDが無い', () => {
    const ids = ACHIEVEMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
