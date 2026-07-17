// 表示アニメーションの小ヘルパー（依存なし）。
// 【第一原則】表示専用。演出のみで、取得・記録には一切影響しない。

/** OSの「動きを減らす」設定。true のときはアニメーションを行わず即確定する。 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * 整数のカウントアップ。finalText の先頭整数だけを 0→目標へ増やし、末尾の単位（"日"・"%"等）は保持。
 * reduced-motion / 非数値 / 0以下 のときは即確定。
 */
export function countUp(el: Element, finalText: string, durationMs = 650): void {
  const m = /^(-?\d+)(.*)$/.exec(finalText.trim());
  const target = m ? parseInt(m[1], 10) : NaN;
  if (!m || prefersReducedMotion() || !Number.isFinite(target) || target <= 0) {
    el.textContent = finalText;
    return;
  }
  const suffix = m[2];
  const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
  const start = performance.now();
  el.classList.add('zss-count');
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / durationMs);
    if (t < 1) {
      el.textContent = `${Math.round(target * ease(t))}${suffix}`;
      requestAnimationFrame(step);
    } else {
      el.textContent = finalText; // 最終フレームは元の表記に揃える
    }
  };
  requestAnimationFrame(step);
}
