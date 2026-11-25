import { useState, type ReactNode } from 'react';
import { BaccaratCard, CardFace } from './BaccaratCard';
import { GambleMotion, GenerationSkeleton } from './GambleMotion';
import { BeginnerPlay } from './BeginnerPlay';
import { isNearMiss } from './gamblePresentation';
import type { CardRound, Gamble, PlayingCard } from './types';

function total(cards: PlayingCard[], blackjack: boolean) {
  const values = cards.map(card => card.rank === 'A' ? 1 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank));
  const sum = values.reduce((a, b) => a + b, 0);
  if (!blackjack) return sum % 10;
  return cards.some(card => card.rank === 'A') && sum + 10 <= 21 ? sum + 10 : sum;
}

type SelectCard = (index: number, card: PlayingCard, label: string) => void;

function CardHand({ cards, label, isOpen, blackjack, selected, onSelect, onOpenAll, side }: {
  cards: PlayingCard[]; label: string; isOpen: (index: number) => boolean;
  side: 'banker' | 'player'; blackjack?: boolean; selected?: number; onSelect?: SelectCard; onOpenAll?: () => void;
}) {
  const visible = cards.filter((_, index) => isOpen(index));
  return <section className="card-hand" data-side={side} aria-label={label}>
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
  renderActions?: (children: ReactNode) => ReactNode;
  gamble: Gamble; busy: boolean; error?: string; prepared: boolean; onFinish: () => void; onMove: (attempt: number, choice?: number) => void;
};

const inlineActions = (children: ReactNode) => <div className="gamble-actions">{children}</div>;

function Finish({ busy, error, prepared, onFinish, renderActions }: PlayProps) {
  return <>
    {!error && <GenerationSkeleton complete={prepared} />}
    {(renderActions ?? inlineActions)(<button className={`primary${!prepared && !error ? ' loading-bet' : ''}`} aria-busy={!prepared && !error} disabled={busy || (!prepared && !error)} onClick={onFinish}>
        {!prepared && !error && <span className="spinner" aria-hidden="true" />}
        この結果を物語へ <span>→</span>
      </button>)}
  </>;
}


function SlotPlay(props: PlayProps) {
  const [spinning, setSpinning] = useState(false);
  const [stopped, setStopped] = useState([false, false, false]);
  const complete = stopped.every(Boolean);
  const won = props.gamble.outcome === 'win';
  return <section className={`gamble-screen${complete ? ' motion-result' : isNearMiss(props.gamble) && stopped.filter(Boolean).length === 2 ? ' near-pulse' : ''}`} aria-label="スロットの進行">
    {complete && <h1>{won ? '勝利' : '敗北'}</h1>}
    <div className="slot-machine">
      <div className="slot-marquee">スロット</div>
      <div className="slot-reels">{props.gamble.reels!.map((symbol, i) => {
        return <div className={`slot-reel${spinning && !stopped[i] ? ' rolling' : ''}`} key={i}
          aria-label={stopped[i] ? symbol : undefined}>
          {stopped[i] ? symbol : <div className="reel-strip" aria-hidden="true"><span>ベル</span><span>REG</span><span>スイカ</span><span>ベル</span></div>}
        </div>;
      })}</div>
      <div className="slot-stops">{stopped.map((stop, i) =>
        <button key={i} disabled={!spinning || stop || props.busy}
          onClick={() => setStopped(current => current.map((value, index) => value || index === i))}>STOP {i + 1}</button>)}</div>
      {!complete && <button className="slot-lever" type="button" aria-label="字輪を回す"
        disabled={spinning || props.busy} onClick={() => setSpinning(true)}>字輪を回す</button>}
    </div>
    {complete ? <Finish {...props} /> : (props.renderActions ?? inlineActions)(<button className="text-button" onClick={() => setStopped([true, true, true])}>演出をスキップ</button>)}
  </section>;
}

function BlackjackPlay(props: PlayProps) {
  const round = props.gamble.rounds[0];
  const [skipped, setSkipped] = useState(false);
  const [hits, setHits] = useState(0);
  const [stood, setStood] = useState(false);
  const player = round.player.slice(0, hits + 2);
  const dealer = skipped ? round.banker : round.dealer_hands?.[hits] ?? round.banker;
  const playerTotal = total(player, true);
  const canHit = hits + 2 < round.player.length && playerTotal < 21;
  const canStand = Boolean(round.dealer_hands) || !canHit;
  const ended = stood || (hits > 0 && playerTotal >= 21);
  const complete = skipped || ended;
  const won = props.gamble.outcome === 'win';

  return <section className={`gamble-screen blackjack-screen${complete ? ' motion-result' : ''}`} aria-label="ブラックジャックの進行">
    <p className="eyebrow">ブラックジャック</p>
    {complete && <h1>{won ? '勝利' : '敗北'}</h1>}
    <div className="dealt-hands">
      <CardHand side="banker" cards={ended || skipped ? dealer : dealer.slice(0, 2)} label="アノマ" isOpen={index => index === 0 || ended} blackjack />
      <CardHand side="player" cards={player} label="あなた / プレイヤー" isOpen={() => true} blackjack />
    </div>
    {complete ? <Finish {...props} /> : (props.renderActions ?? inlineActions)(<>
      <button className="text-button" onClick={() => { setHits(round.player.length - 2); setStood(true); setSkipped(true); }}>演出をスキップ</button>
      <div className="blackjack-actions">
        {canHit && <button className="primary" onClick={() => setHits(count => count + 1)}>HIT<span>＋</span></button>}
        {canStand && <button className={canHit ? 'secondary' : 'primary'} onClick={() => setStood(true)}>
          {canHit ? 'STAND' : '結果を見る'}
        </button>}
      </div>
    </>)}
  </section>;
}

type Side = 'banker' | 'player';
type Selection = { side: Side; index: number; card: PlayingCard; label: string };

function BaccaratRound({ round, nextRound, onSkip, ...props }: PlayProps & { round: CardRound; nextRound: () => void; onSkip: () => void }) {
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
    return <CardHand side={side} cards={cards} label={label} isOpen={index => opened[side].includes(index)}
      selected={selected?.side === side ? selected.index : undefined}
      onSelect={(index, card, cardLabel) => setSelected({ side, index, card, label: cardLabel })}
      onOpenAll={side === 'banker' ? () => reveal(side, cards.map((_, index) => index)) : undefined} />;
  }

  return <section className={`gamble-screen baccarat-screen${complete ? ' baccarat-complete motion-result' : isNearMiss(props.gamble) && round.outcome === 'loss' && playerDone ? ' near-pulse' : ''}`} aria-label="バカラの進行">
    {complete && <h1>{tied ? '引き分け' : props.gamble.outcome === 'win' ? '勝利' : '敗北'}</h1>}
    <div className="baccarat-deal">
      <div className="dealt-hands">
        {hand(bankerCards, 'banker', 'バンカー')}{hand(playerCards, 'player', 'あなた / プレイヤー')}
      </div>
      {selected && !complete && <BaccaratCard key={`${selected.side}-${selected.index}`}
        card={selected.card} label={selected.label} open={opened[selected.side].includes(selected.index)}
        onOpen={() => reveal(selected.side, [selected.index])} />}
    </div>
    {complete && !tied && <Finish {...props} />}
    {(!complete || tied) && (props.renderActions ?? inlineActions)(<>
      <button className="text-button" onClick={onSkip}>演出をスキップ</button>
      {tied && <button className="primary" disabled={props.busy} onClick={nextRound}>同じことばでもう一度 <span>→</span></button>}
    </>)}
  </section>;
}

function BaccaratPlay(props: PlayProps) {
  const [roundIndex, setRoundIndex] = useState(0);
  const [skipped, setSkipped] = useState(false);
  if (skipped) return <section className="gamble-screen motion-result"><h1>{props.gamble.outcome === 'win' ? '勝利' : '敗北'}</h1>
    <div className="dealt-hands"><CardHand side="banker" cards={props.gamble.rounds.at(-1)!.banker} label="バンカー" isOpen={() => true} />
    <CardHand side="player" cards={props.gamble.rounds.at(-1)!.player} label="あなた / プレイヤー" isOpen={() => true} /></div><Finish {...props} /></section>;
  return <BaccaratRound key={roundIndex} {...props} round={props.gamble.rounds[roundIndex]}
    nextRound={() => setRoundIndex(index => index + 1)} onSkip={() => setSkipped(true)} />;
}

function GameContent(props: PlayProps) {
  if (props.gamble.kind === 'slot') return <SlotPlay {...props} />;
  if (props.gamble.kind === 'blackjack') return <BlackjackPlay {...props} />;
  if (props.gamble.moves) return <BeginnerPlay gamble={props.gamble} busy={props.busy} onMove={props.onMove} renderActions={props.renderActions}>
    {props.gamble.outcome && <Finish {...props} />}
  </BeginnerPlay>;
  return <BaccaratPlay {...props} />;
}

export function GamblePlay(props: PlayProps) {
  // Beginner games still require a real move. Never submit a choice while skipping.
  return <>
    {props.error && <p className="api-error" role="alert">{props.error}</p>}
    {!props.gamble.moves || !props.gamble.outcome ? <GameContent {...props} />
      : <GambleMotion gamble={props.gamble}><GameContent {...props} /></GambleMotion>}
  </>;
}
