# GitHub Pages + Render 公開構成

> 以下は公開構成と過去の検証履歴を含む。最新の版・配信差分は [docs/STATUS.md](docs/STATUS.md) を参照。「現在配信中」という旧記録は当時の状態である。

画面はGitHub Pages、Python/FastAPI/GeminiはRenderに置く。APIキーはバックエンドの環境変数のみ。GitHubの変数には公開可能なAPIのベースURLだけを登録する。

## Render

このリポジトリの `render.yaml` で無料のDocker Web Serviceを定義している。

- 起動：`python scripts/serve.py`（Renderの `PORT` を使用）
- Health Check：`/api/health`
- `GEMINI_API_KEY`：Renderで入力。ソース・GitHub Pagesへ渡さない。
- `ALLOWED_ORIGINS`：`https://remako0901.github.io`
- `GEMINI_DAILY_CALL_LIMIT`：100（UTC日付。自動生成の暴走を抑える試作用ガード）

無料Web Serviceは休止・再デプロイ・再起動でローカルファイルが消える。ゲーム状態とAPI呼出カウンターも消えるため、継続プレイの永久保存や厳密な課金上限は保証しない。失われたセッションはエラーとして表示し、勝敗を黙って再抽選しない。継続的な研究実験には永続データベースが必要。

[Render無料枠の公式説明](https://render.com/docs/free)

## GitHub Pages

1. リポジトリのPages設定をGitHub Actionsにする。
2. Renderが発行したURLを、GitHub ActionsのRepository variable `API_BASE_URL` に設定する（末尾の `/api` は不要）。
3. `Publish GitHub Pages` workflowを起動する。
4. 公開後、実際のURLで文章解析・取引まで確認する。

`API_BASE_URL` が未設定の場合、workflowは公開をスキップする。APIキーをフロントエンドへ埋め込んだり、動かない画面を完成扱いで公開したりしない。

## ローカルとの互換性

`VITE_API_BASE_URL` 未設定時は従来どおり同じホストの `/api` を使う。設定時はそのHTTPSホストへアクセスする。Viteのbaseは相対指定のためGitHub Pagesのサブパスでもアセットを読み込める。

## 公開対象

`story-wager` のソースだけを専用のGitHubリポジトリへ転記する。研究資料、APIキー、ランタイム状態、個人のプレイ履歴、スクリーンショット、ローカル依存物は転記しない。

## 今回の公開先と進捗（2026-11-10）

- ソース：https://github.com/ReMako0901/kotoba-wager （公開リポジトリ）
- ゲームURL：https://remako0901.github.io/kotoba-wager/ （配信中）
- 公開用チェックアウト：`artifacts/github-source/`（このローカルGitでは除外。専用リポジトリとして管理）
- Render API：https://kotoba-wager-api.onrender.com （無料プラン、キー設定済み、配信中。公開プレイ確認済み）

ローカルの研究フォルダー全体をGitHubへプッシュしていない。専用チェックアウトの初回コミットは `a970cc6`。ローカルでソースを更新した場合、公開対象だけを専用チェックアウトへ同期して検査・コミット・プッシュする。


### 配信設定と確認事項

- Render Service ID：`srv-dbotuhuc6qcc738ohot0`、Blueprint：`exs-dbottrjrjlhs73c9n8pg`。
- Pagesの接続先変数 `API_BASE_URL` を公開APIのURLへ設定済み。
- GitHub Actionsの配信成功を確認。現在のアプリ公開ソースは `9b079ec`（個数方式）。
- Renderは初回デプロイに成功。修正コミットはダッシュボードのManual Deployから配信した。今後の更新もRender側の配信状況を確認する。
- 公開HTML・JS・CSSを取得し、実Geminiキーが含まれないことを値を表示せず検査済み。
- CORSプリフライトがGitHub PagesのOriginに対して成功することを確認。
- 初回の公開試験でAIの文節番号の欠落・重複を検出して安全停止したため修正。採点が欠けた／競合する文節は原文を残して選択不可とし、番号が不正または解析不足が大きい場合は引き続き停止する。関連テストを含む22件が成功。


### 公開後の実プレイ確認

最終版 `67b6688` のRenderデプロイ成功と、GitHub Pages workflow `42641624579` の成功を確認した。公開URLを375×812のChromeで開き、「月まで配達」を選択。Gemini解析→報酬選択→「スクーターで」を3点でベット→プログラム抽選→Gemini再構成→再解析→結果表示まで実操作で完了した。今回は敗北し、スクーターがなくなって、うさぎが徒歩で宇宙を横断した文章になった。最終確認の取引では再試行を使っていない。

画面証跡：`artifacts/public-game-result.jpg`。一回の成功を、すべてのAI出力の正しさや意味の不可逆性の保証とは扱わない。最終版で公開環境の勝利処理を再試験したわけではない（ローカルでの実AI検証は別記録）。

### コミット

|保存先|ハッシュ|内容|
|---|---|---|
|ローカル|5193368|PagesとRenderの公開構成|
|ローカル|85b30f1|ソース公開とログイン待ちの記録|
|ローカル|3b537ae|文節採点の欠落・競合対策|
|ローカル|cc17808|概念表の先行生成・未確定語の除外|
|公開専用|a970cc6|公開用の初回ソース|
|公開専用|d60548f|文節採点の欠落・競合対策|
|公開専用|67b6688|概念IDの整合性対策・現在配信中|

研究フォルダーの履歴は書き換えていない。既存の未追跡資料は維持。この記録の更新は別のローカルコミットとして保存する。


## 変化量・採点表示の改善

`78930ce`で原文照合・部分編集・採点状態表示を公開し、実際の通常抽選で代金だけの小さな消失を確認。`3ea7513`では匿名置換ガードを追加。詳細とコミット一覧は `FEEDBACK_2026-11-10.md`。


## 個数方式への移行

点数とAI採点を廃止し、全コマ同じ1個、報酬は原則1／2／3個に変更した。開始時・更新後のコマ分割はローカルで行い、Geminiは勝敗確定後の意味解釈と部分編集だけを行う。`count-v1` のhealth応答、Render配信、Pages配信、公開URLでの通常抽選と次ラウンドへの移行を確認。詳細は `COUNT_MODE.md`。古い途中状態は新方式の個数として読み替えず、「はじめる」から開始する。
