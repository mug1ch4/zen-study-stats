// 結果ログ（テスト/レポートの受験メタデータ）からの遡及分析（純関数）。
// 導入以前の期間も含む「実測」: 日別×教科の進度・アクティブ時間帯・初回合格率・レポート得点率。
import type { Section, Insight } from './analysis';
import type { ResultEntry } from './resultLog';
import type { MovieEvent } from './movieInterp';
import { zenTodayISO } from './format';

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const DAY = 86400000;

export interface CompletionEv {
  at: number; // 教材が passed になった時刻 epoch秒
  courseId: number;
}

/** 教材が passed になった時刻のイベント（教科別バーンダウンの後方外挿用）。
 *  受験アンカー（合格した回の時刻・1教材=1件で再受験は数えない）＋補間動画。 */
export function completionEvents(entries: ResultEntry[], movieEvents: MovieEvent[]): CompletionEv[] {
  const out: CompletionEv[] = [];
  for (const e of entries) {
    if (!e.passed) continue;
    // 合格した時刻: first で合格していれば first、そうでなければ latest（essayは firstAt=単一）
    const at = e.firstPassed === false ? e.latestAt ?? e.firstAt : e.firstAt ?? e.latestAt;
    if (at) out.push({ at, courseId: e.courseId });
  }
  for (const m of movieEvents) out.push({ at: m.at, courseId: m.courseId });
  return out.sort((a, b) => a.at - b.at);
}

/** 後方外挿による教科別の残り推移（導入前も含む実績近似・純関数）。
 *  現在 passed に総イベント数を対応させ、各日の累積で相対的に戻す。
 *  ＝アンカー基準（確定時刻）なので傾き＝「いつ進めたか」は正確。ただし補間漏れ動画・
 *  supplement 差により絶対レベルは過小になりうるため「推定」として点線で描く。 */
export function courseRetroRemaining(total: number, currentPassed: number, events: CompletionEv[]): { date: string; remaining: number }[] {
  if (!events.length) return [];
  const byDay = new Map<string, number>();
  for (const ev of events) {
    const d = zenTodayISO(ev.at * 1000);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const E = events.length;
  const days = [...byDay.keys()].sort();
  let cum = 0;
  const out: { date: string; remaining: number }[] = [];
  for (const d of days) {
    cum += byDay.get(d)!;
    const passedEst = currentPassed - E + cum; // 最終日で cum=E → passedEst=currentPassed
    out.push({ date: d, remaining: Math.max(0, Math.min(total, total - passedEst)) });
  }
  return out;
}

/** アンカーイベントの直近ペース（教材/日）。coursePassedHist が薄いときの安全なフォールバック。 */
export function courseEventPace(events: CompletionEv[], nowMs: number, windowMs = 28 * DAY): number | null {
  if (events.length < 2) return null;
  const from = nowMs - windowMs;
  const inWin = events.filter((e) => e.at * 1000 >= from);
  if (inWin.length < 2) return null;
  const span = Math.max(DAY, (inWin[inWin.length - 1].at - inWin[0].at) * 1000);
  return inWin.length / (span / DAY);
}

/** 受験イベント列（first/latest の epoch秒。同一時刻の重複は1つに）。 */
export function resultEvents(entries: ResultEntry[]): { at: number; courseId: number }[] {
  const out: { at: number; courseId: number }[] = [];
  for (const e of entries) {
    if (e.firstAt) out.push({ at: e.firstAt, courseId: e.courseId });
    if (e.latestAt && e.latestAt !== e.firstAt) out.push({ at: e.latestAt, courseId: e.courseId });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 学習日（5:00境界・JST）ごとの受験数。 */
export function retroDaily(entries: ResultEntry[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const ev of resultEvents(entries)) {
    const d = zenTodayISO(ev.at * 1000);
    m.set(d, (m.get(d) ?? 0) + 1);
  }
  return m;
}

/** JST 24時間ヒストグラム（受験イベントの時刻）。 */
export function retroHours(entries: ResultEntry[]): number[] {
  const h = new Array(24).fill(0) as number[];
  for (const ev of resultEvents(entries)) {
    h[new Date((ev.at + 9 * 3600) * 1000).getUTCHours()]++;
  }
  return h;
}

const topRange3h = (arr: number[]): { label: string; sum: number } => {
  let bi = 0;
  let bs = -1;
  for (let i = 0; i < 24; i++) {
    const s = arr[i] + arr[(i + 1) % 24] + arr[(i + 2) % 24];
    if (s > bs) {
      bs = s;
      bi = i;
    }
  }
  return { label: `${bi}〜${(bi + 3) % 24}時`, sum: bs };
};

/** 遡及サマリ＋アクティブ時間帯＋初回合格率＋レポート得点率。データ不足の項目は自然に省く。 */
export function retroSections(entries: ResultEntry[], titleById: Map<number, string>): Section[] {
  if (!entries.length) return [];
  const secs: Section[] = [];
  const events = resultEvents(entries);
  const daily = retroDaily(entries);

  // --- サマリ（期間・総数・ベスト日） ---
  {
    const insights: Insight[] = [];
    if (events.length) {
      const firstD = zenTodayISO(events[0].at * 1000);
      const lastD = zenTodayISO(events[events.length - 1].at * 1000);
      const days = daily.size;
      insights.push({
        kind: 'good',
        text: `テスト/レポート ${entries.length}教材・受験${events.length}回の実測記録（${Number(firstD.slice(5, 7))}/${Number(firstD.slice(8, 10))}〜${Number(lastD.slice(5, 7))}/${Number(lastD.slice(8, 10))}・活動${days}日）。拡張の導入以前も含む正確な受験日時です。`,
      });
      const best = [...daily.entries()].reduce((a, b) => (b[1] > a[1] ? b : a));
      insights.push({ kind: 'note', text: `最も受験が多かった日: ${Number(best[0].slice(5, 7))}/${Number(best[0].slice(8, 10))}（${best[1]}回）。` });
      // 教科別の受験数（多い順・上位）
      const byCourse = new Map<number, number>();
      for (const ev of events) byCourse.set(ev.courseId, (byCourse.get(ev.courseId) ?? 0) + 1);
      const top = [...byCourse.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      insights.push({ kind: 'note', text: `教科別の受験回数: ${top.map(([id, n]) => `${titleById.get(id) ?? `コース${id}`} ${n}`).join(' / ')}。` });
    }
    secs.push({ title: '過去ログの実測サマリ', insights });
  }

  // --- アクティブ時間帯（遡及） ---
  if (events.length >= 8) {
    const hours = retroHours(entries);
    const top = topRange3h(hours);
    const peak = hours.indexOf(Math.max(...hours));
    secs.push({
      title: 'アクティブ時間帯（遡及実測）',
      insights: [
        { kind: 'good', text: `テスト/レポートの受験が最も多い時間帯: 【${top.label}】（ピークは ${peak}〜${(peak + 1) % 24}時）。` },
        { kind: 'note', text: '※受験日時(answered_at)による実測。導入以前の分も含む。動画視聴の時刻は含まない。' },
      ],
    });
  }

  // --- 初回合格率 ---
  {
    const withFirst = entries.filter((e) => e.firstPassed !== null);
    if (withFirst.length >= 5) {
      const firstPass = withFirst.filter((e) => e.firstPassed).length;
      const p = pct(firstPass, withFirst.length);
      const insights: Insight[] = [
        {
          kind: p >= 80 ? 'good' : p >= 60 ? 'note' : 'warn',
          text: `初回合格率 ${p}%（${withFirst.length}教材中 ${firstPass} が一発合格）。${p < 60 ? '受験前の復習を増やすと効率が上がりそうです。' : ''}`,
        },
      ];
      // 教科別（n>=4 のみ・低い順に1つ）
      const byCourse = new Map<number, { n: number; pass: number }>();
      for (const e of withFirst) {
        const c = byCourse.get(e.courseId) ?? { n: 0, pass: 0 };
        c.n++;
        if (e.firstPassed) c.pass++;
        byCourse.set(e.courseId, c);
      }
      const rated = [...byCourse.entries()].filter(([, c]) => c.n >= 4).map(([id, c]) => ({ id, p: pct(c.pass, c.n), n: c.n }));
      if (rated.length >= 2) {
        const worst = rated.reduce((a, b) => (b.p < a.p ? b : a));
        const bestC = rated.reduce((a, b) => (b.p > a.p ? b : a));
        insights.push({
          kind: 'note',
          text: `一発合格率が高い: ${titleById.get(bestC.id) ?? `コース${bestC.id}`} ${bestC.p}%（n=${bestC.n}） / 低い: ${titleById.get(worst.id) ?? `コース${worst.id}`} ${worst.p}%（n=${worst.n}）。`,
        });
      }
      secs.push({ title: '初回合格率（実測）', insights });
    }
  }

  // --- レポートの得点率 ---
  {
    const reports = entries.filter((e) => e.kind === 'report' && e.score !== null && e.totalScore && e.totalScore > 0);
    if (reports.length >= 3) {
      const ratio = pct(
        reports.reduce((a, e) => a + (e.score ?? 0), 0),
        reports.reduce((a, e) => a + (e.totalScore ?? 0), 0)
      );
      const insights: Insight[] = [
        { kind: ratio >= 85 ? 'good' : 'note', text: `レポートの平均得点率 ${ratio}%（${reports.length}件）。` },
      ];
      const byCourse = new Map<number, { s: number; t: number; n: number }>();
      for (const e of reports) {
        const c = byCourse.get(e.courseId) ?? { s: 0, t: 0, n: 0 };
        c.s += e.score ?? 0;
        c.t += e.totalScore ?? 0;
        c.n++;
        byCourse.set(e.courseId, c);
      }
      const rated = [...byCourse.entries()].filter(([, c]) => c.n >= 2).map(([id, c]) => ({ id, p: pct(c.s, c.t), n: c.n }));
      if (rated.length >= 2) {
        const worst = rated.reduce((a, b) => (b.p < a.p ? b : a));
        insights.push({ kind: worst.p < 70 ? 'warn' : 'note', text: `得点率が低め: ${titleById.get(worst.id) ?? `コース${worst.id}`} ${worst.p}%（${worst.n}件）。ここが伸びしろです。` });
      }
      secs.push({ title: 'レポート得点率（実測）', insights });
    }
  }

  // --- 月別×教科の進度（直近3ヶ月） ---
  {
    const byMonth = new Map<string, Map<number, number>>();
    for (const ev of events) {
      const ym = zenTodayISO(ev.at * 1000).slice(0, 7);
      const m = byMonth.get(ym) ?? new Map<number, number>();
      m.set(ev.courseId, (m.get(ev.courseId) ?? 0) + 1);
      byMonth.set(ym, m);
    }
    const months = [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-3);
    if (months.length >= 2) {
      const insights: Insight[] = months.map(([ym, m]) => {
        const total = [...m.values()].reduce((a, b) => a + b, 0);
        const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
        return {
          kind: 'note',
          text: `${Number(ym.slice(5))}月: 受験${total}回（${top.map(([id, n]) => `${titleById.get(id) ?? `コース${id}`} ${n}`).join('・')}）。`,
        };
      });
      secs.push({ title: '月別の受験ペース（実測）', insights });
    }
  }

  return secs;
}
