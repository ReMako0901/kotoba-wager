import { useEffect, useMemo, useRef } from 'react';
import type { Transaction } from './types';

type Grain = { x: number; y: number; vx: number; vy: number; size: number; opacity: number };
type Gravity = { x: number; y: number };
export type Dust = { grains: Map<string, Grain[]>; gravity: { current: Gravity } };
type OrientationAPI = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<PermissionState> };

export function requestPaperTilt() {
  const orientation = window.DeviceOrientationEvent as OrientationAPI | undefined;
  if (orientation?.requestPermission) void orientation.requestPermission().catch(() => {});
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function usePaperDust(sessionId?: string) {
  const gravity = useRef<Gravity>({ x: 0, y: .35 });
  useEffect(() => {
    let baseline: number | undefined;
    function orient(event: DeviceOrientationEvent) {
      if (event.beta === null || event.gamma === null) return;
      baseline ??= event.beta;
      const pitch = (event.beta - baseline + 540) % 360 - 180;
      const sideways = Math.abs(event.gamma) > 3 ? event.gamma / 25 : 0;
      gravity.current = { x: clamp(sideways, -1, 1), y: clamp(.35 + pitch / 22, -1, 1) };
    }
    window.addEventListener('deviceorientation', orient);
    return () => window.removeEventListener('deviceorientation', orient);
  }, []);
  return useMemo<Dust>(() => ({grains: new Map(), gravity}), [sessionId]);
}

export function addPaperDust(dust: Dust, id: string, landing: {x: number; y: number; size: number; opacity: number}[]) {
  if (landing.length) dust.grains.set(id, landing.map(grain => ({ ...grain, vx: 0, vy: 0 })));
}

function fallbackDust(loss: Transaction) {
  const count = Math.min(160, Math.max(24, loss.stakes.join('').length * 12));
  const center = .12 + Math.random() * .76;
  return Array.from({ length: count }, () => ({
    x: clamp(center + (Math.random() - .5) * .16, .002, .998),
    y: .997 - Math.random() ** 2 * .022,
    vx: 0, vy: 0, size: .7 + Math.random() * .8, opacity: .25 + Math.random() * .48,
  }));
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
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let lastFrame = 0;
    let request = 0;
    let idle = 0;
    const draw = (time: number) => {
      const elapsed = lastFrame ? Math.min(.05, (time - lastFrame) / 1000) : 0;
      lastFrame = time;
      const { x, y } = dust.gravity.current;
      let moving = false;
      ctx.clearRect(0, 0, width, height);
      for (const grain of grains) {
        const edge = Math.min(grain.size, .9) / Math.max(1, height);
        const drift = .72 + grain.opacity * .42;
        if (!reducedMotion && elapsed && width && height) {
          const previousX = grain.x;
          const previousY = grain.y;
          const damping = Math.exp(-4 * elapsed);
          grain.vx = (grain.vx + x * 920 * drift * elapsed) * damping;
          grain.vy = (grain.vy + y * 920 * drift * elapsed) * damping;
          const targetX = grain.x + grain.vx * elapsed / width;
          const targetY = grain.y + grain.vy * elapsed / height;
          const insetX = (grain.size + (1 - grain.opacity) * grain.size * 12) / width;
          grain.x = clamp(targetX, insetX, 1 - insetX);
          const cushion = (1 - grain.opacity) * grain.size * .019;
          grain.y = clamp(targetY, edge + cushion, 1 - edge - cushion);
          if (targetX !== grain.x) grain.vx = 0;
          if (targetY !== grain.y) grain.vy = 0;
          moving ||= Math.abs(grain.x - previousX) + Math.abs(grain.y - previousY) > .00001;
        }
        ctx.globalAlpha = grain.opacity;
        ctx.fillRect(grain.x * width, grain.y * height, grain.size, grain.size);
      }
      ctx.globalAlpha = 1;
      if (!reducedMotion) {
        if (moving || !elapsed) request = requestAnimationFrame(draw);
        else idle = window.setTimeout(() => { request = requestAnimationFrame(draw); }, 100);
      }
    };
    ctx.fillStyle = '#342623';
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const scale = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.fillStyle = '#342623';
      if (reducedMotion) draw(performance.now());
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!reducedMotion) request = requestAnimationFrame(draw);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(request);
      window.clearTimeout(idle);
    };
  }, [dust, losses]);

  return losses.length ? <canvas className="paper-dust" ref={ref} aria-hidden="true" /> : null;
}
