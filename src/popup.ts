// ツールバーポップアップ: ZEN Study を開かずに要点（今日の目標・ストリーク・全体%）を確認する。
// 【第一原則】GETのみ・read-only。ホスト権限の Cookie でAPIを読むだけ（クリック時のみ・計4リクエスト）。
import { fetchLearningAmounts, fetchReportProgresses } from './api';
import { fetchCourseMaterials } from './courseApi';
import { getDayStart } from './history';
import { computeKpis } from './derive';
import { zenToday, zenTodayISO } from './format';
import { h, s } from './dom';
import { logWarn } from './log';

const app = document.getElementById('app')!;

const css = `
  .p-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
  .p-title { font-size: 14px; font-weight: 800; }
  .p-ver { font-size: 10px; opacity: .55; }
  .p-row { display: flex; align-items: center; gap: 14px; }
  .p-stats { flex: 1 1 auto; display: flex; flex-direction: column; gap: 7px; min-width: 0; }
  .p-stat { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
  .p-l { font-size: 11px; opacity: .65; }
  .p-v { font-weight: 800; font-variant-numeric: tabular-nums; }
  .p-v .sub { font-weight: 400; font-size: 11px; opacity: .65; }
  .p-quest-bar { height: 6px; border-radius: 3px; background: rgba(128,128,128,.25); overflow: hidden; margin-top: 4px; }
  .p-quest-fill { height: 100%; background: #0077d3; border-radius: 3px; }
  .p-quest-fill.met { background: #1a8a4a; }
  .p-open {
    display: block; margin-top: 12px; text-align: center; font-size: 12px; font-weight: 700;
    padding: 7px 0; border-radius: 7px; border: 1px solid rgba(128,128,128,.35);
    color: inherit; text-decoration: none; cursor: pointer; background: transparent; width: 100%; font-family: inherit;
  }
  .p-open:hover { background: rgba(128,128,128,.12); }
  .p-note { font-size: 10px; opacity: .55; margin-top: 8px; line-height: 1.5; }
  .p-err { font-size: 12px; opacity: .8; padding: 8px 0; }
`;
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

function openZen(): void {
  void chrome.tabs.create({ url: 'https://www.nnn.ed.nico/setting' });
  window.close();
}

async function main(): Promise<void> {
  try {
    const [la, courses, report, ds] = await Promise.all([
      fetchLearningAmounts(),
      fetchCourseMaterials(),
      fetchReportProgresses().catch(() => null),
      getDayStart(),
    ]);
    const total = courses.reduce((a, c) => a + c.total, 0);
    const passed = courses.reduce((a, c) => a + c.passed, 0);
    const pct = total ? Math.round((passed / total) * 100) : 0;
    const kpis = computeKpis(la);

    // 今日の目標（義務ペース）= 残 / 締切までの残日数
    let target = 0;
    if (report?.finalDeadline && total > passed) {
      const daysLeft = Math.max(1, Math.ceil((new Date(report.finalDeadline).getTime() - zenToday().getTime()) / 86400000));
      target = Math.max(1, Math.ceil((total - passed) / daysLeft));
    }
    const todayDone = ds && ds.date === zenTodayISO() ? Math.max(0, passed - ds.passed) : 0;
    const met = target > 0 && todayDone >= target;
    const qpct = target > 0 ? Math.min(100, Math.round((todayDone / target) * 100)) : 0;

    // ミニドーナツ（全体%）
    const size = 84, stroke = 10, cx = size / 2, r = cx - stroke / 2 - 1, C = 2 * Math.PI * r;
    const frac = total ? Math.min(1, passed / total) : 0;
    const donut = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': `全体 ${pct}%` }, [
      s('circle', { cx, cy: cx, r, fill: 'none', stroke: 'rgba(128,128,128,.25)', 'stroke-width': stroke }),
      ...(frac > 0
        ? [s('circle', { cx, cy: cx, r, fill: 'none', stroke: '#0077d3', 'stroke-width': stroke, 'stroke-linecap': 'round',
            'stroke-dasharray': `${(frac * C).toFixed(1)} ${C.toFixed(1)}`, transform: `rotate(-90 ${cx} ${cx})` })]
        : []),
      s('text', { x: cx, y: cx, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 19, 'font-weight': 800, fill: 'currentColor' }, [`${pct}%`]),
    ]);

    const openBtn = h('button', { class: 'p-open' }, ['ZEN Study を開く']);
    openBtn.addEventListener('click', openZen);

    app.textContent = '';
    app.append(
      h('div', { class: 'p-head' }, [
        h('span', { class: 'p-title' }, ['学習統計']),
        h('span', { class: 'p-ver' }, [`v${__APP_VERSION__}`]),
      ]),
      h('div', { class: 'p-row' }, [
        donut,
        h('div', { class: 'p-stats' }, [
          h('div', {}, [
            h('div', { class: 'p-stat' }, [
              h('span', { class: 'p-l' }, ['今日の目標']),
              h('span', { class: 'p-v' }, [target > 0 ? `${todayDone} / ${target}` : '—', h('span', { class: 'sub' }, [' 教材'])]),
            ]),
            ...(target > 0
              ? [h('div', { class: 'p-quest-bar' }, [(() => { const f = h('div', { class: 'p-quest-fill' + (met ? ' met' : '') }, []); f.style.width = `${qpct}%`; return f; })()])]
              : []),
          ]),
          h('div', { class: 'p-stat' }, [h('span', { class: 'p-l' }, ['連続学習']), h('span', { class: 'p-v' }, [`${kpis.streak}`, h('span', { class: 'sub' }, [' 日'])])]),
          h('div', { class: 'p-stat' }, [h('span', { class: 'p-l' }, ['残り教材']), h('span', { class: 'p-v' }, [`${Math.max(0, total - passed)}`, h('span', { class: 'sub' }, [` / ${total}`])])]),
        ]),
      ]),
      openBtn,
      h('div', { class: 'p-note' }, ['表示専用・read-only。データ取得はこのポップアップを開いた時のみ。'])
    );
  } catch (e) {
    logWarn('popup 取得失敗:', e);
    const openBtn = h('button', { class: 'p-open' }, ['ZEN Study を開く']);
    openBtn.addEventListener('click', openZen);
    app.textContent = '';
    app.append(
      h('div', { class: 'p-err' }, ['学習データを取得できませんでした。ZEN Study にログインしているか確認してください。']),
      openBtn
    );
  }
}

void main();
