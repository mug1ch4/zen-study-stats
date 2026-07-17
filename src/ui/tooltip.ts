import { h } from '../dom';

/** Shadow DOM 内に置く追従ツールチップ。 */
export class Tooltip {
  readonly el: HTMLElement;
  constructor() {
    this.el = h('div', { class: 'zss-tip' });
  }
  show(clientX: number, clientY: number, html: string) {
    this.el.innerHTML = html;
    this.el.style.left = `${clientX}px`;
    this.el.style.top = `${clientY}px`;
    this.el.classList.add('on');
  }
  hide() {
    this.el.classList.remove('on');
  }
}
