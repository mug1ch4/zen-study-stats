// プレビュー/デモ共通のモックデータ。実データは通さず、これを実際の描画コードに流す。
// 【出典】dev/demoData.json = 実バックアップを匿名化したもの（scripts/anonymize-backup.mjs）。
//   教科名は一般名・章は「第N回」に置換（著作物の講義名/出版社名を除去）。点数/日時/IDは実値。
import type { LearningAmounts } from '../src/api';
import { __setMockHistory, __setMockMaterialHist, __setMockHour, type History } from '../src/history';
import { __setMockVolumes } from '../src/courseStats';
import { __setMockCourseMaterials } from '../src/courseApi';
import { __setMockReport, __setMockLearning } from '../src/api';
import { __setMockResultLog, __setMockChapterSkels, type ResultEntry } from '../src/resultLog';
import { __setMockStudyTime } from '../src/studyTime';
import { __setMockNow } from '../src/format';
import type { ChapterSkels } from '../src/movieInterp';
import demo from './demoData.json';

const met = (ms: number, mc: number, t: number, r: number) => ({
  movieSeconds: ms, movieCount: mc, testCount: t, reportCount: r,
  testQuestions: t * 2, reportQuestions: r * 10,
});

/** demoData の日別学習数(history)から直近14日の LearningAmounts を組む。 */
function learningFromHistory(hist: History): LearningAmounts {
  const dates = Object.keys(hist).sort();
  const last14 = dates.slice(-14);
  const daily = last14.map((date) => ({ date, amount: hist[date] as number | null }));
  const total = dates.reduce((a, d) => a + (hist[d] || 0), 0);
  const recent = last14.map((d) => hist[d] || 0);
  const avg = recent.length ? Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10 : 0;
  return { total_amount: total, average_amount: avg, daily_amount: daily };
}

/** 全モックを注入し、直近14日の学習数サンプルを返す。 */
export function installMocks(): LearningAmounts {
  // デモの「現在」をデータ採取時刻に固定（静的データの今日が実時間で進み
  // 「最終記録日以降ずっと活動ゼロ」でペース・予測が日ごとに劣化するのを防ぐ）。
  const now = (demo as { now?: string | null }).now;
  if (now) __setMockNow(Date.parse(now));
  // 教科別 教材（実データ：合計1220・現在完了255・匿名化タイトル）
  __setMockCourseMaterials(demo.courses.map((c) => ({ id: c.id, title: c.title, total: c.total, passed: c.passed })));

  // 教材消化(passed_materials)の日次履歴（実データ・薄い＝2日）。総数は materialTotal。
  __setMockMaterialHist(demo.materialHist as History, demo.materialTotal);

  // 受験アンカー（実データ）。buildRequiredSeries がこれで過去を復元する。
  __setMockResultLog(Object.values(demo.resultLog) as ResultEntry[]);
  // 章スケルトン（実データ・ID/種別/秒数のみ）。無いと動画補間アンカーが0件になり
  // 日次サンプルが「テスト受験数のみ」で実際の消化ペースを大幅過小評価する。
  __setMockChapterSkels(((demo as { chapterSkels?: ChapterSkels }).chapterSkels ?? {}) as ChapterSkels);

  // レポート完了予測（締切構造は実運用に近い合成。教材総数は実データ1220に合わせる）。
  __setMockReport({
    finalDeadline: '2026-12-15T23:59:59+09:00',
    months: [
      { year: 2026, month: 6, deadline: '2026-06-15T23:59:59+09:00', total: 6, passed: 1 },
      { year: 2026, month: 7, deadline: '2026-07-15T23:59:59+09:00', total: 7, passed: 2 },
      { year: 2026, month: 8, deadline: '2026-08-15T23:59:59+09:00', total: 10, passed: 2 },
      { year: 2026, month: 9, deadline: '2026-09-15T23:59:59+09:00', total: 5, passed: 0 },
      { year: 2026, month: 10, deadline: '2026-10-15T23:59:59+09:00', total: 8, passed: 0 },
      { year: 2026, month: 11, deadline: '2026-11-15T23:59:59+09:00', total: 8, passed: 0 },
      { year: 2026, month: 12, deadline: '2026-12-15T23:59:59+09:00', total: 6, passed: 0 },
    ],
    totalReports: 50,
    passedReports: 7,
    requiredCourseCount: 9,
    takingCourseCount: 15,
  });

  // コースボリューム（教科タブの詳細グラフ用・匿名化タイトル）
  const supp = (ms: number, mc: number) => ({ total: met(ms, mc, 0, 0), remaining: met(ms, mc, 0, 0) });
  __setMockVolumes(
    demo.courseVol.map((c) => {
      const remMovie = Math.max(0, c.movieSeconds - Math.round((c.movieSeconds * c.passedMaterials) / Math.max(1, c.totalMaterials)));
      return {
        id: c.id, title: c.title,
        total: met(c.movieSeconds, c.movieCount, c.testCount, c.reportCount),
        remaining: met(remMovie, Math.round((c.movieCount * (c.totalMaterials - c.passedMaterials)) / Math.max(1, c.totalMaterials)), 0, 0),
        supp: supp(0, 0),
        totalMaterials: c.totalMaterials, passedMaterials: c.passedMaterials,
        totalChapters: c.totalChapters, passedChapters: c.passedChapters,
        chapters: c.chapters.map((ch) => ({
          id: ch.id, title: ch.title,
          total: met(ch.movieSeconds, ch.movieCount, ch.testCount, ch.reportCount),
          remaining: met(0, 0, 0, 0), passed: ch.passed, totalCount: ch.total,
        })),
      };
    })
  );

  // 日別学習数（実データ）→ カレンダー/トレンド/ストリーク
  __setMockHistory(demo.history as History);

  // 学習時間（デモ用の概算: 学習数×3分。実運用はアクティブタイム実測が貯まる）
  __setMockStudyTime(Object.fromEntries(Object.entries(demo.history as History).map(([d, n]) => [d, (n as number) * 180])));

  // 時間帯（実データ）
  const hstat = demo.hourStats as { study?: number[]; visit?: number[] };
  __setMockHour(hstat.study ?? new Array(24).fill(0), hstat.visit ?? new Array(24).fill(0));

  const sample = learningFromHistory(demo.history as History);
  __setMockLearning(sample);
  return sample;
}
