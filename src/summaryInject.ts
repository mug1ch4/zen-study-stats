// コース/チャプター画面に「残り: 動画NN時間・確認テストN・レポートN」を注入。
// 【第一原則】GETのみ・read-only。DOMは自ブラウザの描画変更のみ。
import { fetchCourseRemaining, fetchChapterRemaining, type RemainingWork } from './courseApi';
import { durationStr } from './format';
import { h } from './dom';

const HOST_ID = 'zss-summary-host';
const cache = new Map<string, RemainingWork>();
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
    box.textContent = `🎉 ${scope}の教材は完了済みです！`;
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

/** コース/チャプター画面なら残りサマリを注入（即プレースホルダ→データで更新・冪等）。 */
export async function ensureCourseSummary(): Promise<void> {
  const info = pathInfo();
  const existing = document.getElementById(HOST_ID);
  if (!info) {
    existing?.remove();
    return;
  }
  if (existing) {
    if (existing.getAttribute('data-key') === info.key) return; // 既に正しい
    existing.remove(); // 別ページのが残っている → 差し替え
  }
  if (busy) return;

  const heading = findHeading(info.kind);
  const card = heading ? cardAncestor(heading) : null;
  const container = card ?? heading?.parentElement ?? null; // カード先頭に入れる（無ければ見出しの親）
  if (!heading || !container) return; // 未描画 → 次tick

  busy = true;
  try {
    // 即座にプレースホルダ表示（体感速度改善）。カード先頭にブロックで入れる（見出し行に割り込まない）
    const host = document.createElement('div');
    host.id = HOST_ID;
    host.setAttribute('data-key', info.key);
    host.style.display = 'block';
    const root = host.attachShadow({ mode: 'open' });
    const box = bannerBox();
    fillPlaceholder(box);
    root.appendChild(box);
    container.insertBefore(host, container.firstChild);

    // データ取得（キャッシュ優先）
    let rem = cache.get(info.key);
    if (!rem) {
      rem =
        info.kind === 'chapter'
          ? await fetchChapterRemaining(info.courseId, info.chapterId!)
          : await fetchCourseRemaining(info.courseId);
      cache.set(info.key, rem);
    }
    // まだ同じページ＆同じホストなら反映
    const now = pathInfo();
    if (now?.key === info.key && document.getElementById(HOST_ID) === host) {
      fillBanner(box, rem, info.kind);
    } else {
      host.remove();
    }
  } catch (e) {
    console.warn('[ZSS] コース残り集計失敗:', e);
    document.getElementById(HOST_ID)?.remove();
  } finally {
    busy = false;
  }
}
