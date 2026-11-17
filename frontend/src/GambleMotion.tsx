import { useEffect, useState, type ReactNode } from 'react';
import type { Gamble } from './types';
import { isNearMiss, revealStep } from './gamblePresentation';

// Timers reveal saved facts only; they never call the API or choose an outcome.
export function GambleMotion({ gamble, children }: { gamble: Gamble; children: ReactNode }) {
  const [elapsed, setElapsed] = useState(0);
  const [skip, setSkip] = useState(false);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const step = revealStep(elapsed, skip, reduced);
  useEffect(() => {
    if (step === 3) return;
    const timer = window.setTimeout(() => setElapsed(value => value + 600), 600);
    return () => window.clearTimeout(timer);
  }, [elapsed, step]);
  const near = isNearMiss(gamble);
  return <div className={`gamble-motion motion-${gamble.kind} stage-${step}${near && step === 2 ? ' near-pulse' : ''}`}>
    {step < 3 ? <>
      <p className="reading-hint" role="status">{['勝負の行方を見つめる…', '少しずつ、明らかになる。', near ? 'あと、ひとつ。' : '最後の一拍。'][step]}</p>
      <div className="saved-reveal" aria-hidden="true">{gamble.kind === 'slot'
        ? gamble.reels?.map((symbol, index) => <span key={index} className={index <= step ? 'revealed' : 'unrevealed'}>{index <= step ? symbol : '◆'}</span>)
        : gamble.kind === 'dice' ? <span className="rolling-die">⚄</span>
        : gamble.kind === 'rps' ? <span className="hand-count">{['じゃん', 'けん', 'ぽん'][step]}</span>
        : <><span className="reveal-card">◆</span><span className="reveal-card">◆</span></>}</div>
      <button type="button" className="text-button" onClick={() => setSkip(true)}>演出をスキップ</button>
    </> : <div className="motion-result">{children}</div>}
  </div>;
}

export function GenerationSkeleton() {
  return <div className="generation-skeleton" role="status" aria-label="物語を書き換え中" aria-busy="true">
    <span>物語を書き換えています…</span><div className="skeleton-paper" aria-hidden="true" />
  </div>;
}
