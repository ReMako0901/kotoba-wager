import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { PlayingCard } from './types';
import './baccarat.css';

const suitCodes: Record<string, string> = { '♣': 'C', '♦': 'D', '♥': 'H', '♠': 'S' };

export function CardFace({ card }: { card: PlayingCard }) {
  const name = card.rank + suitCodes[card.suit];
  return <img className="baccarat-face" src={`${import.meta.env.BASE_URL}cards/${name}.webp`} alt="" draggable={false} />;
}

type Edge = 'left' | 'right' | 'top' | 'bottom';
type Peeks = Partial<Record<Edge, number>>;
type Drag = { id: number; x: number; y: number; edge?: Edge; width: number; height: number; initial: Peeks };

const clips: Record<Edge, (remaining: number) => string> = {
  left: remaining => `inset(0 ${remaining}% 0 0)`,
  right: remaining => `inset(0 0 0 ${remaining}%)`,
  top: remaining => `inset(0 0 ${remaining}% 0)`,
  bottom: remaining => `inset(${remaining}% 0 0 0)`,
};

const arrows: Record<string, Edge> = {
  ArrowRight: 'left', ArrowLeft: 'right', ArrowDown: 'top', ArrowUp: 'bottom',
};

export function BaccaratCard({ card, label, open, onOpen }: {
  card: PlayingCard; label: string; open: boolean; onOpen: () => void;
}) {
  const [peeks, setPeeks] = useState<Peeks>({});
  const drag = useRef<Drag | undefined>(undefined);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (open || event.button !== 0 || drag.current) return;
    const { width, height } = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, width, height, initial: peeks };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId || open) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.edge) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const first: Edge = horizontal ? 'left' : 'top';
      const second: Edge = horizontal ? 'right' : 'bottom';
      const position = horizontal ? start.x : start.y;
      const bounds = event.currentTarget.getBoundingClientRect();
      const midpoint = horizontal ? bounds.left + start.width / 2 : bounds.top + start.height / 2;
      const inward = (horizontal ? dx : dy) > 0 ? first : second;
      // Starting in an already exposed strip allows dragging the back over it again.
      const fraction = horizontal ? (start.x - bounds.left) / start.width : (start.y - bounds.top) / start.height;
      const touchedEdge = position < midpoint ? first : second;
      const depth = touchedEdge === first ? fraction : 1 - fraction;
      start.edge = depth < (start.initial[touchedEdge] ?? 0) / 100 ? touchedEdge : inward;
    }
    const edge = start.edge;
    const delta = { left: dx / start.width, right: -dx / start.width, top: dy / start.height, bottom: -dy / start.height }[edge];
    setPeeks({ ...start.initial, [edge]: Math.max(0, Math.min(100, (start.initial[edge] ?? 0) + delta * 100)) });
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) drag.current = undefined;
  }

  function keyPeek(event: KeyboardEvent<HTMLDivElement>) {
    const edge = arrows[event.key];
    if (open || !edge) return;
    event.preventDefault();
    setPeeks(current => ({ ...current, [edge]: Math.min(100, (current[edge] ?? 0) + 15) }));
  }

  return <section className="baccarat-stage" aria-label={label}>
    <div className={`baccarat-zoom ${open ? 'face-up' : 'squeeze-back'}`}
      role="img" aria-label={open ? `${card.suit}${card.rank}` : '伏せ札。上下左右にスワイプ、または矢印キーで絞る'}
      tabIndex={open ? undefined : 0}
      onPointerDown={startDrag} onPointerMove={moveDrag}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={keyPeek}>
      {open ? <CardFace card={card} /> : (Object.keys(clips) as Edge[]).map(edge => {
        const amount = peeks[edge];
        return amount ? <div className="baccarat-peek" key={edge} style={{ clipPath: clips[edge](100 - amount) }}>
          <CardFace card={card} />
        </div> : null;
      })}
    </div>
    {!open && <div className="baccarat-controls">
      <p className="reading-hint">上下左右にスワイプして絞る</p>
      <button className="secondary" type="button" onClick={onOpen}>表にする</button>
    </div>}
  </section>;
}
