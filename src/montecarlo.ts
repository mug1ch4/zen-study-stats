// モンテカルロ完了予測: 過去の日次消化を曜日別にサンプリングして多数シミュレーション。
// 単一の日付でなく「完了日の分布・締切に間に合う確率」を出す（false precision を避ける定石）。
import { isHoliday } from './holidays';
import { isoLocal } from './format';
import { describe, gaussian, relativeStandardError } from './shrinkage';

const DAY = 86400000;

export interface MonteCarloResult {
  runs: number;
  pOnTime: number; // 締切までに完了する割合
  p15Days: number;
  p50Days: number;
  p85Days: number;
  p95Days: number;
  p15: Date; // 楽観側(早い)の完了日
  p50: Date;
  p85: Date;
  p95: Date;
  band: { dayOffset: number; p15: number; p50: number; p85: number }[]; // 残数のパーセンタイル帯（日別）
  finishDays: number[]; // 各シミュレーションの完了日(今日からの日数)。分布ヒストグラム用（昇順）
  nSamples: number; // 使用した日次サンプル数（データ成熟度＝予測の確度に使う）
  relSE: number; // 平均の相対標準誤差（母数不確実性の大きさ・小標本ほど大）
}

function quantile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
  return sortedAsc[i];
}

/**
 * @param samplesByWeekday [日..土] 各曜日の日次消化サンプル配列
 * @param overall 全曜日の日次消化サンプル（曜日サンプルが無い時のフォールバック）
 * @param horizonDays 帯を計算する将来日数（表示範囲）
 */
export function simulate(
  remaining: number,
  samplesByWeekday: number[][],
  overall: number[],
  today: Date,
  deadline: Date,
  horizonDays: number,
  runs = 1000
): MonteCarloResult | null {
  if (remaining <= 0 || overall.length === 0) return null;
  const HARD = 400;
  const H = Math.max(1, Math.min(horizonDays, 320));
  const dl = deadline.getTime();
  const finish: number[] = [];
  const perDay: number[][] = Array.from({ length: H + 1 }, () => []);
  let onTime = 0;

  // 事後予測: 各試行ごとに「その人の真のペース」を母数の不確実性から引き直す（epistemic）。
  // 観測のリサンプルだけ(aleatoric)では小標本でも区間が広がらず過信になるため、
  // 試行ごとに相対倍率 k~ (1 + N(0,1)·relSE) を全日へ掛けて、平均の不確実性を反映する。
  // relSE = CV/√n（小標本ほど大）。n が増えると k≈1 に収束し従来挙動へ。
  const stats = describe(overall);
  const relSE = relativeStandardError(stats.cv, stats.n);

  // d日後の「使う曜日プール」は試行回数に依らず固定なので、runsの外で1回だけ事前計算する
  // （祝日は日曜プール=0扱い）。これで最大 runs×HARD 回の Date生成/祝日判定を HARD 回に削減。
  const t0 = today.getTime();
  const poolByDay: number[][] = new Array(HARD + 1);
  for (let d = 1; d <= HARD; d++) {
    const date = new Date(t0 + d * DAY);
    const wd = isHoliday(isoLocal(date)) ? 0 : date.getDay();
    poolByDay[d] = samplesByWeekday[wd] && samplesByWeekday[wd].length ? samplesByWeekday[wd] : overall;
  }

  for (let s = 0; s < runs; s++) {
    let rem = remaining;
    perDay[0].push(rem);
    let done = false;
    // この試行の「真ペース」倍率（母数不確実性）。負にならないよう下限クリップ。
    const k = Math.max(0.1, 1 + gaussian() * relSE);
    for (let d = 1; d <= HARD; d++) {
      const pool = poolByDay[d];
      const sample = pool[(Math.random() * pool.length) | 0] * k;
      rem = Math.max(0, rem - sample);
      if (d <= H) perDay[d].push(rem);
      if (rem <= 1e-9) {
        finish.push(d);
        if (today.getTime() + d * DAY <= dl) onTime++;
        for (let k = d + 1; k <= H; k++) perDay[k].push(0);
        done = true;
        break;
      }
    }
    if (!done) finish.push(HARD);
  }

  finish.sort((a, b) => a - b);
  const p15Days = quantile(finish, 0.15);
  const p50Days = quantile(finish, 0.5);
  const p85Days = quantile(finish, 0.85);
  const p95Days = quantile(finish, 0.95);
  const band = perDay.map((vals, d) => {
    vals.sort((a, b) => a - b);
    return { dayOffset: d, p15: quantile(vals, 0.15), p50: quantile(vals, 0.5), p85: quantile(vals, 0.85) };
  });

  return {
    runs,
    pOnTime: onTime / runs,
    p15Days, p50Days, p85Days, p95Days,
    p15: new Date(today.getTime() + p15Days * DAY),
    p50: new Date(today.getTime() + p50Days * DAY),
    p85: new Date(today.getTime() + p85Days * DAY),
    p95: new Date(today.getTime() + p95Days * DAY),
    band,
    finishDays: finish,
    nSamples: stats.n,
    relSE,
  };
}
