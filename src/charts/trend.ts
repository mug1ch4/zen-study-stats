import type { TrendPoint, TrendMode } from '../deriveHistory';
import { s } from '../dom';
import type { Tooltip } from '../ui/tooltip';

const W = 720, H = 162, L = 28, R = 10, T = 12, B = 24;
const PLOT_W = W - L - R;
const PLOT_H = H - T - B;
const BASE_Y = T + PLOT_H;

/** 長期トレンド。day: 日別+7日移動平均 / week・month: 合計。fmt 指定時は値表記を差し替え（例: 分→1h23m）。 */
export function renderTrend(points: TrendPoint[], mode: TrendMode, tip: Tooltip, fmt?: (v: number) => string): SVGElement {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': fmt ? '学習時間トレンド' : '学習数トレンド' });
  if (!points.length) return svg;

  const n = points.length;
  const maxV = Math.max(1, ...points.map((p) => p.value), ...points.map((p) => p.ma ?? 0));
  const yMax = maxV * 1.15;
  const x = (i: number) => (n === 1 ? L + PLOT_W / 2 : L + (i / (n - 1)) * PLOT_W);
  const y = (v: number) => BASE_Y - (v / yMax) * PLOT_H;

  // y軸目盛（0 と max）
  for (const v of [0, Math.round(maxV)]) {
    const yy = y(v);
    svg.appendChild(s('line', { x1: L, y1: yy, x2: L + PLOT_W, y2: yy, stroke: 'var(--border)', 'stroke-width': 1 }));
    svg.appendChild(s('text', { x: L - 5, y: yy + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--faint)' }, [v > 0 && fmt ? fmt(v) : String(v)]));
  }

  // 移動平均（破線・day のみ）
  if (mode === 'day' && points.some((p) => p.ma !== undefined)) {
    const maPts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.ma ?? 0).toFixed(1)}`).join(' ');
    svg.appendChild(s('polyline', { points: maPts, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
  }

  // 値ライン
  const linePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  svg.appendChild(s('polyline', { points: linePts, fill: 'none', stroke: 'var(--primary)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', pathLength: 1, class: 'zss-adraw' }));

  // マーカー（点が少ない時のみ）
  if (n <= 40) {
    for (let i = 0; i < n; i++) {
      svg.appendChild(s('circle', { cx: x(i), cy: y(points[i].value), r: 2.5, fill: 'var(--primary)' }));
    }
  }

  // x ラベル（両端＋中央付近を数個）
  const labelIdx = new Set([0, n - 1, Math.floor(n / 2), Math.floor(n / 4), Math.floor((3 * n) / 4)]);
  for (const i of labelIdx) {
    if (i < 0 || i >= n) continue;
    svg.appendChild(s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--faint)' }, [points[i].label]));
  }

  // ホバー用ヒット（各点の縦帯）
  for (let i = 0; i < n; i++) {
    const bandW = PLOT_W / n;
    svg.appendChild(s('rect', {
      x: x(i) - bandW / 2, y: T, width: bandW, height: PLOT_H, fill: 'transparent',
      onmousemove: (e: Event) => {
        const me = e as MouseEvent;
        const p = points[i];
        const ma = mode === 'day' && p.ma !== undefined ? ` · 7日平均 ${fmt ? fmt(Math.round(p.ma)) : p.ma.toFixed(1)}` : '';
        tip.show(me.clientX, me.clientY, `<b>${p.label}</b> ${fmt ? fmt(p.value) : `${p.value}件`}${ma}`);
      },
      onmouseleave: () => tip.hide(),
    }));
  }
  return svg;
}
