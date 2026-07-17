// 週次マイルストーンの .ics（iCalendar）生成。完全ローカル生成・外部送信なし（第一原則）。
// コミットメント・デバイス: 逆算計画をカレンダーに置くと実行率が上がる（実装意図の具体化）。
import { isoLocal } from './format';

const DAY = 86400000;

function icsDate(d: Date): string {
  return isoLocal(d).replace(/-/g, '');
}
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,');
}

/** 今日→目標日を週次で刻んだ全日イベント群を生成。 */
export function buildPlanIcs(opts: { remaining: number; passed: number; target: Date; today: Date }): string {
  const { remaining, passed, target, today } = opts;
  const days = Math.max(1, Math.round((target.getTime() - today.getTime()) / DAY));
  const weeks = Math.max(1, Math.ceil(days / 7));
  const events: string[] = [];
  const stamp = icsDate(today) + 'T000000Z';
  for (let k = 1; k <= weeks; k++) {
    const isLast = k === weeks;
    const date = isLast ? target : new Date(today.getTime() + k * 7 * DAY);
    const doneByThen = isLast ? remaining : Math.round((remaining * Math.min(days, k * 7)) / days);
    const cum = passed + doneByThen;
    const left = remaining - doneByThen;
    const summary = isLast
      ? `ZEN Study 完了目標日（全${passed + remaining}教材）`
      : `ZEN Study 週次目標: 累計${cum}教材まで（残り${left}）`;
    const d2 = new Date(date.getTime() + DAY);
    events.push(
      [
        'BEGIN:VEVENT',
        `UID:zss-${icsDate(date)}@zen-study-stats`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(date)}`,
        `DTEND;VALUE=DATE:${icsDate(d2)}`,
        `SUMMARY:${esc(summary)}`,
        'DESCRIPTION:ZEN Study 学習統計（個人用）で生成した週次マイルストーン',
        'END:VEVENT',
      ].join('\r\n')
    );
  }
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//zen-study-stats//plan//JA',
    'CALSCALE:GREGORIAN',
    events.join('\r\n'),
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/** テキストをファイルとしてダウンロード（ローカル保存のみ）。 */
export function downloadText(filename: string, mime: string, text: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
