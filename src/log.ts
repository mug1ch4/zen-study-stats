// 構造化ロガー（[ZSS] プレフィックス付き・デバッグフラグ対応）。
// 既存の console.log/warn/error を段階的に置き換えるための薄いラッパー。
// 【設計】production では warn/error のみ出力。debug は chrome.storage のフラグで有効化可能。

const PREFIX = '[ZSS]';

let debugEnabled = false;

/** デバッグ出力の有効化（chrome.storage.local の 'zss:debug' で永続化）。 */
export function initLogger(): void {
  try {
    void chrome.storage?.local.get(['zss:debug']).then((r) => {
      debugEnabled = !!r?.['zss:debug'];
    });
  } catch {
    /* storage unavailable (preview/test) */
  }
}

/** 実行時にデバッグモードを切り替え（トーストやコンソールから呼べる）。 */
export function setDebug(enabled: boolean): void {
  debugEnabled = enabled;
  try {
    void chrome.storage?.local.set({ 'zss:debug': enabled });
  } catch {
    /* ignore */
  }
}

export function isDebug(): boolean {
  return debugEnabled;
}

/** デバッグログ（有効時のみ出力）。 */
export function logDebug(...args: unknown[]): void {
  if (debugEnabled) console.log(PREFIX, ...args);
}

/** 情報ログ（常に出力）。 */
export function logInfo(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

/** 警告ログ（常に出力）。 */
export function logWarn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}

/** エラーログ（常に出力）。 */
export function logError(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}
