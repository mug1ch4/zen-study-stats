// トースト通知のトリガ判定（永続 dedup つき）。同じ通知を繰り返し出さない。
import { showToast } from './ui/toast';
import { zenTodayISO } from './format';

const KEY = 'zss:notify';
interface NotifyState {
  milestone: number; // 直近に通知した全体%のしきい値
  questDate: string; // デイリー達成を通知した日
  rolloverDate: string; // 日付更新間近を通知した日
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
  showToast(`全体の ${top}% が終わりました！${top >= 100 ? ' 🎉 全教材コンプリート！' : ' この調子で。'}`, {
    icon: top >= 100 ? '🎉' : '📈',
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
  showToast(`今日の必要最低限（${target}教材）を達成！ ✅ 予定どおりです。`, { icon: '✅', accent: '#1a8a4a' });
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
  showToast('まもなく 5:00 で日付が更新されます。今日の記録が締まる前にあと少しいかがですか？', { icon: '⏰', accent: '#d9822b' });
}
