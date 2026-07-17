// 他ページ用の「端から展開する学習統計パネル」。/setting 以外の全ページで、
// 画面右端のハンドルから学習カードをスライド表示する（read-only・第一原則）。
import { fetchLearningAmounts } from '../api';
import { CSS } from '../styles';
import { renderLearningCard } from './learningCard';
import { isDark } from '../darkmode';
import { h } from '../dom';

const HOST_ID = 'zss-side-host';
let openState = false;
let cardLoaded = false;
let themeHooked = false;

const SIDE_CSS = `
.zss-side-panel {
  position: fixed; top: 0; right: 0; height: 100vh; width: min(460px, 92vw);
  background: var(--surface); color: var(--ink);
  border-left: 1px solid var(--border); box-shadow: -6px 0 28px rgba(0,0,0,.18);
  transform: translateX(100%); transition: transform .26s cubic-bezier(.4,0,.2,1);
  overflow-y: auto; z-index: 2147483000; -webkit-overflow-scrolling: touch;
}
.zss-side-wrap.open .zss-side-panel { transform: translateX(0); }
.zss-side-handle {
  position: fixed; right: 0; top: 42%; transform: translateY(-50%);
  z-index: 2147482999; background: var(--primary); color: #fff; border: none; cursor: pointer;
  border-radius: 8px 0 0 8px; padding: 10px 5px; display: flex; flex-direction: column;
  align-items: center; gap: 4px; box-shadow: -2px 2px 10px rgba(0,0,0,.22);
  transition: right .26s cubic-bezier(.4,0,.2,1); font: inherit;
}
.zss-side-handle:hover { filter: brightness(1.06); }
.zss-side-wrap.open .zss-side-handle { right: min(460px, 92vw); }
.zss-side-handle-label { writing-mode: vertical-rl; font-size: 11px; font-weight: 700; letter-spacing: 2px; }
.zss-side-head {
  position: sticky; top: 0; display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; background: var(--surface); border-bottom: 1px solid var(--border); z-index: 2;
}
.zss-side-title { font-weight: 800; font-size: 13px; }
.zss-side-close { background: none; border: none; font-size: 22px; line-height: 1; cursor: pointer; color: var(--muted); padding: 0 4px; }
.zss-side-close:hover { color: var(--ink); }
.zss-side-body { padding: 10px 12px 48px; }
.zss-side-loading { font-size: 12px; color: var(--muted); padding: 24px 4px; }
`;

/** /setting 以外の全ページに、右端の展開パネルを設置（冪等）。 */
export function ensureSidePanel(): void {
  if (document.getElementById(HOST_ID)) {
    syncTheme();
    return;
  }
  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS + SIDE_CSS;
  root.appendChild(style);

  const body = h('div', { class: 'zss-side-body' }, [h('div', { class: 'zss-side-loading' }, ['開くと学習データを読み込みます。'])]);
  const panel = h('div', { class: 'zss-side-panel' }, [
    h('div', { class: 'zss-side-head' }, [
      h('span', { class: 'zss-side-title' }, ['学習統計']),
      h('button', { class: 'zss-side-close', title: '閉じる', onclick: () => setOpen(root, false) }, ['×']),
    ]),
    body,
  ]);
  const handle = h('button', { class: 'zss-side-handle', title: '学習統計を開く', onclick: () => setOpen(root, !openState) }, [
    h('span', {}, ['📊']),
    h('span', { class: 'zss-side-handle-label' }, ['学習統計']),
  ]);
  const wrap = h('div', { class: 'zss-side-wrap' + (openState ? ' open' : '') }, [handle, panel]);
  root.appendChild(wrap);
  document.body.appendChild(host);

  if (!themeHooked) {
    themeHooked = true;
    window.addEventListener('zss:themechange', syncTheme);
  }
  syncTheme();
}

export function removeSidePanel(): void {
  document.getElementById(HOST_ID)?.remove();
}

function setOpen(root: ShadowRoot, open: boolean): void {
  openState = open;
  root.querySelector('.zss-side-wrap')?.classList.toggle('open', open);
  if (open && !cardLoaded) {
    cardLoaded = true;
    void loadCard(root);
  }
}

async function loadCard(root: ShadowRoot): Promise<void> {
  const body = root.querySelector('.zss-side-body') as HTMLElement;
  body.textContent = '';
  body.appendChild(h('div', { class: 'zss-side-loading' }, ['学習データを読み込み中…']));
  try {
    const data = await fetchLearningAmounts();
    body.textContent = '';
    body.appendChild(renderLearningCard(data));
  } catch (e) {
    console.warn('[ZSS] サイドパネルの取得失敗:', e);
    body.textContent = '';
    body.appendChild(h('div', { class: 'zss-side-loading' }, ['学習データを取得できませんでした。']));
  }
}

function syncTheme(): void {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  if (isDark()) host.setAttribute('data-theme', 'dark');
  else host.removeAttribute('data-theme');
}
