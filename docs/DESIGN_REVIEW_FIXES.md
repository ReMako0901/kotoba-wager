# デザインレビュー改善の実装仕様（2026-11-23）

発端：OSSスキル「anything-frontend-art-direction」のチェックリストで現行フロントを
監査したレビュー（監査文書は repo 外の audit/design-review-2026-11-23.md）で挙がった
7件を、ユーザーが「全部やって」と承認したもの。対象はフロントの見た目と堅さのみ。
ゲーム仕様・確率・抽選・保存・バックエンド・API契約は変更しない。

## 1. 見出し明朝の自己ホスト（P1-1）

- 現状 `--serif` は端末標準書体依存で、Androidでは汎用serifに落ちる。
- 書体は **Shippori Mincho B1（しっぽり明朝B1）の 700／800** を採用する。
  フォント実体は Muse が供給済み：`frontend/src/assets/fonts/` に
  `kotoba-serif-700.woff2`／`kotoba-serif-800.woff2`（各約1.07MB、4,018グリフ。
  収録字は repo 全文から集めた漢字3,631字＋かな・記号・英数字類。収録外の字は
  フォールバックの端末明朝で描かれる）と、ライセンス `OFL-ShipporiMinchoB1.txt`。
  ネットワーク取得は不要（サンドボックスの制限回避のため供給済みのを使うこと）。
- 新規 `frontend/src/fonts.css` に `@font-face`（family 名 `'Kotoba Serif'`、
  weight 700／800、`font-display: swap`、src は相対 url）を書き、App.tsx の
  import 先頭（tokens.css と並ぶ位置）で読み込む。
- `--serif` の先頭に `'Kotoba Serif'` を置く。後ろは現行の Hiragino Mincho ProN／
  Yu Mincho／Noto Serif JP／serif を残す（サブセット外の字や読込失敗時の保険）。
- 自己ホストするのは見出しが使う 700／800 のみ。本文の端末明朝は現行のまま。

## 2. 紙画面の注釈コントラスト（P1-2）

- 明色背景（紙・白地）で機能を持つ注釈文字は、コントラスト比 4.5:1 以上、
  サイズは最小 11px を満たすよう調整する。対象の現状値：#999（2.85:1）、
  #777（白地 4.48:1、#f3f3f0 上 4.03:1）、9〜10px の chapter-line／edition／
  reading-hint／quiet 等。
- 目安：#999→#6b6b6b、#777→#5f5f5f。ただしテーブル（緑地）側の配色は健全
  （#fff3e4／#193731 で 11.76:1）なので変更しない。装飾だけの小字（版表示などの
  非機能要素）は対象外としてよいが、対象外にした要素は CHANGELOG に列挙する。
- 紙の軽い印象を壊さないこと。濃くするのは注釈のグレーだけ。

## 3. トークン集約と死んだ規則の整理（P2-3）

- 新規 `frontend/src/tokens.css` を作り、CSS変数をここに集約する：
  manuscript.css の --ink／--stamp／--rule／--serif／--cell-size／--paper-rows、
  table-finish.css の --brass／--paper／--contact／--weave。
  あわせて紙の段階（--paper-1 白／--paper-2 生成り／--paper-3 濃い生成り）と
  テーブルの緑（--table-1／--table-2）を、現在使われている実値そのままで定義する。
- tokens.css は App.tsx の import 先頭に置く。各CSSの変数定義は tokens.css へ移し、
  元の場所からは消す（値の変更はしない）。
- 近似した白系（#fffdf9／#fff8eb／#fff6e7／#fff5e7／#fff3e4 等）は、**視覚的に
  同一と確認できるものだけ**トークンへ寄せる。迷ったら寄せない。
- style.css の土台規則のうち、後段の全シートで常に上書きされ実画面に一切効いて
  いないものだけを削除する。判断が割れるものは残し、削除した規則を CHANGELOG に
  列挙する。見た目を変える整理はしない（検証は Muse が撮影差分で行う）。

## 4. フォーカス表示の統一（P2-4）

- 標準を table-finish.css の形（outline 3px #186e90 ＋ box-shadow 0 0 0 5px
  #fff1c9）に統一し、.app-shell 全体に効かせる。
- 縦書き単語 .vertical-word の内側オフセット型だけは例外として残し、理由を
  CSSコメントに書く。それ以外の focus-visible の独自定義は標準へ寄せる。

## 5. Noto Sans JP の読み込み軽量化（P2-5）

- style.css 先頭の @import をやめ、index.html の link（preconnect＋stylesheet、
  display=swap）へ移す。
- ウェイトは frontend/src 内で実際に使われている font-weight を grep で数え、
  使われているものだけに絞る。太字の見え方が変わらないよう、700／800／900 は
  使用実績があれば残す。

## 6. 無限アニメーションの確認と手当て（P3-6）

- 無限指定のアニメーション（paper-turn-hint、turn-card、tumble 等）を全て洗い出し、
  「何の状態で動いていて、何で止まるか」を CHANGELOG に表で残す。
- 操作開始後や結果表示中も動き続けるものがあれば止める。待ち表示として必要な
  ものは残してよいが、prefers-reduced-motion で止まることを確認する
  （現行の reduced-motion 対応は維持する）。
- paper-turn-hint のように操作を促すヒントは、繰り返し回数の上限（3回）を付ける。

## 7. 新画面の2案比較を手順として文書化（P3-7）

- 新規 `docs/DESIGN_PROCESS.md` を作る。今後、新しい画面を作るときの手順として：
  (1) 題材の中から主役にする「物」を2つ挙げる、(2) 色だけの差ではなく
  文字・地・線・操作の関係を変えた実画面モックを2案作る、(3) 読める情報と
  題材らしさで比較し、採用理由を記録してから実装する、を明記する。
- 既存画面の小修正には適用しないことも書く。今回は手順の文書化のみで、
  新画面そのものは作らない。

## 検証（実装者）

- `node --test frontend/tests/*.test.cjs` 全成功。
- ビルド `timeout 40s npx -y pnpm@latest run build` を1回だけ試行し、結果を
  正直に記録する（従来から無出力タイムアウトの持病がある。再試行しない）。
- `git diff --check` 成功。フォントのライセンスは供給済みの
  `frontend/src/assets/fonts/OFL-ShipporiMinchoB1.txt` をそのまま同梱する。
- 完了したら CURRENT_INSTRUCTIONS の状態、docs/STATUS.md、docs/CHANGELOG.md を
  実態に合わせて更新する。コミットは意味のある単位で分ける。push はしない
  （検証と push は Muse 担当）。
