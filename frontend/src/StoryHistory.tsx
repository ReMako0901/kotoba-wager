import { useState, type ReactNode } from 'react';
import type { Session } from './types';
import type { DustProps } from './PaperDust';
import { LossManuscript, Manuscript } from './Manuscript';
import { storyVersions } from './storyVersions';

// Blank sheets show the accumulated rounds; only the current sheet contains text.
export function PaperLayers({ count, children }: { count: number; children: ReactNode }) {
  return <div className="paper-stack" data-paper-count={count}>
    {Array.from({ length: Math.max(0, count - 1) }, (_, i) => <div key={i}
      className="paper-underlay" aria-hidden="true" style={{ transform: `translate(${Math.min(i + 1, 6) * 2}px, ${Math.min(i + 1, 6) * 2}px)` }} />)}
    {children}
  </div>;
}

export function StoryPaperStack({ session, dust, losses, result = false }: { session: Session; result?: boolean } & DustProps) {
  const versions = storyVersions(session);
  const [index, setIndex] = useState(versions.length - 1);
  const [turn, setTurn] = useState('arrive');
  const current = versions[index];
  const latest = index === versions.length - 1;
  const transaction = current.transaction;
  const pageLosses = losses.filter(loss => versions.slice(0, index + 1).some(v => v.transaction?.id === loss.id));
  function flip(next: number) {
    setTurn(next < index ? 'back' : 'forward');
    setIndex(next);
  }
  return <section className="story-paper-stack" aria-label="原稿の束">
    <nav className="paper-navigation" aria-label="原稿をめくる">
      <button type="button" disabled={index === 0} onClick={() => flip(index - 1)}>前の原稿へ</button>
      <span aria-live="polite">第{current.version}版 / {versions.length}枚</span>
      <button type="button" disabled={latest} onClick={() => flip(index + 1)}>次の原稿へ</button>
    </nav>
    <PaperLayers count={versions.length}>
      <article key={current.version} className={`manuscript-sheet page-${turn}`} aria-label={`第${current.version}版の原稿`}>
        <header className={`paper-caption${result && latest ? ' paper-result' : ''}`}>
          <p>{transaction ? `第${current.round}ラウンド · ${transaction.outcome === 'win' ? '勝利' : '敗北'}` : '最初の物語'}</p>
          {transaction && <p className="version-metadata">賭けた言葉：{transaction.stakes.join(' / ')}<br />報酬：{transaction.offer.title}</p>}
        </header>
        <div className="story-board">
          {result && latest && transaction?.outcome === 'loss'
            ? <LossManuscript transaction={transaction} text={current.text} dust={dust} losses={pageLosses} />
            : <Manuscript text={current.text} before={latest ? transaction?.before : undefined} dust={dust} losses={pageLosses} />}
        </div>
      </article>
    </PaperLayers>
  </section>;
}

export function StoryHistory({ session }: { session: Session }) {
  const [dust] = useState(() => ({ grains: new Map() }));
  return <div className="history-body">
    <StoryPaperStack key={`${session.id}-${session.version}`} session={session} dust={dust}
      losses={session.transactions.filter(tx => tx.status === 'committed' && tx.outcome === 'loss')} />
    {session.transactions.some(tx => tx.status !== 'committed') && <p className="quiet">反映待ちの取引は、本文の確定後に原稿の束へ追加されます。</p>}
    <h3>失われた設定</h3><p>{session.lost_concepts.map(c => c.label).join('・') || 'まだなし'}</p>
    <p className="quiet">生成 {session.api_calls}回 / {session.model}<br />入力 {session.usage.input}・出力 {session.usage.output} tokens</p>
  </div>;
}
