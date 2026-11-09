# ことばの取引所

短い文章の言葉を賭けて、表現や展開を変える実験的なゲームです。現金・換金はありません。

React / TypeScript / Viteの画面をGitHub Pagesへ、FastAPI / Geminiの処理をRenderへ配置します。APIキーはサーバー側の環境変数で設定します。

## 遊び方

1. 開始文章を選ぶ。
2. 3つの報酬から1つ選ぶ。
3. 本文をタップし、必要点数ちょうどになるように言葉を賭ける。
4. 勝てば設定を残して報酬を得る。負けるとその意味を失い、本文が書き換わる。

## 公開設定

[公開手順と無料枠の制約](PUBLISH.md)を確認してください。API接続先の設定が完了するまでGitHub Pagesの公開はスキップされます。

[Renderにデプロイ](https://dashboard.render.com/select-repo?type=blueprint&repo=https%3A%2F%2Fgithub.com%2FReMako0901%2Fkotoba-wager)

## ローカルで起動

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
cp .env.example .env
# .envにGEMINI_API_KEYを設定
cd frontend
pnpm install --frozen-lockfile
pnpm exec tsc -b
pnpm exec vite build
cd ..
.venv/bin/python scripts/serve.py
```

ブラウザで http://localhost:8000 を開きます。

## 検証

```sh
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
```

AIによる意味の整合性や消失の不可逆性は保証されません。点数・勝率・報酬はプロトタイプ用の仮設定です。
