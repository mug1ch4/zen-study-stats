# 計算系統一設計: buildRequiredSeries()

> 文献裏付け（2026-07-19 調査）:
> - §3.2 の「被覆窓内の無イベント日=0」は、ゼロ過剰データ研究の「真のゼロ vs 推定ゼロ(presumed negative)」の
>   区別、およびアクティグラフィの「非装着時間 vs 静止」分類と同型。標準解=先に被覆(wear-time相当)を判定し、
>   被覆内の無記録を真のゼロとみなす。推定ゼロであることは quality（presumedZeroDays）に保持する。
> - §3.3 の整合は経済統計の temporal disaggregation / benchmarking（Denton法系）の基本形 pro-rata（比例配分）。
>   合計の厳密一致（aggregation constraint）が本質。区間境界の段差を平滑化する Denton 比例法(PFD)は将来の改良候補。
> - §3.1 の切断は、計測基盤が変わる時系列の標準処理（構造変化での分割/連鎖）に一致。

目的: 必修の「日次消化系列」を単一の正準ソースとして構築し、予測・実績カーブ・ペース・アドバイスの
全消費者がこれだけを参照する。ソースの**選択**（全取っ替え）をやめ、**結合**（日単位のマージ）にする。

## 0. 原則

1. **保存しない・導出する**: 系列は既存ストア（MH/CPH/RL/skels/LA）からレンダリング時に導出する純関数。
   新しい永続データは作らない（ストレージ肥大の回避・既存ストアが単一の真実源）。
   導出コストは高々 365点×数フィールド ≒ 数十KB のメモリで無視できる。
2. **不明(null)と0を区別する**: 「記録が無い日」を0とみなすと平均が壊れ、0を不明とみなすとペース過大になる。
   全域でこの区別を明示的に持つ。
3. **出所(source)を保持する**: UI は observed=実線 / anchor=点線 / approx=注記付き、と描き分けられる。
   統計側は品質(quality)を見て発動条件（モンテカルロ≥5有効日など）を判断する。
4. **必修のみ**: learning_amounts（合算）は最後の近似としてのみ・明示タグ付きで使う。

## 1. 入力

| 入力 | 内容 | 由来 |
|---|---|---|
| `mh` | `{date, passed, total?}[]` 必修passedの日次スナップ（観測・穴あり） | `zss:materialHist` |
| `anchorEvents` | 必修コースの「教材がpassedになった時刻」イベント列 | `completionEvents(必修resultLog, 必修movieEvents)` |
| `totalNow/passedNow` | 現在の必修 総数/完了（ライブ） | `fetchCourseMaterials` |
| `la` | 日別学習数（合算・近似の最後の砦） | `merged`（getSeries+14日窓） |
| `todayISO` | 学習日（5:00境界） | `zenTodayISO` |

教科別版 `buildCourseSeries(courseId)` は同じアルゴリズムを CPH＋教科別アンカーで実行する
（コアの戻り値に9教科×365日を抱き込まない。必要時にオンデマンド導出＝ペイロード肥大回避）。

## 2. 出力

```ts
interface SeriesPoint {
  date: string;                       // zen-day (5:00境界)
  delta: number | null;               // その日の必修消化。null=不明（0ではない）
  cum: number;                        // その日終了時点の必修passed（推定含む）
  source: 'observed' | 'anchor' | 'approx'; // deltaの出所（nullの日は直近の推定でcumのみ）
  estimated: boolean;                 // cum が推定（外挿/整形）か＝UIの点線判定
}
interface RequiredSeries {
  points: SeriesPoint[];              // 日付昇順・連続（範囲内の全日を含む）
  total: number;                      // 現在の必修総数
  quality: {
    observedDays: number;             // MH由来の有効日
    anchorDays: number;               // アンカー由来の有効日
    approxDays: number;               // LA近似の有効日
    validDays: number;                // delta!=null の日数（MC発動判定に使う）
  };
}
```

## 3. アルゴリズム

### 3.1 区間分割（ロールオーバー境界）
MH で (a) `total` が変化 (b) `passed` が減少 した点は学年入替＝別カリキュラム。
**最後の境界以降のみ**を系列化する（境界より前の cum は現在の total と比較不能）。
アンカーイベントも境界日より前は捨てる。

### 3.2 アンカー日別Δの構築
`anchorEvents` を zen-day で集計 → `anchorDelta[date]`。
アンカーの被覆窓 = `[最古アンカー日, 最新アンカー日]`。

**被覆窓内の無イベント日は delta=0（source:'anchor'）とみなす。**
根拠: 必修章はテスト/レポートが数本の動画おきに挟まる構造で、学習日はほぼ必ずアンカーを跨ぐか
補間窓に入る。取りこぼし（窓不整合の動画のみの日）は下方バイアスとして受容し、
被覆窓の 0 は「実質学習なし」の推定として統計に含める（含めないとペース過大）。

### 3.3 MH（観測）との整合（reconciliation）
MHスナップ日には**正確な cum** がある。隣接スナップ (d1,c1)→(d2,c2) の区間について:
- 区間内の真の消化合計 = `c2 − c1`（確定）
- 区間内のアンカーΔ合計 = `S`
- **S > 0**: 各日のΔを `(c2−c1)/S` 倍にスケール（形はアンカー・総量は観測に一致）。source:'anchor'、
  ただし両端スナップ日は source:'observed'。スケール後も cum は d2 で c2 に一致する。
- **S = 0 かつ c2−c1 > 0**: 消化はあったが日割り不明 → 区間の各日 delta=null とし、
  d2 に集約しない（曜日統計を汚さない）。cum は線形補間（estimated=true）。
  ペース計算には「区間平均 (c2−c1)/日数」として使えるよう、quality とは別に
  区間集約値を消費者が gap 方式で扱う（§4）。
- **S=0 かつ c2−c1=0**: 全日 delta=0（source:'observed' 扱い＝真の休息日）。

### 3.4 MH以前（導入前）の外挿
最古MHスナップ (d1,c1)（無ければ今日, passedNow）を終端固定とし、
アンカーΔを**後方に積み戻して cum を外挿**（courseRetroRemaining と同法）。
source:'anchor'、estimated=true。被覆窓より前は系列に含めない（不明を作らない）。

### 3.5 最終日
末尾は必ず `今日, cum=passedNow, source:'observed'`（ライブ値）。
最新スナップ〜今日の間は §3.3 と同じ整合を適用。

### 3.6 LAフォールバック
**MHが1点も無く、かつアンカーも無い**（新規導入・未抽出）ときのみ、
LA日別を delta として採用（source:'approx'）。cum は passedNow から積み戻し。
UI は「暫定（全学習の合算・詳細ログの抽出で精密化）」を注記する。

## 4. 消費者の書き換え

| 消費者 | 現状 | 統一後 |
|---|---|---|
| 実績カーブ | MH直接＋RL外挿を別計算 | `points` → remaining=total−cum。estimated で実線/点線 |
| dailySamples (MC/EWMA/曜日重み) | 3段構えの全取っ替え | `points` の delta!=null 日。S=0区間は (c2−c1)/日数 を gap サンプルとして追加 |
| MC発動 | ソース別の場当たり判定 | `quality.validDays >= 5` |
| fallbackPerDay | 独自の28日差分 | 系列の直近28日: (cum末−cum始)/日数 |
| requiredAdvice recentPerDay | 独自の28日差分 | 同上（共通ヘルパ） |
| 教科別バーンダウン/ペース | CPH+RL別計算 | `buildCourseSeries(courseId)` に統一 |
| 課外（elective） | EPH独自 | 同アルゴリズムの elective 版（アンカー=課外resultLog） |

## 5. ペイロード/性能

- 導出のみ・保存なし。点数 ≤ 366（1年で区切り）。メモリ ≪ 100KB。
- 教科別はオンデマンド（選択された教科のみ導出）。
- 計算は O(days + events)。レンダリングごとに再計算して問題ない規模。

## 6. 既知バイアスと明示（UI注記に反映）

1. アンカー被覆窓内の「窓不整合の動画のみの日」→ 下方バイアス（学習したのに0扱い）。
2. §3.3 スケーリングは「区間の総量は正・日割りは近似」。曜日統計は形に依存。
3. LA近似は必修/課外を分離できない（上方バイアス）→ approx タグと注記で明示。

## 7. テスト計画（純関数）

- MHのみ / アンカーのみ / 両方（穴埋め・スケール一致） / どちらも無し（LA）
- S=0かつ差分>0 の区間（null化・cum線形補間・gapサンプル）
- ロールオーバー境界での切断
- 被覆窓外に不明を作らない / 末尾=今日=passedNow
- quality カウントの正確さ
