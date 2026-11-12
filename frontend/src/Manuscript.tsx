import { useEffect, useRef, useState } from 'react';
import type { Transaction, Unit } from './types';

const ROWS = 9;
const noColumnStart = /^[、。，．！？!?：；・…‥ー〜～々〻ゝゞヽヾぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ」』）〕］｝〉》】〗〙〛’”)]/u;
const noColumnEnd = /^[「『（〔［｛〈《【〖〘〚‘“(]/u;
const dialogueStart = /^[「『]/u;

function paperPositions(text: string) {
  const positions = new Map<number, number>();
  let offset = 0;
  let column = 0;
  for (const paragraph of text.split('\n')) {
    const glyphs = Array.from(paragraph);
    const first = glyphs.findIndex(glyph => !/^[ \t　]$/.test(glyph));
    if (first >= 0) {
      let start = first;
      let row = dialogueStart.test(glyphs[first]) ? 0 : 1;
      while (start < glyphs.length) {
        const full = Math.min(start + ROWS - row, glyphs.length);
        let end = full;
        while (end > start && end < glyphs.length &&
          (noColumnStart.test(glyphs[end]) || noColumnEnd.test(glyphs[end - 1]))) end--;
        if (end === start) end = full;
        for (let i = start; i < end; i++) positions.set(offset + i, column * ROWS + row + i - start);
        start = end;
        row = 0;
        column++;
      }
    } else if (offset > 0) {
      column++;
    }
    offset += glyphs.length + 1;
  }
  return { positions, columns: Math.max(8, column) };
}

function Paper({text, units, selected, disabled, onToggle, marked}: {
  text: string;
  units?: Unit[];
  selected?: string[];
  disabled?: boolean;
  onToggle?: (id: string) => void;
  marked?: Set<number>;
}) {
  const runs = units ?? [{id: 'text', text, stakeable: false}];
  const content = [];
  const { positions, columns } = paperPositions(text);
  const occupied = new Set<number>();
  let offset = 0;
  for (const run of runs) {
    const glyphs = Array.from(run.text);
    let firstFragment = true;
    let index = 0;
    while (index < glyphs.length) {
      const source = offset + index;
      const square = positions.get(source);
      if (square === undefined) { index++; continue; }
      const row = square % ROWS;
      let length = 1;
      while (index + length < glyphs.length && row + length < ROWS &&
        positions.get(source + length) === square + length) length++;
      const cells = glyphs.slice(index, index + length).map((glyph, i) => {
        occupied.add(square + i);
        return <span key={i} className={marked?.has(source + i) ? 'ink-cell marked' : 'ink-cell'}>
          <span className="ink-glyph">{glyph}</span>
        </span>;
      });
      const position = {gridRow: `${row + 1} / span ${length}`, gridColumn: Math.floor(square / ROWS) + 1};
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
  for (let i = 0; i < columns * ROWS; i++) {
    if (occupied.has(i)) continue;
    content.push(<span className="ink-cell" key={`blank-${i}`} aria-hidden="true"
      style={{gridRow: i % ROWS + 1, gridColumn: Math.floor(i / ROWS) + 1}} />);
  }
  return <div className="paper-scroll" aria-hidden={units ? undefined : true}>
    <div className="vertical-paper">{content}</div>
  </div>;
}

export function Manuscript({text}: {text: string}) {
  return <><p className="sr-only">{text}</p><Paper text={text} /></>;
}

export function WagerManuscript(props: {
  text: string; units: Unit[]; selected: string[]; disabled: boolean; onToggle: (id: string) => void;
}) {
  return <Paper {...props} />;
}

function animateInk(canvas: HTMLCanvasElement, frame: HTMLElement, complete: () => void) {
  const ctx = canvas.getContext('2d');
  const mask = document.createElement('canvas');
  mask.width = mask.height = 64;
  const sample = mask.getContext('2d', {willReadFrequently: true});
  const paper = frame.querySelector<HTMLElement>('.vertical-paper');
  const scroll = frame.querySelector<HTMLElement>('.paper-scroll');
  const marks = [...frame.querySelectorAll<HTMLElement>('.marked')];
  if (!ctx || !sample || !paper || !scroll || !marks.length) {
    complete();
    return () => {};
  }

  const viewport = scroll.getBoundingClientRect();
  const visible = (cell: HTMLElement) => {
    const rect = cell.getBoundingClientRect();
    return rect.right > viewport.left && rect.left < viewport.right;
  };
  if (!marks.some(visible)) {
    const rect = marks[0].getBoundingClientRect();
    scroll.scrollLeft += rect.left - viewport.left - (viewport.width - rect.width) / 2;
  }

  const bounds = frame.getBoundingClientRect();
  const paperBounds = paper.getBoundingClientRect();
  const floor = paperBounds.bottom - bounds.top + 21;
  const left = Math.max(viewport.left, paperBounds.left) - bounds.left;
  const right = Math.min(viewport.right, paperBounds.right) - bounds.left;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(bounds.width * scale);
  canvas.height = Math.round(bounds.height * scale);
  ctx.scale(scale, scale);

  const groups = marks.map((cell, index) => {
    const glyph = cell.firstElementChild!;
    const rect = cell.getBoundingClientRect();
    const font = getComputedStyle(glyph);
    sample.clearRect(0, 0, 64, 64);
    sample.font = `${font.fontWeight} ${Math.min(56, parseFloat(font.fontSize) * 2)}px ${font.fontFamily}`;
    sample.textAlign = 'center';
    sample.textBaseline = 'middle';
    sample.fillText(glyph.textContent ?? '', 32, 32);
    const alpha = sample.getImageData(0, 0, 64, 64).data;
    const points: { x: number; y: number; opacity: number }[] = [];
    for (let y = 1; y < 64; y += 2) {
      for (let x = 1; x < 64; x += 2) {
        const opacity = alpha[(y * 64 + x) * 4 + 3] / 255;
        if (opacity > .27) points.push({ x: (x - 32) / 2, y: (y - 32) / 2, opacity });
      }
    }
    // Some fonts provide no drawable outline for a glyph. The cell still sheds ink.
    if (!points.length) {
      for (let i = 0; i < 36; i++) points.push({x: (Math.random() - .5) * 15, y: (Math.random() - .5) * 15, opacity: .8});
    }
    const delay = Math.min(index, 7) * 52;
    const grains = visible(cell) ? points.map(point => {
      const x = rect.left - bounds.left + rect.width / 2 + point.x;
      const y = rect.top - bounds.top + rect.height / 2 + point.y;
      const drift = (Math.random() - .5) * 42;
      return {
        x, y, opacity: point.opacity, dx: Math.max(left, Math.min(right - 1, x + drift)) - x,
        targetY: floor - 10 * (1 - Math.abs(drift) / 21) * Math.random() ** 2,
        delay: delay + Math.random() * 115,
        duration: 550 + Math.sqrt(Math.max(0, floor - y)) * 35 + Math.random() * 230,
        size: .65 + Math.random() * .9,
      };
    }) : [];
    return {cell, delay, grains};
  });

  const started = performance.now();
  let request = 0;
  let pause = 0;
  function draw(now: number) {
    const elapsed = now - started;
    ctx!.clearRect(0, 0, bounds.width, bounds.height);
    let moving = false;
    for (const {cell, delay, grains} of groups) {
      if (elapsed >= delay) cell.classList.add('crumbled');
      for (const grain of grains) {
        const t = Math.min(1, (elapsed - grain.delay) / grain.duration);
        if (t < 1) moving = true;
        if (t < 0) continue;
        const x = grain.x + grain.dx * t + Math.sin(t * 7) * 4 * (1 - t);
        const y = grain.y + (grain.targetY - grain.y) * t ** 1.65;
        ctx!.fillStyle = `rgba(52,38,35,${grain.opacity * (.85 - .3 * t)})`;
        ctx!.fillRect(x, y, grain.size, grain.size);
      }
    }
    if (moving) request = requestAnimationFrame(draw);
    else pause = window.setTimeout(complete, 440);
  }
  request = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(request);
    window.clearTimeout(pause);
    groups.forEach(({cell}) => cell.classList.remove('crumbled'));
  };
}

export function LossManuscript({ transaction, text }: {transaction: Transaction; text: string}) {
  const [phase, setPhase] = useState<'falling' | 'settled' | 'skipped'>(() =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'skipped' : 'falling');
  const playing = phase === 'falling';
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
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
    if (!playing) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    let fallback = 0;
    const preview = window.setTimeout(() => {
      function start() {
        if (cancelled || stop || !frame.current || !canvas.current) return;
        window.clearTimeout(fallback);
        stop = animateInk(canvas.current, frame.current, () => setPhase('settled'));
      }
      fallback = window.setTimeout(start, 400);
      void document.fonts.ready.then(start, start);
    }, 240);
    return () => {
      cancelled = true;
      window.clearTimeout(preview);
      window.clearTimeout(fallback);
      stop?.();
    };
  }, [playing]);

  return <>
    <p className="sr-only">{text}</p>
    <div className="paper-frame" ref={frame}>
      <Paper text={playing ? transaction.before : text} marked={playing ? marked : undefined} />
      {phase !== 'skipped' && <canvas className="ink-overlay" ref={canvas} aria-hidden="true" />}
    </div>
    {playing && <button type="button" className="text-button" onClick={() => setPhase('skipped')}>演出をスキップ</button>}
  </>;
}
