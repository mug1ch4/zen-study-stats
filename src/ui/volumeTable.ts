import type { CourseVol, Metrics } from '../courseStats';
import { durationStr } from '../format';
import { h } from '../dom';
import { dataTable } from './dataTable';

/** 教科の統合ビュー（残/総: 教材・動画時間・本数・テスト・レポート）。残の多い順。 */
export function renderSubjects(courses: CourseVol[]): HTMLElement {
  const wrap = h('div', { class: 'zss-vol' }, []);
  const totM = sum(courses, (c) => c.total);
  const remM = sum(courses, (c) => c.remaining);
  const passedMat = courses.reduce((a, c) => a + c.passedMaterials, 0);
  const totalMat = courses.reduce((a, c) => a + c.totalMaterials, 0);
  const pct = totalMat ? Math.round((passedMat / totalMat) * 100) : 0;

  // 全体サマリ（このビューの主役）
  wrap.appendChild(
    h('div', { class: 'zss-vol-summary' }, [
      h('div', { class: 'zss-vol-sum-main' }, [`全${courses.length}コース · 教材 ${passedMat}/${totalMat}（${pct}%）`]),
      h('div', { class: 'zss-vol-chips' }, [
        chip('動画', `残${durationStr(remM.movieSeconds)} / ${durationStr(totM.movieSeconds)}`),
        chip('確認テスト', `残${remM.testCount} / ${totM.testCount}`),
        chip('レポート', `残${remM.reportCount} / ${totM.reportCount}`),
      ]),
    ])
  );

  // 残の多い順
  const sorted = [...courses].sort((a, b) => remMat(b) - remMat(a));
  for (const c of sorted) wrap.appendChild(courseRow(c));

  // 全列テーブル（a11y・精読用）
  wrap.appendChild(
    dataTable(
      'すべての教科を表で見る',
      ['教科', '進捗%', '動画(残/総)', '本(残/総)', 'テスト(残/総)', 'レポート(残/総)'],
      sorted.map((c) => [
        c.title,
        c.totalMaterials ? Math.round((c.passedMaterials / c.totalMaterials) * 100) : 0,
        `${durationStr(c.remaining.movieSeconds)}/${durationStr(c.total.movieSeconds)}`,
        `${c.remaining.movieCount}/${c.total.movieCount}`,
        `${c.remaining.testCount}/${c.total.testCount}`,
        `${c.remaining.reportCount}/${c.total.reportCount}`,
      ])
    )
  );
  return wrap;
}

function courseRow(c: CourseVol): HTMLElement {
  const rem = remMat(c);
  const cpct = c.totalMaterials ? Math.round((c.passedMaterials / c.totalMaterials) * 100) : 0;
  const sub = h('div', { class: 'zss-vol-sub' }, []);
  let expanded = false;

  const head = h('div', { class: 'zss-vol-course-head' }, [
    h('div', { class: 'zss-vol-row-top' }, [
      h('span', { class: 'zss-vol-name' }, [
        c.title,
        ...(c.passedMaterials === 0 && c.totalMaterials > 0 ? [h('span', { class: 'zss-untouched' }, ['未着手'])] : []),
      ]),
      h('span', { class: 'zss-vol-pct' }, [`残${rem} / ${c.totalMaterials}`]),
    ]),
    bar(cpct),
    h('div', { class: 'zss-vol-metrics' }, [
      metricSpan('動画', `残${durationStr(c.remaining.movieSeconds)}/${durationStr(c.total.movieSeconds)}・${c.remaining.movieCount}/${c.total.movieCount}本`),
      metricSpan('テスト', `残${c.remaining.testCount}/${c.total.testCount}`),
      metricSpan('レポート', `残${c.remaining.reportCount}/${c.total.reportCount}`),
    ]),
  ]);
  head.style.cursor = 'pointer';
  head.title = '章別の内訳を開く';
  head.addEventListener('click', () => {
    expanded = !expanded;
    sub.classList.toggle('open', expanded);
    if (expanded && sub.childElementCount === 0) {
      for (const ch of c.chapters) {
        sub.appendChild(
          h('div', { class: 'zss-vol-chap' }, [
            h('span', { class: 'zss-vol-chap-name' }, [ch.title]),
            h('span', { class: 'zss-vol-chap-meta' }, [
              `残${durationStr(ch.remaining.movieSeconds)}・T${ch.remaining.testCount} R${ch.remaining.reportCount}　${ch.passed}/${ch.totalCount}`,
            ]),
          ])
        );
      }
    }
  });

  // コースへ飛ぶリンク（見出しは章展開、右端リンクでコース）
  const open = h('a', { class: 'zss-vol-open', href: `/courses/${c.id}`, title: 'コースを開く' }, ['コースへ ›']);
  return h('div', { class: 'zss-vol-course' }, [head, open, sub]);
}

const remMat = (c: CourseVol) => Math.max(0, c.totalMaterials - c.passedMaterials);
function sum(courses: CourseVol[], pick: (c: CourseVol) => Metrics): Metrics {
  return courses.reduce(
    (a, c) => {
      const m = pick(c);
      a.movieSeconds += m.movieSeconds;
      a.movieCount += m.movieCount;
      a.testCount += m.testCount;
      a.reportCount += m.reportCount;
      return a;
    },
    { movieSeconds: 0, movieCount: 0, testCount: 0, reportCount: 0 }
  );
}
function chip(label: string, value: string): HTMLElement {
  return h('span', { class: 'zss-vol-chip' }, [h('span', { class: 'l' }, [label]), h('span', { class: 'v' }, [value])]);
}
function metricSpan(label: string, value: string): HTMLElement {
  return h('span', { class: 'zss-vol-metric' }, [h('span', { class: 'ml' }, [`${label} `]), value]);
}
function bar(pct: number): HTMLElement {
  const outer = h('div', { class: 'zss-vol-bar' }, []);
  const inner = h('div', { class: 'zss-vol-bar-in' }, []);
  inner.style.width = `${pct}%`;
  outer.appendChild(inner);
  return outer;
}
