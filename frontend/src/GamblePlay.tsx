import { useState } from 'react';
import { BaccaratCard, CardFace } from './BaccaratCard';
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
  const slot = gamble.kind === 'slot';
  const blackjack = gamble.kind === 'blackjack';
  const baccarat = gamble.kind === 'baccarat';
  const round = gamble.rounds[roundIndex];
  const cardCount = round ? round.player.length + round.banker.length : 0;
  const complete = slot ? stopped.every(Boolean) : baccarat ? opened.length === cardCount : revealed >= cardCount;
  const tied = !slot && complete && round.outcome === 'tie';
  const won = !tied && gamble.outcome === 'win';
  const name = slot ? 'スロット' : blackjack ? 'ブラックジャック' : 'バカラ';

  const revealAt = (index: number, side: 0 | 1) => index < 2 ? 2 * index + side : index + 2 + (side === 0 ? 0 : round.player.length - 2);

  function openCards(ids: number[]) {
    setOpened(current => [...new Set([...current, ...ids])]);
  }

  function hand(cards: PlayingCard[], side: 0 | 1, label: string) {
    const isVisible = (index: number) => baccarat ? opened.includes(revealAt(index, side)) : revealed > revealAt(index, side);
    const visible = cards.filter((_, index) => isVisible(index));
    return <section className="card-hand" aria-label={label}>
      <div className="hand-heading"><span>{label}</span><b>{visible.length ? total(visible, blackjack) : '—'}</b></div>
      <div className="playing-cards">{cards.map((card, index) => {
        const id = revealAt(index, side);
        const cardLabel = `${label}の${index + 1}枚目`;
        if (baccarat) {
          const open = isVisible(index);
          return <button key={id} type="button" className={`playing-card ${open ? 'face-up' : 'face-down'}`}
            aria-label={open ? `${cardLabel} ${card.suit}${card.rank}` : cardLabel}
            aria-pressed={selectedCard?.id === id} disabled={busy || complete}
            onClick={() => setSelectedCard({id, card, label: cardLabel})}>
            <CardFace card={card} />
            {!open && <span>◆</span>}
          </button>;
        }
        return <div key={id} className={`playing-card ${isVisible(index) ? 'face-up' : 'face-down'}`}
          aria-label={isVisible(index) ? `${cardLabel} ${card.suit}${card.rank}` : '裏向きのカード'}>
          {isVisible(index) ? <><b>{card.rank}</b><span>{card.suit}</span></> : <span>◆</span>}
        </div>;
      })}</div>
      {baccarat && side === 1 && <button className="banker-open" type="button"
          disabled={busy || visible.length === cards.length}
          onClick={() => openCards(cards.map((_, index) => revealAt(index, 1)))}>バンカーオープン</button>}
    </section>;
  }

  return <section className={`gamble-screen${baccarat ? ' baccarat-screen' : ''}`} aria-label={`${name}の進行`}>
    {!baccarat && <p className="eyebrow">{name}</p>}
    {(complete || !baccarat) && <h1>{complete ? tied ? '引き分け' : won ? '勝利' : '敗北' : slot ? 'リールを止める' : 'カードをめくる'}</h1>}
    {slot ? <div className="slot-machine"><div className="slot-reels">{gamble.reels!.map((symbol, i) =>
      <div className={`slot-reel ${stopped[i] ? '' : 'rolling'}`} key={i} aria-label={stopped[i] ? symbol : '回転中'}>
        {stopped[i] ? symbol : '✦'}
      </div>)}</div><div className="slot-stops">{stopped.map((stop, i) =>
        <button key={i} disabled={stop || busy} onClick={() => setStopped(current => current.map((s, j) => j === i || s))}>STOP {i + 1}</button>)}</div></div>
      : <div className="card-table">{hand(round.banker, 1, blackjack ? 'ディーラー' : 'バンカー')}{hand(round.player, 0, 'あなた / プレイヤー')}
        {complete && <p className="hand-comparison">{round.player_total} 対 {round.banker_total}{!blackjack && ` · ${round.difference}点差`}</p>}
      </div>}
    {baccarat && selectedCard && !complete && <BaccaratCard key={selectedCard.id}
      card={selectedCard.card} label={selectedCard.label} open={opened.includes(selectedCard.id)}
      onOpen={() => openCards([selectedCard.id])} />}
    {complete && !tied && <div className="gamble-outcome"><b>{gamble.label} · 変化の強さ {gamble.strength}</b><p>{won ? '物語が明るい方向へ動く。' : '賭けた意味を失い、物語が悪い方向へ動く。'}</p></div>}
    <div className="gamble-actions">
      {blackjack && !complete && <button className="primary" disabled={busy} onClick={() => setRevealed(revealed + 1)}>次のカードをめくる <span>↗</span></button>}
      {baccarat && !complete && !selectedCard && <p className="reading-hint">裏向きのカードを選ぶ。</p>}
      {tied && <button className="primary" disabled={busy} onClick={() => {setRoundIndex(roundIndex + 1); setRevealed(0); setOpened([]); setSelectedCard(undefined);}}>同じことばでもう一度 <span>→</span></button>}
      {complete && !tied && <button className="primary" disabled={busy} onClick={onFinish}>{busy ? '物語を準備中…' : 'この結果を物語へ'} <span>→</span></button>}
      <p className="quiet" role="status">{error ? '文章を表示できませんでした。' : prepared ? '物語の準備ができた。' : busy ? '物語の準備が終わるまで、そのまま待ってね。' : '物語も準備中…'}</p>
    </div>
  </section>;
}
