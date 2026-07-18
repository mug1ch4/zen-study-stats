// 日別パンチカード（日付 × 時刻の散布）: 受験記録＋補間動画の「いつ勉強したか」実記録。
// 縦軸は学習日の切替(5:00)起点で 5時→翌4:59 と連続に描く（深夜学習が段差にならない）。
import { s } from '../dom';
import { zenTodayISO, parseDate } from '../format';
import type { Tooltip } from '../ui/tooltip';

const W = 720, H = 190, L = 34, R = 10, T = 12, B = 22;
const PLOT_W = W - L - R;
const PLOT_H = H - T - B;
const MAX_DAYS = 90;
const DAY = 86400000;

export interface PunchEvent {
  at: number; // epoch秒
  kind: 'sub' | 'movie'; // 受験（実測） / 動画（補間）
}

export function renderPunch(events: PunchEvent[], tip: Tooltip): SVGElement {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '日別の学習時刻（受験記録と補間動画）' });
  if (!events.length) return svg;
  const sorted = [...events].sort((a, b) => a.at - b.at);
  const lastDay = zenTodayISO(sorted[sorted.length - 1].at * 1000);
  let firstDay = zenTodayISO(sorted[0].at * 1000);
  const spanDays = Math.round((parseDate(lastDay).getTime() - parseDate(firstDay).getTime()) / DAY) + 1;
  if (spanDays > MAX_DAYS) {
    firstDay = zenTodayISO(parseDate(lastDay).getTime() - (MAX_DAYS - 1) * DAY + 12 * 3600 * 1000);
  }
  const firstT = parseDate(firstDay).getTime();
  const nDays = Math.min(spanDays, MAX_DAYS);
  const slotW = PLOT_W / nDays;

  // 横グリッド＋時刻ラベル（6・12・18・24時。縦軸は 5時起点の連続24時間）
  for (const hh of [6, 12, 18, 24]) {
    const y = T + ((hh - 5) / 24) * PLOT_H;
    svg.appendChild(s('line', { x1: L, y1: y, x2: W - R, y2: y, stroke: 'var(--border)', 'stroke-width': 0.6, 'stroke-dasharray': '2 3' }));
    svg.appendChild(s('text', { x: L - 5, y: y + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--muted)' }, [hh === 24 ? '0時' : `${hh}時`]));
  }
  // 日付ラベル（最大6個・等間隔）
  const labelEvery = Math.max(1, Math.ceil(nDays / 6));
  for (let i = 0; i < nDays; i += labelEvery) {
    const dkey = new Date(firstT + i * DAY);
    svg.appendChild(s('text', {
      x: L + i * slotW + slotW / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)',
    }, [`${dkey.getMonth() + 1}/${dkey.getDate()}`]));
  }

  const fmt2 = (n: number) => String(n).padStart(2, '0');
  for (const ev of sorted) {
    const dkey = zenTodayISO(ev.at * 1000);
    const di = Math.round((parseDate(dkey).getTime() - firstT) / DAY);
    if (di < 0 || di >= nDays) continue;
    const jst = new Date((ev.at + 9 * 3600) * 1000);
    const hRaw = jst.getUTCHours() + jst.getUTCMinutes() / 60;
    const hh = hRaw < 5 ? hRaw + 24 : hRaw; // 5時起点の連続軸
    const cx = L + di * slotW + slotW / 2;
    const cy = T + ((hh - 5) / 24) * PLOT_H;
    const isSub = ev.kind === 'sub';
    const dot = s('circle', {
      cx, cy, r: isSub ? 3.4 : 2.6,
      fill: isSub ? 'var(--primary)' : 'var(--success)',
      'fill-opacity': isSub ? 0.95 : 0.7,
      onmousemove: (e: Event) => {
        const me = e as MouseEvent;
        const d = parseDate(dkey);
        tip.show(me.clientX, me.clientY, `<b>${d.getMonth() + 1}/${d.getDate()} ${fmt2(jst.getUTCHours())}:${fmt2(jst.getUTCMinutes())}</b> ${isSub ? 'テスト/レポート受験' : '動画完了（補間）'}`);
      },
      onmouseleave: () => tip.hide(),
    });
    svg.appendChild(dot);
  }
  // 凡例
  svg.appendChild(s('circle', { cx: L + 6, cy: T + 2, r: 3.4, fill: 'var(--primary)' }));
  svg.appendChild(s('text', { x: L + 13, y: T + 5, 'font-size': 9, fill: 'var(--muted)' }, ['受験']));
  svg.appendChild(s('circle', { cx: L + 44, cy: T + 2, r: 2.6, fill: 'var(--success)', 'fill-opacity': 0.7 }));
  svg.appendChild(s('text', { x: L + 51, y: T + 5, 'font-size': 9, fill: 'var(--muted)' }, ['動画（補間）']));
  return svg;
}
