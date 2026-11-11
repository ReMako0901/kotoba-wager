# 使用ツールと実行環境

## アプリケーション

|用途|使用しているもの|参照|
|---|---|---|
|画面|React 19、TypeScript、Vite 6|`frontend/package.json`、`pnpm-lock.yaml`|
|API|Python、FastAPI、Uvicorn、Pydantic|`backend/requirements.lock.txt`|
|文章生成|Gemini REST API、httpx|`backend/app/gemini.py`|
|分割|SudachiPy、sudachidict-core、Wiktionary由来の索引、ゲーム専用JSON辞書|`segmentation.py`、`data/segmentation_dictionary.json`|
|保存|JSONファイル、単一プロセスのasyncioロック、原子的置換|`store.py`|
|テスト|pytest、FastAPI TestClient|`backend/tests/`|
|画面公開|GitHub Pages・GitHub Actions|公開専用リポジトリ `.github/workflows/pages.yml`|
|API公開|Render無料Docker Web Service、Singapore|`Dockerfile`、`render.yaml`|
|履歴|Git。公開用操作にGitHub CLI `gh` を利用|`docs/SHARED_NOTES.md`|

Python推奨3.11以降、Dockerは3.12。固定依存の正本はlockファイル。例：SudachiPy 0.7.0、sudachidict-core 20261015。READMEの導入例よりlockを優先する。APIはGeminiのSDK経由ではなくREST。過去に検討したAIのべりすと・NovelAI・Claudeは現アプリの実行依存ではない。

モデルの現行デフォルトは `gemini-3.1-flash-lite`。これはコードで確認した設定値であり、将来の提供状況や価格を保証する記述ではない。

## 新しい環境での起動

以下は `story-wager/` をカレントとして実行。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
cp .env.example .env
chmod 600 .env
# .envにGEMINI_API_KEYを本人の環境で設定。チャットやGitへ貼らない。
cd frontend
pnpm install --frozen-lockfile
pnpm run build
cd ..
.venv/bin/python scripts/serve.py
```

既存 `.env` を `cp` で上書きしない。ローカルは http://localhost:8000 。このMacでは「ゲーム起動.command」「Geminiキー設定.command」も使える。起動スクリプトにはMac固有のPythonパスがあるため、他環境でそのまま動くとは限らない。

フロント開発はAPIを8000番で起動した上で `frontend/` から `pnpm dev`。Viteは5173番、`/api` を8000番へproxyする。ビルド後の統合配信では `scripts/serve.py` が `frontend/dist` を配信する。APIは単一worker前提。

## テスト・ビルド

```sh
# story-wager/ で実行
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
cd frontend
pnpm run build
```

このMacでPATHにnode/pnpmがない場合の既知パス（他環境へハードコードしない）：

- Node：`/Users/remako/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`
- pnpm CLI：`/Users/remako/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs`
- 既存Python：プロジェクト `.venv/bin/python`

このMacではNode絶対パスで `frontend/node_modules/typescript/bin/tsc -b frontend` と `frontend/node_modules/vite/bin/vite.js build frontend` をプロジェクトルートから実行できる。system Pythonはdotenv等が入っていない場合がある。

## 環境変数

|変数|デフォルト・用途|
|---|---|
|`GEMINI_API_KEY`|秘密。バックエンドのみ。値を資料・ログ・画面・Gitへ出さない|
|`GEMINI_MODEL`|`gemini-3.1-flash-lite`|
|`GEMINI_MAX_OUTPUT_TOKENS`|8192、コード上限16384|
|`WIN_PROBABILITY`|0.5、0〜1|
|`STORY_DATA_DIR`|`data/runtime`。セッション保存先|
|`ALLOWED_ORIGINS`|ローカルは空。Render設定は `https://remako0901.github.io`|
|`GEMINI_DAILY_CALL_LIMIT`|コード既定0（制限なし）、render.yamlは100|
|`PORT`|serve.pyの既定8000、Renderは提供値|
|`VITE_API_BASE_URL`|画面ビルド時の公開APIホスト。未設定なら同一ホスト|

GitHub Repository variable `API_BASE_URL` がworkflowで `VITE_API_BASE_URL` になる。どちらも秘密キーを置く変数ではない。モデル側利用額の厳密な上限をAPI呼出回数ガードだけで保証しない。

## 外部サービスと素材

既にGeminiキーとRender設定はある。引き継ぎ時にキーを再発行・再登録させる必要はない。新環境にキーがない場合だけ安全な環境変数を設定する。一般辞書のSudachiに加え、Wiktionaryの既存データから抽出した索引をバックエンドに同梱している。元の巨大なgzipや説明文は配信しない。再生成手順は [WORD_DICTIONARY.md](WORD_DICTIONARY.md)。
