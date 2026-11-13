# Cloud Run + Firestore への移行手順

**Phase 2 で所有者が実行する。Phase 1 では下記のクラウド操作を実行しない。**
対象は `kotoba-wager`、東京（`asia-northeast1`）、Firestore Native の `(default)`。
既存の Pages と Render は検証中そのまま運用する。旧セーブや呼出カウンターは移行しない。

## 1. キューと実行権限

以下は Cloud Shell の Bash に入力する。最初に対象プロジェクトと権限を確認する。すでに存在するキューや付与済みの権限は再作成しない。

```bash
PROJECT=kotoba-wager
REGION=asia-northeast1
SERVICE=kotoba-wager-api
QUEUE=generation
RUN_SA=108927229642-compute@developer.gserviceaccount.com

gcloud tasks queues create "$QUEUE" --project="$PROJECT" --location="$REGION" \
  --max-concurrent-dispatches=3 --max-attempts=12 --min-backoff=5s --max-backoff=60s

gcloud tasks queues add-iam-policy-binding "$QUEUE" \
  --project="$PROJECT" --location="$REGION" \
  --member="serviceAccount:$RUN_SA" --role=roles/cloudtasks.enqueuer

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$RUN_SA" --role=roles/datastore.user

gcloud iam service-accounts add-iam-policy-binding "$RUN_SA" \
  --project="$PROJECT" --member="serviceAccount:$RUN_SA" --role=roles/iam.serviceAccountUser
```

- Firestore は ADC で接続する。クライアント側から直接接続せず、Firestore ルールは変更しない。
- Cloud Tasks のサービスエージェントに通常の `roles/cloudtasks.serviceAgent` があることを確認する。タスクを作る実行 SA には、OIDC 発行に指定する SA への `iam.serviceAccounts.actAs` が必要。上では同じ SA を使う。
- Secret Manager の `kotoba-wager-key` に対する実行 SA の `secretAccessor` は Phase 0 で付与済み。キーの値は表示・コピーしない。Cloud Build の実行主体にはソースデプロイに必要な権限が別途必要。権限不足の場合は下記公式手順で対象の主体を確認する。

## 2. 新 API を配置する

Phase 1 実装を含む専用リポジトリのルートで実行する。実行前に `gcloud meta list-files-for-upload` でアップロード対象を確認する。Pages は一般公開 API を呼ぶため、この API サービスは公開アクセスを許可する。内部の生成パスはアプリが Google の署名、発行者、対象 URL、サービスアカウントを検証し、無認証の生成要求を拒否する。CORS は公開 API の認証としては機能しない。

```bash
gcloud run deploy "$SERVICE" --project="$PROJECT" --region="$REGION" \
  --source=. --service-account="$RUN_SA" --allow-unauthenticated \
  --min-instances=0 --max-instances=3 --memory=1Gi --timeout=90s \
  --set-secrets=GEMINI_API_KEY=kotoba-wager-key:latest \
  --set-env-vars="GEMINI_MODEL=gemini-3.1-flash-lite,GEMINI_DAILY_CALL_LIMIT=100,ALLOWED_ORIGINS=https://remako0901.github.io,STORAGE_BACKEND=firestore,GENERATION_TASKS_MODE=cloud,CLOUD_TASKS_PROJECT=$PROJECT,CLOUD_TASKS_LOCATION=$REGION,CLOUD_TASKS_QUEUE=$QUEUE,TASKS_SERVICE_ACCOUNT=$RUN_SA"

gcloud run services add-iam-policy-binding "$SERVICE" \
  --project="$PROJECT" --region="$REGION" \
  --member="serviceAccount:$RUN_SA" --role=roles/run.invoker

RUN_URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
test -n "$RUN_URL" && gcloud run services update "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --update-env-vars="TASKS_TARGET_URL=$RUN_URL"
```

初回デプロイは自サービス URL を知らないため、URL 更新前に取引を行わない。タスクの HTTP 宛先は `$RUN_URL/internal/generation/process`、OIDC の audience はパスを含まない `$RUN_URL`。タスクに本文やキーは載せない。日次上限は UTC 日付ごとに100回で、月額の保証ではない。

## 3. Phase 2 の検証と切替

1. 新 API の `/api/health`、`/api/games`、Pages Origin からの CORS、内部生成パスの無認証拒否を確認する。公開 Pages の接続先はまだ変更しない。
2. 既存フロントを `VITE_API_BASE_URL="$RUN_URL"` でローカルビルドして別の確認用ブラウザでプレイする。ローカルの Origin を使う場合は、承認のうえで新 API の許可リストに検証中だけ追加し、終了時に元に戻す。実Geminiの勝敗別の生成、演出中のポーリング、次ラウンド、再送、別インスタンス／再起動後の保存、Cloud Tasks の配信状態を確認する。
3. コールドスタートを実測する。初期は最小0・最大3。最小1はアイドル時にも料金が発生するため、必要な場合は所有者が再判断する。Firestore の読取り・日次カウンター・Gemini の消費量も確認する。
4. 切替承認後にだけ、GitHub の Repository variable `API_BASE_URL` を新しい Cloud Run URL に更新し、`Publish GitHub Pages` workflow を手動で実行する。配信後に新規開始から次ラウンドまで再確認する。Render はまだ停止しない。
5. 切り戻しが必要なら、同変数を `https://kotoba-wager-api.onrender.com` に戻し、同じ workflow を再実行する。Cloud Run と Render のセッションは共有しないため、切替・切り戻し後は新規開始する。

## ローカル検証と復旧の仕組み

```bash
# 端末1：Firestore エミュレータ（本番に接続しない）
gcloud emulators firestore start --host-port=127.0.0.1:8080 --project=demo-kotoba-wager

# 端末2：既存テストとエミュレータの結合テスト
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 STORAGE_BACKEND=file \
  GENERATION_TASKS_MODE=inline GEMINI_API_KEY= PYTHONPATH=backend \
  .venv/bin/python -m pytest backend/tests -q
```

Firestore モードでは非公開のセッション乱数種と取引 ID・手番から抽選用乱数を再現できるため、Firestore が書き込みをやり直しても同じ結果になる。確定した結果は取引に保存し、確率やカードのルールは現行と共通。

Cloud Tasks の登録に一時失敗しても、勝敗は Firestore に保持する。ポーリング・同じ取引の再送・起動時復旧は同じタスク名で登録を確認する。生成中の配信重複は一時失敗として返し、処理権が切れるまで再配信させる。生成中にワーカーが消えた場合は、確定勝敗を使う定型文に切り替え、実行済みか不明な Gemini 呼出を繰り返さない。

Cloud Tasks が再配信を使い切った場合は監視対象。通常のポーリングでキューへの登録が確認済みのジョブを何度も作り直す設計ではない。Phase 2 でキュー障害時の復旧運用とアラートの要否を確認する。

- [Cloud Run のソースデプロイ](https://cloud.google.com/run/docs/deploying-source-code)
- [Cloud Tasks の HTTP ターゲットと OIDC](https://cloud.google.com/tasks/docs/creating-http-target-tasks)
- [Firestore エミュレータ](https://cloud.google.com/firestore/native/docs/emulator)
