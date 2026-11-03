import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { config } from './config.ts';
import type { Character, EventRow, Location, Npc, Player, Rating, Stats } from './types.ts';

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  birth_date TEXT NOT NULL,
  age_verified INTEGER NOT NULL DEFAULT 0,
  adult_content INTEGER NOT NULL DEFAULT 0,
  blocked_themes TEXT NOT NULL DEFAULT '[]',
  model_id TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  name TEXT NOT NULL,
  concept TEXT NOT NULL,
  stats TEXT NOT NULL,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  inventory TEXT NOT NULL DEFAULT '[]',
  location_id TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  exits TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS npcs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  location_id TEXT NOT NULL,
  disposition TEXT NOT NULL DEFAULT 'neutral',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL,
  character_id TEXT,
  kind TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  narration TEXT NOT NULL DEFAULT '',
  observable TEXT NOT NULL DEFAULT '',
  roll INTEGER,
  rating TEXT NOT NULL DEFAULT 'mature',
  summarized INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_loc ON events(location_id, id);
CREATE INDEX IF NOT EXISTS idx_events_char ON events(character_id, id);
CREATE TABLE IF NOT EXISTS quests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(character_id, title)
);
CREATE TABLE IF NOT EXISTS location_flags (
  location_id TEXT PRIMARY KEY,
  cap TEXT NOT NULL,
  until INTEGER NOT NULL
);
`);

const parse = <T>(s: unknown, fallback: T): T => {
  try {
    return JSON.parse(String(s)) as T;
  } catch {
    return fallback;
  }
};
type Row = Record<string, unknown>;
const rows = (r: unknown[]): Row[] => r as Row[];
const row = (r: unknown): Row | undefined => (r as Row | undefined) ?? undefined;
const now = () => Date.now();

// ---------- players ----------
const toPlayer = (r: Row): Player => ({
  id: r.id as string,
  name: r.name as string,
  birth_date: r.birth_date as string,
  age_verified: r.age_verified as number,
  adult_content: r.adult_content as number,
  blocked_themes: parse<string[]>(r.blocked_themes, []),
  model_id: (r.model_id as string | null) ?? null,
  created_at: r.created_at as number,
});

export function createPlayer(name: string, birthDate: string, tokenHash: string): Player {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO players (id, name, birth_date, age_verified, token_hash, created_at) VALUES (?, ?, ?, 1, ?, ?)`,
  ).run(id, name, birthDate, tokenHash, now());
  return getPlayer(id)!;
}

export function getPlayer(id: string): Player | undefined {
  const r = row(db.prepare('SELECT * FROM players WHERE id = ?').get(id));
  return r ? toPlayer(r) : undefined;
}

export function getPlayerByTokenHash(hash: string): Player | undefined {
  const r = row(db.prepare('SELECT * FROM players WHERE token_hash = ?').get(hash));
  return r ? toPlayer(r) : undefined;
}

export function updatePlayerSettings(
  id: string,
  patch: { adult_content?: boolean; blocked_themes?: string[]; model_id?: string | null },
): Player {
  if (patch.adult_content !== undefined)
    db.prepare('UPDATE players SET adult_content = ? WHERE id = ?').run(patch.adult_content ? 1 : 0, id);
  if (patch.blocked_themes !== undefined)
    db.prepare('UPDATE players SET blocked_themes = ? WHERE id = ?').run(JSON.stringify(patch.blocked_themes), id);
  if (patch.model_id !== undefined) db.prepare('UPDATE players SET model_id = ? WHERE id = ?').run(patch.model_id, id);
  return getPlayer(id)!;
}

// ---------- characters ----------
const toCharacter = (r: Row): Character => ({
  id: r.id as string,
  player_id: r.player_id as string,
  name: r.name as string,
  concept: r.concept as string,
  stats: parse<Stats>(r.stats, { might: 1, finesse: 1, wits: 1, charm: 1 }),
  hp: r.hp as number,
  max_hp: r.max_hp as number,
  inventory: parse<string[]>(r.inventory, []),
  location_id: r.location_id as string,
  summary: (r.summary as string) ?? '',
  created_at: r.created_at as number,
});

export function createCharacter(
  playerId: string,
  name: string,
  concept: string,
  stats: Stats,
  locationId: string,
  inventory: string[],
): Character {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO characters (id, player_id, name, concept, stats, hp, max_hp, inventory, location_id, created_at)
     VALUES (?, ?, ?, ?, ?, 20, 20, ?, ?, ?)`,
  ).run(id, playerId, name, concept, JSON.stringify(stats), JSON.stringify(inventory), locationId, now());
  return getCharacter(id)!;
}

export function getCharacter(id: string): Character | undefined {
  const r = row(db.prepare('SELECT * FROM characters WHERE id = ?').get(id));
  return r ? toCharacter(r) : undefined;
}

export function listCharacters(playerId: string): Character[] {
  return rows(db.prepare('SELECT * FROM characters WHERE player_id = ? ORDER BY created_at').all(playerId)).map(
    toCharacter,
  );
}

export function charactersAt(locationId: string): Character[] {
  return rows(db.prepare('SELECT * FROM characters WHERE location_id = ? ORDER BY created_at').all(locationId)).map(
    toCharacter,
  );
}

export function updateCharacter(
  id: string,
  patch: Partial<Pick<Character, 'hp' | 'inventory' | 'location_id' | 'summary'>>,
): void {
  if (patch.hp !== undefined) db.prepare('UPDATE characters SET hp = ? WHERE id = ?').run(patch.hp, id);
  if (patch.inventory !== undefined)
    db.prepare('UPDATE characters SET inventory = ? WHERE id = ?').run(JSON.stringify(patch.inventory), id);
  if (patch.location_id !== undefined)
    db.prepare('UPDATE characters SET location_id = ? WHERE id = ?').run(patch.location_id, id);
  if (patch.summary !== undefined) db.prepare('UPDATE characters SET summary = ? WHERE id = ?').run(patch.summary, id);
}

// ---------- world ----------
export function getLocation(id: string): Location | undefined {
  const r = row(db.prepare('SELECT * FROM locations WHERE id = ?').get(id));
  return r
    ? { id: r.id as string, name: r.name as string, description: r.description as string, exits: parse<string[]>(r.exits, []) }
    : undefined;
}

export function countLocations(): number {
  return (row(db.prepare('SELECT COUNT(*) AS n FROM locations').get())?.n as number) ?? 0;
}

export function insertLocation(l: Location): void {
  db.prepare('INSERT OR REPLACE INTO locations (id, name, description, exits) VALUES (?, ?, ?, ?)').run(
    l.id,
    l.name,
    l.description,
    JSON.stringify(l.exits),
  );
}

export function insertNpc(n: Npc): void {
  db.prepare(
    'INSERT OR REPLACE INTO npcs (id, name, description, location_id, disposition, notes) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(n.id, n.name, n.description, n.location_id, n.disposition, n.notes);
}

export function npcsAt(locationId: string): Npc[] {
  return rows(db.prepare('SELECT * FROM npcs WHERE location_id = ?').all(locationId)).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    description: r.description as string,
    location_id: r.location_id as string,
    disposition: r.disposition as string,
    notes: r.notes as string,
  }));
}

export function updateNpc(id: string, patch: { disposition?: string; note?: string }): void {
  if (patch.disposition) db.prepare('UPDATE npcs SET disposition = ? WHERE id = ?').run(patch.disposition, id);
  if (patch.note) {
    const cur = (row(db.prepare('SELECT notes FROM npcs WHERE id = ?').get(id))?.notes as string) ?? '';
    const next = `${cur} ${patch.note}`.trim().slice(-600);
    db.prepare('UPDATE npcs SET notes = ? WHERE id = ?').run(next, id);
  }
}

export function addFact(locationId: string | null, text: string): void {
  db.prepare('INSERT INTO facts (location_id, text, created_at) VALUES (?, ?, ?)').run(locationId, text, now());
}

/** Global facts + facts for this location, newest last. */
export function factsFor(locationId: string, limit = 14): string[] {
  const r = rows(
    db
      .prepare(
        `SELECT text FROM (SELECT text, id FROM facts WHERE location_id IS NULL OR location_id = ? ORDER BY id DESC LIMIT ?) ORDER BY id`,
      )
      .all(locationId, limit),
  );
  return r.map((x) => x.text as string);
}

export function upsertQuest(characterId: string, title: string, status: string, note: string): void {
  db.prepare(
    `INSERT INTO quests (character_id, title, status, note) VALUES (?, ?, ?, ?)
     ON CONFLICT(character_id, title) DO UPDATE SET status = excluded.status, note = excluded.note`,
  ).run(characterId, title, status, note);
}

export function questsFor(characterId: string): { title: string; status: string; note: string }[] {
  return rows(db.prepare('SELECT title, status, note FROM quests WHERE character_id = ? ORDER BY id').all(characterId)).map(
    (r) => ({ title: r.title as string, status: r.status as string, note: r.note as string }),
  );
}

// ---------- events ----------
const toEvent = (r: Row): EventRow => ({
  id: r.id as number,
  location_id: r.location_id as string,
  character_id: (r.character_id as string | null) ?? null,
  actor_name: (r.actor_name as string | null) ?? null,
  kind: r.kind as EventRow['kind'],
  action: r.action as string,
  narration: r.narration as string,
  observable: r.observable as string,
  roll: (r.roll as number | null) ?? null,
  rating: r.rating as Rating,
  created_at: r.created_at as number,
});

export function addEvent(e: {
  location_id: string;
  character_id: string | null;
  kind: EventRow['kind'];
  action?: string;
  narration?: string;
  observable?: string;
  roll?: number | null;
  rating?: Rating;
}): number {
  const res = db
    .prepare(
      `INSERT INTO events (location_id, character_id, kind, action, narration, observable, roll, rating, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.location_id,
      e.character_id,
      e.kind,
      e.action ?? '',
      e.narration ?? '',
      e.observable ?? '',
      e.roll ?? null,
      e.rating ?? 'mature',
      now(),
    );
  return Number(res.lastInsertRowid);
}

/** Last N events at a location (any actor), oldest first. */
export function recentEventsAt(locationId: string, limit: number): EventRow[] {
  const r = rows(
    db
      .prepare(
        `SELECT e.*, c.name AS actor_name FROM events e LEFT JOIN characters c ON c.id = e.character_id
         WHERE e.location_id = ? ORDER BY e.id DESC LIMIT ?`,
      )
      .all(locationId, limit),
  );
  return r.map(toEvent).reverse();
}

/**
 * What a character sees: their own events anywhere, plus what is observable from other
 * characters (and system notices) at their current location since they arrived.
 */
export function feedFor(character: Character, since: number, limit = 60): EventRow[] {
  const marker =
    (row(
      db.prepare(`SELECT COALESCE(MAX(id), 0) AS m FROM events WHERE character_id = ? AND kind = 'arrive'`).get(character.id),
    )?.m as number) ?? 0;
  const r = rows(
    db
      .prepare(
        `SELECT e.*, c.name AS actor_name FROM events e LEFT JOIN characters c ON c.id = e.character_id
         WHERE e.id > ? AND (
           e.character_id = ?
           OR (e.location_id = ? AND e.id > ? AND (
                (e.character_id IS NOT NULL AND e.character_id != ? AND e.observable != '')
                OR e.kind = 'system'))
         ) ORDER BY e.id DESC LIMIT ?`,
      )
      .all(since, character.id, character.location_id, marker, character.id, limit),
  );
  return r.map(toEvent).reverse();
}

export function unsummarizedCount(characterId: string): number {
  return (
    (row(db.prepare('SELECT COUNT(*) AS n FROM events WHERE character_id = ? AND summarized = 0 AND kind = ?').get(characterId, 'action'))
      ?.n as number) ?? 0
  );
}

export function oldestUnsummarized(characterId: string, n: number): EventRow[] {
  return rows(
    db
      .prepare(
        `SELECT e.*, c.name AS actor_name FROM events e LEFT JOIN characters c ON c.id = e.character_id
         WHERE e.character_id = ? AND e.summarized = 0 AND e.kind = 'action' ORDER BY e.id LIMIT ?`,
      )
      .all(characterId, n),
  ).map(toEvent);
}

export function markSummarized(ids: number[]): void {
  const stmt = db.prepare('UPDATE events SET summarized = 1 WHERE id = ?');
  for (const id of ids) stmt.run(id);
}

// ---------- safety caps ----------
export function setCap(locationId: string, cap: Rating, until: number): void {
  db.prepare(
    `INSERT INTO location_flags (location_id, cap, until) VALUES (?, ?, ?)
     ON CONFLICT(location_id) DO UPDATE SET cap = excluded.cap, until = excluded.until`,
  ).run(locationId, cap, until);
}

export function activeCap(locationId: string): Rating | null {
  const r = row(db.prepare('SELECT cap, until FROM location_flags WHERE location_id = ?').get(locationId));
  if (!r) return null;
  return (r.until as number) > now() ? (r.cap as Rating) : null;
}
