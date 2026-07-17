// 「あなたはこういう傾向があります」— 蓄積データから学習の傾向を導出する純関数群。
// 曜日 / 月ごと / 祝日 / 一貫性 / 時間帯 / 必修アドバイス。
// すべて自前蓄積＋GET取得済みデータのみを使用（read-only・第一原則）。
import { isHoliday } from './holidays';
import { parseDate } from './format';
import type { CourseMaterial } from './courseApi';
import type { ReportProgress } from './api';

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
  return { title: '継続の傾向', insights };
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
