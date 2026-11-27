import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import type { Session } from './types';
import { LossManuscript, Manuscript } from './Manuscript';
import { storyVersions } from './storyVersions';

// Both diagonal components must cross the threshold; horizontal reading never turns a page.
export function completesPaperTurn(direction: number, x: number, y: number) {
  return direction * x >= 64 && direction * y >= 48;
}

// Blank sheets show the accumulated rounds; only the current sheet contains text.
export function PaperLayers({ count, children }: { count: number; children: ReactNode }) {
  return <div className="paper-stack" data-paper-count={count}>
    {Array.from({ length: Math.max(0, count - 1) }, (_, i) => <div key={i}
      className="paper-underlay" aria-hidden="true" style={{ transform: `translate(${Math.min(i + 1, 6) * 2}px, ${Math.min(i + 1, 6) * 2}px)` }} />)}
    {children}
  </div>;
}

export function StoryPaperStack({ session, result = false, pageIndex, onPageChange, highlight = result }: { session: Session; result?: boolean; pageIndex?: number; onPageChange?: (index: number) => void; highlight?: boolean }) {
  const versions = storyVersions(session);
  const [localIndex, setLocalIndex] = useState(versions.length - 1);
  const index = Math.min(pageIndex ?? localIndex, versions.length - 1);
  function setIndex(next: number) { setLocalIndex(next); onPageChange?.(next); }
  const [drag, setDrag] = useState<{ direction: number; x: number; y: number; phase: 'drag' | 'finish' | 'return' } | null>(null);
  const pointer = useRef<{ id: number; x: number; y: number; direction: number } | null>(null);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => {
    if (!drag || drag.phase === 'drag') return;
    const timer = window.setTimeout(() => {
      if (drag.phase === 'finish') setIndex(index + drag.direction);
      setDrag(null);
    }, reduced ? 150 : 240);
    return () => window.clearTimeout(timer);
  }, [drag, reduced]);
  function start(event: PointerEvent<HTMLDivElement>, direction: number) {
    if (drag || pointer.current || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, direction };
    setDrag({ direction, x: 0, y: 0, phase: 'drag' });
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const origin = pointer.current;
    if (!origin || origin.id !== event.pointerId) return;
    setDrag({ direction: origin.direction, x: event.clientX - origin.x, y: event.clientY - origin.y, phase: 'drag' });
  }
  function end(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    const origin = pointer.current;
    if (!origin || origin.id !== event.pointerId) return;
    const x = event.clientX - origin.x, y = event.clientY - origin.y;
    const complete = !cancelled && completesPaperTurn(origin.direction, x, y);
    pointer.current = null;
    setDrag({ direction: origin.direction, x: complete ? origin.direction * 400 : 0,
      y: complete ? origin.direction * 240 : 0, phase: complete ? 'finish' : 'return' });
  }
  const current = versions[index];
  const latest = index === versions.length - 1;
  const [showHint, setShowHint] = useState(() => {
    if (!result || !latest || index === 0) return false;
    try { return !window.localStorage?.getItem('storyPaperTurnHintSeen'); }
    catch { return true; }
  });
  useEffect(() => {
    if (showHint) {
      try { window.localStorage?.setItem('storyPaperTurnHintSeen', '1'); }
      catch { /* Storage can be unavailable in private browsing. */ }
    }
  }, [showHint]);
  useEffect(() => { if (!latest) setShowHint(false); }, [latest]);
  const transaction = current.transaction;
  const preview = drag ? versions[index + drag.direction] : undefined;
  const movingStyle = drag && !reduced ? {
    transform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x / 18}deg)`,
  } : undefined;
  return <section className="story-paper-stack" aria-label="原稿の束">
    {!result && <div className="paper-navigation">
      <span aria-live="polite">第{current.version}版 / {versions.length}枚</span>
    </div>}
    <PaperLayers count={versions.length}>
      {preview && <div className="paper-preview" aria-hidden="true" inert>
        {!result && <header className="paper-caption">
          <p>{preview.transaction ? `第${preview.round}ラウンド · ${preview.transaction.outcome === 'win' ? '勝利' : '敗北'}` : '最初の物語'}</p>
        </header>}
        <div className="story-board"><Manuscript text={preview.text} /></div>
      </div>}
      <article key={current.version} style={movingStyle}
        className={`manuscript-sheet${highlight && latest ? ' show-changes' : ''}${drag ? ` paper-${drag.phase}` : ''}${reduced && drag?.phase === 'finish' ? ' paper-fade' : ''}`}
        aria-label={`第${current.version}版の原稿`}>
        {[-1, 1].filter(direction => index + direction >= 0 && index + direction < versions.length).map(direction =>
          <div key={direction} className={`paper-corner corner-${direction === -1 ? 'older' : 'newer'}`}
            role="slider" tabIndex={0} aria-label={direction === -1 ? '右下の角を左上へドラッグして前の版へ' : '左上の角を右下へドラッグして次の版へ'}
            aria-valuemin={1} aria-valuemax={versions.length} aria-valuenow={current.version}
            onKeyDown={event => {
              if (!drag && (event.key === 'Enter' || event.key === ' ')) {
                event.preventDefault();
                setDrag({ direction, x: direction * 400, y: direction * 240, phase: 'finish' });
              }
            }}
            onPointerDown={event => start(event, direction)} onPointerMove={move}
            onPointerUp={event => end(event)} onPointerCancel={event => end(event, true)}
            onLostPointerCapture={event => { if (pointer.current) end(event, true); }}>
            <span className="paper-turn-arrow" aria-hidden="true">{direction === -1 ? '↖' : '↘'}</span>
          </div>)}
        {result && transaction && <strong className={`paper-stamp stamp-${transaction.outcome}`}>
          {transaction.outcome === 'win' ? '勝利' : '敗北'}
        </strong>}
        {!result && <header className="paper-caption">
          {Boolean(transaction?.staked_mark_ids?.length) && <small>印付きを賭けた</small>}
          {Boolean(transaction?.guarded_mark_ids?.length) && <small>印付きを守った</small>}
          <p>{transaction ? `第${current.round}ラウンド · ${transaction.outcome === 'win' ? '勝利' : '敗北'}` : '最初の物語'}</p>
        </header>}
        <div className="story-board">
          {result && latest && transaction?.outcome === 'loss'
            ? <LossManuscript transaction={transaction} highlight={highlight} text={current.text} />
            : <Manuscript text={current.text} before={latest ? transaction?.before : undefined} />}
        </div>
        {showHint && latest && <small className="paper-turn-hint">右下をめくると、変更が見れる</small>}
      </article>
    </PaperLayers>
  </section>;
}

export function StoryHistory({ session, pageIndex, onPageChange }: { session: Session; pageIndex?: number; onPageChange?: (index: number) => void }) {
  return <div className="history-body">
    <StoryPaperStack key={`${session.id}-${session.version}`} session={session} pageIndex={pageIndex} onPageChange={onPageChange} />
    <p className="quiet">プレイ {session.transactions.filter(tx => tx.status === 'committed').length}回</p>
  </div>;
}
