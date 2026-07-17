import type { DailyAmount } from '../api';
import { s } from '../dom';
import { shortDate, weekdayLabel, signed } from '../format';
import type { Tooltip } from '../ui/tooltip';

const W = 720, H = 194, L = 10, R = 10, T = 24, B = 22;
const PLOT_W = W - L - R;
const PLOT_H = H - T - B;
const BASE_Y = T + PLOT_H;

/** 直近14日の日別バー + 2週平均の基準線。dataviz mark spec 準拠（細バー・データ端角丸・ベースライン固定）。 */
export function renderDailyBars(days: DailyAmount[], avg: number, tip: Tooltip): SVGElement {
  const n = days.length || 1;
  const slotW = PLOT_W / n;
  const barW = Math.min(26, slotW * 0.52);

  const values = days.map((d) => d.amount).filter((v): v is number => v !== null);
  const maxVal = values.length ? Math.max(...values) : 1;
  const yMax = Math.max(maxVal, avg, 1) * 1.15;
  const scale = (v: number) => (PLOT_H * v) / yMax;

  const todayIdx = days.length - 1;
  const maxIdx = days.findIndex((d) => d.amount === maxVal);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '直近14日の日別学習数' });

  // 平均基準線
  const avgY = BASE_Y - scale(avg);
  svg.appendChild(s('line', {
    x1: L, y1: avgY, x2: L + PLOT_W, y2: avgY,
    stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '4 4', opacity: 0.7,
  }));
  svg.appendChild(s('text', {
    x: L + PLOT_W, y: avgY - 5, 'text-anchor': 'end',
    'font-size': 11, fill: 'var(--muted)',
  }, [`2週平均 ${avg}`]));

  days.forEach((d, i) => {
    const cx = L + i * slotW + slotW / 2;
    const isToday = i === todayIdx;

    if (d.amount === null) {
      // 記録なし = 破線スタブ
      svg.appendChild(s('line', {
        x1: cx, y1: BASE_Y, x2: cx, y2: BASE_Y - 14,
        stroke: 'var(--faint)', 'stroke-width': 1.5, 'stroke-dasharray': '2 3',
      }));
    } else if (d.amount === 0) {
      // 記録あり0 = ミュートのベースラインティック
      svg.appendChild(s('rect', {
        x: cx - barW / 2, y: BASE_Y - 3, width: barW, height: 3, rx: 1.5, fill: 'var(--faint)',
      }));
    } else {
      const bh = Math.max(scale(d.amount), 2);
      svg.appendChild(s('rect', {
        x: cx - barW / 2, y: BASE_Y - bh, width: barW, height: bh, rx: 3, fill: 'var(--primary)',
        class: 'zss-abar', style: `animation-delay:${i * 24}ms`,
      }));
      if (isToday) {
        svg.appendChild(s('rect', {
          x: cx - barW / 2 - 2, y: BASE_Y - bh - 2, width: barW + 4, height: bh + 2, rx: 4,
          fill: 'none', stroke: 'var(--primary-strong)', 'stroke-width': 2,
          class: 'zss-abar', style: `animation-delay:${i * 24}ms`,
        }));
      }
      // 直接ラベル: 最高日 / 今日 のみ
      if (i === maxIdx || isToday) {
        const label = isToday ? `今日 ${d.amount}` : `${d.amount}`;
        svg.appendChild(s('text', {
          x: cx, y: BASE_Y - bh - 7, 'text-anchor': 'middle',
          'font-size': 11, 'font-weight': 700, fill: 'var(--ink)',
        }, [label]));
      }
    }

    // 曜日ラベル
    svg.appendChild(s('text', {
      x: cx, y: BASE_Y + 16, 'text-anchor': 'middle', 'font-size': 10,
      fill: isToday ? 'var(--ink)' : 'var(--faint)', 'font-weight': isToday ? 700 : 400,
    }, [weekdayLabel(d.date)]));

    // ホバー/フォーカス用の透明ヒット領域（列全体）。キーボードでも到達可能に。
    const body = d.amount === null ? '記録なし' : `${d.amount}件 · 平均比 ${signed(d.amount - avg)}`;
    const label = `${shortDate(d.date)}(${weekdayLabel(d.date)}) ${d.amount === null ? '記録なし' : d.amount + '件'}`;
    const tipHtml = `<b>${shortDate(d.date)}(${weekdayLabel(d.date)})</b> ${body}`;
    const hit = s('rect', {
      x: L + i * slotW, y: T, width: slotW, height: PLOT_H + B, fill: 'transparent',
      tabindex: 0, role: 'img', 'aria-label': label,
      onmousemove: (e: Event) => {
        const me = e as MouseEvent;
        tip.show(me.clientX, me.clientY, tipHtml);
      },
      onmouseleave: () => tip.hide(),
      onfocus: (e: Event) => {
        const r = (e.target as Element).getBoundingClientRect();
        tip.show(r.left + r.width / 2, r.top + 12, tipHtml);
      },
      onblur: () => tip.hide(),
    });
    svg.appendChild(hit);
  });

  return svg;
}
