import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  CardMove,
  CardRound,
  ChinchiroMove,
  GameKind,
  HandMove,
  PlayingCard,
} from '../types';
import type { FreshGambleProps } from './contract';
import {
  FolioCardView,
  BaccaratFace,
  calcBaccaratTotal,
  calcBlackjackTotal,
  cardLabel,
  isRedSuit,
  slotAssetUrl,
} from './cards';
import './games.css';

const KIND_NAMES: Record<GameKind, string> = {
  rps: 'じゃんけん',
  chinchiro: 'チンチロ',
  card_guess: 'カード当て',
  slot: 'スロット',
  blackjack: 'ブラックジャック',
  baccarat: 'バカラ',
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

type Outcome = 'win' | 'loss' | 'tie';

const OUTCOME_LABELS: Record<Outcome, string> = {
  win: '勝利',
  loss: '敗北',
  tie: '引き分け',
};

function OutcomeBanner({
  outcome,
  label,
  transient = false,
  bannerKey,
}: {
  outcome: Outcome;
  label?: string;
  transient?: boolean;
  bannerKey?: string | number;
}) {
  return (
    <div
      key={bannerKey}
      className={`folio-outcome-banner is-${outcome}${
        transient ? ' is-transient' : ''
      }`}
      aria-live="polite"
    >
      <span>{label ?? OUTCOME_LABELS[outcome]}</span>
    </div>
  );
}

interface OutcomeSlipProps {
  outcome: Outcome;
  prepared: boolean;
  busy: boolean;
  error?: string;
  onFinish: () => void;
  onNextRound?: () => void;
}

function OutcomeSlip({
  outcome,
  prepared,
  busy,
  error,
  onFinish,
  onNextRound,
}: OutcomeSlipProps) {
  const heading = OUTCOME_LABELS[outcome];
  const banner = <OutcomeBanner outcome={outcome} label={heading} />;

  if (outcome === 'tie' && onNextRound) {
    return (
      <>
        {banner}
        <footer className="folio-outcome-slip is-tie" aria-live="polite">
          <div className="folio-slip-body">
            <button
              type="button"
              className="folio-story-turn"
              onClick={onNextRound}
            >
              同じことばでもう一度
            </button>
          </div>
        </footer>
      </>
    );
  }

  const canPress = !busy && (prepared || Boolean(error));

  return (
    <>
      {banner}
      {error && <p className="folio-slip-error" role="alert">{error}</p>}
      <button type="button" className="folio-story-turn primary" disabled={!canPress}
        aria-busy={!prepared && !error} onClick={onFinish}>この結果を物語へ →</button>
    </>
  );
}

/* ============================================================================
 * 1. じゃんけん (RPS) — 手帳ページの「三すくみ円環図と三枚の活版札」
 * ========================================================================== */

const RPS_HANDS: {
  id: number;
  name: string;
  motif: string;
  angle: string;
}[] = [
  { id: 0, name: 'グー', motif: '石', angle: '-7deg' },
  { id: 1, name: 'パー', motif: '紙', angle: '1deg' },
  { id: 2, name: 'チョキ', motif: '鋏', angle: '8deg' },
];

function HandGlyph({ hand }: { hand: number }) {
  if (hand === 0) {
    // 石・握り拳のペン画モチーフ
    return (
      <svg viewBox="0 0 48 48" className="folio-rps-glyph" aria-hidden="true">
        <path
          d="M14 22c0-5 4-9 10-9h6c5 0 8 4 8 9v8c0 5-4 9-10 9h-5c-5 0-9-4-9-9v-8z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
        />
        <path
          d="M18 13v8M24 13v8M30 13v8M14 23h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (hand === 1) {
    // 紙・開いた掌のペン画モチーフ
    return (
      <svg viewBox="0 0 48 48" className="folio-rps-glyph" aria-hidden="true">
        <path
          d="M15 26V13a2 2 0 0 1 4 0v10M19 23V10a2 2 0 0 1 4 0v13M23 23V11a2 2 0 0 1 4 0v12M27 24V14a2 2 0 0 1 4 0v14c0 6-4 11-9 11h-2c-5 0-9-4-9-10v-5a2 2 0 0 1 4 0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  // 鋏・チョキのペン画モチーフ
  return (
    <svg viewBox="0 0 48 48" className="folio-rps-glyph" aria-hidden="true">
      <path
        d="M19 25L15 10a2.2 2.2 0 0 1 4.2-1l4.3 14M25 23l4.5-14a2.2 2.2 0 0 1 4.2 1L29 25"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M16 25h15c2 0 4 2 4 5v3c0 4-3 7-8 7h-6c-4 0-7-3-7-7v-3c0-3 1-5 2-5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function handName(hand: number): string {
  return RPS_HANDS.find((h) => h.id === hand)?.name ?? '';
}

function RpsGamble({
  gamble,
  busy,
  error,
  prepared,
  onMove,
  onFinish,
}: FreshGambleProps) {
  const moves = (gamble.moves ?? []) as HandMove[];
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [playerShown, setPlayerShown] = useState(0);
  const [beat, setBeat] = useState<number | null>(null);
  useEffect(() => {
    if (beat === null) return;
    const timer = window.setTimeout(() => setBeat(beat < 2 ? beat + 1 : null),
      prefersReducedMotion() ? 140 : 690);
    return () => window.clearTimeout(timer);
  }, [beat]);
  const pending = moves.length === selectedAttempt;
  const lastMove = beat === null && !pending && gamble.outcome ? moves.at(-1) : undefined;
  const revealAttempt = lastMove ? moves.length : 0;
  useEffect(() => {
    if (!revealAttempt) return;
    const playerTimer = window.setTimeout(() => setPlayerShown(revealAttempt), 420);
    const timer = window.setTimeout(() => setRevealed(revealAttempt), 850);
    return () => { window.clearTimeout(playerTimer); window.clearTimeout(timer); };
  }, [revealAttempt]);
  const showing = beat !== null || busy || Boolean(lastMove);
  const finished = beat === null && revealed === moves.length && (gamble.outcome === 'win' || gamble.outcome === 'loss');

  return (
    <div className="folio-rps">
      <div className="rps-showdown" aria-live="polite">
        {beat !== null ? <strong key={beat} className={`rps-call beat-${beat}`}>
          {['じゃん', 'けん', 'ぽん'][beat]}
        </strong> : lastMove ? <div className="rps-reveal" key={moves.length}>
          <span>アノマの札<HandGlyph hand={lastMove.opponent} />{handName(lastMove.opponent)}</span>
          {playerShown === moves.length && <span>あなたの札<HandGlyph hand={lastMove.choice} />{handName(lastMove.choice)}</span>}
        </div> : <span>{busy ? '札を開いています…' : '出す手を選ぶ'}</span>}
      </div>

      {!showing && <div className="folio-rps-ring" role="group" aria-label="出す手を選ぶ">
        <svg
          className="folio-rps-diagram"
          viewBox="0 0 260 110"
          aria-hidden="true"
        >
          <path
            d="M 45 86 Q 130 12 215 86"
            fill="none"
            stroke="currentColor"
            strokeDasharray="4 4"
            strokeWidth="1.2"
          />
          <path
            d="M 62 92 L 198 92"
            fill="none"
            stroke="currentColor"
            strokeDasharray="3 4"
            strokeWidth="1"
          />
        </svg>

        <div className="folio-rps-fan">
          {RPS_HANDS.map((item) => (
              <button
                key={item.id}
                type="button"
                className="folio-rps-slip"
                style={{ '--slip-angle': item.angle } as React.CSSProperties}
                disabled={busy || finished || showing}
                aria-label={`${item.name}を出す`}
                onClick={() => { setSelectedAttempt(moves.length); setBeat(0); onMove(moves.length, item.id); }}
              >
                <span className="folio-slip-pin" aria-hidden="true" />
                <span className="folio-slip-motif">{item.motif}</span>
                <HandGlyph hand={item.id} />
                <strong className="folio-slip-name">{item.name}</strong>
              </button>
          ))}
        </div>
      </div>}

      {finished && gamble.outcome && (
        <OutcomeSlip
          outcome={gamble.outcome}
          prepared={prepared}
          busy={busy}
          error={error}
          onFinish={onFinish}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * 2. チンチロ
 * ========================================================================== */

// 3×3 グリッド (位置 0..8) における標準サイコロの目配置
const DICE_PIPS: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// Each face is rotated out from the top plane. Its inverse is the exact
// resting rotation that brings that face back to the top.
const FACE_AXES = ['X', 'Y', 'X', 'X', 'Y', 'X'] as const;
const FACE_ANGLES = [0, 90, 90, -90, -90, 180];

function ChinchiroDie({ value }: { value: number }) {
  const rest = `rotate${FACE_AXES[value - 1]}(${-FACE_ANGLES[value - 1]}deg)`;
  return <div className="chin-view" role="img" aria-label={`サイコロの目 ${value}`}>
    <div className="chin-spin"><div className="chin-cube" style={{ transform: rest }}>
      {FACE_ANGLES.map((angle, i) => <div className="chin-face" key={i} aria-hidden="true"
        style={{ transform: `rotate${FACE_AXES[i]}(${angle}deg) translateZ(var(--chin-half))` }}>
        {Array.from({ length: 9 }, (_, cell) => <i key={cell} className={DICE_PIPS[i + 1].includes(cell) ? 'pip' : ''} />)}
      </div>)}
    </div></div>
  </div>;
}

function chinchiroHandName(hand: ChinchiroMove) {
  return { pinzoro: 'ピンゾロ', zorome: 'ゾロ目', shigoro: 'シゴロ', normal: `${hand.point}の目`,
    hifumi: 'ヒフミ', menashi: '目なし' }[hand.yaku];
}

function ChinchiroGamble({ gamble, busy, error, prepared, onMove, onFinish }: FreshGambleProps) {
  const moves = (gamble.moves ?? []) as ChinchiroMove[];
  const [shown, setShown] = useState(() => Math.max(0, moves.length - 1));
  const [rollIndex, setRollIndex] = useState(0);
  const [announcing, setAnnouncing] = useState(false);
  useEffect(() => {
    if (!announcing) return;
    const timer = window.setTimeout(() => {
      setAnnouncing(false);
      setRollIndex(0);
      setShown(index => index + 1);
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [announcing]);
  const current = moves[shown];
  const previous = moves[shown - 1];
  const hand = current ?? previous;
  const rolls = hand?.side === 'anoma' ? hand.rolls : hand ? [hand.roll] : [];
  const player = previous?.side === 'player' && current?.side !== 'anoma' ? previous : undefined;
  const tie = player?.result === 'tie';
  const waitingForAnoma = !current && !gamble.outcome && (!moves.length || tie);
  const anomaTurn = waitingForAnoma || current?.side === 'anoma';
  const [announcedTurn, setAnnouncedTurn] = useState(-1);
  useEffect(() => {
    if (!anomaTurn) return;
    const timer = window.setTimeout(() => setAnnouncedTurn(shown), 1000);
    return () => window.clearTimeout(timer);
  }, [anomaTurn, shown]);
  const showTurn = anomaTurn && announcedTurn !== shown;
  const [readyTurn, setReadyTurn] = useState(-1);
  useEffect(() => {
    if (!anomaTurn || showTurn) return;
    const timer = window.setTimeout(() => setReadyTurn(shown), 32);
    return () => window.clearTimeout(timer);
  }, [anomaTurn, showTurn, shown]);
  const waitingToRoll = anomaTurn && readyTurn !== shown;
  const faces = waitingToRoll ? (previous?.side === 'player' ? previous.roll : [1, 2, 3])
    : rolls[current ? rollIndex : rolls.length - 1] ?? [1, 2, 3];
  const sentAttempt = useRef<number | null>(null);
  const attempt = moves.length;
  const moveRef = useRef(onMove);
  useLayoutEffect(() => { moveRef.current = onMove; }, [onMove]);
  useLayoutEffect(() => {
    if (!waitingForAnoma || busy || sentAttempt.current === attempt) return;
    const timer = window.setTimeout(() => {
      sentAttempt.current = attempt;
      moveRef.current(attempt);
    }, 975);
    return () => window.clearTimeout(timer);
  }, [waitingForAnoma, busy, attempt]);
  function finishRoll() {
    if (!current || announcing) return;
    if (rollIndex + 1 < rolls.length) setRollIndex(rollIndex + 1);
    else setAnnouncing(true);
  }

  return <div className="chin-board">
    {announcing && current && <div className="folio-hand-call" role="status">{chinchiroHandName(current)}</div>}
    {tie && !current && (
      <OutcomeBanner
        outcome="tie"
        label="同点"
        transient
        bannerKey={`tie-${shown}`}
      />
    )}
    <div className="chin-table">
      {showTurn && <strong className="chin-turn" role="status">アノマのターンです</strong>}
      <div className="chin-bowl">
        <div key={`${shown}-${rollIndex}`} className={`chin-roll${current && !announcing && !waitingToRoll ? ' rolling' : ''}`}
          onAnimationEnd={event => {
            if (event.target === event.currentTarget ||
                (event.target === event.currentTarget.firstElementChild && event.animationName === 'chin-bounce')) finishRoll();
          }}>
          {faces.map((value, i) => <ChinchiroDie key={i} value={value} />)}
        </div>
      </div>

    </div>
    {!current && gamble.outcome ? <OutcomeSlip outcome={gamble.outcome} {...{ prepared, busy, error, onFinish }} /> :
      <div className="chin-actions">
        {tie && !current && <strong className="chin-slip">同点</strong>}
        {!anomaTurn && <button type="button" className="folio-story-turn" disabled={busy || Boolean(current)}
          onClick={() => onMove(moves.length)}>
          {current ? '転がり中…' : player ? 'もう一度振る' : '丼を振る'}
        </button>}
      </div>}
  </div>;
}

/* ============================================================================
 * 3. カード当て (Card Guess) — 「三本の真鍮ピンと入れ替わる三枚の札」
 * ========================================================================== */

const POS_LABELS = ['左の札', '中央の札', '右の札'];

function CardGuessGamble({
  gamble,
  busy,
  error,
  prepared,
  onMove,
  onFinish,
}: FreshGambleProps) {
  const cards: PlayingCard[] = useMemo(
    () =>
      gamble.cards && gamble.cards.length === 3
        ? gamble.cards
        : [
            { rank: 'A', suit: '♠' },
            { rank: 'K', suit: '♥' },
            { rank: 'Q', suit: '♣' },
          ],
    [gamble.cards]
  );
  const target = gamble.target ?? 0;
  const swaps = useMemo(() => gamble.swaps ?? [], [gamble.swaps]);
  const moves = (gamble.moves ?? []) as CardMove[];
  const resultMove = moves[0];

  // slots[pos] = その位置(0:左, 1:中, 2:右)に現在置かれている元のカード番号(0..2)
  const finalSlots = useMemo(() => {
    const arr = [0, 1, 2];
    for (const [a, b] of swaps) {
      if (a >= 0 && a < 3 && b >= 0 && b < 3) {
        const tmp = arr[a];
        arr[a] = arr[b];
        arr[b] = tmp;
      }
    }
    return arr;
  }, [swaps]);

  const [phase, setPhase] = useState<'reveal' | 'shuffling' | 'choose' | 'done'>(
    resultMove || gamble.outcome ? 'done' : 'reveal'
  );
  const [slots, setSlots] = useState<number[]>(() =>
    resultMove || gamble.outcome ? finalSlots : [0, 1, 2]
  );
  const [activeSwapStep, setActiveSwapStep] = useState<number>(0);

  useEffect(() => {
    if ((resultMove || gamble.outcome) && phase !== 'shuffling') {
      setPhase('done');
    }
  }, [resultMove, gamble.outcome, phase]);

  const swapInterval = (idx: number) => 365 - 42 * idx / Math.max(1, swaps.length - 1);

  // シャッフル演出の再生
  const startShuffle = () => {
    if (phase !== 'reveal') return;
    setPhase('shuffling');
    setActiveSwapStep(0);

    const reduced = prefersReducedMotion();
    const flipDelay = reduced ? 120 : 676;
    let nextSwap = flipDelay;

    const current = [0, 1, 2];
    const timers: number[] = [];

    if (swaps.length === 0) {
      const t = window.setTimeout(() => {
        setPhase('choose');
      }, flipDelay);
      timers.push(t);
      return;
    }

    swaps.forEach(([a, b], idx) => {
      const t = window.setTimeout(() => {
        if (a >= 0 && a < 3 && b >= 0 && b < 3) {
          const tmp = current[a];
          current[a] = current[b];
          current[b] = tmp;
          setSlots([...current]);
          setActiveSwapStep(idx + 1);
        }
      }, nextSwap);
      // At the climax the next pair starts while the first is still moving.
      const overlap = swaps.length >= 14 && (idx === 9 || idx === 12);
      nextSwap += reduced ? 110 : swapInterval(idx) * (overlap ? .4 : 1);
      timers.push(t);
    });

    const endTimer = window.setTimeout(() => {
      setPhase('choose');
    }, nextSwap + (reduced ? 90 : 0));
    timers.push(endTimer);
  };

  // cardIndex (0..2) ごとに現在どの位置 (0:左, 1:中, 2:右) にいるかを逆引き
  const cardPositions = useMemo(() => {
    const posOfCard = [0, 1, 2];
    slots.forEach((cardIdx, pos) => {
      posOfCard[cardIdx] = pos;
    });
    return posOfCard;
  }, [slots]);

  const targetCard = cards[target];
  const finalOutcome = gamble.outcome ?? resultMove?.outcome ?? null;

  return (
    <div className="folio-guess">
      <div className="folio-guess-margin">
        <div className="folio-target-memo">
          <span className="folio-note-caption">追う札</span>
          {targetCard && (
            <strong
              className={isRedSuit(targetCard.suit) ? 'is-red-ink' : ''}
            >
              {cardLabel(targetCard)}
            </strong>
          )}
        </div>
      </div>

      <div className="folio-guess-stage">
        <div className="folio-guess-pins" aria-hidden="true">
          {POS_LABELS.map((label, pos) => (
            <span key={pos} className="folio-pin-label">
              {label}
            </span>
          ))}
        </div>

        <div className="folio-guess-track">
          {cards.map((card, cardIdx) => {
            const pos = cardPositions[cardIdx] ?? cardIdx;
            const isTarget = cardIdx === target;
            const isChosenPos =
              phase === 'done' && resultMove?.choice === pos;
            const isAnswerPos =
              phase === 'done' &&
              (isTarget || resultMove?.answer === pos);

            const faceUp =
              (phase === 'reveal' && isTarget) ||
              (phase === 'done' && (isTarget || isChosenPos || isAnswerPos));

            const canSelect = phase === 'choose' && !busy;

            const badge =
              phase === 'reveal' && isTarget
                ? '当たり'
                : phase === 'done' && isChosenPos && (isTarget || isAnswerPos)
                  ? '的中'
                  : phase === 'done' && isChosenPos
                    ? '選択'
                    : phase === 'done' && (isTarget || isAnswerPos)
                      ? '当たり'
                      : undefined;

            return (
              <button
                key={cardIdx}
                type="button"
                className={`folio-guess-card-slot pos-${pos}${
                  canSelect ? ' is-selectable' : ''
                }${isChosenPos ? ' is-chosen' : ''}`}
                style={{ '--slot-pos': pos, '--swap-time': `${swapInterval(Math.max(0, activeSwapStep - 1)) * .88}ms` } as React.CSSProperties}
                disabled={!canSelect}
                aria-label={`${POS_LABELS[pos]}を選ぶ`}
                onClick={() => {
                  if (canSelect) {
                    onMove(0, pos);
                  }
                }}
              >
                <FolioCardView
                  card={card}
                  faceUp={faceUp}
                  badge={badge}
                  highlighted={
                    (phase === 'reveal' && isTarget) ||
                    (phase === 'done' && (isTarget || isChosenPos))
                  }
                />
              </button>
            );
          })}
        </div>

        {phase === 'reveal' && (
          <button
            type="button"
            className="folio-wax-ribbon"
            onClick={startShuffle}
          >
            <span className="folio-ribbon-seal" aria-hidden="true">
              封
            </span>
            <span>札を伏せて混ぜる</span>
          </button>
        )}
      </div>

      {phase === 'done' && finalOutcome && (
        <OutcomeSlip
          outcome={finalOutcome}
          prepared={prepared}
          busy={busy}
          error={error}
          onFinish={onFinish}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * 4. スロット (Slot) — 「手帳に仕込まれた真鍮三連覗き窓と右脇の引き手」
 * ========================================================================== */

const SLOT_CYCLE = ['ベル', 'スイカ', 'REG', 'BIG'];

function SlotGamble({
  gamble,
  busy,
  error,
  prepared,
  onFinish,
}: FreshGambleProps) {
  const targetReels = useMemo(
    () =>
      gamble.reels && gamble.reels.length === 3
        ? gamble.reels
        : ['ベル', 'スイカ', 'REG'],
    [gamble.reels]
  );

  const [started, setStarted] = useState(false);
  type ReelState = 'ready' | 'braking' | 'landed';
  const [reels, setReels] = useState<ReelState[]>(['ready', 'ready', 'ready']);
  const strips = useRef<(HTMLDivElement | null)[]>([]);
  const [pulling, setPulling] = useState(false);
  const leverStartY = useRef<number | null>(null);
  const allStopped = reels.every(state => state === 'landed');

  useEffect(() => {
    if (!pulling) return;
    const timer = window.setTimeout(() => {
      setStarted(true);
      setPulling(false);
    }, prefersReducedMotion() ? 60 : 286);
    return () => window.clearTimeout(timer);
  }, [pulling]);

  function changeReel(index: number, state: ReelState) {
    setReels(previous => previous.map((value, i) => i === index ? state : value));
  }

  function stopReel(index: number) {
    const strip = strips.current[index];
    if (!strip || !started || reels[index] !== 'ready') return;
    const reduced = prefersReducedMotion();
    const cell = strip.firstElementChild!.getBoundingClientRect().height;
    const transform = getComputedStyle(strip).transform;
    const y = transform === 'none' ? 0 : new DOMMatrix(transform).m42;
    const target = SLOT_CYCLE.indexOf(targetReels[index]);
    // Choose the matching symbol at least one full turn farther down the strip.
    const cycle = SLOT_CYCLE.length * cell;
    const end = Math.ceil((y + cycle + target * cell) / cycle) * cycle - target * cell;
    const finalPosition = `translateY(${-target * cell}px)`;
    const frames = reduced ? [
      { opacity: .3, transform: finalPosition },
      { opacity: 1, transform: finalPosition },
    ] : [
      { transform: `translateY(${y}px)`, filter: 'blur(1px)' },
      { transform: `translateY(${end}px)`, filter: 'blur(0)' },
    ];
    changeReel(index, 'braking');
    const brake = strip.animate(frames, {
      duration: reduced ? 90 : 1170, easing: 'cubic-bezier(.15,.65,.35,1)', fill: 'forwards',
    });
    brake.onfinish = () => changeReel(index, 'landed');
  }

  return (
    <div className="folio-slot">
      <div className="folio-slot-mechanica">
        <div className="folio-slot-windows" role="group" aria-label="スロットリール">
          {reels.map((state, idx) => {
            const symbol = started ? targetReels[idx] : SLOT_CYCLE[idx];
            return (
              <div key={idx} className="folio-reel-column">
                <span className="folio-reel-index" aria-hidden="true">{['壱', '弐', '参'][idx]}</span>
                <div className={`folio-reel-window ${started && state === 'ready' ? 'is-spinning' : ''}`}>
                  {started && state !== 'landed' ? (
                    <div key="strip" className="folio-reel-strip" ref={el => { strips.current[idx] = el; }}
                      aria-hidden="true">
                      {[...SLOT_CYCLE, ...SLOT_CYCLE, ...SLOT_CYCLE, ...SLOT_CYCLE].map((item, i) => (
                        <div className="folio-reel-cell" key={i}><img src={slotAssetUrl(item)} alt="" /></div>
                      ))}
                    </div>
                  ) : (
                    <div key="symbol" className="folio-reel-cell"><img src={slotAssetUrl(symbol)} alt={symbol} /></div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="folio-reel-controls">
          {reels.map((state, idx) => (
            <button type="button" className="folio-reel-latch" key={idx}
              disabled={!started || state !== 'ready'} onClick={() => stopReel(idx)}
              aria-label={`第${idx + 1}リールを止める`} />
          ))}
        </div>

        {/* 右側面から伸びる真鍮の引き手（レバー） */}
        <button
          type="button"
          className={`folio-slot-lever${pulling ? ' is-pulling' : ''}${
            started ? ' is-pulled' : ''
          }`}
          disabled={started || pulling}
          onPointerDown={event => {
            if (!event.isPrimary || event.button !== 0) return;
            leverStartY.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (event.isPrimary && leverStartY.current !== null && event.clientY - leverStartY.current >= 20) {
              leverStartY.current = null;
              setPulling(true);
            }
          }}
          onLostPointerCapture={event => { if (event.isPrimary) leverStartY.current = null; }}
          onClick={() => setPulling(true)}
          aria-label="レバーを引く"
        >
          <span className="folio-lever-shaft" aria-hidden="true">
            <span className="folio-lever-knob" />
          </span>
        </button>
        <small className="slot-lever-hint" style={{ visibility: started || pulling ? 'hidden' : 'visible' }}>↓ 引く／タップ</small>
      </div>

      {allStopped && gamble.outcome && (
        <OutcomeSlip
          outcome={gamble.outcome}
          prepared={prepared}
          busy={busy}
          error={error}
          onFinish={onFinish}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * 5. ブラックジャック (Blackjack) — 「斜め対角の手札と山札・栞の駆け引き」
 * ========================================================================== */

function BlackjackGamble({
  gamble,
  busy,
  error,
  prepared,
  onFinish,
}: FreshGambleProps) {
  const round: CardRound | undefined = gamble.rounds[0];
  const playerAll = useMemo(() => round?.player ?? [], [round]);
  const bankerAll = useMemo(() => round?.banker ?? [], [round]);

  const [hits, setHits] = useState(0);
  const [stood, setStood] = useState(false);

  const [dealt, setDealt] = useState(0);
  const [settledHits, setSettledHits] = useState(0);
  const [dealerOpen, setDealerOpen] = useState(1);
  const [dealerSettled, setDealerSettled] = useState(false);
  const [announced, setAnnounced] = useState({ player: false, dealer: false });
  const visiblePlayerCards = playerAll.slice(0, Math.ceil(Math.min(dealt, 4) / 2) + hits);
  const playerTotal = calcBlackjackTotal(visiblePlayerCards);
  const ready = dealt === 5 && settledHits === hits;
  const isFinished = ready && (stood || playerTotal >= 21);
  const canHit = ready && !isFinished && 2 + hits < playerAll.length;
  const dealerHandForStep = round?.dealer_hands?.[hits] ?? bankerAll;
  const dealerCount = Math.max(Math.floor(Math.min(dealt, 4) / 2), isFinished ? dealerOpen : 0);
  const dealerVisibleTotal = calcBlackjackTotal(dealerHandForStep.slice(0, Math.min(dealerOpen, dealerCount)));

  const natural = ready && !announced.player && hits === 0 && playerTotal === 21 ? 'player'
    : dealerOpen === 2 && !announced.dealer && dealerVisibleTotal === 21 ? 'dealer' : null;
  useEffect(() => {
    // The fifth beat lets the fourth opening card land before enabling actions.
    const advance = natural ? () => setAnnounced(previous => ({ ...previous, [natural]: true }))
      : dealt < 5 ? () => setDealt(dealt + 1)
      : settledHits < hits ? () => setSettledHits(hits)
      : isFinished && dealerOpen < dealerHandForStep.length ? () => setDealerOpen(dealerOpen + 1)
      : isFinished && !dealerSettled ? () => setDealerSettled(true)
      : undefined;
    if (!advance) return;
    const timer = window.setTimeout(advance, natural ? 1100 : prefersReducedMotion() ? 90 : 624);
    return () => window.clearTimeout(timer);
  }, [natural, dealt, hits, settledHits, isFinished, dealerOpen, dealerHandForStep.length, dealerSettled]);

  const finalOutcome =
    gamble.outcome ??
    (round?.outcome === 'win' || round?.outcome === 'loss'
      ? round.outcome
      : 'loss');

  return (
    <div className="folio-bj">
      {natural && <div className="folio-hand-call" role="status"><small>{natural === 'player' ? 'あなた' : 'アノマ'}</small>ブラックジャック！</div>}
      {/* 左上：アノマ（ディーラー）の手札と余白の合計メモ */}
      <section className="folio-bj-dealer" aria-label="アノマの手札">
        <div className="folio-hand-header">
          <span className="folio-note-caption">アノマ（親）</span>
          <span className="folio-ink-total" aria-live="polite">
            合計:{' '}
            <strong>
              {dealerCount === 0 ? '―' : dealerCount > dealerOpen ? `${dealerVisibleTotal} + ?` : dealerVisibleTotal}
            </strong>
          </span>
        </div>
        <div className="folio-card-spread">
          {dealerHandForStep.slice(0, dealerCount).map((card, idx) => (
            <FolioCardView
              key={idx}
              card={card}
              faceUp={idx < dealerOpen}
              className={idx === 1 && dealerOpen > 1 ? 'bj-turn' : 'bj-deal'}
            />
          ))}
        </div>
      </section>

      {/* 中央対角：山札（引く＝HIT）と栞リボン（勝負＝STAND） */}
      <div className="folio-bj-desk-props" role="group" aria-label="手札の操作">
        <button
          type="button"
          className={`folio-draw-shoe${canHit ? ' is-ready' : ''}`}
          disabled={!canHit}
          onClick={() => {
            if (canHit) setHits((h) => h + 1);
          }}
          aria-label="山札からもう一枚引く (HIT)"
        >
          <span className="folio-shoe-stack" aria-hidden="true" />
          <span className="folio-shoe-text">
            <strong>山札を引く</strong>
            <small>HIT</small>
          </span>
        </button>

        <button
          type="button"
          className={`folio-stand-bookmark${ready && !isFinished ? ' is-ready' : ''}`}
          disabled={!ready || isFinished}
          onClick={() => setStood(true)}
          aria-label="この手で勝負する (STAND)"
        >
          <span className="folio-bookmark-tail" aria-hidden="true" />
          <span className="folio-bookmark-text">
            <strong>この手で勝負</strong>
            <small>STAND</small>
          </span>
        </button>
      </div>

      {/* 右下：自分の手札と余白の合計メモ */}
      <section className="folio-bj-player" aria-label="自分の手札">
        <div className="folio-hand-header">
          <span className="folio-note-caption">あなたの手札</span>
          <span
            className={`folio-ink-total${playerTotal > 21 ? ' is-bust' : ''}`}
            aria-live="polite"
          >
            合計: <strong>{playerTotal}</strong>
            {playerTotal > 21 && <small>（超過）</small>}
          </span>
        </div>
        <div className="folio-card-spread">
          {visiblePlayerCards.map((card, idx) => (
            <FolioCardView
              key={idx}
              card={card}
              faceUp={true}
              className="bj-deal"
              highlighted={idx >= 2 && idx === visiblePlayerCards.length - 1}
            />
          ))}
        </div>
      </section>

      {dealerSettled && (
        <OutcomeSlip
          outcome={finalOutcome}
          prepared={prepared}
          busy={busy}
          error={error}
          onFinish={onFinish}
        />
      )}
    </div>
  );
}

/* ============================================================================
 * 6. バカラ (Baccarat) — 「左右の配札とルーペ絞り（スクイーズ）台」
 * ========================================================================== */

type PeelEdge = 'left' | 'right' | 'top' | 'bottom';

type BaccaratCardKey = 'p-0' | 'p-1' | 'p-2' | 'b-0' | 'b-1' | 'b-2';

interface BaccaratSlotItem {
  key: BaccaratCardKey;
  side: 'player' | 'banker';
  index: number;
  card: PlayingCard;
  label: string;
}

function BaccaratGamble({
  gamble,
  busy,
  error,
  prepared,
  onFinish,
}: FreshGambleProps) {
  const rounds = gamble.rounds;
  const [roundIdx, setRoundIdx] = useState(0);
  const currentRound: CardRound | undefined = rounds[roundIdx] ?? rounds[0];

  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [activeKey, setActiveKey] = useState<BaccaratCardKey>('p-0');
  const [peelProgress, setPeelProgress] = useState(0);
  const [edge, setEdge] = useState<PeelEdge>('left');
  const dragStartRef = useRef<{ id: number; edge: PeelEdge; x: number; y: number; base: number } | null>(
    null
  );

  const playerCards = useMemo(
    () => currentRound?.player ?? [],
    [currentRound]
  );
  const bankerCards = useMemo(
    () => currentRound?.banker ?? [],
    [currentRound]
  );

  // 両者とも最初の2枚が開いたかどうか
  const initialFourOpened =
    Boolean(opened['p-0']) &&
    Boolean(opened['p-1']) &&
    Boolean(opened['b-0']) &&
    Boolean(opened['b-1']);

  // 現在場に配られているカードの一覧
  const dealtPlayerCount = initialFourOpened
    ? playerCards.length
    : Math.min(2, playerCards.length);
  const dealtBankerCount = initialFourOpened && (playerCards.length < 3 || opened['p-2'])
    ? bankerCards.length
    : Math.min(2, bankerCards.length);

  const availableItems = useMemo<BaccaratSlotItem[]>(() => {
    const list: BaccaratSlotItem[] = [];
    for (let i = 0; i < dealtPlayerCount; i += 1) {
      const card = playerCards[i];
      if (card) {
        list.push({
          key: `p-${i}` as BaccaratCardKey,
          side: 'player',
          index: i,
          card,
          label: `プレイヤー ${i + 1}枚目`,
        });
      }
    }
    for (let i = 0; i < dealtBankerCount; i += 1) {
      const card = bankerCards[i];
      if (card) {
        list.push({
          key: `b-${i}` as BaccaratCardKey,
          side: 'banker',
          index: i,
          card,
          label: `バンカー ${i + 1}枚目`,
        });
      }
    }
    return list;
  }, [playerCards, bankerCards, dealtPlayerCount, dealtBankerCount]);

  // 全ての札（最終枚数すべて）が開いたかどうか
  const allExpectedKeys = useMemo(() => {
    const keys: BaccaratCardKey[] = [];
    for (let i = 0; i < playerCards.length; i += 1) {
      keys.push(`p-${i}` as BaccaratCardKey);
    }
    for (let i = 0; i < bankerCards.length; i += 1) {
      keys.push(`b-${i}` as BaccaratCardKey);
    }
    return keys;
  }, [playerCards.length, bankerCards.length]);

  const isRoundComplete =
    allExpectedKeys.length > 0 &&
    allExpectedKeys.every((k) => Boolean(opened[k]));

  // 現在選択されている札がすでに開いている場合、未公開の札があれば自動的に次の未公開札にフォーカスを移す
  useEffect(() => {
    if (opened[activeKey]) {
      const nextClosed = availableItems.find((item) => !opened[item.key]);
      if (nextClosed) {
        setActiveKey(nextClosed.key);
        setPeelProgress(0);
      }
    }
  }, [opened, activeKey, availableItems]);

  const activeItem =
    availableItems.find((item) => item.key === activeKey && !opened[item.key]) ??
    availableItems.find((item) => !opened[item.key]);

  const openSingleCard = (key: BaccaratCardKey) => {
    setOpened((prev) => ({ ...prev, [key]: true }));
    setPeelProgress(0);
    dragStartRef.current = null;
  };

  // バンカー側を全てまとめて開く操作
  const openAllBanker = () => {
    dragStartRef.current = null;
    setOpened((prev) => {
      const next = { ...prev };
      for (let i = 0; i < dealtBankerCount; i += 1) {
        next[`b-${i}`] = true;
      }
      return next;
    });
    setPeelProgress(0);
  };

  const hasClosedBankerDealt = availableItems.some(
    (item) => item.side === 'banker' && !opened[item.key]
  );

  // 開いている札だけで計算した現在の合計（下1桁）
  const openedPlayerCards = playerCards
    .slice(0, dealtPlayerCount)
    .filter((_, idx) => Boolean(opened[`p-${idx}`]));
  const openedBankerCards = bankerCards
    .slice(0, dealtBankerCount)
    .filter((_, idx) => Boolean(opened[`b-${idx}`]));

  const playerTotal = calcBaccaratTotal(openedPlayerCards);
  const bankerTotal = calcBaccaratTotal(openedBankerCards);

  function peel(value: number) {
    if (!activeItem) return;
    if (value >= 75) openSingleCard(activeItem.key);
    else setPeelProgress(Math.max(0, value));
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeItem || !e.isPrimary) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const distances: Record<PeelEdge, number> = {
      left: e.clientX - rect.left, right: rect.right - e.clientX,
      top: e.clientY - rect.top, bottom: rect.bottom - e.clientY,
    };
    const nearest = (Object.keys(distances) as PeelEdge[])
      .reduce((a, b) => distances[a] < distances[b] ? a : b);
    e.preventDefault();
    const from = peelProgress > 0 ? edge : nearest;
    setEdge(from);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = { id: e.pointerId, edge: from, x: e.clientX, y: e.clientY, base: peelProgress };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStartRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const horizontal = drag.edge === 'left' || drag.edge === 'right';
    const rect = e.currentTarget.getBoundingClientRect();
    const delta = horizontal ? (e.clientX - drag.x) / rect.width : (e.clientY - drag.y) / rect.height;
    const sign = drag.edge === 'left' || drag.edge === 'top' ? 1 : -1;
    peel(drag.base + sign * delta * 100);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current?.id === e.pointerId) {
      dragStartRef.current = null;
      setPeelProgress(0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const directions: Record<string, PeelEdge> = {
      ArrowRight: 'left', ArrowLeft: 'right', ArrowDown: 'top', ArrowUp: 'bottom',
    };
    const from = directions[e.key];
    if (!from) return;
    e.preventDefault();
    if (e.repeat) return;
    if (!peelProgress) setEdge(from);
    peel(peelProgress + (!peelProgress || edge === from ? 25 : -25));
  };

  const handleNextRound = () => {
    if (roundIdx + 1 < rounds.length) {
      setRoundIdx((r) => r + 1);
      setOpened({});
      setActiveKey('p-0');
      setPeelProgress(0);
    }
  };

  const roundOutcome: 'win' | 'loss' | 'tie' =
    currentRound?.outcome ?? gamble.outcome ?? 'loss';
  const hasMoreRounds = roundIdx + 1 < rounds.length;
  const effectiveOutcome: 'win' | 'loss' | 'tie' =
    roundOutcome === 'tie' && hasMoreRounds
      ? 'tie'
      : gamble.outcome ?? (roundOutcome === 'tie' ? 'loss' : roundOutcome);

  return (
    <div className="folio-baccarat">
      {/* 上段：PLAYER と BANKER の配札エリア */}
      <div className="folio-baccarat-board">
        {/* PLAYER 側 */}
        <section className="folio-baccarat-side" aria-label="プレイヤーの手札">
          <div className="folio-side-header">
            <span className="folio-note-caption">あなた (PLAYER)</span>
            {openedPlayerCards.length === playerCards.length &&
              <span className="folio-ink-total" aria-live="polite">下1桁: <strong>{playerTotal}</strong></span>}
          </div>
          <div className="folio-baccarat-row">
            {playerCards.slice(0, dealtPlayerCount).map((card, idx) => {
              const key = `p-${idx}` as BaccaratCardKey;
              const isOpened = Boolean(opened[key]);
              const isSelected = activeItem?.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`folio-baccarat-card-btn${
                    isSelected ? ' is-selected' : ''
                  }${idx === 2 ? ' is-third-card' : ''}`}
                  disabled={isOpened}
                  onClick={() => {
                    dragStartRef.current = null;
                    setActiveKey(key);
                    setPeelProgress(0);
                  }}
                  aria-label={`プレイヤー${idx + 1}枚目の札${
                    isOpened ? ` (${card.suit})` : 'を絞る'
                  }`}
                >
                  <FolioCardView
                    card={card}
                    faceUp={isOpened}
                    suitOnly
                    highlighted={isSelected}
                    badge={idx === 2 ? '3枚目' : undefined}
                  />
                </button>
              );
            })}
          </div>
        </section>

        {/* BANKER 側 */}
        <section className="folio-baccarat-side" aria-label="バンカーの手札">
          <div className="folio-side-header">
            <span className="folio-note-caption">アノマ (BANKER)</span>
            {openedBankerCards.length === bankerCards.length &&
              <span className="folio-ink-total" aria-live="polite">下1桁: <strong>{bankerTotal}</strong></span>}
          </div>
          <div className="folio-baccarat-row">
            {bankerCards.slice(0, dealtBankerCount).map((card, idx) => {
              const key = `b-${idx}` as BaccaratCardKey;
              const isOpened = Boolean(opened[key]);
              const isSelected = activeItem?.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`folio-baccarat-card-btn${
                    isSelected ? ' is-selected' : ''
                  }${idx === 2 ? ' is-third-card' : ''}`}
                  disabled={isOpened}
                  onClick={() => {
                    dragStartRef.current = null;
                    setActiveKey(key);
                    setPeelProgress(0);
                  }}
                  aria-label={`バンカー${idx + 1}枚目の札${
                    isOpened ? ` (${card.suit})` : 'を絞る'
                  }`}
                >
                  <FolioCardView
                    card={card}
                    faceUp={isOpened}
                    suitOnly
                    highlighted={isSelected}
                    badge={idx === 2 ? '3枚目' : undefined}
                  />
                </button>
              );
            })}
          </div>
          {hasClosedBankerDealt && (
            <button
              type="button"
              className="folio-banker-batch-btn"
              onClick={openAllBanker}
            >
              バンカーをまとめて開く
            </button>
          )}
        </section>
      </div>

      {/* 下段：絞り（スクイーズ）ルーペ台紙（まだ未公開の札がある間） */}
      {!isRoundComplete && activeItem && (
        <section
          className="folio-squeeze-mat"
          aria-label={`${activeItem.label}の絞り台`}
        >
          <div className="folio-squeeze-guide">
            <span className="folio-squeeze-target">{activeItem.label}</span>
          </div>

          <div className="folio-squeeze-workarea">
            <div
              className="folio-squeeze-card"
              key={activeItem.key}
              data-edge={edge}
              tabIndex={0}
              role="slider"
              aria-label={`${activeItem.label}を絞ってめくる`}
              aria-valuemin={0}
              aria-valuemax={75}
              aria-valuenow={Math.round(peelProgress)}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onLostPointerCapture={handlePointerUp}
              onKeyDown={handleKeyDown}
              style={
                {
                  '--peel-pct': `${peelProgress}%`,
                } as React.CSSProperties
              }
            >
              {/* 下から覗く絵札 */}
              <div className="folio-squeeze-underlay">
                <BaccaratFace card={activeItem.card} />
              </div>

              {/* 上にかぶさっている裏紙（めくり進行度に応じて端から折れ上がる） */}
              <div className="folio-squeeze-cover" aria-hidden="true" />
            </div>
          </div>
        </section>
      )}

      {isRoundComplete && (
        <OutcomeSlip
          outcome={effectiveOutcome}
          prepared={prepared}
          busy={busy}
          error={error}
          onFinish={onFinish}
          onNextRound={
            effectiveOutcome === 'tie' && hasMoreRounds
              ? handleNextRound
              : undefined
          }
        />
      )}
    </div>
  );
}

/* ============================================================================
 * メインエントリ FreshGamble
 * ========================================================================== */

export function FreshGamble(props: FreshGambleProps) {
  const { gamble } = props;
  const kindTitle = KIND_NAMES[gamble.kind] ?? '勝負';

  return (
    <section
      className={`folio-gamble kind-${gamble.kind}`}
      aria-label={kindTitle}
    >
      <div className="folio-gamble-canvas">
        {gamble.kind === 'rps' && <RpsGamble {...props} />}
        {gamble.kind === 'chinchiro' && <ChinchiroGamble {...props} />}
        {gamble.kind === 'card_guess' && <CardGuessGamble {...props} />}
        {gamble.kind === 'slot' && <SlotGamble {...props} />}
        {gamble.kind === 'blackjack' && <BlackjackGamble {...props} />}
        {gamble.kind === 'baccarat' && <BaccaratGamble {...props} />}
      </div>
    </section>
  );
}
