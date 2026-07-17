import type { Prediction } from '../predictor';
import { s } from '../dom';
import { parseDate, isoLocal, zenToday } from '../format';
import { isHoliday } from '../holidays';
import type { Tooltip } from '../ui/tooltip';

const DAY = 86400000;
const W = 720, H = 220, L = 30, R = 12, T = 12, B = 26;
const PLOT_W = W - L - R;
const PLOT_H = H - T - B;
const BASE_Y = T + PLOT_H;

export interface Pt {
  date: string;
  remaining: number;
}

/** 教材消化バーンダウン: 日次実績(再構成)＋曜日/祝日考慮の予測カーブ＋必要ライン。 */
export function renderBurndown(p: Prediction, actual: Pt[], tip: Tooltip): SVGElement {
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '教材消化バーンダウン' });
  const total = Math.max(1, p.total);
  // x範囲: 直近実績の開始 〜 締切
  // 基点は「学習上の今日」(5:00 AM JST境界)。予測(モンテカルロ)の today と一致させ、帯のズレを防ぐ。
  const nowAnchor = zenToday().getTime();
  const t0 = actual.length ? parseDate(actual[0].date).getTime() : nowAnchor;
  const t1 = p.finalDeadline.getTime();
  const span = Math.max(DAY, t1 - t0);
  const x = (t: number) => L + Math.max(0, Math.min(1, (t - t0) / span)) * PLOT_W;
  const y = (rem: number) => BASE_Y - (Math.max(0, Math.min(total, rem)) / total) * PLOT_H;
  const nowT = Math.min(nowAnchor, t1);

  // y軸目盛
  for (const v of [0, total]) {
    const yy = y(v);
    svg.appendChild(s('line', { x1: L, y1: yy, x2: L + PLOT_W, y2: yy, stroke: 'var(--border)', 'stroke-width': 1 }));
    svg.appendChild(s('text', { x: L - 5, y: yy + 3, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--faint)' }, [String(v)]));
  }

  // 週末/祝日の縦帯（薄く）
  for (let t = t0; t <= t1; t += DAY) {
    const d = new Date(t);
    const iso = isoLocal(d);
    const wknd = d.getDay() === 0 || d.getDay() === 6 || isHoliday(iso);
    if (wknd) {
      svg.appendChild(s('rect', { x: x(t) - (PLOT_W / (span / DAY)) / 2, y: T, width: Math.max(1, PLOT_W / (span / DAY)), height: PLOT_H, fill: 'var(--muted)', opacity: 0.06 }));
    }
  }

  // 完了日の分布（控えめな薄紫のヒストグラムをベースライン付近に重ねる・背景層）
  if (p.montecarlo && p.montecarlo.finishDays.length) {
    const nm = nowAnchor;
    const counts = new Map<number, number>();
    let maxC = 1;
    for (const off of p.montecarlo.finishDays) {
      const c = (counts.get(off) ?? 0) + 1;
      counts.set(off, c);
      if (c > maxC) maxC = c;
    }
    const distH = PLOT_H * 0.3; // 控えめな高さ
    const dayW = PLOT_W / (span / DAY);
    const bw = Math.max(1, dayW * 0.85);
    const offsets = [...counts.keys()].sort((a, b) => a - b);
    const minOff = offsets[0] ?? 0;
    for (const [off, c] of counts) {
      const cx = x(nm + off * DAY);
      const hgt = (c / maxC) * distH;
      svg.appendChild(s('rect', {
        x: cx - bw / 2, y: BASE_Y - hgt, width: bw, height: hgt, rx: 0.5, fill: '#6f5cc4', opacity: 0.55,
        class: 'zss-abar', style: `animation-delay:${300 + (off - minOff) * 10}ms`, // 中央帯の後に左から
      }));
    }
  }

  // 月ティック＋ラベル（実際の月初に整列。ラベルは月の区間の中央に）
  {
    const s0 = new Date(t0);
    let m = new Date(s0.getFullYear(), s0.getMonth(), 1, 12);
    while (m.getTime() <= t1) {
      const next = new Date(m.getFullYear(), m.getMonth() + 1, 1, 12);
      const mStart = Math.max(m.getTime(), t0);
      const mEnd = Math.min(next.getTime(), t1);
      // 月初のティック
      if (m.getTime() >= t0) {
        svg.appendChild(s('line', { x1: x(m.getTime()), y1: BASE_Y, x2: x(m.getTime()), y2: BASE_Y + 4, stroke: 'var(--faint)', 'stroke-width': 1 }));
      }
      // ラベルは月の可視区間の中央
      svg.appendChild(s('text', { x: (x(mStart) + x(mEnd)) / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--faint)' }, [`${m.getMonth() + 1}月`]));
      m = next;
    }
  }

  // 締切の縦線
  const dx = x(t1);
  svg.appendChild(s('line', { x1: dx, y1: T, x2: dx, y2: BASE_Y, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }));
  const ddl = `${p.finalDeadline.getMonth() + 1}/${p.finalDeadline.getDate()}`;
  svg.appendChild(s('text', { x: dx, y: T + 8, 'text-anchor': 'end', 'font-size': 9, fill: 'var(--muted)' }, [ddl]));

  // 必要ライン（今→締切で0へ・直線）
  svg.appendChild(s('line', {
    x1: x(nowT), y1: y(p.remaining), x2: dx, y2: y(0),
    stroke: 'var(--muted)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4',
    class: 'zss-afade', style: 'animation-delay:250ms',
  }));

  const col = p.onTrack ? 'var(--success)' : '#d9822b';
  const nowMs = nowAnchor;
  if (p.montecarlo) {
    // 完了後の平坦な尾を除去（P85が0に達する所まで）
    const raw = p.montecarlo.band;
    let end = raw.length - 1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i].p85 <= 0) { end = i; break; }
    }
    const band = raw.slice(0, end + 1);
    const bx = (d: number) => x(nowMs + d * DAY);
    const upper = band.map((b) => `${bx(b.dayOffset).toFixed(1)},${y(b.p85).toFixed(1)}`);
    const lower = band.map((b) => `${bx(b.dayOffset).toFixed(1)},${y(b.p15).toFixed(1)}`).reverse();
    // 半透明の帯（P15〜85）。フェードは最終不透明度0.15で止める（--fo）。中央値線はこの上に重ねる。
    svg.appendChild(s('polygon', { points: [...upper, ...lower].join(' '), fill: col, opacity: 0.15, stroke: 'none', class: 'zss-afade', style: 'animation-delay:150ms;--fo:0.15' }));
    const median = band.map((b) => `${bx(b.dayOffset).toFixed(1)},${y(b.p50).toFixed(1)}`).join(' ');
    svg.appendChild(s('polyline', { points: median, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', pathLength: 1, class: 'zss-adraw' }));

    // 完了見込み区間（P15〜P85）を横軸に赤線で明示
    const RED = '#e5484d';
    const x15 = x(p.montecarlo.p15.getTime());
    const x85 = x(p.montecarlo.p85.getTime());
    // レンジ線は中央から左右へ伸び、端キャップ＋ラベルは少し遅れて現れる（中央帯の描画後）
    svg.appendChild(s('line', { x1: x15, y1: BASE_Y, x2: x85, y2: BASE_Y, stroke: RED, 'stroke-width': 3, class: 'zss-agrow-x', style: 'animation-delay:750ms' }));
    for (const xx of [x15, x85]) {
      svg.appendChild(s('line', { x1: xx, y1: BASE_Y - 4, x2: xx, y2: BASE_Y + 4, stroke: RED, 'stroke-width': 2, class: 'zss-afade', style: 'animation-delay:950ms' }));
    }
    svg.appendChild(s('text', { x: (x15 + x85) / 2, y: BASE_Y - 6, 'text-anchor': 'middle', 'font-size': 9, fill: RED, 'font-weight': 700, class: 'zss-afade', style: 'animation-delay:1000ms' }, ['完了見込み']));
  } else if (p.projectionCurve.length > 1) {
    // フォールバック: 曜日/祝日カーブ
    const pts = p.projectionCurve.map((c) => `${x(parseDate(c.date).getTime()).toFixed(1)},${y(c.remaining).toFixed(1)}`).join(' ');
    svg.appendChild(s('polyline', { points: pts, fill: 'none', stroke: col, 'stroke-width': 2, 'stroke-linejoin': 'round', pathLength: 1, class: 'zss-adraw' }));
  }

  // 実績（日次・再構成）
  if (actual.length > 1) {
    const pts = actual.map((c) => `${x(parseDate(c.date).getTime()).toFixed(1)},${y(c.remaining).toFixed(1)}`).join(' ');
    svg.appendChild(s('polyline', { points: pts, fill: 'none', stroke: 'var(--primary)', 'stroke-width': 2, 'stroke-linejoin': 'round', pathLength: 1, class: 'zss-adraw' }));
    for (const c of actual) {
      svg.appendChild(s('circle', {
        cx: x(parseDate(c.date).getTime()), cy: y(c.remaining), r: 2, fill: 'var(--primary)',
        onmousemove: (e: Event) => {
          const me = e as MouseEvent;
          const d = parseDate(c.date);
          tip.show(me.clientX, me.clientY, `<b>${d.getMonth() + 1}/${d.getDate()}</b> 残 ${Math.round(c.remaining)} 教材`);
        },
        onmouseleave: () => tip.hide(),
      }));
    }
  }
  // 現在点（バーンダウンの起点。線が描かれた後にポップ）
  svg.appendChild(s('circle', {
    cx: x(nowT), cy: y(p.remaining), r: 3.5, fill: 'var(--primary)', stroke: 'var(--surface)', 'stroke-width': 1.5,
    class: 'zss-acell', style: 'animation-delay:900ms',
  }));

  return svg;
}
