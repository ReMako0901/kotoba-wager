# Phase 1 実装指示書（Codex 向け）

作成: 2026-11-13（仕様整理担当 Muse）。対象は PROJECT_PLAN.md の Phase 1（移行）。
着手前に `AGENTS.md`、`PROJECT_PLAN.md`（特に §4 決定事項と §6 守る仕様）、
`docs/HOSTING_OPTIONS.md`、`docs/STATUS.md`、`docs/TODO.md` を読むこと。
本書と PROJECT_PLAN.md / AGENTS.md が食い違う場合は、勝手に決めずユーザーへ報告して止まる。

## 0. Phase 0 で確定済みの値（実測・実施済み。そのまま使う）

| 項目 | 値 |
|---|---|
| Google Cloud プロジェクト ID | `kotoba-wager` |
| プロジェクト番号 | `108927229642` |
| リージョン | `asia-northeast1`（Cloud Run / Firestore / Cloud Tasks 共通） |
| Firestore | `(default)`、Native、Standard、asia-northeast1（作成済み） |
| Gemini API キー | Secret Manager の `kotoba-wager-key` に登録済み |
| 実行サービスアカウント | `108927229642-compute@developer.gserviceaccount.com`（Compute Engine 既定。`kotoba-wager-key` への secretAccessor 付与済み） |
| 有効化済み API | Cloud Run / Cloud Build / Artifact Registry / Firestore / Cloud Tasks / Secret Manager / Generative Language |
| AI Pro 月 $10 クレジット | 適用済み |
| 予算アラート | 設定しない（ユーザー決定。通知のみの仕組みのため任意） |

## 1. 実装タスク

### T1. 保存層の Firestore 化

- `backend/app/store.py` の役割（load / save / recover と、呼び出し側が使うロック相当の
  直列化）を Firestore 実装に置き換える。移行先でも現行のゲーム動作と API 外部契約は変えない。
- バックエンドは環境変数 `STORAGE_BACKEND` で切り替える。`file`（現行 JSON 実装、既定）/
  `firestore`。既定が `file` のままであること（既存 pytest と Render の現行運用を壊さない）。
- データ設計: コレクション `sessions/{session_id}` にセッション本体、
  `sessions/{session_id}/transactions/{transaction_id}` に取引を分ける。
  1 ドキュメント 1MiB 上限を踏まないこと（本文履歴を本体に際限なく埋め込まない）。
- 次の保証はプロセス内ロックではなく Firestore のトランザクションで担保する。
  - 冪等性: 同一 `request_id` の再送で再抽選しない（既存取引を返す）
  - 本文 version の検査: 古い version に対する保存を弾く
  - 確定済み（committed）取引の再処理防止: 処理開始時に状態を検査し、二重実行しても
    生成と反映が二重に走らない
- `recover()` 相当: 起動時に `generating` のまま残ったセッションを Firestore のクエリで
  拾い、再開対象として返す（現行の起動時復旧の意味を保つ）。
- Firestore への接続は ADC（Application Default Credentials）前提。キーや認証情報を
  コード・設定ファイルに直書きしない。Firestore のセキュリティルールは変更しない
  （サーバーは管理 SDK 経由でアクセスし、クライアント直アクセスはしない）。

### T2. 呼出カウンターの Firestore 化

- `backend/app/quota.py` の日次カウンターを、`STORAGE_BACKEND=firestore` のとき
  Firestore の `counters/{YYYY-MM-DD}`（UTC 日付）ドキュメントへ移す。
  増加と上限検査は 1 つのトランザクションで行い、並行リクエストで上限を超えない。
- 上限値は環境変数 `GEMINI_DAILY_CALL_LIMIT` のまま（移行検証中は 100、PROJECT_PLAN D6）。
  上限到達時のエラー文言と「勝敗と元の本文は保持する」挙動は現行どおり。
- `file` のときは現行のファイル実装のまま。

### T3. 生成方式の Cloud Tasks 化

- 現行の `engine.spawn`（`asyncio.create_task`）による応答後処理を、モード切替可能にする。
  環境変数 `GENERATION_TASKS_MODE`: `inline`（現行 spawn、既定）/ `cloud`（Cloud Tasks）。
- `cloud` のとき: 取引確定後、Cloud Tasks へタスクを登録する。タスクは内部エンドポイント
  `POST /internal/generation/process`（JSON: `session_id` と対象種別）を叩き、
  **そのリクエストの中で** `process_transaction` / `prepare_initial` を完了まで実行する。
  フロントのポーリング体験（生成中→反映）は現行どおり保つ。
- 内部エンドポイントの保護: Cloud Tasks が付ける OIDC トークンを検証する
  （発行 SA は実行 SA、audience は自サービスの URL）。検証に失敗したら 401/403 で即終了し、
  生成処理に入らない。ローカル・テストでは `inline` を使うため、この検証で詰まらせない。
- Cloud Tasks の at-least-once 配信を前提に、内部エンドポイントは冪等にする
  （T1 の committed 検査と合わせ、再配信で再抽選・二重生成しない）。
- 起動時復旧（recover で拾ったセッション）も、同じ経路（cloud なら enqueue、inline なら spawn）
  に寄せる。
- 設定は環境変数で受ける: `CLOUD_TASKS_PROJECT`（既定 `kotoba-wager`）、
  `CLOUD_TASKS_LOCATION`（既定 `asia-northeast1`）、`CLOUD_TASKS_QUEUE`（既定 `generation`）、
  `TASKS_TARGET_URL`（自サービスの URL。デプロイ時に設定）、
  `TASKS_SERVICE_ACCOUNT`（OIDC 用 SA。既定は実行 SA のメールアドレス）。

### T4. 依存関係の追加

- `google-cloud-firestore` と `google-cloud-tasks` を `backend/requirements.txt` と
  `backend/requirements.lock.txt` の両方に追加する（lock 側はバージョン固定）。
- Dockerfile は原則そのまま（PORT 環境変数で動く現行構成を維持）。

### T5. デプロイ定義と手順書（実行はしない）

- `docs/DEPLOY_CLOUD_RUN.md` を新規作成し、次を含むこと。
  - ユーザーが実行する事前作業: Cloud Tasks キューの作成コマンド
    （`gcloud tasks queues create generation --location=asia-northeast1`）、
    実行 SA への `roles/cloudtasks.enqueuer
...[truncated 2700 chars]` と
    `roles/run.invoker` の付与コマンド（対象は実行 SA。OIDC トークンの呼び出し用）。
  - `gcloud run deploy` の完全なコマンド: `--region asia-northeast1`、
    `--min-instances 0`、`--max-instances 3`、`--memory 1Gi`（初期値。実測で見直す）、
    `--set-secrets=GEMINI_API_KEY=kotoba-wager-key:latest`、環境変数
    `GEMINI_MODEL=gemini-3.1-flash-lite`、`GEMINI_DAILY_CALL_LIMIT=100`、
    `ALLOWED_ORIGINS=https://remako0901.github.io`、`STORAGE_BACKEND=firestore`、
    `GENERATION_TASKS_MODE=cloud`、`CLOUD_TASKS_PROJECT=kotoba-wager`、
    `CLOUD_TASKS_LOCATION=asia-northeast1`、`CLOUD_TASKS_QUEUE=generation`、
    `TASKS_SERVICE_ACCOUNT=108927229642-compute@developer.gserviceaccount.com`。
    実行 SA は既定の compute SA のまま（secretAccessor 付与済みのため）。
  - `TASKS_TARGET_URL` は自サービスの URL を指すため、初回デプロイ後に確定する。
    確定後に環境変数を更新するコマンドも手順に含める（自己参照になる点に注意）。
  - Phase 2 用に、切替手順（GitHub の Repository variable `API_BASE_URL` を新 URL へ）と
    切り戻し手順（`API_BASE_URL` を Render の URL へ戻す。Render は承認まで残す）を書く。
- 同内容を `scripts/deploy_cloud_run.sh` として用意してもよいが、実行は Phase 2 で
  ユーザーが行う。スクリプト冒頭に「ユーザー承認後に実行すること」と明記する。

### T6. テストと検証

- 既存 pytest を全て通す（既定モード: `STORAGE_BACKEND=file`、
  `GENERATION_TASKS_MODE=inline`。現行の Render 運用が壊れていないことが前提）。
- Firestore エミュレータを使う store テストを新規追加する。対象は少なくとも次の4点。
  - 冪等性: 同一 `request_id` の再送で再抽選しない（既存取引が返る）
  - version 検査: 古い version での保存が弾かれる
  - committed 取引の再処理防止: 内部エンドポイントを再配信しても二重生成しない
  - quota: 上限到達で `reserve_call` が現行どおりのエラーになり、並行実行でも上限を超えない
- エミュレータを用意できない場合は fake 実装で代替してよいが、その場合は
  `docs/STATUS.md` と完了報告に「エミュレータ未実施」と明記する（実施済みにしない）。
- ローカル通し確認: 開始 → 取引 → 生成 → 反映 → 次ラウンドまで進むこと。
  少なくとも既定モード（file + inline）で必須。Firestore + エミュレータでも行うのが望ましい。

### T7. 文書の更新

- `docs/STATUS.md`、`docs/TODO.md`、`docs/CHANGELOG.md` を実際の変更と検証結果に合わせて更新する。
- PROJECT_PLAN.md の決定事項（§4）を変える必要が生じたら、勝手に書き換えず、
  理由と合わせてユーザーへ報告して止まる。

## 2. やらないこと（Phase 1 の範囲外）

- みんなの物語（`public_stories`、Phase 3）の実装。
- フロントエンドの変更。API の外部契約と `frontend/src/types.ts` の変更。
- 本番デプロイの実行、GitHub の `API_BASE_URL` 切替、`render.yaml` の削除、Render の停止。
- 課金・権限に関わる操作の実行（Cloud Tasks キュー作成、IAM 付与、Secret の変更）。
  これらはコマンドと手順の提示までを行い、実行はユーザーが Phase 2 で行う。
- 旧データの移行（D5 で移行しないと確定済み）。
- 分割（Sudachi 系）、抽選方式、個数方式、生成失敗時のフォールバック仕様の変更。

## 3. 守る仕様（要点）

詳細は PROJECT_PLAN.md §6 と AGENTS.md「サーバー移行」節が正本。

- 抽選は一度だけ確定して保存する。再送・再試行・再配信で再抽選しない。
- 生成失敗を敗北扱いにしない。失敗時は同じ勝敗で定型文フォールバックする。
- 本文とオフセットの対応を変えない。形態素解析を差し替えない。
- Gemini のキーをコード・Git・ログ・画面に出さない。Secret Manager 経由のみ。

## 4. 受け入れ条件（Phase 1 の完了の定義）

- 既存 pytest が全て通過し、Firestore エミュレータでの store テストが追加されている
  （代替した場合はその旨が明記されている）。
- ローカルで 開始→取引→生成→反映→次ラウンド が通り、再送で再抽選しないことを確認済み。
- 既定モード（file + inline）で現行の動作が壊れていない。
- `docs/DEPLOY_CLOUD_RUN.md` に、ユーザーの事前作業・デプロイコマンド・切替と
  切り戻しの手順が揃っている。

## 5. 完了時の報告

- 実装内容を T1〜T7 の番号ごとにまとめ、変更ファイルの一覧を添える。
- 検証は「既存 pytest」「エミュレータでの store テスト」「ローカル通し」「実 Gemini」
  「ブラウザ確認」「公開配信」の区分ごとに、実施したかどうかを分けて書く。
  未実施のものを実施済みと書かない。
- ユーザーが Phase 2 で実行する手順（キュー作成、IAM 付与、デプロイ、切替）への
  参照を明示する。
- 残課題と、Phase 2 への引き継ぎ事項（コールドスタート実測と D4 の最終判断を含む）を書く。
