import { s } from '../dom';
import type { Tooltip } from '../ui/tooltip';

const W = 720, H = 134, L = 10, R = 10, T = 18, B = 24;
const PLOT_W = W - L - R;
const PLOT_H = H - T - B;
const BASE_Y = T + PLOT_H;

/** 時間帯トレンド（0〜23時の学習量）。自前計測した study[24] を可視化。 */
export function renderHourBars(study: number[], tip: Tooltip): SVGElement {
  const max = Math.max(1, ...study);
  const yMax = max * 1.15;
  const scale = (v: number) => (PLOT_H * v) / yMax;
  const slotW = PLOT_W / 24;
  const barW = Math.min(20, slotW * 0.66);
  const peak = study.indexOf(Math.max(...study));

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '時間帯別の学習量' });

  for (let hStart = 0; hStart < 24; hStart++) {
    const cx = L + hStart * slotW + slotW / 2;
    const v = study[hStart] ?? 0;
    if (v > 0) {
      const bh = Math.max(scale(v), 2);
      svg.appendChild(s('rect', {
        x: cx - barW / 2, y: BASE_Y - bh, width: barW, height: bh, rx: 2,
        fill: hStart === peak ? 'var(--primary-strong)' : 'var(--primary)',
        class: 'zss-abar', style: `animation-delay:${hStart * 16}ms`,
      }));
    }
    // 目盛ラベルは 0/6/12/18/23 のみ
    if (hStart % 6 === 0 || hStart === 23) {
      svg.appendChild(s('text', {
        x: cx, y: BASE_Y + 16, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--muted)',
      }, [`${hStart}`]));
    }
    const hit = s('rect', {
      x: L + hStart * slotW, y: T, width: slotW, height: PLOT_H + B, fill: 'transparent',
      onmousemove: (e: Event) => {
        const me = e as MouseEvent;
        tip.show(me.clientX, me.clientY, `<b>${hStart}〜${(hStart + 1) % 24}時</b> ${Math.round(v)} 教材`);
      },
      onmouseleave: () => tip.hide(),
    });
    svg.appendChild(hit);
  }
  svg.appendChild(s('text', { x: L, y: T - 10, 'font-size': 10, fill: 'var(--faint)' }, ['時（0〜23）']));
  return svg;
}
