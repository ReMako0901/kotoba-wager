import { useEffect, useMemo, useRef } from 'react';
import type { Transaction } from './types';

type Grain = { fromRight: number; fromBottom: number; size: number; opacity: number };
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

function fallbackDust(loss: Transaction, width: number, height: number) {
  const count = Math.min(160, Math.max(24, loss.stakes.join('').length * 12));
  const center = .12 + Math.random() * .76;
  return Array.from({ length: count }, () => ({
    fromRight: width * (1 - clamp(center + (Math.random() - .5) * .16, .002, .998)),
    fromBottom: height * (.003 + Math.random() ** 2 * .022),
    size: sampleDustSize(), opacity: .25 + Math.random() * .48,
  }));
}

export type DustProps = { dust: Dust; losses: Transaction[] };

export function PaperDust({ dust, losses }: DustProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !losses.length) return;
    const paint = () => {
      const { width, height } = canvas.getBoundingClientRect();
      if (!width || !height) return;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#342623';
      for (const loss of losses) {
        const grains = dust.grains.get(loss.id) ?? fallbackDust(loss, width, height);
        if (!dust.grains.has(loss.id)) dust.grains.set(loss.id, grains);
        // Keep the pile intact if rewriting makes the sheet narrower.
        const shift = grains.reduce((n, grain) => Math.max(n, grain.fromRight - width), 0);
        for (const grain of grains) {
          const px = clamp(width - grain.fromRight + shift, 0, Math.max(0, width - grain.size));
          const py = clamp(height - grain.fromBottom, 0, Math.max(0, height - grain.size));
          ctx.globalAlpha = grain.opacity;
          ctx.fillRect(px, py, grain.size, grain.size);
        }
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
