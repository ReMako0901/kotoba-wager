# PROJECT_PLAN.md

対象: kotoba-wager（ギャンブルライティングメーカー(仮称)）
公開: https://remako0901.github.io/kotoba-wager/ ／ ソース: https://github.com/ReMako0901/kotoba-wager
状態: **確定**（2026-11-13、ユーザーが §4 の決定事項を承認）。
役割: 企画・仕様整理は Muse、実装は Codex、課金・公開・切替の承認はユーザー。

---

## 1. 目的

Render 無料枠の制約（15分で休止、再起動・再デプロイでローカルファイル＝セッションと
呼出カウンターが消える）を解消し、ゲームのサーバーをまるごと永続化できる環境へ移す。
移行後に「みんなの物語」（完成した物語の共有ギャラリー）を追加する。

## 2. 現在地（2026-11-13 時点、公開リポジトリで確認）

- 画面: React 19 + TypeScript + Vite、GitHub Pages 配信
- API: Python / FastAPI、Render 無料 Docker Web Service（Singapore）、Dockerfile + render.yaml
- 分割: SudachiPy + sudachidict-core + Wiktionary 索引（13,907語）、開始文100件は事前計算済み
- 生成: 勝敗を先に確定・保存し、`asyncio.create_task` の裏側処理で Gemini を
  意味解釈・編集・レビューの3回呼ぶ。失敗時は同じ勝敗で定型文フォールバック
- 保存: `backend/app/store.py`。セッションごとに JSON ファイル + プロセス内 asyncio ロック +
  原子的置換。起動時に generating のままのセッションを復旧する
- ガード: Gemini 呼出上限は UTC 日次100回（render.yaml の `GEMINI_DAILY_CALL_LIMIT`）。これもファイル保存
- ゲーム内容: ギャンブル6種、個数方式（1/2/3個）、エンディング未実装の繰り返し型プロトタイプ
- テスト: pytest 一式あり（分割・抽選・編集・API など）

## 3. 移行先の構成（確定方向）

- 画面は GitHub Pages のまま。切替は GitHub の Repository variable `API_BASE_URL` の差し替えのみ
- API は Google Cloud Run（Docker の Python/FastAPI をそのまま動かす）
- 保存は Firestore。セッション本体と transactions を分け、1ドキュメント 1MiB 上限を踏まない
- Gemini の API キーは Secret Manager 経由でバックエンドだけに渡す。シークレット名は
  `kotoba-wager-key`（Phase 0 で作成、2026-11-13 確定）で、Cloud Run では環境変数
  `GEMINI_API_KEY` としてマウントする
- Render は検証が終わるまで残し、切り戻せる状態を保つ。切替と Render 停止はユーザーの承認後

### 移行しない選択肢の扱い
- Cloudflare Workers + D1: SudachiPy の移植が前提になり、分割の再実装＝全面書き換えになるため不採用。
  D1 は将来の別機能で必要になれば再検討する
- 自作 PC + Cloudflare Tunnel: 予備案として保持。常時起動と障害対応がユーザー持ちになる
- Render 有料化: 最も小さい変更で済む代替案として保持

## 4. 決定事項（2026-11-13 確定）

- D1 進め方: 段階分離。第1段階＝保存と生成方式の移行だけで現行と同等を検証。
  第2段階＝みんなの物語。理由: 同時変更は障害時の原因切り分けを困難にする
- D2 生成方式: Cloud Tasks → 内部エンドポイント（OIDC 等で保護）が生成を自リクエスト内で完了させる。
  現行の「演出と並行して生成し、ポーリングで受け取る」体験を保つため
- D3 リージョン: Cloud Run / Firestore とも asia-northeast1（東京）。利用者が日本中心のため
- D4 最小インスタンス: 0。ただし初回起動時間（Sudachi 辞書読み込み含む）を実測し、
  体験を損なう場合は最小 1（常時課金）を再検討する。最大インスタンスには上限を設ける
- D5 旧データ: 移行しない。現行セッションは再起動で消える前提の試作データであり、
  切替後は新規開始に統一する。呼出カウンターも移行先で新規に数え始める
- D6 呼出上限: 移行検証中は日次100回を維持。1取引≒3呼出のため全員合計で1日30取引強で
  上限に達する点を理解した上で、本格公開の前に引き上げ可否を再判断する。予算アラートも併せて設定する
- D7 ユーザー作業: Google Cloud プロジェクト作成、Cloud Billing 有効化、Google AI Pro の
  Cloud クレジット請求・適用確認、Secret Manager へのキー登録はユーザーが行う。
  Muse が手順書を用意し、Codex・Muse は課金/権限操作を代行しない
  - 改訂（2026-11-13、ユーザー指示）: Phase 2 以降の定型的な権限・デプロイ操作
    （Cloud Tasks キュー作成、IAM 付与、Cloud Run デプロイ、検証の実行）は、本人が
    明示的に指示した場合に限り Codex が実行してよい。条件は、実行コマンドの事前表示、
    エラー時は別解を試さず止めて報告すること。公開切替（`API_BASE_URL` の変更）と
    Render の停止は、引き続き本人の明示承認なしに行わない。Phase 0 の土台作業を
    本人が実施した経緯は変えない。

## 5. フェーズ計画

### Phase 0: 準備（ユーザー作業 + 手順書）

手順の正本は `docs/PHASE0_GUIDE.md`。完了後は同書の「完了したら Muse へ知らせる内容」を報告する。
- Cloud プロジェクト作成、Billing 有効化、AI Pro クレジットの適用確認
- Firestore（Native）作成、Secret Manager 登録
- 受け入れ: API キーがコード・Git・画面に出ていないこと

実施状況（2026-11-13）: 完了。予算アラートのみ、ユーザー判断で設定しないこととした
（通知のみの仕組みで必須ではない。暴走防止はアプリ側の日次呼出上限100回と、Phase 1 で
設定する Cloud Run の最大インスタンス数で担保する）。
- プロジェクト `kotoba-wager`（番号 108927229642）作成、AI Pro クレジット適用 OK
- Firestore `(default)`: asia-northeast1 / FIRESTORE_NATIVE / STANDARD を gcloud で確認済み
- Gemini キーは AI Studio でこのプロジェクトを指定して作成し、Secret Manager の
  `kotoba-wager-key` に登録。compute デフォルト SA へ secretAccessor を Cloud Shell で付与済み
  （コンソールの付与ダイアログでは developer.gserviceaccount.com のプリンシパルが検証エラーになる）
- Step 8 の必要 API 7件の有効化完了


### Phase 1: 移行（Codex 実装）
実装指示の正本は `docs/PHASE1_INSTRUCTIONS.md`（2026-11-13 作成。Phase 0 の確定値と
環境変数名・データ設計・受け入れ条件を含む）。
- store の Firestore 化（トランザクションで冪等性・version 検査・再抽選防止を保証）
- quota カウンターの Firestore 化
- 生成方式の Cloud Tasks 化（D2）。フォールバック（同じ勝敗で定型文完成）は維持
- Dockerfile / デプロイ定義の調整、切替・切り戻し手順を docs に記録
- 受け入れ: 既存 pytest 全通過 + Firestore エミュレータでの store テスト追加。
  ローカルで開始→取引→生成→反映→次ラウンドが通る。再送で再抽選しないことを確認

### Phase 2: 検証と切替（ユーザー承認）
実行手順の正本は `docs/PHASE2_GUIDE.md`（2026-11-13 作成）。デプロイコマンドは
Phase 1 の `docs/DEPLOY_CLOUD_RUN.md` に従う。Phase 1 は実装済み
（ブランチ `codex/phase1-cloud-run`。コード検分はユーザーの判断で省き、検証は
Phase 2 の実環境確認で担保する）。
- 新 API で実 Gemini プレイ、再起動相当の操作をまたいで保存が残ることを確認
- 初回起動時間を実測し D4 を最終判断
- 承認後に `API_BASE_URL` を切替。Render は当面残す

実施状況（2026-11-13）: A〜E 完了。D の検証5項目はすべて合格（実 Gemini の
フォールバックなし完走、Cloud Tasks 配信と HTTP 204 の照合、再送で再抽選なし、
再デプロイをまたぐ保存の継続、日次カウンター 8→11）。検証中に最終確認の
`ReviewRejected` が2回発生したが再現せず理由は未特定。却下理由を識別するログは
配備済みのため、再発時は特定できる。E のコールドスタート実測は確認済み2回で
6.647秒 / 2.766秒（ガイドの目安「十数秒以内」）のため、D4 は最小インスタンス 0 で
確定した。残るは F の切替（ユーザーの明示承認待ち）と手順0のブランチ push 再試行。

### Phase 3: みんなの物語（Codex 実装）
- 完成画面で本人が「みんなに公開する」を押したときだけ `public_stories` に保存
  （自動公開しない。自分で入力した私的な文章が勝手に出ないため）
- 一覧は最新順20件ずつ、詳細表示つき。作者名は任意ニックネーム
- 保存項目: タイトル、完成本文、元の本文、手に入れた表現、失った言葉、勝敗数、作成日時
- 削除は当面ユーザーが Firestore コンソール等から手動対応（管理画面は作らない）
- 受け入れ: 公開した物語が他ブラウザから見えること。未公開の物語が一覧に出ないこと

## 6. 守る仕様（不変条件）

- 抽選は一度だけ確定して保存。再送・再試行・通信失敗で再抽選しない
- 分割（Sudachi 系一式）と本文オフセットの対応を変えない。形態素解析を差し替えない
- 個数方式（選べるコマは同価1個、報酬は1/2/3個ちょうど）を維持。点数方式・AI 採点を復活させない
- API の外部契約と `frontend/src/types.ts` の同期を保つ。変える場合は実装前にユーザーへ報告
- 生成失敗を敗北扱いにしない。失敗時は同じ勝敗で補完する

## 7. リスクと未確認

- Google AI Pro クレジットの実際の適用可否・請求形態（Prepay の初回入金要否など）はユーザー側で未確認
- Cloud Run のコールドスタート実測値が未取得（Sudachi 辞書 + Wiktionary 索引の読み込み時間）
- 現行 API はセッション ID を知れば取得できる試作仕様。公開ギャラリー追加時に、
  セッション側の認可をどうするかは Phase 3 の前に別途判断する
- 課金は Cloud Run / Firestore / Gemini API / Cloud Tasks の合算。予算アラートは通知のみで
  支出を止めない点に注意する

## 8. 文書の更新ルール

- ユーザーが方針を変更したら、この文書と AGENTS.md の該当箇所を同じ変更で更新する
- 決定を変更したら §4 に日付と変更内容を残す
- 実装の進捗そのものはリポジトリの docs/STATUS.md・TODO.md 側で管理し、この文書には持ち込まない
