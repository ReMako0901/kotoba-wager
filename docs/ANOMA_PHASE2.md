# アノマ画像の組み込み（視覚 Phase 2＋表情の緩やかな切替）

ANOMA_ROADMAP の Phase 2（静止画の組み込み）と、Phase 4 の
基礎アニメーションのうち「表情の切替」だけを先に実装する。
ユーザーの指示（2026-11-18）：パッと切り替えるのではなく、
じわっと変わる感じにする。

## 素材（配置済み）

`frontend/public/anoma/` に 768×768 WebP を8枚配置済み
（原本は anoma-art の output_plain4、瞳は完全に無地）。

| 表情ID | ファイル | 元の表情 |
| --- | --- | --- |
| normal | normal.webp | 通常 |
| smile | smile.webp | 微笑み |
| laugh | laugh.webp | 笑い |
| taunt | taunt.webp | 挑発 |
| surprise | surprise.webp | 驚き |
| perplexed | perplexed.webp | 困惑 |
| displeased | displeased.webp | 不機嫌 |
| uncanny | uncanny.webp | 異常 |

## 表情の決め方（既存の共通イベントに接続する）

新しい判定は作らない。既存の reactionTrigger と StoryProgress
の状態から、表示箇所ごとに表情を1つ決める。

- 結果画面（AnomaResult）：trigger から決める
  - gain → smile
  - winStreak → laugh
  - loss → taunt
  - lossStreak → perplexed
  - change（大きな改変）→ uncanny
- オープニング（Opening）：normal
- 到達の提示（StoryDecision、phase=escapable）：surprise
- 延長戦の入口（StoryDecision、extensionWelcome 表示時）：taunt
- ノーマルエンディング（NormalEnding）：差分が
  正 → smile、0 → normal、負 → displeased

対応表は scenario.ts に集約し（例：expressionForTrigger）、
コンポーネント側に散らさない。

## 表示と切替（じわっと変わる）

- AnomaFrame に expression を渡すと、名前・台詞の上に
  ポートレートを表示する（既存の portrait スロットは
  この仕組みに置き換える）
- 切替はクロスフェード：前の表情の画像の上に、新しい表情の
  画像が約900ms かけて重なって現れる。直前の表情はモジュール
  内に保持し、画面遷移をまたいでも前の表情から溶けるように
  変わる。初回表示は軽いフェードイン
- 画像の読み込みに失敗したら、ポートレート全体を隠して
  従来の台詞だけの表示にする（ゲームは止めない）
- prefers-reduced-motion ではフェードを無効にし、即時切替にする
- サイズはフレーム幅に合わせた正方形（上限 250px 程度）、
  スマートフォン縦画面で台詞を圧迫しないこと

## 含まないもの

- 瞳文字（Phase 3）、瞬き・口パク等の分割アニメーション
  （Phase 4 の残り）、背景の透過処理、バックエンドの変更、
  台詞・確率・抽選・保存の変更

## テスト観点

- trigger → 表情の対応が仕様どおり（5種すべて）
- エンディング差分 → 表情の対応（正・0・負）
- 到達＝surprise、延長戦入口＝taunt の対応
- AnomaFrame が expression に対応する画像（/anoma/<id>.webp）を
  表示すること
- クロスフェードの構造（重ね表示とフェード用クラス）と
  reduced-motion の無効化が CSS にあること
- 画像読み込み失敗時にポートレートが隠れる分岐があること
