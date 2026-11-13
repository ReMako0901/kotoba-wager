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
...[truncated 2700 chars]