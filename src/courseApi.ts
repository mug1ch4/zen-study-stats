// コース/章のバッチ取得（GET専用）。動画合計時間・テスト/レポート数の集計に使う。
// 【第一原則】GETのみ・read-only。
import { getJSON } from './http';

export interface MyCourse {
  id: number;
  title: string;
}
export interface CourseProgress {
  total_materials: number;
  passed_materials: number;
  total_chapters: number;
  passed_chapters: number;
  total_assessment_test: number;
  passed_assessment_test_count: number;
  total_count: number;
  passed_count: number;
}
export interface ChapterBrief {
  id: number;
  title: string;
  progress?: { total_count: number; passed_count: number; status?: string };
}
export interface CourseBatch {
  id: number;
  title: string;
  progress: CourseProgress;
  chapters: ChapterBrief[];
}
export interface Section {
  id?: number; // 教材ID（結果ログ収集で使用）
  resource_type: string; // movie / evaluation_test / essay_test / evaluation_report / essay_report
  material_type?: string; // "main"=必須教材 / "supplement"=視聴任意（本家の進捗カウント対象外）
  length?: number; // movie の秒数
  total_question?: number; // test の問題数
  passed: boolean;
  done?: boolean; // 解答済み（evaluation_test/evaluation_report のみ。不合格でも true）
}

/** 視聴任意（supplement）か。本家の progress（total_count/passed_materials）は main のみを数える
 *  （HAR実測: 章のsections 27件中 supplement 4件 → total_count=23）。集計を本家と揃えるため除外する。 */
export function isSupplement(s: Section): boolean {
  return s.material_type === 'supplement';
}
export interface ChapterSections {
  id: number;
  sections: Section[];
}

export interface CourseMaterial {
  id: number;
  title: string;
  total: number;
  passed: number;
}

let mockCourseMaterials: CourseMaterial[] | null = null;
export function __setMockCourseMaterials(c: CourseMaterial[]): void {
  mockCourseMaterials = c;
}

// やりかけの章（Zeigarnik効果: 「あと少しで章完了」の提示用）。
// fetchCourseMaterials が取得する batch 応答の章進捗から副産物として抽出（追加リクエストなし）。
export interface NearChapter {
  courseId: number;
  courseTitle: string;
  chapterId: number;
  chapterTitle: string;
  remaining: number; // 章完了まで残り教材数
}
let nearDoneChapters: NearChapter[] = [];
/** 直近の取得で見つかった「あと3教材以内で章完了」の章（残り昇順）。 */
export function getNearDoneChapters(): NearChapter[] {
  return nearDoneChapters;
}

// 短時間の重複呼び出し（カード描画＋日次スナップ＋サイドパネル等）をまとめるための
// 同時実行共有＋短TTLキャッシュ。完了検知は最新値が必要なので fresh:true でバイパスする。
const MAT_TTL_MS = 15_000;
let matCache: { at: number; data: CourseMaterial[] } | null = null;
let matInflight: Promise<CourseMaterial[]> | null = null;

/** 教科(コース)ごとの教材総数/完了数（章は取らない軽量版=2リクエスト）。 */
export async function fetchCourseMaterials(opts?: { fresh?: boolean }): Promise<CourseMaterial[]> {
  if (mockCourseMaterials) return mockCourseMaterials;
  if (!opts?.fresh) {
    if (matCache && Date.now() - matCache.at < MAT_TTL_MS) return matCache.data;
    if (matInflight) return matInflight;
  }
  const p = (async () => {
    const my = await fetchMyCourses();
    const titleById = new Map(my.map((c) => [c.id, c.title]));
    const batch = await fetchCoursesBatch(my.map((c) => c.id));
    const data = batch.map((c) => ({
      id: c.id,
      title: titleById.get(c.id) ?? c.title,
      total: c.progress?.total_materials ?? 0,
      passed: c.progress?.passed_materials ?? 0,
    }));
    // 副産物: やりかけの章（着手済み・あと3教材以内で章完了）を抽出
    nearDoneChapters = batch
      .flatMap((c) =>
        (c.chapters ?? [])
          .filter((ch) => ch.progress && ch.progress.total_count > 0 && ch.progress.passed_count > 0)
          .map((ch) => ({
            courseId: c.id,
            courseTitle: titleById.get(c.id) ?? c.title,
            chapterId: ch.id,
            chapterTitle: ch.title,
            remaining: Math.max(0, ch.progress!.total_count - ch.progress!.passed_count),
          }))
      )
      .filter((x) => x.remaining > 0 && x.remaining <= 3)
      .sort((a, b) => a.remaining - b.remaining)
      .slice(0, 5);
    matCache = { at: Date.now(), data };
    return data;
  })();
  matInflight = p;
  try {
    return await p;
  } finally {
    if (matInflight === p) matInflight = null;
  }
}

/** 教材消化の総数/完了数（コース横断）。 */
export async function fetchMaterialTotals(opts?: { fresh?: boolean }): Promise<{ total: number; passed: number }> {
  const courses = await fetchCourseMaterials(opts);
  return {
    total: courses.reduce((a, c) => a + c.total, 0),
    passed: courses.reduce((a, c) => a + c.passed, 0),
  };
}

// 必修（basic サービス＝卒業カリキュラム）のコースID集合。学年進行で毎回更新されるため短TTL。
// type:"advanced"（大学受験など選択）は basic 一覧に載らない＝この集合に含まれない。
let requiredIdsCache: { at: number; ids: Set<number> } | null = null;
export async function getRequiredCourseIds(): Promise<Set<number>> {
  if (requiredIdsCache && Date.now() - requiredIdsCache.at < 60_000) return requiredIdsCache.ids;
  const my = await fetchMyCourses();
  const ids = new Set(my.map((c) => c.id));
  requiredIdsCache = { at: Date.now(), ids };
  return ids;
}

/** 受講中コース（id + フルタイトル）。 */
export async function fetchMyCourses(): Promise<MyCourse[]> {
  const j = await getJSON<{ services?: { courses?: MyCourse[] }[] }>(
    '/v3/dashboard/my_courses?service=basic&limit=50&offset=0'
  );
  const courses = j?.services?.[0]?.courses ?? [];
  return courses.map((c) => ({ id: c.id, title: c.title }));
}

// 必修以外（選択科目・講座・大学連携＝type:"advanced"）。締切の概念が無い自己ペース学習。
// 【データモデル・2026-07-18 本家UIと突合して確定】必修(n_school)の total_materials とは別軸:
//   理解度 = comprehension（教材の閲覧進捗・(good+perfect)/limit）… 本家「課外授業」の「理解度%」
//   習熟度テスト = my_courses の total_count/passed_count … 本家「習熟度テスト N/M」（旧実装が章数と誤認した値）
//   checkpoint = 各教材のチェックポイント（補助軸）
// CourseMaterial の total/passed には理解度（閲覧進捗）を入れ、習熟度テストは testTotal/testPassed に併記。
export interface ElectiveCourse extends CourseMaterial {
  compLimit: number; // 理解度の分母（閲覧対象の教材数＝動画/ガイド/授業）
  compDone: number; // 閲覧済み（good+perfect）
  testTotal: number; // 習熟度テスト 総数
  testPassed: number; // 習熟度テスト 合格数
}
let electiveCache: { at: number; data: ElectiveCourse[] } | null = null;

/** 必修以外コースの進捗（理解度＝comprehension＋習熟度テスト＝total_count）。学習実体のあるコースのみ。 */
export async function fetchElectiveCourses(opts?: { fresh?: boolean }): Promise<ElectiveCourse[]> {
  if (!opts?.fresh && electiveCache && Date.now() - electiveCache.at < MAT_TTL_MS) return electiveCache.data;
  const my = await getJSON<{ services?: { courses?: { id: number; title: string; progress?: { total_count?: number; passed_count?: number } }[] }[] }>(
    '/v3/dashboard/my_courses?service=advanced&limit=50&offset=0'
  );
  const list = my?.services?.[0]?.courses ?? [];
  if (!list.length) {
    electiveCache = { at: Date.now(), data: [] };
    return [];
  }
  const meta = new Map(list.map((c) => [c.id, { title: c.title, testTotal: c.progress?.total_count ?? 0, testPassed: c.progress?.passed_count ?? 0 }]));
  // batch で comprehension（理解度）を取得（advanced の progress は comprehension/checkpoint）
  const qs = 'mode=batch' + list.map((c) => `&ids[]=${c.id}`).join('');
  const b = await getJSON<{ courses?: { id: number; progress?: { comprehension?: { limit?: number; good?: number; perfect?: number } } }[] }>(`/v2/material/courses?${qs}`);
  const compById = new Map((b?.courses ?? []).map((c) => [c.id, c.progress?.comprehension]));
  const data: ElectiveCourse[] = list
    .map((c) => {
      const m = meta.get(c.id)!;
      const comp = compById.get(c.id);
      const compLimit = comp?.limit ?? 0;
      const compDone = (comp?.good ?? 0) + (comp?.perfect ?? 0);
      return { id: c.id, title: m.title, total: compLimit, passed: compDone, compLimit, compDone, testTotal: m.testTotal, testPassed: m.testPassed };
    })
    .filter((c) => c.compLimit > 0 || c.testTotal > 0); // 学習実体（理解度 or 習熟度テスト）のあるコースのみ
  electiveCache = { at: Date.now(), data };
  return data;
}

/** 複数コースの progress + chapters を1リクエストで。 */
export async function fetchCoursesBatch(ids: number[]): Promise<CourseBatch[]> {
  if (!ids.length) return [];
  const qs = 'mode=batch' + ids.map((id) => `&ids[]=${id}`).join('');
  const j = await getJSON<{ courses?: CourseBatch[] }>(`/v2/material/courses?${qs}`);
  const arr = j?.courses ?? (j as unknown as CourseBatch[]) ?? [];
  return (arr as CourseBatch[]).map((c) => ({
    id: c.id,
    title: c.title,
    progress: c.progress,
    chapters: (c.chapters ?? []).map((ch) => ({ id: ch.id, title: ch.title, progress: ch.progress })),
  }));
}

export interface RemainingWork {
  movieSeconds: number;
  movieCount: number;
  testCount: number;
  reportCount: number;
}

function tallyRemaining(sections: Section[]): RemainingWork {
  const r: RemainingWork = { movieSeconds: 0, movieCount: 0, testCount: 0, reportCount: 0 };
  for (const s of sections) {
    if (isSupplement(s)) continue; // 視聴任意は本家の進捗対象外 → 「残り」に数えない
    if (s.passed) continue; // 未完了のみ＝「あと」の分量
    if (s.resource_type === 'movie') {
      r.movieSeconds += s.length ?? 0;
      r.movieCount++;
    } else if (s.resource_type === 'evaluation_test' || s.resource_type === 'essay_test') {
      r.testCount++;
    } else if (s.resource_type === 'evaluation_report' || s.resource_type === 'essay_report') {
      r.reportCount++;
    }
  }
  return r;
}

/** コースの残り（未完了）作業量。全章の sections をバッチ取得して集計。 */
export async function fetchCourseRemaining(courseId: number): Promise<RemainingWork> {
  // 単体コース ⑤ は {course:{chapters}} とネスト（batch版とは形が違う）
  const j = await getJSON<{ course?: { chapters?: { id: number }[] }; chapters?: { id: number }[] }>(
    `/v2/material/courses/${courseId}`
  );
  const chapterList = j.course?.chapters ?? j.chapters ?? [];
  const chIds = chapterList.map((c) => c.id).filter((x) => x != null);
  const withSections = await fetchCourseChapters(courseId, chIds);
  const all: Section[] = withSections.flatMap((c) => c.sections);
  return tallyRemaining(all);
}

/** 章内の特定教材の問題数（所要時間実測の正規化用）。見つからなければ null。 */
export async function fetchSectionQuestions(courseId: number, chapterId: number, sectionId: number): Promise<number | null> {
  const j = await getJSON<{ chapter?: { sections?: (Section & { id?: number })[] } }>(
    `/v2/material/courses/${courseId}/chapters/${chapterId}`
  );
  const sec = (j.chapter?.sections ?? []).find((s) => (s as { id?: number }).id === sectionId);
  return sec?.total_question ?? null;
}

/** 1章の残り（未完了）作業量。 */
export async function fetchChapterRemaining(courseId: number, chapterId: number): Promise<RemainingWork> {
  const j = await getJSON<{ chapter?: { sections?: Section[] } }>(
    `/v2/material/courses/${courseId}/chapters/${chapterId}`
  );
  return tallyRemaining(j.chapter?.sections ?? []);
}

// 1リクエストあたりの章数上限。章数の多いコース（例: 大学受験の27章）で
// クエリ文字列が長くなりすぎ、サーバが 4xx/5xx を返す（→ 呼び出し側で失敗ループ）のを防ぐ。
const CHAPTERS_PER_BATCH = 8;

async function fetchChapterBatch(courseId: number, chapterIds: number[]): Promise<ChapterSections[]> {
  const qs = chapterIds
    .map((id) => `queries[][course_id]=${courseId}&queries[][chapter_id]=${id}`)
    .join('&');
  const j = await getJSON<{ chapters?: ChapterSections[] }>(`/v2/material/chapters?${qs}`);
  const arr = j?.chapters ?? (j as unknown as ChapterSections[]) ?? [];
  return (arr as ChapterSections[]).map((ch) => ({
    id: ch.id,
    sections: (ch.sections ?? []).map((s) => ({
      id: s.id,
      resource_type: s.resource_type,
      material_type: s.material_type,
      length: s.length,
      total_question: s.total_question,
      passed: s.passed,
      done: s.done,
    })),
  }));
}

/** 1コースの複数章の sections を取得（⑥）。章数が多い場合は分割して順次取得（URL肥大・レート配慮）。 */
export async function fetchCourseChapters(
  courseId: number,
  chapterIds: number[]
): Promise<ChapterSections[]> {
  if (!chapterIds.length) return [];
  if (chapterIds.length <= CHAPTERS_PER_BATCH) return fetchChapterBatch(courseId, chapterIds);
  const out: ChapterSections[] = [];
  for (let i = 0; i < chapterIds.length; i += CHAPTERS_PER_BATCH) {
    out.push(...(await fetchChapterBatch(courseId, chapterIds.slice(i, i + CHAPTERS_PER_BATCH))));
  }
  return out;
}
