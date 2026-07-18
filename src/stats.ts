// 分析タブ用の統計関数群（純関数・依存なし）。すべて自前蓄積データにのみ適用（read-only）。
// n-of-1（個人の時系列）向けに、少標本でも過信しない指標を選定:
//   トレンド= 線形回帰 + Mann-Kendall（非パラメトリック・外れ日に強い）
//   有意性 = Kruskal-Wallis（群間差がノイズか本物か）+ 効果量 η²
//   習慣  = ラグ1自己相関（好日の連鎖）/ バースト度 B / パレート集中度
// 参考: quantified-self の時系列指標（自己相関・バースト度・集中度）。

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const variance = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
};
export const stdev = (xs: number[]): number => Math.sqrt(variance(xs));

/** 分位点（線形補間）。q∈[0,1]。 */
export function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = (xs: number[]): number => quantile(xs, 0.5);

// --- 正規/カイ二乗の裾確率（有意性判定用の近似） ---
/** 標準正規の上側確率 P(Z>z)。Φ(z)=0.5(1+erf(z/√2))・erf は Abramowitz-Stegun 7.1.26 近似。
 *  実装方針: |z| で片側 sf を求め、最後に符号で反転する（erf の奇関数性を暗黙に使う書き方は
 *  正しくても壊れやすいため排除）。恒等式 normSf(z)+normSf(-z)=1 をテストで固定。 */
export function normSf(z: number): number {
  const az = Math.abs(z);
  const x = az / Math.SQRT2; // erf の引数は |z|/√2（スケール必須）
  const t = 1 / (1 + 0.3275911 * x);
  const erfAbs = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  const sfAbs = 0.5 * (1 - erfAbs); // P(Z > |z|) ∈ [0, 0.5]
  const sf = z >= 0 ? sfAbs : 1 - sfAbs;
  return Math.min(1, Math.max(0, sf)); // 近似誤差(〜1.5e-7)の範囲外れを防ぐ
}
/** カイ二乗の上側確率 P(χ²_df > x)。Wilson-Hilferty 正規近似。
 *  x が小さいと z は負になるが、normSf は負の z で正しく 1 に近づく（x→0 で p→1・単調減少をテストで固定）。 */
export function chiSqSf(x: number, df: number): number {
  if (df <= 0) return 1;
  if (x <= 0) return 1;
  const t = Math.cbrt(x / df);
  const z = (t - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return normSf(z);
}

export interface LinReg { slope: number; intercept: number; r2: number; n: number }
/** 単回帰 ys ~ xs（xs は既定で 0,1,2,…）。slope は「1ステップあたりの変化」。 */
export function linreg(ys: number[], xs?: number[]): LinReg {
  const n = ys.length;
  const X = xs ?? ys.map((_, i) => i);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0, r2: 0, n };
  const mx = mean(X), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (X[i] - mx) * (ys[i] - my);
    sxx += (X[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx ? sxy / sxx : 0;
  const r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, intercept: my - slope * mx, r2, n };
}

export interface MannKendall { S: number; tau: number; z: number; trend: 'up' | 'down' | 'flat'; p: number }
/** Mann-Kendall 単調トレンド検定（タイ補正あり・正規近似）。 */
export function mannKendall(ys: number[]): MannKendall {
  const n = ys.length;
  if (n < 4) return { S: 0, tau: 0, z: 0, trend: 'flat', p: 1 };
  let S = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += Math.sign(ys[j] - ys[i]);
  // タイ補正付き分散
  const counts = new Map<number, number>();
  for (const v of ys) counts.set(v, (counts.get(v) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of counts.values()) tieTerm += t * (t - 1) * (2 * t + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  const z = varS > 0 ? (S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0) : 0;
  const tau = S / (0.5 * n * (n - 1));
  const p = 2 * normSf(Math.abs(z)); // 両側
  const trend = p < 0.1 ? (z > 0 ? 'up' : 'down') : 'flat';
  return { S, tau, z, trend, p };
}

export interface KruskalWallis { H: number; df: number; p: number; eta2: number; k: number; n: number }
/** Kruskal-Wallis 検定（群間差の有無・タイ補正あり）。effect size は η²。 */
export function kruskalWallis(groups: number[][]): KruskalWallis {
  const g = groups.filter((x) => x.length > 0);
  const k = g.length;
  const N = g.reduce((a, x) => a + x.length, 0);
  if (k < 2 || N < 5) return { H: 0, df: Math.max(0, k - 1), p: 1, eta2: 0, k, n: N };
  // 全体を順位付け（平均順位でタイ処理）
  const flat: { v: number; gi: number }[] = [];
  g.forEach((arr, gi) => arr.forEach((v) => flat.push({ v, gi })));
  flat.sort((a, b) => a.v - b.v);
  const ranks = new Array(flat.length);
  let i = 0;
  let tieCorr = 0;
  while (i < flat.length) {
    let j = i;
    while (j + 1 < flat.length && flat[j + 1].v === flat[i].v) j++;
    const avg = (i + j) / 2 + 1; // 1始まりの平均順位
    for (let m = i; m <= j; m++) ranks[m] = avg;
    const t = j - i + 1;
    if (t > 1) tieCorr += t ** 3 - t;
    i = j + 1;
  }
  const rankSum = new Array(k).fill(0);
  const nItems = new Array(k).fill(0);
  flat.forEach((f, idx) => { rankSum[f.gi] += ranks[idx]; nItems[f.gi]++; });
  let H = 0;
  for (let gi = 0; gi < k; gi++) H += (rankSum[gi] ** 2) / nItems[gi];
  H = (12 / (N * (N + 1))) * H - 3 * (N + 1);
  const C = 1 - tieCorr / (N ** 3 - N); // タイ補正
  H = C > 0 ? H / C : H;
  const df = k - 1;
  const p = chiSqSf(H, df);
  const eta2 = (H - k + 1) / (N - k); // η²（0〜1）
  return { H, df, p, eta2: Math.max(0, eta2), k, n: N };
}

/** ラグ1自己相関（好日の連鎖＝習慣の粘り）。並び順の連続要素で計算。 */
export function lag1Autocorr(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return 0;
  const m = mean(xs);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) den += (xs[i] - m) ** 2;
  for (let i = 0; i < n - 1; i++) num += (xs[i] - m) * (xs[i + 1] - m);
  return den ? num / den : 0;
}

/** バースト度 B=(σ-μ)/(σ+μ)（区間列に対して）。B>0=まとめて型, ~0=ランダム, <0=規則的。 */
export function burstiness(intervals: number[]): number | null {
  if (intervals.length < 3) return null;
  const mu = mean(intervals);
  const sd = stdev(intervals);
  if (mu + sd === 0) return null;
  return (sd - mu) / (sd + mu);
}

/** 上位 topFrac（例0.2）の日が全体に占める割合（パレート集中度）。 */
export function paretoShare(xs: number[], topFrac = 0.2): number {
  const s = [...xs].sort((a, b) => b - a);
  const tot = s.reduce((a, b) => a + b, 0);
  if (!tot) return 0;
  const kDays = Math.max(1, Math.round(s.length * topFrac));
  const top = s.slice(0, kDays).reduce((a, b) => a + b, 0);
  return top / tot;
}
