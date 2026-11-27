import { retainExit } from './notebookMotion';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Transaction } from './types';
import { chooseLine, openingClosings, openingGreetings, openingNarration, reactionKinds, reactionTrigger, scenario, expressionForTrigger, storyExpressions, type AnomaExpression, type ReactionKind } from './scenario';

// Presentation memory only: no session storage or game state changes.
let previousExpression: AnomaExpression | undefined;
const unavailableTalkExpressions = new Set<AnomaExpression>();
const unavailableClosedExpressions = new Set<AnomaExpression>();
export function AnomaPortrait({ expression, speaking }: { expression: AnomaExpression; speaking: boolean }) {
  const [previous, setPrevious] = useState(() => previousExpression);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [closedFailed, setClosedFailed] = useState(() => unavailableClosedExpressions.has(expression));
  const [closedLoaded, setClosedLoaded] = useState(false);
  const [talkLoaded, setTalkLoaded] = useState(false);
  const [talkFailed, setTalkFailed] = useState(() => unavailableTalkExpressions.has(expression));
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { setReducedMotion(media.matches); setBlinking(false); };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!settled || !closedLoaded || closedFailed || failed || reducedMotion) return;
    let timer: number;
    const schedule = () => {
      timer = window.setTimeout(() => {
        setBlinking(true);
        timer = window.setTimeout(() => {
          setBlinking(false);
          schedule();
        }, 130);
      }, 2800 + Math.random() * 2700);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [settled, closedLoaded, closedFailed, failed, reducedMotion]);
  useEffect(() => {
    if (loaded && !failed) previousExpression = expression;
  }, [expression, loaded, failed]);
  if (failed) return null;
  const source = (id: AnomaExpression) => `${import.meta.env.BASE_URL}anoma/${id}.webp`;
  return <div className="anoma-portrait">
    {previous && previous !== expression && <img className="anoma-portrait-previous" src={source(previous)} alt="" onError={() => setFailed(true)} />}
    <img key={expression} className={`anoma-portrait-current${loaded ? ' anoma-portrait-fade' : ''}`}
      src={source(expression)} alt="" onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
      onAnimationEnd={() => { setPrevious(undefined); setSettled(true); }} />
    {!reducedMotion && !talkFailed && <img
      className={`anoma-portrait-talk${speaking ? ' anoma-portrait-speaking' : ''}`}
      data-ready={talkLoaded && loaded}
      src={`${import.meta.env.BASE_URL}anoma/${expression}-talk.webp`} alt=""
      onLoad={() => setTalkLoaded(true)}
      onError={() => { unavailableTalkExpressions.add(expression); setTalkFailed(true); }} />}
    {settled && !reducedMotion && !closedFailed && <img
      className={`anoma-portrait-closed${blinking && closedLoaded ? ' anoma-portrait-blinking' : ''}`}
      src={`${import.meta.env.BASE_URL}anoma/${expression}-closed.webp`} alt=""
      onLoad={() => setClosedLoaded(true)}
      onError={() => {
        unavailableClosedExpressions.add(expression);
        setClosedFailed(true);
        setBlinking(false);
      }} />}
  </div>;
}

type StageContent = { lines?: readonly string[]; expression: AnomaExpression; reaction?: ReactionKind };
const defaultStage: StageContent = { expression: 'normal' };
const StageContext = createContext(defaultStage);
const StageDispatchContext = createContext<(content: StageContent) => void>(() => {});

export function AnomaStageProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<StageContent>(defaultStage);
  return <StageDispatchContext.Provider value={setContent}>
    <StageContext.Provider value={content}>{children}</StageContext.Provider>
  </StageDispatchContext.Provider>;
}

// Publishers own presentation only; leaving a screen restores the quiet normal stage.
export function StagePublisher({ lines, expression, reaction }: StageContent) {
  const publish = useContext(StageDispatchContext);
  // Callers may construct arrays during render. Compare their contents, not their identity.
  const linesKey = JSON.stringify(lines ?? []);
  useLayoutEffect(() => {
    publish({ lines: JSON.parse(linesKey) as string[], expression, reaction });
    return () => publish(defaultStage);
  }, [publish, linesKey, expression, reaction]);
  return null;
}

function useTypedLength(linesKey: string, length: number) {
  const [visible, setVisible] = useState(0);
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timer: number;
    let count = 0;
    const tick = () => {
      setVisible(++count);
      if (count < length) timer = window.setTimeout(tick, 35);
    };
    const finish = () => {
      if (media.matches) {
        window.clearTimeout(timer);
        setVisible(length);
      }
    };
    setVisible(media.matches ? length : 0);
    if (!media.matches && length) timer = window.setTimeout(tick, 35);
    media.addEventListener('change', finish);
    return () => {
      window.clearTimeout(timer);
      media.removeEventListener('change', finish);
    };
  }, [linesKey, length]);
  return visible;
}

export function AnomaStage({ portraitFocus = false, inactive = false, children }: { portraitFocus?: boolean; inactive?: boolean; children?: ReactNode }) {
  const { lines, expression, reaction } = useContext(StageContext);
  const linesKey = JSON.stringify(lines ?? []);
  const characters = (lines ?? []).map(line => Array.from(line));
  const length = characters.reduce((sum, line) => sum + line.length, 0);
  const visible = useTypedLength(linesKey, length);
  const speaking = visible < length;
  let remaining = visible;
  return <div inert={inactive} className="anoma-stage" data-expression={expression} data-reaction={reaction ?? 'normal'}>
    <header className="page-margin">
      <aside className="anoma-photo" data-focus={portraitFocus || Boolean(reaction && speaking) ? 'portrait' : 'table'} aria-label="アノマ">
        <AnomaPortrait key={expression} expression={expression} speaking={speaking} />
      </aside>
      <div className="anoma-dialogue" hidden={!length} aria-live="polite">
        <span className="speaker-name">アノマ</span>
        <span className="sr-only">{lines?.join('\n')}</span>
        <div key={linesKey} className="dialogue-lines" ref={retainExit} aria-hidden="true">{characters.map((line, index) => {
          const prefix = line.slice(0, remaining).join('');
          remaining = Math.max(0, remaining - line.length);
          return <p key={index}>{prefix}</p>;
        })}</div></div>
    </header>
    {children}
  </div>;
}

type OpeningPhase = 'blackout' | 'narration' | 'arrival' | 'dialogue' | 'docking' | 'waiting';

export function Opening({ busy, error, onDark, onComplete }: {
  busy: boolean; error?: string; onDark: () => void; onComplete: () => void;
}) {
  const [phase, setPhase] = useState<OpeningPhase>('blackout');
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const callbacks = useRef({ onDark, onComplete });
  useLayoutEffect(() => { callbacks.current = { onDark, onComplete }; }, [onDark, onComplete]);
  const [lines] = useState(() => [openingGreetings[Math.floor(Math.random() * openingGreetings.length)], ...scenario.opening, openingClosings[Math.floor(Math.random() * openingClosings.length)]]);
  const line = phase === 'dialogue' ? lines[index] : '';
  const chars = Array.from(line);
  const visible = useTypedLength(line, chars.length);
  const speaking = !revealed && visible < chars.length;

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let timer: number;
    if (phase === 'blackout') {
      timer = window.setTimeout(() => {
        callbacks.current.onDark();
        setCount(1);
        setPhase('narration');
      }, reduced ? 120 : 650);
    } else if (phase === 'arrival') {
      timer = window.setTimeout(() => setPhase('dialogue'), reduced ? 140 : 950);
    } else if (phase === 'docking') {
      timer = window.setTimeout(() => {
        setPhase('waiting');
        callbacks.current.onComplete();
      }, reduced ? 140 : 850);
    }
    return () => window.clearTimeout(timer);
  }, [phase]);

  function advance() {
    if (speaking) setRevealed(true);
    else if (index === lines.length - 1) setPhase('docking');
    else { setIndex(index + 1); setRevealed(false); }
  }
  function skip() {
    setPhase('waiting');
    onComplete();
  }
  return <main className="opening-screen" data-phase={phase}>
    {phase === 'narration' && <button className="opening-advance" aria-label="地の文を送る" onClick={() => {
      if (count < openingNarration.length) setCount(count + 1);
      else setPhase('arrival');
    }} />}
    {phase === 'narration' && <div className="opening-narration" aria-live="polite">
      {openingNarration.slice(0, count).map(line => <p key={line}>{line}</p>)}
    </div>}
    {phase !== 'blackout' && phase !== 'narration' && <aside className="opening-portrait" aria-label="アノマ">
      <AnomaPortrait expression={storyExpressions.opening} speaking={speaking} />
    </aside>}
    {phase === 'dialogue' && <button className="opening-dialogue" autoFocus onClick={advance}>
      <span className="sr-only" aria-live="polite">{line}</span>
      <span aria-hidden="true">{speaking ? chars.slice(0, visible).join('') : line}</span>
      <small aria-hidden="true">▼</small>
    </button>}
    {phase === 'waiting' && <p className="opening-status" role="status">
      {busy ? '物語をめくっています…' : error}
    </p>}
    <button className="opening-skip" disabled={busy} onClick={skip}>
      {phase === 'waiting' && error && !busy ? '再試行' : 'スキップ'}
    </button>
  </main>;
}

export function resultReaction(transactions: Transaction[]) {
  // Reconstruct from confirmed rounds, so rerenders and retries select the same line.
  let previous: string | undefined;
  let result: { line: string; reaction: ReactionKind; expression: AnomaExpression } | undefined;
  const committed = transactions.filter(tx => tx.status === 'committed');
  for (let i = 0; i < committed.length; i++) {
    const trigger = reactionTrigger(committed.slice(0, i + 1));
    if (!trigger) continue;
    const seed = Array.from(committed[i].id).reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 0);
    previous = chooseLine(scenario[trigger], previous, () => seed / 4294967296);
    result = { line: previous, reaction: reactionKinds[trigger], expression: expressionForTrigger(trigger, committed[i]) };
  }
  return result;
}
