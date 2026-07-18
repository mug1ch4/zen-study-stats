// 表示整形ヘルパー。タイムゾーン差でズレないよう "YYYY-MM-DD" は自前パースする。

const JP_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** "YYYY-MM-DD" をローカル正午の Date に。TZで日付がずれないよう正午にする。 */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** Date → ローカル "YYYY-MM-DD"（toISOString はUTC基準でズレるため自前で）。 */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ZEN Study は日別の学習数が 5:00 AM(JST) に切り替わる。つまり深夜0:00〜4:59は
// まだ「前日」の学習日として集計される。ローカルTZに依存せず JST の 5時境界で
// “学習上の今日”を決める（端末が別TZでも壊れないよう +09:00 を明示）。
const JST_OFFSET_MS = 9 * 3600 * 1000;
const ZEN_DAY_START_HOUR = 5;

/** ZEN Study の「学習上の今日」= JST時刻から5時間戻した日付 "YYYY-MM-DD"。 */
export function zenTodayISO(nowMs: number = Date.now()): string {
  // epoch を JST壁時計へ寄せ、さらに5時間戻してから UTC 読みで日付成分を取る。
  const shifted = new Date(nowMs + JST_OFFSET_MS - ZEN_DAY_START_HOUR * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${p(shifted.getUTCMonth() + 1)}-${p(shifted.getUTCDate())}`;
}

/** ZEN Study の「学習上の今日」をローカル正午の Date で。予測・チャート基点用。 */
export function zenToday(nowMs: number = Date.now()): Date {
  return parseDate(zenTodayISO(nowMs));
}

/** 「学習上の今週」の開始日=日曜 "YYYY-MM-DD"（週目標・週次レビューの週キー。本家の週表示に合わせ日曜はじまり・5:00境界）。 */
export function zenWeekStartISO(nowMs: number = Date.now()): string {
  const d = parseDate(zenTodayISO(nowMs));
  d.setDate(d.getDate() - d.getDay()); // Sun=0
  return isoLocal(d);
}

/** 0=日 .. 6=土 */
export function weekdayIndex(iso: string): number {
  return parseDate(iso).getDay();
}

export function weekdayLabel(iso: string): string {
  return JP_WEEKDAYS[weekdayIndex(iso)];
}

export function weekdayLabelByIndex(i: number): string {
  return JP_WEEKDAYS[i];
}

/** "YYYY-MM-DD" -> "M/D" */
export function shortDate(iso: string): string {
  const d = parseDate(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 平均比の符号付き文字列 (例 "+25.1" / "-4.9") */
export function signed(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v >= 0 ? `+${v}` : `${v}`;
}

/** 秒 → "1h23m" / "23m" / "0m"（動画合計時間の表示用）。 */
export function durationStr(seconds: number): string {
  const m = Math.round(seconds / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h${mm}m` : `${mm}m`;
}
