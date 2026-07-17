import { h } from '../dom';

/**
 * チャートの「表の双子」。dataviz 非交渉事項: 値がホバー専用にならないよう、
 * キーボード/スクリーンリーダーから到達できる表を各チャートに添える。
 */
export function dataTable(summary: string, headers: string[], rows: (string | number)[][]): HTMLElement {
  const headRow = h('tr', {}, headers.map((hd) => h('th', { scope: 'col' }, [hd])));
  const bodyRows = rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, [String(c)]))));
  const table = h('table', { class: 'zss-dtable' }, [
    h('thead', {}, [headRow]),
    h('tbody', {}, bodyRows),
  ]);
  return h('details', { class: 'zss-dtable-details' }, [
    h('summary', {}, [summary]),
    h('div', { class: 'zss-dtable-wrap' }, [table]),
  ]);
}
