import { describe, it, expect } from 'vitest';
import { buildRequiredSeries, seriesRecentPace, type RequiredSeriesInput } from '../src/requiredSeries';

// JST正午の epoch秒（zen-day = 当日）
const at = (iso: string, h = 12) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), h - 9) / 1000;
const ev = (iso: string, n = 1) => Array.from({ length: n }, () => ({ at: at(iso) }));

const base = (over: Partial<RequiredSeriesInput> = {}): RequiredSeriesInput => ({
  mh: [],
  anchorEvents: [],
  passedNow: 100,
  totalNow: 200,
  todayISO: '2026-07-19',
  ...over,
});

const point = (s: ReturnType<typeof buildRequiredSeries>, date: string) => s.points.find((p) => p.date === date);

describe('buildRequiredSeries', () => {
  it('MHのみ: チェックポイント間 diff=0 は真のゼロ・末尾は今日=passedNow', () => {
    const s = buildRequiredSeries(
      base({
        mh: [
          { date: '2026-07-15', passed: 90, total: 200 },
          { date: '2026-07-17', passed: 90, total: 200 },
        ],
        passedNow: 100,
      })
    );
    expect(point(s, '2026-07-16')?.delta).toBe(0); // diff=0 区間は真のゼロ
    expect(point(s, '2026-07-19')?.cum).toBe(100); // 末尾=ライブ値
    expect(s.points[s.points.length - 1].date).toBe('2026-07-19');
  });

  it('pro-rata: MH区間の合計がアンカーΔのスケールで厳密一致（aggregation constraint）', () => {
    // 7/15(90) → 7/18(102): diff=12。アンカーは 7/16 に2・7/17 に1（S=3）→ scale=4
    const s = buildRequiredSeries(
      base({
        mh: [
          { date: '2026-07-15', passed: 90, total: 200 },
          { date: '2026-07-18', passed: 102, total: 200 },
        ],
        anchorEvents: [...ev('2026-07-16', 2), ...ev('2026-07-17', 1)],
        passedNow: 102,
      })
    );
    expect(point(s, '2026-07-16')?.delta).toBe(8); // 2×4
    expect(point(s, '2026-07-17')?.delta).toBe(4); // 1×4
    expect(point(s, '2026-07-18')?.cum).toBe(102); // チェックポイントに厳密一致
    expect(point(s, '2026-07-18')?.source).toBe('observed');
  });

  it('S=0 かつ diff>0: delta=null・cum線形補間・gapSample に集約（曜日統計を汚さない）', () => {
    const s = buildRequiredSeries(
      base({
        mh: [
          { date: '2026-07-13', passed: 80, total: 200 },
          { date: '2026-07-17', passed: 92, total: 200 },
        ],
        passedNow: 92,
      })
    );
    expect(point(s, '2026-07-15')?.delta).toBeNull();
    expect(point(s, '2026-07-15')?.cum).toBe(86); // 線形補間
    expect(s.gapSamples).toEqual([{ days: 4, total: 12 }]);
  });

  it('被覆窓内の無イベント日は推定ゼロ（presumedZeroDays に計上・validDaysに含む）', () => {
    // アンカー被覆 7/10〜7/16。7/12 はイベント無し → 推定ゼロ
    const s = buildRequiredSeries(
      base({
        mh: [{ date: '2026-07-18', passed: 95, total: 200 }],
        anchorEvents: [...ev('2026-07-10', 2), ...ev('2026-07-16', 1)],
        passedNow: 95,
      })
    );
    const p = point(s, '2026-07-12');
    expect(p?.delta).toBe(0);
    expect(p?.source).toBe('anchor');
    expect(s.quality.presumedZeroDays).toBeGreaterThan(0);
    expect(s.quality.validDays).toBeGreaterThanOrEqual(7); // 被覆窓の日数ぶん有効
  });

  it('導入前（最古MHより前）: アンカーΔの後方積み戻しで cum を外挿・estimated=true', () => {
    const s = buildRequiredSeries(
      base({
        mh: [{ date: '2026-07-15', passed: 90, total: 200 }],
        anchorEvents: [...ev('2026-07-10', 3), ...ev('2026-07-12', 2)],
        passedNow: 95,
      })
    );
    // 7/14 終了時点 cum=90（7/15スナップの前日。7/13〜14はイベント無し）
    expect(point(s, '2026-07-14')?.cum).toBe(90);
    // 7/11 終了時点 = 90 - 2(7/12ぶん) = 88
    expect(point(s, '2026-07-11')?.cum).toBe(88);
    // 7/9 は被覆窓外 → 系列に含めない（不明を作らない）
    expect(point(s, '2026-07-09')).toBeUndefined();
    expect(point(s, '2026-07-10')?.estimated).toBe(true);
  });

  it('ロールオーバー: total変化の境界より前の MH・アンカーを捨てる', () => {
    const s = buildRequiredSeries(
      base({
        mh: [
          { date: '2026-04-01', passed: 500, total: 900 }, // 旧学年
          { date: '2026-07-10', passed: 10, total: 200 }, // 新学年（total変化）
          { date: '2026-07-15', passed: 40, total: 200 },
        ],
        anchorEvents: [...ev('2026-03-30', 5), ...ev('2026-07-12', 2)], // 3/30 は旧課程
        passedNow: 50,
      })
    );
    expect(s.points[0].date >= '2026-07-10').toBe(true); // 旧学年ぶんは系列に無い
    expect(point(s, '2026-07-12')?.delta).toBeGreaterThan(0); // 新課程のアンカーは活きる
  });

  it('LAフォールバック: MH・アンカー皆無のとき LA の全期間ぶんの系列を組む', () => {
    const s = buildRequiredSeries(
      base({
        la: [
          { date: '2026-07-17', amount: 10 },
          { date: '2026-07-18', amount: 5 },
          { date: '2026-07-19', amount: 3 },
        ],
        passedNow: 100,
      })
    );
    expect(s.points.length).toBe(3); // 今日1点だけにならない（過去のLA日も系列化）
    expect(s.quality.approxDays).toBe(3);
    expect(s.quality.validDays).toBe(3);
    expect(s.points.every((p) => p.source === 'approx')).toBe(true);
    expect(s.points[s.points.length - 1].cum).toBe(100);
    // cum は後方積み戻し: 7/18終了=100-3=97, 7/17終了=97-5=92
    expect(s.points.find((p) => p.date === '2026-07-18')?.cum).toBe(97);
    expect(s.points.find((p) => p.date === '2026-07-17')?.cum).toBe(92);
  });

  it('quality.validDays = delta!=null の日数', () => {
    const s = buildRequiredSeries(
      base({
        mh: [
          { date: '2026-07-13', passed: 80, total: 200 },
          { date: '2026-07-17', passed: 92, total: 200 }, // S=0区間 → null×4
        ],
        anchorEvents: ev('2026-07-18', 3), // 7/17→今日 区間に S>0
        passedNow: 95,
      })
    );
    const nulls = s.points.filter((p) => p.delta === null).length;
    expect(s.quality.validDays).toBe(s.points.length - nulls);
  });
});

describe('seriesRecentPace', () => {
  it('直近窓の cum 差分 / 日数（null日も分母に含む）', () => {
    const s = buildRequiredSeries(
      base({
        mh: [
          { date: '2026-07-05', passed: 60, total: 200 },
          { date: '2026-07-19', passed: 88, total: 200 },
        ],
        passedNow: 88,
      })
    );
    const pace = seriesRecentPace(s, 28);
    expect(pace).toBeCloseTo(2, 5); // 28÷14日
  });
  it('点が足りなければ null', () => {
    expect(seriesRecentPace(buildRequiredSeries(base()), 28)).toBeNull();
  });
});
