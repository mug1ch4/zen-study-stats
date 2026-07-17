import { s } from '../dom';
import { countUp } from '../anim';

/**
 * 単一割合（passed/total）のドーナツ・ゲージ。中央に完了%。
 * ※複数系列の比較には使わない（円は面積比較が苦手）。全体進捗という1つの割合の可視化に限定。
 */
export function renderDonut(passed: number, total: number, opts?: { size?: number; label?: string }): SVGElement {
  const size = opts?.size ?? 128;
  const stroke = Math.max(8, Math.round(size * 0.11));
  const cx = size / 2;
  const cy = size / 2;
  const r = cx - stroke / 2 - 1;
  const C = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, passed / total)) : 0;
  const pct = Math.round(frac * 100);

  const svg = s('svg', {
    viewBox: `0 0 ${size} ${size}`,
    width: size,
    height: size,
    role: 'img',
    'aria-label': `全体の教材完了 ${pct}%（${passed} / ${total}）`,
  });
  // トラック（未完了）
  svg.appendChild(s('circle', { cx, cy, r, fill: 'none', stroke: 'var(--border)', 'stroke-width': stroke }));
  // 値の弧（12時方向から時計回り）
  if (frac > 0) {
    svg.appendChild(
      s('circle', {
        cx, cy, r,
        fill: 'none',
        stroke: 'var(--primary)',
        'stroke-width': stroke,
        'stroke-linecap': 'round',
        'stroke-dasharray': `${(frac * C).toFixed(2)} ${C.toFixed(2)}`,
        transform: `rotate(-90 ${cx} ${cy})`,
        class: 'zss-aarc',
        style: `--arc:${(frac * C).toFixed(2)}`, // 0%→実割合へ弧を描く
      })
    );
  }
  // 中央: 大きな% ＋ 小さなラベル
  const pctText = s('text', {
    x: cx, y: cy, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    'font-size': Math.round(size * 0.27), 'font-weight': 800, 'font-variant-numeric': 'tabular-nums', fill: 'var(--ink)',
  });
  countUp(pctText, `${pct}%`); // 0%→実値へカウントアップ（弧の描画と同期的に伸びる）
  svg.appendChild(pctText);
  svg.appendChild(
    s('text', {
      x: cx, y: cy + Math.round(size * 0.2), 'text-anchor': 'middle',
      'font-size': Math.round(size * 0.1), fill: 'var(--muted)',
    }, [opts?.label ?? '完了'])
  );
  return svg;
}
