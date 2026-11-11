import { useState } from 'react';
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
  const slot = gamble.kind === 'slot';
  const blackjack = gamble.kind === 'blackjack';
  const round = gamble.rounds[roundIndex];
  const cardCount = round ? round.player.length + round.banker.length : 0;
  const complete = slot ? stopped.every(Boolean) : revealed >= cardCount;
  const tied = !slot && complete && round.outcome === 'tie';
  const won = !tied && gamble.outcome === 'win';
  const name = slot ? 'スロット' : blackjack ? 'ブラックジャック' : 'バカラ';

  function hand(cards: PlayingCard[], side: 0 | 1, label: string) {
    const revealAt = (index: number) => index < 2 ? 2 * index + side : index + 2 + (side === 0 ? 0 : round.player.length - 2);
    const visible = cards.filter((_, index) => revealed > revealAt(index));
    return <section className="card-hand" aria-label={label}>
      <div className="hand-heading"><span>{label}</span><b>{visible.length ? total(visible, blackjack) : '—'}</b></div>
      <div className="playing-cards">{cards.map((card, index) => <div key={index}
        className={`playing-card ${revealed > revealAt(index) ? 'face-up' : 'face-down'}`}
        aria-label={revealed > revealAt(index) ? `${card.suit}${card.rank}` : '裏向きのカード'}>
        {revealed > revealAt(index) ? <><b>{card.rank}</b><span>{card.suit}</span></> : <span>◆</span>}
      </div>)}</div>
    </section>;
  }

  return <section className="gamble-screen" aria-label={`${name}の進行`}>
    <p className="eyebrow">{name}</p>
    <h1>{complete ? tied ? 'TIE' : won ? 'WIN!' : 'LOSE…' : slot ? 'リールを止めよう' : 'カードをめくろう'}</h1>
    {slot ? <div className="slot-machine"><div className="slot-reels">{gamble.reels!.map((symbol, i) =>
      <div className={`slot-reel ${stopped[i] ? '' : 'rolling'}`} key={i} aria-label={stopped[i] ? symbol : '回転中'}>
        {stopped[i] ? symbol : '✦'}
      </div>)}</div><div className="slot-stops">{stopped.map((stop, i) =>
        <button key={i} disabled={stop || busy} onClick={() => setStopped(current => current.map((s, j) => j === i || s))}>STOP {i + 1}</button>)}</div></div>
      : <div className="card-table">{hand(round.banker, 1, blackjack ? 'ディーラー' : 'バンカー')}{hand(round.player, 0, 'あなた / プレイヤー')}
        {complete && <p className="hand-comparison">{round.player_total} 対 {round.banker_total}{!blackjack && ` · ${round.difference}点差`}</p>}
      </div>}
    {complete && !tied && <div className="gamble-outcome"><b>{gamble.label} · 変化の強さ {gamble.strength}</b><p>{won ? '物語が明るい方向へ動く。' : '賭けた意味を失い、物語が悪い方向へ動く。'}</p></div>}
    <div className="gamble-actions">
      {!slot && !complete && <button className="primary" disabled={busy} onClick={() => setRevealed(revealed + 1)}>次のカードをめくる <span>↗</span></button>}
      {tied && <button className="primary" disabled={busy} onClick={() => {setRoundIndex(roundIndex + 1); setRevealed(0);}}>同じことばでもう一度 <span>→</span></button>}
      {complete && !tied && <button className="primary" disabled={busy} onClick={onFinish}>{busy ? '物語を準備中…' : 'この結果を物語へ'} <span>→</span></button>}
      <p className="quiet" role="status">{error ? '文章を表示できませんでした。' : prepared ? '物語の準備ができた。' : busy ? '物語の準備が終わるまで、そのまま待ってね。' : '物語も準備中…'}</p>
    </div>
  </section>;
}
