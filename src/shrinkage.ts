// 小標本（新規ユーザーの14日窓など）の推定を安定させる道具立て。
//
// 【背景】導入直後は数日〜14日ぶんしかデータが無く、外れ日1つで推定が大きく振れる。
// 統計/マーケの定石で対処する:
//  - ベイズ平均（IMDb加重平均・経験ベイズ縮小）: 少数観測を事前平均へ「縮小」。
//    estimate = (C·priorMean + Σx) / (C + n)。n が小さいほど prior に寄り、増えるほど実測へ。
//    → 平均への回帰(regression to the mean)を明示的に取り込む。
//  - 事後予測分布: 予測区間は「母数の不確実性(epistemic)」＋「日々のばらつき(aleatoric)」の
//    両方を含めるべき。母数不確実性を無視した区間は n が小さくても広がらない（誤った自信）。

/** ベイズ平均（加重平均）。priorStrength=C は「事前を何観測ぶんと見なすか」。 */
export function bayesianAverage(sum: number, n: number, priorMean: number, priorStrength: number): number {
  if (priorStrength + n <= 0) return priorMean;
  return (priorStrength * priorMean + sum) / (priorStrength + n);
}

/** 標本平均・不偏標準偏差・変動係数(CV=sd/mean)。 */
export function describe(xs: number[]): { n: number; mean: number; sd: number; cv: number } {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, sd: 0, cv: 0 };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const varUnbiased = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(varUnbiased);
  return { n, mean, sd, cv: mean > 1e-9 ? sd / mean : 0 };
}

/** 標準正規乱数（Box–Muller法）。モンテカルロの母数不確実性サンプリング用。 */
export function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * 平均の相対標準誤差（母数不確実性の大きさ）。= CV/√n。
 * 【要点】観測CV自体が小標本では不安定（数点がたまたま近いとCV≈0＝偽の自信）。
 * そこで観測CVを事前CV(=0.5, 学習はばらつきやすい)へベイズ平均で縮小してから使う。
 * これで n が小さいほど relSE≈0.5/√n と大きく、n が増えるほど観測CVに寄って収束する。
 */
export function relativeStandardError(cv: number, n: number): number {
  if (n <= 1) return 0.6; // データ極少は大きめの不確実性
  const CV_PRIOR = 0.5;
  const CV_PRIOR_STRENGTH = 4;
  const cvEff = bayesianAverage(cv * n, n, CV_PRIOR, CV_PRIOR_STRENGTH);
  return Math.min(0.8, cvEff / Math.sqrt(n));
}
