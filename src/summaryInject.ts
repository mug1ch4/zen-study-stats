// コース/チャプター画面に「残り: 動画NN時間・確認テストN・レポートN」を注入。
// 【第一原則】GETのみ・read-only。DOMは自ブラウザの描画変更のみ。
import { fetchCourseRemaining, fetchChapterRemaining, type RemainingWork } from './courseApi';
import { durationStr } from './format';
import { h } from './dom';

const HOST_ID = 'zss-summary-host';
// key → 集計結果。null = 取得失敗（★二度と再取得しない＝リクエストストーム防止）。
const cache = new Map<string, RemainingWork | null>();
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

/** 見出しを含むカードの挿入位置を特定（未描画なら null）。 */
function findSpot(info: PathInfo): HTMLElement | null {
  const heading = findHeading(info.kind);
  if (!heading) return null;
  return cardAncestor(heading) ?? heading.parentElement ?? null;
}

/** ホスト（Shadow DOM）を作って挿入し、内部の box を返す。 */
function mountHost(container: HTMLElement, info: PathInfo): { host: HTMLElement; box: HTMLElement } {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.setAttribute('data-key', info.key);
  host.style.display = 'block';
  const root = host.attachShadow({ mode: 'open' });
  const box = bannerBox();
  root.appendChild(box);
  container.insertBefore(host, container.firstChild);
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
    if (existing.getAttribute('data-key') === info.key) return; // 既に正しく設置済み
    existing.remove(); // 別ページのが残っている → 撤去
  }

  // --- データ既知（成功 or 失敗）: fetch せず描画のみ。ここが storm を根絶する。 ---
  if (cache.has(info.key)) {
    const rem = cache.get(info.key) ?? null;
    if (rem === null) return; // 取得失敗のキー → 何も出さない（プレースホルダも出さず点滅しない）
    const n = mountCount.get(info.key) ?? 0;
    if (n >= MOUNT_CAP) return; // React が消し続けるページでの無限再注入を打ち切る
    const spot = findSpot(info);
    if (!spot) return;
    mountCount.set(info.key, n + 1);
    fillBanner(mountHost(spot, info).box, rem, info.kind);
    return;
  }

  // --- 未知キー: 1回だけ取得（busy で直列化） ---
  if (busy) return;
  const spot = findSpot(info);
  if (!spot) return;
  busy = true;
  const { host, box } = mountHost(spot, info);
  fillPlaceholder(box);
  mountCount.set(info.key, (mountCount.get(info.key) ?? 0) + 1);
  try {
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

/** 完了検知後などに、残りサマリのキャッシュを捨てて最新の残りを取り直す。 */
export function refreshSummary(): void {
  cache.clear();
  mountCount.clear();
  document.getElementById(HOST_ID)?.remove();
  void ensureCourseSummary();
}
