// コース/章ごとの「合計動画時間・動画数・確認テスト数・レポート数・進捗」を集計。
// batch エンドポイントを使い、進捗(passed_materials)署名でキャッシュ。
// 【第一原則】GETのみ・read-only。全章を舐めるがバッチ＋キャッシュでレート配慮(規約12-9)。
import {
  fetchMyCourses,
  fetchCoursesBatch,
  fetchCourseChapters,
  isSupplement,
  type Section,
} from './courseApi';

export interface Metrics {
  movieSeconds: number;
  movieCount: number;
  testCount: number;
  reportCount: number;
  testQuestions: number; // テストの合計問題数（時間換算の精度向上用）
  reportQuestions: number; // レポートの合計問題数
}
export interface ChapterVol {
  id: number;
  title: string;
  total: Metrics;
  remaining: Metrics; // 未passed のみ
  passed: number;
  totalCount: number;
}
export interface CourseVol {
  id: number;
  title: string;
  total: Metrics;
  remaining: Metrics;
  /** 視聴任意（supplement）の集計。本家進捗の対象外だが、設定で残り学習量に含められる。 */
  supp: { total: Metrics; remaining: Metrics };
  totalMaterials: number;
  passedMaterials: number;
  totalChapters: number;
  passedChapters: number;
  chapters: ChapterVol[];
}

// コースIDごとに { sig, vol } を保存し、進捗が変わったコースだけ再集計する差分キャッシュ。
// （全コース連結の署名だと1コース進んだだけで全再取得になる問題を回避）
// v4: supplement（視聴任意）を集計から除外した版。旧キャッシュ(v3)は自然放棄。
const CACHE_KEY = 'zss:courseVol6'; // v6: 問題数＋supplement並走集計を追加
type CourseCache = Record<number, { sig: string; vol: CourseVol }>;

// プレビュー/テスト用
let mock: CourseVol[] | null = null;
export function __setMockVolumes(v: CourseVol[]): void {
  mock = v;
}

/** ネットワークを叩かず、保存済みキャッシュのコース集計だけ返す（学習時間の換算用。無ければ空）。 */
export async function getCachedCourseVolumes(): Promise<CourseVol[]> {
  if (mock) return mock;
  try {
    const r = await chrome.storage.local.get([CACHE_KEY]);
    const c = (r?.[CACHE_KEY] as CourseCache) ?? {};
    return Object.values(c).map((x) => x.vol);
  } catch {
    return [];
  }
}

const zero = (): Metrics => ({ movieSeconds: 0, movieCount: 0, testCount: 0, reportCount: 0, testQuestions: 0, reportQuestions: 0 });
function addSection(m: Metrics, s: Section): void {
  if (s.resource_type === 'movie') {
    m.movieSeconds += s.length ?? 0;
    m.movieCount++;
  } else if (s.resource_type === 'evaluation_test' || s.resource_type === 'essay_test') {
    m.testCount++;
    m.testQuestions += s.total_question ?? 0;
  } else if (s.resource_type === 'evaluation_report' || s.resource_type === 'essay_report') {
    m.reportCount++;
    m.reportQuestions += s.total_question ?? 0;
  }
}
/** 総数と残（未passed）を1パスで集計。main（本家進捗の母集団）と supplement（視聴任意）を分けて持つ。 */
function tally(sections: Section[]): { total: Metrics; remaining: Metrics; suppTotal: Metrics; suppRemaining: Metrics } {
  const total = zero();
  const remaining = zero();
  const suppTotal = zero();
  const suppRemaining = zero();
  for (const s of sections) {
    if (isSupplement(s)) {
      addSection(suppTotal, s);
      if (!s.passed) addSection(suppRemaining, s);
      continue;
    }
    addSection(total, s);
    if (!s.passed) addSection(remaining, s);
  }
  return { total, remaining, suppTotal, suppRemaining };
}
function sumMetrics(list: Metrics[]): Metrics {
  const acc = zero();
  for (const m of list) {
    acc.movieSeconds += m.movieSeconds;
    acc.movieCount += m.movieCount;
    acc.testCount += m.testCount;
    acc.reportCount += m.reportCount;
    acc.testQuestions += m.testQuestions;
    acc.reportQuestions += m.reportQuestions;
  }
  return acc;
}

/**
 * 全受講コースのボリュームを集計。
 * リクエスト: my_courses(1) + courses batch(1) + chapters batch(コース数) を逐次。
 * 進捗署名が前回と同じならキャッシュを返す（変化検知で差分のみ再取得）。
 */
export async function computeCourseVolumes(onProgress?: (msg: string) => void): Promise<CourseVol[]> {
  if (mock) return mock;

  const my = await fetchMyCourses();
  const titleById = new Map(my.map((c) => [c.id, c.title]));
  const batch = await fetchCoursesBatch(my.map((c) => c.id));

  // 既存キャッシュ（コースIDごと）を読み込み、進捗署名が一致するコースは再取得しない。
  let cache: CourseCache = {};
  try {
    const r = await chrome.storage.local.get([CACHE_KEY]);
    cache = (r?.[CACHE_KEY] as CourseCache) ?? {};
  } catch {
    /* ignore */
  }

  const result: CourseVol[] = [];
  const nextCache: CourseCache = {};
  const changed = batch.filter((c) => cache[c.id]?.sig !== `${c.id}:${c.progress?.passed_materials}`).length;
  let done = 0;
  for (const c of batch) {
    const sig = `${c.id}:${c.progress?.passed_materials}`;
    const hit = cache[c.id];
    if (hit && hit.sig === sig) {
      // 進捗が前回と同じ → 再集計せずキャッシュを再利用（タイトルだけ最新に）。
      const vol: CourseVol = { ...hit.vol, title: titleById.get(c.id) ?? hit.vol.title };
      result.push(vol);
      nextCache[c.id] = { sig, vol };
      continue;
    }
    onProgress?.(`集計中… ${++done}/${changed}`);
    const chIds = c.chapters.map((ch) => ch.id);
    const secByChapter = new Map(
      (await fetchCourseChapters(c.id, chIds)).map((x) => [x.id, x.sections])
    );
    const tallies = c.chapters.map((ch) => {
      const secs = secByChapter.get(ch.id) ?? [];
      return { ch, secs, t: tally(secs) };
    });
    const chapters: ChapterVol[] = tallies.map(({ ch, secs, t }) => ({
      id: ch.id,
      title: ch.title,
      total: t.total,
      remaining: t.remaining,
      passed: ch.progress?.passed_count ?? 0,
      totalCount: ch.progress?.total_count ?? secs.length,
    }));
    const vol: CourseVol = {
      id: c.id,
      title: titleById.get(c.id) ?? c.title,
      total: sumMetrics(chapters.map((x) => x.total)),
      remaining: sumMetrics(chapters.map((x) => x.remaining)),
      supp: {
        total: sumMetrics(tallies.map((x) => x.t.suppTotal)),
        remaining: sumMetrics(tallies.map((x) => x.t.suppRemaining)),
      },
      totalMaterials: c.progress?.total_materials ?? 0,
      passedMaterials: c.progress?.passed_materials ?? 0,
      totalChapters: c.progress?.total_chapters ?? c.chapters.length,
      passedChapters: c.progress?.passed_chapters ?? 0,
      chapters,
    };
    result.push(vol);
    nextCache[c.id] = { sig, vol };
  }

  try {
    // 受講しなくなったコースは nextCache から自然に消える（肥大防止）。
    await chrome.storage.local.set({ [CACHE_KEY]: nextCache });
  } catch {
    /* ignore */
  }
  return result;
}
