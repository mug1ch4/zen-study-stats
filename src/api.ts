// ZEN Study API ラッパー。
// 【第一原則】GET のみ。状態変更(POST/PUT/PATCH/DELETE)は絶対に呼ばない。
// このファイルには GET 以外のメソッドを書かないこと。

const API_BASE = 'https://api.nnn.ed.nico';

export interface DailyAmount {
  date: string; // "YYYY-MM-DD"
  amount: number | null; // null = 記録なし(受講前など)
}

export interface LearningAmounts {
  total_amount: number; // 累計
  average_amount: number; // 直近2週平均
  daily_amount: DailyAmount[]; // 直近14日
}

/** GET専用の薄いラッパー。credentials:'include' でログインCookieを送る。 */
async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}

/** 学習数（累計 / 2週平均 / 直近14日の日別）。 */
export function fetchLearningAmounts(): Promise<LearningAmounts> {
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

/** レポート進捗（月別の締切・総数・完了数、年度末締切）。 */
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
