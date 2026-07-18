// 「詳細ログの抽出」フォールド: テスト/レポートの受験記録（合否・点数・日時）を
// 結果ページから収集し、導入以前も含む実測の遡及分析を表示する。
// 収集は手動ボタン起動・スロットル付き・確定分は永続キャッシュ（2回目以降は新規完了分のみ）。
import { h } from '../dom';
import { collectResultLog, getResultLog, getResultLogAt } from '../resultLog';
import { retroSections } from '../resultStats';
import { fetchCourseMaterials } from '../courseApi';
import type { Section } from '../analysis';

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local;
}

/** カード末尾に置く抽出フォールド。renderSection は learningCard の insight レンダラを注入。 */
export function renderResultLogFold(renderSection: (s: Section) => HTMLElement): HTMLElement {
  if (!hasStorage()) {
    return h('details', { class: 'zss-fold zss-dm zss-rl' }, [
      h('summary', {}, ['⤓ 詳細ログの抽出（受験記録の遡及復元）']),
      h('p', { class: 'zss-dm-note' }, ['拡張機能として ZEN Study 上で動作しているときに利用できます（このデモでは無効です）。']),
    ]);
  }
  const status = h('div', { class: 'zss-dm-status' }, []);
  const statsBody = h('div', {}, []);
  const btn = h('button', { class: 'zss-dm-btn' }, ['抽出を開始']) as HTMLButtonElement;
  // ステータスチップ（未実行=要注目 / 収集済み=件数）。開かなくても状態が見える。
  const chip = h('span', { class: 'zss-rl-chip' }, []);
  const refreshChip = async (): Promise<void> => {
    const entries = await getResultLog().catch(() => []);
    chip.textContent = entries.length ? `収集済み ${entries.length}件` : '未実行・推奨';
    chip.classList.remove('ok', 'todo');
    chip.classList.add(entries.length ? 'ok' : 'todo');
  };
  void refreshChip();

  const renderStats = async (): Promise<void> => {
    const [entries, at] = await Promise.all([getResultLog(), getResultLogAt()]);
    statsBody.textContent = '';
    if (!entries.length) return;
    const courses = await fetchCourseMaterials().catch(() => []);
    const titleById = new Map(courses.map((c) => [c.id, c.title]));
    for (const sec of retroSections(entries, titleById)) statsBody.appendChild(renderSection(sec));
    if (at) {
      statsBody.appendChild(h('p', { class: 'zss-dm-note' }, [`最終収集: ${new Date(at).toLocaleString('ja-JP')}。同じ内容は分析タブにも表示されます。`]));
    }
    btn.textContent = '更新（新規完了分のみ取得）';
  };

  btn.addEventListener('click', () => {
    btn.disabled = true;
    status.textContent = '準備中…';
    status.className = 'zss-dm-status';
    void collectResultLog((p) => {
      status.textContent =
        p.phase === 'scan'
          ? `章を確認中… ${p.done}/${p.total} コース`
          : `結果を取得中… ${p.done}/${p.total} 件（教材1件ずつ間隔を空けて取得しています）`;
    })
      .then(async (r) => {
        status.className = 'zss-dm-status ok';
        status.textContent =
          r.candidates === 0
            ? `新規の受験記録はありません（収集済み ${r.totalEntries}件）。`
            : `完了: ${r.ok}件を取得（累計 ${r.totalEntries}件${r.failed ? `・失敗 ${r.failed}` : ''}）。${r.truncated ? '上限に達したため、もう一度実行すると続きを取得します。' : ''}`;
        await refreshChip();
        await renderStats();
      })
      .catch((e) => {
        console.warn('[ZSS] 詳細ログ抽出失敗:', e);
        status.className = 'zss-dm-status err';
        status.textContent = '抽出に失敗しました。時間をおいて再試行してください。';
      })
      .finally(() => {
        btn.disabled = false;
      });
  });

  const det = h('details', { class: 'zss-fold zss-dm zss-rl' }, [
    h('summary', {}, ['⤓ 詳細ログの抽出（受験記録の遡及復元）', chip]),
    h('p', { class: 'zss-dm-note' }, [
      '受験済みテスト/レポートの結果画面から、合否・点数・受験日時を収集します。拡張の導入以前の記録も復元でき、アクティブ時間帯・初回合格率・過去の教科別進度などの実測分析ができます。',
    ]),
    h('p', { class: 'zss-dm-note' }, [
      '取得は1件ずつ間隔を空けて行い（約2件/秒・1回の上限600件）、一度取得した確定結果は保存して再取得しません（2回目以降は新規完了分のみ＝数件）。保存するのは合否・点数・日時のみで、問題文や解答は保存しません。',
    ]),
    h('div', { class: 'zss-dm-row' }, [btn]),
    status,
    statsBody,
  ]) as HTMLDetailsElement;
  det.addEventListener('toggle', () => {
    if (det.open) void renderStats();
  }, { once: true });
  return det;
}
