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
  name: string;
  concept: string;
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
  name: string;
  description: string;
  exits: string[];
}

export interface Npc {
  id: string;
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
