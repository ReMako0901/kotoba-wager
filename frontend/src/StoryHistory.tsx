import { useMemo } from 'react';
import type { Session } from './types';
import { changedCharacters, storyVersions } from './storyVersions';

export function StoryComparison({ before, after, beforeLabel = '変化前', afterLabel = '変化後' }: {
  before: string; after: string; beforeLabel?: string; afterLabel?: string;
}) {
  const changes = useMemo(() => changedCharacters(before, after), [before, after]);
  return <section className="story-comparison" aria-label={`${beforeLabel}と${afterLabel}の比較`}>
    <p className="comparison-legend">削除・変更前は取消線、追加・変更後は太字と下線</p>
    <div className="comparison-pair">{([
      { label: beforeLabel, text: before, indices: changes.before, side: 'before' },
      { label: afterLabel, text: after, indices: changes.after, side: 'after' },
    ]).map(({ label, text, indices, side }) => <section className="comparison-panel" key={side} aria-label={label}>
      <h3>{label}</h3><p className="comparison-text" tabIndex={0}>{Array.from(text).map((glyph, index) => indices.has(index)
        ? <mark className={`diff-${side}`} key={index}>{glyph}</mark> : glyph)}</p>
    </section>)}</div>
  </section>;
}

export function StoryHistory({ session }: { session: Session }) {
  const versions = storyVersions(session);
  const first = versions[0], latest = versions[versions.length - 1];
  return <div className="history-body">
    <details className="history-comparison"><summary>最初と最新を比べる（第{first.version}版 → 第{latest.version}版）</summary>
      <StoryComparison before={first.text} after={latest.text} beforeLabel={`最初・第${first.version}版`} afterLabel={`最新・第${latest.version}版`} />
    </details>
    <ol className="version-list" aria-label="版の一覧">{versions.map(version => <li key={version.version}>
      <details><summary>{version.transaction
        ? `第${version.round}ラウンド · ${version.transaction.outcome === 'win' ? '勝利' : '敗北'} · 第${version.version}版`
        : `最初の物語 · 第${version.version}版`}</summary>
        {version.transaction && <p className="version-metadata">賭けた言葉：{version.transaction.stakes.join(' / ')}<br />報酬：{version.transaction.offer.title}</p>}
        <p className="version-text" tabIndex={0}>{version.text}</p>
      </details>
      {version.transaction && <p className="version-caption">{version.transaction.stakes.join(' / ')} · 報酬：{version.transaction.offer.title}</p>}
    </li>)}</ol>
    {session.transactions.some(tx => tx.status !== 'committed') && <p className="quiet">反映待ちの取引は、本文の確定後に版の一覧へ追加されます。</p>}
    <h3>失われた設定</h3><p>{session.lost_concepts.map(c => c.label).join('・') || 'まだなし'}</p>
    <p className="quiet">生成 {session.api_calls}回 / {session.model}<br />入力 {session.usage.input}・出力 {session.usage.output} tokens</p>
  </div>;
}
