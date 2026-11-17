import { useEffect, useState, type ReactNode } from 'react';
import type { Gamble } from './types';
import { isNearMiss } from './gamblePresentation';

// The player has already submitted a move. CSS decorates its result without advancing play.
export function GambleMotion({ gamble, children }: { gamble: Gamble; children: ReactNode }) {
  return <div className={`gamble-motion motion-${gamble.kind}${isNearMiss(gamble) ? ' near-pulse' : ''}`}>
    <div className="motion-result">{children}</div>
  </div>;
}

export function GenerationSkeleton({ complete = false }: { complete?: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (complete) return;
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [complete]);
  return <div className="generation-skeleton" role="status" aria-label="物語を書き換え中" aria-busy={!complete}>
    <span>{complete ? '準備完了。結果を物語へ反映できます。' : `物語を準備しています… ${seconds}秒経過`}</span><div className="skeleton-paper" aria-hidden="true" />
  </div>;
}
