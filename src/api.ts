// ZEN Study API ラッパー。
// 【第一原則】GET のみ。状態変更(POST/PUT/PATCH/DELETE)は絶対に呼ばない。
// このファイルには GET 以外のメソッドを書かないこと。
import { getJSON } from './http';

export interface DailyAmount {
  date: string; // "YYYY-MM-DD"
  amount: number | null; // null = 記録なし(受講前など)
}

export interface LearningAmounts {
  total_amount: number; // 累計
  average_amount: number; // 直近2週平均
  daily_amount: DailyAmount[]; // 直近14日
}

let mockLearning: LearningAmounts | null = null;
/** プレビュー/テスト用。 */
export function __setMockLearning(d: LearningAmounts): void {
  mockLearning = d;
}
/** 学習数（累計 / 2週平均 / 直近14日の日別）。 */
export function fetchLearningAmounts(): Promise<LearningAmounts> {
  if (mockLearning) return Promise.resolve(mockLearning);
  return getJSON<LearningAmounts>('/v2/learning_amounts');
}

// --- レポート進捗（年度レポート完了予測の元データ） ---
export interface MonthlyReport {
  year: number;
  month: number;
  deadline: string; // ISO（その月15日）
  total: number; // その月のレポート(章)総数
  passed: number; // 完了数
}
export interface ReportProgress {
  finalDeadline: string; // 年度末締切（12/15）
  months: MonthlyReport[];
  totalReports: number;
  passedReports: number;
  requiredCourseCount: number; // 必修コース数
  takingCourseCount: number; // 履修中コース数（>必修 なら非必修も履修＝学習数に混ざる）
}

interface RawReportProgress {
  alert: { last_report_deadline_at: string; required_course_count: number; taking_course_count: number };
  monthly_summaries: {
    year: number;
    month: number;
    earliest_report_deadline: string;
    total_chapter_count: number;
    passed_chapter_count: number;
  }[];
}

let mockReport: ReportProgress | null = null;
/** プレビュー/テスト用。 */
export function __setMockReport(r: ReportProgress): void {
  mockReport = r;
}

// --- 月別レポート（締切別の章内訳・免除フラグ）。/my_course・study_plans の裏で使われるAPI ---
export interface MonthlyReportChapter {
  course_id: number;
  chapter_id: number;
  course_title: string;
  chapter_title: string;
  subject_category_title: string;
  passed_count: number;
  total_count: number;
  exempted: boolean;
}
export interface MonthlyReportDetail {
  year: number;
  month: number;
  total_material_count: number;
  passed_material_count: number;
  total_chapter_count: number;
  passed_chapter_count: number;
  deadline_groups: { deadline: string; chapters: MonthlyReportChapter[] }[];
  completed_chapters: MonthlyReportChapter[];
}

/** その月の締切別・章別レポート進捗（免除フラグ付き）。 */
export function fetchMonthlyReport(year: number, month: number): Promise<MonthlyReportDetail> {
  return getJSON<MonthlyReportDetail>(`/v2/dashboard/report_progresses/monthly/${year}/${month}`);
}

/** レポート進捗（月別の締切・総数・完了数、年度末締切）。
 *  【正規化の前提（API仕様依存・2026-07 実データで確認した範囲）】
 *  - monthly_summaries はサーバ側で月に分割済みで、章は月間で重複しない（各月「第N回」の別章）。
 *    → totalReports/passedReports は単純合算で年度総数になる、という前提。
 *  - total_chapter_count は免除(exempted)章も含みうる（免除章を持つアカウントでの検証は未了）。
 *  - 年度境界: monthly_summaries は当年度ぶんのみ返る想定（year フィールドを保持しているので
 *    仮に複数年度が混ざっても deadlines.ts 側は締切日でソートし月キーは year-month で扱う）。
 *  前提が崩れる兆候（合算＞年度総数など）を見たら、monthly 詳細API の章ID集合で照合すること。 */
export async function fetchReportProgresses(): Promise<ReportProgress> {
  if (mockReport) return mockReport;
  const j = await getJSON<RawReportProgress>('/v2/dashboard/report_progresses?service=basic');
  const months: MonthlyReport[] = (j.monthly_summaries ?? []).map((m) => ({
    year: m.year,
    month: m.month,
    deadline: m.earliest_report_deadline,
    total: m.total_chapter_count,
    passed: m.passed_chapter_count,
  }));
  // 締切は「必修レポートの最終提出期限」。alert優先、無ければ月次の最遅締切から逆算。
  const lastMonthly = months.reduce<string | null>(
    (acc, m) => (m.deadline && (!acc || m.deadline > acc) ? m.deadline : acc),
    null
  );
  const finalDeadline = j.alert?.last_report_deadline_at ?? lastMonthly ?? '';
  return {
    finalDeadline,
    months,
    totalReports: months.reduce((a, m) => a + m.total, 0),
    passedReports: months.reduce((a, m) => a + m.passed, 0),
    requiredCourseCount: j.alert?.required_course_count ?? 0,
    takingCourseCount: j.alert?.taking_course_count ?? 0,
  };
}
