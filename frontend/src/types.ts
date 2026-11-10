export interface Story { id: string; title: string; tagline: string; genre: string; text: string }
export interface Unit { id: string; text: string; start: number; end: number; stakeable: boolean }
export interface Concept { id: string; label: string; kind: string; description: string; depends_on: string[]; anchors?: string[] }
export interface Analysis { units: Unit[] }
export interface Offer { id: string; title: string; description: string; required_count: number; change_scale: number; tier: number }
export interface Transaction { id: string; status: string; outcome: 'win'|'loss'; offer: Offer; unit_ids: string[]; stakes: string[]; lost: Concept[]; before: string; after?: string; summary?: string; changes?: string[]; checks?: {protected_retained: boolean; lost_absent: boolean; reward_realized: boolean; notes: string}; attempts: number; error?: string }
export interface Session { betting_mode: 'count-v1'; id: string; title: string; story_id: string; text: string; version: number; status: string; error?: string; analysis?: Analysis; offers: Offer[]; win_probability: number; transactions: Transaction[]; lost_concepts: Concept[]; pending_transaction_id?: string; view: 'game'|'result'; api_calls: number; usage: {input: number; output: number; thoughts: number}; model: string }
