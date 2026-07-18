import { describe, it, expect } from 'vitest';
import { computeStreak } from '../src/derive';

const days = (xs: (number | null)[]) => xs.map((amount, i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, amount }));

describe('computeStreak（生存中の連続）', () => {
  it('今日(末尾)が未学習でも、昨日までの連続を返す', () => {
    expect(computeStreak(days([0, 1, 1, 1, 0]))).toBe(3); // 今日0 → 昨日までの3
    expect(computeStreak(days([1, 1, 1, null]))).toBe(3); // 今日null(記録なし)も同様
  });
  it('今日学習済みなら今日を含めて数える', () => {
    expect(computeStreak(days([0, 1, 1, 2]))).toBe(3);
  });
  it('丸1日空くと途切れ（昨日も0なら0）', () => {
    expect(computeStreak(days([1, 1, 0, 0]))).toBe(0);
    expect(computeStreak(days([1, 1, null, 0]))).toBe(0);
  });
  it('空配列・全0', () => {
    expect(computeStreak([])).toBe(0);
    expect(computeStreak(days([0, 0]))).toBe(0);
  });
});
