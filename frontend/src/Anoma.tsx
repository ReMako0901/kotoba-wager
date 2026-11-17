import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import type { Transaction } from './types';
import { chooseLine, openingNarration, reactionKinds, reactionTrigger, scenario, expressionForTrigger, storyExpressions, type AnomaExpression, type ReactionKind } from './scenario';
import './anoma.css';

// Presentation memory only: no session storage or game state changes.
let previousExpression: AnomaExpression | undefined;
const unavailableClosedExpressions = new Set<AnomaExpression>();
function AnomaPortrait({ expression }: { expression: AnomaExpression }) {
  const [previous, setPrevious] = useState(() => previousExpression);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [settled, setSettled] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [closedFailed, setClosedFailed] = useState(() => unavailableClosedExpressions.has(expression));
  const [closedLoaded, setClosedLoaded] = useState(false);
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

export function AnomaStage() {
  const { lines, expression, reaction } = useContext(StageContext);
  return <aside className="anoma-stage" aria-label="アノマ" data-expression={expression} data-reaction={reaction ?? 'normal'}>
    <div className="anoma-portrait-tile"><AnomaPortrait key={expression} expression={expression} /></div>
    <div className="anoma-stage-content"><span className="anoma-name">アノマ</span>
      <div className="anoma-dialogue">{lines?.map((line, index) => <p key={index}>{line}</p>)}</div>
    </div>
  </aside>;
}

export function Opening({ busy, onComplete }: { busy: boolean; onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const last = index === scenario.opening.length - 1;
  return <main className="opening-screen">
    <div className="opening-narration">{openingNarration.map(line => <p key={line}>{line}</p>)}</div>
    <StagePublisher lines={[scenario.opening[index]]} expression={storyExpressions.opening} />
    <button className="primary" disabled={busy} onClick={() => last ? onComplete() : setIndex(index + 1)}>{last ? '物語を選ぶ' : '次へ'}</button>
    <button className="secondary" disabled={busy} onClick={onComplete}>スキップ</button>
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
    result = { line: previous, reaction: reactionKinds[trigger], expression: expressionForTrigger[trigger] };
  }
  return result;
}
