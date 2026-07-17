// 予測の的中率（キャリブレーション）評価。過去の予測スナップショット（d日後の残数バンド）と
// その後の実績（教材消化スナップショット）を突き合わせる（純関数・honest なメタ指標）。
import type { PredLog } from './history';
import { parseDate } from './format';

const DAY = 86400000;

export interface Calibration {
  n: number; // 検証できたチェックポイント数
  coverage: number | null; // 実績が P15〜85 帯に収まった割合（理想 ≈ 0.7）
  bias: 'optimistic' | 'pessimistic' | 'balanced' | null; // P50 に対する実績の偏り
}

/**
 * @param log 予測スナップショット（日付 → d日後の残数バンド）
 * @param matSeries 教材消化スナップショット（日付昇順・passed累計）
 * @param total 現在の教材総数（残数の再構成用。総数の増減は誤差として許容し注記する）
 */
export function evaluateCalibration(
  log: PredLog,
  matSeries: { date: string; passed: number }[],
  total: number
): Calibration {
  const passedAt = new Map(matSeries.map((p) => [p.date, p.passed]));
  let n = 0;
  let inBand = 0;
  let diffSum = 0; // (実績残 - P50残)。負 = 予測より速い(予測は悲観寄り)
  for (const [dateISO, entry] of Object.entries(log)) {
    const base = parseDate(dateISO).getTime();
    for (const cp of entry.cp) {
      const target = new Date(base + cp.off * DAY);
      const iso = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
      const passed = passedAt.get(iso);
      if (passed === undefined) continue; // その日のスナップショットが無い（未訪問日）
      const actualRemaining = Math.max(0, total - passed);
      n++;
      // バンドは「残数」: P15=楽観(少ない残)〜P85=悲観(多い残)
      const lo = Math.min(cp.p15, cp.p85);
      const hi = Math.max(cp.p15, cp.p85);
      if (actualRemaining >= lo && actualRemaining <= hi) inBand++;
      diffSum += actualRemaining - cp.p50;
    }
  }
  if (n === 0) return { n: 0, coverage: null, bias: null };
  const coverage = inBand / n;
  const meanDiff = diffSum / n;
  // 実績残 > P50予測残 → 進みが予測より遅い → 予測は楽観的だった
  const bias: Calibration['bias'] = Math.abs(meanDiff) < Math.max(2, total * 0.005) ? 'balanced' : meanDiff > 0 ? 'optimistic' : 'pessimistic';
  return { n, coverage, bias };
}
