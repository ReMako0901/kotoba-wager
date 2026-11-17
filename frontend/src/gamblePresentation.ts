import type { Gamble, GameKind } from './types';

// Display metadata only. Never use these values to resolve a transaction.
export const changeShapes: Record<GameKind, string> = {
  rps: '変化の形：ほどよい揺らぎ', card_guess: '変化の形：当たれば小さく、外れれば大きく',
  dice: '変化の形：端の目で大きく揺れる', slot: '変化の形：図柄によって波がある',
  blackjack: '変化の形：小さく着実に', baccarat: '変化の形：点差によって大きく揺れる',
};

export const revealDuration = 1800;
export function revealStep(elapsed: number, skip = false, reduced = false) {
  return skip || reduced ? 3 : Math.min(3, Math.floor(Math.max(0, elapsed) / 600));
}
export function isNearMiss(gamble: Gamble) {
  if (gamble.outcome !== 'loss') return false;
  if (gamble.kind === 'slot') return new Set(gamble.reels).size === 2;
  if (gamble.kind === 'dice') return (gamble.moves?.[0] as { face?: number } | undefined)?.face === 3;
  if (gamble.kind === 'baccarat') return gamble.rounds.at(-1)?.difference === 1;
  // A loss alone is not evidence of a near miss.
  return false;
}
