// API 共通の GET ラッパー（api.ts / courseApi.ts で共用）。
// 【第一原則】GET のみ。状態変更(POST/PUT/PATCH/DELETE)は絶対に呼ばない。
// このファイルには GET 以外のメソッドを書かないこと。

export const API_BASE = 'https://api.nnn.ed.nico';

/** GET専用の薄いラッパー。credentials:'include' でログインCookieを送る。 */
export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} -> ${res.status}`);
  return (await res.json()) as T;
}
