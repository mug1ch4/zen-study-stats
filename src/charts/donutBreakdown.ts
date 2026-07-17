import type { CourseVol } from '../courseStats';
import type { WorkTimes, WorkStat } from '../history';
import { s, h } from '../dom';
import { durationStr } from '../format';

// 残り学習量の「時間換算」。動画=実時間。テスト/レポートは3段階で精度を上げる:
//   ①実測（完了検知の間隔から蓄積した教科×種別の 分/問。n>=3 で採用）
//   ②問題数ベース（残り問題数 × 目安分/問）
//   ③固定目安（本数 × 分/本。問題数が取れない場合のフォールバック）
const Q_TEST_MIN = 1.5; // 確認テスト 1問 ≒ 1.5分（目安）
const Q_REPORT_MIN = 2; // レポート 1問 ≒ 2分（目安）
const T_TEST_MIN = 3; // フォールバック: テスト1本 ≒ 3分
const T_REPORT_MIN = 15; // フォールバック: レポート1本 ≒ 15分
const MIN_SAMPLES = 3; // 実測を採用する最低サンプル数
const CAT = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)'];
const OTHER = 'var(--cat-other)';
const MAX_SLICES = 6; // これを超える教科は「その他」へ集約（配色の識別限界に合わせる）

/** 実測(分/問)が使えるか。 */
const usable = (st?: WorkStat): st is WorkStat => !!st && st.n >= MIN_SAMPLES && st.q > 0;

/** 種別ごとの残り時間（分）。実測 > 問題数ベース > 固定目安。 */
function kindMin(count: number, questions: number, measured: WorkStat | undefined, qMin: number, fixedMin: number): number {
  if (count <= 0) return 0;
  if (usable(measured)) {
    const perQ = measured.min / measured.q;
    return questions > 0 ? questions * perQ : count * (measured.min / measured.n);
  }
  return questions > 0 ? questions * qMin : count * fixedMin;
}

/** 教科の残り学習量（分・時間換算）。includeSupp で視聴任意の補助動画も加算。 */
function workloadMin(c: CourseVol, wt?: WorkTimes, includeSupp?: boolean): number {
  const m = wt?.[c.id];
  return (
    c.remaining.movieSeconds / 60 +
    (includeSupp ? (c.supp?.remaining.movieSeconds ?? 0) / 60 : 0) +
    kindMin(c.remaining.testCount, c.remaining.testQuestions ?? 0, m?.test, Q_TEST_MIN, T_TEST_MIN) +
    kindMin(c.remaining.reportCount, c.remaining.reportQuestions ?? 0, m?.report, Q_REPORT_MIN, T_REPORT_MIN)
  );
}

function detailStr(c: CourseVol, includeSupp?: boolean): string {
  const parts: string[] = [];
  if (c.remaining.movieSeconds > 0) parts.push(`動画${durationStr(c.remaining.movieSeconds)}`);
  if (c.remaining.testCount > 0) parts.push(`テスト${c.remaining.testCount}`);
  if (c.remaining.reportCount > 0) parts.push(`レポート${c.remaining.reportCount}`);
  if (includeSupp && (c.supp?.remaining.movieCount ?? 0) > 0) parts.push(`任意${durationStr(c.supp.remaining.movieSeconds)}`);
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
export function renderBreakdownDonut(courses: CourseVol[], wt?: WorkTimes, includeSupp?: boolean): HTMLElement | null {
  const items = courses
    .map((c) => ({ c, w: workloadMin(c, wt, includeSupp) }))
    .filter((x) => x.w > 0.5)
    .sort((a, b) => b.w - a.w);
  if (!items.length) return null; // 残ゼロ＝全消化 → 呼び出し側で扱う

  type Slice = { label: string; w: number; color: string; detail: string };
  const head = items.slice(0, MAX_SLICES);
  const tail = items.slice(MAX_SLICES);
  const slices: Slice[] = head.map((x, i) => ({ label: x.c.title, w: x.w, color: CAT[i], detail: detailStr(x.c, includeSupp) }));
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

  // 実測サンプル数（キャプションで換算の根拠を明示）
  const samples = wt ? Object.values(wt).reduce((a, c) => a + (c.test?.n ?? 0) + (c.report?.n ?? 0), 0) : 0;
  const measuredCourses = wt ? Object.values(wt).filter((c) => usable(c.test) || usable(c.report)).length : 0;
  const cap = samples > 0
    ? `スライス＝残り学習量の目安（動画実時間＋テスト/レポートは問題数×目安。実測 ${samples}件を蓄積中${measuredCourses > 0 ? `・${measuredCourses}教科は実測平均で補正済み` : ''}）。実測は完了検知の間隔から自動蓄積されます。`
    : `スライス＝残り学習量の目安（動画実時間＋テスト/レポートは残り問題数×目安 テスト${Q_TEST_MIN}分/問・レポート${Q_REPORT_MIN}分/問）。テスト/レポートを完了すると所要時間が実測され、教科別に精度が上がります。`;
  return h('div', { class: 'zss-bd' }, [
    h('div', { class: 'zss-bd-top' }, [h('div', { class: 'zss-bd-donut' }, [svg]), legend]),
    h('div', { class: 'zss-bd-cap' }, [cap]),
  ]);
}
