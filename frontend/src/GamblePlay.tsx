import { useEffect, useState } from 'react';
import { BaccaratCard, CardFace } from './BaccaratCard';
import type { CardRound, Gamble, PlayingCard } from './types';

function total(cards: PlayingCard[], blackjack: boolean) {
  const values = cards.map(card => card.rank === 'A' ? 1 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank));
  const sum = values.reduce((a, b) => a + b, 0);
  if (!blackjack) return sum % 10;
  return cards.some(card => card.rank === 'A') && sum + 10 <= 21 ? sum + 10 : sum;
}

type SelectCard = (index: number, card: PlayingCard, label: string) => void;

function CardHand({ cards, label, isOpen, blackjack, selected, onSelect, onOpenAll }: {
  cards: PlayingCard[]; label: string; isOpen: (index: number) => boolean;
  blackjack?: boolean; selected?: number; onSelect?: SelectCard; onOpenAll?: () => void;
}) {
  const visible = cards.filter((_, index) => isOpen(index));
  return <section className="card-hand" aria-label={label}>
    <div className="hand-heading"><span>{label}</span><b>{visible.length ? total(visible, !!blackjack) : '—'}</b></div>
    <div className="playing-cards">{cards.map((card, index) => {
      const open = isOpen(index);
      const cardLabel = `${label}の${index + 1}枚目`;
      const name = open ? `${cardLabel} ${card.suit}${card.rank}` : cardLabel;
      const classes = `playing-card ${open ? 'face-up' : 'face-down'}`;
      const face = <><CardFace card={card} />{!open && <span>◆</span>}</>;
      return onSelect
        ? <button key={index} type="button" className={classes} aria-label={name}
            aria-pressed={selected === index} onClick={() => onSelect(index, card, cardLabel)}>{face}</button>
        : <div key={index} className={classes} role="img" aria-label={name}>{face}</div>;
    })}</div>
    {onOpenAll && <button className="banker-open" type="button" disabled={visible.length === cards.length}
      onClick={onOpenAll}>バンカーオープン</button>}
  </section>;
}

type PlayProps = {
  gamble: Gamble; busy: boolean; error?: string; prepared: boolean; onFinish: () => void;
};

function Status({ error, prepared }: Pick<PlayProps, 'error' | 'prepared'>) {
  return <p className="quiet" role="status">{error ? '文章を表示できませんでした。'
    : prepared ? '物語の準備ができた。' : '物語も準備中…'}</p>;
}

function Finish({ gamble, busy, error, prepared, onFinish }: PlayProps) {
  return <>
    {gamble.kind === 'slot' && <div className="gamble-outcome"><b>{gamble.label} · 変化の強さ {gamble.strength}</b></div>}
    <div className="gamble-actions">
      <button className="primary" disabled={busy || (!prepared && !error)} onClick={onFinish}>
        {prepared || error ? 'この結果を物語へ' : '物語を準備中…'} <span>→</span>
      </button>
      <Status error={error} prepared={prepared} />
    </div>
  </>;
}

function SlotPlay(props: PlayProps) {
  const [stopped, setStopped] = useState([false, false, false]);
  const complete = stopped.every(Boolean);
  const won = props.gamble.outcome === 'win';
  return <section className="gamble-screen" aria-label="スロットの進行">
    <p className="eyebrow">スロット</p>
    <h1>{complete ? won ? '勝利' : '敗北' : 'リールを止める'}</h1>
    <div className="slot-machine">
      <div className="slot-reels">{props.gamble.reels!.map((symbol, i) => {
        const display = symbol === 'BIG' ? '7' : symbol;
        return <div className={`slot-reel ${stopped[i] ? '' : 'rolling'}`} key={i}
          aria-label={stopped[i] ? display : '回転中'}>{stopped[i] ? display : '✦'}</div>;
      })}</div>
      <div className="slot-stops">{stopped.map((stop, i) =>
        <button key={i} disabled={stop || props.busy}
          onClick={() => setStopped(current => current.map((value, index) => value || index === i))}>STOP {i + 1}</button>)}</div>
    </div>
    {complete ? <Finish {...props} /> : <div className="gamble-actions"><Status {...props} /></div>}
  </section>;
}

function BlackjackPlay(props: PlayProps) {
  const round = props.gamble.rounds[0];
  const [hits, setHits] = useState(0);
  const [stood, setStood] = useState(false);
  const [dealerCount, setDealerCount] = useState(2);
  const player = round.player.slice(0, hits + 2);
  const dealer = round.dealer_hands?.[hits] ?? round.banker;
  const playerTotal = total(player, true);
  const canHit = hits + 2 < round.player.length && playerTotal < 21;
  const canStand = Boolean(round.dealer_hands) || !canHit;
  const ended = stood || (hits > 0 && playerTotal >= 21);
  const complete = ended && dealerCount >= dealer.length;
  const won = props.gamble.outcome === 'win';

  useEffect(() => {
    if (!ended || complete) return;
    const timer = window.setTimeout(() => setDealerCount(count => count + 1), 450);
    return () => window.clearTimeout(timer);
  }, [ended, complete, dealerCount]);

  return <section className="gamble-screen blackjack-screen" aria-label="ブラックジャックの進行">
    <p className="eyebrow">ブラックジャック</p>
    {complete && <h1>{won ? '勝利' : '敗北'}</h1>}
    <div className="card-table">
      <CardHand cards={dealer.slice(0, dealerCount)} label="ディーラー" isOpen={index => index === 0 || ended} blackjack />
      <CardHand cards={player} label="あなた / プレイヤー" isOpen={() => true} blackjack />
    </div>
    {complete ? <Finish {...props} /> : <div className="gamble-actions">
      {!ended && <div className="blackjack-actions">
        {canHit && <button className="primary" onClick={() => setHits(count => count + 1)}>HIT<span>＋</span></button>}
        {canStand && <button className={canHit ? 'secondary' : 'primary'} onClick={() => setStood(true)}>
          {canHit ? 'STAND' : '結果を見る'}
        </button>}
      </div>}
      <Status {...props} />
    </div>}
  </section>;
}

type Side = 'banker' | 'player';
type Selection = { side: Side; index: number; card: PlayingCard; label: string };

function BaccaratRound({ round, nextRound, ...props }: PlayProps & { round: CardRound; nextRound: () => void }) {
  const [opened, setOpened] = useState<Record<Side, number[]>>({ banker: [], player: [] });
  const [selected, setSelected] = useState<Selection>();
  const firstTwoOpen = (side: Side) => opened[side].includes(0) && opened[side].includes(1);
  const playerCards = round.player.slice(0, firstTwoOpen('player') ? round.player.length : 2);
  const playerDone = opened.player.length === round.player.length;
  const bankerCards = round.banker.slice(0, firstTwoOpen('banker') && playerDone ? round.banker.length : 2);
  const complete = playerDone && opened.banker.length === round.banker.length;
  const tied = complete && round.outcome === 'tie';

  function reveal(side: Side, indices: number[]) {
    setOpened(current => ({ ...current, [side]: [...new Set([...current[side], ...indices])] }));
  }

  function hand(cards: PlayingCard[], side: Side, label: string) {
    return <CardHand cards={cards} label={label} isOpen={index => opened[side].includes(index)}
      selected={selected?.side === side ? selected.index : undefined}
      onSelect={(index, card, cardLabel) => setSelected({ side, index, card, label: cardLabel })}
      onOpenAll={side === 'banker' ? () => reveal(side, cards.map((_, index) => index)) : undefined} />;
  }

  return <section className={`gamble-screen baccarat-screen${complete ? ' baccarat-complete' : ''}`} aria-label="バカラの進行">
    {complete && <h1>{tied ? '引き分け' : round.outcome === 'win' ? '勝利' : '敗北'}</h1>}
    <div className="card-table">
      {hand(bankerCards, 'banker', 'バンカー')}{hand(playerCards, 'player', 'あなた / プレイヤー')}
      {complete && <p className="hand-comparison">{round.player_total} 対 {round.banker_total}</p>}
    </div>
    {selected && <BaccaratCard key={`${selected.side}-${selected.index}`}
      card={selected.card} label={selected.label} open={opened[selected.side].includes(selected.index)}
      onOpen={() => reveal(selected.side, [selected.index])} />}
    {complete && !tied ? <Finish {...props} /> : <div className="gamble-actions">
      {tied && <button className="primary" disabled={props.busy} onClick={nextRound}>同じことばでもう一度 <span>→</span></button>}
      {!complete && !selected && <p className="reading-hint">裏向きのカードを選ぶ。</p>}
      <Status {...props} />
    </div>}
  </section>;
}

function BaccaratPlay(props: PlayProps) {
  const [roundIndex, setRoundIndex] = useState(0);
  return <BaccaratRound key={roundIndex} {...props} round={props.gamble.rounds[roundIndex]}
    nextRound={() => setRoundIndex(index => index + 1)} />;
}

export function GamblePlay(props: PlayProps) {
  if (props.gamble.kind === 'slot') return <SlotPlay {...props} />;
  if (props.gamble.kind === 'blackjack') return <BlackjackPlay {...props} />;
  return <BaccaratPlay {...props} />;
}
