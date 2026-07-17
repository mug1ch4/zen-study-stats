// 実績バッジ（アチーブメント）。実データに基づく達成だけを解除する（誇張なし・honest）。
// XP/リーグ等の比較・変動報酬系は意図的に不採用（個人用・ダークパターン回避）。

export interface AchInput {
  longestStreak: number; // 最長連続学習日数
  studiedDays: number; // 学習した日の累計（記録範囲内）
  passedMaterials: number;
  totalMaterials: number;
  completedCourses: number;
  totalCourses: number;
}

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  cond: (x: AchInput) => boolean;
}

const pct = (x: AchInput): number => (x.totalMaterials > 0 ? (x.passedMaterials / x.totalMaterials) * 100 : 0);

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'streak3', title: '3日連続', desc: '3日連続で学習', cond: (x) => x.longestStreak >= 3 },
  { id: 'streak7', title: '1週間連続', desc: '7日連続で学習', cond: (x) => x.longestStreak >= 7 },
  { id: 'streak14', title: '2週間連続', desc: '14日連続で学習', cond: (x) => x.longestStreak >= 14 },
  { id: 'streak30', title: '1ヶ月連続', desc: '30日連続で学習', cond: (x) => x.longestStreak >= 30 },
  { id: 'streak60', title: '2ヶ月連続', desc: '60日連続で学習', cond: (x) => x.longestStreak >= 60 },
  { id: 'mat50', title: '教材50', desc: '教材を50完了', cond: (x) => x.passedMaterials >= 50 },
  { id: 'mat100', title: '教材100', desc: '教材を100完了', cond: (x) => x.passedMaterials >= 100 },
  { id: 'mat300', title: '教材300', desc: '教材を300完了', cond: (x) => x.passedMaterials >= 300 },
  { id: 'mat500', title: '教材500', desc: '教材を500完了', cond: (x) => x.passedMaterials >= 500 },
  { id: 'mat1000', title: '教材1000', desc: '教材を1000完了', cond: (x) => x.passedMaterials >= 1000 },
  { id: 'pct25', title: '全体25%', desc: '年度教材の25%を消化', cond: (x) => pct(x) >= 25 },
  { id: 'pct50', title: '折り返し', desc: '年度教材の50%を消化', cond: (x) => pct(x) >= 50 },
  { id: 'pct75', title: '全体75%', desc: '年度教材の75%を消化', cond: (x) => pct(x) >= 75 },
  { id: 'pct100', title: '完走', desc: '年度教材をすべて消化', cond: (x) => x.totalMaterials > 0 && x.passedMaterials >= x.totalMaterials },
  { id: 'course1', title: '1教科完了', desc: 'いずれかの教科を完了', cond: (x) => x.completedCourses >= 1 },
  { id: 'course3', title: '3教科完了', desc: '3教科を完了', cond: (x) => x.completedCourses >= 3 },
  { id: 'courseAll', title: '全教科完了', desc: '全教科を完了', cond: (x) => x.totalCourses > 0 && x.completedCourses >= x.totalCourses },
  { id: 'days30', title: '学習30日', desc: '累計30日学習（記録範囲）', cond: (x) => x.studiedDays >= 30 },
  { id: 'days100', title: '学習100日', desc: '累計100日学習（記録範囲）', cond: (x) => x.studiedDays >= 100 },
];

/** 現在のデータで達成済みの実績IDを返す。 */
export function computeUnlocked(input: AchInput): string[] {
  return ACHIEVEMENTS.filter((a) => a.cond(input)).map((a) => a.id);
}
