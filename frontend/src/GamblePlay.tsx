import { useRef, useState } from 'react';
import type { Gamble, PlayingCard } from './types';

function total(cards: PlayingCard[], blackjack: boolean) {
  const values = cards.map(card => card.rank === 'A' ? 1 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank));
  const sum = values.reduce((a, b) => a + b, 0);
  if (!blackjack) return sum % 10;
  return cards.some(card => card.rank === 'A') && sum + 10 <= 21 ? sum + 10 : sum;
}

export function GamblePlay({ gamble, busy, error, prepared, onFinish }: {
  gamble: Gamble; busy: boolean; error?: string; prepared: boolean; onFinish: () => void;
}) {
  const [stopped, setStopped] = useState([false, false, false]);
  const [roundIndex, setRoundIndex] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [opened, setOpened] = useState<number[]>([]);
  const [selectedCard, setSelectedCard] = useState<{id: number; card: PlayingCard; label: string}>();
  const [peel, setPeel] = useState(0);
  const dragStart = useRef<{x: number; peel: number} | undefined>(undefined);
  const slot = gamble.kind === 'slot';
  const blackjack = gamble.kind === 'blackjack';
  const baccarat = gamble.kind === 'baccarat';
  const round = gamble.rounds[roundIndex];
  const cardCount = round ? round.player.length + round.banker.length : 0;
  const complete = slot ? stopped.every(Boolean) : baccarat ? opened.length === cardCount : revealed >= cardCount;
  const tied = !slot && complete && round.outcome === 'tie';
  const won = !tied && gamble.outcome === 'win';
  const name = slot ? 'スロット' : blackjack ? 'ブラックジャック' : 'バカラ';

  function hand(cards: PlayingCard[], side: 0 | 1, label: string) {
    const revealAt = (index: number) => index < 2 ? 2 * index + side : index + 2 + (side === 0 ? 0 : round.player.length - 2);
    const isVisible = (index: number) => baccarat ? opened.includes(revealAt(index)) : revealed > revealAt(index);
    const visible = cards.filter((_, index) => isVisible(index));
    return <section className="card-hand" aria-label={label}>
      <div className="hand-heading"><span>{label}</span><b>{visible.length ? total(visible, blackjack) : '—'}</b></div>
      <div className="playing-cards">{cards.map((card, index) => {
        const id = revealAt(index);
        const cardLabel = `${label}の${index + 1}枚目`;
        if (baccarat && !isVisible(index)) {
          return <button key={id} type="button" className="playing-card face-down"
            aria-label={cardLabel} aria-pressed={selectedCard?.id === id} disabled={busy}
            onClick={() => {setSelectedCard({id, card, label: cardLabel}); setPeel(0);}}><span>◆</span></button>;
        }
        return <div key={id} className={`playing-card ${isVisible(index) ? 'face-up' : 'face-down'}`}
          aria-label={isVisible(index) ? `${cardLabel} ${card.suit}${card.rank}` : '裏向きのカード'}>
          {isVisible(index) ? <><b>{card.rank}</b><span>{card.suit}</span></> : <span>◆</span>}
        </div>;
      })}</div>
    </section>;
  }

  return <section className="gamble-screen" aria-label={`${name}の進行`}>
    <p className="eyebrow">{name}</p>
    <h1>{complete ? tied ? '引き分け' : won ? '勝利' : '敗北' : slot ? 'リールを止める' : baccarat ? '好きなカードから' : 'カードをめくる'}</h1>
    {slot ? <div className="slot-machine"><div className="slot-reels">{gamble.reels!.map((symbol, i) =>
      <div className={`slot-reel ${stopped[i] ? '' : 'rolling'}`} key={i} aria-label={stopped[i] ? symbol : '回転中'}>
        {stopped[i] ? symbol : '✦'}
      </div>)}</div><div className="slot-stops">{stopped.map((stop, i) =>
        <button key={i} disabled={stop || busy} onClick={() => setStopped(current => current.map((s, j) => j === i || s))}>STOP {i + 1}</button>)}</div></div>
      : <div className="card-table">{hand(round.banker, 1, blackjack ? 'ディーラー' : 'バンカー')}{hand(round.player, 0, 'あなた / プレイヤー')}
        {complete && <p className="hand-comparison">{round.player_total} 対 {round.banker_total}{!blackjack && ` · ${round.difference}点差`}</p>}
      </div>}
    {baccarat && selectedCard && <section className="squeeze-panel" aria-label="カードを絞る">
      <div className="squeeze-card" aria-hidden="true"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStart.current = {x: event.clientX, peel};
        }}
        onPointerMove={event => {
          const start = dragStart.current;
          if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const displacement = (event.clientX - start.x) / event.currentTarget.clientWidth;
          setPeel(Math.min(100, Math.max(0, Math.round(start.peel + displacement * 100))));
        }}
        onLostPointerCapture={() => {dragStart.current = undefined;}}>
        <span className="squeeze-pip">{selectedCard.card.suit}</span>
        <span className="squeeze-rank">{selectedCard.card.rank}<small>{selectedCard.card.suit}</small></span>
        <div className="squeeze-back" style={{clipPath: `inset(0 0 0 ${peel}%)`}} />
      </div>
      <div className="squeeze-control">
        <label htmlFor="peel-card">{selectedCard.label}を絞る</label>
        <input id="peel-card" type="range" min="0" max="100" value={peel} onChange={event => setPeel(Number(event.target.value))} />
        <button className="secondary" type="button" onClick={() => {
          setOpened(cards => [...cards, selectedCard.id]); setSelectedCard(undefined); setPeel(0);
        }}>表にする</button>
      </div>
    </section>}
    {complete && !tied && <div className="gamble-outcome"><b>{gamble.label} · 変化の強さ {gamble.strength}</b><p>{won ? '物語が明るい方向へ動く。' : '賭けた意味を失い、物語が悪い方向へ動く。'}</p></div>}
    <div className="gamble-actions">
      {blackjack && !complete && <button className="primary" disabled={busy} onClick={() => setRevealed(revealed + 1)}>次のカードをめくる <span>↗</span></button>}
      {baccarat && !complete && !selectedCard && <p className="reading-hint">裏向きのカードを選ぶ。</p>}
      {tied && <button className="primary" disabled={busy} onClick={() => {setRoundIndex(roundIndex + 1); setRevealed(0); setOpened([]);}}>同じことばでもう一度 <span>→</span></button>}
      {complete && !tied && <button className="primary" disabled={busy} onClick={onFinish}>{busy ? '物語を準備中…' : 'この結果を物語へ'} <span>→</span></button>}
      <p className="quiet" role="status">{error ? '文章を表示できませんでした。' : prepared ? '物語の準備ができた。' : busy ? '物語の準備が終わるまで、そのまま待ってね。' : '物語も準備中…'}</p>
    </div>
  </section>;
}
