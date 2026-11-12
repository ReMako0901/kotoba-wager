import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CardFace } from './BaccaratCard';
import type { CardMove, DiceMove, Gamble, HandMove } from './types';
import './beginner-games.css';

type Props = {
  gamble: Gamble;
  busy: boolean;
  onMove: (attempt: number, choice?: number) => void;
  children: ReactNode;
};

const hands = ['グー', 'パー', 'チョキ'];
const handSymbols = ['✊', '✋', '✌️'];
const diceSymbols = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const startingOrder = [0, 1, 2];

function RockPaperScissors({ gamble, busy, onMove }: Props) {
  const attempts = gamble.moves as HandMove[];
  const latest = attempts.at(-1);
  return <>
    {latest && <div className="rps-result" aria-live="polite">
      <div><span>あなた</span><b aria-hidden="true">{handSymbols[latest.choice]}</b><span>{hands[latest.choice]}</span></div>
      <div><span>相手</span><b aria-hidden="true">{handSymbols[latest.opponent]}</b><span>{hands[latest.opponent]}</span></div>
    </div>}
    {!gamble.outcome && <div className="rps-buttons">
      {hands.map((hand, index) => <button className="secondary" key={hand} type="button"
        disabled={busy} onClick={() => onMove(attempts.length, index)}>
        <span aria-hidden="true">{handSymbols[index]}</span>{hand}
      </button>)}
    </div>}
  </>;
}

function Dice({ gamble, busy, onMove }: Props) {
  const move = gamble.moves?.[0] as DiceMove | undefined;
  return <div className="dice-game">
    {move
      ? <output className="dice-face" aria-label={`${move.face}の目`}>{diceSymbols[move.face - 1]}</output>
      : <><span className="dice-face" aria-hidden="true">⚄</span>
          <p className="reading-hint">4〜6で勝ち。</p>
          <button type="button" className="primary" disabled={busy} onClick={() => onMove(0)}>サイコロを振る</button></>}
  </div>;
}

function CardGuess({ gamble, busy, onMove }: Props) {
  const cards = gamble.cards!;
  const swaps = gamble.swaps!;
  const target = gamble.target!;
  const move = gamble.moves?.[0] as CardMove | undefined;
  const [phase, setPhase] = useState<'show' | 'shuffle' | 'pick'>('show');
  const [order, setOrder] = useState(startingOrder);
  const board = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const animations = useRef<Animation[]>([]);
  const mounted = useRef(true);
  const shuffling = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      animations.current.forEach(animation => animation.cancel());
    };
  }, []);
  useLayoutEffect(() => {
    if (phase === 'pick') {
      animations.current.forEach(animation => animation.cancel());
      animations.current = [];
    }
  }, [phase]);

  async function shuffle() {
    if (shuffling.current || !board.current) return;
    shuffling.current = true;
    setPhase('shuffle');
    const positions = [...startingOrder];
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Wait for React to render the card backs before starting the first swap.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    for (const [left, right] of swaps) {
      if (!mounted.current || !board.current) return;
      if (!reduced) {
        const step = board.current.clientWidth / 3;
        const crossed = [[left, right, -1], [right, left, 1]];
        const active = crossed.map(([from, to, arc]) => {
          const x = from * step;
          const next = to * step;
          return buttons.current[positions[from]]!.animate([
            { transform: `translate(${x}px, 0)` },
            { transform: `translate(${(x + next) / 2}px, ${arc * 17}px)` },
            { transform: `translate(${next}px, 0)` },
          ], { duration: 145, easing: 'ease-in-out', fill: 'forwards' });
        });
        animations.current.push(...active);
        await Promise.all(active.map(animation => animation.finished.catch(() => {})));
      }
      [positions[left], positions[right]] = [positions[right], positions[left]];
    }
    if (mounted.current) {
      setOrder(positions);
      setPhase('pick');
    }
  }

  const finalOrder = move && phase !== 'pick' ? swaps.reduce((positions, [left, right]) => {
    [positions[left], positions[right]] = [positions[right], positions[left]];
    return positions;
  }, [...startingOrder]) : order;

  return <div className="card-guess">
    <p className="reading-hint" aria-live="polite">{move ? (move.outcome === 'win' ? '当たり！' : '表になったカードが当たり。')
      : phase === 'show' ? '表のカードを覚えてね。' : phase === 'shuffle' ? 'シャッフル中…' : '当たりのカードを選ぶ。'}</p>
    <div className="guess-board" ref={board}>
      {finalOrder.map((index, slot) => {
        const card = cards[index];
        const open = (phase === 'show' || !!move) && index === target;
        return <button key={index} ref={element => { buttons.current[index] = element; }}
          className={`guess-card playing-card ${open ? 'face-up' : 'face-down'}${move?.choice === slot ? ' guess-selected' : ''}`}
          type="button" disabled={phase !== 'pick' || busy || !!move}
          aria-label={`${['左', '中央', '右'][slot]}のカード${open ? ` ${card.suit}${card.rank}` : ''}`}
          style={{ transform: `translateX(${slot * 100 / (.29 * 3)}%)` }}
          onClick={() => onMove(0, slot)}>
          {open ? <CardFace card={card} /> : <span aria-hidden="true">◆</span>}
        </button>;
      })}
    </div>
    {phase === 'show' && !move && <button type="button" className="primary" onClick={() => void shuffle()}>シャッフル開始</button>}
  </div>;
}

export function BeginnerPlay(props: Props) {
  const { gamble, children } = props;
  const title = gamble.kind === 'rps' ? 'じゃんけん' : gamble.kind === 'dice' ? '一発サイコロ' : 'カード当て';
  const tied = gamble.moves?.at(-1)?.outcome === 'tie';
  const heading = gamble.outcome ? (gamble.outcome === 'win' ? '勝利' : '敗北')
    : tied ? 'あいこ。もう一回！' : title;
  return <section className="gamble-screen beginner-game" aria-label={`${title}の進行`}>
    <h1 aria-live="polite">{heading}</h1>
    {gamble.kind === 'rps' ? <RockPaperScissors {...props} /> : gamble.kind === 'dice' ? <Dice {...props} /> : <CardGuess {...props} />}
    {children}
  </section>;
}
