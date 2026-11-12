# Phase 0 手順書（ユーザー作業）

対象: PROJECT_PLAN.md の Phase 0。Google Cloud 側の受け皿をユーザーが用意する手順。
所要時間の目安: 30〜60分（画面の案内通りに進めた場合）。
この手順で課金が始まるわけではない。支払いが発生するのは、無料枠とクレジットを超えた利用分だけ。

## 完了状態（ゴール）

- [ ] Google Cloud プロジェクトが作成され、プロジェクト ID とプロジェクト番号が分かる
- [ ] 請求先アカウントが作成され、プロジェクトにリンクしている
- [ ] 予算アラートが設定されている
- [ ] Google AI Pro の月 $10 Cloud クレジットが、その請求先アカウントに適用されている（または適用できない理由が判明している）
- [ ] Firestore（Native モード、asia-northeast1）が作成されている
- [ ] このプロジェクトで作成した Gemini API キーが、Secret Manager の `GEMINI_API_KEY` に登録されている
- [ ] 必要な API が有効化されている

## 用意するもの

- Google AI Pro を契約している Google アカウント（この後の作業は全部このアカウントで統一する）
- 請求先アカウント作成用のクレジットカード（Google Cloud の支払い方法として登録するもの）

**注意: API キーの値、カード番号などをチャットや Git に書かない。** キーはこの手順の中で
Google の画面から Secret Manager へ直接貼るだけにする。

---

## Step 0: アカウントとデベロッパープロフィールの確認

1. Google AI Pro を契約しているアカウントでブラウザにログインする
2. https://developers.google.com/profile を開き、デベロッパープロフィールがなければ作成する
   （クレジット特典は「AI Pro メンバーシップがデベロッパープロフィールにリンクされている」ことが前提）

## Step 1: Google Cloud プロジェクト作成

1. https://console.cloud.google.com/ を開く
2. 上部のプロジェクト選択 > [新しいプロジェクト]
3. プロジェクト名: `kotoba-wager`（組織は「組織なし」でよい）
4. 作成後、プロジェクト ID（例: `kotoba-wager-123456` のような英数字）を控える。
   プロジェクト ID は後から変えられない。Muse / Codex へ共有してよい情報（秘密ではない）
5. プロジェクトの [設定] などからプロジェクト番号（数字12桁前後）も控える。Step 7 で使う

## Step 2: 請求先アカウントの作成とリンク

1. コンソールの [お支払い] > [請求先アカウント] から、請求先アカウントを作成する
   （個人、住所、カード情報を入力。カードは本人確認と超過分の支払い用）
2. 作成した請求先アカウントを Step 1 のプロジェクトにリンクする
   （プロジェクトを開いた状態で [お支払い] > [このプロジェクトの請求先アカウントを変更] 等）
3. 確認: プロジェクトの [お支払い] 画面で、リンク済みの請求先アカウントが表示されること

## Step 3: 予算アラート

1. [お支払い] > [予算とアラート] > [予算を作成]
2. 対象は Step 1 のプロジェクト。金額は目安 **¥1,500/月**（$10 クレジットと同程度）
3. しきい値は 50% / 90% / 100% でメール通知を有効にする
4. 注意: アラートは通知のみで、支出を自動停止しない。止める仕組みではなく気づく仕組みとして置く

## Step 4: AI Pro の Cloud クレジットを適用する

公式 FAQ: https://developers.google.com/profile/help/benefits

1. https://me.developers.google.com/benefits （特典ページ）を、Step 0 のアカウントで開く
2. Google AI Pro の特典がリンクされていることを確認する
3. 「Google Cloud クレジット（月 $10）」のカードで、Step 2 の請求先アカウントを選択して適用する
4. その際 [**常にこの請求先アカウントを使用する**] にチェックを入れる。
   入れないと、翌月分から毎月手動で適用が必要になる
5. 確認: 特典ページのカードに、適用先の請求先アカウントが表示されること

補足（公式 FAQ より）:

- クレジットは「特典を初めて申請した日」の毎月記念日に付与される。月初に増えていなくても異常ではない
- クレジットの有効期限は付与から1年。繰り越しは1年まで
- 対象プロダクトは Gemini API、Google AI Studio、Firebase などを含む Google Cloud プロダクト全般
  （標準の割引対象外費用は除く）。実際に Cloud Run / Firestore の請求に充当されたかは、
  切替後の請求レポートで最終確認する
- 請求先アカウントがプルダウンに出ない場合: そのアカウントへの `billing.accounts.redeemPromotion`
  権限がない可能性。自分が管理者のアカウントでログインし直す
- プルダウンではなくプロモーションコードが表示される場合:
  コードを控え、https://console.cloud.google.com/billing/redeem でコードを貼り、
  請求先アカウントを選んで [続行] する
- Gemini API の請求が前払い（Prepay）方式で表示される場合、クレジットの消費条件が変わることがある。
  その画面が出たら、入金はせずに Muse へ知らせる（未確認事項として扱う）

## Step 5: Firestore を作る

1. コンソールで Step 1 のプロジェクトを開き、[Firestore Database] へ移動する
2. [データベースを作成] を選ぶ
3. 設定は次の通り:
   - データベース ID: `(default)`
   - エディション: **Standard**
   - モード: **Native モード**
   - ロケーション: **asia-northeast1（東京）**
   - セキュリティルール: **制限付き**（このゲームはサーバー側からのみアクセスし、ブラウザから直接読まないため）
4. 作成する

**警告: ロケーションは作成後に変更できない。** また、プロジェクトの「デフォルトの Google Cloud
リソースのロケーション」が既に決まっていると、ロケーションを選べない場合がある。その場合は
表示されているロケーションを控えて Muse へ知らせる（東京以外になっていたら進め方を相談する）。

## Step 6: このプロジェクト用の Gemini API キーを作る

狙い: Gemini API の課金先を Step 2 の請求先アカウントに揃える。Render で使っている既存キーが
別プロジェクトのものなら、そのキーの課金は別プロジェクト側に行くため、ここで新規に作る。

1. https://aistudio.google.com/apikey を Step 0 のアカウントで開く
2. [API キーを作成] で、**Step 1 で作ったプロジェクトを選択**してキーを作成する
3. 表示されたキー値はこの時点ではコピーだけする。どこにも保存・送信しない（次の Step で直接貼る）

## Step 7: Secret Manager にキーを登録する

1. コンソールで [Secret Manager] へ移動し、求められれば API を有効化する
2. [シークレットを作成]: 名前は `GEMINI_API_KEY`、シークレットの値に Step 6 のキーを貼る
3. 作成したシークレットの [権限] から、Cloud Run が使うサービスアカウントに
   ロール **Secret Manager のシークレット アクセサー**（`roles/secretmanager.secretAccessor`）を付ける。
   付与先の候補: `<プロジェクト番号>-compute@developer.gserviceaccount.com`
   （Cloud Run のデフォルト実行アカウント。Phase 1 で専用サービスアカウントに替える場合は付け直す）
4. 確認: シークレット一覧に `GEMINI_API_KEY` があり、バージョンが1つ登録されていること（値は開いて確認しなくてよい）

## Step 8: API の有効化

コンソールの [API とサービス] > [ライブラリ] から、次を有効化する（Phase 1 のデプロイで必要になるもの）。

- Cloud Run Admin API（`run.googleapis.com`）
- Cloud Build API（`cloudbuild.googleapis.com`）
- Artifact Registry API（`artifactregistry.googleapis.com`）
- Cloud Firestore API（`firestore.googleapis.com`、Step 5 で有効になっている場合もある）
- Cloud Tasks API（`cloudtasks.googleapis.com`）
- Secret Manager API（`secretmanager.googleapis.com`、Step 7 で有効になっている場合もある）
- Gemini API / Generative Language API（`generativelanguage.googleapis.com`）

---

## 完了したら Muse へ知らせる内容

次だけを伝える（キー値やカード情報は含めない）。

- プロジェクト ID とプロジェクト番号
- クレジットが適用できたか（できなかった場合は、特典ページや請求画面の表示内容）
- Firestore のロケーションが asia-northeast1 になっていたか
- 予算アラートを設定した金額
- 途中で止まった Step の番号と、画面に出た文言

## 詰まったときの切り分け

- 特典ページに AI Pro の特典が出ない → Step 0 のアカウント違いか、プロフィールへのリンク未完了を疑う
- 請求先アカウントが選べない → Step 4 補足の権限問題を確認する
- Firestore のロケーションが選べない → 既定ロケーションが先に決まっている。表示値を控えて相談する
- Prepay の入金を求める画面が出た → 入金せずに相談する
