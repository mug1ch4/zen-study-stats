// 学習時間の実測（表示専用・通信ゼロ）。
// 「タブが可視」かつ「直近2分に操作があった or 動画再生中」の間だけ 30秒ティックで加算する
// アクティブタイム方式（アイドル除外）。zen-day（5:00境界）キーで日別秒数を蓄積。
// 【限界】この端末・拡張導入後のみの計測（他端末/導入前は含まない）。UIにもその旨を注記する。
import { zenTodayISO } from './format';

const KEY = 'zss:studyTime'; // { "YYYY-MM-DD": seconds }
const MAX_DAYS = 400;

export type StudyTime = Record<string, number>;

let memMock: StudyTime | null = null;
/** プレビュー/デモ用に注入。 */
export function __setMockStudyTime(m: StudyTime): void {
  memMock = m;
}

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local;
}

export async function getStudyTime(): Promise<StudyTime> {
  if (memMock) return memMock;
  if (!hasStorage()) return {};
  try {
    const r = await chrome.storage.local.get([KEY]);
    return (r?.[KEY] as StudyTime) ?? {};
  } catch {
    return {};
  }
}

/** 今日（zen-day）へ秒数を加算。古い日付は間引く。 */
export async function addStudyTime(sec: number): Promise<void> {
  if (memMock || !hasStorage() || sec <= 0) return;
  try {
    const cur = await getStudyTime();
    const today = zenTodayISO();
    cur[today] = (cur[today] ?? 0) + sec;
    const dates = Object.keys(cur).sort();
    for (let i = 0; i < dates.length - MAX_DAYS; i++) delete cur[dates[i]];
    await chrome.storage.local.set({ [KEY]: cur });
  } catch {
    /* 補助データ。失敗は無視 */
  }
}

/** アクティブタイム計測を開始（topフレーム専用）。
 *  - 自フレームの操作・動画再生 ＋ サブフレームからの activity ビーコンを「活動」とみなす
 *  - 可視タブで活動が直近 IDLE_MS 以内のときだけ TICK_SEC を加算
 *  複数窓の同時可視は二重計上しうるが稀なケースとして許容（単一端末の目安値）。 */
export function startStudyTimeTracking(): void {
  const TICK_SEC = 30;
  const IDLE_MS = 2 * 60_000;
  let lastActivity = Date.now(); // 起動直後は活動扱い（開いてすぐの視聴を取りこぼさない）
  const mark = (): void => {
    lastActivity = Date.now();
  };
  // 操作イベント（passive・バブリング捕捉）。pointermove は高頻度なので throttle 不要の単純代入のみ。
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(ev, mark, { passive: true, capture: true });
  }
  // サブフレーム（教材iframe）からの活動ビーコン
  window.addEventListener('message', (e) => {
    if (e.origin !== window.location.origin) return;
    const d = e.data as { __zss?: string } | null;
    if (d && typeof d === 'object' && d.__zss === 'activity') mark();
  });
  const hasPlayingVideo = (): boolean => {
    try {
      for (const v of Array.from(document.querySelectorAll('video'))) {
        if (!v.paused && !v.ended && v.currentTime > 0) return true;
      }
    } catch {
      /* noop */
    }
    return false;
  };
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (hasPlayingVideo()) mark();
    if (Date.now() - lastActivity <= IDLE_MS) void addStudyTime(TICK_SEC);
  }, TICK_SEC * 1000);
}

/** サブフレーム用: 操作・動画再生を topフレームへビーコン通知（15秒間隔に抑制）。 */
export function startFrameActivityBeacon(): void {
  let lastSent = 0;
  const send = (): void => {
    const now = Date.now();
    if (now - lastSent < 15_000) return;
    lastSent = now;
    try {
      (window.top ?? window).postMessage({ __zss: 'activity' }, window.location.origin);
    } catch {
      /* noop */
    }
  };
  for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(ev, send, { passive: true, capture: true });
  }
  window.setInterval(() => {
    try {
      for (const v of Array.from(document.querySelectorAll('video'))) {
        if (!v.paused && !v.ended && v.currentTime > 0) {
          send();
          return;
        }
      }
    } catch {
      /* noop */
    }
  }, 15_000);
}
