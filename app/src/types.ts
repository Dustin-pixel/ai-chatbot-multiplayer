export type Rating = 'mature' | 'adult';

export interface Stats {
  might: number;
  finesse: number;
  wits: number;
  charm: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  adultContent: boolean;
  blockedThemes: string[];
  modelId: string | null;
}

export interface ModelInfo {
  id: string;
  label: string;
  adultContent: boolean;
}

export interface FeedItem {
  id: number;
  kind: 'action' | 'arrive' | 'depart' | 'system';
  mine: boolean;
  actor: string | null;
  action: string;
  text: string;
  roll: number | null;
  at: number;
}

export interface Scene {
  character: {
    id: string;
    name: string;
    concept: string;
    stats: Stats;
    hp: number;
    max_hp: number;
    inventory: string[];
  };
  location: { id: string; name: string; description: string };
  exits: { id: string; name: string }[];
  present: { id: string; name: string; concept: string; condition: string }[];
  npcs: { id: string; name: string; description: string; disposition: string }[];
  quests: { title: string; status: string; note: string }[];
  rating: Rating;
  xcardActive: boolean;
  events: FeedItem[];
  lastEventId: number;
}

export interface TurnResult {
  roll: number;
  rating: Rating;
  model: string;
  downgraded: boolean;
  scene: Scene;
}

export interface CharacterSummary {
  id: string;
  name: string;
  concept: string;
  hp: number;
  max_hp: number;
  location_id: string;
}
