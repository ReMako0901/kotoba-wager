# 他のAI・開発者への引き継ぎ

最終整理：2026-11-11。ここは会話を読んでいない開発者の入口。仕様と実装が違う場合は、最新のユーザー指示を最優先し、実コード・Git履歴で差を確認する。

|資料|内容|
|---|---|
|[STATUS.md](STATUS.md)|現在動くもの、検証済み範囲、公開版との差分|
|[GAME_OVERVIEW.md](GAME_OVERVIEW.md)|ゲームの目的、遊び方、決定事項、過去案との違い|
|[TECH_STACK.md](TECH_STACK.md)|使用ツール、依存関係、環境変数、起動・確認コマンド|
|[CHANGELOG.md](CHANGELOG.md)|更新履歴と仕様変更の理由|
|[TODO.md](TODO.md)|次に行う作業、優先順、受け入れ条件|
|[SHARED_NOTES.md](SHARED_NOTES.md)|ユーザーの好み、未決定事項、研究上・運用上の注意|
|[ARCHITECTURE.md](ARCHITECTURE.md)|ファイル対応、処理の流れ、データ、エラー・再試行|
|[WORD_DICTIONARY.md](WORD_DICTIONARY.md)|Wiktionary索引の再生成・ゲーム用補正辞書の編集方法|
|[DICTIONARY_CANDIDATES.md](DICTIONARY_CANDIDATES.md)|既存の無償辞書候補と採用経緯|
|[HOSTING_OPTIONS.md](HOSTING_OPTIONS.md)|Google AI Proのクレジット・RenderとCloud Runの比較|
|[PHASE0_GUIDE.md](PHASE0_GUIDE.md)|Cloud Run移行 Phase 0 のユーザー作業手順（プロジェクト・課金・クレジット・Firestore・Secret）|

最短の読み順：STATUS → GAME_OVERVIEW → TODO。実装前に ARCHITECTURE・TECH_STACK・SHARED_NOTES と、対象機能の資料を読む。

次のAIに渡す指示例：

> このリポジトリのAGENTS.mdとdocs/README.mdを読み、現行仕様と公開版との差を確認してください。docs/TODO.mdから今回指示された範囲を実装し、検証・資料更新・日本語Gitコミットまで行ってください。計画や過去の検証を、実装済み・今回検証済みと扱わないでください。

古い資料 `VERIFICATION.md`・`FEEDBACK_2026-11-10.md`・`PUBLISH.md` には廃止済みの点数方式の記述がある。現在仕様の入口として使わない。過去の検証証拠として保持する。

この一式は今後も更新する運用。CHANGELOGは追記、STATUSは現在状態へ書き換え、TODOは完了・残件を整理する。更新日時・実行した検証・未実施の検証を残す。
