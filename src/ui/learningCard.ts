import type { LearningAmounts } from '../api';
import { computeKpis, computeWeekdayStats } from '../derive';
import { weekdayLabel, shortDate, zenToday, nowMs, durationStr } from '../format';
import { getStudyTime, getStudyTimeHours } from '../studyTime';
import { estimateDailyStudySeconds, estimateHourlyStudySeconds, calibrateSecPerLA, totalRetroSeconds, secPerMaterialByCourse, estimateDailyByCourseDelta } from '../studyTimeEst';
import { getCachedCourseVolumes } from '../courseStats';
import type { WorkTimes } from '../history';
import { h } from '../dom';
import { Tooltip } from './tooltip';
import { renderDailyBars } from '../charts/dailyBars';
import { renderWeekdayBars } from '../charts/weekdayBars';
import { getSeries, getMaterialHistory, getTargetDate, setTargetDate, getHourStats, getDayStart, ensureDayStart, getWeekStart, ensureWeekStart, weekBaselinePassed, getWeekGoal, setWeekGoal, savePredSnapshot, getPredLog, getAchievementDates, recordAchievements, getWorkTimes, getIncludeSupp, setIncludeSupp, getCoursePassedHistory, recordDeadlineOutcomes, getDeadlineOutcomes, snapshotMaterials, snapshotCoursePassed } from '../history';
import { ACHIEVEMENTS, computeUnlocked, type AchInput } from '../achievements';
import { evaluateCalibration } from '../calibration';
import { reportDeadlineStatus, type DeadlineStatus } from '../deadlines';
import { computeCourseDeadlineRisks, type CourseDeadlineRisk } from '../deadlineRisk';
import { computeCoursePaces, overallForecast } from '../coursePace';
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
import { fetchCourseMaterials, fetchElectiveCourses, getRequiredCourseIds, type ElectiveCourse } from '../courseApi';
import { getStudyMode, setStudyMode, snapshotElectivePassed, getElectiveHistory, type StudyMode } from '../history';
import { calendarData, trendPoints, streakInfo, type TrendMode } from '../deriveHistory';
import { computePrediction, recommendedPace, type Prediction } from '../predictor';
import { renderCalendar } from '../charts/calendar';
import { renderTrend } from '../charts/trend';
import { dataTable } from './dataTable';
import { renderBurndown, renderCourseBurndown } from '../charts/burndown';
import type { CoursePassedHistory } from '../history';
import { renderDonut } from '../charts/donut';
import { renderHourBars } from '../charts/hourBars';
import { bayesianAverage } from '../shrinkage';
import { computeCourseVolumes } from '../courseStats';
import { renderSubjects } from './volumeTable';
import { renderDataManage } from './dataManage';
import { renderResultLogFold } from './resultLogUi';
import { getTimerEnabled, setTimerEnabled } from '../testTimer';
import { getResultLog, getChapterSkels, type ResultEntry } from '../resultLog';
import { buildRequiredSeries, seriesRecentPace } from '../requiredSeries';
import { retroSections, retroHours, resultEvents, completionEvents, courseRetroRemaining, courseEventPace } from '../resultStats';
import { interpolateMovieEvents, movieHours, type MovieEvent } from '../movieInterp';
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
  let mode: StudyMode = await getStudyMode();
  // 教科データ(軽量)は予測・教科タブで共有（1回だけ取得）。モードで取得元が変わる。
  let coursesP: Promise<CourseMaterial[]> | null = null;
  const getCourses = () => (coursesP ??= mode === 'elective' ? fetchElectiveCourses() : fetchCourseMaterials());
  let seriesP: Promise<{ date: string; amount: number }[]> | null = null;
  const getSeriesOnce = () => (seriesP ??= getSeries());

  const panes = [0, 1, 2, 3].map(() => h('div', { class: 'zss-pane' }, []));
  const done = [false, false, false, false];
  const renderers = [
    () => void renderRecentTab(panes[0], data, getSeriesOnce, tip),
    () =>
      mode === 'elective'
        ? void renderElectivePredictTab(panes[1], getCourses)
        : void renderPredictTab(panes[1], getSeriesOnce, getCourses, tip, data),
    () => void renderSubjectsTab(panes[2], getCourses, tip, mode),
    () =>
      mode === 'elective'
        ? void renderElectiveAnalysisTab(panes[3], getCourses)
        : void renderAnalysisTab(panes[3], getSeriesOnce, getCourses, data),
  ];
  let current = defaultTab;
  const select = (i: number) => {
    current = i;
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
    coursesP = null; // メモ化キャッシュを破棄（次回取得で最新の完了数）
    if (done[1]) renderers[1]();
    if (done[2]) renderers[2]();
  };
  window.addEventListener('zss:completion', onCompletion);

  // モードトグル: 学習数ストリップと推移(0)はモード非依存＝常に全体。予測(1)/教科(2)/分析(3)が切替。
  const setMode = async (m: StudyMode): Promise<void> => {
    if (m === mode) return;
    mode = m;
    await setStudyMode(m);
    coursesP = null;
    done[1] = done[2] = done[3] = false; // モード依存タブを無効化して再描画
    for (const el of panes.slice(1)) el.textContent = '';
    if (current !== 0) select(current); // 推移以外を開いていれば即再描画
  };
  container.appendChild(renderModeToggle(mode, setMode));
  container.appendChild(tabBar(['推移', '予測', '教科', '分析'], select, defaultTab));
  for (const p of panes) container.appendChild(p);
  select(defaultTab);
}

/** 学習モード切替（必修 / 必修以外）。学習数ストリップと推移はモード非依存の全体。 */
function renderModeToggle(mode: StudyMode, onChange: (m: StudyMode) => void): HTMLElement {
  const seg = h('div', { class: 'zss-mode-seg' }, []);
  const opts: [StudyMode, string][] = [['required', '必修'], ['elective', '必修以外']];
  const btns = opts.map(([m, label]) => {
    const b = h('button', m === mode ? { class: 'on' } : {}, [label]);
    b.addEventListener('click', () => {
      btns.forEach((x, i) => x.classList.toggle('on', opts[i][0] === m));
      onChange(m);
    });
    return b;
  });
  for (const b of btns) seg.appendChild(b);
  return h('div', { class: 'zss-mode-row' }, [
    seg,
    h('span', { class: 'zss-mode-note' }, ['↓ 予測・教科・分析が切り替わります（学習数・推移は全体で共通）']),
  ]);
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
  // モード共通であることを明示（トグルが「選択科目」でも推移は全学習の合計）
  pane.appendChild(h('div', { class: 'zss-mode-common' }, ['このタブは必修＋必修以外を合わせた全学習の推移です（モード共通）。']));
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
  // --- 学習時間（実測∨推定・非同期） ---
  // 実測 = アクティブタイム（この端末・可視タブで操作中/動画再生中のみ加算）。
  // 推定 = 受験記録＋動画実尺＋所要時間実測から復元（計測開始前・他端末の日を埋める）。
  // 【二重計上防止】実測はテスト/動画の時間を既に含むため加算せず、日ごとに max(実測, 推定)。
  const fmtMin = (m: number): string => durationStr(m * 60);
  const timeDataPromise = (async () => {
    const [st, rlogT, skelsT, wtT, hoursMeasured, seriesLa] = await Promise.all([
      getStudyTime().catch(() => ({}) as Record<string, number>),
      getResultLog().catch(() => [] as ResultEntry[]),
      getChapterSkels().catch(() => ({})),
      getWorkTimes().catch(() => ({}) as WorkTimes),
      getStudyTimeHours().catch(() => new Array(24).fill(0) as number[]),
      getSeriesOnce().catch(() => [] as { date: string; amount: number }[]),
    ]);
    const [cphT, volsT] = await Promise.all([
      getCoursePassedHistory().catch(() => ({}) as CoursePassedHistory),
      getCachedCourseVolumes().catch(() => []),
    ]);
    const movT = interpolateMovieEvents(skelsT, rlogT);
    const estDaily = estimateDailyStudySeconds(rlogT, movT, wtT);
    // 第3層: 学習量×較正値。受験記録の推定は詳細ログの抽出時点で止まる（今日・抽出後の日が
    // 抜ける）ため、当日も更新される学習量から換算して埋める。
    //  a) 教科別: coursePassedHist の隣接日差分 × 教科別 秒/教材（教材の重さの教科差を反映）
    //  b) 全体: LA × 秒/学習（較正は 実測日 Σ実測/ΣLA を優先、無ければ遡及総量/ΣLA）
    const laMap = new Map<string, number>();
    for (const p of seriesLa) laMap.set(p.date, p.amount);
    for (const d of data.daily_amount) if (d.amount != null) laMap.set(d.date, d.amount);
    const laArr = [...laMap.entries()].map(([date, amount]) => ({ date, amount }));
    const todayIsoT = isoDate(zenToday());
    const secPerLA = calibrateSecPerLA(laArr, st, estDaily, totalRetroSeconds(skelsT, rlogT, wtT), todayIsoT);
    const conv = secPerMaterialByCourse(
      volsT.map((v) => ({ id: v.id, totalMaterials: v.totalMaterials, movieSeconds: v.total.movieSeconds, testCount: v.total.testCount, reportCount: v.total.reportCount })),
      wtT
    );
    const cphMap: Record<string, Record<string, number>> = {};
    for (const p of cphT) cphMap[p.date] = p.byCourse as unknown as Record<string, number>;
    const estCourse = estimateDailyByCourseDelta(cphMap, conv);
    const combined: Record<string, number> = {};
    const estSet = new Set<string>();
    const allDays = new Set([...Object.keys(st), ...Object.keys(estDaily), ...Object.keys(estCourse), ...(secPerLA ? laMap.keys() : [])]);
    for (const d of allDays) {
      const m = st[d] ?? 0;
      const e = estDaily[d] ?? 0;
      const ec = estCourse[d] ?? 0;
      const f = secPerLA ? (laMap.get(d) ?? 0) * secPerLA : 0;
      // 学習量ベースの2推定は逆方向に偏る: 教科別（平均×件数）は短い教材を速攻した日に過大、
      // LA×較正値は当日のLA集計ラグで過小。両方あるときは min で相殺（実測20:10 検証で
      // 教科別457分/LA291分/実際約300分）。片方しか無ければそれを使う。
      const eLearn = ec > 0 && f > 0 ? Math.min(ec, f) : Math.max(ec, f);
      combined[d] = Math.max(m, e, eLearn);
      if (combined[d] > m) estSet.add(d);
    }
    return { combined, estSet, hoursMeasured, hoursEst: estimateHourlyStudySeconds(rlogT, movT, wtT) };
  })();
  const stWrap = h('div', {}, []);
  pane.appendChild(stWrap);
  void (async () => {
    const { combined, estSet } = await timeDataPromise;
    const stKeys = Object.keys(combined).sort();
    if (!stKeys.length) {
      stWrap.appendChild(
        section('学習時間', '実測（この端末・操作中/動画再生中のみ）＋受験記録からの推定', [
          h('div', { class: 'zss-empty' }, ['ZEN Study を開いて学習するか、詳細ログの抽出を実行すると学習時間が表示されます。']),
        ])
      );
      return;
    }
    const stFirst = stKeys[0];
    const stDays = data.daily_amount.map((d) => ({
      date: d.date,
      amount: d.date < stFirst ? null : Math.round((combined[d.date] ?? 0) / 60),
    }));
    const stVals = stDays.map((d) => d.amount).filter((v): v is number => v !== null);
    const stAvg = stVals.length ? Math.round(stVals.reduce((a, b) => a + b, 0) / stVals.length) : 0;
    const todaySec = combined[isoDate(zenToday())] ?? 0;
    stWrap.appendChild(
      section(`学習時間 · 今日 ${durationStr(todaySec)}`, '実測（この端末・操作中/動画再生中のみ加算）。半透明の棒＝推定（受験記録＋動画実尺、無い日は学習数×較正値。計測開始前・他端末・当日ぶんを補完）', [
        wrapChart(renderDailyBars(stDays, stAvg, tip, fmtMin, estSet)),
        dataTable(
          'データを表で見る',
          ['日付', '曜日', '学習時間'],
          stDays.map((d) => [shortDate(d.date), weekdayLabel(d.date), d.amount === null ? '記録なし' : `${fmtMin(d.amount)}${estSet.has(d.date) ? '（推定）' : ''}`])
        ),
      ])
    );
  })();
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
  // 親トグル（学習数/学習時間）でデータ源を切替: 学習時間は studyTime（この端末の実測・分）を使う。
  const longView = h('div', {}, []);
  const views: [string, string][] = [['cal', 'カレンダー'], ['trend', 'トレンド'], ['hour', '時間帯'], ['weekday', '曜日']];
  const segBtns: HTMLElement[] = [];
  const cache: Record<string, HTMLElement> = {};
  let curView = hasLong ? 'cal' : 'weekday';
  type Basis = 'amount' | 'time';
  let basis: Basis = 'amount';
  const timeData = await timeDataPromise;
  const timeSeries = Object.keys(timeData.combined)
    .sort()
    .map((date) => ({ date, amount: Math.round((timeData.combined[date] ?? 0) / 60) }));
  const seriesOf = (b: Basis): { date: string; amount: number }[] => (b === 'time' ? timeSeries : series);
  const fmtOf = (b: Basis): ((v: number) => string) | undefined => (b === 'time' ? fmtMin : undefined);
  const hasData = (b: Basis): boolean => (b === 'time' ? timeSeries.length > 0 : hasLong);
  const emptyMsg = (b: Basis, what: string): HTMLElement =>
    h('div', { class: 'zss-empty' }, [
      b === 'time' ? `学習時間の記録（この端末で計測）が数日貯まると${what}が表示されます。` : `記録が数日貯まると${what}が表示されます。`,
    ]);

  const buildCal = (): HTMLElement =>
    hasData(basis)
      ? h('div', {}, [
          h('div', { class: 'zss-tsub-note' }, ['記録が増えるほど埋まります']),
          h('div', { class: 'zss-cal-wrap' }, [renderCalendar(calendarData(seriesOf(basis)), tip, fmtOf(basis))]),
          calLegend(),
        ])
      : emptyMsg(basis, 'カレンダー');

  // 学習時間の曜日別: 直近2週の実測から WeekdayStat を構成（学習数は従来どおり14日窓のLAから）
  const timeWeekdayStats = (): { weekday: number; avg: number | null; samples: { date: string; amount: number }[] }[] => {
    const recent = timeSeries.slice(-14);
    return Array.from({ length: 7 }, (_, wd) => {
      const samples = recent.filter((p) => new Date(p.date + 'T12:00:00').getDay() === wd);
      const avg = samples.length ? samples.reduce((a, p) => a + p.amount, 0) / samples.length : null;
      return { weekday: wd, avg, samples };
    });
  };
  const buildWeekday = (): HTMLElement =>
    h('div', {}, [
      h('div', { class: 'zss-tsub-note' }, ['各曜日 = 直近2週ぶんの平均']),
      wrapChart(renderWeekdayBars(basis === 'time' ? timeWeekdayStats() : computeWeekdayStats(data), tip, fmtOf(basis))),
    ]);

  const buildTrend = (): HTMLElement => {
    if (!hasData(basis)) return emptyMsg(basis, 'トレンド');
    const b = basis;
    let mode: TrendMode = 'week'; // 直近14日の日別バーと差別化して既定は週合計
    const trendChart = h('div', { class: 'zss-chart' }, [renderTrend(trendPoints(seriesOf(b), mode), mode, tip, fmtOf(b))]);
    const seg = h('div', { class: 'zss-seg' }, [] as HTMLElement[]);
    const modes: [TrendMode, string][] = [['day', '日'], ['week', '週'], ['month', '月']];
    const btns: HTMLElement[] = [];
    for (const [m, label] of modes) {
      const bt = h('button', m === mode ? { class: 'on' } : {}, [label]);
      bt.addEventListener('click', () => {
        mode = m;
        btns.forEach((x, i) => x.classList.toggle('on', modes[i][0] === mode));
        trendChart.textContent = '';
        trendChart.appendChild(renderTrend(trendPoints(seriesOf(b), mode), mode, tip, fmtOf(b)));
      });
      btns.push(bt);
      seg.appendChild(bt);
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

  // 学習時間の時間帯ビュー（スクリーンタイム風）: 実測バケット / 受験記録＋動画からの推定。
  // 実測は計測開始以降のみ・推定は導入前/他端末も含むが平均所要ベース。別物なので合算せず切替表示。
  const buildHourTime = (): HTMLElement => {
    const NOTES = {
      meas: '実測の時間帯分布（この端末・計測開始以降の累計）',
      est: '推定の時間帯分布（受験記録の時刻＋動画実尺＋所要時間実測から復元。導入前・他端末ぶんも含む）',
    } as const;
    const measMin = timeData.hoursMeasured.map((s) => Math.round(s / 60));
    const estMin = timeData.hoursEst.map((s) => Math.round(s / 60));
    let hm: 'meas' | 'est' = measMin.some((v) => v > 0) ? 'meas' : 'est';
    const note = h('div', { class: 'zss-tsub-note' }, []);
    const chartWrap = h('div', {}, []);
    const seg = h('div', { class: 'zss-seg' }, []);
    const hmodes: ['meas' | 'est', string][] = [['meas', '実測'], ['est', '推定（受験記録）']];
    const btns: HTMLElement[] = [];
    const apply = (): void => {
      btns.forEach((x, i) => x.classList.toggle('on', hmodes[i][0] === hm));
      note.textContent = NOTES[hm];
      chartWrap.textContent = '';
      const arr = hm === 'meas' ? measMin : estMin;
      chartWrap.appendChild(
        arr.some((v) => v > 0)
          ? wrapChart(renderHourBars(arr, tip, fmtMin))
          : h('div', { class: 'zss-empty' }, [hm === 'meas' ? '計測が貯まると表示されます（学習中の時間帯を30秒単位で記録）。' : '詳細ログの抽出を実行すると、過去の受験時刻から推定できます。'])
      );
    };
    for (const [m, label] of hmodes) {
      const bt = h('button', {}, [label]);
      bt.addEventListener('click', () => {
        hm = m;
        apply();
      });
      btns.push(bt);
      seg.appendChild(bt);
    }
    apply();
    return h('div', {}, [h('div', { class: 'zss-tsub' }, [seg]), note, chartWrap]);
  };

  const showView = async (v: string): Promise<void> => {
    curView = v;
    segBtns.forEach((x, i) => x.classList.toggle('on', views[i][0] === v));
    const key = `${basis}:${v}`;
    if (!cache[key]) {
      cache[key] =
        v === 'hour' ? (basis === 'time' ? buildHourTime() : await buildHour())
        : v === 'trend' ? buildTrend()
        : v === 'weekday' ? buildWeekday()
        : buildCal();
    }
    longView.textContent = '';
    longView.appendChild(cache[key]);
  };

  const segOuter = h('div', { class: 'zss-seg' }, [] as HTMLElement[]);
  for (const [v, label] of views) {
    const b = h('button', {}, [label]);
    b.addEventListener('click', () => void showView(v));
    segBtns.push(b);
    segOuter.appendChild(b);
  }
  // 親トグル: データ源（学習数=全学習の件数 / 学習時間=実測∨推定）
  const basisSeg = h('div', { class: 'zss-seg' }, [] as HTMLElement[]);
  const bases: [Basis, string][] = [['amount', '学習数'], ['time', '学習時間']];
  const basisBtns: HTMLElement[] = [];
  const applyBasis = (b: Basis): void => {
    basis = b;
    basisBtns.forEach((x, i) => x.classList.toggle('on', bases[i][0] === b));
    void showView(curView);
  };
  for (const [b, label] of bases) {
    const bt = h('button', b === basis ? { class: 'on' } : {}, [label]);
    bt.addEventListener('click', () => applyBasis(b));
    basisBtns.push(bt);
    basisSeg.appendChild(bt);
  }
  longWrap.appendChild(
    h('div', { class: 'zss-section' }, [
      h('div', { class: 'zss-section-head' }, [
        h('div', { class: 'zss-section-title' }, ['傾向グラフ']),
        h('div', { class: 'zss-seg-row' }, [basisSeg, segOuter]),
      ]),
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
    // 機会的スナップ（同日上書き=upsert）: 初回ロード時の日次スナップ失敗でその日の点が欠ける
    // 問題を、カードを開いたタイミングでも自己修復する（正準系列の骨格＝MHを絶やさない）。
    void snapshotMaterials(passed, total);
    void snapshotCoursePassed(courses.map((c) => ({ id: c.id, passed: c.passed })));
    const mh = await getMaterialHistory();
    // 教科別バーンダウン用: 直接観測(coursePassedHist)＋抽出ログ(受験アンカー・補間動画)
    const [subjCoursePassedHist, subjResultLog, subjSkels] = await Promise.all([
      getCoursePassedHistory().catch(() => [] as CoursePassedHistory),
      getResultLog().catch(() => [] as ResultEntry[]),
      getChapterSkels().catch(() => ({})),
    ]);
    const subjMovieEvents = interpolateMovieEvents(subjSkels, subjResultLog);

    // cold-start シード: 導入直後は自前蓄積が薄い。APIの直近14日窓(data.daily_amount)と
    // 自前履歴を日付でマージし「取れるだけの日次」を確保（新規でも初日から予測を出せる）。
    const dayMap = new Map<string, number>();
    for (const p of series) dayMap.set(p.date, p.amount);
    for (const d of data.daily_amount) if (d.amount != null) dayMap.set(d.date, d.amount);
    const merged = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, amount]) => ({ date, amount }));

    // === 正準系列（CALC_DESIGN.md / buildRequiredSeries）===
    // MH(観測)を骨格に、必修アンカー(受験＋補間動画)で穴と導入以前を埋め、pro-rata で総量を観測に一致させる。
    // 以後の消費者（実績カーブ・日次サンプル・ペース）はすべてこの系列だけを見る。
    let requiredIds: Set<number> | null = null;
    try {
      requiredIds = await getRequiredCourseIds();
    } catch {
      /* 判定不可＝必修フィルタなし（安全側で全件） */
    }
    const reqLog = requiredIds ? subjResultLog.filter((e) => requiredIds!.has(e.courseId)) : subjResultLog;
    const reqMov = requiredIds ? subjMovieEvents.filter((m) => requiredIds!.has(m.courseId)) : subjMovieEvents;
    const reqEvents = completionEvents(reqLog, reqMov);
    const series2 = buildRequiredSeries({
      mh: mh.series,
      anchorEvents: reqEvents,
      passedNow: passed,
      totalNow: total,
      todayISO: isoDate(zenToday()),
      la: merged,
    });

    // 日次サンプル（モンテカルロ/EWMA/曜日重み）: delta が確定/推定できた日のみ（null=不明は含めない）。
    // 今日はまだ途中（部分日）なので、丸1日のサンプルとして混ぜない（朝に開くと下方バイアスになる）。
    const todayIso2 = isoDate(zenToday());
    const dailySamples = series2.points
      .filter((p) => p.delta !== null && p.date !== todayIso2)
      .map((p) => ({ weekday: new Date(p.date + 'T12:00:00').getDay(), value: p.delta! }));
    // フォールバックペース: 系列の直近28日の cum 差分（不明日も日数に含む正しい平均）
    const fallbackPerDay = seriesRecentPace(series2, 28) ?? undefined;

    // 曜日別ペース: 同じ系列の日次サンプルから（非必修の曜日偏りが混入しない）。
    // 少数サンプルの曜日は全体平均へ縮小（ベイズ平均 C=3）。外れ日1つで暴れない。
    const wdSum = [0, 0, 0, 0, 0, 0, 0];
    const wdCnt = [0, 0, 0, 0, 0, 0, 0];
    let allSum = 0;
    for (const sm of dailySamples) {
      wdSum[sm.weekday] += sm.value;
      wdCnt[sm.weekday]++;
      allSum += sm.value;
    }
    const overallDaily = dailySamples.length ? allSum / dailySamples.length : 1;
    const weekdayWeights = wdSum.map((s, i) => bayesianAverage(s, wdCnt[i], overallDaily, 3));

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

    // 実績カーブも正準系列から: 確定点(estimated=false)=実線、全系列=点線（推定含む連続カーブ）。
    const actualCurve: { date: string; remaining: number }[] = series2.points
      .filter((p) => !p.estimated)
      .map((p) => ({ date: p.date, remaining: Math.max(0, total - p.cum) }));
    if (!actualCurve.length) actualCurve.push({ date: isoDate(zenToday()), remaining: total - passed });
    const overallRetro: { date: string; remaining: number }[] =
      series2.points.length > 1 ? series2.points.map((p) => ({ date: p.date, remaining: Math.max(0, total - p.cum) })) : [];
    const savedTarget = await getTargetDate();
    const electivesNote =
      report.takingCourseCount > report.requiredCourseCount
        ? `※実績・完了見込みグラフとペースは必修の教材消化（残教材＝passed_materials）のみで算出しています（非必修の学習は含めません）。「学習数」（累計・日別・推移タブ）は非必修も含む全学習の合計です（履修${report.takingCourseCount} / 必修${report.requiredCourseCount}）。`
        : `※実績・完了見込みグラフとペースは必修の教材消化（残教材）で算出。「学習数」（累計・日別・推移タブ）は全コースの合計です。`;
    // デイリー達成は「教材消化の実差分」で判定（非必修も含む学習数ではなく、完了教材数）。
    // 当日始点(ensureDayStart で記録)からの増分＝今日完了した教材数。始点が今日でなければ0。
    // 日次スナップショットが今日既に走っていて始点未記録なケースを、カード表示時にも補完（現在値=始点）。
    await ensureDayStart(passed);
    const ds = await getDayStart();
    const todayDone = ds && ds.date === isoDate(zenToday()) ? Math.max(0, passed - ds.passed) : 0;

    // 週間目標: 週始点(日曜5:00境界)からの教材差分。始点未記録ならカード表示時に補完。
    // 週の途中で始点が設置された場合は、日次スナップから週初時点の passed を復元して修復。
    // LAベースの今週ぶん推定も渡す（拡張外の消化の週帰属を修正。history.resolveWeekBase 参照）。
    const weekIsoWG = zenWeekStartISO();
    const laAllWG = merged.reduce((a, p) => a + p.amount, 0);
    const laWeekWG = merged.filter((p) => p.date >= weekIsoWG).reduce((a, p) => a + p.amount, 0);
    await ensureWeekStart(passed, await weekBaselinePassed(), laWeekWG * (laAllWG > 0 ? Math.min(1, passed / laAllWG) : 1));
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
      nowMs()
    );
    // 教科別ペース × 締切の章内訳 → 「このペースだと間に合わない教科」判定（GET 1回・失敗時は表示しないだけ）
    const coursePassedHist = subjCoursePassedHist; // 上で取得済みを再利用
    let deadlineRisks: CourseDeadlineRisk[] | null = null;
    if (dstatus.next) {
      try {
        const detail = await fetchMonthlyReport(dstatus.next.year, dstatus.next.month);
        const now = nowMs();
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
    pane.appendChild(
      renderPredictorSection(pred, actualCurve, tip, todayDone, {
        savedTarget,
        electivesNote,
        weekEl,
        calNote,
        deadlineEl,
        overallRetro,
        subjectBurndown: { courses, hist: subjCoursePassedHist, resultLog: subjResultLog, movieEvents: subjMovieEvents },
      })
    );

    // 通知（節目・デイリー達成）。永続dedupで繰り返さない。
    void notifyProgress(passed, total);
    void notifyQuest(todayDone, questTargetOf(pred));
  } catch (e) {
    console.warn('[ZSS] 完了予測の取得失敗:', e);
    pane.textContent = '';
    pane.appendChild(h('div', { class: 'zss-empty' }, ['予測を取得できませんでした。']));
  }
}

/** 教科タブ: 残教材の一覧（ティアA・即時）＋ ボタンで 動画時間/テスト/レポートの残/総（ティアB・重い）。
 *  elective モードは章単位の軽量一覧（advancedは章構造が別＝重い集計はしない）。 */
async function renderSubjectsTab(pane: HTMLElement, getCourses: () => Promise<CourseMaterial[]>, tip: Tooltip, mode: StudyMode = 'required'): Promise<void> {
  void tip;
  pane.textContent = ''; // 完了検知の再描画時の二重表示防止
  pane.appendChild(h('div', { class: 'zss-empty' }, ['読み込み中…']));
  try {
    const courses = await getCourses();
    pane.textContent = '';
    if (mode === 'elective') {
      pane.appendChild(modeBadge('elective'));
      const ec = courses as ElectiveCourse[];
      if (!ec.length) {
        pane.appendChild(h('div', { class: 'zss-empty' }, ['受講中の必修以外コースはありません（理解度または習熟度テストのある選択科目・講座がここに表示されます）。']));
        return;
      }
      pane.appendChild(renderElectiveSubjects(ec));
      return;
    }
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
    const [courses, report, hour, workTimes, coursePassedHist, mh] = await Promise.all([getCourses(), fetchReportProgresses(), getHourStats(), getWorkTimes(), getCoursePassedHistory(), getMaterialHistory()]);
    await recordDeadlineOutcomes(report.months); // 締切前の観測値を更新（遵守率の源・またぎで凍結）
    const deadlineOutcomes = await getDeadlineOutcomes();
    // 14日窓シードとマージ（新規でも分析可）
    const dayMap = new Map<string, number>();
    for (const p of series) dayMap.set(p.date, p.amount);
    for (const d of data.daily_amount) if (d.amount != null) dayMap.set(d.date, d.amount);
    const merged = [...dayMap.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, amount]) => ({ date, amount }));
    // 必修アドバイスの「現在ペース」も正準系列（buildRequiredSeries）から。
    // 予測タブと同じ源＝表示間の矛盾（予測は順調・分析は不足、等）を構造的に防ぐ。
    const totalMatA = courses.reduce((a, c) => a + c.total, 0);
    const passedMatA = courses.reduce((a, c) => a + c.passed, 0);
    let reqIdsA: Set<number> | null = null;
    try {
      reqIdsA = await getRequiredCourseIds();
    } catch {
      /* 判定不可＝全件 */
    }
    const rlogA = await getResultLog().catch(() => [] as ResultEntry[]);
    const skelsA = await getChapterSkels().catch(() => ({}));
    const movA = interpolateMovieEvents(skelsA, rlogA);
    const reqEventsA = completionEvents(
      reqIdsA ? rlogA.filter((e) => reqIdsA!.has(e.courseId)) : rlogA,
      reqIdsA ? movA.filter((m) => reqIdsA!.has(m.courseId)) : movA
    );
    const seriesA = buildRequiredSeries({
      mh: mh.series,
      anchorEvents: reqEventsA,
      passedNow: passedMatA,
      totalNow: totalMatA,
      todayISO: isoDate(zenToday()),
      la: merged,
    });
    const recentPerDay = seriesRecentPace(seriesA, 28);

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
    const resultLog = rlogA; // 上で取得済みを再利用
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

/** 教科別の残作業内訳（残の多い順・未着手を明示）。unit=集計単位ラベル（既定「教材」・electiveは「章」）。 */
function renderSubjectRemaining(courses: { id: number; title: string; total: number; passed: number }[], unit = '教材'): HTMLElement {
  const sorted = [...courses].sort((a, b) => (b.total - b.passed) - (a.total - a.passed));
  const passedAll = courses.reduce((a, c) => a + c.passed, 0);
  const totalAll = courses.reduce((a, c) => a + c.total, 0);
  const pctAll = totalAll ? Math.round((passedAll / totalAll) * 100) : 0;
  const donutSummary = h('div', { class: 'zss-vol-summary zss-vol-summary-flex' }, [
    renderDonut(passedAll, totalAll, { size: 96, label: unit }),
    h('div', { class: 'zss-vol-sum-body' }, [
      h('div', { class: 'zss-vol-sum-main' }, [`全${courses.length}コース · ${unit} ${passedAll}/${totalAll}（${pctAll}%）`]),
      h('div', { class: 'zss-vol-sum-note' }, [`残り ${totalAll - passedAll} ${unit}`]),
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
  return section('教科別の残り', `残${unit}の多い順`, [
    donutSummary,
    ...rows,
    dataTable(
      'データを表で見る',
      ['教科', '残', '完了', '総'],
      sorted.map((c) => [c.title, Math.max(0, c.total - c.passed), c.passed, c.total])
    ),
  ]);
}

/** 必修以外の教科一覧（本家「課外授業」準拠: 理解度＝閲覧進捗・習熟度テスト＝修了判定）。 */
function renderElectiveSubjects(courses: ElectiveCourse[]): HTMLElement {
  const startedOf = (c: ElectiveCourse) => (c.compDone > 0 || c.testPassed > 0 ? 1 : 0);
  // 着手コースを上に、その中で残り（未閲覧教材）の多い順。未着手は下（教材数の多い順）。
  const sorted = [...courses].sort((a, b) => startedOf(b) - startedOf(a) || (b.compLimit - b.compDone) - (a.compLimit - a.compDone) || b.compLimit - a.compLimit);
  const compTotal = courses.reduce((a, c) => a + c.compLimit, 0);
  const compDone = courses.reduce((a, c) => a + c.compDone, 0);
  const testTotal = courses.reduce((a, c) => a + c.testTotal, 0);
  const testPassed = courses.reduce((a, c) => a + c.testPassed, 0);
  const compPct = compTotal ? Math.floor((compDone / compTotal) * 100) : 0; // 本家「理解度%」は floor
  const donut = h('div', { class: 'zss-vol-summary zss-vol-summary-flex' }, [
    renderDonut(compDone, compTotal, { size: 96, label: '理解度' }),
    h('div', { class: 'zss-vol-sum-body' }, [
      h('div', { class: 'zss-vol-sum-main' }, [`全${courses.length}コース · 理解度 ${compDone}/${compTotal}（${compPct}%）`]),
      h('div', { class: 'zss-vol-sum-note' }, [testTotal ? `習熟度テスト ${testPassed}/${testTotal} 合格` : '習熟度テストなし']),
    ]),
  ]);
  const rows = sorted.map((c) => {
    const compP = c.compLimit ? Math.floor((c.compDone / c.compLimit) * 100) : 0;
    const parts: string[] = [];
    if (c.compLimit) parts.push(`理解度 ${compP}%（${c.compDone}/${c.compLimit}）`);
    if (c.testTotal) parts.push(`習熟度テスト ${c.testPassed}/${c.testTotal}`);
    return h('a', { class: 'zss-vol-course zss-vol-link', href: `/courses/${c.id}`, title: 'コースを開く' }, [
      h('div', { class: 'zss-vol-row-top' }, [
        h('span', { class: 'zss-vol-name' }, [c.title, ...(c.compDone === 0 && c.testPassed === 0 ? [h('span', { class: 'zss-untouched' }, ['未着手'])] : [])]),
        h('span', { class: 'zss-vol-pct' }, [`${parts.join(' · ')} ›`]),
      ]),
      progressBar(compP),
    ]);
  });
  return section('必修以外の教科', '本家「課外授業」準拠 · 理解度＝教材の閲覧進捗／習熟度テスト＝修了判定 · 締切なしの自己ペース', [
    donut,
    ...rows,
    dataTable(
      'データを表で見る',
      ['教科', '理解度%', '理解度(閲覧/総)', '習熟度テスト'],
      sorted.map((c) => [
        c.title,
        c.compLimit ? Math.floor((c.compDone / c.compLimit) * 100) : 0,
        `${c.compDone}/${c.compLimit}`,
        c.testTotal ? `${c.testPassed}/${c.testTotal}` : '—',
      ])
    ),
  ]);
}

/** モードのラベル小バッジ（elective ペイン冒頭に「必修以外」を明示）。 */
function modeBadge(mode: StudyMode): HTMLElement {
  return h('div', { class: 'zss-mode-badge' + (mode === 'elective' ? ' elective' : '') }, [
    mode === 'elective' ? '必修以外（選択科目・講座）' : '必修',
  ]);
}

/** 予測タブ（必修以外）: 締切が無いので消化状況＋着手サマリの軽量版。 */
async function renderElectivePredictTab(pane: HTMLElement, getCourses: () => Promise<CourseMaterial[]>): Promise<void> {
  pane.textContent = '';
  pane.appendChild(h('div', { class: 'zss-empty' }, ['読み込み中…']));
  try {
    const courses = (await getCourses()) as ElectiveCourse[];
    pane.textContent = '';
    pane.appendChild(modeBadge('elective'));
    const compTotal = courses.reduce((a, c) => a + c.compLimit, 0);
    const compDone = courses.reduce((a, c) => a + c.compDone, 0);
    const testTotal = courses.reduce((a, c) => a + c.testTotal, 0);
    const testPassed = courses.reduce((a, c) => a + c.testPassed, 0);
    const started = courses.filter((c) => c.compDone > 0 || c.testPassed > 0).length;
    const pct = compTotal ? Math.floor((compDone / compTotal) * 100) : 0;
    const remaining = Math.max(0, compTotal - compDone);

    // カード表示時にも理解度を1日1点スナップ（予測の記録を早く貯める）
    void snapshotElectivePassed(courses.map((c) => ({ id: c.id, passed: c.compDone })));
    const hist = await getElectiveHistory().catch(() => []);
    const fc = remaining > 0 ? overallForecast(hist, remaining) : null;

    // 完了見込み（順当に進めば◯頃）カード
    if (remaining === 0 && compTotal > 0) {
      pane.appendChild(
        h('div', { class: 'zss-deadline ok' }, [
          h('div', { class: 'zss-deadline-head' }, ['必修以外の完了見込み']),
          h('div', { class: 'zss-deadline-body' }, ['受講中の必修以外コースの教材（理解度）はすべて閲覧済みです。']),
        ])
      );
    } else if (fc && fc.etaDays !== null && fc.samples >= 2) {
      const finish = new Date(zenToday().getTime() + fc.etaDays * 86400000);
      pane.appendChild(
        h('div', { class: 'zss-deadline ok' }, [
          h('div', { class: 'zss-deadline-head' }, ['必修以外の完了見込み']),
          h('div', { class: 'zss-deadline-main' }, [
            h('b', {}, [`${finish.getMonth() + 1}/${finish.getDate()} ごろ`]),
            h('span', { class: 'sub' }, [`　順当に進めば（現在ペース 約${r1w(fc.perWeek)}/週）残り ${remaining} 教材を約${fc.etaDays}日で`]),
          ]),
          h('div', { class: 'zss-deadline-note' }, ['締切はありません（自己ペース）。この見込みは「理解度＝教材の閲覧進捗」の現在ペースからの目安です。ペースが上がれば早まります。']),
        ])
      );
    } else {
      pane.appendChild(
        h('div', { class: 'zss-deadline ok' }, [
          h('div', { class: 'zss-deadline-head' }, ['必修以外は自己ペース']),
          h('div', { class: 'zss-deadline-body' }, [
            fc && fc.etaDays === null
              ? '直近は理解度が進んでいないため完了見込みは未定です。教材を進めるとペースから見込みを表示します。'
              : '完了見込みはペース記録を数日ぶん貯めてから表示します（理解度の日次スナップを開始しました）。締切はありません（自己ペース）。',
          ]),
        ])
      );
    }
    pane.appendChild(
      h('div', { class: 'zss-kpis' }, [
        kpiTile(`${pct}%`, `理解度（${compDone}/${compTotal}）`),
        kpiTile(testTotal ? `${testPassed}/${testTotal}` : '—', '習熟度テスト'),
        kpiTile(`${started}/${courses.length}`, '受講コース'),
      ])
    );
    pane.appendChild(
      h('div', { class: 'zss-pred-note' }, ['必修以外の詳しい内訳は「教科」タブ（必修以外）で確認できます。理解度＝教材（動画・ガイド・授業）の閲覧進捗、習熟度テスト＝修了判定。学習数・傾向は「推移」タブに全体で表示されます。']),
    );
  } catch (e) {
    console.warn('[ZSS] 必修以外予測の取得失敗:', e);
    pane.textContent = '';
    pane.appendChild(h('div', { class: 'zss-empty' }, ['必修以外のデータを取得できませんでした。']));
  }
}

/** 分析タブ（必修以外）: 着手状況の軽量サマリ（締切遵守などの必修指標は出さない）。 */
async function renderElectiveAnalysisTab(pane: HTMLElement, getCourses: () => Promise<CourseMaterial[]>): Promise<void> {
  pane.textContent = '';
  pane.appendChild(h('div', { class: 'zss-empty' }, ['分析中…']));
  try {
    const courses = (await getCourses()) as ElectiveCourse[];
    pane.textContent = '';
    pane.appendChild(modeBadge('elective'));
    if (!courses.length) {
      pane.appendChild(h('div', { class: 'zss-empty' }, ['受講中の必修以外コースがありません。']));
      return;
    }
    const compTotal = courses.reduce((a, c) => a + c.compLimit, 0);
    const compDone = courses.reduce((a, c) => a + c.compDone, 0);
    const started = courses.filter((c) => c.compDone > 0 || c.testPassed > 0);
    const withComp = courses.filter((c) => c.compLimit > 0);
    const top = [...withComp].sort((a, b) => b.compDone / b.compLimit - a.compDone / a.compLimit)[0];
    const testTotal = courses.reduce((a, c) => a + c.testTotal, 0);
    const testPassed = courses.reduce((a, c) => a + c.testPassed, 0);
    const sec: Section = {
      title: '必修以外の学習状況',
      insights: [
        { kind: 'good', text: `全${courses.length}コース中 ${started.length} コースに着手。理解度（教材の閲覧）${compDone}/${compTotal}${compTotal ? `（${Math.floor((compDone / compTotal) * 100)}%）` : ''}。` },
        ...(testTotal ? [{ kind: 'note' as const, text: `習熟度テスト ${testPassed}/${testTotal} 合格。` }] : []),
        ...(top && top.compDone > 0 ? [{ kind: 'note' as const, text: `最も進んでいるのは「${top.title}」（理解度 ${Math.floor((top.compDone / top.compLimit) * 100)}%）。` }] : []),
        { kind: 'note', text: '必修以外は締切が無い自己ペース学習のため、締切遵守率・トレンド等の分析は必修モードでのみ表示します。日々の学習数・傾向（曜日/時間帯）は「推移」タブに全体で出ます。' },
      ],
    };
    pane.appendChild(h('div', { class: 'zss-analysis-head' }, ['必修以外の学習傾向']));
    pane.appendChild(renderInsightSection(sec));
  } catch (e) {
    console.warn('[ZSS] 必修以外分析の取得失敗:', e);
    pane.textContent = '';
    pane.appendChild(h('div', { class: 'zss-empty' }, ['必修以外のデータを取得できませんでした。']));
  }
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
          r.risk === 'late' ? `⚠︎ ${r.title}: 残${r.remaining}・${pace} → ${eta}。このペースだと間に合わないかも。` : `△ ${r.title}: 残${r.remaining}・${pace} → ${eta}。余裕がありません。`,
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
        `⚠︎ 締切超過: ${st.overdue.map((o) => md(o.deadline)).join('・')} の締切に未完の章が計${totalOver}あります（成績に影響する場合があります）。`,
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
  opts: {
    savedTarget: string | null;
    electivesNote: string;
    weekEl?: HTMLElement | null;
    calNote?: string;
    deadlineEl?: HTMLElement | null;
    overallRetro?: { date: string; remaining: number }[];
    subjectBurndown?: { courses: CourseMaterial[]; hist: CoursePassedHistory; resultLog: ResultEntry[]; movieEvents: MovieEvent[] } | null;
  }
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
  const drawOverall = (target: Date | null): void => {
    chartHost.textContent = '';
    chartHost.appendChild(renderBurndown(pred, actual, tip, target, opts.overallRetro));
    legendHost.textContent = '';
    const items: HTMLElement[] = [
      legendLine('var(--muted)', '必要ライン'),
      legendLine(pred.onTrack ? 'var(--success)' : '#d9822b', '予測(帯=P15〜85)'),
      legendItem('var(--primary)', '実績'),
      ...((opts.overallRetro?.length ?? 0) > 1 ? [legendLine('var(--primary)', '過去の推定（受験記録）')] : []),
      ...(pred.montecarlo ? [legendLine('#e5484d', '完了見込み'), legendItem('#6f5cc4', '完了分布')] : []),
      ...(target ? [legendLine(TARGET_COL, '目標ペース')] : []),
    ];
    for (const it of items) legendHost.appendChild(it);
  };

  // 教科別ビュー（傾向グラフ同様の切替）。全体が既定。教科は coursePassedHist の実績＋教科別ペースの投影。
  const bd = opts.subjectBurndown ?? null;
  let bdSelId = 0; // 0=全体
  let bdLastTarget: Date | null = null;
  const drawSubject = (): void => {
    chartHost.textContent = '';
    legendHost.textContent = '';
    const course = bd?.courses.find((c) => c.id === bdSelId);
    if (!bd || !course) return;
    const rem = Math.max(0, course.total - course.passed);
    // 直接観測（coursePassedHist・導入後）
    const pts: { date: string; remaining: number }[] = [];
    for (const row of bd.hist) {
      const p = row.byCourse[bdSelId];
      if (p !== undefined) pts.push({ date: row.date, remaining: Math.max(0, course.total - p) });
    }
    const todayIso = isoDate(zenToday());
    if (!pts.length || pts[pts.length - 1].date !== todayIso) pts.push({ date: todayIso, remaining: rem });
    // 抽出ログ由来の後方外挿（導入前も含む・アンカー確定時刻ベースで安全）
    const evs = completionEvents(
      bd.resultLog.filter((e) => e.courseId === bdSelId),
      bd.movieEvents.filter((m) => m.courseId === bdSelId)
    );
    const retroActual = courseRetroRemaining(course.total, course.passed, evs);
    // ペース: 直接観測が十分ならそれ、薄ければアンカーイベントの直近ペース（長期間で安定）
    const pace = computeCoursePaces(bd.hist).get(bdSelId);
    let perDay = pace && pace.samples >= 2 ? pace.perDay : null;
    let paceFromAnchor = false;
    if (perDay === null) {
      const ap = courseEventPace(evs, nowMs());
      if (ap !== null) {
        perDay = ap;
        paceFromAnchor = true;
      }
    }
    chartHost.appendChild(
      renderCourseBurndown({ title: course.title, total: course.total, remaining: rem, actual: pts, retroActual, perDay, paceFromAnchor, finalDeadline: pred.finalDeadline }, tip)
    );
    const daysLeft = Math.max(0, (pred.finalDeadline.getTime() - zenToday().getTime()) / 86400000);
    const ok = perDay !== null && perDay > 0 && rem / perDay <= daysLeft;
    legendHost.appendChild(legendLine('var(--muted)', '必要ライン'));
    legendHost.appendChild(legendItem('var(--primary)', '実績'));
    if (retroActual.length > 1) legendHost.appendChild(legendLine('var(--primary)', '過去の推定（抽出ログ）'));
    if (perDay !== null) legendHost.appendChild(legendLine(ok ? 'var(--success)' : '#d9822b', `現在ペース（約${Math.round(perDay * 7 * 10) / 10}/週${paceFromAnchor ? '・受験基準' : ''}）`));
    else legendHost.appendChild(h('span', { class: 'zss-tsub-note' }, ['教科別ペースは蓄積中（詳細ログの抽出でも表示できます）']));
  };
  const drawChart = (target: Date | null): void => {
    bdLastTarget = target;
    if (bdSelId === 0 || !bd) drawOverall(target);
    else drawSubject();
  };
  const bdSel = h('select', { class: 'zss-bd-select', 'aria-label': '表示する教科' }) as HTMLSelectElement;
  bdSel.appendChild(h('option', { value: '0' }, ['全体（既定）']) as HTMLOptionElement);
  if (bd) {
    for (const c of [...bd.courses].filter((c) => c.total > 0).sort((a, b) => (b.total - b.passed) - (a.total - a.passed))) {
      bdSel.appendChild(h('option', { value: String(c.id) }, [`${c.title}（残${Math.max(0, c.total - c.passed)}）`]) as HTMLOptionElement);
    }
    bdSel.addEventListener('change', () => {
      bdSelId = +bdSel.value;
      drawChart(bdLastTarget);
    });
  }

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
      h('div', { class: 'zss-bd-ctrl' }, [bdSel, h('span', { class: 'zss-section-note' }, [`締切 ${md(pred.finalDeadline)}`])]),
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

