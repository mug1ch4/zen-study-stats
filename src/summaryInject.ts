// コース/チャプター画面に「残り: 動画NN時間・確認テストN・レポートN」を注入。
// 【第一原則】GETのみ・read-only。DOMは自ブラウザの描画変更のみ。
import { fetchCourseRemaining, fetchChapterRemaining, getRequiredCourseIds, type RemainingWork } from './courseApi';
import { durationStr } from './format';
import { h } from './dom';

const HOST_ID = 'zss-summary-host';
// key → 集計結果。null = 取得失敗（★二度と再取得しない＝リクエストストーム防止）。
const cache = new Map<string, RemainingWork | null>();
// 必修以外（type:advanced／大学受験など）と判定したキー。重い集計をせず軽いラベルのみ出す。
const electiveKeys = new Set<string>();
// key → 再注入回数。React がホストを消し続けるページで無限に注入し直すのを防ぐ上限。
const mountCount = new Map<string, number>();
const MOUNT_CAP = 8;
let busy = false;

interface PathInfo {
  kind: 'course' | 'chapter';
  courseId: number;
  chapterId?: number;
  key: string;
}
function pathInfo(): PathInfo | null {
  const m = location.pathname.match(/^\/courses\/(\d+)(?:\/chapters\/(\d+))?/);
  if (!m) return null;
  return m[2]
    ? { kind: 'chapter', courseId: +m[1], chapterId: +m[2], key: `${m[1]}-${m[2]}` }
    : { kind: 'course', courseId: +m[1], key: m[1] };
}

/** 挿入位置の見出し: コース=「チャプター」 / チャプター=「教材」。 */
function findHeading(kind: 'course' | 'chapter'): HTMLElement | null {
  const re = kind === 'course' ? /^チャプター/ : /^教材$/;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,div,span'))) {
    if (el.childElementCount === 0 && re.test(el.textContent?.trim() ?? '')) return el;
  }
  return null;
}

/** 見出しを含むカード(背景色+角丸)の祖先。見出し行のflexに割り込まず、カード先頭にブロックで置くため。 */
function cardAncestor(el: HTMLElement): HTMLElement | null {
  let n: HTMLElement | null = el;
  for (let i = 0; i < 7 && n?.parentElement; i++) {
    n = n.parentElement;
    const cs = getComputedStyle(n);
    const bg = cs.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && cs.borderTopLeftRadius !== '0px') return n;
  }
  return null;
}

function bannerBox(): HTMLElement {
  const dark = document.documentElement.classList.contains('zss-dark');
  const c = dark
    ? { bg: '#1b2027', text: '#e6ebf1', accent: '#4aa3ee', sub: '#9aa6b2' }
    : { bg: '#eaf4fd', text: '#173a5e', accent: '#0077d3', sub: '#4a6072' };
  const box = h('div', {}, []);
  box.style.cssText = `display:block;width:100%;box-sizing:border-box;font-family:-apple-system,"Hiragino Kaku Gothic Pro",Meiryo,sans-serif;background:${c.bg};color:${c.text};border-left:3px solid ${c.accent};border-radius:6px;padding:8px 12px;margin:0 0 10px;font-size:13px;line-height:1.6;`;
  return box;
}

function fillPlaceholder(box: HTMLElement): void {
  box.textContent = '残りを集計中…';
  box.style.opacity = '0.7';
}

/** 必修以外（大学受験など選択）: 重い集計はせず、卒業要件外である旨だけ明示する。 */
function fillElective(box: HTMLElement): void {
  const dark = document.documentElement.classList.contains('zss-dark');
  const sub = dark ? '#9aa6b2' : '#4a6072';
  box.style.opacity = '1';
  box.textContent = '';
  box.append(
    h('span', {}, ['選択科目（大学受験・発展など）']),
    (() => { const e = h('span', {}, ['　·　卒業要件・必修の進捗には含まれません']); e.style.color = sub; return e; })()
  );
}

function fillBanner(box: HTMLElement, r: RemainingWork, kind: 'course' | 'chapter'): void {
  const dark = document.documentElement.classList.contains('zss-dark');
  const accent = dark ? '#4aa3ee' : '#0077d3';
  const sub = dark ? '#9aa6b2' : '#4a6072';
  const scope = kind === 'course' ? 'このコース' : 'この章';
  box.style.opacity = '1';
  box.textContent = '';
  if (r.movieSeconds + r.movieCount + r.testCount + r.reportCount === 0) {
    box.textContent = `${scope}の教材は完了済みです。`;
    return;
  }
  const strong = (t: string) => {
    const e = h('b', {}, [t]);
    e.style.color = accent;
    return e;
  };
  const sep = () => {
    const e = h('span', {}, ['　/　']);
    e.style.color = sub;
    return e;
  };
  box.append(
    h('span', {}, [`${scope}の残り: `]),
    h('span', {}, ['動画 ']), strong(durationStr(r.movieSeconds)), h('span', {}, [`・${r.movieCount}本`]),
    sep(),
    h('span', {}, ['確認テスト ']), strong(String(r.testCount)),
    sep(),
    h('span', {}, ['レポート ']), strong(String(r.reportCount))
  );
}

interface Spot {
  container: HTMLElement; // host を firstChild として挿入する親
  sticky: boolean; // スクロールコンテナ直下＝上部に張り付かせる（動画横メニュー等）
}
/** 挿入位置を特定（未描画なら null）。見出しカードの祖先にスクロールコンテナがあれば、
 *  そのコンテナ直下の先頭に sticky 配置（スクロールで見切れず上部に張り付く）。 */
function findSpot(info: PathInfo): Spot | null {
  const heading = findHeading(info.kind);
  if (!heading) return null;
  const card = cardAncestor(heading) ?? heading.parentElement;
  if (!card) return null;
  // カードの祖先を辿り、実際にスクロールする overflow auto/scroll のコンテナを探す。
  let n: HTMLElement | null = card.parentElement;
  for (let i = 0; i < 8 && n; i++) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 20) {
      return { container: n, sticky: true };
    }
    n = n.parentElement;
  }
  return { container: card, sticky: false };
}

/** ホスト（Shadow DOM）を作って挿入し、内部の box を返す。 */
function mountHost(spot: Spot, info: PathInfo): { host: HTMLElement; box: HTMLElement } {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-key', info.key);
  // sticky: スクロールコンテナ上部に張り付く（動画再生中の横メニューで見切れない）。
  // 横メニュー内の選択中項目が z-index:10001 を持つため、それを確実に上回る値で前面固定。
  // host はスクロールコンテナ内＝モーダル/プレイヤー本体とは stacking context が分離するので過大でも安全。
  host.style.cssText = spot.sticky ? 'display:block;position:sticky;top:0;z-index:100000;' : 'display:block;';
  host.setAttribute('data-sticky', spot.sticky ? '1' : '0'); // 後から sticky 昇格を判定するため
  const root = host.attachShadow({ mode: 'open' });
  const box = bannerBox();
  root.appendChild(box);
  spot.container.insertBefore(host, spot.container.firstChild);
  return { host, box };
}

/** コース/チャプター画面なら残りサマリを注入（即プレースホルダ→データで更新・冪等）。
 *  ★storm防止: 一度取得を試みたキーは成功でも失敗でも二度と再取得しない（cache.has で判定）。
 *  高頻度の MutationObserver から呼ばれても、ネットワークは各キー最大1回に限定される。 */
export async function ensureCourseSummary(): Promise<void> {
  const info = pathInfo();
  const existing = document.getElementById(HOST_ID);
  if (!info) {
    existing?.remove();
    return;
  }
  if (existing) {
    if (existing.getAttribute('data-key') === info.key) {
      // 同一ページに既設置。ただし SPA遷移直後はスクロールコンテナが未構築で「埋め込み」で
      // 置かれることがある。埋め込み(data-sticky='0')のままなら、コンテナ出現後に sticky へ昇格。
      // sticky 済み(='1')や elective（軽ラベル）はそのまま（findSpot を無駄に呼ばない）。
      if (existing.getAttribute('data-sticky') === '1' || electiveKeys.has(info.key)) return;
      const spot = findSpot(info);
      if (spot?.sticky) existing.remove(); // 昇格可能 → 下で再設置
      else return; // まだコンテナが無い（埋め込みのまま据え置き）
    } else {
      existing.remove(); // 別ページのが残っている → 撤去
    }
  }

  // 再注入の共通ガード（React がホストを消し続けるページでの暴走防止）
  const remount = (render: (box: HTMLElement) => void): void => {
    const n = mountCount.get(info.key) ?? 0;
    if (n >= MOUNT_CAP) return;
    const spot = findSpot(info);
    if (!spot) return;
    mountCount.set(info.key, n + 1);
    render(mountHost(spot, info).box);
  };

  // --- 必修以外（大学受験など）: 重い集計をせず軽ラベルのみ（判定済みキー） ---
  if (electiveKeys.has(info.key)) {
    remount(fillElective);
    return;
  }

  // --- データ既知（成功 or 失敗）: fetch せず描画のみ。ここが storm を根絶する。 ---
  if (cache.has(info.key)) {
    const rem = cache.get(info.key) ?? null;
    if (rem === null) return; // 取得失敗のキー → 何も出さない（プレースホルダも出さず点滅しない）
    remount((box) => fillBanner(box, rem, info.kind));
    return;
  }

  // --- 未知キー: 1回だけ処理（busy で直列化） ---
  if (busy) return;
  const spot = findSpot(info);
  if (!spot) return;
  busy = true;
  const { host, box } = mountHost(spot, info);
  fillPlaceholder(box);
  mountCount.set(info.key, (mountCount.get(info.key) ?? 0) + 1);
  try {
    // カテゴリ判定: 必修（basic サービス）でなければ重い集計をスキップして軽ラベルに。
    // 判定に失敗（取得不可）した場合は従来どおり必修扱いで集計する（安全側）。
    const requiredIds = await getRequiredCourseIds().catch(() => null);
    if (requiredIds && !requiredIds.has(info.courseId)) {
      electiveKeys.add(info.key);
      if (pathInfo()?.key === info.key && document.getElementById(HOST_ID) === host) fillElective(box);
      else host.remove();
      return;
    }
    const rem =
      info.kind === 'chapter'
        ? await fetchChapterRemaining(info.courseId, info.chapterId!)
        : await fetchCourseRemaining(info.courseId);
    cache.set(info.key, rem);
    const now = pathInfo();
    if (now?.key === info.key && document.getElementById(HOST_ID) === host) fillBanner(box, rem, info.kind);
    else host.remove();
  } catch (e) {
    // ★負のキャッシュ: このキーは失敗として記録し、以後この画面では二度と再取得しない。
    console.warn('[ZSS] コース残り集計失敗（この画面では再取得しません）:', e);
    cache.set(info.key, null);
    document.getElementById(HOST_ID)?.remove();
  } finally {
    busy = false;
  }
}

// 直近の refresh を束ねる（動画完了が連続しても取得は1回に）。
let refreshTimer = 0;
let refreshInflight = false;

/** 完了検知後に、今いるページの残りサマリだけを"静かに"取り直して差し替える。
 *  既存バナーは消さず数値のみ更新するため「集計中…」の点滅が出ない。動画完了ごとの更新用。 */
export function refreshSummary(): void {
  window.clearTimeout(refreshTimer);
  // 完了PUT直後は章詳細の反映に一瞬かかることがあるため、短い遅延で束ねてから取得。
  refreshTimer = window.setTimeout(() => void doRefresh(), 400);
}

async function doRefresh(): Promise<void> {
  if (refreshInflight) {
    refreshSummary(); // 取得中に来た要求は取得後に再実行（最新を反映）
    return;
  }
  const info = pathInfo();
  if (!info || electiveKeys.has(info.key)) return; // 選択科目は集計しない
  refreshInflight = true;
  try {
    const rem =
      info.kind === 'chapter'
        ? await fetchChapterRemaining(info.courseId, info.chapterId!)
        : await fetchCourseRemaining(info.courseId);
    cache.set(info.key, rem); // キャッシュも最新化（後続の ensureCourseSummary が古値を出さない）
    const host = document.getElementById(HOST_ID);
    const box = host?.getAttribute('data-key') === info.key ? (host.shadowRoot?.firstElementChild as HTMLElement | null) : null;
    if (box) fillBanner(box, rem, info.kind); // 既存バナーを点滅なしで差し替え
    else void ensureCourseSummary(); // バナー未設置なら通常設置（初回など）
  } catch (e) {
    console.warn('[ZSS] 残り再集計失敗（この画面では次の完了検知まで据え置き）:', e);
  } finally {
    refreshInflight = false;
  }
}
