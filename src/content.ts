// コンテンツスクリプトのエントリ。
// 【第一原則】GETのみ・read-only。DOMは自ブラウザの描画変更のみ。学習記録は一切変更しない。
import { fetchLearningAmounts, fetchReportProgresses, type LearningAmounts } from './api';
import { fetchMaterialTotals } from './courseApi';
import { applyOverwrite, removeCard, hideOriginalNow } from './inject';
import { initDarkMode, syncOurCard, rescanSoon, ensureToggleMounted, refreshNavToggle } from './darkmode';
import { maybeDailySnapshot, mergeWindow, snapshotReports, snapshotMaterials, recordVisit } from './history';
import { ensureCourseSummary } from './summaryInject';
import { ensureSidePanel, removeSidePanel } from './ui/sidePanel';

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
        refreshNavToggle();
      }, 120);
    }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
}

// 時間帯の傾向: サイト全体で学習中に定期サンプリング（study は講座/動画ページで行うため）。
// メモリゲートで fetch を抑制し、実記録は history 側の20分ストレージゲートで冪等。
let lastVisitAttempt = 0;
async function maybeRecordVisit(): Promise<void> {
  const now = Date.now();
  if (now - lastVisitAttempt < 20 * 60 * 1000) return;
  lastVisitAttempt = now;
  try {
    const la = await fetchLearningAmounts(); // 当日学習数の最新値（増分を時間帯に帰属するため都度取得）
    const today = la.daily_amount[la.daily_amount.length - 1];
    await recordVisit(now, today?.amount ?? 0);
  } catch {
    /* ignore */
  }
}

function onRouteChange(): void {
  sync(); // /setting 出入りでカードを適用/撤去
  rescanSoon(); // ダーク有効時、新ページを再スキャン（取りこぼし防止）
  ensureToggleMounted(); // ナビ再描画でトグルが消えても再設置
  void ensureCourseSummary(); // コース/チャプターの残りサマリ
  void maybeRecordVisit(); // 学習中の時間帯サンプリング（20分間隔）
}

function startup(): void {
  started = true;
  void initDarkMode(); // サイト全体ダークモード（全ページ）
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
    } catch {
      /* 教材取得失敗も他を妨げない */
    }
  });
  patchHistory();
  window.addEventListener('zss:locationchange', onRouteChange);
  sync();
  void ensureCourseSummary();
  void maybeRecordVisit(); // 起動時にも1回サンプリング
}

function main(): void {
  if (window.top !== window.self) return; // トップフレームのみ
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
