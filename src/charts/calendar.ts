import type { CalendarData } from '../deriveHistory';
import { s } from '../dom';
import { parseDate } from '../format';
import type { Tooltip } from '../ui/tooltip';

// GitHub踏襲: 小さめの固定サイズのマス（引き伸ばさない）
const CELL = 10;
const GAP = 3;
const STEP = CELL + GAP;
const LEFT = 20; // 曜日ラベル
const TOP = 14; // 月ラベル
const WD_LABELS: Record<number, string> = { 1: '月', 3: '水', 5: '金' };

function fillFor(amount: number | null, max: number): string {
  if (amount === null) return 'var(--cal-none)';
  if (amount <= 0) return 'var(--cal-0)';
  const level = Math.min(4, Math.max(1, Math.ceil((amount / max) * 4)));
  return `var(--cal-${level})`;
}

/** GitHub風の学習カレンダー。未記録=グレー / 0=淡青 / 1-4=逐次青。 */
export function renderCalendar(data: CalendarData, tip: Tooltip): SVGElement {
  const W = LEFT + data.weeks * STEP + 2;
  const H = TOP + 7 * STEP;
  // 引き伸ばさず実寸(px)で描く。GitHub同様、幅が余っても拡大しない・足りなければ親を横スクロール。
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': '学習カレンダー',
  });
  (svg as SVGElement & { style: CSSStyleDeclaration }).style.maxWidth = 'none';

  // 曜日ラベル
  for (const [row, label] of Object.entries(WD_LABELS)) {
    svg.appendChild(
      s('text', { x: LEFT - 6, y: TOP + Number(row) * STEP + CELL - 2, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--faint)' }, [label])
    );
  }

  // 月ラベル（週ごとに月が変わったら表示）
  let prevMonth = -1;
  for (let w = 0; w < data.weeks; w++) {
    const cell = data.cells.find((c) => c.week === w);
    if (!cell) continue;
    const m = parseDate(cell.date).getMonth();
    if (m !== prevMonth) {
      svg.appendChild(
        s('text', { x: LEFT + w * STEP, y: 10, 'font-size': 9, fill: 'var(--faint)' }, [`${m + 1}月`])
      );
      prevMonth = m;
    }
  }

  // セル
  for (const c of data.cells) {
    const x = LEFT + c.week * STEP;
    const y = TOP + c.weekday * STEP;
    const rect = s('rect', {
      x, y, width: CELL, height: CELL, rx: 2, fill: fillFor(c.amount, data.max),
      onmousemove: (e: Event) => {
        const me = e as MouseEvent;
        const d = parseDate(c.date);
        const wd = ['日', '月', '火', '水', '木', '金', '土'][c.weekday];
        const body = c.amount === null ? '記録なし' : `${c.amount}件`;
        tip.show(me.clientX, me.clientY, `<b>${d.getMonth() + 1}/${d.getDate()}(${wd})</b> ${body}`);
      },
      onmouseleave: () => tip.hide(),
    });
    svg.appendChild(rect);
  }
  return svg;
}
