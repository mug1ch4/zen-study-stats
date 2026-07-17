import { describe, it, expect } from 'vitest';
import { zenTodayISO, zenMondayISO, parseDate, isoLocal, durationStr, shortDate } from '../src/format';

describe('5:00 AM JST 日境界', () => {
  it('JST 4:59 はまだ前日・5:00 で切替', () => {
    // Date.UTC(2026,6,17,19,59) = JST 2026-07-18 04:59
    expect(zenTodayISO(Date.UTC(2026, 6, 17, 19, 59))).toBe('2026-07-17');
    // JST 2026-07-18 05:00 ちょうど
    expect(zenTodayISO(Date.UTC(2026, 6, 17, 20, 0))).toBe('2026-07-18');
  });
  it('端末TZに依存しない（同一エポックなら同一結果）', () => {
    const t = Date.UTC(2026, 0, 1, 0, 0); // JST 1/1 09:00 → 2026-01-01
    expect(zenTodayISO(t)).toBe('2026-01-01');
  });
});

describe('zenMondayISO（週境界）', () => {
  it('水曜 → その週の月曜', () => {
    // 2026-07-15 は水曜。JST正午のエポック。
    const wed = Date.UTC(2026, 6, 15, 3, 0); // JST 12:00
    expect(zenMondayISO(wed)).toBe('2026-07-13');
  });
  it('月曜 4:59 は前週の月曜（5:00境界）', () => {
    // 2026-07-13(月) JST 04:59 → 学習上はまだ 07-12(日) → 週は 07-06(月)
    expect(zenMondayISO(Date.UTC(2026, 6, 12, 19, 59))).toBe('2026-07-06');
    expect(zenMondayISO(Date.UTC(2026, 6, 12, 20, 0))).toBe('2026-07-13');
  });
});

describe('日付・表示整形', () => {
  it('parseDate/isoLocal ラウンドトリップ', () => {
    expect(isoLocal(parseDate('2026-03-09'))).toBe('2026-03-09');
  });
  it('durationStr', () => {
    expect(durationStr(3665)).toBe('1h1m');
    expect(durationStr(90)).toBe('2m'); // 四捨五入
    expect(durationStr(0)).toBe('0m');
  });
  it('shortDate', () => {
    expect(shortDate('2026-12-05')).toBe('12/5');
  });
});
