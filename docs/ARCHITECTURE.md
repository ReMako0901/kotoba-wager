# 実装構成とデータの流れ

## 主要ファイル

|ファイル|責務|
|---|---|
|`frontend/src/App.tsx`|タイトル、開始文3択、報酬ポップアップ、コマ選択、結果、履歴、ポーリング|
|`frontend/src/types.ts`|APIの画面側型。Python側モデルと同期する|
|`frontend/src/api.ts`|fetch、公開APIホストの切替、エラー表示用例外|
|`frontend/src/style.css`|白黒・縦画面・セーフエリア・本文内スクロール|
|`backend/app/main.py`|API、開始文ロード、セッション開始、状態の公開、CORS|
|`backend/app/analysis.py`|ローカル解析の組立、コマ数検査、報酬候補。名前はanalysisだが開始時AI解析ではない|
|`backend/app/segmentation.py`|Sudachi分割、辞書補正、助詞等の結合、選択可否、名詞アンカー抽出|
|`data/segmentation_dictionary.json`|まとまりとして保護する語・枠なしにする接続表現|
|`backend/app/engine.py`|抽選保存、意味解釈、編集、状態確定、再試行・キャッシュ|
|`backend/app/gemini.py`|REST呼出、構造化JSON、モデル検証、意味と原文の照合|
|`backend/app/prompts.py`|共通System・意味解釈・勝利編集・敗北編集|
|`backend/app/editing.py`|文の切出し、編集可能範囲・差分量・保護語・重複検査、本文の組立|
|`backend/app/models.py`|Pydanticの入出力・構造化生成スキーマ|
|`backend/app/store.py`|JSON保存、ロック、プロセス再起動時の中断復旧|
|`backend/app/quota.py`|UTC日付単位の呼出予約・制限|
|`backend/app/config.py`|環境変数、`.env`読込|
|`data/stories.json`|現行開始文6件。id/title/genre/tagline/text|
|`data/stories-classic.json`|以前の長く重い開始文。現在は使用しない|
|`scripts/serve.py`|API＋存在すればビルド済み画面の統合配信|

## 取引の流れ

```text
保存済み開始文
  → Sudachi＋ゲーム辞書 → Unit[] → 報酬候補
  → 報酬選択 → unit_ids選択
  → 必要個数・本文版・重複・可否検査
  → プログラムが抽選、取引IDと勝敗を先に保存
  → Gemini.resolve_stakes（選ばれたコマだけの意味と原文上の言及）
  → ID・原文・言及照合、成功した解釈を保存
  → Gemini.win / loss（文字列の部分編集案）
  → 置換可能な原文・範囲・重複・差分量・保護条件・自己確認を検査
  → 原文と編集案から更新本文をローカルで組立
  → 次ラウンドの分割と報酬をローカル準備
  → 本文版・履歴・消失済み意味をまとめて保存 → 結果画面
```

通常は1取引2回のAI呼出。開始・タップ・次本文分割でAIを呼ばない。途中でエラーなら元本文と確定勝敗を維持する。解釈成功後の編集エラーでは解釈をキャッシュする。手動再試行は初回を含め最大3回。自動無限リトライ禁止。

## 主要データ

- `betting_mode: count-v1`：旧点数セッションを黙って読み替えないための方式ID。
- Unit：`id/text/start/end/stakeable`。scoreはない。オフセットはPython文字列の位置として生成する。JSのUTF-16 indexへ勝手に流用しない。画面はユニットのtextで描画する。
- Offer：`id/title/description/required_count/change_scale/tier`。required_pointsは廃止。
- Session：本文、version、analysis、offers、transactions、lost_concepts、status、view、pending_transaction_id、win_probability、api_calls、usage等。
- Transaction：request_id由来のid、source_version、unit_ids、selected_units、stakes、outcome、staked_concepts、lost、meanings_resolved、attempts、before/after等。
- ResolvedConcept：label/kind/descriptionと、実際に選んだselected_surfaces・本文に存在するmentions。異なる位置の同じ意味をまとめても個数は減らさない。
- 編集案：sentence_id/before/after/reason。全文生成をそのまま本文へ採用せず、元本文への局所置換から組み立てる。

## 編集の制約

勝利の差分文字数仮上限はchange_scale 1/2/3に対して24/46/90。変更文数も制限。敗北は選択語とその言及から編集可能文を決め、人物消失や複数対象では必要な範囲を広げる。関係だけの消失では未選択の名詞を保持する追加検査がある。

本文最大140文字。意味の保持・消失・報酬の自己確認はLLM自身によるもの。原文照合などの機械検査が通っても意味や自然さが保証されるわけではない。

## API

|method/path|用途|
|---|---|
|GET `/api/health`|設定済みか・model・betting_mode。キー値は返さない|
|POST `/api/stories/draw`|exclude付きの候補3件抽選|
|POST `/api/sessions`|story_id/request_idで開始。再送の同一IDを保護|
|GET `/api/sessions/{sid}`|進捗・結果を取得|
|POST `/api/sessions/{sid}/transactions`|request_id/version/offer_id/unit_idsで取引|
|POST `/api/sessions/{sid}/retry`|保存済み同一勝敗で手動再試行|
|POST `/api/sessions/{sid}/continue`|結果から次の報酬・選択へ|

## 保存と互換性

JSONファイルの原子的置換＋単一プロセスのセッションロック。多worker・複数インスタンスへそのまま拡張しない。ブラウザ保存はセッション復帰の手掛かりや選択であり、物語の永続DBではない。

辞書変更で既存セッションの `analysis` は自動再計算されない。新規開始・次の本文版で新規則が使われる。編集中・確定済み取引のUnit IDや選択範囲を勝手に変えない。分析規則の版管理・安全な移行は今後の課題。
