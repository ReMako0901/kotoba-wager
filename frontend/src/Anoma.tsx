import { useEffect, useState } from 'react';
import type { Transaction } from './types';
import { chooseLine, openingNarration, reactionKinds, reactionTrigger, scenario, expressionForTrigger, storyExpressions, type AnomaExpression, type ReactionKind } from './scenario';
import './anoma.css';

// Presentation memory only: no session storage or game state changes.
let previousExpression: AnomaExpression | undefined;
function AnomaPortrait({ expression }: { expression: AnomaExpression }) {
  const [previous, setPrevious] = useState(() => previousExpression);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loaded && !failed) previousExpression = expression;
  }, [expression, loaded, failed]);
  if (failed) return null;
  const source = (id: AnomaExpression) => `${import.meta.env.BASE_URL}anoma/${id}.webp`;
  return <div className="anoma-portrait">
    {previous && previous !== expression && <img className="anoma-portrait-previous" src={source(previous)} alt="" onError={() => setFailed(true)} />}
    <img key={expression} className={`anoma-portrait-current${loaded ? ' anoma-portrait-fade' : ''}`}
      src={source(expression)} alt="" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
      onAnimationEnd={() => setPrevious(undefined)} />
  </div>;
}

export function AnomaFrame({ line, reaction = 'normal', expression = 'normal' }: { line: string; reaction?: ReactionKind; expression?: AnomaExpression }) {
  return <aside className="anoma-frame" aria-label="アノマの台詞" data-reaction={reaction}>
    <AnomaPortrait key={expression} expression={expression} />
    <div><span className="anoma-name">アノマ</span><p>{line}</p></div>
  </aside>;
}

export function Opening({ busy, onComplete }: { busy: boolean; onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const last = index === scenario.opening.length - 1;
  return <main className="opening-screen">
    <div className="opening-narration">{openingNarration.map(line => <p key={line}>{line}</p>)}</div>
    <AnomaFrame line={scenario.opening[index]} expression={storyExpressions.opening} />
    <button className="primary" disabled={busy} onClick={() => last ? onComplete() : setIndex(index + 1)}>{last ? '物語を選ぶ' : '次へ'}</button>
    <button className="secondary" disabled={busy} onClick={onComplete}>スキップ</button>
  </main>;
}

export function AnomaResult({ transactions }: { transactions: Transaction[] }) {
  // Reconstruct once from confirmed rounds, so rerenders and retries cannot select another line.
  const [reaction] = useState(() => {
    let previous: string | undefined;
    let result: { line: string; reaction: ReactionKind; expression: AnomaExpression } | undefined;
    const committed = transactions.filter(tx => tx.status === 'committed');
    for (let i = 0; i < committed.length; i++) {
      const trigger = reactionTrigger(committed.slice(0, i + 1));
      if (!trigger) continue;
      const seed = Array.from(committed[i].id).reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0);
      previous = chooseLine(scenario[trigger], previous, () => seed / 4294967296);
      result = { line: previous, reaction: reactionKinds[trigger], expression: expressionForTrigger[trigger] };
    }
    return result;
  });
  return reaction ? <AnomaFrame {...reaction} /> : null;
}
