import type { WeekdayStat } from '../derive';
import { s } from '../dom';
import { weekdayLabelByIndex, shortDate } from '../format';
import type { Tooltip } from '../ui/tooltip';

const W = 720, H = 132, L = 10, R = 10, T = 18, B = 22;
const PLOT_W = W - L - R;
const PLOT_H = H - T - B;
const BASE_Y = T + PLOT_H;

// 月火水木金土日 の順で表示
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** 曜日別リズム（各曜日=2週ぶんの平均）。 */
export function renderWeekdayBars(stats: WeekdayStat[], tip: Tooltip): SVGElement {
  const byWeekday = new Map(stats.map((x) => [x.weekday, x]));
  const ordered = ORDER.map((w) => byWeekday.get(w)!).filter(Boolean);

  const maxAvg = Math.max(1, ...ordered.map((x) => x.avg ?? 0));
  const yMax = maxAvg * 1.2;
  const scale = (v: number) => (PLOT_H * v) / yMax;

  const n = ordered.length || 1;
  const slotW = PLOT_W / n;
  const barW = Math.min(30, slotW * 0.5);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '曜日別の平均学習数' });

  ordered.forEach((st, i) => {
    const cx = L + i * slotW + slotW / 2;
    const val = st.avg;
    if (val !== null && val > 0) {
      const bh = Math.max(scale(val), 2);
      svg.appendChild(s('rect', {
        x: cx - barW / 2, y: BASE_Y - bh, width: barW, height: bh, rx: 3, fill: 'var(--primary)',
        class: 'zss-abar', style: `animation-delay:${i * 30}ms`,
      }));
      const label = Number.isInteger(val) ? String(val) : val.toFixed(1);
      svg.appendChild(s('text', {
        x: cx, y: BASE_Y - bh - 6, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: 'var(--ink)',
      }, [label]));
    }
    svg.appendChild(s('text', {
      x: cx, y: BASE_Y + 15, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--muted)',
    }, [weekdayLabelByIndex(st.weekday)]));

    const hit = s('rect', {
      x: L + i * slotW, y: T, width: slotW, height: PLOT_H + B, fill: 'transparent',
      onmousemove: (e: Event) => {
        const me = e as MouseEvent;
        const wl = weekdayLabelByIndex(st.weekday);
        if (val === null) {
          tip.show(me.clientX, me.clientY, `<b>${wl}曜</b> サンプルなし`);
        } else {
          const detail = st.samples.map((x) => `${shortDate(x.date)} ${x.amount}`).join(' · ');
          tip.show(me.clientX, me.clientY, `<b>${wl}曜 平均 ${val.toFixed(1)}</b><br>${detail}`);
        }
      },
      onmouseleave: () => tip.hide(),
    });
    svg.appendChild(hit);
  });

  return svg;
}
