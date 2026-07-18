// モチベーション維持のナッジ（行動科学/マーケティングの実証手法に基づく・純関数）。
// すべて自分のデータから honest に生成（誇張や偽の進捗は作らない）。
//  - Endowed Progress効果 (Nunes & Drèze 2006): 積み上げた進捗を強調して完了意欲を高める
//  - Goal-Gradient効果 (Kivetz, Urminsky & Zheng 2006): ゴール接近を可視化しラストスパートを促す
//  - Fresh Start効果 (Dai, Milkman & Riis 2014): 週初め/月初などの時間的節目で仕切り直しを促す
//  - Implementation Intentions (Gollwitzer): 「いつ・どこで」を具体化すると継続率が上がる
//  - Loss Aversion / Streak (Duolingo流): 連続記録を守る損失フレーミング
import { parseDate } from './format';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

export interface Nudge {
  kind: 'streak' | 'landmark' | 'goal' | 'plan' | 'progress';
  text: string;
}

export interface MotivationCtx {
  today: Date;
  todayAmount: number;
  series: { date: string; amount: number }[];
  streak: { current: number; longest: number };
  totalMaterials: number;
  passedMaterials: number;
  courses: { title: string; total: number; passed: number }[];
  hour: { study: number[] };
  /** やりかけの章（あと少しで章完了）。Zeigarnik効果: 未完のタスクは頭に残る→片付ける快感を提示。 */
  nearChapter?: { courseTitle: string; chapterTitle: string; remaining: number } | null;
}

function bestWeekday(series: { date: string; amount: number }[]): number | null {
  if (series.length < 10) return null;
  const sum = [0, 0, 0, 0, 0, 0, 0];
  const cnt = [0, 0, 0, 0, 0, 0, 0];
  for (const p of series) {
    const w = parseDate(p.date).getDay();
    sum[w] += p.amount;
    cnt[w]++;
  }
  let best = -1;
  let bestAvg = -1;
  for (let w = 0; w < 7; w++) {
    if (cnt[w] && sum[w] / cnt[w] > bestAvg) {
      bestAvg = sum[w] / cnt[w];
      best = w;
    }
  }
  return best >= 0 ? best : null;
}

function bestHourBand(study: number[]): string | null {
  if (study.reduce((a, b) => a + b, 0) < 8) return null;
  let bi = 0;
  let bs = -1;
  for (let h = 0; h < 24; h++) {
    const s = study[h] + study[(h + 1) % 24] + study[(h + 2) % 24];
    if (s > bs) {
      bs = s;
      bi = h;
    }
  }
  return `${bi}〜${(bi + 3) % 24}時`;
}

/** 状況に応じたナッジを優先度順で返す（UIは上位1〜2件を表示）。 */
export function motivationNudges(ctx: MotivationCtx): Nudge[] {
  const out: Nudge[] = [];
  const remaining = Math.max(0, ctx.totalMaterials - ctx.passedMaterials);
  const pct = ctx.totalMaterials ? Math.round((ctx.passedMaterials / ctx.totalMaterials) * 100) : 0;

  // 1) ストリーク（Loss Aversion / Goal-Gradient）— 時間依存で最優先
  if (ctx.streak.current >= 1 && ctx.todayAmount === 0) {
    out.push({ kind: 'streak', text: `連続${ctx.streak.current}日を継続中。今日まだ0件です—1件でも進めれば記録は途切れません。` });
  } else if (ctx.streak.current >= 2 && ctx.streak.current === ctx.streak.longest - 1) {
    out.push({ kind: 'streak', text: `あと1日で自己ベスト（${ctx.streak.longest}日連続）に並びます！` });
  } else if (ctx.streak.current >= 3 && ctx.todayAmount > 0) {
    out.push({ kind: 'streak', text: `連続${ctx.streak.current}日、いい調子です。今日も記録更新中。` });
  }

  // 2) Fresh Start（時間的節目）— 週初(日曜)/月初は仕切り直しに最適
  const d = ctx.today;
  if (d.getDate() === 1) {
    out.push({ kind: 'landmark', text: `今日から新しい月。先月までは一区切り、ここから仕切り直して今月の目標を決めましょう（予測タブで設定できます）。` });
  } else if (d.getDay() === 0) {
    out.push({ kind: 'landmark', text: `新しい週の始まり。今週の"やる量"を決めると弾みがつきます（週初めは続けやすい時期です）。` });
  }

  // 3) Zeigarnik: やりかけの章（未完のタスクは頭に残る→最も近い完了を提示）
  if (ctx.nearChapter) {
    const nc = ctx.nearChapter;
    out.push({ kind: 'goal', text: `「${nc.courseTitle}」の${nc.chapterTitle}は あと${nc.remaining}教材で章完了。やりかけを片付けると勢いがつきます。` });
  }

  // 3') Goal-Gradient: 完了間近のコース（近い小目標を提示）
  const near = ctx.courses
    .map((c) => ({ title: c.title, rem: Math.max(0, c.total - c.passed) }))
    .filter((c) => c.rem > 0 && c.rem <= 5)
    .sort((a, b) => a.rem - b.rem)[0];
  if (near) {
    out.push({ kind: 'goal', text: `「${near.title}」はあと${near.rem}教材で完了。まずここを終わらせると達成感で勢いが出ます。` });
  }

  // 4) Goal-Gradient: 全体のラストスパート / Endowed Progress: 積み上げた進捗の強調
  if (remaining > 0 && pct >= 75) {
    out.push({ kind: 'goal', text: `全体の${pct}%が完了。ゴールまであと${100 - pct}%です—ここからはラストスパート。` });
  } else if (pct > 0) {
    out.push({ kind: 'progress', text: `すでに${ctx.passedMaterials}教材（全体の${pct}%）を完了済み。積み上げた分は消えません、この調子で。` });
  }

  // 5) Implementation Intention（いつ・どこで を具体化）— 常時出せる継続のコツ
  const bw = bestWeekday(ctx.series);
  const band = bestHourBand(ctx.hour.study);
  if (bw !== null || band) {
    const when = [bw !== null ? `${WD[bw]}曜` : null, band].filter(Boolean).join('の');
    out.push({ kind: 'plan', text: `続けるコツ: あなたが最も進むのは【${when}】。「◯◯の後に${'教材を数本'}」のように"いつやるか"を決めておくと習慣になります。` });
  }

  return out;
}
