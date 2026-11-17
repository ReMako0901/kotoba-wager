import { StagePublisher } from './Anoma';
import { extensionWelcome, normalEnding, expressionForEnding, storyExpressions } from './scenario';
import type { StoryProgress, StoryTotals } from './types';

export function StoryCounts({ totals }: { totals: StoryTotals }) {
  return <dl className="story-counts" aria-label="言葉の集計">
    <div><dt>総勝負回数</dt><dd>{totals.rounds}回</dd></div>
    <div><dt>獲得数</dt><dd>{totals.gained}個</dd></div>
    <div><dt>喪失数</dt><dd>{totals.lost}個</dd></div>
    <div><dt>差分</dt><dd>{totals.difference > 0 ? '+' : ''}{totals.difference}個</dd></div>
  </dl>;
}
export function StoryDecision({ progress, busy, onChoice }: {
  progress: StoryProgress; busy: boolean; onChoice: (choice: 'escape' | 'continue') => void;
}) {
  const reached = progress.phase === 'escapable';
  const welcome = progress.phase === 'extension' && progress.totals.rounds === progress.extension_start;
  const lines = welcome ? extensionWelcome : normalEnding(progress.totals.difference);
  const expression = reached ? storyExpressions.escapable : welcome ? storyExpressions.extensionWelcome : expressionForEnding(progress.totals.difference);
  return <section className="story-decision" aria-label="脱出と継続">
    <StoryCounts totals={progress.totals} />
    <StagePublisher lines={lines} expression={expression} />
    <button className="secondary" disabled={busy} onClick={() => onChoice('escape')}>脱出する</button>
    {reached && <button className="primary" disabled={busy} onClick={() => onChoice('continue')}>さらに賭ける</button>}
  </section>;
}
export function NormalEnding({ progress, onTitle }: { progress: StoryProgress; onTitle: () => void }) {
  return <main className="ending-screen">
    <h1>ノーマルエンディング</h1>
    <StoryCounts totals={progress.totals} />
    <StagePublisher lines={normalEnding(progress.totals.difference)} expression={expressionForEnding(progress.totals.difference)} />
    <button className="primary" onClick={onTitle}>タイトルへ戻る</button>
  </main>;
}
