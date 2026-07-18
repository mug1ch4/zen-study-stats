// 「あなたはこういう傾向があります」— 蓄積データから学習の傾向を導出する純関数群。
// 曜日 / 月ごと / 祝日 / 一貫性 / 時間帯 / 必修アドバイス。
// すべて自前蓄積＋GET取得済みデータのみを使用（read-only・第一原則）。
import { isHoliday } from './holidays';
import { parseDate } from './format';
import { reportDeadlineStatus, deadlineAdherence } from './deadlines';
import { computeCoursePaces, courseEtaDays } from './coursePace';
import type { CoursePassedHistory } from './history';
import type { CourseMaterial } from './courseApi';
import type { ReportProgress } from './api';

const mdOf = (d: Date): string => `${d.getMonth() + 1}/${d.getDate()}`;
import { mean as smean, median, quantile, linreg, mannKendall, kruskalWallis, lag1Autocorr, burstiness, paretoShare } from './stats';

const fmtP = (p: number): string => (p < 0.001 ? 'p<0.001' : p < 0.01 ? 'p<0.01' : `p=${p.toFixed(2)}`);
const effLabel = (eta2: number): string => (eta2 >= 0.14 ? '効果量 大' : eta2 >= 0.06 ? '効果量 中' : '効果量 小');
const r2dp = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

export interface Insight {
  kind: 'good' | 'warn' | 'note';
  text: string;
}
export interface Section {
  title: string;
  insights: Insight[];
}

const WD = ['日', '月', '火', '水', '木', '金', '土'];
type Series = { date: string; amount: number }[];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

/** 曜日の傾向: 最も進む/少ない曜日、平日 vs 週末。 */
export function weekdayTendency(series: Series): Section {
  const insights: Insight[] = [];
  if (series.length < 10) return { title: '曜日のリズム', insights: [{ kind: 'note', text: 'あと数日記録が貯まると曜日の傾向が見えてきます。' }] };
  const byWd: number[][] = [[], [], [], [], [], [], []];
  for (const p of series) byWd[parseDate(p.date).getDay()].push(p.amount);
  const avg = byWd.map((v) => (v.length ? mean(v) : null));
  const known = avg.map((v, i) => ({ i, v })).filter((x) => x.v !== null) as { i: number; v: number }[];
  if (known.length >= 3) {
    const best = known.reduce((a, b) => (b.v > a.v ? b : a));
    const worst = known.reduce((a, b) => (b.v < a.v ? b : a));
    insights.push({ kind: 'good', text: `最も進むのは【${WD[best.i]}曜】平均 ${r1(best.v)}件。少ないのは【${WD[worst.i]}曜】平均 ${r1(worst.v)}件。` });
  }
  const wk = series.filter((p) => { const d = parseDate(p.date).getDay(); return d !== 0 && d !== 6; }).map((p) => p.amount);
  const we = series.filter((p) => { const d = parseDate(p.date).getDay(); return d === 0 || d === 6; }).map((p) => p.amount);
  if (wk.length && we.length) {
    const p = pct(mean(we), mean(wk));
    insights.push({
      kind: p < 70 ? 'warn' : 'note',
      text: `平日 平均 ${r1(mean(wk))}件 / 週末 平均 ${r1(mean(we))}件（週末は平日の ${p}%）。${p < 70 ? '週末に失速しがちです。' : p > 120 ? '週末型ですね。' : 'バランス良好。'}`,
    });
  }
  // 有意性: 曜日差が統計的に本物かノイズか（Kruskal-Wallis）。小標本の過信を防ぐ。
  const kw = kruskalWallis(byWd);
  if (kw.k >= 3 && kw.n >= 14) {
    insights.push(
      kw.p < 0.05
        ? { kind: 'note', text: `※曜日差は統計的に有意（${fmtP(kw.p)}・${effLabel(kw.eta2)}）。傾向として信頼できます。` }
        : { kind: 'note', text: `※現時点では曜日差は誤差の範囲（${fmtP(kw.p)}）。日数が増えると精度が上がります。` }
    );
  }
  return { title: '曜日のリズム', insights };
}

/** 月ごとの傾向: 月別平均、直近月の増減。 */
export function monthlyTendency(series: Series): Section {
  const insights: Insight[] = [];
  const byMonth = new Map<string, number[]>();
  for (const p of series) {
    const ym = p.date.slice(0, 7);
    (byMonth.get(ym) ?? byMonth.set(ym, []).get(ym)!).push(p.amount);
  }
  const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([ym, v]) => ({ ym, avg: mean(v) }));
  if (months.length < 2) return { title: '月ごとの傾向', insights: [{ kind: 'note', text: '月をまたいで記録が貯まると、月ごとの傾向を表示します。' }] };
  const cur = months[months.length - 1];
  const prev = months[months.length - 2];
  const ch = prev.avg > 0 ? Math.round((cur.avg / prev.avg - 1) * 100) : null;
  const m = (ym: string) => `${Number(ym.slice(5))}月`;
  if (ch !== null) {
    insights.push({
      kind: ch <= -15 ? 'warn' : ch >= 15 ? 'good' : 'note',
      text: `${m(cur.ym)}は 平均 ${r1(cur.avg)}件（${m(prev.ym)}比 ${ch >= 0 ? '+' : ''}${ch}%）。${ch <= -15 ? 'ペースが落ちています。' : ch >= 15 ? '好調です。' : 'ほぼ横ばい。'}`,
    });
  }
  const best = months.reduce((a, b) => (b.avg > a.avg ? b : a));
  insights.push({ kind: 'note', text: `最も進んだ月: ${m(best.ym)}（平均 ${r1(best.avg)}件）。` });
  return { title: '月ごとの傾向', insights };
}

/** 祝日の傾向: 祝日 vs 平日のペース比。 */
export function holidayTendency(series: Series): Section {
  const hol = series.filter((p) => isHoliday(p.date)).map((p) => p.amount);
  const wd = series.filter((p) => { const d = parseDate(p.date).getDay(); return d !== 0 && d !== 6 && !isHoliday(p.date); }).map((p) => p.amount);
  if (hol.length < 2 || wd.length < 3) return { title: '祝日の傾向', insights: [{ kind: 'note', text: '祝日の記録が増えると傾向を表示します。' }] };
  const p = pct(mean(hol), mean(wd));
  return {
    title: '祝日の傾向',
    insights: [{
      kind: p < 60 ? 'warn' : 'note',
      text: `祝日は平日の ${p}% のペース（祝日 平均 ${r1(mean(hol))}件）。${p < 60 ? '祝日は休みがちです。' : p > 110 ? '祝日を活用できています。' : ''}`,
    }],
  };
}

/** 一貫性: ばらつき(CV)から「コツコツ型/ムラ型」、学習日率、最長連続。 */
export function consistencyTendency(series: Series): Section {
  if (series.length < 10) return { title: '継続の傾向', insights: [{ kind: 'note', text: '記録が増えると継続の傾向を分析します。' }] };
  const vals = series.map((p) => p.amount);
  const mu = mean(vals);
  const sd = Math.sqrt(mean(vals.map((v) => (v - mu) ** 2)));
  const cv = mu > 0 ? sd / mu : 0;
  const studiedRate = pct(vals.filter((v) => v > 0).length, vals.length);
  const insights: Insight[] = [];
  insights.push({
    kind: cv < 0.6 ? 'good' : cv > 1.1 ? 'warn' : 'note',
    text: cv < 0.6 ? 'コツコツ型（日々の量が安定しています）。' : cv > 1.1 ? 'ムラ型（まとめてやる傾向。安定させると予測が当たりやすくなります）。' : '標準的なばらつきです。',
  });
  insights.push({ kind: studiedRate >= 70 ? 'good' : 'note', text: `学習日率 ${studiedRate}%（記録のある日のうち学習した日）。` });

  // 学習日の間隔から: 最長の空白 ＋ バースト度（タイミングがまとまっているか）
  const studyTimes = series.filter((p) => p.amount > 0).map((p) => parseDate(p.date).getTime()).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < studyTimes.length; i++) gaps.push(Math.round((studyTimes[i] - studyTimes[i - 1]) / 86400000));
  const maxGap = gaps.length ? Math.max(...gaps) : 0;
  if (maxGap >= 3) {
    insights.push({ kind: maxGap >= 7 ? 'warn' : 'note', text: `最長 ${maxGap}日の学習空白がありました。${maxGap >= 7 ? '長い中断は取り戻しが大変。短めに留めましょう。' : ''}` });
  }
  const B = burstiness(gaps);
  if (B !== null && Math.abs(B) >= 0.15) {
    insights.push({
      kind: 'note',
      text: B > 0.15 ? `学習のタイミングは「まとめて型」寄り（バースト度 ${r2dp(B)}）。` : `規則的なリズムで学習できています（バースト度 ${r2dp(B)}）。`,
    });
  }
  return { title: '継続の傾向', insights };
}

/** トレンド（伸びているか）: 線形回帰の傾き＋Mann-Kendall検定＋週モメンタム＋好日の連鎖(自己相関)。 */
export function trendTendency(series: Series): Section {
  if (series.length < 14) return { title: 'トレンド（伸びているか）', insights: [{ kind: 'note', text: '2週間ぶん貯まるとトレンドを判定します。' }] };
  const vals = series.map((p) => p.amount);
  const lr = linreg(vals);
  const mk = mannKendall(vals);
  const perWeek = lr.slope * 7; // 1日あたりの傾き → 週あたり
  const insights: Insight[] = [];
  if (mk.trend === 'up') {
    insights.push({ kind: 'good', text: `上昇トレンド（週あたり約 +${r1(perWeek)}件のペースで増加・統計的に有意）。良い流れです。` });
  } else if (mk.trend === 'down') {
    insights.push({ kind: 'warn', text: `下降トレンド（週あたり約 ${r1(perWeek)}件で減少・統計的に有意）。ペースを立て直しましょう。` });
  } else {
    insights.push({ kind: 'note', text: `明確な増減トレンドは無く、ほぼ横ばいです（週あたり ${perWeek >= 0 ? '+' : ''}${r1(perWeek)}件）。` });
  }
  // 週モメンタム: 直近7日 vs その前3週
  const last7 = vals.slice(-7);
  const prev3w = vals.slice(-28, -7);
  if (last7.length >= 3 && prev3w.length >= 3) {
    const a = smean(last7), b = smean(prev3w);
    const ch = b > 0 ? Math.round((a / b - 1) * 100) : null;
    if (ch !== null) insights.push({ kind: ch <= -15 ? 'warn' : ch >= 15 ? 'good' : 'note', text: `直近1週は 平均 ${r1(a)}件（その前3週比 ${ch >= 0 ? '+' : ''}${ch}%）。${ch >= 15 ? '加速中。' : ch <= -15 ? '失速気味。' : '横ばい。'}` });
  }
  // ラグ1自己相関: 好調が続きやすいか（習慣の粘り）
  const ac = lag1Autocorr(vals);
  if (Math.abs(ac) >= 0.2) {
    insights.push(
      ac > 0
        ? { kind: 'good', text: `勢いが続きやすいタイプ（前日が多いと翌日も多め・自己相関 ${r2dp(ac)}）。連続を活かせています。` }
        : { kind: 'note', text: `反動が出やすいタイプ（多い日の翌日は減りがち・自己相関 ${r2dp(ac)}）。ならすと安定します。` }
    );
  }
  return { title: 'トレンド（伸びているか）', insights };
}

/** 普段と好調（分布）: 中央値＝普段の1日、上位1割＝好調日、0の日、上位集中度（パレート）。 */
export function distributionSummary(series: Series): Section {
  if (series.length < 10) return { title: '普段と好調（分布）', insights: [{ kind: 'note', text: '記録が増えると学習量の分布を表示します。' }] };
  const vals = series.map((p) => p.amount);
  const med = median(vals);
  const p90 = quantile(vals, 0.9);
  const zeroDays = vals.filter((v) => v === 0).length;
  const zeroPct = pct(zeroDays, vals.length);
  const insights: Insight[] = [];
  insights.push({ kind: 'note', text: `普段の1日は ${r1(med)}件（中央値）。調子のいい日で ${r1(p90)}件（上位1割）。` });
  insights.push({ kind: zeroPct >= 30 ? 'warn' : 'note', text: `学習0の日は ${zeroDays}日（${zeroPct}%）。` });
  const share = Math.round(paretoShare(vals, 0.2) * 100);
  if (share > 0) insights.push({ kind: share >= 60 ? 'warn' : 'note', text: `上位2割の日で全体の ${share}% を消化。${share >= 60 ? '一部の日に偏りがち。ならすと安定します。' : '比較的ならされています。'}` });
  return { title: '普段と好調（分布）', insights };
}

/** 時間帯: 自前記録(hourStats)から、学習が進む/よく開く時間帯。 */
export function timeOfDayTendency(hour: { study: number[]; visit: number[] }): Section {
  const totalStudy = hour.study.reduce((a, b) => a + b, 0);
  const totalVisit = hour.visit.reduce((a, b) => a + b, 0);
  const band = (h: number) => `${h}〜${(h + 1) % 24}時`;
  const topRange = (arr: number[]): string => {
    // 連続3時間で最大の窓
    let bi = 0, bs = -1;
    for (let h = 0; h < 24; h++) {
      const s = arr[h] + arr[(h + 1) % 24] + arr[(h + 2) % 24];
      if (s > bs) { bs = s; bi = h; }
    }
    return `${bi}〜${(bi + 3) % 24}時`;
  };
  if (totalStudy >= 8) {
    const peak = hour.study.indexOf(Math.max(...hour.study));
    return { title: '時間帯の傾向', insights: [
      { kind: 'good', text: `学習が最も進む時間帯: 【${topRange(hour.study)}】（ピークは ${band(peak)}）。` },
      { kind: 'note', text: '※動画/テスト等の完了を検知した"その時刻"を記録（本家の完了通信を観測。合格して教材数が実際に増えた時のみ計上）。PCで進めたぶんが対象。' },
    ] };
  }
  if (totalVisit >= 4) {
    return { title: '時間帯の傾向', insights: [
      { kind: 'note', text: `よく ZEN Study を開くのは 【${topRange(hour.visit)}】。学習時間帯はもう少しデータが必要です。` },
    ] };
  }
  return { title: '時間帯の傾向', insights: [{ kind: 'note', text: 'PCで動画/テスト等を完了すると、その時刻を記録します（APIに時刻が無いため、本家の完了通信を観測して自前計測）。数回で傾向が出ます。' }] };
}

/** これまでの歩み: 記録開始からの累計をひとまとめ（Wrapped風の常設サマリ・Endowed Progress）。 */
export function journeySummary(
  series: Series,
  passedMat: number,
  totalMat: number,
  longestStreak: number,
  achUnlocked: number,
  achTotal: number
): Section {
  if (!series.length) {
    return { title: 'これまでの歩み', insights: [{ kind: 'note', text: '記録が貯まると、開始からの歩みをまとめて表示します。' }] };
  }
  const first = series[0].date;
  const d = parseDate(first);
  const totalAmount = series.reduce((a, p) => a + p.amount, 0);
  const studied = series.filter((p) => p.amount > 0).length;
  const best = series.reduce((a, p) => (p.amount > a.amount ? p : a), series[0]);
  const insights: Insight[] = [
    { kind: 'good', text: `${d.getMonth() + 1}/${d.getDate()} の記録開始から ${series.length}日・学習${studied}日・学習数 累計${totalAmount}件。` },
    { kind: 'note', text: `教材 ${passedMat}/${totalMat} 完了（${pct(passedMat, totalMat)}%）・最長連続 ${longestStreak}日・実績 ${achUnlocked}/${achTotal}。` },
    { kind: 'note', text: `ベスト日: ${Number(best.date.slice(5, 7))}/${Number(best.date.slice(8, 10))} の ${best.amount}件。積み上げた分は消えません。` },
  ];
  return { title: 'これまでの歩み', insights };
}

/** 所要時間の実測: 完了検知の間隔から蓄積した「教科×種別の所要」を詳細表示。 */
export function workTimeTendency(
  wt: Record<string, { test?: { min: number; q: number; n: number }; report?: { min: number; q: number; n: number } }>,
  courses: CourseMaterial[]
): Section {
  const titleById = new Map(courses.map((c) => [String(c.id), c.title]));
  const rows: { title: string; parts: string[]; n: number }[] = [];
  let allTest = { min: 0, q: 0, n: 0 };
  let allRep = { min: 0, q: 0, n: 0 };
  const fmt = (st: { min: number; q: number; n: number }): string =>
    `平均 ${r1(st.min / st.n)}分/本${st.q > 0 ? `（${r1(st.min / st.q)}分/問）` : ''}・${st.n}件`;
  for (const [id, c] of Object.entries(wt)) {
    const parts: string[] = [];
    let n = 0;
    if (c.test?.n) {
      parts.push(`テスト ${fmt(c.test)}`);
      allTest = { min: allTest.min + c.test.min, q: allTest.q + c.test.q, n: allTest.n + c.test.n };
      n += c.test.n;
    }
    if (c.report?.n) {
      parts.push(`レポート ${fmt(c.report)}`);
      allRep = { min: allRep.min + c.report.min, q: allRep.q + c.report.q, n: allRep.n + c.report.n };
      n += c.report.n;
    }
    if (parts.length) rows.push({ title: titleById.get(id) ?? `コース${id}`, parts, n });
  }
  if (!rows.length) {
    return {
      title: '所要時間の実測',
      insights: [{ kind: 'note', text: 'PCでテスト/レポートを完了すると、直前の完了からの間隔で所要時間を自動実測します（教科別の残り時間換算の精度が上がります）。' }],
    };
  }
  rows.sort((a, b) => b.n - a.n);
  const insights: Insight[] = [];
  const overall: string[] = [];
  if (allTest.n) overall.push(`テスト ${fmt(allTest)}`);
  if (allRep.n) overall.push(`レポート ${fmt(allRep)}`);
  insights.push({ kind: 'good', text: `全体: ${overall.join(' / ')}。` });
  for (const r of rows.slice(0, 8)) insights.push({ kind: 'note', text: `${r.title}: ${r.parts.join(' / ')}` });
  insights.push({ kind: 'note', text: '※直前の完了からの間隔（0.5〜45分のみ採用・確定完了時のみ）による近似。サンプルが増えるほど教科別シェアの時間換算に反映されます。' });
  return { title: '所要時間の実測', insights };
}

/** 教科別ペースと完了見込み（教科別 passed 履歴の蓄積から）。数日ぶん貯まると表示。 */
export function coursePaceTendency(history: CoursePassedHistory, courses: CourseMaterial[]): Section {
  const titleById = new Map(courses.map((c) => [c.id, c.title]));
  const remById = new Map(courses.map((c) => [c.id, Math.max(0, c.total - c.passed)]));
  const paces = computeCoursePaces(history, 28 * 86400000);
  const rows = [...paces.values()]
    .filter((p) => p.samples >= 2 && (remById.get(p.id) ?? 0) > 0)
    .map((p) => ({
      id: p.id,
      title: titleById.get(p.id) ?? `コース${p.id}`,
      perWeek: p.perWeek,
      eta: courseEtaDays(remById.get(p.id) ?? 0, p.perDay),
    }))
    .sort((a, b) => (a.eta === null ? 1 : b.eta === null ? -1 : b.eta - a.eta)); // 遠い（危ない）順
  if (!rows.length) {
    return {
      title: '教科別ペース',
      insights: [{ kind: 'note', text: '教科ごとの消化ペースを日々記録中。数日ぶん貯まると、教科別のペースと完了見込みを表示します。' }],
    };
  }
  const insights: Insight[] = rows.slice(0, 8).map((r) => ({
    kind: r.eta === null ? 'warn' : 'note',
    text:
      r.eta === null
        ? `${r.title}: 直近は進んでいません（このままだと完了時期は未定）。`
        : `${r.title}: 約 ${r1(r.perWeek)}/週 → このペースで完了まで 約${r.eta}日。`,
  }));
  insights.push({ kind: 'note', text: '※教科ごとの passed 差分から算出。締切に間に合うかの教科別判定は「予測」タブの締切カードに表示します。' });
  return { title: '教科別ペース', insights };
}

/** レポート締切の状況: 締切遵守率（過去）＋締切超過＋次の締切。月次締切ベースの分析。 */
export function deadlineTendency(report: ReportProgress): Section {
  const months = report.months.map((m) => ({ year: m.year, month: m.month, deadline: m.deadline, total: m.total, passed: m.passed }));
  const st = reportDeadlineStatus(months, Date.now());
  const adh = deadlineAdherence(months, Date.now());
  const insights: Insight[] = [];

  // 遵守率（分析の主眼）: 過去の締切をどれだけ期限内に守れたか
  if (adh.pastTotal >= 2) {
    const p = Math.round(adh.rate * 100);
    insights.push({
      kind: p >= 90 ? 'good' : p >= 60 ? 'note' : 'warn',
      text: `締切遵守率 ${p}%（過去${adh.pastTotal}回の締切のうち期限内に完了 ${adh.pastMet}回）。${p >= 90 ? '安定して守れています。' : p < 60 ? '締切に間に合わない月が目立ちます。前倒しを。' : ''}`,
    });
  }
  // 締切超過（成績に影響）
  if (st.overdue.length) {
    const totalOver = st.overdue.reduce((a, o) => a + o.remaining, 0);
    insights.push({ kind: 'warn', text: `未完のまま過ぎた締切が ${st.overdue.length}件（残り章 計${totalOver}）。成績に影響する場合があります。まず超過分から着手を。` });
  }
  // 次の締切
  if (st.next) {
    const n = st.next;
    insights.push({
      kind: n.daysLeft <= 7 && n.remaining > 0 ? 'warn' : 'note',
      text: `次の締切は ${mdOf(n.deadline)}（あと${n.daysLeft}日）・残り ${n.remaining}章。${n.daysLeft > 0 ? `間に合わせるには1日あたり約 ${r1(n.remaining / Math.max(1, n.daysLeft))}章ぶん。` : ''}`,
    });
  } else if (!st.overdue.length) {
    insights.push({ kind: 'good', text: '直近の締切ぶんは完了済みです。' });
  }
  if (!insights.length) insights.push({ kind: 'note', text: '締切の記録が貯まると、締切遵守の傾向を表示します。' });
  return { title: 'レポート締切の状況', insights };
}

/** 必修に関するアドバイス: 残りレポート・締切・最優先コース・ペース判定。 */
export function requiredAdvice(
  courses: CourseMaterial[],
  report: ReportProgress,
  recentPerDay: number | null
): Section {
  const insights: Insight[] = [];
  const remReports = Math.max(0, report.totalReports - report.passedReports);
  const deadline = report.finalDeadline ? parseDate(report.finalDeadline.slice(0, 10)) : null;
  const daysLeft = deadline ? Math.max(0, Math.round((deadline.getTime() - Date.now()) / 86400000)) : null;
  if (deadline && daysLeft !== null) {
    insights.push({
      kind: daysLeft < 21 && remReports > 3 ? 'warn' : 'note',
      text: `必修レポート 残り ${remReports}件・締切 ${deadline.getMonth() + 1}/${deadline.getDate()} まで ${daysLeft}日。`,
    });
  }
  // 最優先（残教材が最多／未着手）
  const withRem = courses.map((c) => ({ ...c, rem: Math.max(0, c.total - c.passed) })).filter((c) => c.rem > 0);
  if (withRem.length) {
    const untouched = withRem.filter((c) => c.passed === 0).sort((a, b) => b.rem - a.rem);
    const top = (untouched[0] ?? withRem.sort((a, b) => b.rem - a.rem)[0]);
    insights.push({
      kind: top.passed === 0 ? 'warn' : 'note',
      text: `最優先は「${top.title}」（残 ${top.rem} 教材${top.passed === 0 ? '・未着手' : ''}）。まずここから着手を。`,
    });
  }
  const untouchedCount = courses.filter((c) => c.passed === 0 && c.total > 0).length;
  if (untouchedCount >= 2) insights.push({ kind: 'warn', text: `未着手の教科が ${untouchedCount} あります。現状ペースでは終わらないので、早めに全教科へ手を付けましょう。` });
  // ペース判定
  const totalRem = courses.reduce((a, c) => a + Math.max(0, c.total - c.passed), 0);
  if (recentPerDay !== null && recentPerDay > 0 && daysLeft && daysLeft > 0) {
    const need = totalRem / daysLeft;
    insights.push({
      kind: recentPerDay >= need ? 'good' : 'warn',
      text: recentPerDay >= need
        ? `現在ペース（約 ${r1(recentPerDay)}/日）は必要ペース（約 ${r1(need)}/日）を上回っています。この調子で。`
        : `必要ペースは 約 ${Math.ceil(need)}/日。現在（約 ${r1(recentPerDay)}/日）だと不足。1日あたり あと +${Math.ceil(need - recentPerDay)} 教材を。`,
    });
  }
  if (!insights.length) insights.push({ kind: 'good', text: '必修は順調です。' });
  return { title: '必修へのアドバイス', insights };
}
