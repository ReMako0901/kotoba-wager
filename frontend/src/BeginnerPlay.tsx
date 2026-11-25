import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CardFace } from './BaccaratCard';
import type { CardMove, DiceMove, Gamble, HandMove } from './types';

type Props = {
  gamble: Gamble;
  busy: boolean;
  onMove: (attempt: number, choice?: number) => void;
  children: ReactNode;
  renderActions?: (children: ReactNode) => ReactNode;
};

const inlineActions = (children: ReactNode) => children;

const hands = ['グー', 'パー', 'チョキ'];
const handSymbols = ['✊', '✋', '✌️'];
const diePips = [[4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
const startingOrder = [0, 1, 2];

function RockPaperScissors({ gamble, busy, onMove, renderActions = inlineActions }: Props) {
  const attempts = gamble.moves as HandMove[];
  const latest = attempts.at(-1);
  return <>
    <div key={attempts.length} className={`rps-result${latest ? ` rps-settled rps-${latest.outcome}` : ' rps-standby'}`} aria-live="polite">
      <div className="rps-side rps-opponent"><span>アノマ</span><b aria-hidden="true">{latest ? handSymbols[latest.opponent] : '？'}</b>{latest && <span>{hands[latest.opponent]}</span>}</div>
      <div className="rps-side rps-player"><span>あなた</span><b aria-hidden="true">{latest ? handSymbols[latest.choice] : '？'}</b>{latest && <span>{hands[latest.choice]}</span>}</div>
    </div>
    {!gamble.outcome && renderActions(<div className="rps-buttons">
      {hands.map((hand, index) => <button className="secondary" key={hand} type="button"
        disabled={busy} onClick={() => onMove(attempts.length, index)}>
        <span aria-hidden="true">{handSymbols[index]}</span>{hand}
      </button>)}
    </div>)}
  </>;
}

function Dice({ gamble, busy, onMove, renderActions = inlineActions }: Props) {
  const move = gamble.moves?.[0] as DiceMove | undefined;
  return <>
    <div className="dice-game">
      <output key={move ? 'rolled' : 'ready'} className={`dice-face dice-${move?.outcome ?? 'standby'}`}
        aria-label={move ? `${move.face}の目` : 'サイコロ'}>
        {diePips[(move?.face ?? 5) - 1].map(pip => <i key={pip} style={{ gridArea: `${Math.floor(pip / 3) + 1} / ${pip % 3 + 1}` }} />)}
      </output>
    </div>
    {!move && renderActions(<button type="button" className="primary" disabled={busy} onClick={() => onMove(0)}>サイコロを振る</button>)}
  </>;
}

function CardGuess({ gamble, busy, onMove, renderActions = inlineActions }: Props) {
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
  const skipShuffle = useRef(false);
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
      if (!mounted.current || !board.current || skipShuffle.current) return;
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
    if (mounted.current && !skipShuffle.current) {
      setOrder(positions);
      setPhase('pick');
    }
  }

  const finalOrder = move && phase !== 'pick' ? swaps.reduce((positions, [left, right]) => {
    [positions[left], positions[right]] = [positions[right], positions[left]];
    return positions;
  }, [...startingOrder]) : order;

  return <div className="card-guess">
    <div className="guess-board" ref={board} data-dealing={phase === 'show'} data-revealing={Boolean(move)}>
      {finalOrder.map((index, slot) => {
        const card = cards[index];
        const open = (phase === 'show' && index === target) || Boolean(move && (index === target || move.choice === slot));
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
    {phase === 'shuffle' && !move && renderActions(<button type="button" className="text-button" onClick={() => {
      skipShuffle.current = true;
      animations.current.forEach(animation => animation.cancel());
      setOrder(swaps.reduce((positions, [left, right]) => {
        [positions[left], positions[right]] = [positions[right], positions[left]]; return positions;
      }, [...startingOrder]));
      setPhase('pick');
    }}>シャッフル演出をスキップ</button>)}
    {phase === 'show' && !move && renderActions(<button type="button" className="primary" onClick={() => void shuffle()}>シャッフル開始</button>)}
  </div>;
}

export function BeginnerPlay(props: Props) {
  const { gamble, children } = props;
  const title = gamble.kind === 'rps' ? 'じゃんけん' : gamble.kind === 'dice' ? '一発サイコロ' : 'カード当て';
  const tied = gamble.moves?.at(-1)?.outcome === 'tie';
  const heading = gamble.outcome ? (gamble.outcome === 'win' ? '勝利' : '敗北')
    : tied ? 'あいこ' : title;
  return <section className="gamble-screen beginner-game" aria-label={`${title}の進行`}>
    <h1 aria-live="polite">{heading}</h1>
    {gamble.kind === 'rps' ? <RockPaperScissors {...props} /> : gamble.kind === 'dice' ? <Dice {...props} /> : <CardGuess {...props} />}
    {children}
  </section>;
}
