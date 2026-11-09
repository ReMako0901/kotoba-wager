# GitHub Pages + Render 公開構成

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
