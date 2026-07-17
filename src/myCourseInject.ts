// /my_course ページの各「N月のレポート」に「未完の科目」を注入する。
// 【第一原則】GETのみ・read-only。DOMは自ブラウザの描画変更のみ。
// 【安全設計】summaryInject と同じく、各月キーで取得は最大1回（成功/失敗とも負のキャッシュ）、
//   React 再描画で消えても再注入は上限まで＝リクエストストームを構造的に防ぐ。
import { fetchMonthlyReport } from './api';
import { h } from './dom';

const MARK = 'zss-mc-undone';
const MOUNT_CAP = 6;

interface Undone { subject: string; chapter: string; passed: number; total: number }

// key "Y-M" → 未完リスト / null=取得失敗（再取得しない）
const cache = new Map<string, Undone[] | null>();
const mountCount = new Map<string, number>();
const inflight = new Set<string>();

function isMyCoursePath(): boolean {
  return location.pathname.replace(/\/+$/, '') === '/my_course';
}

async function fetchMonthUndone(year: number, month: number): Promise<Undone[]> {
  const j = await fetchMonthlyReport(year, month);
  const chapters = (j.deadline_groups ?? []).flatMap((g) => g.chapters ?? []);
  return chapters
    .filter((c) => !c.exempted && c.passed_count < c.total_count) // 免除は除外・未完のみ
    .map((c) => ({
      subject: c.subject_category_title || c.course_title || '',
      chapter: c.chapter_title || '',
      passed: c.passed_count,
      total: c.total_count,
    }));
}

function renderUndone(list: Undone[]): HTMLElement {
  const dark = document.documentElement.classList.contains('zss-dark');
  const c = dark
    ? { bg: '#232b35', text: '#e6ebf1', accent: '#f0b74a', sub: '#9aa6b2' }
    : { bg: '#fff7ec', text: '#5a4a2e', accent: '#c77f18', sub: '#8a7a5e' };
  const box = h('div', { class: MARK }, []);
  box.style.cssText = `display:block;margin:4px 0 10px;padding:7px 11px;border-left:3px solid ${c.accent};border-radius:6px;background:${c.bg};color:${c.text};font-size:12px;line-height:1.7;font-family:-apple-system,"Hiragino Kaku Gothic Pro",Meiryo,sans-serif;`;
  const MAX = 6;
  const head = h('span', {}, ['未完のレポート: ']);
  (head as HTMLElement).style.fontWeight = '700';
  box.appendChild(head);
  list.slice(0, MAX).forEach((u, i) => {
    if (i > 0) {
      const sep = h('span', {}, ['　/　']);
      (sep as HTMLElement).style.color = c.sub;
      box.appendChild(sep);
    }
    const strong = h('b', {}, [u.subject]);
    (strong as HTMLElement).style.color = c.accent;
    const meta = h('span', {}, [` ${u.chapter}（${u.passed}/${u.total}）`]);
    (meta as HTMLElement).style.color = c.sub;
    box.append(strong, meta);
  });
  if (list.length > MAX) {
    const more = h('span', {}, [`　ほか ${list.length - MAX}件`]);
    (more as HTMLElement).style.color = c.sub;
    box.appendChild(more);
  }
  return box;
}

/** 月リンク `<a href="/study_plans/month/{y}/{m}">` の直後（同じ li 内）に未完ブロックを注入。 */
function inject(li: HTMLElement, key: string, list: Undone[]): void {
  if (!list.length) {
    li.querySelector('.' + MARK)?.remove();
    return;
  }
  if (li.querySelector('.' + MARK)) return; // 既に注入済み
  const n = mountCount.get(key) ?? 0;
  if (n >= MOUNT_CAP) return; // React が消し続ける場合の暴走防止
  mountCount.set(key, n + 1);
  li.appendChild(renderUndone(list));
}

/** /my_course の各月に未完科目を注入（冪等・ストーム防止つき）。 */
export function ensureMyCourseUndone(): void {
  if (!isMyCoursePath()) {
    document.querySelectorAll('.' + MARK).forEach((e) => e.remove());
    return;
  }
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/study_plans/month/"]'));
  for (const a of links) {
    const m = (a.getAttribute('href') ?? '').match(/month\/(\d+)\/(\d+)/);
    if (!m) continue;
    const year = +m[1];
    const month = +m[2];
    const key = `${year}-${month}`;
    const li = (a.closest('li') as HTMLElement | null) ?? (a.parentElement as HTMLElement | null);
    if (!li) continue;
    // 末尾の「passed/total」を読み、完了済み(未完ゼロ)ならスキップ
    const pt = a.textContent?.match(/(\d+)\s*\/\s*(\d+)\s*$/);
    if (pt && Number(pt[1]) >= Number(pt[2])) {
      li.querySelector('.' + MARK)?.remove();
      continue;
    }
    // データ既知 → 描画のみ（fetch しない＝storm不可）
    if (cache.has(key)) {
      const data = cache.get(key);
      if (data) inject(li, key, data);
      continue;
    }
    // 未知 → 1回だけ取得
    if (inflight.has(key)) continue;
    inflight.add(key);
    void fetchMonthUndone(year, month)
      .then((data) => {
        cache.set(key, data);
        const li2 = document.querySelector<HTMLAnchorElement>(`a[href*="/study_plans/month/${year}/${month}"]`)?.closest('li') as HTMLElement | null;
        if (li2 && isMyCoursePath()) inject(li2, key, data);
      })
      .catch((e) => {
        console.warn('[ZSS] 月別レポート取得失敗（再取得しません）:', e);
        cache.set(key, null); // 負のキャッシュ
      })
      .finally(() => inflight.delete(key));
  }
}
