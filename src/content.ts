// コンテンツスクリプトのエントリ。
// 【第一原則】GETのみ・read-only。DOMは自ブラウザの描画変更のみ。学習記録は一切変更しない。
import { fetchLearningAmounts, fetchReportProgresses, type LearningAmounts } from './api';
import { fetchMaterialTotals, fetchSectionQuestions } from './courseApi';
import { applyOverwrite, removeCard, hideOriginalNow } from './inject';
import { initDarkMode, initDarkModeFrame, preInitDarkMode, syncOurCard, rescanSoon, ensureToggleMounted, refreshNavToggle } from './darkmode';
import { maybeDailySnapshot, mergeWindow, snapshotReports, snapshotMaterials, recordVisit, recordCompletion, getLastPassed, setLastPassed, ensureDayStart, ensureWeekStart, getSeries, recordWorkTime } from './history';
import { ensureCourseSummary, refreshSummary } from './summaryInject';
import { ensureMyCourseUndone } from './myCourseInject';
import { ensureSidePanel, removeSidePanel } from './ui/sidePanel';
import { notifyRolloverSoon, notifyProgress, notifyWeekReview } from './notify';
import { zenMondayISO, parseDate, weekdayLabel } from './format';
import { showToast } from './ui/toast';

// 【DEV】完了検知の動作確認用トースト。切り分け（observer発火/確定判定）を可視化する。
// ※リリース前に false に戻す（通常ユーザーには不要）。
const DEV_NOTIFY = false;

const SETTING_PATH = '/setting';

let cache: LearningAmounts | null = null;
let fetching = false;

function isSettingPath(): boolean {
  return location.pathname.replace(/\/+$/, '') === SETTING_PATH;
}

/** /setting にいる間、本家パネルを上書きした状態を維持（毎tick冪等）。 */
async function ensureApplied(): Promise<void> {
  if (!isSettingPath()) return;
  // データが未取得なら一度だけ取得
  if (!cache) {
    if (fetching) return;
    fetching = true;
    try {
      cache = await fetchLearningAmounts();
    } catch (e) {
      console.warn('[ZSS] 学習数の取得に失敗:', e);
      return;
    } finally {
      fetching = false;
    }
  }
  if (!isSettingPath() || !cache) return;
  const applied = applyOverwrite(cache); // アンカー未描画なら false（次tickで再試行）
  if (applied) {
    syncOurCard(); // ダーク中なら自前カードもdark配色に揃える
    void mergeWindow(cache.daily_amount); // 最新14日を履歴へマージ
  }
}

function sync(): void {
  if (isSettingPath()) {
    hideOriginalNow(); // 即座に本家を隠す（フラッシュ防止）
    void ensureApplied();
    removeSidePanel(); // /setting は本体カードがあるのでパネルは出さない
  } else {
    removeCard();
    ensureSidePanel(); // 他ページでは端の展開パネルを設置
  }
}

// --- SPA ルート変化の検知 ---
function patchHistory(): void {
  const emit = () => window.dispatchEvent(new Event('zss:locationchange'));
  for (const m of ['pushState', 'replaceState'] as const) {
    const orig = history[m];
    history[m] = function (this: History, ...args: Parameters<History['pushState']>) {
      const r = orig.apply(this, args);
      emit();
      return r;
    };
  }
  window.addEventListener('popstate', emit);
}

// --- React 描画・SPA遷移に追従。document_start から観測し初期描画のフラッシュも防ぐ ---
let debounce = 0;
let hideRaf = 0;
let started = false; // DOMContentLoaded 後の本格初期化が済んだか
let sumDebounce = 0;
function observeDom(): void {
  const obs = new MutationObserver(() => {
    if (isSettingPath()) {
      // 本家カードの非表示は「描画前(rAF)」に即実行してフラッシュを防ぐ（1フレーム1回に集約）。
      // document_start から動くので、Reactの初期描画もペイント前に隠せる。
      if (!hideRaf) {
        hideRaf = requestAnimationFrame(() => {
          hideRaf = 0;
          if (isSettingPath()) hideOriginalNow();
        });
      }
      if (started) {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(() => void ensureApplied(), 60);
      }
    }
    // コース/チャプター画面の残りサマリ（self-guardで対象ページのみ動く）＋ダークトグルの再設置。
    // ナビは下スクロールで再描画されトグルが消えるため、消えた時だけ即再設置（ポーリング廃止）。
    if (started) {
      window.clearTimeout(sumDebounce);
      sumDebounce = window.setTimeout(() => {
        void ensureCourseSummary();
        ensureMyCourseUndone(); // /my_course の各月に未完科目を注入（自ページ以外は即抜け）
        refreshNavToggle();
      }, 120);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

// 訪問時間帯の記録（アクセス傾向）。fetch はしない（学習の時間帯は完了検知で正確に記録）。
let lastVisitAttempt = 0;
function maybeRecordVisit(): void {
  const now = Date.now();
  if (now - lastVisitAttempt < 5 * 60 * 1000) return;
  lastVisitAttempt = now;
  void recordVisit(now);
}

// 完了検知（observer.js が本家の完了/提出リクエストを観測 → postMessage）。
// 【第一原則】我々は送信しない。本家の通信を"見て"反応するだけ。
// 【誤検知対策】answerings は不合格でも発火しうる。イベントは"トリガー"に過ぎず、
//   実際に passed 合計が増えた時だけカウント（増えていなければ＝不合格/既計上で無視）。
let compDebounce = 0;
// 所要時間の実測: 直前の確定完了イベントからの間隔 ≒ その教材にかけた時間。
// 曖昧なケースは記録しない（delta≠1・間隔が0.5〜45分の外・セッション初回）。
interface CompletionEv { courseId: number; chapterId: number; resource: string; resourceId: number; ts: number }
let pendingEv: CompletionEv | null = null;
let prevConfirmedTs = 0;

async function maybeRecordWorkTime(ev: CompletionEv, delta: number): Promise<void> {
  const kindM = /^(?:evaluation|essay)_(test|report)s$/.exec(ev.resource);
  const prev = prevConfirmedTs;
  prevConfirmedTs = ev.ts; // 動画含む全確定完了で基準を更新（次の間隔測定の起点）
  if (!kindM || delta !== 1 || !prev) return;
  const durMin = (ev.ts - prev) / 60000;
  if (durMin < 0.5 || durMin > 45) return; // 休憩・別作業を挟んだ間隔は捨てる
  try {
    const q = await fetchSectionQuestions(ev.courseId, ev.chapterId, ev.resourceId);
    await recordWorkTime(ev.courseId, kindM[1] as 'test' | 'report', durMin, q ?? 1);
  } catch {
    /* 実測は補助データ。失敗しても本流に影響させない */
  }
}

// 完了を"確定"させる。集計API(passed_materials)はサーバ側の更新にラグがあり、
// 検知直後は増分0のことがある（動画passed直後など）。増分0なら数秒あけて数回リトライする。
async function settleCompletion(attempt: number): Promise<void> {
  try {
    const mt = await fetchMaterialTotals({ fresh: true }); // 実際の passed/total（キャッシュ不可・最新必須）
    const prev = await getLastPassed();
    if (prev === null) {
      await setLastPassed(mt.passed); // 初回は基準値のみ（過去分を誤カウントしない）
      if (DEV_NOTIFY) showToast(`ℹ️ [dev] 基準値を設定: passed=${mt.passed}（初回は計上なし）`, { icon: 'ℹ️', durationMs: 9000, log: false });
      return;
    }
    const delta = mt.passed - prev;
    if (delta <= 0) {
      // まだ集計に反映されていない可能性 → 少し待って再確認（最大3回）。
      if (attempt < 3) {
        window.setTimeout(() => void settleCompletion(attempt + 1), 3500);
        if (DEV_NOTIFY) showToast(`⏳ [dev] passed 未反映（${mt.passed}）→ 再確認 ${attempt + 1}/3`, { icon: '⏳', accent: '#d9822b', durationMs: 6000, log: false });
        return;
      }
      // リトライ尽きても不変＝不合格/再提出/既計上 → 何もしない（下流は"確定分"だけ）
      if (DEV_NOTIFY) showToast(`⚠️ [dev] passed 不変のまま（${mt.passed}）＝不合格/既計上`, { icon: '⚠️', accent: '#d9822b', durationMs: 9000, log: false });
      return;
    }
    await setLastPassed(mt.passed);
    await recordCompletion(Date.now(), delta); // "その時刻"へ実カウントぶん加算（正確な時間帯）
    if (pendingEv) {
      void maybeRecordWorkTime(pendingEv, delta); // 所要時間の実測（教科×種別の分/問）
      pendingEv = null;
    }
    window.dispatchEvent(new Event('zss:hourupdate')); // 時間帯トレンドをライブ更新
    window.dispatchEvent(new Event('zss:completion')); // 予測/教科タブ（今日の目標）をライブ再描画
    await notifyProgress(mt.passed, mt.total); // 節目トースト
    refreshSummary(); // コース/章バナーの残りを最新化
    if (DEV_NOTIFY) showToast(`✅ [dev] 確定: passed ${prev}→${mt.passed}（+${delta}）を記録`, { icon: '✅', accent: '#1a8a4a', durationMs: 9000, log: false });
  } catch (e) {
    if (DEV_NOTIFY) showToast(`❌ [dev] 集計失敗: ${String(e).slice(0, 60)}`, { icon: '❌', accent: '#d9822b', durationMs: 9000, log: false });
  }
}
function onCompletion(): void {
  window.clearTimeout(compDebounce);
  compDebounce = window.setTimeout(() => void settleCompletion(0), 4000);
}
function listenCompletions(): void {
  window.addEventListener('message', (e) => {
    // e.source は MAIN↔ISOLATED で一致しないことがあるため判定に使わない。__zss マーカーで識別。
    const d = e.data as { __zss?: string; courseId?: string; chapterId?: string } | null;
    if (!d || typeof d !== 'object') return;
    if (d.__zss === 'observer-ready') {
      if (DEV_NOTIFY) showToast('🟢 [dev] observer 稼働中（完了検知の準備OK）', { icon: '🟢', durationMs: 8000, log: false });
      return;
    }
    if (d.__zss === 'completion') {
      if (DEV_NOTIFY) showToast(`🔎 [dev] 完了通信を検知: course ${d.courseId} / ch ${d.chapterId}`, { icon: '🔎', durationMs: 9000, log: false });
      const dd = d as { courseId?: string; chapterId?: string; resource?: string; resourceId?: string };
      if (dd.courseId && dd.chapterId && dd.resource && dd.resourceId) {
        pendingEv = { courseId: +dd.courseId, chapterId: +dd.chapterId, resource: dd.resource, resourceId: +dd.resourceId, ts: Date.now() };
      }
      onCompletion();
    }
  });
  if (DEV_NOTIFY) window.postMessage({ __zss: 'ping' }, window.location.origin); // observer 起動確認（応答→🟢トースト）
}

function onRouteChange(): void {
  sync(); // /setting 出入りでカードを適用/撤去
  rescanSoon(); // ダーク有効時、新ページを再スキャン（取りこぼし防止）
  ensureToggleMounted(); // ナビ再描画でトグルが消えても再設置
  void ensureCourseSummary(); // コース/チャプターの残りサマリ
  ensureMyCourseUndone(); // /my_course の未完科目注入
  void maybeRecordVisit(); // 学習中の時間帯サンプリング（20分間隔）
  void notifyRolloverSoon(); // 5:00の日付更新間近を通知（窓外なら即抜け）
}

function startup(): void {
  started = true;
  void initDarkMode(); // サイト全体ダークモード（全ページ）
  try {
    void chrome.storage?.local.remove(['zss:courseVol3', 'zss:courseVol4', 'zss:courseVol5']); // 旧集計キャッシュの残留掃除
  } catch {
    /* ignore */
  }
  // 全ページで1日1回だけスナップショット（学習数14日窓のマージ＋完了レポート累計＋教材消化）
  void maybeDailySnapshot(async () => {
    const la = await fetchLearningAmounts();
    await mergeWindow(la.daily_amount);
    try {
      const rp = await fetchReportProgresses();
      await snapshotReports(rp.passedReports);
    } catch {
      /* レポート取得失敗は学習数蓄積を妨げない */
    }
    try {
      const mt = await fetchMaterialTotals(); // 教材消化（コツコツ視聴を反映する主指標）
      await snapshotMaterials(mt.passed, mt.total);
      // おかえりトースト（Endowed Progress）: 前回の既知値から進んでいたら honest に伝える
      // （別端末や前日の続きで積んだ分）。基準も最新化＝完了検知の初回差分を正確に保つ。
      const prevKnown = await getLastPassed();
      if (prevKnown !== null && mt.passed > prevKnown) {
        showToast(`おかえりなさい。前回の記録から +${mt.passed - prevKnown} 教材進んでいます。`, { accent: '#1a8a4a' });
        await setLastPassed(mt.passed);
      }
      await ensureDayStart(mt.passed); // 新しい学習日の始点passedを記録（デイリー目標の当日完了数算出用）
      // 週の始点。週が切り替わったら「先週のまとめ」を1回だけ通知（Fresh Start）
      const ws = await ensureWeekStart(mt.passed);
      if (ws.rolled && ws.prev) {
        const weekMat = Math.max(0, mt.passed - ws.prev.passed);
        const series = await getSeries();
        const monday = zenMondayISO();
        const mondayT = parseDate(monday).getTime();
        const lastWeek = series.filter((p) => {
          const t = parseDate(p.date).getTime();
          return t < mondayT && t >= mondayT - 7 * 86400000;
        });
        const sum = lastWeek.reduce((a, p) => a + p.amount, 0);
        const best = lastWeek.reduce<{ date: string; amount: number } | null>((a, p) => (!a || p.amount > a.amount ? p : a), null);
        const bits = [`教材 ${weekMat}`, `学習数 ${sum}件`];
        if (best && best.amount > 0) bits.push(`ベストは${weekdayLabel(best.date)}曜 ${best.amount}件`);
        void notifyWeekReview(monday, `先週のまとめ: ${bits.join('・')}。今週も仕切り直していきましょう。`);
      }
    } catch {
      /* 教材取得失敗も他を妨げない */
    }
  });
  patchHistory();
  listenCompletions(); // 完了検知（observer.js からの通知）を購読
  window.addEventListener('zss:locationchange', onRouteChange);
  sync();
  void ensureCourseSummary();
  maybeRecordVisit(); // 起動時にも1回サンプリング
}

function main(): void {
  // document_start 同期: 保存済みダークなら初回ペイント前に基礎ダークを適用（ページ読込の白フラッシュ防止）
  preInitDarkMode();
  if (window.top !== window.self) {
    // サブフレーム（教材の iframe = www.nnn.ed.nico/contents/… 等）: ダークモードだけ適用。
    // カード/サイドパネル/残りサマリ/完了検知の購読は top フレームのみで行う。
    void initDarkModeFrame();
    return;
  }
  // document_start: まず観測を開始し、本家カードが描かれた瞬間に隠す（初期フラッシュ防止）
  observeDom();
  if (isSettingPath()) hideOriginalNow();
  // body 依存の本格初期化は DOMContentLoaded 後
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startup, { once: true });
  } else {
    startup();
  }
}

main();
