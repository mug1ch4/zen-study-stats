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
  order?: number; // コース内の章番号（章またぎ連結用。無い=旧データは章単体で処理）
  sections: SkelSection[]; // 章内の表示順
}
export type ChapterSkels = Record<string, ChapterSkel>; // key: chapterId

export interface MovieEvent {
  at: number; // 推定完了時刻 epoch秒（実行可能区間の中点）
  courseId: number;
  len: number; // 動画の秒数
  uncertaintySec: number; // 推定の最大誤差（±この秒数。＝スラック/2）
}

// 妥当性チェックの根拠（公開研究に基づく・2026-07 調査）:
// 1) time-on-task 推定（学習分析）: ログ間隙への時間帰属はセッション・タイムアウト閾値
//    （10/30/60分）が標準的ヒューリスティックで、閾値選択が結論を左右する
//    （Kovanović et al., "Does Time-on-task Estimation Matter?", J. Learning Analytics 2015）。
//    → 許容スラック（アンカー間の非動画時間＝解答・小休憩）は保守的な30分を既定とする。
// 2) 区間打ち切り（interval censoring）の補完: 中点補完は区間が短いときほぼ不偏、
//    区間が長いと偏る（短い censoring interval なら相対バイアス数%以内・被覆確率も名目近傍）。
//    → 完了時刻は実行可能区間 [最早=前詰め, 最遅=後詰め] の中点に置き（前詰め＝下限補完の
//    早方向バイアスを排除）、区間半幅（＝スラック/2）が MAX_UNCERTAINTY 以下の場合のみ採用
//    （時間帯バケット幅60分に対し ±15分なら概ね正しいバケットに入る）。
// 3) 物理制約: 必修動画は倍速不可・直列（本家仕様）→ gap ≥ 動画合計 S は硬い下限
//    （丸め誤差のみ許容 FIT_TOL=0.95）。gap < S*0.95 は「この窓では見ていない」＝不採用。
const FIT_TOL = 0.95;
const DEFAULT_SLACK_SEC = 30 * 60; // セッション・タイムアウト規範に合わせた保守値
const MAX_UNCERTAINTY_SEC = 15 * 60; // 採用条件: 中点補完の最大誤差 ±15分以下

/** アンカー間に挟まれた passed 動画の完了時刻を推定（中点補完・不確かさ付き）。
 *  採用できない窓（中断・逆順・幅不整合・不確かさ過大）は黙って捨てる。 */
export function interpolateMovieEvents(skels: ChapterSkels, entries: ResultEntry[], slackSec = DEFAULT_SLACK_SEC): MovieEvent[] {
  // 各教材の「その学習セッションの時刻」= 初回受験(firstAt)。無ければ latestAt。
  const anchorTime = new Map<number, number>();
  for (const e of entries) {
    const t = e.firstAt ?? e.latestAt;
    if (t) anchorTime.set(e.sectionId, t);
  }
  const out: MovieEvent[] = [];
  // アンカー対の評価（1系列 = 章内 or 章またぎ連結列）
  const processSequence = (sections: SkelSection[], courseId: number): void => {
    const anchors: { pos: number; t: number }[] = [];
    sections.forEach((s, pos) => {
      const t = anchorTime.get(s.id);
      if (t) anchors.push({ pos, t });
    });
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1];
      const b = anchors[i];
      if (b.t <= a.t) continue; // 並び順どおりに受験していない（後から戻った等）→不採用
      const movies = sections.slice(a.pos + 1, b.pos).filter((s) => s.kind === 'movie' && s.passed && s.len > 0);
      if (!movies.length) continue;
      const S = movies.reduce((x, m) => x + m.len, 0);
      const gap = b.t - a.t;
      if (gap < S * FIT_TOL) continue; // 物理制約違反＝この窓では見ていない
      const slack = gap - S; // 窓内の非動画時間（どこに挟まったかは不明）
      if (slack > slackSec) continue; // 長い中断＝時間推定に使えない
      const half = Math.max(0, slack / 2);
      if (half > MAX_UNCERTAINTY_SEC) continue; // 中点補完の誤差が大きすぎる
      // 実行可能区間: 最早 = A直後から前詰め、最遅 = B直前へ後詰め。中点に置く。
      let prefix = 0;
      for (const m of movies) {
        prefix += m.len;
        const earliest = a.t + prefix;
        out.push({ at: Math.round(earliest + half), courseId, len: m.len, uncertaintySec: Math.round(half) });
      }
    }
  };
  // コースごとに order のある章を連結して1系列に（章またぎの窓
  // ＝essay_report→次章の第1回テスト等も評価できる）。order の無い旧データは章単体で処理。
  const byCourse = new Map<number, ChapterSkel[]>();
  for (const sk of Object.values(skels)) {
    (byCourse.get(sk.courseId) ?? byCourse.set(sk.courseId, []).get(sk.courseId)!).push(sk);
  }
  for (const [courseId, list] of byCourse) {
    const ordered = list.filter((sk) => sk.order !== undefined).sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    if (ordered.length) processSequence(ordered.flatMap((sk) => sk.sections), courseId);
    for (const sk of list.filter((sk) => sk.order === undefined)) processSequence(sk.sections, courseId);
  }
  return out.sort((x, y) => x.at - y.at);
}

/** 補間イベントの JST 24時間ヒストグラム。 */
export function movieHours(events: MovieEvent[]): number[] {
  const h = new Array(24).fill(0) as number[];
  for (const ev of events) h[new Date((ev.at + 9 * 3600) * 1000).getUTCHours()]++;
  return h;
}
