import { describe, it, expect } from 'vitest';
import { computePrediction, recommendedPace } from '../src/predictor';
import { zenToday } from '../src/format';
import { bayesianAverage, relativeStandardError } from '../src/shrinkage';
import { simulate } from '../src/montecarlo';

const DAY = 86400000;
const deadlineIn = (days: number): string => new Date(zenToday().getTime() + days * DAY).toISOString();

describe('computePrediction', () => {
  it('残0 → onTrack・requiredPerDay 0', () => {
    const p = computePrediction({
      totalMaterials: 100, passedMaterials: 100, materialSeries: [],
      finalDeadline: deadlineIn(30), months: [], remainingReports: 0,
    });
    expect(p.remaining).toBe(0);
    expect(p.onTrack).toBe(true);
    expect(p.requiredPerDay).toBe(0);
    expect(p.pOnTime).toBe(1);
  });
  it('requiredPerDay ≈ 残り/残日数（quest とプランナーの単一情報源）', () => {
    const p = computePrediction({
      totalMaterials: 300, passedMaterials: 0, materialSeries: [],
      finalDeadline: deadlineIn(30), months: [], remainingReports: 0,
    });
    expect(p.requiredPerDay).toBeGreaterThan(9);
    expect(p.requiredPerDay).toBeLessThan(11);
  });
  it('日次サンプルがあればモンテカルロと確度が出る', () => {
    const samples = Array.from({ length: 14 }, (_, i) => ({ weekday: i % 7, value: 10 }));
    const p = computePrediction({
      totalMaterials: 200, passedMaterials: 100, materialSeries: [],
      finalDeadline: deadlineIn(60), months: [], remainingReports: 0,
      dailySamples: samples,
    });
    expect(p.montecarlo).not.toBeNull();
    expect(p.mcBasis).toBe('material');
    expect(p.pOnTime).not.toBeNull();
    expect(p.pOnTime!).toBeGreaterThan(0.95); // 10/日で残100・60日 → 余裕
    expect(p.pOnTime!).toBeLessThanOrEqual(0.99); // 100%は表示しない（長期の行動予測に確実は無い）
    expect(p.confidence.level).not.toBe('low');
  });
  it('時間ベース入力があればヘッドラインMCは時間単位・帯は教材数へ逆換算', () => {
    // 残100教材 ≈ 残50時間（平均1800秒/教材）。学習時間 2h/日 → 25日で完了（60日締切に余裕）
    const timeSamples = Array.from({ length: 14 }, (_, i) => ({ weekday: i % 7, value: 7200 }));
    const p = computePrediction({
      totalMaterials: 200, passedMaterials: 100, materialSeries: [],
      finalDeadline: deadlineIn(60), months: [], remainingReports: 0,
      dailySamples: Array.from({ length: 14 }, (_, i) => ({ weekday: i % 7, value: 100 })), // 教材ベースなら1日で終わる値
      time: { remainSec: 100 * 1800, dailySamples: timeSamples },
    });
    expect(p.mcBasis).toBe('time');
    expect(p.montecarlo).not.toBeNull();
    // 教材ベース(100/日→1日)でなく時間ベース(2h/日→約25日)の完了日になっている
    expect(p.montecarlo!.p50Days).toBeGreaterThan(15);
    expect(p.montecarlo!.p50Days).toBeLessThan(40);
    // 帯は教材数に換算されている（初日残 ≈ 100教材のオーダー・秒のままなら180000）
    const b0 = p.montecarlo!.band[0];
    expect(b0.p50).toBeLessThanOrEqual(100.5);
    expect(p.pOnTime!).toBeLessThanOrEqual(0.99);
  });
  it('時間サンプルが5日未満なら教材ベースへフォールバック', () => {
    const p = computePrediction({
      totalMaterials: 200, passedMaterials: 100, materialSeries: [],
      finalDeadline: deadlineIn(60), months: [], remainingReports: 0,
      dailySamples: Array.from({ length: 14 }, (_, i) => ({ weekday: i % 7, value: 10 })),
      time: { remainSec: 100 * 1800, dailySamples: [{ weekday: 1, value: 7200 }] },
    });
    expect(p.mcBasis).toBe('material');
  });
});

describe('recommendedPace', () => {
  it('過去日は null・10日後は 残/10', () => {
    expect(recommendedPace(100, new Date(zenToday().getTime() - DAY))).toBeNull();
    const r = recommendedPace(100, new Date(zenToday().getTime() + 10 * DAY));
    expect(r).not.toBeNull();
    expect(r!.perDay).toBeCloseTo(10, 5);
    expect(r!.perWeek).toBeCloseTo(70, 5);
  });
});

describe('shrinkage', () => {
  it('bayesianAverage: サンプル0は事前分布・大標本は実測平均へ', () => {
    expect(bayesianAverage(0, 0, 5, 3)).toBe(5);
    expect(bayesianAverage(1000, 100, 5, 3)).toBeCloseTo(10, 0); // 100日×平均10
  });
  it('relativeStandardError: 標本が増えると縮む', () => {
    expect(relativeStandardError(0.5, 4)).toBeGreaterThan(relativeStandardError(0.5, 100));
  });
});

describe('montecarlo', () => {
  it('毎日5消化・残10 → ほぼ2日で完了・pOnTime=1（小標本の母数不確実性で±1日は許容）', () => {
    // 注: サンプルが同値でも小標本では relSE>0（cold-start用の縮小事前分布 CV=0.5）に
    // より母数倍率kが揺れる＝完全決定的にはならないのが仕様。大標本で揺れが縮むことも確認。
    const byWd: number[][] = Array.from({ length: 7 }, () => new Array(10).fill(5));
    const today = zenToday();
    const r = simulate(10, byWd, new Array(70).fill(5), today, new Date(today.getTime() + 30 * DAY), 40, 300);
    expect(r).not.toBeNull();
    expect(r!.p50Days).toBeGreaterThanOrEqual(2);
    expect(r!.p50Days).toBeLessThanOrEqual(3);
    expect(r!.p85Days).toBeLessThanOrEqual(3);
    expect(r!.pOnTime).toBe(1);
    expect(r!.relSE).toBeLessThan(0.2); // 大標本 → 母数不確実性は小さい
  });
  it('間に合わないペース → pOnTime 低', () => {
    const byWd: number[][] = Array.from({ length: 7 }, () => [1]);
    const today = zenToday();
    const r = simulate(100, byWd, [1], today, new Date(today.getTime() + 10 * DAY), 30, 200);
    expect(r!.pOnTime).toBe(0); // 1/日で残100・10日 → 不可能
  });
});
