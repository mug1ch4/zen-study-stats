import { describe, it, expect } from 'vitest';
import { parseResultParams } from '../src/resultLog';
import { resultEvents, retroDaily, retroHours, retroSections } from '../src/resultStats';
import type { ResultEntry } from '../src/resultLog';

const esc = (j: unknown) => JSON.stringify(j).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const paramsHtml = (j: unknown, kind = 'test') => `<html><body><div data-evaluation-${kind}-params="${esc(j)}" data-result-page="true"></div></body></html>`;

describe('parseResultParams', () => {
  it('HTMLエスケープされた埋め込みJSONから first/latest を取り出す', () => {
    const p = parseResultParams(
      paramsHtml({
        passed: true,
        total_score: 2,
        result: {
          first: { passed: false, score: 1, answered_at: 1784350000 },
          latest: { passed: true, score: 2, answered_at: 1784350100 },
        },
        answerings: ['ア', 'never'],
        correctnesses: [true, true],
      })
    );
    expect(p?.passed).toBe(true);
    expect(p?.totalScore).toBe(2);
    expect(p?.first).toEqual({ passed: false, score: 1, at: 1784350000 });
    expect(p?.latest).toEqual({ passed: true, score: 2, at: 1784350100 });
  });
  it('report 側の属性名にも対応', () => {
    const p = parseResultParams(paramsHtml({ passed: true, total_score: 80, result: { latest: { passed: true, score: 75, answered_at: 1 } } }, 'report'));
    expect(p?.totalScore).toBe(80);
    expect(p?.latest?.score).toBe(75);
    expect(p?.first).toBeNull();
  });
  it('params が無い/壊れているときは null', () => {
    expect(parseResultParams('<html><body>shell</body></html>')).toBeNull();
    expect(parseResultParams('<div data-evaluation-test-params="{broken">')).toBeNull();
  });
});

const entry = (o: Partial<ResultEntry>): ResultEntry => ({
  courseId: 1,
  chapterId: 10,
  sectionId: 100,
  kind: 'test',
  passed: true,
  score: 2,
  totalScore: 2,
  firstAt: null,
  firstPassed: null,
  firstScore: null,
  latestAt: null,
  ...o,
});

// JST 2026-07-10 18:06 = UTC 09:06 = epoch 1783069560? 使いやすい固定値で:
// epoch秒 t のJST時刻 = t + 9h。5:00境界の学習日は zenTodayISO で判定される。
const JST = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h - 9, mi) / 1000;

describe('resultStats', () => {
  it('resultEvents: first/latest を展開し同時刻の重複は1つ', () => {
    const es = resultEvents([
      entry({ sectionId: 1, firstAt: 1000, latestAt: 2000 }),
      entry({ sectionId: 2, firstAt: 3000, latestAt: 3000 }),
    ]);
    expect(es.map((e) => e.at)).toEqual([1000, 2000, 3000]);
  });
  it('retroDaily: 5:00境界で学習日に集計（深夜2時は前日扱い）', () => {
    const m = retroDaily([
      entry({ sectionId: 1, firstAt: JST(2026, 7, 10, 18, 6) }), // 7/10 18:06
      entry({ sectionId: 2, firstAt: JST(2026, 7, 11, 2, 0) }), // 7/11 02:00 → 学習日 7/10
      entry({ sectionId: 3, firstAt: JST(2026, 7, 11, 6, 0) }), // 7/11 06:00 → 7/11
    ]);
    expect(m.get('2026-07-10')).toBe(2);
    expect(m.get('2026-07-11')).toBe(1);
  });
  it('retroHours: JSTの時間帯ヒストグラム', () => {
    const h = retroHours([entry({ sectionId: 1, firstAt: JST(2026, 7, 10, 18, 6), latestAt: JST(2026, 7, 10, 18, 50) })]);
    expect(h[18]).toBe(2);
    expect(h.reduce((a, b) => a + b, 0)).toBe(2);
  });
  it('retroSections: サマリと初回合格率が出る', () => {
    const title = new Map([[1, '英語']]);
    const entries = Array.from({ length: 6 }, (_, i) =>
      entry({ sectionId: i, firstAt: JST(2026, 7, 10, 18, i * 5), latestAt: JST(2026, 7, 10, 18, i * 5), firstPassed: i % 2 === 0 })
    );
    const secs = retroSections(entries, title);
    const titles = secs.map((s) => s.title);
    expect(titles).toContain('過去ログの実測サマリ');
    expect(titles).toContain('初回合格率（実測）');
    const fp = secs.find((s) => s.title === '初回合格率（実測）')!;
    expect(fp.insights[0].text).toContain('50%');
  });
  it('retroSections: 空なら空配列', () => {
    expect(retroSections([], new Map())).toEqual([]);
  });
});
