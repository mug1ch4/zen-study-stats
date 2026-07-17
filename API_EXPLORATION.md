# ZEN Study API 追加探索メモ（GETマップ拡張）

> 調査日: 2026-07-17 / 対象: 自分のアカウント（S高）※個人IDは記載しない / 手法: ログイン済セッションで各 read-only ページを navigate → `read_network_requests`(api.nnn.ed.nico) で観測 → 観測された **GET のみ** を `fetch(method:'GET')` で再取得し構造だけ抽出。
> **全て read-only。状態変更(POST/PUT/PATCH/DELETE)は一切送信していない。** 署名付きURL/トークン/長文字列は `<omitted>`。
> 既知＝`API_REFERENCE.md` に記載済。新規に注力。

## 巡回したページと観測結果（api.nnn.ed.nico）
| ページ | 観測された API |
|---|---|
| `/home` | `/v1/lessons?mode=schedule\|after&taken=false`（既知系）, `/v2/material/recommendations`★新, `/v1/users?revision=2`（既知）, `/v1/notices/unreads`（既知）, `/v3/notices/importants`★新, `/v2/announcements`（既知）, `/v3/material/genres`★新, `/v1/official_events/unreads`★新, `/v2/material/courses?mode=batch&ids[]=`★新, `/v2/material/chapters?queries[][course_id]&[chapter_id]`★新, `/v1/lessons?mode=batch&ids[]=`★新 |
| `/my_course`, `?tab=basic`, `?tab=general` | `/v2/dashboard/report_progresses?service=basic`（既知②）ほか既知。課外タブは追加API発火せず（genres/recommendations で構成） |
| `/courses/2537` | `/v2/material/courses/2537?revision=1`（既知⑤） |
| `/courses/2537/chapters/31513` | `/v2/material/courses/{c}/chapters/{ch}?revision=1`（既知⑥） |
| `/questions`, 任意ch | `/v3/forum/menu`, `/v3/forum/channels/{id}/threads?with_channel=true`（既知⑧） |
| `/questions/activity` | `/v3/forum/my_threads`（既知⑧） |
| `/lessons` | `/v1/lessons?mode=schedule&taken=true&limit=21`, `/v1/tags/lesson_search`（既知⑦） |
| `/notices` | `/v1/notices`★新(GET)。**加えてアプリ自身が `POST /v1/tokens/csrf` と `PUT /v1/notices/{id}/mark` を発行**（＝既読化。観測のみ・未呼出） |
| `/setting` | `/v1/users?with=authorized_clients`, `/v1/users/bindings`, `/v2/learning_amounts`, `/v2/dashboard/report_progresses`, `/v3/dashboard/scale_scores`（すべて既知） |
| `/help` | 追加APIなし（外部ヘルプ） |

## 新規 GET エンドポイント詳細
| エンドポイント (GET) | 用途 | レスポンス構造（要約） | 拡張での活用 / フォールバック性 |
|---|---|---|---|
| `/v2/material/courses?mode=batch&ids[]=…` | **複数コースを一括取得** | `courses[]` 各: `id,type,title,selected,subject_category,progress,chapters[]`。**progress** = `{total_count/passed_count(章), total_chapters/passed_chapters, total_assessment_test/passed_assessment_test_count, total_materials:252, passed_materials:148, on_calculation}` | ★**最有力**。1リクエストでコースの**全教材数・合格教材数**を集計取得（従来は全章⑥をGETして合算が必要だった）。ids[] で複数コース同時。毎日スナップショットで **教材消化の長期時系列** を自前蓄積できる |
| `/v2/material/chapters?queries[][course_id]=&queries[][chapter_id]=…` | **複数章を一括取得**（sections入り＝⑥のバッチ版） | `chapters[]` 各: `id,title,outline,open_section_index,progress{total_count,passed_count,status},sections[],course_type` | ★通信数削減。全章の教材内訳を少ないリクエストで取得。レート配慮(規約12-9)に有効 |
| `/v3/material/genres` | 教材カタログ | `genres.advanced{title:"課外授業", packages[26]}`, `genres.basic{title:"必修授業", packages[1]}`。package=`{id,type,title}` | 課外/必修のパッケージ一覧。教材メタの一括把握に。課外は dashboard 系に出ない |
| `/v2/material/recommendations` | おすすめコース | `recommendations[5]` 各 `{header, courses[]}`。course に `progress.comprehension{limit,bad,good,perfect}`, `progress.checkpoint{total,clear}`, `short_test{total_short_test,total_passed_short_test}` | 課外(advanced)コースの **理解度(good/bad/perfect)・チェックポイント・小テスト** 指標が見える。課外の成績系メトリクスとして有用 |
| `/v1/notices` | 通知一覧 | `notices[]` = `{id,notice_type,target_id,target_type,title,description,resource(url),created_at(epoch)}` | 通知表示用。閲覧のみ（既読PUTは呼ばない） |
| `/v3/notices/importants` | 重要通知 | `{importants:[]}`（現在空） | 重要通知バナー用 |
| `/v1/official_events/unreads` | 公式イベント未読 | `{official_events:[]}`（現在空） | バッジ用 |
| `/v1/lessons?mode=batch&ids[]=` | ライブ授業を id 一括取得 | `lessons[]` 各: id,title 等 | 授業カード補完 |

## 観測された書き込み系（**URL/メソッドのみ記録・呼び出していない**）
| メソッド | URL | 契機 |
|---|---|---|
| POST | `/v1/tokens/csrf` | `/notices` 表示時にアプリが自動発行（CSRFトークン発行） |
| PUT | `/v1/notices/{id}/mark` | `/notices` 表示時にアプリが自動で通知を既読化 |

> 注意: `/notices` を開くと **アプリ自身が既読化 PUT を発行**する（当方は未発行）。拡張で通知取得したい場合は `/v1/notices`(GET) のみ使用し、`/notices` ページ遷移や mark を行わないこと。

## サービス変種の確認
- `/v2/dashboard/report_progresses?service=general` → **400 Invalid Param**
- `/v3/dashboard/my_courses?service=general` → **400 不正リクエスト**
- → 課外(general/advanced)は dashboard 集計に非対応。課外の進捗は `material/genres` + `material/courses?mode=batch`（comprehension/short_test 付き）で取得する設計。

## 長期履歴フォールバックの結論
- **新たな長期「学習量」エンドポイントは見つからず**。`/v2/learning_amounts` は依然 14日固定 → 自前で毎日スナップショット蓄積の方針は変わらず。
- ただし長期時系列の材料になりうる新規発見:
  1. **`/v2/material/courses?mode=batch`** の `progress.passed_materials / total_materials`（コース単位の累積消化量）を毎日1回スナップショット → **教材消化の長期グラフ**を自前生成可能。従来⑤/⑥を全章舐める必要がなく低コスト。
  2. 既知 ② `report_progresses.monthly_summaries` は月次の章/課題合格数の時系列（=事実上の月別履歴）。学習量ではないが「月ごとの進み」の長期表示に使える。
- 成績/理解度系の新規: 課外コースの `comprehension{good/bad/perfect}` と `short_test{total,passed}`（recommendations / courses batch 経由）。必修コースの章内確認テストの正答率は依然未受験のため shape 未確認（TODO 継続）。

## 拡張への推奨
1. コース集計は **`courses?mode=batch&ids[]=`（全受講コースID一括）** に置き換え → リクエスト数を 1〜数本に圧縮しつつ `total_materials/passed_materials` を取得。
2. 章内訳が必要な時は **`chapters?queries[]…`** でバッチ取得。
3. 毎日: `learning_amounts`(14d) + 各コース `passed_materials`(batch) + `scale_scores` をスナップショット保存 → 長期時系列を自前構築。
