import type { Transaction } from './types';

export const openingNarration = [
  '目を覚ますと、目の前には真っ白な空間が広がっていた。',
  'そこには、黒髪の女性が一人。',
  '女性はプレイヤーを見つめ、静かに微笑む。',
];
export const scenario = {
  opening: [
    'こんにちは。目が覚めたのね。',
    '私の名前はアノマ。ここでは、少し変わった遊びをしているの。',
    'あなたには、言葉を賭けてもらうわ。',
    '勝てば言葉が増える。負ければ減ったり、意味が変わったりする。',
    '簡単でしょう？',
    '決められた回数だけ遊んだら、帰してあげる。',
    'それじゃあ、始めましょうか。',
  ],
  gain: ['一つ増えたわね。よかったじゃない。'],
  loss: ['あら、一つ減っちゃったわね。でも、次に勝てばいいでしょう？'],
  change: ['ふふっ。少し意味が変わっただけよ。'],
  winStreak: ['ずいぶん増えたじゃない。もっと増やしてみる？'],
  lossStreak: ['減ってばかりね。でも、まだ言葉は残っているでしょう？'],
};
export type ReactionTrigger = Exclude<keyof typeof scenario, 'opening'>;
export type ReactionKind = 'normal' | 'gain' | 'loss' | 'change';
export const reactionKinds: Record<ReactionTrigger, ReactionKind> = {
  gain: 'gain', loss: 'loss', change: 'change', winStreak: 'gain', lossStreak: 'loss',
};

// A sole confirmed line must remain available; with multiple candidates exclude the last line.
export function chooseLine(candidates: readonly string[], previous?: string, random = Math.random): string {
  const alternatives = candidates.filter(line => line !== previous);
  const pool = alternatives.length ? alternatives : candidates;
  return pool[Math.floor(random() * pool.length)];
}

export function reactionTrigger(transactions: readonly Transaction[]): ReactionTrigger | undefined {
  const committed = transactions.filter(tx => tx.status === 'committed');
  const current = committed.at(-1);
  if (!current?.outcome) return undefined;
  if ((current.lost?.length ?? 0) >= 2 || (current.gamble?.strength ?? 0) >= 6) return 'change';
  if (committed.at(-2)?.outcome === current.outcome) return current.outcome === 'win' ? 'winStreak' : 'lossStreak';
  return current.outcome === 'win' ? 'gain' : 'loss';
}


export const extensionWelcome = [
  '帰れるのに、まだ遊ぶの？',
  'ふふっ。いいわよ。私はいつまでも付き合ってあげる。',
];
export const normalEndings = {
  positive: ['今回は言葉がたくさん増えたじゃない。', 'よかったわね。', 'また遊びにいらっしゃい。'],
  negative: ['今回は少し減っちゃったわね。', 'でも、これしか減らなかったんだからよかったじゃない。', 'また次に増やせばいいのよ。'],
  zero: ['増えた数と減った数が同じね。', 'つまり、何も変わらなかったってことじゃない。', 'ふふっ。次はもう少し頑張ってみたら？'],
};
export function normalEnding(difference: number): readonly string[] {
  return normalEndings[difference > 0 ? 'positive' : difference < 0 ? 'negative' : 'zero'];
}
