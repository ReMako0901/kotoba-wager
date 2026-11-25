import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CardMove,
  CardRound,
  DiceMove,
  GameKind,
  HandMove,
  PlayingCard,
} from '../types';
import type { FreshGambleProps } from './contract';
import {
  FolioCardView,
  calcBaccaratPoint,
  calcBaccaratTotal,
  calcBlackjackTotal,
  cardAssetUrl,
  cardLabel,
  isRedSuit,
  slotAssetUrl,
} from './cards';
import './games.css';

const KIND_NAMES: Record<GameKind, string> = {
  rps: 'じゃんけん',
  dice: '一発サイコロ',
  card_guess: 'カード当て',
  slot: 'スロット',
  blackjack: 'ブラックジャック',
  baccarat: 'バカラ',
};

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface OutcomeSlipProps {
  outcome: 'win' | 'loss' | 'tie';
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
  const heading =
    outcome === 'win' ? '勝利' : outcome === 'loss' ? '敗北' : '引き分け';

  if (outcome === 'tie' && onNextRound) {
    return (
      <footer className="folio-outcome-slip is-tie" aria-live="polite">
        <div className="folio-wax-seal is-tie">
          <span className="folio-seal-ring">{heading}</span>
        </div>
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
    );
  }

  const canPress = !busy && (prepared || Boolean(error));

  return (
    <footer
      className={`folio-outcome-slip is-${outcome}`}
      aria-live="polite"
    >
      <div className={`folio-wax-seal is-${outcome}`}>
        <span className="folio-seal-ring">{heading}</span>
      </div>
      <div className="folio-slip-body">
        {!prepared && !error && (
          <div
            className="generation-skeleton"
            role="status"
            aria-label="物語を書き換え中"
            aria-busy="true"
          >
            <span className="spinner" aria-hidden="true" />
            <div className="skeleton-ink" aria-hidden="true" />
          </div>
        )}
        {error && (
          <p className="folio-slip-error" role="alert">
            {error}
          </p>
        )}
        <button
          type="button"
          className="folio-story-turn primary"
          disabled={!canPress}
          onClick={onFinish}
        >
          {!prepared && !error && (
            <span className="spinner" aria-hidden="true" />
          )}
          <span>この結果を物語へ →</span>
        </button>
      </div>
    </footer>
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
  const lastMove = moves.length > 0 ? moves[moves.length - 1] : undefined;
  const finished = gamble.outcome === 'win' || gamble.outcome === 'loss';

  return (
    <div className="folio-rps">
      <div className="folio-rps-top">
        <div className="folio-opponent-tag" aria-live="polite">
          <span className="folio-note-caption">アノマの札</span>
          {lastMove ? (
            <div className="folio-opponent-hand" key={moves.length}>
              <HandGlyph hand={lastMove.opponent} />
              <strong>{handName(lastMove.opponent)}</strong>
            </div>
          ) : (
            <div className="folio-opponent-hand is-waiting">
              <span className="folio-mystery-mark">？</span>
              <span>伏せ札</span>
            </div>
          )}
        </div>

        <aside className="folio-margin-tally" aria-label="手合わせの記録">
          <span className="folio-note-caption">余白の記録</span>
          {moves.length === 0 ? (
            <p className="folio-scribble">札を一枚抜き出して勝負する</p>
          ) : (
            <ul className="folio-tally-list">
              {moves.map((m, idx) => (
                <li key={idx}>
                  <span>{idx + 1}手目:</span>
                  <span>
                    {handName(m.choice)} × {handName(m.opponent)}
                  </span>
                  <b>
                    {m.outcome === 'tie'
                      ? 'あいこ'
                      : m.outcome === 'win'
                        ? '勝'
                        : '敗'}
                  </b>
                </li>
              ))}
            </ul>
          )}
          {lastMove?.outcome === 'tie' && !finished && (
            <p className="folio-tie-prompt" role="status">
              あいこ — 続けて次の手を選ぶ
            </p>
          )}
        </aside>
      </div>

      <div className="folio-rps-ring" role="group" aria-label="出す手を選ぶ">
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
          {RPS_HANDS.map((item) => {
            const isChosen = lastMove?.choice === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`folio-rps-slip${isChosen ? ' is-chosen' : ''}`}
                style={{ '--slip-angle': item.angle } as React.CSSProperties}
                disabled={busy || finished}
                aria-label={`${item.name}を出す`}
                onClick={() => onMove(moves.length, item.id)}
              >
                <span className="folio-slip-pin" aria-hidden="true" />
                <span className="folio-slip-motif">{item.motif}</span>
                <HandGlyph hand={item.id} />
                <strong className="folio-slip-name">{item.name}</strong>
              </button>
            );
          })}
        </div>
      </div>

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
 * 2. 一発サイコロ (Dice) — 手帳ページの「インク八角方陣と象牙の賽」
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

function DiceFace({
  face,
  rolling,
}: {
  face: number;
  rolling?: boolean;
}) {
  const pips = DICE_PIPS[face] ?? DICE_PIPS[1];
  return (
    <div
      className={`folio-die-cube${rolling ? ' is-rolling' : ''}`}
      data-face={face}
      aria-label={`サイコロの目 ${face}`}
    >
      {Array.from({ length: 9 }, (_, cell) => {
        const hasPip = pips.includes(cell);
        const isAce = face === 1 && cell === 4;
        return (
          <span
            key={cell}
            className={`folio-die-cell${hasPip ? ' has-pip' : ''}${
              isAce ? ' is-ace-pip' : ''
            }`}
          />
        );
      })}
    </div>
  );
}

function DiceGamble({
  gamble,
  busy,
  error,
  prepared,
  onMove,
  onFinish,
}: FreshGambleProps) {
  const moves = (gamble.moves ?? []) as DiceMove[];
  const resultMove = moves[0];
  const [rollingAnim, setRollingAnim] = useState(false);
  const [displayFace, setDisplayFace] = useState<number>(resultMove?.face ?? 1);
  const animTriggeredRef = useRef(false);

  useEffect(() => {
    if (!resultMove) return;
    if (animTriggeredRef.current) {
      setDisplayFace(resultMove.face);
      return;
    }
    animTriggeredRef.current = true;
    if (prefersReducedMotion()) {
      setDisplayFace(resultMove.face);
      setRollingAnim(false);
      return;
    }
    setRollingAnim(true);
    const sequence = [3, 6, 2, 5, 4, resultMove.face];
    let step = 0;
    const timer = window.setInterval(() => {
      setDisplayFace(sequence[step] ?? resultMove.face);
      step += 1;
      if (step >= sequence.length) {
        window.clearInterval(timer);
        setDisplayFace(resultMove.face);
        setRollingAnim(false);
      }
    }, 95);
    return () => window.clearInterval(timer);
  }, [resultMove]);

  const hasResult = Boolean(resultMove) && !rollingAnim;
  const finalOutcome = gamble.outcome ?? resultMove?.outcome ?? null;

  const handleRoll = () => {
    if (busy || resultMove || rollingAnim) return;
    onMove(0);
  };

  return (
    <div className="folio-dice">
      <div className="folio-dice-notes">
        <span className="folio-note-caption">紙上の賽皿</span>
        <p className="folio-scribble">
          {!resultMove && !busy
            ? '八角の皿に置かれた賽に触れて振る'
            : busy || rollingAnim
              ? '賽が紙面を転がっている…'
              : `出た目：${resultMove.face}`}
        </p>
      </div>

      <div className="folio-dice-tray-wrap">
        <button
          type="button"
          className={`folio-dice-tray${
            !resultMove && !busy ? ' is-interactive' : ''
          }${busy || rollingAnim ? ' is-active' : ''}`}
          disabled={busy || Boolean(resultMove) || rollingAnim}
          onClick={handleRoll}
          aria-label="サイコロを振る"
        >
          <svg
            className="folio-octagon-svg"
            viewBox="0 0 220 220"
            aria-hidden="true"
          >
            <polygon
              points="66,12 154,12 208,66 208,154 154,208 66,208 12,154 12,66"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            />
            <polygon
              points="72,22 148,22 198,72 198,148 148,198 72,198 22,148 22,72"
              fill="none"
              stroke="currentColor"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          </svg>

          <DiceFace
            face={hasResult && resultMove ? resultMove.face : displayFace}
            rolling={busy || rollingAnim}
          />

          {!resultMove && !busy && (
            <span className="folio-tray-inscription">賽を振る</span>
          )}
        </button>

        {hasResult && resultMove && (
          <div className="folio-dice-margin-memo" aria-live="polite">
            <span>出目</span>
            <strong>{resultMove.face}</strong>
          </div>
        )}
      </div>

      {hasResult && finalOutcome && (
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

  // シャッフル演出の再生
  const startShuffle = () => {
    if (phase !== 'reveal') return;
    setPhase('shuffling');
    setActiveSwapStep(0);

    const reduced = prefersReducedMotion();
    const flipDelay = reduced ? 120 : 380;
    const stepDuration = reduced ? 110 : 360;

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
      }, flipDelay + idx * stepDuration);
      timers.push(t);
    });

    const endTimer = window.setTimeout(() => {
      setPhase('choose');
    }, flipDelay + swaps.length * stepDuration + (reduced ? 90 : 280));
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
        <p className="folio-scribble" aria-live="polite">
          {phase === 'reveal' && '当たり札の位置を覚え、札を伏せて混ぜる'}
          {phase === 'shuffling' &&
            `札を入れ替え中… (${activeSwapStep}/${swaps.length})`}
          {phase === 'choose' && '当たり札が移った位置（左・中央・右）の札を抜く'}
          {phase === 'done' &&
            (resultMove
              ? `${POS_LABELS[resultMove.choice] ?? '選んだ札'}を開いた`
              : '結果確定')}
        </p>
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
                style={{ '--slot-pos': pos } as React.CSSProperties}
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
  const [stopped, setStopped] = useState<[boolean, boolean, boolean]>([
    false,
    false,
    false,
  ]);
  const [pulling, setPulling] = useState(false);

  const allStopped = started && stopped[0] && stopped[1] && stopped[2];

  const handlePullLever = () => {
    if (started) return;
    setPulling(true);
    window.setTimeout(() => {
      setPulling(false);
      setStarted(true);
    }, prefersReducedMotion() ? 60 : 220);
  };

  const handleStopReel = (index: 0 | 1 | 2) => {
    if (!started || stopped[index]) return;
    setStopped((prev) => {
      const next: [boolean, boolean, boolean] = [...prev];
      next[index] = true;
      return next;
    });
  };

  return (
    <div className="folio-slot">
      <div className="folio-slot-notes">
        <span className="folio-note-caption">真鍮の三連覗き窓</span>
        <p className="folio-scribble" aria-live="polite">
          {!started
            ? '右脇の引き手を引いて絵柄車を回す'
            : !allStopped
              ? '回転している窓の留め金を一つずつ押して止める'
              : `出目：${targetReels.join('・')}`}
        </p>
      </div>

      <div className="folio-slot-mechanica">
        <div className="folio-slot-windows" role="group" aria-label="スロットリール">
          {([0, 1, 2] as const).map((idx) => {
            const isSpinning = started && !stopped[idx];
            const isLocked = started && stopped[idx];
            const finalSymbol = targetReels[idx] ?? 'ベル';
            const previewSymbol = SLOT_CYCLE[idx % SLOT_CYCLE.length];

            return (
              <div
                key={idx}
                className={`folio-reel-column${
                  isSpinning ? ' is-spinning' : ''
                }${isLocked ? ' is-locked' : ''}`}
              >
                <span className="folio-reel-index" aria-hidden="true">
                  {idx === 0 ? '壱' : idx === 1 ? '弐' : '参'}
                </span>

                <button
                  type="button"
                  className="folio-reel-window"
                  disabled={!isSpinning}
                  onClick={() => handleStopReel(idx)}
                  aria-label={`第${idx + 1}リールを止める`}
                >
                  {isSpinning ? (
                    <div className="folio-reel-strip" aria-hidden="true">
                      {[...SLOT_CYCLE, ...SLOT_CYCLE].map((sym, sIdx) => (
                        <div key={sIdx} className="folio-reel-cell">
                          <img
                            src={slotAssetUrl(sym)}
                            alt=""
                            draggable={false}
                          />
                          <small>{sym}</small>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="folio-reel-cell is-static">
                      <img
                        src={slotAssetUrl(isLocked ? finalSymbol : previewSymbol)}
                        alt={isLocked ? finalSymbol : previewSymbol}
                        draggable={false}
                      />
                      <small>{isLocked ? finalSymbol : '待機'}</small>
                    </div>
                  )}

                  <span className="folio-reel-latch">
                    {isSpinning
                      ? '止める'
                      : isLocked
                        ? finalSymbol
                        : '―'}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        {/* 右側面から伸びる真鍮の引き手（レバー） */}
        <button
          type="button"
          className={`folio-slot-lever${pulling ? ' is-pulling' : ''}${
            started ? ' is-pulled' : ''
          }`}
          disabled={started}
          onClick={handlePullLever}
          aria-label="レバーを引く"
        >
          <span className="folio-lever-shaft" aria-hidden="true">
            <span className="folio-lever-knob" />
          </span>
          <span className="folio-lever-label">
            {started ? '稼働中' : '引く'}
          </span>
        </button>
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

  const visiblePlayerCards = useMemo(
    () => playerAll.slice(0, Math.min(playerAll.length, 2 + hits)),
    [playerAll, hits]
  );
  const playerTotal = useMemo(
    () => calcBlackjackTotal(visiblePlayerCards),
    [visiblePlayerCards]
  );

  // 終了条件: STAND するか、合計が 21 以上になったら終了
  const isFinished = stood || playerTotal >= 21;

  // HIT できる条件: まだ加わる札があり、合計が 21 未満のときだけ
  const canHit =
    !isFinished &&
    2 + hits < playerAll.length &&
    playerTotal < 21;

  // ディーラーの見せ札は dealer_hands[ヒット回数] を使い、無ければ banker を使う
  const dealerHandForStep = useMemo(() => {
    if (isFinished) {
      return round?.dealer_hands?.[hits] &&
        round.dealer_hands[hits].length >= bankerAll.length
        ? round.dealer_hands[hits]
        : bankerAll;
    }
    return round?.dealer_hands?.[hits] ?? bankerAll;
  }, [round, hits, bankerAll, isFinished]);

  const dealerVisibleTotal = useMemo(() => {
    if (isFinished) {
      return calcBlackjackTotal(dealerHandForStep);
    }
    return dealerHandForStep.length > 0
      ? calcBlackjackTotal([dealerHandForStep[0]])
      : 0;
  }, [dealerHandForStep, isFinished]);

  const finalOutcome =
    gamble.outcome ??
    (round?.outcome === 'win' || round?.outcome === 'loss'
      ? round.outcome
      : 'loss');

  return (
    <div className="folio-bj">
      {/* 左上：アノマ（ディーラー）の手札と余白の合計メモ */}
      <section className="folio-bj-dealer" aria-label="アノマの手札">
        <div className="folio-hand-header">
          <span className="folio-note-caption">アノマ（親）</span>
          <span className="folio-ink-total" aria-live="polite">
            合計:{' '}
            <strong>
              {isFinished ? dealerVisibleTotal : `${dealerVisibleTotal} + ?`}
            </strong>
          </span>
        </div>
        <div className="folio-card-spread">
          {dealerHandForStep.map((card, idx) => (
            <FolioCardView
              key={idx}
              card={card}
              faceUp={isFinished || idx === 0}
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
          className={`folio-stand-bookmark${!isFinished ? ' is-ready' : ''}`}
          disabled={isFinished}
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
              highlighted={idx >= 2 && idx === visiblePlayerCards.length - 1}
            />
          ))}
        </div>
      </section>

      {isFinished && (
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
  const dragStartRef = useRef<{ x: number; y: number; base: number } | null>(
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
  const dealtBankerCount = initialFourOpened
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
    setOpened((prev) => {
      const next = { ...prev };
      // 現在配られているバンカー札を開く。もしプレイヤーの最初の2枚もすでに開いていれば3枚目まで一気に開く
      const pInitialDone = Boolean(next['p-0']) && Boolean(next['p-1']);
      const maxBanker = pInitialDone
        ? bankerCards.length
        : Math.min(2, bankerCards.length);
      for (let i = 0; i < maxBanker; i += 1) {
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

  // ドラッグ（Pointer Events）による絞り操作
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!activeItem) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      base: peelProgress,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStartRef.current || !activeItem) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const dist = Math.hypot(dx, dy);
    const nextProgress = Math.min(
      100,
      Math.round(dragStartRef.current.base + (dist / 78) * 100)
    );
    if (nextProgress >= 75) {
      openSingleCard(activeItem.key);
    } else {
      setPeelProgress(nextProgress);
    }
  };

  const handlePointerUp = () => {
    dragStartRef.current = null;
  };

  // 矢印キーによる絞り操作
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!activeItem) return;
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      e.preventDefault();
      const next = peelProgress + 28;
      if (next >= 75) {
        openSingleCard(activeItem.key);
      } else {
        setPeelProgress(next);
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openSingleCard(activeItem.key);
    }
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
            <span className="folio-ink-total" aria-live="polite">
              下1桁:{' '}
              <strong>
                {openedPlayerCards.length > 0 ? playerTotal : '―'}
              </strong>
            </span>
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
                    setActiveKey(key);
                    setPeelProgress(0);
                  }}
                  aria-label={`プレイヤー${idx + 1}枚目の札${
                    isOpened ? ` (${cardLabel(card)})` : 'を絞る'
                  }`}
                >
                  <FolioCardView
                    card={card}
                    faceUp={isOpened}
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
            <span className="folio-ink-total" aria-live="polite">
              下1桁:{' '}
              <strong>
                {openedBankerCards.length > 0 ? bankerTotal : '―'}
              </strong>
            </span>
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
                    setActiveKey(key);
                    setPeelProgress(0);
                  }}
                  aria-label={`バンカー${idx + 1}枚目の札${
                    isOpened ? ` (${cardLabel(card)})` : 'を絞る'
                  }`}
                >
                  <FolioCardView
                    card={card}
                    faceUp={isOpened}
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
            <span className="folio-scribble">
              端をドラッグまたは矢印キーでめくる（{peelProgress}%）
            </span>
          </div>

          <div className="folio-squeeze-workarea">
            <div
              className="folio-squeeze-card"
              tabIndex={0}
              role="slider"
              aria-label={`${activeItem.label}を絞ってめくる`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={peelProgress}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={handleKeyDown}
              style={
                {
                  '--peel-pct': `${peelProgress}%`,
                  '--peel-ratio': peelProgress / 100,
                } as React.CSSProperties
              }
            >
              {/* 下から覗く絵札 */}
              <div className="folio-squeeze-underlay">
                <img
                  src={cardAssetUrl(activeItem.card)}
                  alt={cardLabel(activeItem.card)}
                  draggable={false}
                />
                <span
                  className={`folio-squeeze-peek${
                    isRedSuit(activeItem.card.suit) ? ' is-red' : ''
                  }`}
                >
                  {activeItem.card.suit}
                  {activeItem.card.rank} · 点{calcBaccaratPoint(activeItem.card)}
                </span>
              </div>

              {/* 上にかぶさっている裏紙（めくり進行度に応じて端から折れ上がる） */}
              <div className="folio-squeeze-cover">
                <span className="folio-squeeze-corner-hint">
                  端を引いて絞る ↗
                </span>
                <span className="folio-squeeze-fold" aria-hidden="true" />
              </div>
            </div>

            <button
              type="button"
              className="folio-flip-direct-btn"
              onClick={() => openSingleCard(activeItem.key)}
            >
              表にする
            </button>
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
      {/* ページの端に差し込まれた縦書きの栞タグ（上部を圧迫しない種目名表示） */}
      <header className="folio-ear-tag">
        <span className="folio-ear-title">{kindTitle}</span>
      </header>

      <div className="folio-gamble-canvas">
        {gamble.kind === 'rps' && <RpsGamble {...props} />}
        {gamble.kind === 'dice' && <DiceGamble {...props} />}
        {gamble.kind === 'card_guess' && <CardGuessGamble {...props} />}
        {gamble.kind === 'slot' && <SlotGamble {...props} />}
        {gamble.kind === 'blackjack' && <BlackjackGamble {...props} />}
        {gamble.kind === 'baccarat' && <BaccaratGamble {...props} />}
      </div>
    </section>
  );
}
