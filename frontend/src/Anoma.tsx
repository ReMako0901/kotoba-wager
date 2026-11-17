import { useState, type ReactNode } from 'react';
import type { Transaction } from './types';
import { chooseLine, openingNarration, reactionKinds, reactionTrigger, scenario, type ReactionKind } from './scenario';
import './anoma.css';

export function AnomaFrame({ line, reaction = 'normal', portrait }: { line: string; reaction?: ReactionKind; portrait?: ReactNode }) {
  return <aside className="anoma-frame" aria-label="アノマの台詞" data-reaction={reaction}>
    {portrait && <div className="anoma-portrait">{portrait}</div>}
    <div><span className="anoma-name">アノマ</span><p>{line}</p></div>
  </aside>;
}

export function Opening({ busy, onComplete }: { busy: boolean; onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const last = index === scenario.opening.length - 1;
  return <main className="opening-screen">
    <div className="opening-narration">{openingNarration.map(line => <p key={line}>{line}</p>)}</div>
    <AnomaFrame line={scenario.opening[index]} />
    <button className="primary" disabled={busy} onClick={() => last ? onComplete() : setIndex(index + 1)}>{last ? '物語を選ぶ' : '次へ'}</button>
    <button className="secondary" disabled={busy} onClick={onComplete}>スキップ</button>
  </main>;
}

export function AnomaResult({ transactions }: { transactions: Transaction[] }) {
  // Reconstruct once from confirmed rounds, so rerenders and retries cannot select another line.
  const [reaction] = useState(() => {
    let previous: string | undefined;
    let result: { line: string; reaction: ReactionKind } | undefined;
    const committed = transactions.filter(tx => tx.status === 'committed');
    for (let i = 0; i < committed.length; i++) {
      const trigger = reactionTrigger(committed.slice(0, i + 1));
      if (!trigger) continue;
      const seed = Array.from(committed[i].id).reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0);
      previous = chooseLine(scenario[trigger], previous, () => seed / 4294967296);
      result = { line: previous, reaction: reactionKinds[trigger] };
    }
    return result;
  });
  return reaction ? <AnomaFrame {...reaction} /> : null;
}
