# ことばの取引所 — 個数ベットの文章ゲーム

**[公開URLで遊ぶ](https://remako0901.github.io/kotoba-wager/)**

短い文章から、残してもよい言葉・失いたくない言葉を自分で選んで賭ける。勝てば望む表現や出来事を獲得し、負ければ選んだ意味が失われる。現金・換金はない。

## 開発・他のAIへの引き継ぎ

**[引き継ぎ資料の入口](docs/README.md)** から、概要・使用ツール・更新履歴・進捗・TODO・共有事項を個別に読める。実装前に [AGENTS.md](AGENTS.md) と [現在の進捗](docs/STATUS.md) を確認する。ゲーム用辞書は [data/segmentation_dictionary.json](data/segmentation_dictionary.json)、編集方法は [辞書仕様](docs/WORD_DICTIONARY.md)。ローカル／GitHubソース／実際の配信版を区別する。

## 現在のルール

点数方式は廃止。**選べるコマはどれも1コマ＝1個**で、報酬ごとに1個／2個／3個を選ぶ。人物・物・場所・属性・名前のある出来事や関係を中心に選べる。一般的な動作や副詞は枠なしの本文として残す（形態素による仮ルール）。AIの採点や理解を理由とした「？」の選択制限はない。

報酬ポップアップ → 個数だけを合わせてコマを選択 → 勝敗確定 → AIによる意味の解釈と部分編集 → 結果 → 次の取引、という流れ。

開始時と更新後の分割はローカルで行う。通常のAI呼出は勝敗確定後の意味解釈・編集の2回。勝敗はサーバーで一度だけ確定し、エラーを敗北扱いにしたり再抽選したりしない。手動再試行は初回を含め3回まで。

詳しい仕様と検証は [COUNT_MODE.md](COUNT_MODE.md)。以前の点数方式の検証は [VERIFICATION.md](VERIFICATION.md)、[FEEDBACK_2026-11-10.md](FEEDBACK_2026-11-10.md) に履歴として残す。

## このMacで起動

`ゲーム起動.command` を実行し、<http://localhost:8000> を開く。設定済みサーバーが動いていればブラウザを開くだけでよい。停止は起動ターミナルで Control+C。

Geminiキーは `Geminiキー設定.command` で非表示入力し、Git対象外の `.env`（0600）へ保存する。ソースやブラウザには渡さない。環境変数 `GEMINI_API_KEY` も利用可能。設定変更後はサーバーを再起動する。

モデル仮設定は `gemini-3.1-flash-lite`。`WIN_PROBABILITY=0.5`、`GEMINI_MAX_OUTPUT_TOKENS=8192`。キーをチャット・Git・フロントエンドへ貼り付けない。

## 再構築

Python 3.11以降とNode.js 20.19以降を推奨。

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.lock.txt
cd frontend
pnpm install --frozen-lockfile
pnpm exec tsc -b
pnpm exec vite build
cd ..
.venv/bin/python scripts/serve.py
```

このMacの `.command` はCodex同梱Pythonのパスを使うため、別環境では上記コマンドを使う。Sudachi辞書はインストール時に約77MB。分割はローカル処理。

## 構成

- `frontend/src/App.tsx`：候補・報酬選択、コマの選択、個数カウンター、結果、履歴。
- `backend/app/analysis.py`：ローカル分割・個数の検証・報酬。AIによる価格決定はない。
- `backend/app/segmentation.py`：形態素解析と短いコマへの結合規則。
- `backend/app/gemini.py`、`prompts.py`：取引後の意味解釈・勝利／敗北の部分編集。
- `backend/app/editing.py`：変更する文の制限、差分量・原文・保護対象の検証。
- `backend/app/engine.py`：勝敗の一度確定、解釈の保存、取引処理、再試行。
- `backend/app/store.py`：単一プロセスのロックと原子的JSON保存。
- `data/stories.json`：短くポップな開始文章6件。旧文章は `stories-classic.json`。

```sh
PYTHONPATH=backend .venv/bin/python -m pytest backend/tests -q
```

## 公開と制約

画面はGitHub Pages、Gemini処理はRender無料Web Service。キーはRenderの環境変数に置く。設定は [PUBLISH.md](PUBLISH.md)。

無料枠は初回・休止後に起動待ちがあり、サーバーの休止・再デプロイ・再起動で途中のプレイ状態が失われる。永続DB・アカウント・ランキング・課金・エンディングは未実装。

AIの意味解釈・消失の不可逆性・報酬の実現は完全には保証しない。原文の照合・部分編集の範囲を検査し、条件外は元の本文を保持して停止する。研究用の実験条件や言葉の分割粒度は、別途固定・評価する必要がある。

## 参照

- [Gemini公式モデル説明](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
- [構造化出力](https://ai.google.dev/gemini-api/docs/structured-output)
- [SudachiPy公式チュートリアル](https://github.com/WorksApplications/SudachiPy/blob/develop/docs/tutorial.md)
