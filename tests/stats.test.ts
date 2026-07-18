import { describe, it, expect } from 'vitest';
import { mean, variance, stdev, quantile, median, linreg, mannKendall, kruskalWallis, lag1Autocorr, burstiness, paretoShare, normSf, chiSqSf } from '../src/stats';

describe('基本統計', () => {
  it('mean/stdev/median/quantile', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2); // 標本SD(n-1)
    expect(median([1, 3, 2])).toBe(2);
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25); // 線形補間
    expect(quantile([5], 0.9)).toBe(5);
  });
});

describe('正規/カイ二乗の裾確率（近似）', () => {
  it('normSf: 既知値', () => {
    expect(normSf(0)).toBeCloseTo(0.5, 3);
    expect(normSf(1.96)).toBeCloseTo(0.025, 2);
    expect(normSf(-1.96)).toBeCloseTo(0.975, 2);
  });
  it('chiSqSf: 既知値 (χ²=3.84, df=1 → p≈0.05)', () => {
    expect(chiSqSf(3.84, 1)).toBeGreaterThan(0.03);
    expect(chiSqSf(3.84, 1)).toBeLessThan(0.07);
    expect(chiSqSf(0, 3)).toBe(1);
  });
});

describe('linreg', () => {
  it('完全な直線 y=2x+1 を復元', () => {
    const r = linreg([1, 3, 5, 7, 9]);
    expect(r.slope).toBeCloseTo(2, 10);
    expect(r.intercept).toBeCloseTo(1, 10);
    expect(r.r2).toBeCloseTo(1, 10);
  });
  it('n<2 は slope 0', () => {
    expect(linreg([5]).slope).toBe(0);
  });
});

describe('mannKendall', () => {
  it('単調増加 → up・p小', () => {
    const r = mannKendall([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.trend).toBe('up');
    expect(r.p).toBeLessThan(0.01);
    expect(r.tau).toBe(1);
  });
  it('単調減少 → down', () => {
    expect(mannKendall([9, 8, 7, 6, 5, 4, 3, 2, 1]).trend).toBe('down');
  });
  it('定数列 → flat（タイ補正で発散しない）', () => {
    const r = mannKendall([5, 5, 5, 5, 5, 5]);
    expect(r.trend).toBe('flat');
    expect(r.S).toBe(0);
  });
  it('n<4 は判定しない', () => {
    expect(mannKendall([1, 2, 3]).trend).toBe('flat');
  });
});

describe('kruskalWallis', () => {
  it('教科書例: {1,2,3}{4,5,6}{7,8,9} → H=7.2', () => {
    const r = kruskalWallis([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    expect(r.H).toBeCloseTo(7.2, 5);
    expect(r.df).toBe(2);
    expect(r.p).toBeLessThan(0.05);
  });
  it('同一分布の群 → p大', () => {
    const r = kruskalWallis([[5, 6, 5, 6], [5, 6, 6, 5], [6, 5, 5, 6]]);
    expect(r.p).toBeGreaterThan(0.5);
  });
  it('群が足りない → p=1', () => {
    expect(kruskalWallis([[1, 2, 3]]).p).toBe(1);
  });
});

describe('習慣指標', () => {
  it('lag1Autocorr: 交互列は負・傾向列は正', () => {
    expect(lag1Autocorr([1, 9, 1, 9, 1, 9, 1, 9])).toBeLessThan(-0.5);
    expect(lag1Autocorr([1, 2, 3, 4, 5, 6, 7, 8])).toBeGreaterThan(0.5);
  });
  it('burstiness: 等間隔=-1・変動大は正', () => {
    expect(burstiness([3, 3, 3, 3])).toBeCloseTo(-1, 5);
    expect(burstiness([1, 1, 1, 30])!).toBeGreaterThan(0);
    expect(burstiness([1, 2])).toBeNull(); // n<3
  });
  it('paretoShare: 均等なら上位20%≈20%', () => {
    expect(paretoShare(new Array(10).fill(7), 0.2)).toBeCloseTo(0.2, 5);
    expect(paretoShare([100, 0, 0, 0, 0], 0.2)).toBe(1); // 1日に全集中
  });
});

// --- エッジケース網羅（空・要素1〜4・定数列・大量タイ・0多数）。数値がそれっぽく見えるバグの防波堤 ---
describe('エッジケース', () => {
  it('空配列・要素1で例外/NaNを出さない', () => {
    expect(mean([])).toBe(0);
    expect(variance([1])).toBe(0);
    expect(stdev([])).toBe(0);
    expect(quantile([], 0.5)).toBe(0);
    expect(median([])).toBe(0);
    expect(paretoShare([])).toBe(0);
    expect(lag1Autocorr([1, 2, 3])).toBe(0); // n<4
    expect(burstiness([5, 5])).toBeNull(); // n<3
    expect(linreg([]).slope).toBe(0);
  });
  it('定数列: 分散0系で発散しない', () => {
    expect(variance([4, 4, 4, 4])).toBe(0);
    expect(lag1Autocorr([4, 4, 4, 4, 4])).toBe(0); // den=0 → 0
    expect(linreg([4, 4, 4, 4]).slope).toBe(0);
    expect(linreg([4, 4, 4, 4]).r2).toBe(0);
    const mk = mannKendall([4, 4, 4, 4, 4, 4, 4]);
    expect(mk.p).toBeCloseTo(1, 6); // erf近似誤差(〜1e-9)を許容
    expect(mk.trend).toBe('flat');
  });
  it('0が大量: burstiness(全0)=null・paretoShare(全0)=0', () => {
    expect(burstiness([0, 0, 0, 0])).toBeNull(); // μ+σ=0
    expect(paretoShare([0, 0, 0, 0, 0])).toBe(0);
    expect(quantile([0, 0, 0, 5], 0.5)).toBe(0);
  });
  it('大量タイ: mannKendall はタイ補正で妥当な判定を保つ', () => {
    const r = mannKendall([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]); // 強い上昇＋大量タイ
    expect(r.trend).toBe('up');
    expect(r.p).toBeLessThan(0.05);
    expect(r.tau).toBeGreaterThan(0);
  });
  it('kruskalWallis: 全群同値（タイ補正C=0）でも NaN にならない', () => {
    const r = kruskalWallis([[3, 3, 3], [3, 3, 3], [3, 3]]);
    expect(Number.isFinite(r.H)).toBe(true);
    expect(r.p).toBeGreaterThan(0.9);
  });
  it('kruskalWallis: 0多数＋要素数バラバラ', () => {
    const r = kruskalWallis([[0, 0, 0, 1], [0, 0], [0, 2, 0]]);
    expect(Number.isFinite(r.p)).toBe(true);
    expect(r.p).toBeGreaterThanOrEqual(0);
    expect(r.p).toBeLessThanOrEqual(1);
  });
});

// --- 近似式のプロパティ（構造リファクタの回帰防止） ---
describe('normSf/chiSqSf プロパティ', () => {
  it('恒等式 normSf(z) + normSf(-z) = 1（負側は反転で計算）', () => {
    for (const z of [0, 0.1, 0.5, 1, 1.64, 1.96, 2.5, 3.5, 6]) {
      expect(normSf(z) + normSf(-z)).toBeCloseTo(1, 6);
    }
  });
  it('normSf: 単調減少・値域[0,1]・既知値 z=3', () => {
    let prev = 1.1;
    for (let z = -5; z <= 5; z += 0.25) {
      const p = normSf(z);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
      expect(p).toBeLessThanOrEqual(prev + 1e-12);
      prev = p;
    }
    expect(normSf(3)).toBeCloseTo(0.00135, 4);
  });
  it('chiSqSf: x→0 で p→1（負のz経路）・x について単調減少', () => {
    expect(chiSqSf(0.001, 6)).toBeGreaterThan(0.999);
    for (const df of [1, 3, 6, 10]) {
      let prev = 1.1;
      for (let x = 0.01; x < 30; x += 0.5) {
        const p = chiSqSf(x, df);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(p).toBeLessThanOrEqual(prev + 1e-9);
        prev = p;
      }
    }
    expect(chiSqSf(12.59, 6)).toBeGreaterThan(0.03); // 既知値 p≈0.05（W-H近似の範囲で）
    expect(chiSqSf(12.59, 6)).toBeLessThan(0.07);
  });
});
