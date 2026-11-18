# 実装構成とデータの流れ

## 主要ファイル

|ファイル|責務|
|---|---|
|`frontend/src/App.tsx`|タイトル、開始文3択、報酬ポップアップ、コマ選択、結果、履歴、ポーリング|
|`frontend/src/GamblePlay.tsx`|手動リール停止・HIT／STAND・カードの絞り／公開・手動再戦・反映。自動進行タイマーなし|
|`frontend/src/StoryHistory.tsx`|既存の確定済み版を縦書き原稿の束として表示。結果／履歴で共通の前後めくり。API・保存形式を変更しない|
|`frontend/src/history.css`|原稿の重なり・めくり・最新紙の到着とreduced motion時のフェード|
|`backend/app/gambles.py`|ゲーム別の抽選・変化の強さ・図柄・事前配列カード|
|`frontend/src/types.ts`|APIの画面側型。Python側モデルと同期する|
|`frontend/src/api.ts`|fetch、公開APIホストの切替、エラー表示用例外|
|`frontend/src/style.css`|白黒・縦画面・セーフエリア・本文内スクロール|
|`backend/app/main.py`|API、開始文ロード、セッション開始、状態の公開、CORS|
|`backend/app/analysis.py`|ローカル解析の組立、コマ数検査、報酬候補。名前はanalysisだが開始時AI解析ではない|
|`backend/app/segmentation.py`|Sudachi分割、辞書補正、助詞等の結合、選択可否、名詞アンカー抽出|
|`data/lexicons/wiktionary_ja.json`|Wiktionaryから生成した複合語・慣用句の検索索引|
|`scripts/import_wiktionary.py`|元のJSONL.gzから再現可能な索引を生成|
|`data/segmentation_dictionary.json`|まとまりとして保護する語・枠なしにする接続表現|
|`backend/app/engine.py`|抽選保存、意味解釈、編集、状態確定、再試行・キャッシュ|
|`backend/app/gemini.py`|REST呼出、構造化JSON、モデル検証、意味と原文の照合|
|`backend/app/prompts.py`|共通System・意味解釈・勝利編集・敗北編集|
|`backend/app/editing.py`|文の切出し、編集可能範囲・差分量・保護語・重複検査、本文の組立|
|`backend/app/models.py`|Pydanticの入出力・構造化生成スキーマ|
|`backend/app/store.py`|JSON保存、ロック、プロセス再起動時の中断復旧|
|`backend/app/quota.py`|UTC日付単位の呼出予約・制限|
|`backend/app/config.py`|環境変数、`.env`読込|
|`data/stories.json`|現行開始文100件。id/title/genre/tagline/text|
|`data/stories-classic.json`|以前の長く重い開始文。現在は使用しない|
|`scripts/serve.py`|API＋存在すればビルド済み画面の統合配信|

## 取引の流れ

```text
保存済み開始文
  → 保存済みUnit[]を読み込み（未生成・更新時はローカルで分割） → 報酬候補
  → 報酬選択 → unit_ids選択 → ゲーム選択
  → 必要個数・本文版・重複・可否検査
  → 取引ID・勝敗・変化の強さ・演出用の図柄／カードを保存
  → 演出開始。以下の生成処理を並行して進める
  → Gemini.resolve_stakes（選ばれたコマだけの意味と原文上の言及）
  → ID・原文・言及照合、成功した解釈を保存
  → Gemini.win / loss（文字列の部分編集案）
  → 置換可能な原文・範囲・重複・差分量・保護条件・自己確認を検査
  → 原文と編集案から更新本文をローカルで組立
  → Gemini.review（組み立て済みの全文を読み直し、文法・重複・因果・勝敗の方向を確認）
  → 修正があれば元の本文に当て直し、同じ編集範囲と差分上限を再検査
  → 検査済みの本文を保持し、演出後の反映ボタンを待つ（awaiting_reveal）
  → 次ラウンドの分割と報酬をローカル準備
  → 本文版・履歴・消失済み意味をまとめて保存 → 結果画面
```

通常は1取引3回のAI呼出（意味解釈・初稿編集・全文レビュー）。修正はレビューの同じ応答で受け取る。レビューは思考レベルMEDIUM、意味解釈と初稿編集はMINIMAL。開始・タップ・次本文分割でAIを呼ばない。確定勝敗を維持し、解釈成功後は解釈をキャッシュする。生成の失敗や24秒の時間切れにはサーバーの定型文で結果を完成させ、ボタン操作での再試行は求めない。

全文レビューは `review_policy.py` の配点・しきい値で5項目を検査する。モデルは各項目の問題有無と具体的理由を返し、コードが各配点を1回ずつ合算する。満点100、喪失への言及残り30／設定の矛盾20／時制・視点・文体10／つながり・指示語20／勝敗との食い違い30点、合計減点20点超で却下（20点は許容）。repairの検査対象は同じ応答内の修正を適用した最終本文。しきい値超過は `ReviewScoreRejected` とし、項目・点数・理由をサーバーログへ残して直ちに既存の定型文へ進む。この却下では自動再生成しない。点数や指摘はセッション・公開APIへ保存せず、報酬・選択可否にも使わない。

初稿が変更上限を超えた場合や、レビューが初稿と同じ修正案を返すなど、本文の確認に失敗した場合は、不採用の本文と理由を渡して原文から一度だけ自動で作り直す。新しい案にもレビューを行う。意味解釈と確定した勝敗は再利用するため、自動回復で増えるAI呼出は最大2回。差分量が原因なら上限を緩和し、通信失敗や利用制限時は定型文へ進む。

## 主要データ

- `betting_mode: count-v1`：旧点数セッションを黙って読み替えないための方式ID。
- Unit：`id/text/start/end/stakeable`。scoreはない。オフセットはPython文字列の位置として生成する。JSのUTF-16 indexへ勝手に流用しない。画面はユニットのtextで描画する。
- Offer：`id/title/description/family/required_count/change_scale/tier`。familyは`expression`（表現系）／`plot`（展開系）。`rewards.py`の段階×要求数×系統の候補から選び、成立する価格ごとに1件、展開系を最低1件保証する。提示はセッションのoffersとして保存し、GET・開始再送・取引再送・continueでは再抽選しない。旧保存のfamily欠落は名称から生成方針と表示だけを補い、候補は置換しない。required_pointsは廃止。
- Session：本文、version、analysis、offers、transactions、lost_concepts、status、view、pending_transaction_id、win_probability、api_calls、usage等。
- Transaction：request_id由来のid、source_version、unit_ids、selected_units、stakes、outcome、staked_concepts、lost、meanings_resolved、attempts、before/after等。
- ResolvedConcept：label/kind/descriptionと、実際に選んだselected_surfaces・本文に存在するmentions。異なる位置の同じ意味をまとめても個数は減らさない。
- 編集案：sentence_id/before/after/reason。全文生成をそのまま本文へ採用せず、元本文への局所置換から組み立てる。

## 編集の制約

ゲームを指定した取引では勝敗と変化の強さをGeminiへ渡す。強さ1の勝利は1文・24文字差分を上限とし、強さ4以上では賭けに結びつく大きな変化を許す。旧クライアントからのゲーム未指定取引は従来のchange_scaleに従う。敗北は選択語とその言及から編集可能文を決め、人物消失や複数対象では必要な範囲を広げる。関係だけの消失では未選択の名詞を保持する追加検査がある。

AIの本文案は最大140文字。定型文による勝利の補完は、元の文を残すためこの長さを超える場合がある。意味の保持・消失・報酬の自己確認はLLM自身によるもの。原文照合などの機械検査が通っても意味や自然さが保証されるわけではない。

## API

|method/path|用途|
|---|---|
|GET `/api/health`|設定済みか・model・betting_mode。キー値は返さない|
|POST `/api/stories/draw`|exclude付きの候補3件抽選|
|POST `/api/sessions`|story_id/request_idで開始。再送の同一IDを保護|
|GET `/api/sessions/{sid}`|進捗・結果を取得|
|GET `/api/games`|ゲームの種類・決着時の勝率・演出の説明|
|POST `/api/sessions/{sid}/transactions`|request_id/version/offer_id/unit_ids/gameで取引開始。game省略は旧クライアント互換|
|POST `/api/sessions/{sid}/transactions/{id}/play`|初心者向けの操作を保存。あいこは次の手番を待ち、決着で生成を開始。同じ手番の再送は二重処理しない。|
|POST `/api/sessions/{sid}/transactions/{id}/finish`|演出後に反映を確定。同じIDで再送しても再抽選しない|
|POST `/api/sessions/{sid}/retry`|保存済み同一勝敗で手動再試行|
|POST `/api/sessions/{sid}/continue`|結果から次の報酬・選択へ|

## 保存と互換性

JSONファイルの原子的置換＋単一プロセスのセッションロック。多worker・複数インスタンスへそのまま拡張しない。ブラウザはセッションIDと選択をプレイ中のReact状態で保持する。取得APIは生成待ちのポーリングや通信エラー後の状態確認で使う。

辞書変更で既存セッションの `analysis` は自動再計算されない。新規開始・次の本文版で新規則が使われる。編集中・確定済み取引のUnit IDや選択範囲を勝手に変えない。分析規則の版管理・安全な移行は今後の課題。


## ストーリー進行 S2＋S3（2026-11-18、ローカル実装）

`backend/app/story_progress.py` がcommitted取引の集計と進行遷移を担当する。新規開始・旧セッションの初回GETで規定回数を保存し、`engine.commit_transaction` が到達スナップショットを確定する。保存層は既存JSONとセッションロックを維持する。

`story_progress` の保存項目はrequired_rounds、phase、reached、extension_start、choices。公開時にtotalsとextension_roundsを導出し、forced中はrequired_roundsを伏せる。フェーズはforced→escapable→extension→ended（escapableから直接endedも可能）。

`POST /api/sessions/{sid}/story-choice` は `{request_id, version, choice: "escape" | "continue"}` を受け取りセッションを返す。同一request_idは同じchoiceとversionなら再送可能。新規選択は最新のreadyな結果画面に限定。終了後・到達時選択前の新規取引およびcontinueを拒否する。

`frontend/src/StoryProgress.tsx` が集計・到達選択・延長戦入口・エンディングを描画。確定台詞はscenario.tsに集約。両モードの共通結果経路に適用する。

## アノマ常駐ステージ（UI再設計 Phase A、2026-11-18）

`App` の `AnomaStageProvider` が画面と共通ステージを包む。`AnomaStage` はapp-shellのnavigation-bar直下に一度だけ配置する。各画面の `StagePublisher` は描画せず、台詞群・表情をContextへ発行し、アンマウント時にnormal・台詞なしへ戻す。タイトル／物語選択／言葉選び／生成中は既定、ギャンブル中はtaunt、オープニング／結果／到達／延長戦／エンディングは各画面が発行する。通常結果は純粋関数 `resultReaction` が確定取引と取引IDから従来どおり決定する。保存・APIは使用しない。旧AnomaFrame／AnomaResultは廃止。検証保留の詳細はSTATUSを参照。

## 固定ゲーム画面（2026-11-18）

`App` と `layout.css` が、ナビと共通ステージの下にメタ行、主役エリア、アクションバーを配置する。賭け種目のボタンは種目側の状態を使い、操作バーへポータルで描画する。結果の版・勝敗は `storyVersions` と現在のめくり位置から取得し、差分は原稿の強調表示を切り替える。ゲーム画面の仕様は [UI_LAYOUT.md](UI_LAYOUT.md) を参照。
