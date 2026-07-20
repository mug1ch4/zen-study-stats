import { describe, it, expect } from 'vitest';
import { avgWorkMinutes, estimateDailyStudySeconds, estimateHourlyStudySeconds, calibrateSecPerLA, secPerMaterialByCourse, estimateDailyByCourseDelta, buildRemainingHoursSeries } from '../src/studyTimeEst';
import type { ResultEntry } from '../src/resultLog';
import type { MovieEvent } from '../src/movieInterp';
import type { WorkTimes } from '../src/history';

// JST 2026-07-15 の h時0分 の epoch秒
const at = (h: number) => Date.UTC(2026, 6, 15, h - 9) / 1000;

const entry = (over: Partial<ResultEntry>): ResultEntry =>
  ({ sectionId: 1, chapterId: 1, courseId: 2503, kind: 'test', passed: true, score: 80, totalScore: 100, firstAt: at(10), firstPassed: true, firstScore: 80, latestAt: at(10), ...over }) as ResultEntry;

const wt: WorkTimes = {
  '2503': { test: { min: 12, q: 15, n: 3 }, report: { min: 30, q: 40, n: 2 } }, // test 4分/回・report 15分/回
};

describe('avgWorkMinutes', () => {
  it('教科実測: min/n（分/回）', () => {
    expect(avgWorkMinutes(wt, 2503, 'test')).toBeCloseTo(4, 5);
    expect(avgWorkMinutes(wt, 2503, 'report')).toBeCloseTo(15, 5);
  });
  it('教科に実測が無ければ全教科平均・皆無なら既定値', () => {
    expect(avgWorkMinutes(wt, 9999, 'test')).toBeCloseTo(4, 5); // 全教科平均=同値
    expect(avgWorkMinutes({}, 9999, 'test')).toBe(5); // 既定
    expect(avgWorkMinutes({}, 9999, 'report')).toBe(15);
  });
});

describe('estimateDailyStudySeconds', () => {
  it('動画=実尺・受験=平均所要（初回/最新が別時刻なら2回ぶん）を zen-day に集計', () => {
    const entries = [
      entry({ sectionId: 1 }), // 10時 test 1回 = 4分
      entry({ sectionId: 2, firstAt: at(11), latestAt: at(13) }), // 別時刻の再受験 → 2回 = 8分
    ];
    const movies: MovieEvent[] = [{ at: at(12), courseId: 2503, len: 600, uncertaintySec: 0 }];
    const est = estimateDailyStudySeconds(entries, movies, wt);
    expect(est['2026-07-15']).toBeCloseTo(600 + 3 * 4 * 60, 5);
  });
  it('5:00前の受験は前日（zen-day）に帰属', () => {
    const est = estimateDailyStudySeconds([entry({ firstAt: at(3), latestAt: at(3) })], [], wt);
    expect(Object.keys(est)).toEqual(['2026-07-14']);
  });
});

describe('calibrateSecPerLA', () => {
  const TODAY = '2026-07-19';
  const la3 = [
    { date: '2026-07-10', amount: 10 },
    { date: '2026-07-11', amount: 20 },
    { date: '2026-07-12', amount: 10 },
  ];
  it('実測日が3日以上あれば Σ実測/ΣLA を優先（行動の真値）', () => {
    const measured = { '2026-07-10': 3000, '2026-07-11': 6000, '2026-07-12': 3000 };
    expect(calibrateSecPerLA(la3, measured, {}, 999999, TODAY)).toBeCloseTo(300, 5); // 12000/40
  });
  it('実測日が足りなければ 遡及総量/ΣLA（動画実尺は日割り不要の既知量）', () => {
    expect(calibrateSecPerLA(la3, {}, {}, 8000, TODAY)).toBeCloseTo(200, 5); // 8000/40
  });
  it('今日の実測（部分日）は較正から除外', () => {
    const la = [...la3, { date: TODAY, amount: 100 }];
    const measured = { [TODAY]: 60 }; // 今日だけ → 実測較正は成立しない
    expect(calibrateSecPerLA(la, measured, {}, 8000, TODAY)).toBeCloseTo(200, 5); // 分母もΣLA(昨日まで)=40
  });
  it('データ不足なら null・クランプ 60〜600', () => {
    expect(calibrateSecPerLA([{ date: '2026-07-10', amount: 5 }], {}, {}, 0, TODAY)).toBeNull();
    expect(calibrateSecPerLA(la3, {}, {}, 100, TODAY)).toBe(60);
    expect(calibrateSecPerLA(la3, {}, {}, 9999999, TODAY)).toBe(600);
  });
});

describe('secPerMaterialByCourse / estimateDailyByCourseDelta', () => {
  it('教科別の秒/教材で隣接日差分を換算（教材の重さの教科差を反映）', () => {
    // 英語風: 動画60分+テスト0 ÷ 10教材 = 360秒/教材。特別活動風: 動画5分 ÷ 10教材 = 30→clampなし(換算はそのまま)
    const conv = secPerMaterialByCourse(
      [
        { id: 1, totalMaterials: 10, movieSeconds: 3600, testCount: 0, reportCount: 0 },
        { id: 2, totalMaterials: 10, movieSeconds: 300, testCount: 0, reportCount: 0 },
      ],
      {}
    );
    expect(conv.byCourse.get(1)).toBeCloseTo(360, 5);
    expect(conv.byCourse.get(2)).toBeCloseTo(30, 5);
    const est = estimateDailyByCourseDelta(
      {
        '2026-07-18': { '1': 5, '2': 0 },
        '2026-07-19': { '1': 7, '2': 10 }, // 英語+2・特別活動+10
        '2026-07-21': { '1': 9, '2': 10 }, // 7/20が無い＝隣接でない → スキップ
      },
      conv
    );
    expect(est['2026-07-19']).toBeCloseTo(2 * 360 + 10 * 30, 5);
    expect(est['2026-07-21']).toBeUndefined();
  });
  it('未知の教科は全体平均で換算', () => {
    const conv = secPerMaterialByCourse([{ id: 1, totalMaterials: 10, movieSeconds: 3600, testCount: 0, reportCount: 0 }], {});
    const est = estimateDailyByCourseDelta({ '2026-07-18': { '9': 0 }, '2026-07-19': { '9': 2 } }, conv);
    expect(est['2026-07-19']).toBeCloseTo(2 * 360, 5);
  });
});

describe('buildRemainingHoursSeries', () => {
  it('cph日=教科構成で正確・以前=イベント積み戻し・全体残へ正規化', () => {
    const conv = { byCourse: new Map([[1, 600], [2, 100]]), global: 350 };
    const courses = [
      { id: 1, total: 10, passed: 6 }, // 重い教科（600s）
      { id: 2, total: 10, passed: 8 }, // 軽い教科（100s）
    ];
    const cph = [{ date: '2026-07-15', byCourse: { 1: 5, 2: 4 } as Record<number, number> }];
    // 7/14以前: 教科2のイベントが7/15に2件 → 7/14時点の教科2 passed = 4-2 = 2
    const events = [{ at: at(10), courseId: 2 }, { at: at(11), courseId: 2 }];
    const remainingMat = new Map([
      ['2026-07-14', 14], // 全体残（正規化目標）: known(5+8)=13 → ×14/13
      ['2026-07-15', 11],
    ]);
    const out = buildRemainingHoursSeries({ dates: ['2026-07-14', '2026-07-15'], remainingMat, courses, cph, events, conv });
    // 7/15: 教科1残5×600 + 教科2残6×100 = 3600 → 全体残11 vs known11 → 正規化1倍
    expect(out.get('2026-07-15')).toBeCloseTo(5 * 600 + 6 * 100, 5);
    // 7/14: 教科1残5×600(スナップ無→7/15から積み戻し・イベント無)…教科1はfirst=7/15(5) events0 → passed5
    //        教科2 passed = 4-2=2 → 残8×100。known=13 → ×14/13
    expect(out.get('2026-07-14')).toBeCloseTo((5 * 600 + 8 * 100) * (14 / 13), 5);
  });
});

describe('estimateHourlyStudySeconds', () => {
  it('JSTの時刻バケットへ計上（動画=完了時刻・受験=受験時刻）', () => {
    const est = estimateHourlyStudySeconds([entry({})], [{ at: at(22), courseId: 2503, len: 300, uncertaintySec: 0 }], wt);
    expect(est[10]).toBeCloseTo(240, 5); // test 4分
    expect(est[22]).toBeCloseTo(300, 5); // 動画5分
    expect(est.reduce((a, b) => a + b, 0)).toBeCloseTo(540, 5);
  });
});
