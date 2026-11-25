import type { Gamble } from '../types';

// 新規ギャンブル画面が外側（App）から受け取る契約。仕様は docs/UI_GAMES_FRESH.md。
export interface FreshGambleProps {
  gamble: Gamble;
  busy: boolean;
  error?: string;
  // 物語への反映準備ができたら true。false の間は完了ボタンを押せない。
  prepared: boolean;
  // サーバーへ手番を送る種目だけが使う（じゃんけん・サイコロ・カード当て）。
  onMove: (attempt: number, choice?: number) => void;
  // 結果を物語へ反映する。
  onFinish: () => void;
}
