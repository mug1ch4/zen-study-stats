// 動画視聴時刻の補間（純関数）: 連続する受験アンカー（テスト/レポートの answered_at）の間に
// 挟まれた動画教材の完了時刻を推定する。
// 根拠: 必修動画は倍速不可・別タブ同時視聴不可（＝必ず実時間×直列で消化される）ため、
// アンカー間の経過時間が「間の動画の合計実時間」に整合する場合に限り、
// アンカーAの直後から動画を順に積んだ時刻を採用できる。
// 幅が明らかに超過（長い休憩・日をまたぐ中断）または不足（動画は別の時に視聴済み）なら不採用。
import type { ResultEntry } from './resultLog';

export interface SkelSection {
  id: number;
  kind: 'movie' | 'anchor' | 'other'; // anchor = evaluation_test / evaluation_report（結果ログが取れる種別）
  len: number; // movie の秒数（他は0）
  passed: boolean;
}
export interface ChapterSkel {
  courseId: number;
  sections: SkelSection[]; // 章内の表示順
}
export type ChapterSkels = Record<string, ChapterSkel>; // key: chapterId

export interface MovieEvent {
  at: number; // 推定完了時刻 epoch秒
  courseId: number;
  len: number; // 動画の秒数
}

// gap（アンカー間の実経過）の採用条件: S*FIT_TOL ≤ gap ≤ S + slack。
// 下限: 動画合計より明確に短い＝この窓では見ていない（別時期に視聴済み）。
// 上限: 合計＋slack を超える＝途中に長い中断（時間帯の推定に使えない）。
const FIT_TOL = 0.85;
const DEFAULT_SLACK_SEC = 60 * 60; // アンカー自身の解答時間＋小休憩ぶん

/** アンカー間に挟まれた passed 動画の完了時刻を推定。採用できない窓は黙って捨てる。 */
export function interpolateMovieEvents(skels: ChapterSkels, entries: ResultEntry[], slackSec = DEFAULT_SLACK_SEC): MovieEvent[] {
  // 各教材の「その学習セッションの時刻」= 初回受験(firstAt)。無ければ latestAt。
  const anchorTime = new Map<number, number>();
  for (const e of entries) {
    const t = e.firstAt ?? e.latestAt;
    if (t) anchorTime.set(e.sectionId, t);
  }
  const out: MovieEvent[] = [];
  for (const sk of Object.values(skels)) {
    const anchors: { pos: number; t: number }[] = [];
    sk.sections.forEach((s, pos) => {
      const t = anchorTime.get(s.id);
      if (t) anchors.push({ pos, t });
    });
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1];
      const b = anchors[i];
      if (b.t <= a.t) continue; // 章の順序どおりに受験していない（後から戻った等）→不採用
      const movies = sk.sections.slice(a.pos + 1, b.pos).filter((s) => s.kind === 'movie' && s.passed && s.len > 0);
      if (!movies.length) continue;
      const S = movies.reduce((x, m) => x + m.len, 0);
      const gap = b.t - a.t;
      if (gap < S * FIT_TOL || gap > S + slackSec) continue; // 幅が整合しない
      let cursor = a.t;
      for (const m of movies) {
        cursor += m.len;
        out.push({ at: cursor, courseId: sk.courseId, len: m.len });
      }
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

/** 補間イベントの JST 24時間ヒストグラム。 */
export function movieHours(events: MovieEvent[]): number[] {
  const h = new Array(24).fill(0) as number[];
  for (const ev of events) h[new Date((ev.at + 9 * 3600) * 1000).getUTCHours()]++;
  return h;
}
