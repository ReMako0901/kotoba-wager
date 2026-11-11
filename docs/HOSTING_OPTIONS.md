# 公開サーバーの選択肢と Google AI Pro

確認日：2026-11-11。以下は公式資料の確認と現行コードに基づく比較。契約、Cloudプロジェクト作成、クレジット登録、Renderプラン変更、配信切替は実施していない。

## Google AI Proで賄える範囲

日本語のGoogle One公式案内では、Google AI Proに月10米ドル分のGoogle Cloudクレジットが含まれる。対象のCloud Run・Firestore等とGemini APIの利用料金に適用できる。Renderへの支払いには使えない。Geminiアプリの利用枠をAPIへ直接移す仕組みではなく、請求アカウントに付くクレジットである。

手順の概略：契約した本人のGoogleアカウントでDeveloper Programにリンク → [特典ページ](https://me.developers.google.com/benefits)でクレジットを請求 → 対象Cloud Billingアカウントに適用 → Cloud RunとGemini APIのプロジェクトの請求先を確認。次回分の自動適用は特典ページの設定次第。ファミリーグループへこの特典は共有されない。

Gemini APIの課金はCloud Billingが管理する。Prepayの対象アカウントでは、クレジットがあっても初回入金が必要な場合がある。Prepay残高がゼロになるとクレジットの消費も止まる旨が公式FAQにある。ユーザーの実際の請求プラン・利用資格は未確認。

## 何が面倒かで決める

|目的|候補|利点|残ること|
|---|---|---|---|
|まず待ち時間とセーブ消失を減らす|Renderの有料512MBプラン＋永続ディスク|今のFastAPI、JSON保存、公開URLをほぼそのまま使える|計算資源は月$7、ディスク別。Cloudクレジットは使えない。初回切替時に既存の一時ファイルが自動移行されるとは限らない|
|AI Proを別用途でも使うので、サーバーもGoogleへ寄せる|Pagesは維持、APIをCloud Run、セーブをFirestore|同じ公開URLを使いながらAPIのホストと保存方式を更新。クレジットの対象|Cloud Billingの設定とアプリ改修が必要。最小インスタンス0は初回起動待ちが残り、1はアイドル料金が発生|
|開発中の待ち時間を避ける|Macでローカル起動|既存の起動方法でサーバー休止の影響なし|友人へ公開するホストの代替ではない|

現行無料Renderは15分無通信で休止し、再起動に約1分かかる場合がある。ローカルファイルが消える問題はサーバーの速度とは別。有料Renderでも永続ディスクを付けなければ保存は永続化しない。ディスクを選ぶ場合、`STORY_DATA_DIR` をマウント先（例：`/var/data/story-wager`）に向ける。既存状態は可能なら先にバックアップする。

## このゲームをCloud Runへ移すなら

1. **公開画面はGitHub Pagesのまま。** DockerのFastAPIバックエンドだけを別URLへ配置。検証後にPagesの `API_BASE_URL` を差し替える。現Renderは切替確認まで保持。
2. **保存をFirestoreへ。** 現在のJSONファイルとプロセス内ロックをそのまま使うと、インスタンスの再起動・複数化でセーブや抽選を保護できない。取引ID・確定勝敗・本文版・生成済み結果を永続トランザクションで管理。無制限に続く履歴は別ドキュメントに分ける（Firestoreの文書上限1MiB）。
3. **生成をHTTPリクエストの中で完了させるか、Cloud Tasks等へ移す。** 現行 `engine.spawn()` は202応答後に裏で処理を続ける。Cloud Runのリクエストベース課金では応答後のCPUが止まるか強く制限される。最初の移行では、勝敗を先にDBへ保存→同じリクエスト内で生成→本文反映、を第一候補とする。中断・再送で再抽選しない。長時間処理やリトライの要件が増えたらジョブへ分離する。
4. **小さい構成から測る。** リクエストベース、最小0から試し、CPU・メモリ・応答時間・課金を測定。待ち時間が支障なら最小1を検討。最大インスタンス数・API呼出上限・予算通知は事前に設定を設計する。予算通知だけでは支出を停止しない。
5. **検証後に切り替える。** APIキーはSecret Manager等のバックエンド設定のみ。別APIで実Gemini・永続保存・再送・再起動後の復帰を確認してからPagesを切り替える。新しい課金や権限設定はユーザーの承認後に行う。

FirestoreのStandard無料枠は対象1DBあたり1GiB、1日5万読取り・2万書込み等。少人数なら入りやすい構成だが、ポーリング頻度や保存件数で消費は変わる。クラウド費用はリージョン・リクエスト時間・通信・コンテナ保存・モデル使用量・他サービスの同じ請求先での利用に依存する。

## $10に収まりそうか（試算と限界）

例：1日50取引、1取引15秒、30日、1 vCPU／512MiBで取引が個別に動くと仮定すると、取引部分は月22,500 vCPU秒／11,250 GiB秒。Cloud Runのリクエストベース無料枠として公式掲載されているIowa基準の18万 vCPU秒／36万 GiB秒より小さい。これは**仮定に基づく計算で、現在のゲームのクラウド実測や東京での無料保証ではない**。初回起動・画面ポーリング・Gemini API・他のプロジェクト利用は別。

逆に、最小1で1 vCPU／512MiBを30日間維持すると、Iowaのリクエストベース標準アイドル単価だけで無料枠適用前の目安は月$9.72（全時間アイドルという仮定）。実利用や東京単価は別。現コードの裏処理のためにインスタンスベース＋常時1を選ぶと、同じIowa標準単価の無料枠適用前で月$49.25程度になり、$10前提に合いにくい。現在のまま無条件に常時稼働させる移行は勧めない。

## 参照した公式資料

- [Google One日本語：Google AI Proの特典と利用資格](https://support.google.com/googleone/answer/14534406?hl=ja)
- [Developer Program：Cloudクレジット対象、請求先への適用、付与日](https://developers.google.com/profile/help/benefits)
- [Developer Program：Gemini APIのPrepay/Postpayとクレジット](https://developers.google.com/profile/help/faq)
- [Cloud Run料金・無料枠](https://cloud.google.com/run/pricing)
- [Cloud Run：応答後の裏処理と課金方式](https://docs.cloud.google.com/run/docs/tips/general#background_activity)
- [Cloud Run：最小インスタンス](https://docs.cloud.google.com/run/docs/configuring/min-instances)
- [Firestore無料枠・文書サイズ上限](https://docs.cloud.google.com/firestore/quotas)
- [Cloud Billing予算通知](https://docs.cloud.google.com/billing/docs/how-to/budgets)
- [Render無料プラン制限](https://render.com/docs/free)
- [Render有料計算資源の料金例](https://render.com/articles/set-up-self-hosted-github-actions-runners-on-render)
- [Render永続ディスク](https://render.com/docs/disks)
