import { useState } from 'react';
import { AnomaPortrait } from './Anoma';
import { normalEnding, expressionForEnding } from './scenario';
import type { StoryProgress, StoryTotals } from './types';

export function StoryCounts({ totals }: { totals: StoryTotals }) {
  return <dl className="story-counts" aria-label="言葉の集計">
    <div><dt>総勝負回数</dt><dd>{totals.rounds}回</dd></div>
    <div><dt>獲得数</dt><dd>{totals.gained}個</dd></div>
    <div><dt>喪失数</dt><dd>{totals.lost}個</dd></div>
    <div><dt>差分</dt><dd>{totals.difference > 0 ? '+' : ''}{totals.difference}個</dd></div>
  </dl>;
}
export function NormalEnding({ progress, shorter, onTitle }: {
  progress: StoryProgress; shorter: boolean; onTitle: () => void;
}) {
  const [index, setIndex] = useState(0);
  const difference = progress.totals.difference;
  const tone = shorter && difference > 0 ? 0 : difference;
  const lines = normalEnding(tone);
  const last = index === lines.length;
  return <main className="opening-screen ending-closeup">
    <aside className="opening-portrait" aria-label="アノマ">
      <AnomaPortrait expression={expressionForEnding(tone, JSON.stringify(progress.totals))} speaking={false} />
    </aside>
    <div className="opening-dialogue" aria-live="polite">
      {index === 0 ? <StoryCounts totals={progress.totals} /> : <p>{lines[index - 1]}</p>}
      <small>{last ? 'タイトルへ戻る' : '次へ'} ▼</small>
    </div>
    <button className="opening-advance" autoFocus aria-label={last ? 'タイトルへ戻る' : '次へ'}
      onClick={() => last ? onTitle() : setIndex(index + 1)} />
  </main>;
}
