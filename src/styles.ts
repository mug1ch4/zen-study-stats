// Shadow DOM 内のスタイル。本家ZEN Studyのデザイントークンに合わせる。
// フォント/ブランド青/カード形状は実サイトの computed style を採取して踏襲。
// 本家フォント "ZaneYuGothicM" は文書全体スコープの @font-face なので shadow 内でも効く。

// 本家トークン (実測): font stack / brand blue #0077d3 / ink #222 / muted #828282 /
// card: white, radius 8px, no border, shadow rgba(0,0,0,.1) 0 1px 1px + rgba(0,0,0,.2) 0 0 2px
const SITE_FONT = `-apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic Pro", ZaneYuGothicM, Meiryo, sans-serif`;

export const CSS = `
:host {
  /* ---- light tokens = 本家準拠 ---- */
  --surface: #ffffff;
  --surface-2: #f5f5f5;
  --ink: #222222;
  --muted: #828282;
  --faint: #a6a6a6;
  --border: #eeeeee;
  --primary: #0077d3;         /* 本家ブランド青 */
  --primary-strong: #005596;
  --zero-tint: #e5f1fb;
  --success: #1a8a4a;
  --shadow: rgba(0,0,0,.1) 0 1px 1px 0, rgba(0,0,0,.2) 0 0 2px 0;
  /* カレンダー逐次ランプ（validate_palette.js --ordinal で light ALL PASS） */
  --cal-none: #e6e8eb; --cal-0: #d8e8f8;
  --cal-1: #83b4e8; --cal-2: #5c9be4; --cal-3: #2f77d2; --cal-4: #0a4b8f;
  /* 教科別カテゴリ配色（Okabe-Ito ベース。validate_palette.js --pairs all で PASS。
     CVD 6-8 帯のため凡例＋直接ラベル＋スライス間ギャップの二次符号化を併用）。 */
  --cat-1: #0072b2; --cat-2: #d55e00; --cat-3: #009e73; --cat-4: #cc79a7;
  --cat-5: #56b4e9; --cat-6: #e69f00; --cat-other: #9aa6b2;

  all: initial;
  display: block;
  font-family: ${SITE_FONT};
  color: var(--ink);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
/* 本家にダークモードは無く、既定はライト固定。OSのprefers-color-schemeには追従しない。
   サイト全体ダーク(我々の実装)時は html の filter反転にこのカードごと乗せるため、
   ここで独自にダーク配色へ切り替える必要はない。data-theme="dark" は任意の明示切替用に残す。 */
:host([data-theme="dark"]) {
  --surface: #1b2027; --surface-2: #232b35; --ink: #e6ebf1; --muted: #9aa6b2;
  --faint: #6b7684; --border: #2c333d; --primary: #4aa3ee; --primary-strong: #8fc4f5;
  --zero-tint: #10314f; --success: #3ec77a;
  --shadow: none; /* ダークでは本家同様に影は見えない */
  /* カレンダー逐次ランプ（dark ALL PASS） */
  --cal-none: #2a2f37; --cal-0: #16324f;
  --cal-1: #1c4f82; --cal-2: #2f77d2; --cal-3: #5c9be4; --cal-4: #9cc6f0;
  /* 教科別カテゴリ配色は light と共用（Okabe-Ito は暗背景でも CVD/コントラスト/normal を満たす）。
     --cat-other だけ暗背景で沈まないよう微調整。 */
  --cat-other: #7b8794;
}

.zss-card {
  background: var(--surface);
  border-radius: 8px;
  /* 本家カードと完全一致（白 / 角丸8px / ボーダー無し / 極薄の影）。
     上書き後、周囲の本家カードと見分けがつかないようにする。ダークでは影は見えないので none。 */
  box-shadow: var(--shadow);
  padding: 20px 22px;
  position: relative;
  box-sizing: border-box;
  max-width: 100%;
}
.zss-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.zss-title { font-size: 15px; font-weight: 700; margin: 0; letter-spacing: .02em; }
.zss-sub { font-size: 12px; color: var(--muted); margin: 2px 0 0; }
.zss-badge {
  font-size: 11px; color: var(--primary-strong); background: var(--zero-tint);
  border-radius: 999px; padding: 3px 10px; font-weight: 600; white-space: nowrap;
}
.zss-head-right { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
.zss-ver { font-size: 10px; color: var(--faint); letter-spacing: .02em; font-variant-numeric: tabular-nums; }

.zss-hero { display: flex; align-items: baseline; gap: 10px; margin: 14px 0 2px; flex-wrap: wrap; }
.zss-hero .n { font-size: 40px; font-weight: 800; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.zss-hero .unit { font-size: 13px; color: var(--muted); }
.zss-hero .delta { font-size: 12px; font-weight: 700; color: var(--success); }
.zss-hero .today { font-size: 12px; color: var(--muted); }
.zss-hero-label { font-size: 12px; color: var(--muted); }

.zss-kpis { display: flex; gap: 22px; flex-wrap: wrap; margin-top: 10px; }
.zss-kpi .k { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
.zss-kpi .l { font-size: 11px; color: var(--muted); }

/* コンパクト要点ストリップ（常時表示） */
.zss-stats { display: flex; gap: 18px; flex-wrap: wrap; align-items: baseline; margin: 12px 0 4px; }
.zss-stat .v { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1.1; }
.zss-stat.big .v { font-size: 30px; letter-spacing: -.01em; }
.zss-stat .l { font-size: 11px; color: var(--muted); margin-top: 1px; }

.zss-section { margin-top: 20px; }
.zss-section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; flex-wrap: wrap; gap: 4px 8px; }
.zss-section-title { font-size: 12px; font-weight: 700; color: var(--ink); }
.zss-section-note { font-size: 11px; color: var(--faint); }

.zss-chart { width: 100%; }
.zss-chart svg { width: 100%; height: auto; display: block; overflow: visible; }

.zss-legend { display: flex; gap: 14px; margin-top: 8px; font-size: 11px; color: var(--muted); }
.zss-legend span { display: inline-flex; align-items: center; gap: 5px; }
.zss-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; }

.zss-foot { margin-top: 16px; font-size: 11px; color: var(--faint); }

/* --- データ表（a11y: チャートの表の双子） --- */
.zss-dtable-details { margin-top: 6px; }
.zss-dtable-details summary { font-size: 11px; color: var(--primary); cursor: pointer; list-style: none; }
.zss-dtable-details summary::-webkit-details-marker { display: none; }
.zss-dtable-details summary::before { content: '▸ '; }
.zss-dtable-details[open] summary::before { content: '▾ '; }
.zss-dtable-wrap { max-height: 220px; overflow: auto; margin-top: 6px; }
.zss-dtable { border-collapse: collapse; width: 100%; font-size: 11px; font-variant-numeric: tabular-nums; }
.zss-dtable th, .zss-dtable td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
.zss-dtable th { color: var(--muted); font-weight: 600; position: sticky; top: 0; background: var(--surface); }
.zss-dtable td:not(:first-child) { text-align: right; }

/* --- 詳細（M2: 長期データ） --- */
.zss-details-toggle {
  margin-top: 16px; width: 100%; text-align: center; cursor: pointer;
  background: none; border: 1px solid var(--border); border-radius: 6px;
  color: var(--primary); font-size: 12px; font-weight: 600; padding: 7px 0;
  font-family: inherit;
}
.zss-details-toggle:hover { background: var(--surface-2); }
.zss-details { margin-top: 16px; display: none; }
.zss-details.open { display: block; }
.zss-badge-grow {
  font-size: 11px; color: var(--muted); background: var(--surface-2);
  border-radius: 999px; padding: 3px 10px; display: inline-block; margin-bottom: 10px;
}
.zss-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.zss-seg button {
  background: var(--surface); border: none; color: var(--muted); font-size: 11px;
  padding: 4px 10px; cursor: pointer; font-family: inherit;
}
.zss-seg button.on { background: var(--primary); color: #fff; }
.zss-tsub { display: flex; justify-content: flex-end; margin: 2px 0 4px; }
.zss-tsub-note { font-size: 11px; color: var(--faint); margin: 2px 0 4px; }
.zss-cal-wrap { overflow-x: auto; max-width: 100%; margin-top: 2px; padding-bottom: 2px; }
.zss-cal-wrap svg { display: block; }
.zss-cal-legend { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 11px; color: var(--muted); }
.zss-cal-legend .sw { width: 11px; height: 11px; border-radius: 2px; display: inline-block; }
.zss-empty { font-size: 12px; color: var(--faint); padding: 10px 0; }

/* --- レポート完了予測 --- */
.zss-pred-head { font-size: 14px; font-weight: 700; margin: 6px 0 4px; }
.zss-pred-head.ok { color: var(--success); }
.zss-pred-head.warn { color: #d9822b; }
.zss-pred-head .sub { font-size: 12px; font-weight: 600; color: var(--muted); }
.zss-pred-note { font-size: 11px; color: var(--muted); margin: 2px 0 8px; }
.zss-dist-head { font-size: 10px; color: var(--faint); margin: 8px 0 0; }
.zss-untouched { font-size: 10px; color: #d9822b; border: 1px solid #d9822b; border-radius: 3px; padding: 0 4px; margin-left: 6px; font-weight: 600; }
.zss-sub-head { font-size: 11px; font-weight: 700; color: var(--muted); margin: 12px 0 4px; }
.zss-pred-methods { font-size: 11px; }
.zss-pred-methods .m { display: flex; justify-content: space-between; gap: 8px; padding: 3px 0; border-bottom: 1px solid var(--border); }
.zss-pred-methods .m.used { color: var(--ink); font-weight: 600; }
.zss-pred-methods .ml { color: var(--muted); }
.zss-pred-methods .m.used .ml { color: var(--primary-strong); }
.zss-pred-methods .mv { font-variant-numeric: tabular-nums; }
.zss-target { display: flex; align-items: center; gap: 8px; font-size: 12px; margin: 4px 0; }
.zss-target input { font: inherit; padding: 3px 6px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface); color: var(--ink); }
.zss-rec { margin-top: 6px; }
.zss-rec-main { font-size: 13px; font-weight: 700; }
.zss-rec-main .sub { font-size: 11px; font-weight: 400; color: var(--muted); }
.zss-rec-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }
.zss-rec-msg { font-size: 12px; }
.zss-rec-msg.warn { color: #d9822b; }
.zss-rec-msg.good { color: var(--success); }
.zss-rec-msg.note { color: var(--muted); }

/* 目標日から逆算（優先度の高い枠として目立たせる） */
.zss-target-box { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin: 10px 0; background: var(--surface-2); }
.zss-target-head { font-size: 12px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }

.zss-pred-caveat { font-size: 10px; color: var(--faint); margin-top: 10px; line-height: 1.5; }

/* モチベーション「今日のひとこと」 */
.zss-motiv {
  border: 1px solid color-mix(in srgb, var(--primary) 35%, var(--border));
  border-radius: 10px; padding: 10px 12px; margin-bottom: 12px;
  background: color-mix(in srgb, var(--primary) 8%, var(--surface));
}
.zss-motiv-head { font-size: 11px; font-weight: 700; color: var(--primary-strong); margin-bottom: 6px; letter-spacing: .02em; }
.zss-motiv-item { font-size: 12.5px; line-height: 1.6; color: var(--ink); margin-top: 6px; padding-left: 10px; border-left: 2px solid color-mix(in srgb, var(--primary) 45%, transparent); }

/* 分析タブ「あなたの学習傾向」 */
.zss-analysis-head { font-size: 15px; font-weight: 800; margin: 2px 0; }
.zss-analysis-sub { font-size: 11px; color: var(--faint); margin-bottom: 10px; }
.zss-insight-sec { border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; margin-bottom: 8px; background: var(--surface-2); }
.zss-insight-title { font-size: 12px; font-weight: 700; color: var(--ink); margin-bottom: 4px; }
.zss-insight { font-size: 12px; line-height: 1.55; color: var(--ink); }
.zss-insight .ic { display: inline-block; width: 1.1em; font-weight: 700; }
.zss-insight.good { color: var(--success); }
.zss-insight.warn { color: #d9822b; }
.zss-insight.note { color: var(--muted); }

/* 現在ペースからの分析 */
.zss-analysis { display: flex; flex-direction: column; gap: 3px; margin: 8px 0 2px; }
.zss-analysis-line { font-size: 12px; color: var(--ink); }
.zss-analysis-line .ic { display: inline-block; width: 1.1em; font-size: 10px; text-align: center; }
.zss-analysis-line.good { color: var(--success); }
.zss-analysis-line.warn { color: #d9822b; }
.zss-analysis-line.note { color: var(--muted); }

/* --- 詳細タブ --- */
.zss-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--border); margin: 12px 0 10px; }
.zss-tabs button { flex: 1; background: none; border: none; border-bottom: 2px solid transparent; color: var(--muted); font-family: inherit; font-size: 12px; font-weight: 700; padding: 7px 0; cursor: pointer; }
.zss-tabs button.on { color: var(--primary-strong); border-bottom-color: var(--primary); }
.zss-fold { margin: 10px 0; }
.zss-fold > summary { font-size: 11px; color: var(--muted); cursor: pointer; list-style: none; }
.zss-fold > summary::-webkit-details-marker { display: none; }
.zss-fold > summary::before { content: '▸ '; }
.zss-fold[open] > summary::before { content: '▾ '; }

/* --- 予測の確度バッジ --- */
.zss-conf { display: flex; align-items: center; gap: 6px; font-size: 11px; margin: 6px 0 2px; flex-wrap: wrap; }
.zss-conf-dot { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.zss-conf-label { font-weight: 700; }
.zss-conf-note { color: var(--faint); }
.zss-conf.low .zss-conf-dot { background: #d9822b; }
.zss-conf.low .zss-conf-label { color: #d9822b; }
.zss-conf.mid .zss-conf-dot { background: var(--muted); }
.zss-conf.mid .zss-conf-label { color: var(--muted); }
.zss-conf.high .zss-conf-dot { background: var(--success); }
.zss-conf.high .zss-conf-label { color: var(--success); }

/* --- 今日のデイリークエスト --- */
.zss-quest {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; margin-bottom: 12px;
}
.zss-quest.met { border-color: color-mix(in srgb, var(--success) 45%, var(--border)); }
.zss-quest-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.zss-quest-label { font-size: 12px; font-weight: 700; color: var(--ink); }
.zss-quest-count { font-size: 12px; color: var(--muted); }
.zss-quest-count b { font-size: 15px; color: var(--ink); }
.zss-quest-left { color: var(--primary-strong); font-weight: 700; }
.zss-quest.met .zss-quest-left { color: var(--success); }
.zss-quest-bar { height: 6px; border-radius: 3px; background: var(--border); overflow: hidden; margin: 8px 0 6px; }
.zss-quest-fill { height: 100%; background: var(--primary); border-radius: 3px; transition: width .3s; }
.zss-quest-fill.met { background: var(--success); }
.zss-quest-note { font-size: 11px; color: var(--faint); }

/* --- データのバックアップ/復元 --- */
.zss-dm-note { font-size: 11px; color: var(--faint); margin: 6px 0 8px; line-height: 1.5; }
.zss-dm-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.zss-dm-btn {
  font: inherit; font-size: 11px; padding: 5px 10px; border-radius: 6px;
  border: 1px solid var(--border); background: var(--surface); color: var(--ink); cursor: pointer;
}
.zss-dm-btn:hover { background: var(--surface-2); }
.zss-dm-btn.primary { border-color: var(--primary); color: var(--primary); }
.zss-dm-file { display: none; }
.zss-dm-status { font-size: 11px; margin-top: 8px; min-height: 1em; color: var(--muted); }
.zss-dm-status.ok { color: var(--success); }
.zss-dm-status.err { color: #d9822b; }

/* --- 教材ボリューム --- */
.zss-vol-open { font-size: 11px; color: var(--primary); text-decoration: none; display: inline-block; margin: 4px 0 0 8px; }
.zss-vol-metric { margin-right: 10px; white-space: nowrap; }
.zss-vol-metric .ml { color: var(--muted); }
.zss-vol-summary { background: var(--surface-2); border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
.zss-vol-summary-flex { display: flex; align-items: center; gap: 14px; }
.zss-vol-summary-flex svg { flex: 0 0 auto; }
.zss-vol-sum-body { min-width: 0; flex: 1 1 auto; }
.zss-vol-sum-main { font-size: 13px; font-weight: 700; }
.zss-vol-sum-note { font-size: 11px; color: var(--muted); margin-top: 2px; }
.zss-vol-chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.zss-vol-chip { font-size: 11px; background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 2px 8px; }
.zss-vol-chip .l { color: var(--muted); margin-right: 4px; }
.zss-vol-chip .v { font-weight: 700; }
.zss-vol-course { border-bottom: 1px solid var(--border); padding: 8px 0; }
.zss-vol-link { display: block; text-decoration: none; color: inherit; cursor: pointer; padding: 8px 6px; margin: 0 -6px; border-radius: 6px; }
.zss-vol-link:hover { background: var(--surface-2); }
.zss-vol-row-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.zss-vol-name { font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zss-vol-pct { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
.zss-vol-bar { height: 4px; background: var(--surface-2); border-radius: 2px; margin: 5px 0; overflow: hidden; }
.zss-vol-bar-in { height: 100%; background: var(--primary); border-radius: 2px; }
.zss-vol-metrics { font-size: 11px; color: var(--muted); }
.zss-vol-sub { display: none; margin: 6px 0 2px 8px; border-left: 2px solid var(--border); padding-left: 8px; }
.zss-vol-sub.open { display: block; }
.zss-vol-chap { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; padding: 3px 0; }
.zss-vol-chap-name { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.zss-vol-chap-meta { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }

/* --- 表示アニメーション（段階的に現れる）。動きを減らす設定では一切動かさない。 --- */
@media (prefers-reduced-motion: no-preference) {
  @keyframes zss-fade-up { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  @keyframes zss-grow-y { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  @keyframes zss-draw { to { stroke-dashoffset: 0; } }
  @keyframes zss-arc { from { stroke-dashoffset: var(--arc, 0); } to { stroke-dashoffset: 0; } }
  @keyframes zss-pop { from { opacity: 0; transform: scale(.5); } to { opacity: 1; transform: scale(1); } }
  @keyframes zss-fade { from { opacity: 0; } to { opacity: var(--fo, 1); } }
  @keyframes zss-grow-x { from { transform: scaleX(0); } to { transform: scaleX(1); } }

  /* タブ内容・セクションのフェードアップ */
  .zss-pane { animation: zss-fade-up .34s cubic-bezier(.2,.7,.3,1) both; }
  /* 棒: ベースラインから伸びる（各バーに inline の animation-delay でスタッガ） */
  .zss-abar { transform-box: fill-box; transform-origin: 50% 100%; animation: zss-grow-y .55s cubic-bezier(.2,.75,.3,1) both; }
  /* 折れ線: 左から描かれる（pathLength=1 で正規化） */
  .zss-adraw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: zss-draw .95s ease-out .08s forwards; }
  /* ドーナツ弧: 0%→実割合へ描かれる */
  .zss-aarc { animation: zss-arc 1.05s cubic-bezier(.3,.8,.3,1) .06s both; }
  /* カレンダーのマス: 列ごとにポップイン */
  .zss-acell { transform-box: fill-box; transform-origin: 50% 50%; animation: zss-pop .32s ease-out both; }
  /* 図の重ね要素をふわっと（必要ライン・不確実性バンド・完了見込みラベル等） */
  .zss-afade { animation: zss-fade .55s ease-out both; }
  /* 横方向に伸びる（完了見込みP15–P85レンジ線など） */
  .zss-agrow-x { transform-box: fill-box; transform-origin: 50% 50%; animation: zss-grow-x .55s cubic-bezier(.2,.75,.3,1) both; }
  /* 教科ドーナツのスライス: 順にフェードイン（transform属性のrotateと衝突しないよう不透明度のみ） */
  .zss-aslice { animation: zss-fade .4s ease-out both; }
  /* 数値カウントアップ中の等幅ゆらぎ防止 */
  .zss-count { font-variant-numeric: tabular-nums; }
}

.zss-vol-hint { font-size: 11px; color: var(--muted); margin: 6px 2px 4px; line-height: 1.5; }

/* --- 教科別 残り学習量シェア（色分けドーナツ） --- */
.zss-bd { margin-top: 2px; }
.zss-bd-top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.zss-bd-donut { flex: 0 0 auto; }
.zss-bd-donut svg { display: block; }
.zss-bd-legend { flex: 1 1 180px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.zss-bd-item { display: flex; align-items: baseline; gap: 7px; font-size: 12px; line-height: 1.4; }
.zss-bd-sw { width: 10px; height: 10px; border-radius: 2px; flex: 0 0 auto; align-self: center; }
.zss-bd-name { color: var(--ink); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 9em; }
.zss-bd-share { color: var(--ink); font-weight: 800; font-variant-numeric: tabular-nums; flex: 0 0 auto; }
.zss-bd-detail { color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.zss-bd-cap { font-size: 10px; color: var(--faint); margin-top: 8px; line-height: 1.5; }

/* tooltip */
.zss-tip {
  position: fixed; z-index: 2147483647; pointer-events: none;
  background: var(--ink); color: var(--surface);
  font-size: 11px; padding: 6px 9px; border-radius: 6px; white-space: nowrap;
  transform: translate(-50%, -120%); opacity: 0; transition: opacity .08s; box-shadow: var(--shadow);
}
.zss-tip.on { opacity: 1; }
.zss-tip b { font-weight: 700; }
`;
