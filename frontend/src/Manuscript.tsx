import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Transaction, Unit } from './types';
import { addPaperDust, PaperDust } from './PaperDust';
import type { Dust, DustProps } from './PaperDust';

const MAX_ROWS = 9;
const noColumnStart = /^[、。，．！？!?：；・…‥ー〜～々〻ゝゞヽヾぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ」』）〕］｝〉》】〗〙〛’”)]/u;
const punctuation = /^[、。，．]$/u;
const closingQuote = /^[」』]$/u;
const smallKana = /^[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]$/u;
const noColumnEnd = /^[「『（〔［｛〈《【〖〘〚‘“(]/u;
const dialogueStart = /^[「『]/u;

function paperPositions(text: string, rows: number, runStarts: Set<number>) {
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
        const full = Math.min(start + rows - row, glyphs.length);
        const next = glyphs[full] ?? '';
        const canTuck = punctuation.test(next) || (smallKana.test(next) && !runStarts.has(offset + full));
        const tuckedMarks = punctuation.test(next) && closingQuote.test(glyphs[full + 1] ?? '') ? 2 : 1;
        const tucked = full > start && canTuck && !noColumnEnd.test(glyphs[full - 1]) &&
          !noColumnStart.test(glyphs[full + tuckedMarks] ?? '') ? tuckedMarks : 0;
        let end = full;
        if (!tucked) {
          while (end > start && end < glyphs.length &&
            (noColumnStart.test(glyphs[end]) || noColumnEnd.test(glyphs[end - 1]))) end--;
          if (end === start) end = full;
        }
        for (let i = start; i < end; i++) positions.set(offset + i, column * rows + row + i - start);
        for (let i = 0; i < tucked; i++) positions.set(offset + end + i, column * rows + rows - 1);
        start = end + tucked;
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

function Paper({text, units, selected, disabled, onToggle, marked, dust, losses}: {
  text: string;
  units?: Unit[];
  selected?: string[];
  disabled?: boolean;
  onToggle?: (id: string) => void;
  marked?: Set<number>;
} & DustProps) {
  const paper = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(MAX_ROWS);
  useLayoutEffect(() => {
    const board = paper.current?.closest('.story-board');
    if (!board) return;
    function fit(height: number) {
      setRows(Math.max(1, Math.min(MAX_ROWS, Math.floor((height - 12) / 22))));
    }
    const style = getComputedStyle(board);
    fit(board.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    const observer = new ResizeObserver(([entry]) => fit(entry.contentRect.height));
    observer.observe(board);
    return () => observer.disconnect();
  }, []);
  const runs = units ?? [{id: 'text', text, stakeable: false}];
  const content = [];
  const allGlyphs = Array.from(text);
  const runStarts = new Set<number>();
  let runOffset = 0;
  for (const run of runs) {
    runStarts.add(runOffset);
    runOffset += Array.from(run.text).length;
  }
  const { positions, columns } = paperPositions(text, rows, runStarts);
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
        const packed = characters.length === 1 ? '' : punctuation.test(characters[1]) ? ' packed-punctuation' : ' packed-kana';
        occupied.add(cell);
        cells.push(<span key={cell} className={`ink-cell${isMarked ? ' marked' : ''}${packed}`}>
          {characters.map((glyph, i) => <span key={i} className={marked?.has(first + i) ? 'ink-glyph marked-glyph' : 'ink-glyph'}>{glyph}</span>)}
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
    <div className="vertical-paper" ref={paper} style={{'--paper-rows': rows} as CSSProperties}>{content}<PaperDust dust={dust} losses={losses} /></div>
  </div>;
}

export function Manuscript({text, ...dustProps}: {text: string} & DustProps) {
  return <><p className="sr-only">{text}</p><Paper text={text} {...dustProps} /></>;
}

export function WagerManuscript(props: {
  text: string; units: Unit[]; selected: string[]; disabled: boolean; onToggle: (id: string) => void;
} & DustProps) {
  return <Paper {...props} />;
}

function animateInk(canvas: HTMLCanvasElement, frame: HTMLElement, dust: Dust, id: string, complete: () => void) {
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
  const floor = paperBounds.bottom - bounds.top - 3;
  const left = Math.max(viewport.left, paperBounds.left) - bounds.left;
  const right = Math.min(viewport.right, paperBounds.right) - bounds.left;
  const scale = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(bounds.width * scale);
  canvas.height = Math.round(bounds.height * scale);
  ctx.scale(scale, scale);

  const groups = marks.map((cell, index) => {
    const rect = cell.getBoundingClientRect();
    sample.clearRect(0, 0, 64, 64);
    sample.textAlign = 'center';
    sample.textBaseline = 'middle';
    for (const glyph of cell.querySelectorAll('.marked-glyph')) {
      const font = getComputedStyle(glyph);
      const glyphBounds = glyph.getBoundingClientRect();
      const dy = glyphBounds.top + glyphBounds.height / 2 - rect.top - rect.height / 2;
      sample.font = `${font.fontWeight} ${Math.min(56, parseFloat(font.fontSize) * 2)}px ${font.fontFamily}`;
      sample.fillText(glyph.textContent ?? '', 32, 32 + dy * 2);
    }
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
    else pause = window.setTimeout(() => {
      const landing = groups.flatMap(({grains}) => grains.filter((_, index) => index % 3 === 0).map(grain => ({
        x: (bounds.left + grain.x + grain.dx - paperBounds.left) / paperBounds.width,
        y: (bounds.top + grain.targetY - paperBounds.top) / paperBounds.height,
        size: grain.size,
        opacity: grain.opacity * .55,
      })));
      addPaperDust(dust, id, landing);
      complete();
    }, 220);
  }
  request = requestAnimationFrame(draw);
  return () => {
    cancelAnimationFrame(request);
    window.clearTimeout(pause);
    groups.forEach(({cell}) => cell.classList.remove('crumbled'));
  };
}

export function LossManuscript({ transaction, text, dust, losses }: {transaction: Transaction; text: string} & DustProps) {
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const previousLosses = useMemo(() => losses.filter(loss => loss.id !== transaction.id), [losses, transaction.id]);
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
        stop = animateInk(canvas.current, frame.current, dust, transaction.id, () => setPlaying(false));
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
  }, [playing, dust, transaction.id]);

  return <>
    <p className="sr-only">{text}</p>
    <div className="paper-frame" ref={frame}>
      <Paper text={playing ? transaction.before : text} marked={playing ? marked : undefined}
        dust={dust} losses={playing ? previousLosses : losses} />
      {playing && <canvas className="ink-overlay" ref={canvas} aria-hidden="true" />}
    </div>
  </>;
}
