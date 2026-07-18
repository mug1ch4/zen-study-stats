// 未提出テスト/レポートの所要時間タイマー（オプション表示）。
// /evaluation_test・/essay_test・/evaluation_report・/essay_report のページで、
// 未提出のあいだの表示時間を教材(sectionId)ごとに累計し（本家は解答途中をキャッシュ
// するため、セッション単位でなく教材単位の総合時間で測る）、提出検知で所要時間として記録する。
// 【第一原則】GETのみ（章詳細の確認）。表示は自ブラウザのみ。何も送信しない。
import { getJSON } from './http';
import { recordWorkTime } from './history';
import { showToast } from './ui/toast';

const KEY_ENABLED = 'zss:testTimer'; // 未設定=ON（ウィジェットの✕ or 表示設定でOFF）
const KEY_ACC = 'zss:timerAcc'; // { [sectionId]: { sec, courseId, chapterId, kind, q, ts } }

const PAGE_RE = /^\/courses\/(\d+)\/chapters\/(\d+)\/(evaluation_test|essay_test|evaluation_report|essay_report)\/(\d+)\/?$/;
const SAVE_EVERY_SEC = 15;
const MIN_RECORD_MIN = 0.2; // これ未満は誤操作扱いで記録しない
const MAX_RECORD_MIN = 180; // 放置累計の暴走ガード

type Kind = 'test' | 'report';
interface AccEntry {
  sec: number;
  courseId: number;
  chapterId: number;
  kind: Kind;
  q: number | null;
  ts: number; // 最終更新 epoch ms（剪定用）
}

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local;
}

export async function getTimerEnabled(): Promise<boolean> {
  if (!hasStorage()) return false;
  try {
    const r = await chrome.storage.local.get([KEY_ENABLED]);
    return r?.[KEY_ENABLED] !== false; // 未設定はON
  } catch {
    return false;
  }
}
export async function setTimerEnabled(v: boolean): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY_ENABLED]: v });
  } catch {
    /* ignore */
  }
  if (!v) stopTimer(true);
  else void ensureTestTimer();
}

async function loadAcc(): Promise<Record<string, AccEntry>> {
  if (!hasStorage()) return {};
  try {
    const r = await chrome.storage.local.get([KEY_ACC]);
    return (r?.[KEY_ACC] as Record<string, AccEntry>) ?? {};
  } catch {
    return {};
  }
}
async function saveAccEntry(sectionId: number, e: AccEntry): Promise<void> {
  try {
    const acc = await loadAcc();
    acc[String(sectionId)] = { ...e, ts: Date.now() };
    // 剪定: 90日更新なし or 300件超の古いものを落とす
    const keys = Object.keys(acc);
    const cutoff = Date.now() - 90 * 86400000;
    for (const k of keys) if ((acc[k].ts ?? 0) < cutoff) delete acc[k];
    const rest = Object.keys(acc).sort((a, b) => (acc[a].ts ?? 0) - (acc[b].ts ?? 0));
    while (rest.length > 300) delete acc[rest.shift()!];
    await chrome.storage.local.set({ [KEY_ACC]: acc });
  } catch {
    /* ignore */
  }
}
async function deleteAccEntry(sectionId: number): Promise<void> {
  try {
    const acc = await loadAcc();
    delete acc[String(sectionId)];
    await chrome.storage.local.set({ [KEY_ACC]: acc });
  } catch {
    /* ignore */
  }
}

// 章詳細の軽量キャッシュ（ルート変化の揺れで連打しない）
const chapCache = new Map<string, { at: number; sections: { id?: number; done?: boolean; passed: boolean; total_question?: number }[] }>();
async function fetchSectionState(courseId: number, chapterId: number, sectionId: number): Promise<{ done: boolean; q: number | null } | null> {
  const key = `${courseId}/${chapterId}`;
  const hit = chapCache.get(key);
  let sections = hit && Date.now() - hit.at < 60_000 ? hit.sections : null;
  if (!sections) {
    const j = await getJSON<{ chapter?: { sections?: { id?: number; done?: boolean; passed: boolean; total_question?: number }[] } }>(
      `/v2/material/courses/${courseId}/chapters/${chapterId}`
    );
    sections = j.chapter?.sections ?? [];
    chapCache.set(key, { at: Date.now(), sections });
  }
  const s = sections.find((x) => x.id === sectionId);
  if (!s) return null;
  return { done: !!(s.done || s.passed), q: s.total_question ?? null };
}

interface Running {
  sectionId: number;
  courseId: number;
  chapterId: number;
  kind: Kind;
  q: number | null;
  sec: number; // 累計（過去セッション含む）
  unsavedSec: number;
}
let running: Running | null = null;
let tickId = 0;
let widget: HTMLElement | null = null;
let label: HTMLElement | null = null;
let stateEl: HTMLElement | null = null;
let ensureToken = 0;

const fmt = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};

function mountWidget(): void {
  if (widget) return;
  const dark = 'position:fixed;right:16px;bottom:16px;z-index:2147482000;display:flex;align-items:center;gap:8px;' +
    'background:rgba(17,24,33,.92);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:999px;' +
    'padding:8px 10px 8px 14px;font:12px/1.4 -apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.25);user-select:none';
  widget = document.createElement('div');
  widget.id = 'zss-test-timer';
  widget.style.cssText = dark;
  widget.title = 'この教材（未提出）の累計計測時間。提出すると所要時間として記録されます。タブが非表示の間は止まります。';
  label = document.createElement('b');
  label.style.cssText = 'font-size:13px;font-variant-numeric:tabular-nums';
  stateEl = document.createElement('span');
  stateEl.style.cssText = 'opacity:.75';
  const close = document.createElement('button');
  close.textContent = '✕';
  close.title = 'タイマーを非表示にする（統計カードの「表示設定」で戻せます）';
  close.style.cssText = 'all:unset;cursor:pointer;padding:2px 6px;border-radius:999px;opacity:.7';
  close.addEventListener('mouseenter', () => (close.style.opacity = '1'));
  close.addEventListener('mouseleave', () => (close.style.opacity = '.7'));
  close.addEventListener('click', () => {
    void setTimerEnabled(false);
    showToast('タイマーを非表示にしました。統計カードの「表示設定」から戻せます。', { icon: '⏱' });
  });
  widget.append('⏱ ', label, stateEl, close);
  document.body.appendChild(widget);
}
function removeWidget(): void {
  widget?.remove();
  widget = null;
  label = null;
  stateEl = null;
}

function renderTick(): void {
  if (!running || !label || !stateEl) return;
  label.textContent = fmt(running.sec);
  stateEl.textContent = document.visibilityState === 'visible' ? ' 計測中（累計）' : ' 一時停止';
}

/** タイマー停止（flush=蓄積を保存）。 */
export function stopTimer(flush: boolean): void {
  if (tickId) {
    window.clearInterval(tickId);
    tickId = 0;
  }
  if (running && flush && running.unsavedSec > 0) {
    void saveAccEntry(running.sectionId, {
      sec: running.sec,
      courseId: running.courseId,
      chapterId: running.chapterId,
      kind: running.kind,
      q: running.q,
      ts: Date.now(),
    });
  }
  running = null;
  removeWidget();
}

/** 提出検知（observer 経由）。現在計測中の教材なら確定記録して true。 */
export function notifyTimerSubmission(resourceId: number): boolean {
  if (!running || !Number.isFinite(resourceId) || running.sectionId !== resourceId) return false;
  const r = running;
  if (tickId) {
    window.clearInterval(tickId);
    tickId = 0;
  }
  running = null;
  const min = r.sec / 60;
  void deleteAccEntry(r.sectionId);
  if (min >= MIN_RECORD_MIN && min <= MAX_RECORD_MIN) {
    void recordWorkTime(r.courseId, r.kind, min, r.q ?? 1);
    if (label && stateEl) {
      label.textContent = fmt(r.sec);
      stateEl.textContent = ' 提出を検知 — 所要時間を記録しました';
    }
  }
  const w = widget;
  widget = null; // 以後の mount と切り離し
  window.setTimeout(() => w?.remove(), 6000);
  label = null;
  stateEl = null;
  return true;
}

/** ルート変化・起動時に呼ぶ。対象ページなら計測開始、離脱なら保存して停止。 */
export async function ensureTestTimer(): Promise<void> {
  if (window.top !== window) return; // トップフレームのみ
  const token = ++ensureToken;
  const m = location.pathname.match(PAGE_RE);
  if (!m) {
    stopTimer(true);
    return;
  }
  const sectionId = +m[4];
  if (running?.sectionId === sectionId) return; // 継続中
  stopTimer(true);
  if (!(await getTimerEnabled())) return;
  const courseId = +m[1];
  const chapterId = +m[2];
  const kind: Kind = m[3] === 'evaluation_test' || m[3] === 'essay_test' ? 'test' : 'report';
  try {
    const st = await fetchSectionState(courseId, chapterId, sectionId);
    if (token !== ensureToken) return; // その間に別ページへ
    if (!st || st.done) return; // 提出済み/不明は計測しない
    const acc = await loadAcc();
    if (token !== ensureToken) return;
    const prev = acc[String(sectionId)];
    running = { sectionId, courseId, chapterId, kind, q: st.q, sec: prev?.sec ?? 0, unsavedSec: 0 };
    mountWidget();
    renderTick();
    tickId = window.setInterval(() => {
      if (!running) return;
      if (document.visibilityState === 'visible') {
        running.sec++;
        running.unsavedSec++;
        if (running.unsavedSec >= SAVE_EVERY_SEC) {
          running.unsavedSec = 0;
          void saveAccEntry(running.sectionId, {
            sec: running.sec,
            courseId: running.courseId,
            chapterId: running.chapterId,
            kind: running.kind,
            q: running.q,
            ts: Date.now(),
          });
        }
      }
      renderTick();
    }, 1000);
  } catch {
    /* 状態確認失敗時は表示しない（本流に影響させない） */
  }
}

/** ページ離脱時の保存フック（content.ts から一度だけ登録）。 */
export function installTimerFlushHooks(): void {
  const flush = (): void => {
    if (running && running.unsavedSec > 0) {
      // pagehide では await できないため同期発火のみ（chrome.storage は書き込みが走る）
      void saveAccEntry(running.sectionId, {
        sec: running.sec,
        courseId: running.courseId,
        chapterId: running.chapterId,
        kind: running.kind,
        q: running.q,
        ts: Date.now(),
      });
      running.unsavedSec = 0;
    }
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
