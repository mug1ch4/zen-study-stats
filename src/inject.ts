import type { LearningAmounts } from './api';
import { CSS } from './styles';
import { renderLearningCard } from './ui/learningCard';

export const HOST_ID = 'zss-root-host';
const HIDDEN_ATTR = 'data-zss-hidden';

/** Shadow DOM ホストを生成し CSS を注入。React管理外の独立ノード。 */
function createHost(): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.margin = '0 0 16px';
  host.setAttribute('data-zss', '1');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  root.appendChild(style);
  return { host, root };
}

let hiddenOriginal: HTMLElement | null = null;

/**
 * まだ隠していない本家「学習数」カードの container を、ハッシュ化クラスに依存せずテキストで特定。
 * shadow内(=自前カード)のテキストは document から見えないのでヒットするのは本家のみ。
 */
function findVisibleOriginal(): HTMLElement | null {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,p,span,div'));
  for (const el of nodes) {
    if (el.childElementCount !== 0 || el.textContent?.trim() !== '学習数') continue;
    if (el.closest(`[${HIDDEN_ATTR}]`)) continue; // 既に隠したカードは無視
    // カード相当の祖先を「背景色＋角丸」で判定（高さアニメ中でも安定）。
    let node: HTMLElement | null = el;
    for (let i = 0; i < 6 && node?.parentElement; i++) {
      node = node.parentElement;
      const cs = getComputedStyle(node);
      const bg = cs.backgroundColor;
      const hasBg = !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
      const hasRadius = cs.borderTopLeftRadius !== '0px';
      if (hasBg && hasRadius) return node;
    }
    return el.parentElement;
  }
  return null;
}

/**
 * 本家カードを「即座に」非表示化する（データ不要・同期）。
 * MutationObserver から毎回呼び、本家パネルが描画された瞬間に隠す＝リロード/遷移時のフラッシュを防ぐ。
 * 挿入位置の参照として hiddenOriginal を保持。
 */
export function hideOriginalNow(): void {
  const orig = findVisibleOriginal();
  if (orig) {
    orig.setAttribute(HIDDEN_ATTR, '1');
    orig.style.display = 'none';
    hiddenOriginal = orig;
  }
}

/**
 * 本家の学習数パネルを上書き（自前カードを同じ位置に差し替え）。冪等・毎tick呼んで良い。
 * まず本家を隠し、その直前に自前カードを（未挿入/外された場合に）挿入する。
 * @returns 適用できたら true
 */
export function applyOverwrite(data: LearningAmounts): boolean {
  hideOriginalNow(); // 新しく現れた本家も即隠す＋参照更新
  const anchor = hiddenOriginal && hiddenOriginal.isConnected ? hiddenOriginal : null;
  if (!anchor || !anchor.parentElement) return false; // 本家未描画 → 次tickへ

  if (!document.getElementById(HOST_ID)) {
    const { host, root } = createHost();
    root.appendChild(renderLearningCard(data));
    anchor.parentElement.insertBefore(host, anchor);
  }
  return true;
}

/** 注入済みホストを除去し、隠した本家カードを復元（/setting 離脱時）。 */
export function removeCard(): void {
  document.getElementById(HOST_ID)?.remove();
  document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`).forEach((el) => {
    el.removeAttribute(HIDDEN_ATTR);
    el.style.display = '';
  });
  hiddenOriginal = null;
}
