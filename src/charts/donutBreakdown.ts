import type { CourseVol } from '../courseStats';
import { s, h } from '../dom';
import { durationStr } from '../format';

// 残り学習量の「時間換算」重み。動画は実時間、テスト/レポートは目安時間で加味する。
// （割合の視覚化が目的。厳密値ではないためキャプションで前提を明示する。）
// TODO(将来): 完了検知の実測（教科ごとにテスト/レポートに実際どれだけ掛かったか）を蓄積し、
//   固定の目安値ではなく教科別の実測平均で重み付けして精度を上げる。
const T_TEST_MIN = 3; // 確認テスト1本 ≒ 3分（暫定デフォルト。将来は実測で教科別に補正）
const T_REPORT_MIN = 15; // レポート1本 ≒ 15分（暫定デフォルト。将来は実測で教科別に補正）
const CAT = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)'];
const OTHER = 'var(--cat-other)';
const MAX_SLICES = 6; // これを超える教科は「その他」へ集約（配色の識別限界に合わせる）

/** 教科の残り学習量（分・時間換算）。 */
function workloadMin(c: CourseVol): number {
  return c.remaining.movieSeconds / 60 + c.remaining.testCount * T_TEST_MIN + c.remaining.reportCount * T_REPORT_MIN;
}

function detailStr(c: CourseVol): string {
  const parts: string[] = [];
  if (c.remaining.movieSeconds > 0) parts.push(`動画${durationStr(c.remaining.movieSeconds)}`);
  if (c.remaining.testCount > 0) parts.push(`テスト${c.remaining.testCount}`);
  if (c.remaining.reportCount > 0) parts.push(`レポート${c.remaining.reportCount}`);
  return parts.join('・');
}

/** 時間のコンパクト表記（中央用）。60分以上は時間丸め。 */
function compactHours(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m}分`;
  const hh = m / 60;
  return hh >= 10 ? `${Math.round(hh)}h` : `${(Math.round(hh * 10) / 10).toString()}h`;
}

/**
 * 教科別に色分けした「残り学習量の割合」ドーナツ。
 * 割合＝動画時間＋テスト/レポート数(時間換算) の合計に占める各教科のシェア。
 * ※円は面積比較が苦手なため、凡例＋シェア%＋スライス間ギャップで二次符号化する（dataviz 準拠）。
 */
export function renderBreakdownDonut(courses: CourseVol[]): HTMLElement | null {
  const items = courses
    .map((c) => ({ c, w: workloadMin(c) }))
    .filter((x) => x.w > 0.5)
    .sort((a, b) => b.w - a.w);
  if (!items.length) return null; // 残ゼロ＝全消化 → 呼び出し側で扱う

  type Slice = { label: string; w: number; color: string; detail: string };
  const head = items.slice(0, MAX_SLICES);
  const tail = items.slice(MAX_SLICES);
  const slices: Slice[] = head.map((x, i) => ({ label: x.c.title, w: x.w, color: CAT[i], detail: detailStr(x.c) }));
  if (tail.length) {
    slices.push({ label: `その他 ${tail.length}教科`, w: tail.reduce((a, x) => a + x.w, 0), color: OTHER, detail: '' });
  }
  const totalW = slices.reduce((a, sl) => a + sl.w, 0) || 1;

  // --- SVG ドーナツ ---
  const size = 136, stroke = 20, cx = size / 2, cy = size / 2, r = cx - stroke / 2 - 1;
  const C = 2 * Math.PI * r;
  const GAP = slices.length > 1 ? 3 : 0; // スライス間ギャップ(px)＝二次符号化
  const svg = s('svg', {
    viewBox: `0 0 ${size} ${size}`, width: size, height: size,
    role: 'img', 'aria-label': '教科別の残り学習量の割合',
  });
  svg.appendChild(s('circle', { cx, cy, r, fill: 'none', stroke: 'var(--border)', 'stroke-width': stroke }));
  let cum = 0;
  slices.forEach((sl, i) => {
    const arc = (sl.w / totalW) * C;
    const vis = Math.max(0.5, arc - GAP);
    svg.appendChild(
      s('circle', {
        cx, cy, r, fill: 'none', stroke: sl.color, 'stroke-width': stroke,
        'stroke-dasharray': `${vis.toFixed(2)} ${(C - vis).toFixed(2)}`,
        'stroke-dashoffset': `${(-cum).toFixed(2)}`,
        transform: `rotate(-90 ${cx} ${cy})`,
        class: 'zss-aslice', style: `animation-delay:${i * 70}ms`,
      })
    );
    cum += arc;
  });
  // 中央: 残り学習量（時間）
  svg.appendChild(
    s('text', { x: cx, y: cy - 4, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 20, 'font-weight': 800, fill: 'var(--ink)' }, [compactHours(totalW)])
  );
  svg.appendChild(
    s('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', 'font-size': 9, fill: 'var(--muted)' }, ['残り学習量'])
  );

  // --- 凡例（色＝教科。シェア%と内訳を併記＝色以外でも識別可能） ---
  const legend = h('div', { class: 'zss-bd-legend' },
    slices.map((sl) => {
      const share = Math.round((sl.w / totalW) * 100);
      return h('div', { class: 'zss-bd-item' }, [
        h('span', { class: 'zss-bd-sw' }, []),
        h('span', { class: 'zss-bd-name' }, [sl.label]),
        h('span', { class: 'zss-bd-share' }, [`${share}%`]),
        sl.detail ? h('span', { class: 'zss-bd-detail' }, [sl.detail]) : null,
      ]);
    })
  );
  // スウォッチ色はCSS変数なので inline 背景で反映
  legend.querySelectorAll('.zss-bd-sw').forEach((el, i) => {
    (el as HTMLElement).style.background = slices[i].color;
  });

  return h('div', { class: 'zss-bd' }, [
    h('div', { class: 'zss-bd-top' }, [h('div', { class: 'zss-bd-donut' }, [svg]), legend]),
    h('div', { class: 'zss-bd-cap' }, [`スライス＝残り学習量の目安（動画時間 ＋ 確認テスト×${T_TEST_MIN}分 ＋ レポート×${T_REPORT_MIN}分）。テスト/レポートの所要は暫定値で、将来は実測で教科別に精度向上予定。`]),
  ]);
}
