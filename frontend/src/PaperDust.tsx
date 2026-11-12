import { useEffect, useMemo, useRef } from 'react';
import type { Transaction } from './types';

type Grain = { x: number; y: number; size: number; opacity: number };
export type Dust = { grains: Map<string, Grain[]> };

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function usePaperDust(sessionId?: string) {
  return useMemo<Dust>(() => ({ grains: new Map() }), [sessionId]);
}

export function sampleDustSize() {
  return .48 + Math.random() * .57;
}

export function addPaperDust(dust: Dust, id: string, landing: Grain[]) {
  if (landing.length) dust.grains.set(id, landing);
}

function fallbackDust(loss: Transaction) {
  const count = Math.min(160, Math.max(24, loss.stakes.join('').length * 12));
  const center = .12 + Math.random() * .76;
  return Array.from({ length: count }, () => ({
    x: clamp(center + (Math.random() - .5) * .16, .002, .998),
    y: .997 - Math.random() ** 2 * .022,
    size: sampleDustSize(), opacity: .25 + Math.random() * .48,
  }));
}

const grainSpacing = 1.5;

function reserveGrain(
  occupied: Uint8Array, cursors: Uint16Array, columns: number, rows: number,
  x: number, y: number,
) {
  const column = clamp(Math.floor(x / grainSpacing), 0, columns - 1);
  const row = clamp(Math.floor(y / grainSpacing), 0, rows - 1);
  const initial = row * columns + column;
  if (!occupied[initial]) {
    occupied[initial] = 1;
    return;
  }
  // Previously scanned slots stay occupied for the rest of this frame.
  const limit = Math.min(columns + rows, 96) ** 2;
  for (let cursor = cursors[initial] || 1; cursor < limit; cursor++) {
    const distance = Math.floor(Math.sqrt(cursor));
    const lateral = cursor - distance * distance - distance;
    const nextColumn = column + lateral;
    const nextRow = row - (distance - Math.abs(lateral));
    if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
    const slot = nextRow * columns + nextColumn;
    if (occupied[slot]) continue;
    occupied[slot] = 1;
    cursors[initial] = cursor + 1;
    return { x: (nextColumn + .15) * grainSpacing, y: (nextRow + .15) * grainSpacing };
  }
  cursors[initial] = limit;
}

export type DustProps = { dust: Dust; losses: Transaction[] };

export function PaperDust({ dust, losses }: DustProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !losses.length) return;
    for (const loss of losses) {
      if (!dust.grains.has(loss.id)) dust.grains.set(loss.id, fallbackDust(loss));
    }
    const grains = losses.flatMap(loss => dust.grains.get(loss.id)!);
    const paint = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const columns = Math.max(1, Math.floor(width / grainSpacing));
      const rows = Math.max(1, Math.floor(height / grainSpacing));
      const occupied = new Uint8Array(columns * rows);
      const cursors = new Uint16Array(columns * rows);
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#342623';
      for (const grain of grains) {
        const px = clamp(grain.x * width, 0, Math.max(0, width - grain.size));
        const py = clamp(grain.y * height, 0, Math.max(0, height - grain.size));
        const space = reserveGrain(occupied, cursors, columns, rows, px, py);
        ctx.globalAlpha = grain.opacity;
        ctx.fillRect(space ? space.x + (grain.opacity - .5) * .3 : px,
          space ? space.y + (grain.size - .75) * .25 : py, grain.size, grain.size);
      }
      ctx.globalAlpha = 1;
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [dust, losses]);

  return losses.length ? <canvas className="paper-dust" ref={ref} aria-hidden="true" /> : null;
}
