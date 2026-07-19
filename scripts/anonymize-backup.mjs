// 実データのバックアップJSONを匿名化してデモ用モックを生成する。
// 【著作権配慮】教材の章タイトル（例「第1回 【Lesson 1】…」）と出版社名/固有の課程名は著作物なので除去。
//   教科名は一般名（英語/数学III/物理 等・共通名詞）に短縮し、章は「第N回」の連番だけ残す。
// 点数・日時・ID・進捗の数値はユーザーの明示同意により実値のまま（デモの忠実性のため）。
// 使い方: node scripts/anonymize-backup.mjs "<backup.json>" > dev/demoData.json
import { readFileSync } from 'node:fs';

const src = process.argv[2];
if (!src) { console.error('usage: node scripts/anonymize-backup.mjs <backup.json>'); process.exit(1); }
const backup = JSON.parse(readFileSync(src, 'utf8'));
const d = backup.data;

// 教科名の匿名化（courseId → 一般名）。出版社名・固有の課程名を落とす。
const COURSE_ALIAS = {
  2537: '英語', 2543: '英語表現', 2497: '数学C', 2491: '数学III', 2663: '探究',
  2503: '物理', 2678: '特別活動', 2551: '情報II', 2519: '体育',
};
const aliasOf = (id) => COURSE_ALIAS[id] ?? `教科${id}`;
// 章タイトル → 先頭の「第N回」だけ残す（著作物の講義名を除去）。無ければ連番。
const anonChapter = (title, idx) => {
  const m = String(title ?? '').match(/^第\s*[0-9０-９]+\s*回/);
  return m ? m[0].replace(/\s+/g, '') : `第${idx + 1}回`;
};

const vol = (d['zss:courseVol']?.data ?? []).map((c) => ({
  id: c.id,
  title: aliasOf(c.id),
  totalMaterials: c.totalMaterials,
  passedMaterials: c.passedMaterials,
  totalChapters: c.totalChapters,
  passedChapters: c.passedChapters,
  movieSeconds: c.movieSeconds,
  movieCount: c.movieCount,
  testCount: c.testCount,
  reportCount: c.reportCount,
  chapters: (c.chapters ?? []).map((ch, i) => ({
    id: ch.id, title: anonChapter(ch.title, i),
    total: ch.total, passed: ch.passed,
    movieSeconds: ch.movieSeconds, movieCount: ch.movieCount, testCount: ch.testCount, reportCount: ch.reportCount,
  })),
}));

// 現在の完了数は coursePassedHist の最新日（courseVol.passed は古いキャッシュのことがある）。
const cph = d['zss:coursePassedHist'] ?? {};
const cphDates = Object.keys(cph).sort();
const latestCph = cphDates.length ? cph[cphDates[cphDates.length - 1]] : {};
const courses = vol.map((c) => ({
  id: c.id, title: c.title, total: c.totalMaterials,
  passed: latestCph[c.id] ?? latestCph[String(c.id)] ?? c.passedMaterials,
}));

// resultLog はタイトルを持たない（ID＋数値のみ）→ そのまま。
const resultLog = d['zss:resultLog'] ?? {};

const out = {
  _note: '匿名化デモデータ。教科名は一般名・章は第N回に置換（著作物の講義名を除去）。点数/日時/IDは実値。',
  courses,
  courseVol: vol,
  materialHist: d['zss:materialHist'] ?? {},
  materialTotalHist: d['zss:materialTotalHist'] ?? {},
  materialTotal: d['zss:materialTotal'] ?? 0,
  coursePassedHist: d['zss:coursePassedHist'] ?? {},
  electivePassedHist: d['zss:electivePassedHist'] ?? {},
  resultLog,
  history: d['zss:history'] ?? {},
  hourStats: d['zss:hourStats'] ?? {},
  reportHist: d['zss:reportHist'] ?? {},
  workTime: d['zss:workTime'] ?? {},
};
process.stdout.write(JSON.stringify(out, null, 2));
