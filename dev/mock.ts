// プレビュー/デモ共通のモックデータ。実データは通さず、これを実際の描画コードに流す。
import type { LearningAmounts } from '../src/api';
import { __setMockHistory, __setMockMaterialHist, __setMockHour, type History } from '../src/history';
import { __setMockVolumes } from '../src/courseStats';
import { __setMockCourseMaterials } from '../src/courseApi';
import { __setMockReport, __setMockLearning } from '../src/api';

const met = (ms: number, mc: number, t: number, r: number) => ({ movieSeconds: ms, movieCount: mc, testCount: t, reportCount: r });

// モック履歴（約50日）を注入して カレンダー/トレンド/ストリーク を埋める
function mockHistory(): History {
  const h: History = {};
  const today = new Date();
  for (let i = 49; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const p = (n: number) => String(n).padStart(2, '0');
    const iso = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const wd = d.getDay();
    if (i % 11 === 3) continue; // 欠損日
    const base = wd === 0 || wd === 6 ? 8 : 22;
    h[iso] = Math.max(0, Math.round(base + Math.sin(i / 3) * 12 + (i % 7) * 2 - 6));
  }
  return h;
}

/** 全モックを注入し、直近14日の学習数サンプルを返す。 */
export function installMocks(): LearningAmounts {
  // 教科別 教材（合計1500・完了320・未着手2教科）
  __setMockCourseMaterials([
    { id: 1, title: 'サンプル英語', total: 400, passed: 250 },
    { id: 2, title: 'サンプル数学', total: 350, passed: 60 },
    { id: 3, title: 'サンプル理科', total: 300, passed: 10 },
    { id: 4, title: 'サンプル情報', total: 250, passed: 0 },
    { id: 5, title: 'サンプル国語', total: 200, passed: 0 },
  ]);

  // 初回想定: 教材履歴はまだ空（total=1500だけ既知）
  __setMockMaterialHist({}, 1500);

  // レポート完了予測のモック（合計50・完了20・残30、締切12/15）
  __setMockReport({
    finalDeadline: '2026-12-15T23:59:59+09:00',
    months: [
      { year: 2026, month: 6, deadline: '2026-06-15T23:59:59+09:00', total: 6, passed: 6 },
      { year: 2026, month: 7, deadline: '2026-07-15T23:59:59+09:00', total: 7, passed: 5 },
      { year: 2026, month: 8, deadline: '2026-08-15T23:59:59+09:00', total: 10, passed: 4 },
      { year: 2026, month: 9, deadline: '2026-09-15T23:59:59+09:00', total: 5, passed: 2 },
      { year: 2026, month: 10, deadline: '2026-10-15T23:59:59+09:00', total: 8, passed: 2 },
      { year: 2026, month: 11, deadline: '2026-11-15T23:59:59+09:00', total: 8, passed: 1 },
      { year: 2026, month: 12, deadline: '2026-12-15T23:59:59+09:00', total: 6, passed: 0 },
    ],
    totalReports: 50,
    passedReports: 20,
    requiredCourseCount: 9,
    takingCourseCount: 11,
  });

  // コースボリューム（動画時間/テスト/レポートの残/総・教科別シェアの確認用）
  __setMockVolumes([
    { id: 1, title: 'サンプル英語', total: met(41876, 163, 72, 24), remaining: met(17932, 64, 24, 8), totalMaterials: 400, passedMaterials: 250, totalChapters: 12, passedChapters: 7,
      chapters: [
        { id: 1, title: '第1回　導入', total: met(1200, 8, 6, 2), remaining: met(0, 0, 0, 0), passed: 19, totalCount: 19 },
        { id: 2, title: '第7回　応用', total: met(3067, 13, 6, 2), remaining: met(1400, 6, 3, 1), passed: 15, totalCount: 21 },
      ] },
    { id: 2, title: 'サンプル数学', total: met(28800, 120, 60, 20), remaining: met(24000, 100, 50, 17), totalMaterials: 350, passedMaterials: 60, totalChapters: 9, passedChapters: 1,
      chapters: [{ id: 3, title: '第1回　基礎', total: met(2400, 10, 6, 2), remaining: met(2000, 8, 5, 2), passed: 2, totalCount: 24 }] },
    { id: 4, title: 'サンプル情報', total: met(18000, 80, 40, 12), remaining: met(18000, 80, 40, 12), totalMaterials: 250, passedMaterials: 0, totalChapters: 4, passedChapters: 0,
      chapters: [{ id: 4, title: '第1回　はじめに', total: met(3100, 13, 6, 2), remaining: met(3100, 13, 6, 2), passed: 0, totalCount: 21 }] },
  ]);

  __setMockHistory(mockHistory());

  // 時間帯モック（夜型: 20〜22時に学習ピーク）
  const hs = new Array(24).fill(0);
  const hv = new Array(24).fill(0);
  ([[20, 40], [21, 55], [22, 30], [16, 12], [8, 6], [12, 8]] as [number, number][]).forEach(([hh, n]) => { hs[hh] = n; hv[hh] = Math.round(n / 8) + 1; });
  __setMockHour(hs, hv);

  const sample: LearningAmounts = {
    total_amount: 230,
    average_amount: 20.9,
    daily_amount: [
      { date: '2026-07-04', amount: null },
      { date: '2026-07-05', amount: null },
      { date: '2026-07-06', amount: 18 },
      { date: '2026-07-07', amount: 6 },
      { date: '2026-07-08', amount: 4 },
      { date: '2026-07-09', amount: 0 },
      { date: '2026-07-10', amount: 23 },
      { date: '2026-07-11', amount: 26 },
      { date: '2026-07-12', amount: 16 },
      { date: '2026-07-13', amount: 38 },
      { date: '2026-07-14', amount: 21 },
      { date: '2026-07-15', amount: 46 },
      { date: '2026-07-16', amount: 28 },
      { date: '2026-07-17', amount: 4 },
    ],
  };
  __setMockLearning(sample);
  return sample;
}
