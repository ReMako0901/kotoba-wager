import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Transaction, Unit } from './types';
import { manuscriptChanges } from './manuscriptChanges';

// CSS owns the geometry; the fallback also permits non-DOM rendering.
export function paperRows() {
  return typeof getComputedStyle === 'undefined' ? 10
    : Number(getComputedStyle(document.documentElement).getPropertyValue('--paper-rows'));
}

export function paperPositions(text: string, rows = paperRows()) {
  const positions = new Map<number, number>();
  let square = 0;
  Array.from(text).forEach((glyph, offset) => {
    // Newlines separate paragraphs semantically, without leaving unused squares.
    if (glyph !== '\n' && glyph !== '\r') positions.set(offset, square++);
  });
  return { positions, columns: Math.max(8, Math.ceil(square / rows)) };
}

export function focusFirstChange(paper: HTMLElement) {
  const scroll = paper.parentElement;
  const first = paper.querySelector<HTMLElement>('.result-change');
  if (!scroll || !first) return;
  const viewport = scroll.getBoundingClientRect();
  const bounds = first.getBoundingClientRect();
  // Center the first change even when a later change is already visible.
  // Relative coordinates work with the negative scrollLeft of RTL containers.
  scroll.scrollLeft += (bounds.left + bounds.right - viewport.left - viewport.right) / 2;
}

function Paper({text, units, selected, disabled, onToggle, marked, changes}: {
  text: string;
  units?: Unit[];
  selected?: string[];
  disabled?: boolean;
  onToggle?: (id: string) => void;
  marked?: Set<number>;
  changes?: ReturnType<typeof manuscriptChanges>;
}) {
  const paper = useRef<HTMLDivElement>(null);
  const rows = paperRows();
  useLayoutEffect(() => {
    if (changes?.size && paper.current) focusFirstChange(paper.current);
  }, [changes, text]);
  const runs = units ?? [{id: 'text', text, stakeable: false}];
  const content = [];
  const allGlyphs = Array.from(text);
  const { positions, columns } = paperPositions(text, rows);
  const occupied = new Set<number>();
  let offset = 0;
  for (const run of runs) {
    const glyphs = Array.from(run.text);
    let firstFragment = true;
    let index = 0;
    while (index < glyphs.length) {
      const source = offset + index;
      const square = positions.get(source);
      if (square === undefined || occupied.has(square)) { index++; continue; }
      const row = square % rows;
      let length = 0;
      const cells = [];
      while (index + length < glyphs.length && row + cells.length < rows &&
        positions.get(source + length) === square + cells.length) {
        const cell = square + cells.length;
        const first = source + length++;
        let end = first + 1;
        while (positions.get(end) === cell) end++;
        length += Math.min(end - first - 1, glyphs.length - index - length);
        const characters = allGlyphs.slice(first, end);
        const isMarked = characters.some((_, i) => marked?.has(first + i));
        occupied.add(cell);
        cells.push(<span key={cell} className={`ink-cell${isMarked ? ' marked' : ''}`}>
          {characters.map((glyph, i) => {
            const offset = first + i;
            const change = changes?.get(offset);
            const classes = ['ink-glyph', marked?.has(offset) && 'marked-glyph', change && `result-change ${change}`];
            return <span key={i} className={classes.filter(Boolean).join(' ')}>{glyph}</span>;
          })}
        </span>);
      }
      const position = {gridRow: `${row + 1} / span ${cells.length}`, gridColumn: Math.floor(square / rows) + 1};
      content.push(run.stakeable ? (
        <button className="vertical-word" key={source} type="button" style={position}
          aria-label={run.text} aria-pressed={selected?.includes(run.id)}
          tabIndex={firstFragment ? 0 : -1} disabled={disabled}
          onClick={() => onToggle?.(run.id)}>{cells}</button>
      ) : (
        <span className="vertical-run" key={source} style={position}>{cells}</span>
      ));
      firstFragment = false;
      index += length;
    }
    offset += glyphs.length;
  }
  for (let i = 0; i < columns * rows; i++) {
    if (occupied.has(i)) continue;
    content.push(<span className="ink-cell" key={`blank-${i}`} aria-hidden="true"
      style={{gridRow: i % rows + 1, gridColumn: Math.floor(i / rows) + 1}} />);
  }
  return <div className="paper-scroll" aria-hidden={units ? undefined : true}>
    <div className="vertical-paper" ref={paper}>{content}</div>
  </div>;
}

export function Manuscript({text, before}: {text: string; before?: string}) {
  const changes = useMemo(() => before === undefined ? undefined : manuscriptChanges(before, text), [before, text]);
  return <><p className="sr-only">{text}</p><Paper text={text} changes={changes} /></>;
}

export function WagerManuscript(props: {
  text: string; units: Unit[]; selected: string[]; disabled: boolean; onToggle: (id: string) => void;
}) {
  return <Paper {...props} />;
}

function animateInk(frame: HTMLElement, complete: () => void) {
  const scroll = frame.querySelector<HTMLElement>('.paper-scroll');
  const photo = frame.closest('.anoma-stage')?.querySelector('.anoma-photo');
  const marks = [...frame.querySelectorAll<HTMLElement>('.marked-glyph')];
  if (!scroll || !photo || !marks.length) { complete(); return; }

  const viewport = scroll.getBoundingClientRect();
  const visible = (rect: DOMRect) => rect.right > viewport.left && rect.left < viewport.right;
  if (!marks.some(mark => visible(mark.getBoundingClientRect()))) {
    const first = marks[0].getBoundingClientRect();
    scroll.scrollLeft += (first.left + first.right - viewport.left - viewport.right) / 2;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const layer = document.createElement('div');
  layer.className = 'loss-fragments';
  layer.setAttribute('aria-hidden', 'true');
  layer.inert = true;
  const target = photo.getBoundingClientRect();
  for (const glyph of marks) {
    const rect = glyph.getBoundingClientRect();
    if (!visible(rect)) continue;
    const font = getComputedStyle(glyph);
    // Clip copies of the actual glyph so the pieces begin as its ink strokes.
    const divisions = reduced ? 1 : 3;
    for (let row = 0; row < divisions; row++) {
      for (let col = 0; col < divisions; col++) {
        const piece = document.createElement('span');
        piece.className = 'ink-glyph';
        piece.textContent = glyph.textContent;
        Object.assign(piece.style, {
          left: rect.left + 'px', top: rect.top + 'px', font: font.font,
          width: rect.width + 'px', height: rect.height + 'px',
          clipPath: `inset(${row * 100 / divisions}% ${(divisions-col-1) * 100 / divisions}% ${(divisions-row-1) * 100 / divisions}% ${col * 100 / divisions}%)`,
        });
        piece.style.setProperty('--burst-x', ((col - 1) * 9) + 'px');
        piece.style.setProperty('--burst-y', ((row - 1) * 9) + 'px');
        piece.style.setProperty('--flight-x', (target.left + target.width / 2 - rect.left - rect.width / 2) + 'px');
        piece.style.setProperty('--flight-y', (target.top + target.height / 2 - rect.top - rect.height / 2) + 'px');
        layer.append(piece);
      }
    }
  }
  if (!layer.childElementCount) { complete(); return; }
  frame.classList.add('shedding-ink');
  document.body.append(layer);
  layer.lastElementChild!.addEventListener('animationend', complete, { once: true });
  return () => {
    frame.classList.remove('shedding-ink');
    layer.remove();
  };
}

export function LossManuscript({ transaction, text, highlight = false }: {transaction: Transaction; text: string; highlight?: boolean}) {
  const [playing, setPlaying] = useState(() => !highlight);
  const changes = useMemo(() => manuscriptChanges(transaction.before, text), [transaction.before, text]);
  const frame = useRef<HTMLDivElement>(null);
  const marked = new Set<number>();
  for (const unit of transaction.selected_units ?? []) {
    for (let i = unit.start; i < unit.end; i++) marked.add(i);
  }
  if (!marked.size) {
    for (const stake of transaction.stakes) {
      const offset = transaction.before.indexOf(stake);
      if (offset < 0) continue;
      const start = Array.from(transaction.before.slice(0, offset)).length;
      for (let i = start; i < start + Array.from(stake).length; i++) marked.add(i);
    }
  }
  useEffect(() => {
    if (highlight) { setPlaying(false); return; }
    if (!playing) return;
    let stop: (() => void) | undefined;
    const preview = window.setTimeout(() => {
      if (frame.current) stop = animateInk(frame.current, () => setPlaying(false));
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 430);
    return () => {
      window.clearTimeout(preview);
      stop?.();
    };
  }, [playing, highlight, transaction.id]);

  return <>
    <p className="sr-only">{text}</p>
    <div className="paper-frame" ref={frame}>
      <Paper text={playing ? transaction.before : text} marked={playing ? marked : undefined}
        changes={playing ? undefined : changes} />
    </div>
  </>;
}
