import type { LearningAmounts } from '../api';
import { computeKpis, computeWeekdayStats } from '../derive';
import { weekdayLabel, shortDate, zenToday } from '../format';
import { h } from '../dom';
import { Tooltip } from './tooltip';
import { renderDailyBars } from '../charts/dailyBars';
import { renderWeekdayBars } from '../charts/weekdayBars';
import { getSeries, getMaterialHistory, getTargetDate, setTargetDate, getHourStats, getDayStart, ensureDayStart, getWeekStart, ensureWeekStart, weekBaselinePassed, getWeekGoal, setWeekGoal, savePredSnapshot, getPredLog, getAchievementDates, recordAchievements, getWorkTimes, getIncludeSupp, setIncludeSupp, getCoursePassedHistory, recordDeadlineOutcomes, getDeadlineOutcomes } from '../history';
import { ACHIEVEMENTS, computeUnlocked, type AchInput } from '../achievements';
import { evaluateCalibration } from '../calibration';
import { reportDeadlineStatus, type DeadlineStatus } from '../deadlines';
import { computeCourseDeadlineRisks, type CourseDeadlineRisk } from '../deadlineRisk';
import { computeCoursePaces } from '../coursePace';
import { fetchMonthlyReport } from '../api';
import { zenWeekStartISO } from '../format';
import { weekdayTendency, monthlyTendency, holidayTendency, consistencyTendency, timeOfDayTendency, requiredAdvice, trendTendency, distributionSummary, workTimeTendency, journeySummary, deadlineTendency, coursePaceTendency, type Section } from '../analysis';
import { buildPlanIcs, downloadText } from '../ics';
import { getNearDoneChapters } from '../courseApi';
import { motivationNudges, type Nudge } from '../motivation';
import { countUp } from '../anim';
import { notifyProgress, notifyQuest } from '../notify';
import { getNotifyLog } from './toast';
import { fetchReportProgresses } from '../api';
import { fetchCourseMaterials } from '../courseApi';
import { calendarData, trendPoints, streakInfo, type TrendMode } from '../deriveHistory';
import { computePrediction, recommendedPace, type Prediction } from '../predictor';
import { renderCalendar } from '../charts/calendar';
import { renderTrend } from '../charts/trend';
import { dataTable } from './dataTable';
import { renderBurndown } from '../charts/burndown';
import { renderDonut } from '../charts/donut';
import { renderHourBars } from '../charts/hourBars';
import { bayesianAverage } from '../shrinkage';
import { computeCourseVolumes } from '../courseStats';
import { renderSubjects } from './volumeTable';
import { renderDataManage } from './dataManage';
import { renderResultLogFold } from './resultLogUi';
import { getTimerEnabled, setTimerEnabled } from '../testTimer';
import { getResultLog, getChapterSkels } from '../resultLog';
import { retroSections, retroHours, resultEvents } from '../resultStats';
import { interpolateMovieEvents, movieHours } from '../movieInterp';
import { renderPunch, type PunchEvent } from '../charts/punch';
import type { CourseMaterial } from '../courseApi';

/** 統合「学習数」カード。常時表示はコンパクトな要点のみ、詳細（グラフ）はタブで直下に展開。 */
export function renderLearningCard(data: LearningAmounts, opts?: { defaultTab?: number }): HTMLElement {
  const kpis = computeKpis(data);
  const tip = new Tooltip();

  const today = data.daily_amount[data.daily_amount.length - 1];
  const todayAmount = today?.amount ?? 0;

  // コンパクトな要点ストリップ（累計＋今日＋平均＋連続）。大きなグラフは詳細タブへ。
  const stat = (value: string, label: string, big = false) => {
    const v = h('div', { class: 'v' }, []);
    countUp(v, value); // 0→値へカウントアップ（reduced-motion では即確定）
    return h('div', { class: 'zss-stat' + (big ? ' big' : '') }, [v, h('div', { class: 'l' }, [label])]);
  };

  const card = h('div', { class: 'zss-card' }, [
    h('div', { class: 'zss-head' }, [
      h('div', {}, [
        h('h2', { class: 'zss-title' }, ['学習数']),
        h('p', { class: 'zss-sub' }, ['直近14日間 · 2週間ぶんの記録']),
      ]),
      h('div', { class: 'zss-head-right' }, [
        h('span', { class: 'zss-badge' }, ['表示専用 · read-only']),
        h('span', { class: 'zss-ver' }, [`v${__APP_VERSION__}`]),
      ]),
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
  void populateDetails(details, tip, data, opts?.defaultTab ?? 0);
  const foot = card.querySelector('.zss-foot');
  card.insertBefore(details, foot);
  card.insertBefore(renderNotifyLog(), foot);
  card.insertBefore(renderResultLogFold(renderInsightSection), foot); // 重要機能なので先頭・アクセント表示
  card.insertBefore(renderDisplaySettings(), foot);
  card.insertBefore(renderDataManage(), foot);

  return card;
}

/** 詳細ログ未収集時の誘導カード（分析タブ）: クリックで抽出フォールドへスクロール＆展開。 */
function renderRetroCta(pane: HTMLElement): HTMLElement {
  const btn = h('button', { class: 'zss-rl-cta-btn' }, ['詳細ログの抽出へ']) as HTMLButtonElement;
  btn.addEventListener('click', () => {
    const root = pane.getRootNode() as ShadowRoot;
    const fold = root.querySelector?.('details.zss-rl') as HTMLDetailsElement | null;
    if (!fold) return;
    fold.open = true;
    fold.scrollIntoView({ behavior: 'smooth', block: 'center' });
    fold.classList.add('flash');
    window.setTimeout(() => fold.classList.remove('flash'), 2400);
  });
  return h('div', { class: 'zss-rl-cta' }, [
    h('div', {}, [
      h('b', {}, ['過去の学習記録を復元できます。']),
      ' テスト/レポートの受験日時（導入以前も含む）を一度収集すると、日別の学習時刻・初回合格率・レポート得点率・動画視聴時刻の補間など実測ベースの分析が有効になります。',
    ]),
    btn,
  ]);
}

/** 表示設定: 所要時間タイマーのON/OFF（今後の表示系オプションの置き場）。 */
function renderDisplaySettings(): HTMLElement {
  const hasStore = typeof chrome !== 'undefined' && !!chrome?.storage?.local;
  if (!hasStore) {
    return h('details', { class: 'zss-fold zss-dm' }, [
      h('summary', {}, ['表示設定']),
      h('p', { class: 'zss-dm-note' }, ['拡張機能として動作しているときに設定できます（このデモでは無効です）。']),
    ]);
  }
  const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  void getTimerEnabled().then((v) => {
    cb.checked = v;
  });
  cb.addEventListener('change', () => void setTimerEnabled(cb.checked));
  return h('details', { class: 'zss-fold zss-dm' }, [
    h('summary', {}, ['表示設定']),
    h('label', { class: 'zss-setting-row' }, [
      cb,
      h('span', {}, ['未提出のテスト/レポート画面に所要時間タイマーを表示（教材ごとに累計・提出時に「所要時間の実測」へ自動記録。タブ非表示中は停止）']),
    ]),
  ]);
}

/** 通知履歴（トーストは消えるが、ここで見返せる）。開いた時に読み込み。 */
function renderNotifyLog(): HTMLElement {
  const body = h('div', { class: 'zss-nlog' }, []);
  const det = h('details', { class: 'zss-fold' }, [h('summary', {}, ['通知履歴']), body]) as HTMLDetailsElement;
  const fill = async (): Promise<void> => {
    const log = await getNotifyLog();
    body.textContent = '';
    if (!log.length) {
      body.appendChild(h('div', { class: 'zss-empty' }, ['まだ通知はありません。節目達成・デイリー/週間目標・週次レビューなどの通知がここに残ります。']));
      return;
    }
    for (const e of log) {
      const d = new Date(e.ts);
      const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const row = h('div', { class: 'zss-nlog-row' }, [
        h('span', { class: 'zss-nlog-t' }, [when]),
        h('span', { class: 'zss-nlog-m' }, [e.text]),
      ]);
      if (e.accent) row.style.borderLeftColor = e.accent;
      body.appendChild(row);
    }
  };
  det.addEventListener('toggle', () => {
    if (det.open) void fill();
  });
  return det;
}

/** 詳細を [推移][予測][教科] の3タブで直下に表示（遅延描画で重い処理を回避）。
 *  日別バー等の軽いグラフは data から即描画、長期・予測・教科は必要時に取得。 */
async function populateDetails(container: HTMLElement, tip: Tooltip, data: LearningAmounts, defaultTab = 0): Promise<void> {
  // 教科データ(軽量)は予測・教科タブで共有（1回だけ取得）
  let coursesP: Promise<CourseMaterial[]> | null = null;
  const getCourses = () => (coursesP ??= fetchCourseMaterials());
  let seriesP: Promise<{ date: string; amount: number }[]> | null = null;
  const getSeriesOnce = () => (seriesP ??= getSeries());

  const panes = [0, 1, 2, 3].map(() => h('div', { class: 'zss-pane' }, []));
  const done = [false, false, false, false];
  const renderers = [
    () => void renderRecentTab(panes[0], data, getSeriesOnce, tip),
    () => void renderPredictTab(panes[1], getSeriesOnce, getCourses, tip, data),
    () => void renderSubjectsTab(panes[2], getCourses, tip),
    () => void renderAnalysisTab(panes[3], getSeriesOnce, getCourses, data),
  ];
  const select = (i: number) => {
    panes.forEach((p, j) => (p.style.display = j === i ? 'block' : 'none'));
    if (!done[i]) {
      done[i] = true;
      renderers[i]();
    }
  };
  // 完了検知（content.ts が確定分の下流で zss:completion を発火）で、描画済みの
  // 予測タブ（今日の目標）と教科タブ（進捗ドーナツ）を最新の教科データで再描画する。
  const onCompletion = () => {
    if (!container.isConnected) { window.removeEventListener('zss:completion', onCompletion); return; }
    coursesP = fetchCourseMaterials(); // メモ化キャッシュを最新の完了数で差し替え
    if (done[1]) void renderPredictTab(panes[1], getSeriesOnce, getCourses, tip, data);
    if (done[2]) void renderSubjectsTab(panes[2], getCourses, tip);
  };
  window.addEventListener('zss:completion', onCompletion);
  container.appendChild(tabBar(['推移', '予測', '教科', '分析'], select, defaultTab));
  for (const p of panes) container.appendChild(p);
  select(defaultTab);
}

function tabBar(labels: string[], onSelect: (i: number) => void, initial = 0): HTMLElement {
  const bar = h('div', { class: 'zss-tabs' }, []);
  const btns = labels.map((l, i) => {
    const b = h('button', i === initial ? { class: 'on' } : {}, [l]);
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
    section('日別の学習数', '2週平均を基準線に · 棒=学習あり／薄い印=0／破線=記録なし', [
      wrapChart(renderDailyBars(data.daily_amount, data.average_amount, tip)),
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
  // --- 長期（自前蓄積・非同期） ＋ 曜日リズム（直近2週） ---
  const longWrap = h('div', {}, [h('div', { class: 'zss-empty' }, ['読み込み中…'])]);
  pane.appendChild(longWrap);
  const series = await getSeriesOnce();
  longWrap.textContent = '';
  const hasLong = series.length > 0;

  // 記録メタ（開始日・日数・最長連続を1行に集約）。現在の連続はカード上部の要点(連続学習)と重複するため省く。
  if (hasLong) {
    const streak = streakInfo(series);
    const metaBits: string[] = [];
    const first = series[0]?.date;
    if (first) {
      const d = new Date(first + 'T12:00:00');
      metaBits.push(`${d.getMonth() + 1}月${d.getDate()}日から記録中`);
    }
    metaBits.push(`${series.length}日ぶん`);
    metaBits.push(`最長の連続 ${streak.longest}日`);
    longWrap.appendChild(h('div', { class: 'zss-badge-grow' }, [metaBits.join(' · ')]));
  } else {
    longWrap.appendChild(
      h('div', { class: 'zss-tsub-note' }, ['長期の記録はこれから（開いた日ごとに自動で貯まります）。曜日の傾向は直近2週から表示。'])
    );
  }

  // 長期チャートはセグメントで1枚ずつ表示（縦積みを回避）: カレンダー / トレンド / 時間帯 / 曜日。
  const longView = h('div', {}, []);
  const views: [string, string][] = [['cal', 'カレンダー'], ['trend', 'トレンド'], ['hour', '時間帯'], ['weekday', '曜日']];
  const segBtns: HTMLElement[] = [];
  const cache: Record<string, HTMLElement> = {};
  let curView = hasLong ? 'cal' : 'weekday';

  const buildCal = (): HTMLElement =>
    hasLong
      ? h('div', {}, [
          h('div', { class: 'zss-tsub-note' }, ['記録が増えるほど埋まります']),
          h('div', { class: 'zss-cal-wrap' }, [renderCalendar(calendarData(series), tip)]),
          calLegend(),
        ])
      : h('div', { class: 'zss-empty' }, ['記録が数日貯まるとカレンダーが表示されます。']);

  const buildWeekday = (): HTMLElement =>
    h('div', {}, [
      h('div', { class: 'zss-tsub-note' }, ['各曜日 = 直近2週ぶんの平均']),
      wrapChart(renderWeekdayBars(computeWeekdayStats(data), tip)),
    ]);

  const buildTrend = (): HTMLElement => {
    if (!hasLong) return h('div', { class: 'zss-empty' }, ['記録が数日貯まるとトレンドが表示されます。']);
    let mode: TrendMode = 'week'; // 直近14日の日別バーと差別化して既定は週合計
    const trendChart = h('div', { class: 'zss-chart' }, [renderTrend(trendPoints(series, mode), mode, tip)]);
    const seg = h('div', { class: 'zss-seg' }, [] as HTMLElement[]);
    const modes: [TrendMode, string][] = [['day', '日'], ['week', '週'], ['month', '月']];
    const btns: HTMLElement[] = [];
    for (const [m, label] of modes) {
      const b = h('button', m === mode ? { class: 'on' } : {}, [label]);
      b.addEventListener('click', () => {
        mode = m;
        btns.forEach((x, i) => x.classList.toggle('on', modes[i][0] === mode));
        trendChart.textContent = '';
        trendChart.appendChild(renderTrend(trendPoints(series, mode), mode, tip));
      });
      btns.push(b);
      seg.appendChild(b);
    }
    return h('div', {}, [h('div', { class: 'zss-tsub' }, [seg]), trendChart]);
  };

  // 時間帯: ソース切替（完了検知=ライブ実測 / 受験記録=詳細ログの遡及実測＋動画補間）。
  // 導入後の提出は両方に記録されるため合算はしない（二重計上防止）。
  const buildHour = async (): Promise<HTMLElement> => {
    const [hs, rlog, skels] = await Promise.all([getHourStats(), getResultLog().catch(() => []), getChapterSkels().catch(() => ({}))]);
    // 動画の視聴時刻: 前後の受験アンカー間の時間幅が動画の合計実時間と整合する場合のみ補間採用
    // （倍速不可・直列という本家仕様が根拠。中断を挟んだ窓は不採用）
    const movieEvents = interpolateMovieEvents(skels, rlog);
    const retro = retroHours(rlog);
    const mHours = movieHours(movieEvents);
    for (let i = 0; i < 24; i++) retro[i] += mHours[i];
    const liveTotal = hs.study.reduce((a, b) => a + b, 0);
    const retroTotal = retro.reduce((a, b) => a + b, 0);
    if (!liveTotal && !retroTotal) {
      return h('div', { class: 'zss-empty' }, [
        'PCで動画/テスト等を完了すると、その時刻を記録します（数回で傾向が出ます）。カード下部の「詳細ログの抽出」を実行すると、過去の受験時刻からも表示できます。',
      ]);
    }
    // 日別パンチカード用イベント（受験＝実測・動画＝補間）
    const punchEvents: PunchEvent[] = [
      ...resultEvents(rlog).map((e) => ({ at: e.at, kind: 'sub' as const })),
      ...movieEvents.map((m) => ({ at: m.at, kind: 'movie' as const, u: m.uncertaintySec })),
    ];
    const NOTES = {
      live: '学習が進む時間帯（完了検知でその時刻を記録・自動更新）',
      retro: `受験の時間帯・全期間の合計（詳細ログ＝テスト/レポートの受験日時。導入以前も含む実測${movieEvents.length ? `＋動画${movieEvents.length}本を前後の受験時刻から補間` : '・動画の視聴時刻は前後の受験間隔が整合する場合のみ補間'}）`,
      punch: '日別の学習時刻（縦=時刻・5時はじまり。●受験は分単位の実測・小さい●動画は前後の受験間隔が整合する場合のみ補間）',
    } as const;
    let hmode: 'live' | 'retro' | 'punch' = liveTotal > 0 ? 'live' : 'retro';
    const note = h('div', { class: 'zss-tsub-note' }, []);
    const chartWrap = h('div', {}, []);
    const seg = h('div', { class: 'zss-seg' }, []);
    const hmodes: ['live' | 'retro' | 'punch', string][] = [['live', '完了検知'], ['retro', '受験·平均'], ['punch', '受験·日別']];
    const btns: HTMLElement[] = [];
    const apply = (): void => {
      btns.forEach((x, i) => x.classList.toggle('on', hmodes[i][0] === hmode));
      note.textContent = NOTES[hmode];
      chartWrap.textContent = '';
      const emptyNote = (m: typeof hmode): HTMLElement =>
        h('div', { class: 'zss-empty' }, [
          m === 'live'
            ? 'PCで動画/テスト等を完了すると、その時刻を記録します（数回で傾向が出ます）。'
            : 'カード下部の「詳細ログの抽出」を実行すると、過去の受験時刻から表示できます。',
        ]);
      if (hmode === 'punch') {
        chartWrap.appendChild(punchEvents.length ? wrapChart(renderPunch(punchEvents, tip)) : emptyNote(hmode));
        return;
      }
      const dataArr = hmode === 'live' ? hs.study : retro;
      chartWrap.appendChild(dataArr.reduce((a, b) => a + b, 0) > 0 ? wrapChart(renderHourBars(dataArr, tip)) : emptyNote(hmode));
    };
    for (const [m, label] of hmodes) {
      const b = h('button', {}, [label]);
      b.addEventListener('click', () => {
        hmode = m;
        apply();
      });
      btns.push(b);
      seg.appendChild(b);
    }
    apply();
    return h('div', {}, [h('div', { class: 'zss-tsub' }, [seg]), note, chartWrap]);
  };

  const showView = async (v: string): Promise<void> => {
    curView = v;
    segBtns.forEach((x, i) => x.classList.toggle('on', views[i][0] === v));
    if (!cache[v]) {
      cache[v] =
        v === 'hour' ? await buildHour()
        : v === 'trend' ? buildTrend()
        : v === 'weekday' ? buildWeekday()
        : buildCal();
    }
    longView.textContent = '';
    longView.appendChild(cache[v]);
  };

  const segOuter = h('div', { class: 'zss-seg' }, [] as HTMLElement[]);
  for (const [v, label] of views) {
    const b = h('button', {}, [label]);
    b.addEventListener('click', () => void showView(v));
    segBtns.push(b);
    segOuter.appendChild(b);
  }
  longWrap.appendChild(
    h('div', { class: 'zss-section' }, [
      h('div', { class: 'zss-section-head' }, [h('div', { class: 'zss-section-title' }, ['傾向グラフ']), segOuter]),
      longView,
    ])
  );
  await showView(curView);

  // 時間帯は完了検知でライブ更新（表示中のときのみ再描画）。
  const onHourUpdate = (): void => {
    if (!longView.isConnected) {
      window.removeEventListener('zss:hourupdate', onHourUpdate);
      return;
    }
    delete cache['hour'];
    if (curView === 'hour') void showView('hour');
  };
  window.addEventListener('zss:hourupdate', onHourUpdate);
}

/** 予測タブ: 年度レポート完了予測（モンテカルロ）。 */
async function renderPredictTab(
  pane: HTMLElement,
  getSeriesOnce: () => Promise<{ date: string; amount: number }[]>,
  getCourses: () => Promise<CourseMaterial[]>,
  tip: Tooltip,
  data: LearningAmounts
): Promise<void> {
  pane.textContent = ''; // 完了検知の再描画時、旧内容の下に「計算中」が積まれるのを防ぐ
  pane.appendChild(h('div', { class: 'zss-empty' }, ['予測を計算中…']));
  try {
    const series = await getSeriesOnce();
    const report = await fetchReportProgresses();
    void recordDeadlineOutcomes(report.months); // 締切前の観測値を更新（完了直後の再描画でも新鮮に保つ）
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
        // 【頑健フォールバック】必修コースが年度で入替わると passed/total が不連続に変化する。
        // その区間の差分は「学習量」ではないのでサンプルから除外する。構造を仮定せず、次の
        // どれかに当てはまれば捨てる（検知ではなく防御）:
        //   (a) total が変化した（記録がある場合）＝コースセットが変わった
        //   (b) passed が減少した＝科目リセット/入替（total未記録の旧データでも効く）
        if (prev.total !== undefined && cur.total !== undefined && prev.total !== cur.total) continue;
        if (cur.passed < prev.passed) continue;
        const gap = Math.max(1, Math.round((new Date(cur.date).getTime() - new Date(prev.date).getTime()) / 86400000));
        dailySamples.push({ weekday: new Date(cur.date + 'T12:00:00').getDay(), value: (cur.passed - prev.passed) / gap });
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
    const savedTarget = await getTargetDate();
    const electivesNote =
      report.takingCourseCount > report.requiredCourseCount
        ? `※「学習数」（累計・日別）は非必修コースも含みます（履修${report.takingCourseCount} / 必修${report.requiredCourseCount}）。そのぶんペース推定は高めに出ることがあります。必修の進捗は「残教材」で判定しています。`
        : `※「学習数」（累計・日別）は全コースの合計です。必修の進捗は「残教材」で判定しています。`;
    // デイリー達成は「教材消化の実差分」で判定（非必修も含む学習数ではなく、完了教材数）。
    // 当日始点(ensureDayStart で記録)からの増分＝今日完了した教材数。始点が今日でなければ0。
    // 日次スナップショットが今日既に走っていて始点未記録なケースを、カード表示時にも補完（現在値=始点）。
    await ensureDayStart(passed);
    const ds = await getDayStart();
    const todayDone = ds && ds.date === isoDate(zenToday()) ? Math.max(0, passed - ds.passed) : 0;

    // 週間目標: 週始点(日曜5:00境界)からの教材差分。始点未記録ならカード表示時に補完。
    // 週の途中で始点が設置された場合は、日次スナップから週初時点の passed を復元して修復。
    await ensureWeekStart(passed, await weekBaselinePassed());
    const ws = await getWeekStart();
    const weekDone = ws && ws.week === zenWeekStartISO() ? Math.max(0, passed - ws.passed) : 0;
    const weekGoal = await getWeekGoal();
    // 先週のまとめ（学習数ベース・日曜〜土曜）
    const weekStartT = new Date(zenWeekStartISO() + 'T12:00:00').getTime();
    const lastWeek = merged.filter((p) => {
      const t = new Date(p.date + 'T12:00:00').getTime();
      return t < weekStartT && t >= weekStartT - 7 * 86400000;
    });
    const lastWeekSum = lastWeek.reduce((a, p) => a + p.amount, 0);
    const weekEl = renderWeekGoal(pred, weekDone, weekGoal, lastWeek.length ? lastWeekSum : null);

    // 月次レポート締切（年度末一発でなく、毎月の締切に追いつくのが成績上の実態）
    const dstatus = reportDeadlineStatus(
      report.months.map((m) => ({ year: m.year, month: m.month, deadline: m.deadline, total: m.total, passed: m.passed })),
      Date.now()
    );
    // 教科別ペース × 締切の章内訳 → 「このペースだと間に合わない教科」判定（GET 1回・失敗時は表示しないだけ）
    let deadlineRisks: CourseDeadlineRisk[] | null = null;
    if (dstatus.next) {
      try {
        const [detail, coursePassedHist] = await Promise.all([fetchMonthlyReport(dstatus.next.year, dstatus.next.month), getCoursePassedHistory()]);
        const now = Date.now();
        const groups = detail.deadline_groups.map((g) => ({
          daysLeft: Math.ceil((new Date(g.deadline).getTime() - now) / 86400000),
          chapters: g.chapters,
        }));
        deadlineRisks = computeCourseDeadlineRisks(groups, computeCoursePaces(coursePassedHist));
      } catch (e) {
        console.warn('[ZSS] 締切リスク判定をスキップ:', e);
      }
    }
    const deadlineEl = renderNextDeadline(dstatus, deadlineRisks);

    // 予測スナップショット保存（1日1件）→ 的中率（キャリブレーション）評価
    if (pred.montecarlo && pred.remaining > 0) {
      const cps = [7, 14, 28]
        .map((off) => pred.montecarlo!.band.find((b) => b.dayOffset === off))
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => ({ off: b.dayOffset, p15: b.p15, p50: b.p50, p85: b.p85 }));
      if (cps.length) void savePredSnapshot({ remaining: pred.remaining, cp: cps });
    }
    const cal = evaluateCalibration(await getPredLog(), mh.series, total);
    const calNote =
      cal.n >= 5 && cal.coverage !== null
        ? `予測の的中率: これまでの予測のうち実績が P15〜85 帯に収まった割合 ${Math.round(cal.coverage * 100)}%（${cal.n}件で検証・理想は70%前後）。傾向: ${cal.bias === 'optimistic' ? 'やや楽観寄り（実際は予測より遅れがち）' : cal.bias === 'pessimistic' ? 'やや悲観寄り（実際は予測より速い）' : 'バランス良好'}。`
        : `予測の的中率: 検証データを蓄積中（予測と後日の実績の突き合わせ ${cal.n}/5件〜で表示）。`;

    pane.textContent = '';
    pane.appendChild(renderPredictorSection(pred, actualCurve, tip, todayDone, { savedTarget, electivesNote, weekEl, calNote, deadlineEl }));

    // 通知（節目・デイリー達成）。永続dedupで繰り返さない。
    void notifyProgress(passed, total);
    void notifyQuest(todayDone, questTargetOf(pred));
  } catch (e) {
    console.warn('[ZSS] 完了予測の取得失敗:', e);
    pane.textContent = '';
    pane.appendChild(h('div', { class: 'zss-empty' }, ['予測を取得できませんでした。']));
  }
}

/** 教科タブ: 残教材の一覧（ティアA・即時）＋ ボタンで 動画時間/テスト/レポートの残/総（ティアB・重い）。 */
async function renderSubjectsTab(pane: HTMLElement, getCourses: () => Promise<CourseMaterial[]>, tip: Tooltip): Promise<void> {
  void tip;
  pane.textContent = ''; // 完了検知の再描画時の二重表示防止
  pane.appendChild(h('div', { class: 'zss-empty' }, ['読み込み中…']));
  try {
    const courses = await getCourses();
    pane.textContent = '';
    const tierA = renderSubjectRemaining(courses);
    const volBody = h('div', {}, []);
    // 詳細（教科別シェアの色分けドーナツ・動画時間/テスト/レポートの内訳）はボタン押下で集計。
    // 全章を舐めるため既定では出さず、押すと詳細グラフを表示する旨を明記。
    const volBtn = h('button', { class: 'zss-details-toggle' }, ['教科別シェアなど詳細グラフを表示']) as HTMLButtonElement;
    const volNote = h('div', { class: 'zss-vol-hint' }, [
      '押すと、教科別の残り学習量シェア（色分けドーナツ）と、動画時間・確認テスト・レポートの残/総の内訳を表示します。全章を集計するため少し時間がかかります。',
    ]);
    volBtn.addEventListener('click', () => {
      volBtn.disabled = true;
      volBtn.textContent = '集計中…';
      void Promise.all([computeCourseVolumes((msg) => (volBtn.textContent = msg)), getWorkTimes(), getIncludeSupp()])
        .then(([vols, wt, incSupp]) => {
          tierA.remove();
          volBtn.remove();
          volNote.remove();
          const rerender = (inc: boolean): void => {
            volBody.textContent = '';
            volBody.appendChild(
              renderSubjects(vols, wt, {
                includeSupp: inc,
                onToggleSupp: (v) => {
                  void setIncludeSupp(v);
                  rerender(v);
                },
              })
            );
          };
          rerender(incSupp);
        })
        .catch((e) => {
          console.warn('[ZSS] 教材ボリューム集計失敗:', e);
          volBtn.disabled = false;
          volBtn.textContent = '集計する（再試行）';
        });
    });
    // ボタンを上部に配置（詳細グラフへの入口を目立たせる）
    pane.appendChild(volBtn);
    pane.appendChild(volNote);
    pane.appendChild(tierA);
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

/** 分析タブ: 蓄積データから「あなたの学習傾向」を提示（曜日/月/祝日/一貫性/時間帯/必修）。 */
async function renderAnalysisTab(
  pane: HTMLElement,
  getSeriesOnce: () => Promise<{ date: string; amount: number }[]>,
  getCourses: () => Promise<CourseMaterial[]>,
  data: LearningAmounts
): Promise<void> {
  pane.appendChild(h('div', { class: 'zss-empty' }, ['分析中…']));
  try {
    const series = await getSeriesOnce();
    const [courses, report, hour, workTimes, coursePassedHist] = await Promise.all([getCourses(), fetchReportProgresses(), getHourStats(), getWorkTimes(), getCoursePassedHistory()]);
    await recordDeadlineOutcomes(report.months); // 締切前の観測値を更新（遵守率の源・またぎで凍結）
    const deadlineOutcomes = await getDeadlineOutcomes();
    // 14日窓シードとマージ（新規でも分析可）
    const dayMap = new Map<string, number>();
    for (const p of series) dayMap.set(p.date, p.amount);
    for (const d of data.daily_amount) if (d.amount != null) dayMap.set(d.date, d.amount);
    const merged = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, amount]) => ({ date, amount }));
    const last14 = merged.slice(-14);
    const recentPerDay = last14.length ? last14.reduce((a, p) => a + p.amount, 0) / last14.length : null;

    // 実績の判定を先に（歩みサマリで使う）
    const streak0 = streakInfo(merged);
    const totalMat0 = courses.reduce((a, c) => a + c.total, 0);
    const passedMat0 = courses.reduce((a, c) => a + c.passed, 0);
    const achInput0: AchInput = {
      longestStreak: streak0.longest,
      studiedDays: merged.filter((p) => p.amount > 0).length,
      passedMaterials: passedMat0,
      totalMaterials: totalMat0,
      completedCourses: courses.filter((c) => c.total > 0 && c.passed >= c.total).length,
      totalCourses: courses.filter((c) => c.total > 0).length,
    };
    const unlocked0 = new Set(computeUnlocked(achInput0));

    // 詳細ログ（収集済みなら遡及実測セクションを挿入。未収集なら何も出さない）
    const resultLog = await getResultLog().catch(() => []);
    const retro = resultLog.length ? retroSections(resultLog, new Map(courses.map((c) => [c.id, c.title]))) : [];

    const sections: Section[] = [
      journeySummary(merged, passedMat0, totalMat0, streak0.longest, unlocked0.size, ACHIEVEMENTS.length),
      deadlineTendency(report, deadlineOutcomes),
      requiredAdvice(courses, report, recentPerDay),
      trendTendency(merged),
      distributionSummary(merged),
      weekdayTendency(merged),
      timeOfDayTendency(hour),
      ...retro,
      coursePaceTendency(coursePassedHist, courses),
      workTimeTendency(workTimes, courses),
      monthlyTendency(merged),
      holidayTendency(merged),
      consistencyTendency(merged),
    ];
    // モチベーション・ナッジ（行動科学の実証手法）: 状況に応じた最重要ひとこと
    const todayAmt = data.daily_amount[data.daily_amount.length - 1]?.amount ?? 0;
    const nudges = motivationNudges({
      today: zenToday(), todayAmount: todayAmt, series: merged, streak: streak0,
      totalMaterials: totalMat0, passedMaterials: passedMat0, courses, hour,
      nearChapter: getNearDoneChapters()[0] ?? null,
    });

    pane.textContent = '';
    if (nudges.length) pane.appendChild(renderMotivation(nudges.slice(0, 2)));
    // 詳細ログ未収集なら誘導（過去の実測分析が眠っていることを分析タブで直接知らせる）
    if (!resultLog.length) pane.appendChild(renderRetroCta(pane));
    pane.appendChild(h('div', { class: 'zss-analysis-head' }, ['あなたの学習傾向']));
    pane.appendChild(h('div', { class: 'zss-analysis-sub' }, [`記録 ${merged.length}日ぶんから分析（データが増えるほど精度が上がります）`]));
    for (const sec of sections) pane.appendChild(renderInsightSection(sec));

    // 実績バッジ（実データに基づく達成のみ・初達成日を記録）
    void recordAchievements([...unlocked0]);
    const achDates = await getAchievementDates();
    pane.appendChild(renderAchievements(unlocked0, achDates));
  } catch (e) {
    console.warn('[ZSS] 分析の取得失敗:', e);
    pane.textContent = '';
    pane.appendChild(h('div', { class: 'zss-empty' }, ['分析データを取得できませんでした。']));
  }
}

/** 実績バッジのグリッド。解除済み=色付き＋達成日 / 未達成=グレー＋条件。 */
function renderAchievements(unlocked: Set<string>, dates: Record<string, string>): HTMLElement {
  const chips = ACHIEVEMENTS.map((a) => {
    const on = unlocked.has(a.id) || !!dates[a.id];
    return h('div', { class: 'zss-ach' + (on ? ' on' : ''), title: a.desc }, [
      h('div', { class: 'zss-ach-t' }, [a.title]),
      h('div', { class: 'zss-ach-d' }, [on ? (dates[a.id] ? `達成 ${shortDate(dates[a.id])}` : '達成') : a.desc]),
    ]);
  });
  const n = ACHIEVEMENTS.filter((a) => unlocked.has(a.id) || dates[a.id]).length;
  return h('div', { class: 'zss-insight-sec' }, [
    h('div', { class: 'zss-insight-title' }, [`実績（${n} / ${ACHIEVEMENTS.length}）`]),
    h('div', { class: 'zss-ach-grid' }, chips),
  ]);
}

function renderMotivation(nudges: Nudge[]): HTMLElement {
  return h('div', { class: 'zss-motiv' }, [
    h('div', { class: 'zss-motiv-head' }, ['今日のひとこと']),
    ...nudges.map((n) => h('div', { class: 'zss-motiv-item' }, [n.text])),
  ]);
}

function renderInsightSection(sec: Section): HTMLElement {
  return h('div', { class: 'zss-insight-sec' }, [
    h('div', { class: 'zss-insight-title' }, [sec.title]),
    ...sec.insights.map((i) =>
      h('div', { class: 'zss-insight ' + i.kind }, [
        h('span', { class: 'ic' }, [i.kind === 'good' ? '✓' : i.kind === 'warn' ? '！' : '·']),
        ' ' + i.text,
      ])
    ),
  ]);
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

/** 締切に間に合う最低ペース（教材/日・表示用整数）。quest・教材数プランナーで共通の単一情報源。 */
function questTargetOf(pred: Prediction): number {
  if (pred.remaining <= 0) return 0;
  return isFinite(pred.requiredPerDay) ? Math.max(1, Math.ceil(pred.requiredPerDay)) : pred.remaining;
}

const r1w = (n: number): string => String(Math.round(n * 10) / 10);

/** 教科別の締切リスク表示（教科別ペース蓄積 × 締切の章内訳）。 */
function renderDeadlineRisks(risks: CourseDeadlineRisk[]): HTMLElement | null {
  if (!risks.length) return null; // この締切に未完が無い（他要素で表示済み）
  const risky = risks.filter((r) => r.risk === 'late' || r.risk === 'tight');
  const judged = risks.filter((r) => r.risk !== 'unknown');
  const children: HTMLElement[] = [h('div', { class: 'zss-deadline-risk-head' }, ['教科別ペースでの見込み'])];
  if (risky.length) {
    for (const r of risky.slice(0, 5)) {
      const pace = r.perWeek !== null ? `約${r1w(r.perWeek)}/週` : 'ペース不明';
      const eta = r.etaDays === null ? '直近進んでおらず完了見込みが立ちません' : `完了まで約${r.etaDays}日 > 締切まで${Math.max(0, r.daysLeft)}日`;
      children.push(
        h('div', { class: `zss-deadline-risk-row ${r.risk}` }, [
          r.risk === 'late' ? `⚠ ${r.title}: 残${r.remaining}・${pace} → ${eta}。このペースだと間に合わないかも。` : `△ ${r.title}: 残${r.remaining}・${pace} → ${eta}。余裕がありません。`,
        ])
      );
    }
    if (risky.length > 5) children.push(h('div', { class: 'zss-deadline-risk-note' }, [`ほか ${risky.length - 5} 教科も要注意です。`]));
  } else if (judged.length) {
    children.push(h('div', { class: 'zss-deadline-risk-row ok' }, [`✓ ペース記録のある ${judged.length} 教科は、現在ペースで締切に間に合う見込みです。`]));
  } else {
    children.push(h('div', { class: 'zss-deadline-risk-note' }, ['教科別ペースを蓄積中。数日ぶん貯まると「このペースで間に合うか」を教科別に判定します。']));
    return h('div', { class: 'zss-deadline-risk' }, children);
  }
  const unknownCount = risks.length - judged.length;
  if (unknownCount > 0) children.push(h('div', { class: 'zss-deadline-risk-note' }, [`※${unknownCount} 教科はペース蓄積中のため未判定。`]));
  children.push(h('div', { class: 'zss-deadline-risk-note' }, ['※教科全体の消化ペース（直近28日）からの近似判定です。免除の章は除外しています。']));
  return h('div', { class: 'zss-deadline-risk' }, children);
}

/** 月次レポート締切: 「次の締切」を主役に、締切超過（成績に影響）を警告。年度末一発でない実態を反映。 */
function renderNextDeadline(st: DeadlineStatus, risks?: CourseDeadlineRisk[] | null): HTMLElement | null {
  if (st.allClear && !st.next) {
    return h('div', { class: 'zss-deadline ok' }, [
      h('div', { class: 'zss-deadline-head' }, ['レポート締切']),
      h('div', { class: 'zss-deadline-body' }, ['直近の締切ぶんは完了しています。次の締切が近づくと表示します。']),
    ]);
  }
  const children: HTMLElement[] = [h('div', { class: 'zss-deadline-head' }, ['次のレポート締切'])];
  if (st.next) {
    const n = st.next;
    const urgent = n.daysLeft <= 7 && n.remaining > 0;
    children.push(
      h('div', { class: 'zss-deadline-main' + (urgent ? ' warn' : '') }, [
        h('b', {}, [`${md(n.deadline)}`]),
        `　あと ${n.daysLeft}日`,
        h('span', { class: 'sub' }, [`　· この締切の章 ${n.passed}/${n.total} 完了・残り ${n.remaining}章`]),
      ])
    );
    children.push(
      h('div', { class: 'zss-deadline-note' }, [
        urgent ? '締切が近く未完の章があります。まずこの締切ぶんを優先しましょう。' : 'この締切に向けて計画的に進めましょう。',
      ])
    );
  }
  if (st.overdue.length) {
    const totalOver = st.overdue.reduce((a, o) => a + o.remaining, 0);
    children.push(
      h('div', { class: 'zss-deadline-over' }, [
        `⚠ 締切超過: ${st.overdue.map((o) => md(o.deadline)).join('・')} の締切に未完の章が計${totalOver}あります（成績に影響する場合があります）。`,
      ])
    );
  }
  if (risks) {
    const riskEl = renderDeadlineRisks(risks);
    if (riskEl) children.push(riskEl);
  }
  const hasLate = !!risks?.some((r) => r.risk === 'late');
  return h('div', { class: 'zss-deadline' + (st.overdue.length || hasLate ? ' warn' : '') }, children);
}

/** 週間目標: 週N教材の目標＋今週の進捗バー＋先週サマリ。日次の凸凹を吸収する中間粒度。
 *  目標は締切に間に合う最低ペース（義務週）以上のみ設定可（デイリー/教材数プランナーと同思想）。 */
function renderWeekGoal(pred: Prediction, weekDone: number, savedGoal: number | null, lastWeekSum: number | null): HTMLElement | null {
  if (pred.remaining <= 0) return null;
  const minWeek = isFinite(pred.requiredPerDay) ? Math.max(1, Math.ceil(pred.requiredPerDay * 7)) : pred.remaining;
  const goal0 = Math.max(minWeek, savedGoal ?? minWeek);

  const bar = h('div', { class: 'zss-quest-bar' }, []);
  const fill = h('div', { class: 'zss-quest-fill' }, []);
  bar.appendChild(fill);
  const count = h('span', { class: 'zss-quest-count' }, []);
  const note = h('div', { class: 'zss-quest-note' }, []);
  const input = h('input', { type: 'number', class: 'zss-target-pace', min: minWeek, step: 1, inputmode: 'numeric' }) as HTMLInputElement;
  input.value = String(goal0);

  const apply = (goal: number): void => {
    const left = Math.max(0, goal - weekDone);
    const met = left === 0;
    const pct = Math.min(100, Math.round((weekDone / Math.max(1, goal)) * 100));
    fill.style.width = `${pct}%`;
    fill.classList.toggle('met', met);
    count.textContent = '';
    count.append(h('b', {}, [String(weekDone)]), ` / ${goal} 教材`, h('span', { class: 'zss-quest-left' }, [met ? '　週目標 達成' : `　あと ${left}`]));
    note.textContent = met
      ? '今週の目標を達成しました。上積みはそのまま貯金になります。'
      : `日曜5:00はじまりの週間目標です（義務ペース 週${minWeek} 以上で設定可）。${lastWeekSum !== null ? `先週の学習数: ${lastWeekSum}件。` : ''}`;
  };
  const onInput = (): void => {
    const n = Math.floor(Number(input.value));
    if (!Number.isFinite(n) || n < minWeek) {
      note.textContent = `週${minWeek} 教材（義務ペース）以上を入力してください。`;
      return;
    }
    void setWeekGoal(n);
    apply(n);
  };
  input.addEventListener('input', onInput);
  input.addEventListener('change', onInput);
  apply(goal0);

  return h('div', { class: 'zss-quest zss-week' }, [
    h('div', { class: 'zss-quest-top' }, [
      h('span', { class: 'zss-quest-label' }, ['今週の目標']),
      h('span', { class: 'zss-week-edit' }, [input, h('span', { class: 'zss-pace-min' }, ['/週'])]),
      count,
    ]),
    bar,
    note,
  ]);
}

/** 今日のデイリークエスト: 締切から逆算した推奨ペースを「今日あとN教材」に落とす。 */
function renderDailyQuest(pred: Prediction, todayAmount: number): HTMLElement | null {
  if (pred.remaining <= 0) return null; // 消化済みは verdict 側で祝う
  const target = questTargetOf(pred);
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
      h('span', { class: 'zss-quest-label' }, ['今日の目標']),
      h('span', { class: 'zss-quest-count' }, [
        h('b', {}, [String(done)]),
        ` / ${target} 教材`,
        h('span', { class: 'zss-quest-left' }, [met ? '　達成' : `　あと ${left}`]),
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

function renderPredictorSection(
  pred: Prediction,
  actual: { date: string; remaining: number }[],
  tip: Tooltip,
  todayAmount: number,
  opts: { savedTarget: string | null; electivesNote: string; weekEl?: HTMLElement | null; calNote?: string; deadlineEl?: HTMLElement | null }
): HTMLElement {
  // 見出しの判定（モンテカルロの確率・パーセンタイルを主に）
  let verdict: HTMLElement;
  const mc = pred.montecarlo;
  if (pred.remaining === 0) {
    verdict = h('div', { class: 'zss-pred-head ok' }, ['全教材を消化済み']);
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

  // 目標日 → 推奨ペース（過去日/締切後は不可・例外処理つき）。優先度の高い機能として目立つ枠に。
  const today0 = zenToday();
  const dateInput = h('input', { type: 'date', class: 'zss-target-date' }) as HTMLInputElement;
  // 記憶した目標日を既定に（今日〜締切の範囲内なら採用、外れていれば締切）
  const savedValid =
    opts.savedTarget &&
    opts.savedTarget >= isoDate(today0) &&
    opts.savedTarget <= isoDate(pred.finalDeadline);
  dateInput.value = savedValid ? (opts.savedTarget as string) : isoDate(pred.finalDeadline);
  dateInput.min = isoDate(today0);
  dateInput.max = isoDate(pred.finalDeadline);
  const recOut = h('div', { class: 'zss-rec' }, []);

  // 実績・完了見込みグラフ。目標日ライン（選択日への理想ペース）を反映するため再描画可能に。
  const TARGET_COL = '#0d9488';
  const chartHost = h('div', { class: 'zss-chart' }, []);
  const legendHost = h('div', { class: 'zss-cal-legend' }, []);
  const parseTarget = (v: string): Date | null => {
    if (!v || pred.remaining <= 0) return null;
    const t = new Date(v + 'T23:59:59+09:00');
    if (isNaN(t.getTime()) || t.getTime() < today0.getTime()) return null;
    // 締切と実質同日（12h以内）なら必要ラインと重なるので目標線は出さない
    if (t.getTime() >= pred.finalDeadline.getTime() - 12 * 3600 * 1000) return null;
    return t;
  };
  const drawChart = (target: Date | null): void => {
    chartHost.textContent = '';
    chartHost.appendChild(renderBurndown(pred, actual, tip, target));
    legendHost.textContent = '';
    const items: HTMLElement[] = [
      legendLine('var(--muted)', '必要ライン'),
      legendLine(pred.onTrack ? 'var(--success)' : '#d9822b', '予測(帯=P15〜85)'),
      legendItem('var(--primary)', '実績'),
      ...(pred.montecarlo ? [legendLine('#e5484d', '完了見込み'), legendItem('#6f5cc4', '完了分布')] : []),
      ...(target ? [legendLine(TARGET_COL, '目標ペース')] : []),
    ];
    for (const it of items) legendHost.appendChild(it);
  };

  const updateRec = () => {
    recOut.textContent = '';
    const v = dateInput.value;
    if (!v) {
      recOut.append(recMsg('note', '日付を選ぶと必要ペースを表示します'));
      return;
    }
    const target = new Date(v + 'T23:59:59+09:00');
    if (isNaN(target.getTime())) {
      recOut.append(recMsg('warn', '日付が正しくありません'));
      return;
    }
    if (target.getTime() < today0.getTime()) {
      recOut.append(recMsg('warn', '目標日は今日以降を選んでください'));
      return;
    }
    if (target.getTime() > pred.finalDeadline.getTime()) {
      recOut.append(recMsg('warn', `締切（${md(pred.finalDeadline)}）より後には設定できません`));
      return;
    }
    if (pred.remaining <= 0) {
      recOut.append(recMsg('good', '全教材を消化済みです'));
      return;
    }
    const rec = recommendedPace(pred.remaining, target);
    if (!rec) {
      recOut.append(recMsg('warn', '目標日は今日以降を選んでください'));
      return;
    }
    void setTargetDate(v); // 有効な目標日を記憶
    const curPerDay = pred.currentPerWeek !== null ? pred.currentPerWeek / 7 : null;
    recOut.append(
      h('div', { class: 'zss-rec-main' }, [
        `${md(target)} までに終えるには 1日 ${Math.ceil(rec.perDay)} 教材`,
        h('span', { class: 'sub' }, [`（週 ${Math.round(rec.perWeek)}・残り${Math.round(rec.days)}日）`]),
      ]),
      h('div', { class: 'zss-rec-sub' }, [
        curPerDay === null
          ? '現在ペースは数日記録すると表示されます'
          : rec.perDay <= curPerDay
            ? `現在ペース ${curPerDay.toFixed(1)}/日 で到達できます ✓`
            : `現在ペース ${curPerDay.toFixed(1)}/日 → あと 1日 +${Math.ceil(rec.perDay - curPerDay)} 必要`,
      ])
    );
  };
  const onDate = (): void => {
    updateRec();
    drawChart(parseTarget(dateInput.value)); // 目標日ラインを即反映（アニメーション付き）
  };
  dateInput.addEventListener('input', onDate);
  dateInput.addEventListener('change', onDate);
  updateRec();
  drawChart(parseTarget(dateInput.value));
  // 週次計画のカレンダー書き出し（コミットメント・デバイス: 予定に置くと実行率が上がる）
  const icsBtn = h('button', { class: 'zss-dm-btn', type: 'button', title: '目標日までの週次マイルストーンを .ics で書き出し（Google/Appleカレンダーに取込可）' }, ['週次計画をカレンダーへ (.ics)']);
  icsBtn.addEventListener('click', () => {
    const v = dateInput.value;
    const target = v ? new Date(v + 'T23:59:59+09:00') : null;
    if (!target || isNaN(target.getTime()) || target.getTime() < today0.getTime() || pred.remaining <= 0) return;
    downloadText(`zen-study-plan-${v}.ics`, 'text/calendar', buildPlanIcs({ remaining: pred.remaining, passed: pred.passed, target, today: today0 }));
  });

  const targetBox = h('div', { class: 'zss-target-box' }, [
    h('div', { class: 'zss-target-head' }, ['目標日から逆算']),
    h('div', { class: 'zss-target' }, [h('span', {}, ['完了させたい日:']), dateInput]),
    recOut,
    h('div', { class: 'zss-dm-row', style: 'margin-top:6px' }, [icsBtn]),
  ]);

  // 一日の教材数から逆算（義務ペース以上のみ設定可能）。入力した1日ペースでの完了見込み日を出す。
  // 義務ペースは quest（今日の目標）と同じ questTargetOf を使用（単一情報源・端数差を排除）。
  const DAY = 86400000;
  const requiredPerDay = questTargetOf(pred);
  const paceInput = h('input', { type: 'number', class: 'zss-target-pace', min: requiredPerDay, step: 1, inputmode: 'numeric' }) as HTMLInputElement;
  paceInput.value = String(Math.max(requiredPerDay, 1));
  const paceOut = h('div', { class: 'zss-rec' }, []);
  const updatePace = (): Date | null => {
    paceOut.textContent = '';
    if (pred.remaining <= 0) { paceOut.append(recMsg('good', '全教材を消化済みです')); return null; }
    const n = Math.floor(Number(paceInput.value));
    if (!Number.isFinite(n) || n <= 0) { paceOut.append(recMsg('note', '1日の教材数を入力してください')); return null; }
    if (n < requiredPerDay) {
      paceOut.append(recMsg('warn', `義務ペース（${requiredPerDay} 教材/日）以上を入力してください。これ未満だと締切（${md(pred.finalDeadline)}）に間に合いません。`));
      return null;
    }
    const days = Math.ceil(pred.remaining / n);
    const finish = new Date(today0.getTime() + days * DAY);
    const early = Math.round((pred.finalDeadline.getTime() - finish.getTime()) / DAY);
    paceOut.append(
      h('div', { class: 'zss-rec-main' }, [
        `1日 ${n} 教材 なら ${md(finish)} に完了見込み`,
        h('span', { class: 'sub' }, [`（残り${pred.remaining}教材 / 約${days}日）`]),
      ]),
      h('div', { class: 'zss-rec-sub' }, [early > 0 ? `締切より ${early}日早く終わります。` : '締切ちょうど（義務ペース）です。']),
    );
    return finish;
  };
  const onPace = (): void => { drawChart(updatePace()); };
  paceInput.addEventListener('input', onPace);
  paceInput.addEventListener('change', onPace);
  updatePace(); // 初期はテキストのみ更新（線は目標日プランナーの初期表示を優先）
  const paceBox = h('div', { class: 'zss-target-box' }, [
    h('div', { class: 'zss-target-head' }, ['一日の教材数から逆算']),
    h('div', { class: 'zss-target' }, [
      h('span', {}, ['1日の教材数:']), paceInput,
      h('span', { class: 'zss-pace-min' }, [`義務 ${requiredPerDay} 教材/日 以上`]),
    ]),
    paceOut,
  ]);

  const analysisEl = renderAnalysis(pred);
  const quest = renderDailyQuest(pred, todayAmount);
  // 実績・完了見込みグラフ（今日の目標の直下に配置）
  const chartBlock = [
    h('div', { class: 'zss-section-head' }, [
      h('div', { class: 'zss-section-title' }, ['実績・完了見込み']),
      h('div', { class: 'zss-section-note' }, [`締切 ${md(pred.finalDeadline)}`]),
    ]),
    chartHost,
    legendHost,
  ];
  return h('div', { class: 'zss-section' }, [
    ...(opts.deadlineEl ? [opts.deadlineEl] : []),
    ...(quest ? [quest] : []),
    ...(opts.weekEl ? [opts.weekEl] : []),
    ...chartBlock,
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
    ...(analysisEl ? [analysisEl] : []),
    targetBox,
    paceBox,
    ...(opts.calNote ? [h('div', { class: 'zss-pred-caveat' }, [opts.calNote])] : []),
    h('div', { class: 'zss-pred-caveat' }, [opts.electivesNote]),
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

/** 目標枠内の状態メッセージ（不正日付・達成など）。 */
function recMsg(kind: 'good' | 'warn' | 'note', text: string): HTMLElement {
  return h('div', { class: 'zss-rec-msg ' + kind }, [text]);
}

/** 現在ペースからの分析（完了見込み vs 締切・明日の目安・ペース傾向）。 */
function renderAnalysis(pred: Prediction): HTMLElement | null {
  if (pred.remaining <= 0) return null;
  const a = pred.analysis;
  const rows: HTMLElement[] = [];
  if (pred.projectedFinish && pred.daysVsDeadline !== null) {
    const dv = Math.round(pred.daysVsDeadline);
    if (dv <= -1) rows.push(analysisLine('good', `このペースなら ${md(pred.projectedFinish)} 頃に完了見込み（締切より ${-dv}日早い）`));
    else if (dv >= 1) rows.push(analysisLine('warn', `このペースだと完了は ${md(pred.projectedFinish)} 頃（締切を ${dv}日超過）`));
    else rows.push(analysisLine('note', `完了見込みは締切とほぼ同時（${md(pred.projectedFinish)}）`));
  }
  // 明日の目安: 締切オーバーの見込み(!onTrack)なら「最低必要分(逆算)」、順調なら「投影(やりそうな量)」。
  if (!pred.onTrack && a.tomorrowRequired !== null) {
    if (a.tomorrowRequired >= 1) {
      rows.push(analysisLine('warn', `間に合わせるには明日 最低 ${a.tomorrowRequired} 教材${a.tomorrowEstimate !== null ? `（現ペースの見込みは ${a.tomorrowEstimate}）` : ''}`));
    } else {
      const reqFlat = isFinite(pred.requiredPerWeek) ? Math.ceil(pred.requiredPerWeek / 7) : pred.remaining;
      rows.push(analysisLine('warn', `間に合わせるには平均 ${reqFlat} 教材/日 必要（明日は曜日的に少なめでも他日で挽回）`));
    }
  } else if (a.tomorrowEstimate !== null) {
    rows.push(analysisLine('note', `明日の目安: 約 ${a.tomorrowEstimate} 教材（曜日の傾向から）`));
  }
  if (a.trend === 'down') rows.push(analysisLine('warn', `ペースが落ちています${a.trendPct !== null ? `（直近 ${a.trendPct}%）` : ''}`));
  else if (a.trend === 'up') rows.push(analysisLine('good', `ペースが上がっています${a.trendPct !== null ? `（+${a.trendPct}%）` : ''}`));
  if (!rows.length) return null;
  return h('div', { class: 'zss-analysis' }, rows);
}
function analysisLine(kind: 'good' | 'warn' | 'note', text: string): HTMLElement {
  const ic = kind === 'good' ? '▲' : kind === 'warn' ? '▼' : '·';
  return h('div', { class: 'zss-analysis-line ' + kind }, [h('span', { class: 'ic' }, [ic]), ' ' + text]);
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

