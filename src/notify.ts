// トースト通知のトリガ判定（永続 dedup つき）。同じ通知を繰り返し出さない。
import { showToast } from './ui/toast';
import { zenTodayISO } from './format';

const KEY = 'zss:notify';
interface NotifyState {
  milestone: number; // 直近に通知した全体%のしきい値
  questDate: string; // デイリー達成を通知した日
  rolloverDate: string; // 日付更新間近を通知した日
  weekReview?: string; // 週次レビューを通知した週（週開始=日曜ISO）
}
const MILESTONES = [10, 25, 50, 75, 90, 100];

async function load(): Promise<NotifyState> {
  try {
    const r = await chrome.storage.local.get([KEY]);
    return (r?.[KEY] as NotifyState) ?? { milestone: 0, questDate: '', rolloverDate: '' };
  } catch {
    return { milestone: 0, questDate: '', rolloverDate: '' };
  }
}
async function save(s: NotifyState): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: s });
  } catch {
    /* ignore */
  }
}

/** 全体進捗の節目（10/25/50/75/90/100%）を初めて超えた時に通知。 */
export async function notifyProgress(passedMat: number, totalMat: number): Promise<void> {
  if (!totalMat) return;
  const pct = Math.floor((passedMat / totalMat) * 100);
  const s = await load();
  const crossed = MILESTONES.filter((m) => pct >= m && m > s.milestone);
  if (!crossed.length) return;
  const top = Math.max(...crossed);
  s.milestone = top;
  await save(s);
  showToast(top >= 100 ? '全教材が完了しました。おつかれさまでした。' : `全体の進捗が ${top}% に到達しました。`, {
    accent: '#1a8a4a',
  });
}

/** 今日の必要最低限（デイリー目標）を達成した時に1日1回通知。 */
export async function notifyQuest(todayAmount: number, target: number): Promise<void> {
  if (target <= 0 || todayAmount < target) return;
  const today = zenTodayISO();
  const s = await load();
  if (s.questDate === today) return;
  s.questDate = today;
  await save(s);
  showToast(`今日の目標（${target}教材）を達成しました。`, { accent: '#1a8a4a' });
}

/** 週明けに1回だけ「先週のまとめ」を通知（Fresh Start効果: 仕切り直しの節目）。 */
export async function notifyWeekReview(weekISO: string, text: string): Promise<void> {
  const s = await load();
  if (s.weekReview === weekISO) return;
  s.weekReview = weekISO;
  await save(s);
  showToast(text, { durationMs: 9000 });
}

/** 5:00(JST)の日付更新が近い（4:30〜5:00）時に1日1回通知。 */
export async function notifyRolloverSoon(nowMs = Date.now()): Promise<void> {
  const jst = new Date(nowMs + 9 * 3600 * 1000);
  if (!(jst.getUTCHours() === 4 && jst.getUTCMinutes() >= 30)) return; // 窓外なら storage も触らない
  const today = zenTodayISO(nowMs);
  const s = await load();
  if (s.rolloverDate === today) return;
  s.rolloverDate = today;
  await save(s);
  showToast('まもなく5:00に学習日が切り替わります。今日の記録が締まります。', { accent: '#d9822b' });
}
