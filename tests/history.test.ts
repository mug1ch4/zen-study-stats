import { describe, it, expect } from 'vitest';
import { pickBaselineBefore } from '../src/history';

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
