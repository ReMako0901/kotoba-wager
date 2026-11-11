import { useEffect, useState, type CSSProperties } from 'react';
import type { Transaction } from './types';

export function InkCells({ text, scatter }: {text: string; scatter?: Set<number>}) {
  return Array.from(text).map((glyph, index) => {
    if (glyph === '\n') return <br key={index} />;
    const motion = scatter?.has(index);
    const style = motion ? {
      '--drift-x': ((index * 23 % 67) - 33) + 'px',
      '--drift-y': (30 + index * 17 % 62) + 'px',
      '--spin': ((index * 29 % 100) - 50) + 'deg',
      '--delay': (index % 7 * 28) + 'ms',
    } as CSSProperties : undefined;
    return <span key={index} className={motion ? 'ink-cell scattering' : 'ink-cell'} style={style}>
      <span className="ink-glyph">{glyph}</span>{motion && <i className="ink-dust" />}
    </span>;
  });
}

export function LossManuscript({ transaction, text }: {transaction: Transaction; text: string}) {
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const scatter = new Set<number>();
  for (const unit of transaction.selected_units ?? []) {
    for (let i = unit.start; i < unit.end; i++) scatter.add(i);
  }
  if (!scatter.size) {
    for (const stake of transaction.stakes) {
      const offset = transaction.before.indexOf(stake);
      if (offset < 0) continue;
      const start = Array.from(transaction.before.slice(0, offset)).length;
      for (let i = start; i < start + Array.from(stake).length; i++) scatter.add(i);
    }
  }
  useEffect(() => {
    if (!playing) return;
    const stop = window.setTimeout(() => setPlaying(false), 1080);
    return () => window.clearTimeout(stop);
  }, [playing]);

  return <>
    <p className="sr-only">{text}</p>
    <p className="manuscript prose" aria-hidden="true">
      <InkCells text={playing ? transaction.before : text} scatter={playing ? scatter : undefined} />
    </p>
    {playing && <button type="button" className="text-button" onClick={() => setPlaying(false)}>演出をスキップ</button>}
  </>;
}
