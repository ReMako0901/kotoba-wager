import type { Gamble } from './types';

export function isNearMiss(gamble: Gamble) {
  if (gamble.outcome !== 'loss') return false;
  if (gamble.kind === 'slot') return new Set(gamble.reels).size === 2;
  if (gamble.kind === 'dice') return (gamble.moves?.[0] as { face?: number } | undefined)?.face === 3;
  if (gamble.kind === 'baccarat') return gamble.rounds.at(-1)?.difference === 1;
  // A loss alone is not evidence of a near miss.
  return false;
}
