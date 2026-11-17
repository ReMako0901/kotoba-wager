import type { ReactNode } from 'react';
import type { Gamble } from './types';
import { isNearMiss } from './gamblePresentation';

// The player has already submitted a move. CSS decorates its result without advancing play.
export function GambleMotion({ gamble, children }: { gamble: Gamble; children: ReactNode }) {
  return <div className={`gamble-motion motion-${gamble.kind}${isNearMiss(gamble) ? ' near-pulse' : ''}`}>
    <div className="motion-result">{children}</div>
  </div>;
}

export function GenerationSkeleton({ complete = false }: { complete?: boolean }) {
  return <div className="generation-skeleton" role="status" aria-label="物語を書き換え中" aria-busy={!complete}>
    {!complete && <span className="spinner" aria-hidden="true" />}<div className="skeleton-paper" aria-hidden="true" />
  </div>;
}
