import { describe, it, expect } from 'vitest';
import { pickBaselineBefore, pickWeekBaseline, resolveWeekBase } from '../src/history';

const series = [
  { date: '2026-07-08', passed: 100 },
  { date: '2026-07-10', passed: 110 },
  { date: '2026-07-15', passed: 130 },
];

describe('pickBaselineBefore（週始点の復元）', () => {
  it('週開始より前の最後のスナップ値を返す', () => {
    expect(pickBaselineBefore(series, '2026-07-12')).toBe(110);
  });
  it('週開始当日のスナップは含めない（前日まで）', () => {
    expect(pickBaselineBefore(series, '2026-07-15')).toBe(110);
    expect(pickBaselineBefore(series, '2026-07-16')).toBe(130);
  });
  it('前のスナップが無ければ null', () => {
    expect(pickBaselineBefore(series, '2026-07-08')).toBeNull();
    expect(pickBaselineBefore([], '2026-07-12')).toBeNull();
  });
});

describe('pickWeekBaseline（フォールバック付き週始点）', () => {
  it('週開始前のスナップがあればそれを使う', () => {
    expect(pickWeekBaseline(series, '2026-07-12')).toBe(110);
  });
  it('週開始前が無ければ今週最初のスナップへフォールバック（記録開始が今週のケース）', () => {
    // 記録が 7/15 開始・週開始 7/12 → 前スナップ無し → 7/15 の初回値 130 を始点に
    const thisWeekOnly = [{ date: '2026-07-15', passed: 130 }, { date: '2026-07-17', passed: 160 }];
    expect(pickWeekBaseline(thisWeekOnly, '2026-07-12')).toBe(130);
  });
  it('スナップ皆無なら null', () => {
    expect(pickWeekBaseline([], '2026-07-12')).toBeNull();
  });
});

describe('resolveWeekBase（週始点のLA帰属）', () => {
  it('LA推定なし: 従来どおり下界（前週末スナップ）', () => {
    expect(resolveWeekBase(255, 231, null)).toBe(231);
  });
  it('週境界前の拡張外消化を今週に誤算入しない（日曜朝・今週LA≈0 → 始点=現在値）', () => {
    // 土曜スナップ231 → 深夜(5:00前)に他環境で+24 → 日曜朝 passed=255・今週LAぶん推定0
    expect(resolveWeekBase(255, 231, 0)).toBe(255);
  });
  it('週の途中の拡張外消化は今週に算入する（今週LAぶん推定=ギャップ → 始点=前週末スナップ）', () => {
    // 土曜231 → 日〜火にスマホで+50 → 水曜 passed=281・今週LAぶん推定50
    expect(resolveWeekBase(281, 231, 50)).toBe(231);
  });
  it('クランプ: 推定が下界を下回っても前週末スナップより下げない・現在値より上げない', () => {
    expect(resolveWeekBase(281, 231, 100)).toBe(231); // est=181 < 231 → 231
    expect(resolveWeekBase(255, 231, -5)).toBe(255); // 負の推定は0扱い → 255
  });
  it('スナップ無し（導入初週）: 下界=現在値からLAぶんだけ遡る', () => {
    expect(resolveWeekBase(100, null, 30)).toBe(100); // 下界=current=100 が勝つ（過大計上しない）
  });
});
