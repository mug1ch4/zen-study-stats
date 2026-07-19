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
import type { ChapterSkels, SkelSection } from './movieInterp';

const KEY_LOG = 'zss:resultLog'; // Record<sectionId, ResultEntry>（フラット構造＝バックアップの統合が単純）
const KEY_AT = 'zss:resultLogAt'; // 最終収集時刻 epoch ms
const KEY_SKEL = 'zss:chapterSkels'; // 章の教材並び（動画時刻の補間用・スキャン時に副産物として保存＝追加リクエスト0）

export type ResultKind = 'test' | 'report';
export interface ResultEntry {
  courseId: number;
  chapterId: number;
  sectionId: number;
  kind: ResultKind;
  essay?: boolean; // 論述系（結果は単一 answered_at・score は採点後に付く）
  passed: boolean; // 最新時点で合格済みか
  score: number | null; // 最新(前回)の得点
  totalScore: number | null; // 満点
  firstAt: number | null; // 初回受験 epoch秒
  firstPassed: boolean | null; // 初回で合格したか（essay系は不明=null）
  firstScore: number | null; // 初回の得点
  latestAt: number | null; // 最新(前回)受験 epoch秒
}

export interface ParsedResult {
  passed: boolean;
  totalScore: number | null;
  first: { passed: boolean; score: number | null; at: number | null } | null;
  latest: { passed: boolean; score: number | null; at: number | null } | null;
  /** essay系（論述）のスキーマ: result が first/latest でなく単一 { answered_at, score }。 */
  single: { at: number | null; score: number | null } | null;
}

/** 結果ページHTMLから data-{evaluation|essay}-{test|report}-params を取り出す（純関数・失敗は null）。
 *  evaluation系: result.first/latest。essay系: result.answered_at 単一（score は採点後に数値化）。 */
export function parseResultParams(html: string): ParsedResult | null {
  const m =
    html.match(/data-(?:evaluation|essay)-(?:test|report)-params="([^"]*)"/) ??
    html.match(/data-(?:evaluation|essay)-(?:test|report)-params='([^']*)'/);
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
        answered_at?: number;
        score?: number | null;
      };
    };
    const side = (s?: { passed?: boolean; score?: number; answered_at?: number }) =>
      s ? { passed: !!s.passed, score: typeof s.score === 'number' ? s.score : null, at: typeof s.answered_at === 'number' ? s.answered_at : null } : null;
    const single =
      j.result && typeof j.result.answered_at === 'number'
        ? { at: j.result.answered_at, score: typeof j.result.score === 'number' ? j.result.score : null }
        : null;
    return {
      passed: !!j.passed,
      totalScore: typeof j.total_score === 'number' ? j.total_score : null,
      first: side(j.result?.first),
      latest: side(j.result?.latest),
      single,
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
let mockResultLog: ResultEntry[] | null = null;
/** プレビュー/デモ用に結果ログを注入（chrome.storage 無し環境で buildRequiredSeries を動かす）。 */
export function __setMockResultLog(entries: ResultEntry[]): void {
  mockResultLog = entries;
}
let mockSkels: ChapterSkels | null = null;
/** プレビュー/デモ用に章スケルトンを注入（動画補間アンカーをデモでも有効にする）。 */
export function __setMockChapterSkels(skels: ChapterSkels): void {
  mockSkels = skels;
}
async function loadMap(): Promise<LogMap> {
  if (mockResultLog) return Object.fromEntries(mockResultLog.map((e) => [String(e.sectionId), e]));
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
/** 章スケルトン（教材の並び・動画秒数）。動画視聴時刻の補間に使う。 */
export async function getChapterSkels(): Promise<ChapterSkels> {
  if (mockSkels) return mockSkels;
  if (!hasStorage()) return {};
  try {
    const r = await chrome.storage.local.get([KEY_SKEL]);
    return (r?.[KEY_SKEL] as ChapterSkels) ?? {};
  } catch {
    return {};
  }
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
  // 章の順序（コース内 index）: 章またぎのアンカー連結（essay_report→次章の第1回テスト等）に使う
  const jobs = batch
    .map((c) => ({
      courseId: c.id,
      chapters: (c.chapters ?? [])
        .map((ch, order) => ({ id: ch.id, order, hasProgress: !!ch.progress && ch.progress.passed_count > 0 }))
        .filter((ch) => ch.hasProgress),
    }))
    .filter((j) => j.chapters.length);
  // 結果ページを持つ4種すべてがアンカー（essay系にも result.answered_at がある＝2026-07-18 実測で判明）
  const KIND_OF: Record<string, { kind: ResultKind; essay: boolean; path: string }> = {
    evaluation_test: { kind: 'test', essay: false, path: 'evaluation_tests' },
    essay_test: { kind: 'test', essay: true, path: 'essay_tests' },
    evaluation_report: { kind: 'report', essay: false, path: 'evaluation_reports' },
    essay_report: { kind: 'report', essay: true, path: 'essay_reports' },
  };
  const cands: { courseId: number; chapterId: number; sectionId: number; kind: ResultKind; essay: boolean; path: string; passed: boolean }[] = [];
  const skels: ChapterSkels = {};
  let scanned = 0;
  for (const j of jobs) {
    onProgress?.({ phase: 'scan', done: ++scanned, total: jobs.length });
    const orderOf = new Map(j.chapters.map((ch) => [ch.id, ch.order]));
    const chs = await fetchCourseChapters(j.courseId, j.chapters.map((ch) => ch.id));
    await sleep(SCAN_DELAY_MS);
    for (const ch of chs) {
      // 章スケルトン（動画補間用・追加リクエスト0の副産物）。アンカーか視聴済み動画のある章を保存
      // （アンカーだけの章も、章またぎ連結の時間制約として意味を持つ）。
      const skSections: SkelSection[] = ch.sections
        .filter((s) => s.id)
        .map((s) => ({
          id: s.id!,
          kind: s.resource_type === 'movie' ? 'movie' : KIND_OF[s.resource_type] ? 'anchor' : 'other',
          len: s.resource_type === 'movie' ? s.length ?? 0 : 0,
          passed: s.passed,
        }));
      if (skSections.some((s) => s.kind === 'anchor') || skSections.some((s) => s.kind === 'movie' && s.passed)) {
        skels[String(ch.id)] = { courseId: j.courseId, order: orderOf.get(ch.id), sections: skSections };
      }
      for (const s of ch.sections) {
        const meta = s.resource_type ? KIND_OF[s.resource_type] : undefined;
        if (!meta || !s.id) continue;
        if (!(s.done || s.passed)) continue; // 未解答は結果が無い
        const cached = cur[String(s.id)];
        // 確定済みは再取得しない。ただし essay系で score 未確定（採点待ち）は点数が付くまで再確認
        if (cached && cached.passed && !(cached.essay && cached.score === null)) continue;
        cands.push({ courseId: j.courseId, chapterId: ch.id, sectionId: s.id, kind: meta.kind, essay: meta.essay, path: meta.path, passed: s.passed });
      }
    }
  }
  // スケルトン保存（既存とマージ・上限400章で古いものから破棄はせず単純マージ＝カリキュラム規模で十分小さい）
  try {
    const prevSk = await getChapterSkels();
    await chrome.storage.local.set({ [KEY_SKEL]: { ...prevSk, ...skels } });
  } catch {
    /* ignore */
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
      const r = await fetch(
        `https://www.nnn.ed.nico/contents/courses/${c.courseId}/chapters/${c.chapterId}/${c.path}/${c.sectionId}/result?content_type=monka`,
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
      cur[String(c.sectionId)] = c.essay
        ? {
            // essay系: 単一 answered_at。合否は params に無いため章データ(section.passed)を採用。
            courseId: c.courseId,
            chapterId: c.chapterId,
            sectionId: c.sectionId,
            kind: c.kind,
            essay: true,
            passed: c.passed,
            score: p.single?.score ?? null,
            totalScore: p.totalScore,
            firstAt: p.single?.at ?? null,
            firstPassed: null,
            firstScore: null,
            latestAt: p.single?.at ?? null,
          }
        : {
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
