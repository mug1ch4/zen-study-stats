// 詳細ログの抽出: テスト/レポート結果画面（/contents/.../result）のHTMLに
// サーバ埋め込みされた data-*-params から、合否・点数・受験日時のメタデータを収集する。
// 導入以前の学習記録（日別×教科・時間帯・初回合格率など）の遡及復元の土台。
//
// 【第一原則】GETのみ・read-only。
// 【ToS配慮】保存するのはメタデータ（合否・点数・受験日時）のみ。
//   設問文・自分の解答文・正誤配列などコンテンツ本文は一切保存しない（第9条=コンテンツ非保存）。
// 【レート配慮】結果ページは教材1件=1GET。1件ごとに待機を挟み（約2件/秒）、1回の実行に上限を設ける。
//   結果は不変のため合格済みエントリは永続キャッシュし、二度と再取得しない（2回目以降は新規完了分のみ）。
import { fetchMyCourses, fetchCoursesBatch, fetchCourseChapters } from './courseApi';

const KEY_LOG = 'zss:resultLog'; // Record<sectionId, ResultEntry>（フラット構造＝バックアップの統合が単純）
const KEY_AT = 'zss:resultLogAt'; // 最終収集時刻 epoch ms

export type ResultKind = 'test' | 'report';
export interface ResultEntry {
  courseId: number;
  chapterId: number;
  sectionId: number;
  kind: ResultKind;
  passed: boolean; // 最新時点で合格済みか
  score: number | null; // 最新(前回)の得点
  totalScore: number | null; // 満点
  firstAt: number | null; // 初回受験 epoch秒
  firstPassed: boolean | null; // 初回で合格したか
  firstScore: number | null; // 初回の得点
  latestAt: number | null; // 最新(前回)受験 epoch秒
}

export interface ParsedResult {
  passed: boolean;
  totalScore: number | null;
  first: { passed: boolean; score: number | null; at: number | null } | null;
  latest: { passed: boolean; score: number | null; at: number | null } | null;
}

/** 結果ページHTMLから data-evaluation-{test|report}-params を取り出す（純関数・失敗は null）。 */
export function parseResultParams(html: string): ParsedResult | null {
  const m = html.match(/data-evaluation-(?:test|report)-params="([^"]*)"/) ?? html.match(/data-evaluation-(?:test|report)-params='([^']*)'/);
  if (!m) return null;
  const unescaped = m[1]
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  try {
    const j = JSON.parse(unescaped) as {
      passed?: boolean;
      total_score?: number;
      result?: {
        first?: { passed?: boolean; score?: number; answered_at?: number };
        latest?: { passed?: boolean; score?: number; answered_at?: number };
      };
    };
    const side = (s?: { passed?: boolean; score?: number; answered_at?: number }) =>
      s ? { passed: !!s.passed, score: typeof s.score === 'number' ? s.score : null, at: typeof s.answered_at === 'number' ? s.answered_at : null } : null;
    return {
      passed: !!j.passed,
      totalScore: typeof j.total_score === 'number' ? j.total_score : null,
      first: side(j.result?.first),
      latest: side(j.result?.latest),
    };
  } catch {
    return null;
  }
}

function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome?.storage?.local;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type LogMap = Record<string, ResultEntry>;
async function loadMap(): Promise<LogMap> {
  if (!hasStorage()) return {};
  try {
    const r = await chrome.storage.local.get([KEY_LOG]);
    return (r?.[KEY_LOG] as LogMap) ?? {};
  } catch {
    return {};
  }
}
async function saveMap(m: LogMap): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY_LOG]: m });
  } catch {
    /* ignore */
  }
}

/** 収集済みの結果ログ（配列）。 */
export async function getResultLog(): Promise<ResultEntry[]> {
  return Object.values(await loadMap());
}
/** 最終収集時刻（epoch ms）。未収集は null。 */
export async function getResultLogAt(): Promise<number | null> {
  if (!hasStorage()) return null;
  try {
    const r = await chrome.storage.local.get([KEY_AT]);
    return typeof r?.[KEY_AT] === 'number' ? (r[KEY_AT] as number) : null;
  } catch {
    return null;
  }
}

export interface CollectProgress {
  phase: 'scan' | 'fetch';
  done: number;
  total: number;
}
export interface CollectResult {
  candidates: number; // 取得対象（解答済み・未キャッシュ）だった教材数
  ok: number;
  failed: number;
  totalEntries: number; // 収集済み合計
  truncated: boolean; // 上限で打ち切った（もう一度実行で続きから）
}

const FETCH_DELAY_MS = 450; // 結果ページの取得間隔（約2.2件/秒）
const SCAN_DELAY_MS = 250; // 章スキャンのコース間待機
const MAX_PER_RUN = 600; // 1回の実行での結果ページ取得上限（約4.5分）

/** 受験済みテスト/レポートの結果メタデータを収集（差分・レート配慮・途中保存）。 */
export async function collectResultLog(onProgress?: (p: CollectProgress) => void): Promise<CollectResult> {
  const cur = await loadMap();
  // 1) 章スキャン: 進捗のある章だけを対象（未着手の章に受験済み教材は無い）
  const my = await fetchMyCourses();
  const batch = await fetchCoursesBatch(my.map((c) => c.id));
  const jobs = batch
    .map((c) => ({
      courseId: c.id,
      chapterIds: (c.chapters ?? []).filter((ch) => ch.progress && ch.progress.passed_count > 0).map((ch) => ch.id),
    }))
    .filter((j) => j.chapterIds.length);
  const cands: { courseId: number; chapterId: number; sectionId: number; kind: ResultKind }[] = [];
  let scanned = 0;
  for (const j of jobs) {
    onProgress?.({ phase: 'scan', done: ++scanned, total: jobs.length });
    const chs = await fetchCourseChapters(j.courseId, j.chapterIds);
    await sleep(SCAN_DELAY_MS);
    for (const ch of chs) {
      for (const s of ch.sections) {
        const kind: ResultKind | null =
          s.resource_type === 'evaluation_test' ? 'test' : s.resource_type === 'evaluation_report' ? 'report' : null;
        // essay系（論述）は結果paramsが空（人間採点の別フロー）のため対象外
        if (!kind || !s.id) continue;
        if (!(s.done || s.passed)) continue; // 未解答は結果が無い
        const cached = cur[String(s.id)];
        if (cached && cached.passed) continue; // 確定済み＝不変。再取得しない
        cands.push({ courseId: j.courseId, chapterId: ch.id, sectionId: s.id, kind });
      }
    }
  }
  // 2) 結果ページを1件ずつ取得（スロットル・上限・途中保存）
  const todo = cands.slice(0, MAX_PER_RUN);
  let ok = 0;
  let failed = 0;
  let done = 0;
  for (const c of todo) {
    onProgress?.({ phase: 'fetch', done: ++done, total: todo.length });
    await sleep(FETCH_DELAY_MS);
    try {
      const kindPath = c.kind === 'test' ? 'evaluation_tests' : 'evaluation_reports';
      const r = await fetch(
        `https://www.nnn.ed.nico/contents/courses/${c.courseId}/chapters/${c.chapterId}/${kindPath}/${c.sectionId}/result?content_type=monka`,
        { credentials: 'include' }
      );
      if (!r.ok) {
        failed++;
        continue;
      }
      const p = parseResultParams(await r.text());
      if (!p) {
        failed++;
        continue;
      }
      cur[String(c.sectionId)] = {
        courseId: c.courseId,
        chapterId: c.chapterId,
        sectionId: c.sectionId,
        kind: c.kind,
        passed: p.passed,
        score: p.latest?.score ?? null,
        totalScore: p.totalScore,
        firstAt: p.first?.at ?? null,
        firstPassed: p.first?.passed ?? null,
        firstScore: p.first?.score ?? null,
        latestAt: p.latest?.at ?? null,
      };
      ok++;
      if (ok % 10 === 0) await saveMap(cur); // 中断してもここまでの成果は残す
    } catch {
      failed++;
    }
  }
  await saveMap(cur);
  try {
    await chrome.storage.local.set({ [KEY_AT]: Date.now() });
  } catch {
    /* ignore */
  }
  return { candidates: cands.length, ok, failed, totalEntries: Object.keys(cur).length, truncated: cands.length > todo.length };
}
