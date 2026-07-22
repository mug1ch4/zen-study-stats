// API 共通の GET ラッパー（api.ts / courseApi.ts で共用）。
// 【第一原則】GET のみ。状態変更(POST/PUT/PATCH/DELETE)は絶対に呼ばない。
// このファイルには GET 以外のメソッドを書かないこと。
import { logError } from './log';

export const API_BASE = 'https://api.nnn.ed.nico';

// --- サーキットブレーカー（レート上限・最後の安全網） ---
// 通常のカード描画は数リクエスト・教科集計でも十数リクエスト程度。万一どこかで
// リクエストがループしても、10秒あたり40件を超えたら以後60秒間は即throwして遮断する。
// これで「バグ由来のリクエストストーム」を設計レベルで不可能にする（規約12-9のレート配慮）。
const WINDOW_MS = 10_000;
const MAX_IN_WINDOW = 40;
const TRIP_MS = 60_000;
let times: number[] = [];
let trippedUntil = 0;

export class RateLimitError extends Error {}

function rateGuard(): void {
  const now = Date.now();
  if (now < trippedUntil) throw new RateLimitError('rate-limited (circuit open)');
  times = times.filter((t) => now - t < WINDOW_MS);
  if (times.length >= MAX_IN_WINDOW) {
    trippedUntil = now + TRIP_MS;
    times = [];
    logError('リクエスト過多を検知しました。API呼び出しを60秒間遮断します（暴走防止）。');
    throw new RateLimitError('rate-limited (tripped)');
  }
  times.push(now);
}

/** GET専用の薄いラッパー。credentials:'include' でログインCookieを送る。レート上限つき。 */
export async function getJSON<T>(path: string): Promise<T> {
  rateGuard();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}
