import type { CourseVol, Metrics } from '../courseStats';
import { durationStr } from '../format';
import { h } from '../dom';
import { dataTable } from './dataTable';
import { renderDonut } from '../charts/donut';
import { renderBreakdownDonut } from '../charts/donutBreakdown';

import type { WorkTimes } from '../history';
import { avgWorkMinutes } from '../studyTimeEst';

/** 残りの時間換算（動画=実尺・テスト/レポート=所要実測 or 既定値）。 */
function remainSecOf(c: CourseVol, wt?: WorkTimes): number {
  const w = wt ?? {};
  return c.remaining.movieSeconds + c.remaining.testCount * avgWorkMinutes(w, c.id, 'test') * 60 + c.remaining.reportCount * avgWorkMinutes(w, c.id, 'report') * 60;
}

export interface SubjectsOpts {
  includeSupp?: boolean; // 視聴任意の補助動画を残り学習量に含める
  onToggleSupp?: (v: boolean) => void;
}

/** 教科の統合ビュー（残/総: 教材・動画時間・本数・テスト・レポート）。残の多い順。 */
export function renderSubjects(courses: CourseVol[], wt?: WorkTimes, opts?: SubjectsOpts): HTMLElement {
  const wrap = h('div', { class: 'zss-vol' }, []);
  const totM = sum(courses, (c) => c.total);
  const remM = sum(courses, (c) => c.remaining);
  const passedMat = courses.reduce((a, c) => a + c.passedMaterials, 0);
  const totalMat = courses.reduce((a, c) => a + c.totalMaterials, 0);
  const pct = totalMat ? Math.round((passedMat / totalMat) * 100) : 0;

  // 全体サマリ（このビューの主役）: 進捗ドーナツ ＋ 残/総チップ
  wrap.appendChild(
    h('div', { class: 'zss-vol-summary zss-vol-summary-flex' }, [
      renderDonut(passedMat, totalMat, { size: 96, label: '教材' }),
      h('div', { class: 'zss-vol-sum-body' }, [
        h('div', { class: 'zss-vol-sum-main' }, [
          `全${courses.length}コース · 教材 ${passedMat}/${totalMat}（${pct}%）· 残り ≈ ${durationStr(courses.reduce((a, c) => a + remainSecOf(c, wt), 0))}`,
        ]),
        h('div', { class: 'zss-vol-chips' }, [
          chip('動画', `残${durationStr(remM.movieSeconds)} / ${durationStr(totM.movieSeconds)}`),
          chip('確認テスト', `残${remM.testCount} / ${totM.testCount}`),
          chip('レポート', `残${remM.reportCount} / ${totM.reportCount}`),
        ]),
      ]),
    ])
  );

  // 教科別の残り学習量シェア（色分けドーナツ）。残があるときのみ。
  const breakdown = renderBreakdownDonut(courses, wt, opts?.includeSupp);
  if (breakdown) {
    const body = h('div', {}, [breakdown]);
    // 視聴任意（supplement）を含めるかの設定（本家準拠の完了%・予測には影響しない）
    const suppTotal = courses.reduce((a, c) => a + (c.supp?.total.movieCount ?? 0), 0);
    if (suppTotal > 0 || opts?.includeSupp) {
      const cb = h('input', { type: 'checkbox', id: 'zss-inc-supp' }) as HTMLInputElement;
      cb.checked = !!opts?.includeSupp;
      cb.addEventListener('change', () => opts?.onToggleSupp?.(cb.checked));
      body.appendChild(
        h('label', { class: 'zss-supp-toggle', for: 'zss-inc-supp' }, [
          cb,
          `視聴任意の補助動画（全${suppTotal}本）を残り学習量に含める`,
        ])
      );
    }
    wrap.appendChild(sectionCard('教科別の残り学習量シェア', body));
  }

  // 残の多い順
  const sorted = [...courses].sort((a, b) => remMat(b) - remMat(a));
  for (const c of sorted) wrap.appendChild(courseRow(c, wt));

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

function courseRow(c: CourseVol, wt?: WorkTimes): HTMLElement {
  const rem = remMat(c);
  const remSec = remainSecOf(c, wt);
  const cpct = c.totalMaterials ? Math.round((c.passedMaterials / c.totalMaterials) * 100) : 0;
  const sub = h('div', { class: 'zss-vol-sub' }, []);
  let expanded = false;

  const head = h('div', { class: 'zss-vol-course-head' }, [
    h('div', { class: 'zss-vol-row-top' }, [
      h('span', { class: 'zss-vol-name' }, [
        c.title,
        ...(c.passedMaterials === 0 && c.totalMaterials > 0 ? [h('span', { class: 'zss-untouched' }, ['未着手'])] : []),
      ]),
      h('span', { class: 'zss-vol-pct' }, [rem > 0 ? `残${rem} / ${c.totalMaterials} ≈ ${durationStr(remSec)}` : `残${rem} / ${c.totalMaterials}`]),
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
      a.testQuestions += m.testQuestions;
      a.reportQuestions += m.reportQuestions;
      return a;
    },
    { movieSeconds: 0, movieCount: 0, testCount: 0, reportCount: 0, testQuestions: 0, reportQuestions: 0 }
  );
}
function sectionCard(title: string, body: HTMLElement): HTMLElement {
  return h('div', { class: 'zss-section' }, [
    h('div', { class: 'zss-section-head' }, [h('div', { class: 'zss-section-title' }, [title])]),
    body,
  ]);
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
