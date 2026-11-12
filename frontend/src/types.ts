export interface Story { id: string; title: string; tagline: string; genre: string; text: string }
export interface Unit { id: string; text: string; start: number; end: number; stakeable: boolean }
export interface Concept { id: string; label: string; kind: string; description: string; depends_on: string[]; anchors?: string[] }
export interface Analysis { units: Unit[] }
export interface Offer { id: string; title: string; description: string; required_count: number; change_scale: number; tier: number }
export interface Transaction { id: string; status: string; outcome: 'win'|'loss'|null; offer: Offer; unit_ids: string[]; selected_units?: Unit[]; stakes: string[]; lost: Concept[]; before: string; after?: string; summary?: string; changes?: string[]; checks?: {protected_retained: boolean; lost_absent: boolean; reward_realized: boolean; notes: string}; attempts: number; error?: string; gamble?: Gamble; presentation_completed?: boolean }
export interface Session { betting_mode: 'count-v1'; id: string; title: string; story_id: string; text: string; version: number; status: string; error?: string; analysis?: Analysis; offers: Offer[]; win_probability: number; transactions: Transaction[]; lost_concepts: Concept[]; pending_transaction_id?: string; view: 'game'|'result'; api_calls: number; usage: {input: number; output: number; thoughts: number}; model: string }

export type BeginnerKind = 'rps' | 'card_guess' | 'dice';
export type GameKind = 'slot' | 'blackjack' | 'baccarat' | BeginnerKind;
export interface GameOption { id: GameKind; name: string; tier?: 'beginner'; win_probability: number; description: string }
export interface PlayingCard { rank: string; suit: string }
export interface CardRound { player: PlayingCard[]; banker: PlayingCard[]; player_total: number; banker_total: number; outcome: 'win' | 'loss' | 'tie'; difference?: number; dealer_hands?: PlayingCard[][] }
export type HandMove = { choice: number; opponent: number; outcome: 'win' | 'loss' | 'tie' };
export type CardMove = { choice: number; answer: number; outcome: 'win' | 'loss' };
export type DiceMove = { face: number; outcome: 'win' | 'loss' };
export interface Gamble {
  kind: GameKind;
  outcome: 'win' | 'loss' | null;
  strength?: number;
  label?: string;
  reels?: string[];
  rounds: CardRound[];
  moves?: (HandMove | CardMove | DiceMove)[];
  cards?: PlayingCard[];
  target?: number;
  swaps?: [number, number][];
}
