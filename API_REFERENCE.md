# ZEN Study 学習統計 API リファレンス

> 目的: 自分のアカウントの学習データを、より良いUIで表示する個人用ブラウザ拡張機能の開発ベース。
> 調査日: 2026-07-17 / 対象: 自分のアカウント（S高）※個人IDは記載しない

## 技術構成
- フロント: **React + TanStack Query** の SPA（`www.nnn.ed.nico`）
- データ: **REST API `https://api.nnn.ed.nico/`**、Cookie セッション認証
- 拡張機能からは、ログイン中セッションの Cookie 付きで `fetch(url, {credentials:'include'})` すれば自分のデータを JSON で取得可能

## 【第一原則】絶対に守る制約（最優先・例外なし）
ZEN Study は N高／S高等の正式な授業で、文科省の単位認定等が関わる。以下を厳守。
1. **GET のみ使用。POST/PUT/PATCH/DELETE 等の状態変更通信は一切禁止（完全 read-only）。**
2. **動画の不正視聴・進捗の自動進行を行わない**（特に課題動画の視聴進捗の自動化は絶対禁止）。学習記録を書き換えない／偽装しない。
3. 本ツールは表示専用。実績を一切変えない。
4. コンテンツ本体のDL・保存もしない（第9条）。
> このリファレンス内の全エンドポイントは **GET のみ** を対象とする。書き込み系APIは調査対象外・使用禁止。

## ToS 上の位置づけ（要約）
- 自分のセッションで自分のデータを **read-only 取得 → 見やすく表示** は「私的使用」の範囲で低リスク（第8条2）。
- **コンテンツDL禁止(第9条)** には抵触しない（動画/教材本体は保存しない）。
- **サーバ過負荷禁止(第12条9)** に配慮：全コース×全章の一括取得は通信数が増えるので、キャッシュ＋段階取得＋低頻度で。
- 包括的裁量条項(第12条14)があるため「絶対セーフ」ではない。**公開配布するなら運営に事前確認推奨。**
- 規約全文: https://www.nnn.ed.nico/rules （最終改定 2026-07-16）

---

## エンドポイント一覧（粗 → 細）

### ① 学習数 `GET /v2/learning_amounts`
```json
{
  "total_amount": 230,        // 累計
  "average_amount": 20.9,     // 直近2週平均
  "daily_amount": [           // 直近14日固定ウィンドウ
    {"date": "2026-07-10", "amount": 23},
    {"date": "2026-07-17", "amount": 4}
    // 学習前/データ無しの日は amount: null
  ]
}
```
- ⚠️ **`?from=&to=` は無視される。常に直近14日のみ返す。**
- → 長期グラフは拡張側で毎日スナップショットを保存して自前で蓄積する前提。

### ② レポート/月別進捗 `GET /v2/dashboard/report_progresses?service=basic`
```json
{
  "service": "basic",
  "alert": {
    "last_report_deadline_at": "2026-12-15T23:59:59+09:00",
    "required_course_count": 9,
    "taking_course_count": 9
  },
  "monthly_summaries": [
    {
      "year": 2026, "month": 7,
      "earliest_report_deadline": "2026-07-15T23:59:59+09:00",
      "total_chapter_count": 7, "passed_chapter_count": 2,
      "total_assessment_test": 0, "passed_assessment_test_count": 0
    }
    // 6月〜翌年まで月別に続く
  ]
}
```

### ③ 学力スコア(ZAスコア) `GET /v3/dashboard/scale_scores`
```json
{
  "kyoukas": [
    {
      "id": 2, "name": "英語",
      "latest_level_name": null, "latest_level_image_url": null,
      "latest_percentage": null, "latest_scale_score": null,
      "former_percentage": null, "former_scale_score": null,
      "latest_event_id": null
    }
    // 国語(0)/数学(1)/英語(2)/理科(3)/社会(4)...
  ]
}
```
- 教科別スコア/レベル/前回比(former→latest)。未受験は null。
- ⚠️ **実アカウントでも全教科 null を再確認（2026-07-17）**。ZAスコアは**必修とは別枠の「指定テスト」受験が前提**で、受験するまで値が入らない。→ 「教科別スコア推移」機能はデータが無く**現状は実装不可**（受験後に要再調査）。教科ID: 国語0/数学1/英語2/理科3/社会4/情報5…。

### ④ コース一覧 `GET /v3/dashboard/my_courses?service=basic&limit=20&offset=0`
- コース別のレポート進捗（x/y）。ページング対応（limit/offset）。
- UI 実測（受講中9コース）: 英語コミュニケーションIII=6/12、論理・表現III=0/6、数学C=0/6、数学III=0/9、総合的な探究の時間III=1/1、物理=0/12、特別活動III=0/1、情報II=0/4、体育III=0/2。
- ※ 各コースの `courseId` を取得できる（例: 英コミュIII = 2537）。

### ⑤ コース詳細（章一覧） `GET /v2/material/courses/{courseId}?revision=1`
- 章ごとの **進捗% ・章ID・レポート提出状況**。
- UI 実測（courseId=2537, 全12章）:
  - 第1〜6回 = 進捗100%・レポート提出済（chapterId 31506〜31511）
  - 第7回 = 進捗52%（chapterId 31512）
  - 第8〜12回 = 進捗0%（chapterId 31513〜31517）

### ⑥ 章詳細（教材一覧） `GET /v2/material/courses/{courseId}/chapters/{chapterId}`
> `?revision=1` は付けなくても200。**動画の署名付き content_url が含まれる**ため取り扱い注意（表示専用ツールでは content_url は使わない）。

レスポンス構造（chapter 31512 実測）:
```
{
  "course_type": ..., "subject_completed": ...,
  "chapter": {
    "id", "title", "outline", "thumbnail_url", "open_section_index",
    "progress": { "total_count": 21, "passed_count": 15, "status": "ready" },
    "sections": [ /* 教材の配列（21件） */ ]
  }
}
```
各 `section` のフィールド:
| フィールド | 意味 |
|---|---|
| `resource_type` | `movie` / `evaluation_test`(選択・記述) / `essay_test`(論述) / `evaluation_report` / `essay_report` |
| `id`, `title` | 教材ID・タイトル |
| `passed` | 視聴済/合格フラグ(bool) |
| `length`, `vr_length` | **動画の秒数**（movieのみ。例 185=3:05） |
| `total_question` | **テストの問題数**（test系のみ） |
| `textbook_info` | 教科書ページ（例 "54-55P"） |
| `material_type` | **`main`=必須教材 / `supplement`=視聴任意**（実測: 章31514は27sections=main23+supp4で `total_count=23`、章31620は22=main18+supp4で `total_count=18`）。**本家の progress（total_count/passed_materials）は main のみを数える**。supplement は `passed:true` でも進捗に入らない。集計を本家と揃えるには supplement を除外すること（単体・batch `/v2/material/chapters` どちらの形でも返る） |
| `playback_position` | 視聴位置(未視聴=-1)。※read-onlyで表示のみ、書き換え厳禁 |
| `content_url` | 署名付き動画URL（**使用しない**） |

**章ごとの集計例（chapter 31512）**: movie=13本 / 合計 3067秒=**51.1分**、evaluation_test=4 + essay_test=2 = 確認テスト6、evaluation_report=1 + essay_report=1 = レポート2、進捗 15/21。
→ **コース単位の集計 = 全章の ⑥ を取得して合算**（章数ぶんのGETが必要 → レート配慮）。

### 完了記録エンドポイント（★書き込み・**絶対に送信しない**／HAR実測）
本家が「完了/提出」時に送る**状態変更リクエスト**。我々は observer.js で**観測のみ**し、送信は一切しない（第一原則）。
- 動画完了: `PUT /v1/n_school/courses/{c}/chapters/{ch}/movies/{id}/progress/passed`（204）＋ `PUT …/playback`（視聴位置）
- テスト提出: `POST /v1/n_school/courses/{c}/chapters/{ch}/evaluation_tests/{id}/answerings`（201）
  - ⚠️ `answerings` は**提出**なので自動採点の**不合格でも発火**しうる → 検知はトリガー扱いにし、`GET my_courses` の **passed 合計が実際に増えた時だけ**カウントする（誤検知防止）。
- 完了後、本家自身が `GET /v2/material/courses/{c}/chapters/{ch}?revision=1` で章を再取得しUI更新。

### プロフィール `GET /v1/users?revision=2`
- ID、ニックネーム、アイコンURL、所属校（S高）など。
- 派生: `?with=authorized_clients`（連携アプリ）、`/v1/users/bindings?revision=2`（アカウント連携）。

### ⑦ ライブ授業 `GET /v1/lessons?mode=schedule&taken=true&limit=21`
- ライブ授業のスケジュール／視聴履歴。`taken=true` で **受講(出席)済のみ** に絞れる。
- 補助: `GET /v1/tags/lesson_search`（検索タグ一覧）。
- ※ この account は該当授業なし（受講コース由来の授業が無い状態）。

### ⑧ フォーラム `GET /v3/forum/*`
- `GET /v3/forum/menu` … チャンネル/トピック構成（組織・全般・運営・大学受験・語学・プログラミング 等）
- `GET /v3/forum/channels/{channelId}/threads?with_channel=true` … チャンネル内スレッド一覧（返信数・閲覧数・解決状態）
- `GET /v3/forum/my_threads` … **自分の投稿スレッド一覧（個人のフォーラム活動）** ← `/questions/activity`
- ※ この account は投稿履歴なし。

### テスト点数について
- **定期テスト/学力スコア = ③ `scale_scores`**（教科別 scale_score / percentage / level、former→latest 推移）。`latest_event_id` でテストイベントを識別。
- **章内の確認テスト**は ⑥ で「問題数」まで見えるが、**正答率/得点の取得は受験済データが要る**（本 account は未受験のため shape 未確認）。→ 受験後に要再調査(TODO)。

### その他観測されたもの
- `GET /v1/notices/unreads` … 未読通知数
- `GET /v2/announcements` … お知らせ
- `GET /v3/notices/importants` … 重要なお知らせ
- `GET /v1/official_events/unreads` … 公式イベント未読数
- `GET /v3/material/genres` … 教材ジャンル分類（/home のジャンル帯）
- `GET /v2/material/recommendations` … **ジャンル別おすすめコース**（`recommendations:[{header, courses[]}]`）。※教材ディスカバリ用で「自分の必修の次にやる教材」ではない → デイリークエスト等には使えない。
- `GET /v1/lessons?mode=after&taken=false` … 今後の受講可能ライブ授業（`mode` は `schedule`/`after`/`batch`。batch は `ids[]` 指定）

---

---

## 【重要】N Lobby（別ポータル `nlobby.nnn.ed.jp`）の必修・卒業要件データ
N/S/R高の生徒ポータル。ZEN Study(`www.nnn.ed.nico`)とは**別ドメイン・別API**。
`/required/progress`（必修 > 進捗）に、卒業要件の権威的トラッカーがある。

**技術構成**: Next.js + **tRPC**（`https://nlobby.nnn.ed.jp/api/trpc/*`）。
- クエリ(読み取り)は GET、ミューテーション(書き込み)は POST という標準構成に見える:
  - GET: `notification.getMessages`, `news.getUnreadNewsCount`, `menu.findMainNavigations`, `interest.readInterestsWithIcon`
  - POST: `user.updateLastAccess`(明確な書き込み), **`requiredCourse.getRequiredCourses`**
- ⚠️ **`requiredCourse.getRequiredCourses` は POST**（兄弟のqueryはGETなのに、これだけPOST＝ルータ上は**mutation定義の可能性**）。名前は"get"でも副作用がある恐れがある。

### 【第一原則との衝突】と実験結果（2026-07-17・ユーザー承認のもと限定実験）
- GET を試すと **404 `No "query"-procedure on path`** → `getRequiredCourses` は tRPC の **mutation として登録**（query では無い）。名前は"get"でも型はmutation＝**POSTでしか呼べない**。
- ユーザー承認のもと **POST `{"json":null}` を実験** → **200 OK**。CSRFブロック無し。2回叩いて同一データ＝**実挙動は冪等な read-only**（副作用は観測されず）。ただし**形式上はmutation/POST**であり、第一原則「POST禁止」には形式的に抵触する。
- **出荷方針（推奨）**: shipで安全側に倒すなら、POSTを拡張から発行せず、生徒本人が `/required/progress` を開いた時の**描画済みDOMを read-only スクレイプ**（我々は一切リクエストを発行しない）。同じ内容が取れる（下記JSONと同義の情報がDOMに出る）。→ nlobby host を足して read-only content script。
- POSTを許容する場合のみ `getRequiredCourses` を直接利用可（要ユーザー明示合意で原則を緩和）。**判断はユーザー保留中。**

### 確認済みレスポンス構造 `POST /api/trpc/requiredCourse.getRequiredCourses`（body `{"json":null}`）
```
result.data:
  educationProcessName: "2022年度以降教育課程"
  previousRegistration: { previousRegistrationAcademicCredit: 60, previousRegistrationCredit: 60 }  // 既修得単位
  termYears: [{
    termYear: 2026, grade: "3年次", term: 4, subjectStatus, entryStatus,
    courses: [{                          // 必修9科目
      curriculumCode, curriculumName,     // 例 "00004"/"数学"
      subjectCode, subjectName,           // 例 "12017"/"数学Ⅲ"
      subjectStatus, previousRegistration,
      report:        { count, allCount }, // 提出済/全（例 0/9）
      assessmentTest:{ count, allCount },
      reportDetails: [{ number, progress, score, expiration, type, name }],
        // ★per-レポート明細: 進捗%・得点(未採点null)・締切(ISO)・種別・名称
        //   例 {number:1, progress:NN, score:null, expiration:"2026-06-14T15:00:00Z", type:"report", name:"【第N回】…"}（値は例）
        //   ※expiration の 06-14T15:00Z = JST 6/15 00:00 = 提出期限6/15
      schooling:     {...},  // スクーリング(SC)出席: 申込/出席 X/Y（卒業要件の柱）
      test:          {...},  // テスト(試験): 未受験/なし 等
      acquired:      {...},  // 単位取得状況
    }]
  }]
```
→ **ZEN Studyに無い決定的データ**: ①レポート1回ごとの**正確な締切ISO＋名称**、②**スクーリング出席**要件/実績、③**テスト(試験)**、④**単位(60等)**。予測を「教材消化→レポート」だけでなく **卒業要件3本柱（レポート＋SC＋テスト）** に拡張できる。

### N Lobby の他ルート（読み取り・GETクエリ中心）
- ルート: `/home` `/news/` `/calendar/` `/required/` `/submissions/` `/ext-acts/` `/plus-one`。メニューは `GET menu.findMainNavigations`（query/GET・原則安全）。
- `GET calendar.getLobbyCalendarEvents` / `getGoogleCalendarEvents`（**query/GET・`{from,to}` 任意範囲**）／`getLobbyCalendarFilters`。→ 中身は**予定/イベント**（Google共有カレンダー＋Lobbyイベント）で、当該アカウントは過去範囲でも**空**。**日別の“学習量”ではない**。
- `/submissions/`（提出物）＝当該アカウントは0件（先生課題なし）。専用tRPC呼び出しも無し。
- 共通: `notification.getMessages`/`news.getUnreadNewsCount`(GET), `user.updateLastAccess`(POST=書き込み・使わない)。

### 【結論】14日窓は API では突破不能（2026-07-17・ZEN Study＋N Lobby 実測）
- 日別の**学習量**時系列を14日超で返すエンドポイントは、ZEN Study にも N Lobby にも**存在しない**。
  - ZEN Study `learning_amounts` は14日固定（再確認）。履歴/活動系は23種404（既報）。/home・/settingにも新規無し。
  - N Lobby は「現在の必修進捗(状態)」＋「予定カレンダー(範囲GET可だが学習量でない)」で、**日別学習の履歴は持たない**。
- → **自前スナップショット蓄積（訪問時＋14日窓マージ）が唯一の長期履歴生成手段**であることが確定。だからこそ **バックアップ/エクスポート機能が実質必須**（消えたら復元不能）。
- N Lobbyが唯一持つ価値は「卒業要件の状態(レポート毎締切/SC/テスト/単位)」で、これは*日別履歴とは直交*（14日窓問題は解決しない）。取り込むなら別目的（卒業要件ダッシュボード）として、DOM read-onlyスクレイプ推奨。

### `/required/progress` が表示する内容（DOM実測・3年次2026年度）
- **各月レポート提出状況**: 月別に `提出済N回/全M回` と % （6/15〜12/15の7枠）。
- **各科目進捗**（必修9科目: 数学Ⅲ/数学Ｃ/物理/体育Ⅲ/英語コミュⅢ/論理・表現Ⅲ/情報Ⅱ/総合探究Ⅲ/特別活動Ⅲ）。科目ごとに:
  - **レポート**: `レポート全N回` ＋ 各回の `進捗% / 点 / 個別期日(X/15まで)` ← **ZEN Studyに無い“レポート1回ごとの締切”がここにある**（例 数学Ⅲ: 1回6/15, 2回7/15, 3回8/15, 4回8/15, 5回9/15, 6回10/15, 7回11/15, 8回11/15, 9回12/15）。
  - **スクーリング(SC)出席**: `申込済 X/Y`・`出席済 X/Y` ← **卒業要件の柱だがZEN Studyに無いデータ**。
  - **テスト(試験)**: `未受験 / なし`。
  - **総合ステータス**: 例「レポート・SC未完了」。
- 注記「教職員による採点・登録が完了次第更新」。

→ **示唆**: 卒業/進級要件は「レポート＋スクーリング出席＋テスト」の3本柱。現行予測は教材消化→レポートのみ。N Lobbyデータを（安全なDOM読取で）取り込めれば、**per-レポート締切の正確化**＋**SC/テストを含む本当の“卒業要件ダッシュボード”**に拡張できる。

## データ階層まとめ
```
アカウント
 ├─ ① 学習数(日別14日 / 累計 / 2週平均)
 ├─ ③ 教科別スコア
 └─ ② 月別レポート進捗
      └─ ④ コース(courseId)  … レポート x/y
           └─ ⑤ 章(chapterId) … 進捗% / レポート提出
                └─ ⑥ 教材     … 動画(視聴済/再生時間/教科書P) / 確認テスト(問題数)
```

## 実装メモ
- 一部APIはクエリ文字列が必須（my_courses, material系）。実拡張では Cookie 付きで直接叩ける。
- 全コース×全章を舐めると通信数が多い → localStorage/IndexedDB にキャッシュし、変化検知で差分取得。
- 学習数の長期履歴は API に無い → **毎日1回スナップショットを保存**して自前で時系列を作る。

## 調査で「存在しない」と確定したもの（2026-07-17・実アカウント精査で再確認）
GETで網羅的に探索した結果、以下はAPIに**存在しない**:
- **学習の開始日/入学日**: `users` の全フィールド `[zane_user_id,name,icon,sex,authority,payment,payments,is_chargeable,is_personal_information_needed,capabilities]` に**日付フィールドゼロ**。`my_courses` の `services[].courses[]` にも日付キーゼロ。`bindings`・`material/courses`・`payments` にも無し。
- **履歴/活動ログ/出席/学習カレンダー系エンドポイント**: 前回23種＋今回22種（統計/記録/ゲーミフィケーション: `learning_amounts/{monthly,weekly,history}`,`dashboard/{summary,study_time,statistics}`,`{badges,achievements,streaks,points,medals}`,`material/progresses`,`users/me` 等）**全て404**。
- **教材の完了日時(passed_at)**: `section` に無し（`passed` は真偽のみ）。
- **14日超の日別学習数**: `learning_amounts` は **8種のパラメータ（`from`/`to`, ISO付`from`/`to`, `days`, `limit`, `period`, `year`+`month`, `unit`）全てを無視**し、常に同一の14日（今回 07-04〜07-17・total 267）を返すことを実レスポンス比較で確定。`v1`/`v3`/`dashboard` 版は404。

### `my_courses` 完全構造（`GET /v3/dashboard/my_courses?service=basic&limit=20&offset=0`）
```
{ services: [{
    name:"basic", total_course_count:9, periodic_exam_title:null,
    courses: [{ id, type, title, selection_status, selected, on_calculation,
      progress:{ total_count, passed_count, total_assessment_test, passed_assessment_test_count },
      comprehension: null   // 理解度らしき枠。未受験で null（テスト受験で埋まる可能性）
    }]
}]}
```
- 新規観測フィールド: **`comprehension`（理解度）**・`periodic_exam_title`（定期試験）。当該アカウントは両方 null。→ スコア系(ZA)と同様、テスト受験まで空。
- **結論**: ZEN Study API は「現在の状態＋14日日別窓」まで。履歴・開始日・per-レポート締切・テスト結果は取得不能（per-レポート締切とSC/テスト/単位は N Lobby のみが保持）。**自前蓄積＋現状スナップショット＋モンテカルロの現行設計が、取れる範囲の最大**であることが精査で確定。

→ **開始日基準の生涯平均は算出不能**。予測は「正確な残り ÷ 直近ペース(14日窓+自前蓄積)」＋モンテカルロで、開始日に依存しない設計にした。

## TODO（追加調査予定）
- [x] ライブ授業(`/lessons`)の出席・視聴履歴 API → `GET /v1/lessons?taken=true`
- [x] フォーラム(`/questions`)の投稿・活動 API → `GET /v3/forum/my_threads`
- [ ] 確認テストの結果(正答率)取得可否 → **受験済データが必要。要再調査**
- [ ] 定期テスト/実力診断の個別イベント詳細（`latest_event_id` から辿れるか）→ ZAスコアが null の間は `latest_event_id` も null で辿れない

## 再調査の結論（2026-07-17 / 実アカウントのネットワーク実測）
`/setting`・`/home` のダッシュボードが実際に叩くGETを観測。**学習統計に使える新データ源は無し**と確認：
- 学習の長期日別・教科別日次・完了日時を返すエンドポイントは（今回も）存在しない。
- ZAスコアは全教科 null（上記）。おすすめ教材はジャンル discovery で必修と無関係。
- → 既存設計（自前スナップショット蓄積 ＋ 正確な残り ＋ 直近ペース＋モンテカルロ）が、APIから取れる範囲でのベスト。目玉データは概ね抽出済み。
