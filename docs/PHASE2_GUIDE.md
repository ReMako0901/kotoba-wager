# Phase 2 ガイド（検証と切替。ユーザー作業）

作成: 2026-11-13。対象は PROJECT_PLAN.md の Phase 2。
前提: Phase 0 完了、Phase 1 実装済み（ブランチ `codex/phase1-cloud-run`、未 push）。
デプロイコマンドの正本は Phase 1 で作成された `docs/DEPLOY_CLOUD_RUN.md`。
このガイドは実行の順番と、判断・確認のポイントを定める。
課金・権限・公開に関わる実行はすべてユーザーが行う（Muse / Codex は代行しない）。

確定値: プロジェクト `kotoba-wager`（番号 108927229642）、リージョン `asia-northeast1`、
キュー名 `generation`、実行 SA `108927229642-compute@developer.gserviceaccount.com`、
シークレット `kotoba-wager-key`（環境変数 `GEMINI_API_KEY` に結び付ける）。

## 全体の順番

A. 事前作業（キュー作成・IAM 付与）→ B. 初回デプロイ → C. TASKS_TARGET_URL の設定 →
D. 新 API だけでの検証 → E. コールドスタート実測と D4 判断 → F. 切替（承認）→ G. 経過観察

切替（F）までは本番（GitHub Pages → Render）に一切影響しない。

## A. 事前作業（Cloud Shell）

```
gcloud config set project kotoba-wager
gcloud tasks queues create generation --location=asia-northeast1
```

実行 SA に、タスク登録の権限を付ける（キュー単位）。

```
gcloud tasks queues add-iam-policy-binding generation \
  --location=asia-northeast1 \
  --member="serviceAccount:108927229642-compute@developer.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"
```

このコマンドがエラーになる場合は、プロジェクト単位で付ける（範囲は広がるが同一
プロジェクト内のみ。動作は同じ）。

```
gcloud projects add-iam-policy-binding kotoba-wager \
  --member="serviceAccount:108927229642-compute@developer.gserviceaccount.com" \
  --role="roles/cloudtasks.enqueuer"
```

## B. 初回デプロイ

`docs/DEPLOY_CLOUD_RUN.md` のコマンド（または `scripts/deploy_cloud_run.sh`）を
ユーザーが実行する。実行前に1点だけ目視確認する。

- 公開範囲: フロント（GitHub Pages）はブラウザから API を直接叩くため、サービスは
  未認証アクセス可（`--allow-unauthenticated`）でなければブラウザから使えない。
  内部エンドポイント `/internal/generation/process` の保護は、アプリ側の OIDC 検証が担う。
  DEPLOY の手順がこの形になっているか確認してから実行する。
- 環境変数とシークレット結び付けが PHASE1_INSTRUCTIONS §0 / T5 の値と一致しているか。

デプロイ後に発行されるサービス URL を控える。

## C. TASKS_TARGET_URL の設定

タスクの宛先は自サービスの URL のため、初回デプロイ後にしか確定しない。
DEPLOY の手順に従い、`TASKS_TARGET_URL` にサービス URL を設定して更新する
（`gcloud run services update` または再デプロイ）。

OIDC の呼び出しに `roles/run.invoker` が必要という手順になっている場合は、
サービスに対して実行 SA へ付与する（サービス名は DEPLOY の指定に従う）。

## D. 検証（新 API だけ。切替前に全部やる）

フロントの接続先は変えず、新 API の URL に対して直接確認する。

1. 実 Gemini で1取引が完走する（意味解釈→編集→全文レビューが定型文フォールバックに
   落ちていないこと。取引履歴・結果で確認）。
2. Cloud Tasks の実配信が届く（コンソールの Cloud Tasks でタスクが成功になっている、
   内部エンドポイントのログがある）。
3. 同じ取引の再送で再抽選しない（勝敗と本文が変わらない）。
4. 再起動相当の操作をまたいで保存が残る（新リビジョンへ差し替える、または時間を置いて
   インスタンスが落ちた後に、同じセッションを取得できる）。
5. 日次上限カウンターが Firestore 側で増えている（counters のドキュメントを確認）。

1つでも失敗したら切替に進まない。原因を切り分けて Muse へ報告する。

## E. コールドスタート実測と D4 の最終判断

- 測り方: デプロイ直後、またはインスタンスが落ちている状態で、開始リクエスト
  （セッション作成）から応答までの時間を数回測る。Sudachi 辞書と索引の読み込みを含む
  初回応答が対象。`/api/health` だけでなく実際の開始処理で測る。
- 判断: 初回でも体感を損なわない（目安として十数秒以内）なら、最小インスタンス 0 のまま
  確定する。損なう場合は最小 1 を検討するが、常時課金になるため、金額の目安を出してから
  ユーザーが判断する。勝手に最小 1 へ変更しない。

## F. 切替（ユーザーの明示承認のあと）

1. GitHub リポジトリの Settings → Secrets and variables → Actions → Variables で、
   `API_BASE_URL` を新 API の URL に変える。
2. GitHub Pages のビルド／デプロイが再実行され、公開画面が新 API を向くことを確認する。
3. 公開 URL で実際に1取引プレイして、保存と生成が新側で動くことを確認する。

切り戻し: `API_BASE_URL` を Render の URL に戻して再デプロイすれば戻る。
Render は切替後も止めない。

## G. 経過観察と、やらないこと

- 切替後しばらくは Render を残し、保存が消えないことと請求の出方を観察する。
- Render の停止は、安定が確認できてから、改めてユーザーが承認して行う（このガイドの
  範囲外）。
- 予算アラートは設定しない方針のまま（Phase 0 の決定）。請求はコンソールで随時確認する。

## 完了したら Muse へ知らせる内容

- A〜C の実施結果（詰まったコマンドがあれば、その出力）
- D の検証5項目それぞれの結果
- E の実測値（初回応答の秒数、数回分）
- F は承認を伝えてから実施し、切替後のプレイ確認結果
