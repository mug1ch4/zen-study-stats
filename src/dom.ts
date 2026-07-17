// 最小の DOM/SVG 生成ヘルパー（依存なし）。

type Attrs = Record<string, string | number | boolean | ((e: Event) => void)>;
type Child = Node | string | null | undefined | false;

function apply(el: Element, attrs?: Attrs, children?: Child[]) {
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v === null || v === undefined) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  if (children) {
    for (const c of children) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
}

/** HTML 要素 */
export function h(tag: string, attrs?: Attrs, children?: Child[]): HTMLElement {
  const el = document.createElement(tag);
  apply(el, attrs, children);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** SVG 要素 */
export function s(tag: string, attrs?: Attrs, children?: Child[]): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, attrs, children);
  return el;
}
