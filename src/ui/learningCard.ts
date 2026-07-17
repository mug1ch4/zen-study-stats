import type { LearningAmounts } from '../api';
import { computeKpis, computeWeekdayStats } from '../derive';
import { weekdayLabel, shortDate } from '../format';
import { h } from '../dom';
import { Tooltip } from './tooltip';
import { renderDailyBars } from '../charts/dailyBars';
import { renderWeekdayBars } from '../charts/weekdayBars';
import { getSeries, getMaterialHistory } from '../history';
import { fetchReportProgresses } from '../api';
import { fetchCourseMaterials } from '../courseApi';
import { calendarData, trendPoints, streakInfo, type TrendMode } from '../deriveHistory';
import { computePrediction, recommendedPace, type Prediction } from '../predictor';
import { renderCalendar } from '../charts/calendar';
import { renderTrend } from '../charts/trend';
import { dataTable } from './dataTable';
import { renderBurndown } from '../charts/burndown';
import { renderDonut } from '../charts/donut';
import { bayesianAverage } from '../shrinkage';
import { computeCourseVolumes } from '../courseStats';
import { renderSubjects } from './volumeTable';
import { renderDataManage } from './dataManage';
import type { CourseMaterial } from '../courseApi';

/** 統合「学習数」カード。常時表示はコンパクトな要点のみ、詳細（グラフ）はタブで直下に展開。 */
export function renderLearningCard(data: LearningAmounts): HTMLElement {
  const kpis = computeKpis(data);
  const tip = new Tooltip();

  const today = data.daily_amount[data.daily_amount.length - 1];
  const todayAmount = today?.amount ?? 0;

  // コンパクトな要点ストリップ（累計＋今日＋平均＋連続）。大きなグラフは詳細タブへ。
  const stat = (value: string, label: string, big = false) =>
    h('div', { class: 'zss-stat' + (big ? ' big' : '') }, [
      h('div', { class: 'v' }, [value]),
      h('div', { class: 'l' }, [label]),
    ]);

  const card = h('div', { class: 'zss-card' }, [
    h('div', { class: 'zss-head' }, [
      h('div', {}, [
        h('h2', { class: 'zss-title' }, ['学習数']),
        h('p', { class: 'zss-sub' }, ['直近14日間 · 2週間ぶんの記録']),
      ]),
      h('span', { class: 'zss-badge' }, ['表示専用 · read-only']),
    ]),

    // 要点ストリップ（1行・コンパクト）
    h('div', { class: 'zss-stats' }, [
      stat(`${kpis.total}`, `累計 · 今日 ${todayAmount}`, true),
      stat(`${data.average_amount}`, '平均/日（2週）'),
      stat(`${kpis.studiedDays}日`, '学習した日'),
      stat(`${kpis.streak}日`, '連続学習'),
    ]),

    h('div', { class: 'zss-foot' }, [
      '表示専用の可視化です。学習数API（直近14日の日別 + 累計 + 2週平均）を GET のみで取得。学習記録は一切変更しません。',
    ]),

    tip.el,
  ]);

  // --- 詳細（タブ）を常時直下に表示（トグルで隠さない＝この拡張の主役） ---
  const details = h('div', { class: 'zss-details open' }, []);
  void populateDetails(details, tip, data, todayAmount);
  const foot = card.querySelector('.zss-foot');
  card.insertBefore(details, foot);
  card.insertBefore(renderDataManage(), foot);

  return card;
}

/** 詳細を [推移][予測][教科] の3タブで直下に表示（遅延描画で重い処理を回避）。
 *  日別バー等の軽いグラフは data から即描画、長期・予測・教科は必要時に取得。 */
async function populateDetails(container: HTMLElement, tip: Tooltip, data: LearningAmounts, todayAmount: number): Promise<void> {
  // 教科データ(軽量)は予測・教科タブで共有（1回だけ取得）
  let coursesP: Promise<CourseMaterial[]> | null = null;
  const getCourses = () => (coursesP ??= fetchCourseMaterials());
  let seriesP: Promise<{ date: string; amount: number }[]> | null = null;
  const getSeriesOnce = () => (seriesP ??= getSeries());

  const panes = [h('div', { class: 'zss-pane' }, []), h('div', { class: 'zss-pane' }, []), h('div', { class: 'zss-pane' }, [])];
  const done = [false, false, false];
  const renderers = [
    () => void renderRecentTab(panes[0], data, getSeriesOnce, tip),
    () => void renderPredictTab(panes[1], getSeriesOnce, getCourses, tip, todayAmount, data),
    () => void renderSubjectsTab(panes[2], getCourses, tip),
  ];
  const select = (i: number) => {
    panes.forEach((p, j) => (p.style.display = j === i ? 'block' : 'none'));
    if (!done[i]) {
      done[i] = true;
      renderers[i]();
    }
  };
  container.appendChild(tabBar(['推移', '予測', '教科'], select));
  for (const p of panes) container.appendChild(p);
  select(0);
}

function tabBar(labels: string[], onSelect: (i: number) => void): HTMLElement {
  const bar = h('div', { class: 'zss-tabs' }, []);
  const btns = labels.map((l, i) => {
    const b = h('button', i === 0 ? { class: 'on' } : {}, [l]);
    b.addEventListener('click', () => {
      btns.forEach((x, j) => x.classList.toggle('on', j === i));
      onSelect(i);
    });
    bar.appendChild(b);
    return b;
  });
  return bar;
}

/** 推移タブ: 日別バー＋曜日別（即時）→ ストリーク/カレンダー/トレンド（長期・非同期）。 */
async function renderRecentTab(
  pane: HTMLElement,
  data: LearningAmounts,
  getSeriesOnce: () => Promise<{ date: string; amount: number }[]>,
  tip: Tooltip
): Promise<void> {
  // --- 直近14日（data から即描画） ---
  pane.appendChild(
    section('日別の学習数', '2週平均を基準線に', [
      wrapChart(renderDailyBars(data.daily_amount, data.average_amount, tip)),
      h('div', { class: 'zss-legend' }, [
        legendItem('var(--primary)', '学習あり'),
        legendItem('var(--faint)', '学習0'),
        dashLegend('記録なし'),
      ]),
      dataTable(
        'データを表で見る',
        ['日付', '曜日', '学習数'],
        data.daily_amount.map((d) => [
          shortDate(d.date),
          weekdayLabel(d.date),
          d.amount === null ? '記録なし' : d.amount,
        ])
      ),
    ])
  );
  pane.appendChild(
    section('曜日別のリズム', '各曜日 = 2週ぶんの平均', [wrapChart(renderWeekdayBars(computeWeekdayStats(data), tip))])
  );

  // --- 長期（自前蓄積・非同期） ---
  const longWrap = h('div', {}, [h('div', { class: 'zss-empty' }, ['長期データを読み込み中…'])]);
  pane.appendChild(longWrap);
  const series = await getSeriesOnce();
  longWrap.textContent = '';
  if (series.length === 0) {
    longWrap.appendChild(
      h('div', { class: 'zss-empty' }, ['長期の記録はこれから。ZEN Studyを開いた日ごとに自動で貯まり、カレンダーやトレンドが育ちます。'])
    );
    return;
  }
  const first = series[0]?.date;
  if (first) {
    const d = new Date(first + 'T12:00:00');
    longWrap.appendChild(
      h('div', { class: 'zss-badge-grow' }, [`${d.getMonth() + 1}月${d.getDate()}日から記録中 · ${series.length}日ぶん`])
    );
  }
  const streak = streakInfo(series);
  longWrap.appendChild(
    h('div', { class: 'zss-kpis' }, [kpiTile(`${streak.current}日`, '現在の連続'), kpiTile(`${streak.longest}日`, '最長の連続')])
  );
  const cal = calendarData(series);
  longWrap.appendChild(
    sectionEl('学習カレンダー', '記録が増えるほど埋まります', [h('div', { class: 'zss-cal-wrap' }, [renderCalendar(cal, tip)]), calLegend()])
  );
  let mode: TrendMode = 'day';
  const trendChart = h('div', { class: 'zss-chart' }, [renderTrend(trendPoints(series, mode), mode, tip)]);
  const seg = h('div', { class: 'zss-seg' }, [] as HTMLElement[]);
  const modes: [TrendMode, string][] = [['day', '日'], ['week', '週'], ['month', '月']];
  const segBtns: HTMLElement[] = [];
  for (const [m, label] of modes) {
    const b = h('button', m === mode ? { class: 'on' } : {}, [label]);
    b.addEventListener('click', () => {
      mode = m;
      segBtns.forEach((x, i) => x.classList.toggle('on', modes[i][0] === mode));
      trendChart.textContent = '';
      trendChart.appendChild(renderTrend(trendPoints(series, mode), mode, tip));
    });
    segBtns.push(b);
    seg.appendChild(b);
  }
  longWrap.appendChild(
    h('div', { class: 'zss-section' }, [
      h('div', { class: 'zss-section-head' }, [h('div', { class: 'zss-section-title' }, ['学習数トレンド']), seg]),
      trendChart,
    ])
  );
}

/** 予測タブ: 年度レポート完了予測（モンテカルロ）。 */
async function renderPredictTab(
  pane: HTMLElement,
  getSeriesOnce: () => Promise<{ date: string; amount: number }[]>,
  getCourses: () => Promise<CourseMaterial[]>,
  tip: Tooltip,
  todayAmount: number,
  data: LearningAmounts
): Promise<void> {
  pane.appendChild(h('div', { class: 'zss-empty' }, ['予測を計算中…']));
  try {
    const series = await getSeriesOnce();
    const report = await fetchReportProgresses();
    const courses = await getCourses();
    const total = courses.reduce((a, c) => a + c.total, 0);
    const passed = courses.reduce((a, c) => a + c.passed, 0);
    const mh = await getMaterialHistory();

    // cold-start シード: 導入直後は自前蓄積が薄い。APIの直近14日窓(data.daily_amount)と
    // 自前履歴を日付でマージし「取れるだけの日次」を確保（新規でも初日から予測を出せる）。
    const dayMap = new Map<string, number>();
    for (const p of series) dayMap.set(p.date, p.amount);
    for (const d of data.daily_amount) if (d.amount != null) dayMap.set(d.date, d.amount);
    const merged = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, amount]) => ({ date, amount }));

    const recentLearn = merged.slice(-14);
    const fallbackPerDay = recentLearn.length ? recentLearn.reduce((a, p) => a + p.amount, 0) / recentLearn.length : undefined;

    // 曜日別ペース: 少数サンプルの曜日は全体平均へ縮小（ベイズ平均 C=3）。外れ日1つで暴れない。
    const wdSum = [0, 0, 0, 0, 0, 0, 0];
    const wdCnt = [0, 0, 0, 0, 0, 0, 0];
    let allSum = 0;
    for (const p of merged) {
      const wd = new Date(p.date + 'T12:00:00').getDay();
      wdSum[wd] += p.amount;
      wdCnt[wd]++;
      allSum += p.amount;
    }
    const overallDaily = merged.length ? allSum / merged.length : 1;
    const weekdayWeights = wdSum.map((s, i) => bayesianAverage(s, wdCnt[i], overallDaily, 3));

    let dailySamples: { weekday: number; value: number }[];
    if (mh.series.length >= 5) {
      dailySamples = [];
      for (let i = 1; i < mh.series.length; i++) {
        const prev = mh.series[i - 1];
        const cur = mh.series[i];
        const gap = Math.max(1, Math.round((new Date(cur.date).getTime() - new Date(prev.date).getTime()) / 86400000));
        dailySamples.push({ weekday: new Date(cur.date + 'T12:00:00').getDay(), value: Math.max(0, (cur.passed - prev.passed) / gap) });
      }
    } else {
      dailySamples = merged.map((p) => ({ weekday: new Date(p.date + 'T12:00:00').getDay(), value: p.amount }));
    }

    const pred = computePrediction({
      totalMaterials: total,
      passedMaterials: passed,
      materialSeries: mh.series,
      finalDeadline: report.finalDeadline,
      months: report.months,
      remainingReports: Math.max(0, report.totalReports - report.passedReports),
      fallbackPerDay,
      courses: courses.map((c) => ({ total: c.total, passed: c.passed })),
      weekdayWeights,
      dailySamples,
    });

    let rem = total - passed;
    const recent14 = merged.slice(-14);
    const actualCurve: { date: string; remaining: number }[] = [];
    for (let i = recent14.length - 1; i >= 0; i--) {
      actualCurve.unshift({ date: recent14[i].date, remaining: rem });
      rem += recent14[i].amount ?? 0;
    }
    pane.textContent = '';
    pane.appendChild(renderPredictorSection(pred, actualCurve, tip, todayAmount));
  } catch (e) {
    console.warn('[ZSS] 完了予測の取得失敗:', e);
    pane.textContent = '';
    pane.appendChild(h('div', { class: 'zss-empty' }, ['予測を取得できませんでした。']));
  }
}

/** 教科タブ: 残教材の一覧（ティアA・即時）＋ ボタンで 動画時間/テスト/レポートの残/総（ティアB・重い）。 */
async function renderSubjectsTab(pane: HTMLElement, getCourses: () => Promise<CourseMaterial[]>, tip: Tooltip): Promise<void> {
  void tip;
  pane.appendChild(h('div', { class: 'zss-empty' }, ['読み込み中…']));
  try {
    const courses = await getCourses();
    pane.textContent = '';
    const tierA = renderSubjectRemaining(courses);
    pane.appendChild(tierA);
    const volBody = h('div', {}, []);
    const volBtn = h('button', { class: 'zss-details-toggle' }, ['動画時間・テスト・レポートの残/総を集計する']) as HTMLButtonElement;
    volBtn.addEventListener('click', () => {
      volBtn.disabled = true;
      volBtn.textContent = '集計中…';
      void computeCourseVolumes((msg) => (volBtn.textContent = msg))
        .then((vols) => {
          tierA.remove();
          volBtn.remove();
          volBody.appendChild(renderSubjects(vols));
        })
        .catch((e) => {
          console.warn('[ZSS] 教材ボリューム集計失敗:', e);
          volBtn.disabled = false;
          volBtn.textContent = '集計する（再試行）';
        });
    });
    pane.appendChild(volBtn);
    pane.appendChild(volBody);
  } catch (e) {
    console.warn('[ZSS] 教科データ取得失敗:', e);
    pane.textContent = '';
    pane.appendChild(h('div', { class: 'zss-empty' }, ['教科データを取得できませんでした。']));
  }
}

function md(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 教科別の残作業内訳（残教材の多い順・未着手を明示）。 */
function renderSubjectRemaining(courses: { id: number; title: string; total: number; passed: number }[]): HTMLElement {
  const sorted = [...courses].sort((a, b) => (b.total - b.passed) - (a.total - a.passed));
  const passedAll = courses.reduce((a, c) => a + c.passed, 0);
  const totalAll = courses.reduce((a, c) => a + c.total, 0);
  const pctAll = totalAll ? Math.round((passedAll / totalAll) * 100) : 0;
  const donutSummary = h('div', { class: 'zss-vol-summary zss-vol-summary-flex' }, [
    renderDonut(passedAll, totalAll, { size: 96, label: '教材' }),
    h('div', { class: 'zss-vol-sum-body' }, [
      h('div', { class: 'zss-vol-sum-main' }, [`全${courses.length}コース · 教材 ${passedAll}/${totalAll}（${pctAll}%）`]),
      h('div', { class: 'zss-vol-sum-note' }, [`残り ${totalAll - passedAll} 教材`]),
    ]),
  ]);
  const rows = sorted.map((c) => {
    const rem = Math.max(0, c.total - c.passed);
    const pct = c.total ? Math.round((c.passed / c.total) * 100) : 0;
    const row = h('a', { class: 'zss-vol-course zss-vol-link', href: `/courses/${c.id}`, title: 'コースを開く' }, [
      h('div', { class: 'zss-vol-row-top' }, [
        h('span', { class: 'zss-vol-name' }, [
          c.title,
          ...(c.passed === 0 ? [h('span', { class: 'zss-untouched' }, ['未着手'])] : []),
        ]),
        h('span', { class: 'zss-vol-pct' }, [`残${rem} / ${c.total} ›`]),
      ]),
      progressBar(pct),
    ]);
    return row;
  });
  return section('教科別の残り', '残教材の多い順', [
    donutSummary,
    ...rows,
    dataTable(
      'データを表で見る',
      ['教科', '残', '完了', '総'],
      sorted.map((c) => [c.title, Math.max(0, c.total - c.passed), c.passed, c.total])
    ),
  ]);
}

function progressBar(pct: number): HTMLElement {
  const outer = h('div', { class: 'zss-vol-bar' }, []);
  const inner = h('div', { class: 'zss-vol-bar-in' }, []);
  inner.style.width = `${pct}%`;
  outer.appendChild(inner);
  return outer;
}

/** 今日のデイリークエスト: 締切から逆算した推奨ペースを「今日あとN教材」に落とす。 */
function renderDailyQuest(pred: Prediction, todayAmount: number): HTMLElement | null {
  if (pred.remaining <= 0) return null; // 消化済みは verdict 側で祝う
  // 推奨ペース = 締切までに終える必要量 / 日（残 / 残り日数）。最低1。
  const target = pred.daysLeft > 0 ? Math.max(1, Math.ceil(pred.remaining / pred.daysLeft)) : pred.remaining;
  const done = Math.max(0, todayAmount);
  const left = Math.max(0, target - done);
  const pct = Math.min(100, Math.round((done / target) * 100));
  const met = left === 0;

  const bar = h('div', { class: 'zss-quest-bar' }, []);
  const fill = h('div', { class: 'zss-quest-fill' + (met ? ' met' : '') }, []);
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);

  return h('div', { class: 'zss-quest' + (met ? ' met' : '') }, [
    h('div', { class: 'zss-quest-top' }, [
      h('span', { class: 'zss-quest-label' }, ['🎯 今日の目標']),
      h('span', { class: 'zss-quest-count' }, [
        h('b', {}, [String(done)]),
        ` / ${target} 教材`,
        h('span', { class: 'zss-quest-left' }, [met ? '　達成！🎉' : `　あと ${left}`]),
      ]),
    ]),
    bar,
    h('div', { class: 'zss-quest-note' }, [
      met
        ? '今日のノルマは達成。この調子でコツコツ進めましょう。'
        : `締切（${md(pred.finalDeadline)}）から逆算した推奨ペースです。`,
    ]),
  ]);
}

function renderPredictorSection(pred: Prediction, actual: { date: string; remaining: number }[], tip: Tooltip, todayAmount: number): HTMLElement {
  // 見出しの判定（モンテカルロの確率・パーセンタイルを主に）
  let verdict: HTMLElement;
  const mc = pred.montecarlo;
  if (pred.remaining === 0) {
    verdict = h('div', { class: 'zss-pred-head ok' }, ['🎉 全教材を消化済み！']);
  } else if (mc && pred.pOnTime !== null) {
    const pct = Math.round(pred.pOnTime * 100);
    const p85 = md(mc.p85);
    const p50 = md(mc.p50);
    if (pred.onTrack) {
      verdict = h('div', { class: 'zss-pred-head ok' }, [
        `${p85} までに完了（85%）`,
        h('span', { class: 'sub' }, [`　${md(pred.finalDeadline)}に間に合う確率 ${pct}%`]),
      ]);
    } else if (pct >= 40) {
      verdict = h('div', { class: 'zss-pred-head warn' }, [
        `間に合う確率 ${pct}%`,
        h('span', { class: 'sub' }, [`　中央値 ${p50} / 85%は ${p85}`]),
      ]);
    } else {
      verdict = h('div', { class: 'zss-pred-head warn' }, [
        `間に合う確率 ${pct}% — ペースを上げましょう`,
        h('span', { class: 'sub' }, [`　85%完了は ${p85}`]),
      ]);
    }
  } else if (pred.projectedFinish && pred.currentPerWeek) {
    // フォールバック（サンプル不足でモンテカルロ不可）
    const finish = md(pred.projectedFinish);
    verdict = h('div', { class: 'zss-pred-head' + (pred.onTrack ? ' ok' : ' warn') }, [
      `暫定見込み ${finish}`,
      h('span', { class: 'sub' }, [pred.onTrack ? '　（間に合う想定）' : '　（遅れ想定）']),
    ]);
  } else {
    verdict = h('div', { class: 'zss-pred-head' }, ['ペース算出中（数日記録すると予測が出ます）']);
  }

  const nums = h('div', { class: 'zss-kpis' }, [
    kpiTile(`${pred.remaining}`, `残教材 / 全${pred.total}`),
    kpiTile(pred.pOnTime !== null ? `${Math.round(pred.pOnTime * 100)}%` : '—', '間に合う確率'),
    kpiTile(pred.currentPerWeek !== null ? `${Math.round(pred.currentPerWeek)}/週` : '—', '現在ペース'),
  ]);

  // 手法別の見立て（併記）
  const methods = h(
    'div',
    { class: 'zss-pred-methods' },
    pred.estimates.map((e) => {
      const used = paceKeyOf(pred.paceSource) === e.key;
      const txt =
        e.perDay <= 0
          ? '未着手の教科あり → 現状のペースでは完了しない'
          : `${md(e.projectedFinish!)} 見込み（${Math.round(e.perDay * 7)}/週）`;
      return h('div', { class: 'm' + (used ? ' used' : '') }, [
        h('span', { class: 'ml' }, [e.label + (used ? ' ★' : '')]),
        h('span', { class: 'mv' }, [txt]),
      ]);
    })
  );

  // 目標日 → 推奨ペース
  const dateInput = h('input', { type: 'date', class: 'zss-target-date' }) as HTMLInputElement;
  dateInput.value = isoDate(pred.finalDeadline);
  dateInput.min = isoDate(new Date());
  const recOut = h('div', { class: 'zss-rec' }, []);
  const updateRec = () => {
    const v = dateInput.value;
    if (!v) return;
    const target = new Date(v + 'T23:59:59+09:00');
    const rec = recommendedPace(pred.remaining, target);
    const curPerDay = pred.currentPerWeek !== null ? pred.currentPerWeek / 7 : null;
    recOut.textContent = '';
    recOut.append(
      h('div', { class: 'zss-rec-main' }, [
        `${md(target)} までに終えるには 1日 ${Math.ceil(rec.perDay)} 教材`,
        h('span', { class: 'sub' }, [`（週 ${Math.round(rec.perWeek)}）`]),
      ]),
      h('div', { class: 'zss-rec-sub' }, [
        curPerDay === null
          ? ''
          : rec.perDay <= curPerDay
            ? `現在ペース ${Math.round(curPerDay)}/日 で到達できます ✓`
            : `現在ペース ${Math.round(curPerDay)}/日 → あと 1日 +${Math.ceil(rec.perDay - curPerDay)} 必要`,
      ])
    );
  };
  dateInput.addEventListener('input', updateRec);
  updateRec();

  const quest = renderDailyQuest(pred, todayAmount);
  return h('div', { class: 'zss-section' }, [
    ...(quest ? [quest] : []),
    h('div', { class: 'zss-section-head' }, [
      h('div', { class: 'zss-section-title' }, ['年度レポート完了予測']),
      h('div', { class: 'zss-section-note' }, [`教材消化ペースで算出 · 締切 ${md(pred.finalDeadline)}`]),
    ]),
    verdict,
    confidenceBadge(pred.confidence),
    h('div', { class: 'zss-pred-note' }, [
      pred.montecarlo
        ? `過去の日次消化を曜日別にサンプリングし ${pred.montecarlo.runs} 回シミュレーション（モンテカルロ）。残レポート ${pred.remainingReports} 件は教材を進めた後にまとめて提出できます。`
        : `直近の学習活動から暫定予測（数日で精度向上）。残レポート ${pred.remainingReports} 件は教材を進めた後にまとめて提出できます。`,
    ]),
    nums,
    h('div', { class: 'zss-chart' }, [renderBurndown(pred, actual, tip)]),
    h('div', { class: 'zss-cal-legend' }, [
      legendLine('var(--muted)', '必要ライン'),
      legendLine(pred.onTrack ? 'var(--success)' : '#d9822b', '予測(帯=P15〜85)'),
      legendItem('var(--primary)', '実績'),
      ...(pred.montecarlo ? [legendLine('#e5484d', '完了見込み'), legendItem('#9b8bd4', '完了分布')] : []),
    ]),
    ...(pred.montecarlo
      ? [
          dataTable('予測データを表で見る', ['指標', '値'], [
            ['締切に間に合う確率', `${Math.round((pred.pOnTime ?? 0) * 100)}%`],
            ['完了 中央値(P50)', md(pred.montecarlo.p50)],
            ['楽観(P15)', md(pred.montecarlo.p15)],
            ['慎重(P85)', md(pred.montecarlo.p85)],
            ['最悪(P95)', md(pred.montecarlo.p95)],
            ['残教材', pred.remaining],
            ['現在ペース/週', pred.currentPerWeek !== null ? Math.round(pred.currentPerWeek) : '—'],
          ]),
        ]
      : []),
    h('details', { class: 'zss-fold' }, [h('summary', {}, ['手法別の見立て（他の推定）']), methods]),
    h('div', { class: 'zss-sub-head' }, ['目標日から逆算']),
    h('div', { class: 'zss-target' }, [h('span', {}, ['完了させたい日:']), dateInput]),
    recOut,
  ]);
}

/** 予測の確度（データ成熟度）バッジ。新規ユーザーに「暫定」を正直に伝える。 */
function confidenceBadge(conf: Prediction['confidence']): HTMLElement {
  const map = {
    low: { cls: 'low', label: '確度 低', note: `データ${conf.days}日ぶん。日々貯まるほど精緻化します（暫定）` },
    medium: { cls: 'mid', label: '確度 中', note: `データ${conf.days}日ぶん。もう少し貯まると安定します` },
    high: { cls: 'high', label: '確度 高', note: `十分なデータ（${conf.days}日ぶん）で算出` },
  }[conf.level];
  return h('div', { class: 'zss-conf ' + map.cls }, [
    h('span', { class: 'zss-conf-dot' }, []),
    h('span', { class: 'zss-conf-label' }, [`予測の${map.label}`]),
    h('span', { class: 'zss-conf-note' }, [`　${map.note}`]),
  ]);
}

function paceKeyOf(src: Prediction['paceSource']): string {
  return src === 'recent' ? 'material' : src;
}

function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function legendLine(color: string, label: string): HTMLElement {
  const e = h('span', { class: 'sw' }, []);
  e.style.background = color;
  return h('span', {}, [e, label]);
}

function kpiTile(value: string, label: string): HTMLElement {
  return h('div', { class: 'zss-kpi' }, [
    h('div', { class: 'k' }, [value]),
    h('div', { class: 'l' }, [label]),
  ]);
}

function calLegend(): HTMLElement {
  const sw = (v: string) => {
    const e = h('span', { class: 'sw' }, []);
    e.style.background = v;
    return e;
  };
  return h('div', { class: 'zss-cal-legend' }, [
    sw('var(--cal-none)'), h('span', {}, ['記録なし']),
    h('span', {}, ['　少']), sw('var(--cal-1)'), sw('var(--cal-2)'), sw('var(--cal-3)'), sw('var(--cal-4)'), h('span', {}, ['多']),
  ]);
}

function sectionEl(title: string, note: string, children: (HTMLElement | SVGElement)[]): HTMLElement {
  return section(title, note, children);
}

function section(title: string, note: string, children: (HTMLElement | SVGElement)[]): HTMLElement {
  return h('div', { class: 'zss-section' }, [
    h('div', { class: 'zss-section-head' }, [
      h('div', { class: 'zss-section-title' }, [title]),
      h('div', { class: 'zss-section-note' }, [note]),
    ]),
    ...children,
  ]);
}

function wrapChart(svg: SVGElement): HTMLElement {
  return h('div', { class: 'zss-chart' }, [svg]);
}

function legendItem(color: string, label: string): HTMLElement {
  const sw = h('span', { class: 'zss-swatch' }, []);
  sw.style.background = color;
  return h('span', {}, [sw, label]);
}

function dashLegend(label: string): HTMLElement {
  const sw = h('span', { class: 'zss-swatch' }, []);
  sw.style.cssText = 'background: none; border-left: 2px dashed var(--faint); border-radius: 0; width: 4px;';
  return h('span', {}, [sw, label]);
}
