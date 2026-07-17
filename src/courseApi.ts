// コース/章のバッチ取得（GET専用）。動画合計時間・テスト/レポート数の集計に使う。
// 【第一原則】GETのみ・read-only。
const API_BASE = 'https://api.nnn.ed.nico';

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

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
  resource_type: string; // movie / evaluation_test / essay_test / evaluation_report / essay_report
  material_type?: string; // "main"=必須教材 / "supplement"=視聴任意（本家の進捗カウント対象外）
  length?: number; // movie の秒数
  total_question?: number; // test の問題数
  passed: boolean;
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

/** 教科(コース)ごとの教材総数/完了数（章は取らない軽量版=2リクエスト）。 */
export async function fetchCourseMaterials(): Promise<CourseMaterial[]> {
  if (mockCourseMaterials) return mockCourseMaterials;
  const my = await fetchMyCourses();
  const titleById = new Map(my.map((c) => [c.id, c.title]));
  const batch = await fetchCoursesBatch(my.map((c) => c.id));
  return batch.map((c) => ({
    id: c.id,
    title: titleById.get(c.id) ?? c.title,
    total: c.progress?.total_materials ?? 0,
    passed: c.progress?.passed_materials ?? 0,
  }));
}

/** 教材消化の総数/完了数（コース横断）。 */
export async function fetchMaterialTotals(): Promise<{ total: number; passed: number }> {
  const courses = await fetchCourseMaterials();
  return {
    total: courses.reduce((a, c) => a + c.total, 0),
    passed: courses.reduce((a, c) => a + c.passed, 0),
  };
}

/** 受講中コース（id + フルタイトル）。 */
export async function fetchMyCourses(): Promise<MyCourse[]> {
  const j = await getJSON<{ services?: { courses?: MyCourse[] }[] }>(
    '/v3/dashboard/my_courses?service=basic&limit=50&offset=0'
  );
  const courses = j?.services?.[0]?.courses ?? [];
  return courses.map((c) => ({ id: c.id, title: c.title }));
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

/** 1章の残り（未完了）作業量。 */
export async function fetchChapterRemaining(courseId: number, chapterId: number): Promise<RemainingWork> {
  const j = await getJSON<{ chapter?: { sections?: Section[] } }>(
    `/v2/material/courses/${courseId}/chapters/${chapterId}`
  );
  return tallyRemaining(j.chapter?.sections ?? []);
}

/** 1コースの複数章の sections を1リクエストで（⑥のバッチ版）。 */
export async function fetchCourseChapters(
  courseId: number,
  chapterIds: number[]
): Promise<ChapterSections[]> {
  if (!chapterIds.length) return [];
  const qs = chapterIds
    .map((id) => `queries[][course_id]=${courseId}&queries[][chapter_id]=${id}`)
    .join('&');
  const j = await getJSON<{ chapters?: ChapterSections[] }>(`/v2/material/chapters?${qs}`);
  const arr = j?.chapters ?? (j as unknown as ChapterSections[]) ?? [];
  return (arr as ChapterSections[]).map((ch) => ({
    id: ch.id,
    sections: (ch.sections ?? []).map((s) => ({
      resource_type: s.resource_type,
      material_type: s.material_type,
      length: s.length,
      total_question: s.total_question,
      passed: s.passed,
    })),
  }));
}
