// サイト全体のダークモード（我々の手作り配色 / filter反転ではない）。
// 白いサーフェスを暗色へ、暗い文字を明色へ動的リマップ。ブランド青は維持。
// 【第一原則】これは自ブラウザの描画変更のみ。GETすら発生しない純CSS/DOM。
import { HOST_ID } from './inject';

const STYLE_ID = 'zss-dark-style';
const TOGGLE_ID = 'zss-dark-toggle';
const HTML_CLASS = 'zss-dark';
const STORAGE_KEY = 'zss:darkMode';

// タグ用クラス（ov = 大きな背景画像=プロフィールバナー。暗幕オーバーレイで文字は暗くしない。
// hatch = ::after のロック用ハッチ(fill_disabled_stripe)を持つ行。反転して暗くする）
const C = { s1: 'zss-s1', s2: 'zss-s2', ink: 'zss-ink', muted: 'zss-muted', ov: 'zss-ov', hatch: 'zss-hatch' };

// 手作りダーク・トークン
const T = {
  BG: '#14181d', S1: '#1b2027', S2: '#232b35',
  INK: '#e6ebf1', MUTED: '#9aa6b2', BORDER: '#2c333d',
};

let enabled = false;
let observer: MutationObserver | null = null;

// ---- 色ユーティリティ ----
function relLum(r: number, g: number, b: number): number {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
function parseRGB(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
}
const isBrand = (r: number, _g: number, b: number) => b > r + 40 && b > 100; // ブランド青は残す

// ---- スタイル ----
function styleEl(): HTMLStyleElement {
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
html.${HTML_CLASS}, html.${HTML_CLASS} body { background: ${T.BG} !important; color: ${T.INK} !important; }
html.${HTML_CLASS} .${C.s1} { background-color: ${T.S1} !important; }
html.${HTML_CLASS} .${C.s2} { background-color: ${T.S2} !important; }
html.${HTML_CLASS} .${C.ink} { color: ${T.INK} !important; }
html.${HTML_CLASS} .${C.muted} { color: ${T.MUTED} !important; }
html.${HTML_CLASS} *:not(#${HOST_ID}):not(#${HOST_ID} *):not(#${TOGGLE_ID}):not(#${TOGGLE_ID} *) { border-color: ${T.BORDER} !important; }
html.${HTML_CLASS} input, html.${HTML_CLASS} textarea, html.${HTML_CLASS} select { background-color: ${T.S2} !important; color: ${T.INK} !important; }

/* ヘッダ/ナビは構造セレクタで直接（React再マウントで class が消えても白化しない） */
html.${HTML_CLASS} header, html.${HTML_CLASS} [role="banner"] { background-color: ${T.S1} !important; color: ${T.INK} !important; }
html.${HTML_CLASS} header *, html.${HTML_CLASS} [role="banner"] * { color: ${T.INK} !important; border-color: ${T.BORDER} !important; }

/* ロゴ類(svg画像)は反転して視認性確保。アバターはjpeg/pngなので対象外 */
html.${HTML_CLASS} img[src*=".svg"] { filter: invert(1) hue-rotate(180deg) !important; }

/* 大きな背景画像(プロフィールバナー等)は brightness ではなく暗幕オーバーレイ→文字は暗くならない */
html.${HTML_CLASS} .${C.ov} { position: relative !important; }
html.${HTML_CLASS} .${C.ov}::before { content: ""; position: absolute; inset: 0; background: rgba(0,0,0,.45); pointer-events: none; z-index: 0; }
html.${HTML_CLASS} .${C.ov} > * { position: relative; z-index: 1; }

/* 未解放行のロック用ハッチ(::after の明るい斜線)を反転して暗く。テーマと調和させる */
html.${HTML_CLASS} .${C.hatch}::after { filter: invert(1) hue-rotate(180deg) brightness(0.85) !important; }
`;
  return st;
}

// ---- タグ付けパス（要素の computed style を見て分類） ----
function tagElement(el: Element): void {
  if (el.id === HOST_ID || el.id === TOGGLE_ID) return;
  if ((el as HTMLElement).closest?.(`#${HOST_ID},#${TOGGLE_ID}`)) return;
  const cs = getComputedStyle(el);

  const bg = parseRGB(cs.backgroundColor);
  if (bg && bg.a > 0) {
    const L = relLum(bg.r, bg.g, bg.b);
    if (L > 0.85) el.classList.add(C.s1);
    else if (L > 0.6) el.classList.add(C.s2);
  }

  const fg = parseRGB(cs.color);
  if (fg && !isBrand(fg.r, fg.g, fg.b)) {
    const L = relLum(fg.r, fg.g, fg.b);
    if (L < 0.2) el.classList.add(C.ink);
    else if (L < 0.45) el.classList.add(C.muted);
  }

  // 大きな背景画像(バナー)のみ暗幕オーバーレイ対象に。小さな装飾bg-imageは触らない。
  const bi = cs.backgroundImage;
  const he = el as HTMLElement;
  if (bi && bi !== 'none' && /url\(|gradient/.test(bi)) {
    if (he.offsetWidth >= 300 && he.offsetHeight >= 50) el.classList.add(C.ov);
  }

  // 行サイズの要素だけ ::after のロック用ハッチ(明るい斜線)を検査（perf配慮で行に限定）。
  const h = he.offsetHeight;
  if (h >= 24 && h <= 120 && he.offsetWidth >= 140) {
    const afterImg = getComputedStyle(el, '::after').backgroundImage;
    if (afterImg && /disabled|stripe/i.test(afterImg)) el.classList.add(C.hatch);
  }
}

function scan(root: ParentNode): void {
  tagElement(root as Element);
  (root as Element).querySelectorAll?.('*').forEach(tagElement);
}

// ---- 我々のカードのテーマ同期 ----
function syncOurCard(): void {
  const host = document.getElementById(HOST_ID);
  if (!host) return;
  if (enabled) host.setAttribute('data-theme', 'dark');
  else host.removeAttribute('data-theme');
}
export { syncOurCard };

// ---- トグルボタン ----
// 優先: 本家ナビ項目を複製して注入（クラス継承でネイティブな見た目）。
// フォールバック: ナビが無いページ(コンパクトヘッダ等)では右下フローティング。
const NAV_BTN_ID = 'zss-nav-btn';
const SVG_NS = 'http://www.w3.org/2000/svg';
const MOON_PATH = 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z';

function themeIcon(dark: boolean, cls: string): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('class', cls);
  svg.setAttribute('data-zss-icon', '1');
  if (dark) {
    // 太陽（現在ダーク→クリックでライトへ）
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '4');
    svg.appendChild(c);
    const rays = [[12,1,12,3],[12,21,12,23],[4.2,4.2,5.6,5.6],[18.4,18.4,19.8,19.8],[1,12,3,12],[21,12,23,12],[4.2,19.8,5.6,18.4],[18.4,5.6,19.8,4.2]];
    for (const [x1,y1,x2,y2] of rays) {
      const l = document.createElementNS(SVG_NS, 'line');
      l.setAttribute('x1', String(x1)); l.setAttribute('y1', String(y1));
      l.setAttribute('x2', String(x2)); l.setAttribute('y2', String(y2));
      svg.appendChild(l);
    }
  } else {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', MOON_PATH);
    svg.appendChild(p);
  }
  return svg;
}

/** 本家ナビの「アイコン+ラベル」リンク項目をテンプレとして返す。 */
function findNavTemplate(): HTMLElement | null {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('header a, [role="banner"] a')
  ).filter((a) => a.querySelector('i[type]'));
  return items[0] ?? null;
}

function ensureFloating(): void {
  if (document.getElementById(TOGGLE_ID)) return;
  const host = document.createElement('div');
  host.id = TOGGLE_ID;
  const root = host.attachShadow({ mode: 'open' });
  const st = document.createElement('style');
  st.textContent = `
    .btn { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;
      width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;
      background: #2a2f37; color: #fff; font-size: 18px; line-height: 40px; text-align: center;
      box-shadow: 0 2px 8px rgba(0,0,0,.35); transition: transform .1s; }
    .btn:hover { transform: scale(1.06); }
  `;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.title = 'ダークモード切替 (ZSS)';
  btn.addEventListener('click', () => void setEnabled(!enabled));
  root.append(st, btn);
  (document.body ?? document.documentElement).appendChild(host);
}

/** トグルを設置（ナビ優先・冪等）。ナビ再描画で消えたら再注入するため毎回呼んでよい。 */
function ensureToggle(): void {
  const tpl = findNavTemplate();
  if (tpl && tpl.parentElement) {
    if (!document.getElementById(NAV_BTN_ID)) {
      // 本家アイコンの実寸に合わせる（ラベルの縦位置を他項目と揃えるため）
      const tplIcon = tpl.querySelector<HTMLElement>('i');
      const size = tplIcon?.offsetHeight || 24;
      const btn = tpl.cloneNode(true) as HTMLElement;
      btn.id = NAV_BTN_ID;
      btn.removeAttribute('href');
      btn.removeAttribute('aria-current');
      btn.setAttribute('role', 'button');
      btn.style.cursor = 'pointer';
      const i = btn.querySelector('i');
      const icon = themeIcon(enabled, i?.getAttribute('class') ?? '');
      icon.setAttribute('width', String(size));
      icon.setAttribute('height', String(size));
      if (i) i.replaceWith(icon);
      const span = btn.querySelector('span');
      if (span) span.textContent = 'テーマ';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        void setEnabled(!enabled);
      });
      tpl.parentElement.appendChild(btn);
    }
    document.getElementById(TOGGLE_ID)?.remove(); // ナビがあればフローティング不要
  } else {
    ensureFloating();
  }
  updateToggleIcon();
}

function updateToggleIcon(): void {
  // ナビボタンのアイコン差し替え（サイズは引き継ぐ）
  const navBtn = document.getElementById(NAV_BTN_ID);
  const oldIcon = navBtn?.querySelector('[data-zss-icon]');
  if (navBtn && oldIcon) {
    const icon = themeIcon(enabled, oldIcon.getAttribute('class') ?? '');
    icon.setAttribute('width', oldIcon.getAttribute('width') ?? '24');
    icon.setAttribute('height', oldIcon.getAttribute('height') ?? '24');
    oldIcon.replaceWith(icon);
  }
  // フローティングの絵文字
  const fbtn = document.getElementById(TOGGLE_ID)?.shadowRoot?.querySelector('button');
  if (fbtn) fbtn.textContent = enabled ? '☀️' : '🌙';
}

// ---- 有効/無効 ----
export async function setEnabled(on: boolean): Promise<void> {
  enabled = on;
  const html = document.documentElement;
  if (on) {
    if (!document.getElementById(STYLE_ID)) html.appendChild(styleEl());
    html.classList.add(HTML_CLASS);
    scan(document.body);
    startObserver();
  } else {
    html.classList.remove(HTML_CLASS);
    document.getElementById(STYLE_ID)?.remove();
    stopObserver();
    // タグclassは残っても無害だが掃除
    for (const c of Object.values(C)) {
      document.querySelectorAll('.' + c).forEach((e) => e.classList.remove(c));
    }
  }
  syncOurCard();
  window.dispatchEvent(new Event('zss:themechange')); // サイドパネル等のテーマ同期用
  updateToggleIcon();
  try {
    await chrome.storage?.local.set({ [STORAGE_KEY]: on });
  } catch {
    /* storage 権限が無い環境では黙って無視 */
  }
}

// ---- 動的追従（有効時のみ） ----
// 追加ノード = サブツリーごと再スキャン / class・style 変更 = その要素だけ再タグ付け。
// React 再描画で class が消えても attributes 監視で貼り直す（=白化・取りこぼしを防ぐ）。
let addedRoots = new Set<Element>();
let attrEls = new Set<Element>();
let raf = 0;
function schedule(): void {
  if (!raf) raf = requestAnimationFrame(flush);
}
function startObserver(): void {
  if (observer) return;
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'childList') {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) addedRoots.add(n as Element);
        });
      } else if (m.type === 'attributes' && m.target.nodeType === 1) {
        attrEls.add(m.target as Element);
      }
    }
    schedule();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
}
function flush(): void {
  raf = 0;
  const roots = addedRoots;
  const attrs = attrEls;
  addedRoots = new Set();
  attrEls = new Set();
  for (const el of roots) if (el.isConnected) scan(el);
  for (const el of attrs) if (el.isConnected && !el.closest(`#${HOST_ID},#${TOGGLE_ID}`)) tagElement(el);
}
function stopObserver(): void {
  observer?.disconnect();
  observer = null;
  addedRoots = new Set();
  attrEls = new Set();
}

// 遷移時の白フラッシュ抑制: 一瞬だけ暗幕を被せ、新ページのスキャンが済む頃にフェードアウト。
const VEIL_ID = 'zss-veil';
let veilTimer = 0;
function flashVeil(): void {
  let v = document.getElementById(VEIL_ID);
  if (!v) {
    v = document.createElement('div');
    v.id = VEIL_ID;
    v.style.cssText = `position:fixed;inset:0;background:${T.BG};z-index:2147483645;pointer-events:none;opacity:1;transition:opacity .2s ease;`;
    (document.body ?? document.documentElement).appendChild(v);
  } else {
    v.style.transition = 'none';
    v.style.opacity = '1';
    void v.offsetHeight; // reflow
    v.style.transition = 'opacity .2s ease';
  }
  window.clearTimeout(veilTimer);
  veilTimer = window.setTimeout(() => {
    const el = document.getElementById(VEIL_ID);
    if (!el) return;
    el.style.opacity = '0';
    window.setTimeout(() => el.remove(), 240);
  }, 140);
}

/** ページ遷移: 白フラッシュを暗幕で隠しつつ、新ページを再スキャン（取りこぼし防止）。 */
export function rescanSoon(): void {
  if (!enabled) return;
  flashVeil();
  setTimeout(() => enabled && scan(document.body), 60);
  setTimeout(() => enabled && scan(document.body), 300);
  setTimeout(() => enabled && scan(document.body), 900);
}

/** トグルの再設置（ナビ再描画やページ遷移で消えた時に呼ぶ）。ダークON/OFFに関わらず常に必要。 */
export function ensureToggleMounted(): void {
  ensureToggle();
}

// ---- 初期化 ----
export async function initDarkMode(): Promise<void> {
  ensureToggle();
  // ナビはReact再描画で消えるので、定期的に再設置（存在すれば安価に抜ける）。
  setInterval(ensureToggle, 1500);
  let saved = false;
  try {
    const r = await chrome.storage?.local.get(STORAGE_KEY);
    saved = !!r?.[STORAGE_KEY];
  } catch {
    /* ignore */
  }
  if (saved) await setEnabled(true);
  else updateToggleIcon();
}

export const isDark = () => enabled;
