import type { PlayingCard } from '../types';

const SUIT_CODE: Record<string, string> = {
  '♠': 'S',
  '♥': 'H',
  '♦': 'D',
  '♣': 'C',
  S: 'S',
  H: 'H',
  D: 'D',
  C: 'C',
};

export function cardAssetUrl(card: PlayingCard): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const suitLetter = SUIT_CODE[card.suit] ?? 'S';
  return `${normalizedBase}cards/${card.rank}${suitLetter}.webp`;
}

export function slotAssetUrl(symbol: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const fileMap: Record<string, string> = {
    'ベル': 'bell.png',
    'スイカ': 'watermelon.png',
    REG: 'bar.png',
    BIG: 'seven.png',
  };
  const file = fileMap[symbol] ?? 'bell.png';
  return `${normalizedBase}slot-symbols/${file}`;
}

export function cardLabel(card: PlayingCard): string {
  return `${card.suit}${card.rank}`;
}

export function isRedSuit(suit: string): boolean {
  return suit === '♥' || suit === '♦' || suit === 'H' || suit === 'D';
}

export function calcBlackjackTotal(cards: PlayingCard[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 'A') {
      total += 1;
      aces += 1;
    } else if (card.rank === 'K' || card.rank === 'Q' || card.rank === 'J') {
      total += 10;
    } else {
      const parsed = Number.parseInt(card.rank, 10);
      total += Number.isFinite(parsed) ? parsed : 0;
    }
  }
  while (aces > 0 && total + 10 <= 21) {
    total += 10;
    aces -= 1;
  }
  return total;
}

export function calcBaccaratPoint(card: PlayingCard): number {
  if (card.rank === 'A') return 1;
  if (card.rank === '10' || card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 0;
  const parsed = Number.parseInt(card.rank, 10);
  return Number.isFinite(parsed) ? parsed % 10 : 0;
}

export function calcBaccaratTotal(cards: PlayingCard[]): number {
  let sum = 0;
  for (const card of cards) {
    sum += calcBaccaratPoint(card);
  }
  return sum % 10;
}

interface FolioCardViewProps {
  card?: PlayingCard;
  faceUp: boolean;
  className?: string;
  badge?: string;
  highlighted?: boolean;
}

export function FolioCardView({
  card,
  faceUp,
  className = '',
  badge,
  highlighted = false,
}: FolioCardViewProps) {
  const red = card ? isRedSuit(card.suit) : false;
  return (
    <span
      className={`folio-card ${faceUp ? 'is-face-up' : 'is-face-down'}${
        highlighted ? ' is-highlighted' : ''
      }${red ? ' is-red' : ''} ${className}`.trim()}
    >
      {faceUp && card ? (
        <span className="folio-card-face">
          <img
            src={cardAssetUrl(card)}
            alt={cardLabel(card)}
            className="folio-card-img"
            draggable={false}
          />
          <span className="folio-card-corner" aria-hidden="true">
            {card.suit}
            {card.rank}
          </span>
        </span>
      ) : (
        <span className="folio-card-back" aria-label="伏せ札">
          <span className="folio-card-back-pattern" aria-hidden="true" />
        </span>
      )}
      {badge && <span className="folio-card-badge">{badge}</span>}
    </span>
  );
}
