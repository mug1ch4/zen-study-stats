import { describe, it, expect } from 'vitest';
import { evaluateCalibration } from '../src/calibration';

const TOTAL = 1000;

describe('予測の的中率（キャリブレーション）', () => {
  it('帯の内側 → coverage 1', () => {
    // 7/1 の予測: 7日後の残数帯 [80,120]・P50=100。7/8 の実績 passed=900 → 残100（帯内・P50一致）
    const cal = evaluateCalibration(
      { '2026-07-01': { remaining: 150, cp: [{ off: 7, p15: 80, p50: 100, p85: 120 }] } },
      [{ date: '2026-07-08', passed: 900 }],
      TOTAL
    );
    expect(cal.n).toBe(1);
    expect(cal.coverage).toBe(1);
    expect(cal.bias).toBe('balanced');
  });
  it('実績が予測より遅い（残多い）→ 楽観バイアス', () => {
    const cal = evaluateCalibration(
      { '2026-07-01': { remaining: 150, cp: [{ off: 7, p15: 80, p50: 100, p85: 120 }] } },
      [{ date: '2026-07-08', passed: 860 }], // 残140 > P85 → 帯外・P50より+40
      TOTAL
    );
    expect(cal.coverage).toBe(0);
    expect(cal.bias).toBe('optimistic');
  });
  it('実績が予測より速い → 悲観バイアス', () => {
    const cal = evaluateCalibration(
      { '2026-07-01': { remaining: 150, cp: [{ off: 7, p15: 80, p50: 100, p85: 120 }] } },
      [{ date: '2026-07-08', passed: 950 }], // 残50 < P15
      TOTAL
    );
    expect(cal.bias).toBe('pessimistic');
  });
  it('スナップショットが無い日は検証対象外', () => {
    const cal = evaluateCalibration(
      { '2026-07-01': { remaining: 150, cp: [{ off: 7, p15: 80, p50: 100, p85: 120 }] } },
      [{ date: '2026-07-09', passed: 900 }], // 7/8 ではない
      TOTAL
    );
    expect(cal.n).toBe(0);
    expect(cal.coverage).toBeNull();
    expect(cal.bias).toBeNull();
  });
  it('複数チェックポイントの合算', () => {
    const cal = evaluateCalibration(
      {
        '2026-07-01': { remaining: 150, cp: [{ off: 7, p15: 80, p50: 100, p85: 120 }, { off: 14, p15: 30, p50: 60, p85: 90 }] },
      },
      [
        { date: '2026-07-08', passed: 900 }, // 残100 帯内
        { date: '2026-07-15', passed: 990 }, // 残10 帯外(速い)
      ],
      TOTAL
    );
    expect(cal.n).toBe(2);
    expect(cal.coverage).toBe(0.5);
  });
});
