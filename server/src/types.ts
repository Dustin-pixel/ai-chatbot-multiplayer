export type Rating = 'mature' | 'adult';

export interface Stats {
  might: number;
  finesse: number;
  wits: number;
  charm: number;
}

export interface Player {
  id: string;
  name: string;
  birth_date: string;
  age_verified: number;
  adult_content: number;
  blocked_themes: string[];
  model_id: string | null;
  created_at: number;
}

export interface Character {
  id: string;
  player_id: string;
  world_id: string;
  name: string;
  concept: string;
  abilities: Ability[];
  stats: Stats;
  hp: number;
  max_hp: number;
  inventory: string[];
  location_id: string;
  summary: string;
  created_at: number;
}

export interface Location {
  id: string;
  world_id: string;
  name: string;
  description: string;
  exits: string[];
}

export interface Npc {
  id: string;
  world_id: string;
  name: string;
  description: string;
  location_id: string;
  disposition: string;
  notes: string;
}

export interface EventRow {
  id: number;
  location_id: string;
  character_id: string | null;
  actor_name: string | null;
  kind: 'action' | 'arrive' | 'depart' | 'system';
  action: string;
  narration: string;
  observable: string;
  roll: number | null;
  rating: Rating;
  created_at: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  maxTokens: number;
  temperature: number;
}

export interface Provider {
  complete(messages: ChatMessage[], opts: CompleteOptions): Promise<string>;
}

export interface Ability {
  name: string;
  description: string;
  /** A concrete cost or restriction the narrator must honour. */
  limit: string;
}

export interface StatLabel {
  label: string;
  hint: string;
}
export type StatLabels = Record<keyof Stats, StatLabel>;

export const DEFAULT_STAT_LABELS: StatLabels = {
  might: { label: 'Might', hint: 'Force, endurance, fighting' },
  finesse: { label: 'Finesse', hint: 'Agility, stealth, aim' },
  wits: { label: 'Wits', hint: 'Perception, lore, cunning' },
  charm: { label: 'Charm', hint: 'Persuasion, presence, deceit' },
};

export interface World {
  id: string;
  /** Short share code: anyone with it can create a character in this world. */
  code: string;
  name: string;
  /** The story this world was built from ("" for the built-in world). */
  reference: string;
  premise: string;
  tone: string;
  rules: string;
  stat_labels: StatLabels;
  /** Highest content rating allowed here. Set by server code, never by the model. */
  max_rating: Rating;
  start_location: string;
  owner_player_id: string | null;
  created_at: number;
}
