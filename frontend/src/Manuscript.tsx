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
  mask.width = mask.height = 54;
  const sample = mask.getContext('2d', {willReadFrequently: true});
  if (!ctx || !sample) {
    complete();
    return () => {};
  }
  const bounds = frame.getBoundingClientRect();
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(bounds.width * scale);
  canvas.height = Math.round(bounds.height * scale);
  ctx.scale(scale, scale);
  const particles = [...frame.querySelectorAll<HTMLElement>('.marked .ink-glyph')].flatMap((glyph, index) => {
    const rect = glyph.parentElement!.getBoundingClientRect();
    const font = getComputedStyle(glyph);
    sample.clearRect(0, 0, 54, 54);
    sample.font = `${font.fontWeight} ${parseFloat(font.fontSize) * 2}px ${font.fontFamily}`;
    sample.textAlign = 'center';
    sample.textBaseline = 'middle';
    sample.fillText(glyph.textContent ?? '', 27, 27);
    const alpha = sample.getImageData(0, 0, 54, 54).data;
    const grains = [];
    for (let y = 1; y < 54; y += 2) {
      for (let x = 1; x < 54; x += 2) {
        const opacity = alpha[(y * 54 + x) * 4 + 3] / 255;
        if (opacity < .28) continue;
        grains.push({
          x: rect.left - bounds.left + rect.width / 2 + (x - 27) / 2,
          y: rect.top - bounds.top + rect.height / 2 + (y - 27) / 2,
          opacity, delay: Math.min(index, 5) * 95 + Math.random() * 190,
          dx: -6 - Math.random() * 26, dy: 7 + Math.random() * 28,
          duration: 500 + Math.random() * 440,
        });
      }
    }
    return grains;
  });
  frame.classList.add('ink-dissolving');
  const started = performance.now();
  let request = 0;
  let pause = 0;
  function draw(now: number) {
    ctx!.clearRect(0, 0, bounds.width, bounds.height);
    let moving = false;
    for (const grain of particles) {
      const t = Math.max(0, (now - started - grain.delay) / grain.duration);
      if (t >= 1) continue;
      moving = true;
      ctx!.fillStyle = `rgba(76,43,40,${grain.opacity * (1 - t) ** 1.6})`;
      const size = 1.05 - .57 * t;
      ctx!.fillRect(grain.x + grain.dx * t, grain.y + grain.dy * t * t, size, size);
    }
    if (moving) request = requestAnimationFrame(draw);
    else pause = window.setTimeout(complete, 430);
  }
  request = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(request);
    window.clearTimeout(pause);
    frame.classList.remove('ink-dissolving');
  };
}

export function LossManuscript({ transaction, text }: {transaction: Transaction; text: string}) {
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
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
    if (!playing || !frame.current || !canvas.current) return;
    return animateInk(canvas.current, frame.current, () => setPlaying(false));
  }, [playing]);

  return <>
    <p className="sr-only">{text}</p>
    <div className="paper-frame" ref={frame}>
      <Paper text={playing ? transaction.before : text} marked={playing ? marked : undefined} />
      {playing && <canvas className="ink-overlay" ref={canvas} aria-hidden="true" />}
    </div>
    {playing && <button type="button" className="text-button" onClick={() => setPlaying(false)}>演出をスキップ</button>}
  </>;
}
