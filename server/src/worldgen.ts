import { randomBytes, randomInt } from 'node:crypto';
import { getWorldByCode, insertWorld, worldsCreatedSince } from './db.ts';
import { HttpError, clean, limit, parseAbilities, resolveModel } from './engine.ts';
import { providerFor } from './models/registry.ts';
import { ADVISOR_SYSTEM, WORLD_ARCHITECT_SYSTEM } from './prompts.ts';
import { DEFAULT_STAT_LABELS } from './types.ts';
import type { Ability, Location, Npc, Player, Stats, StatLabels, World } from './types.ts';

const STAT_KEYS = ['might', 'finesse', 'wits', 'charm'] as const;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const str = (v: unknown, max: number) => (typeof v === 'string' ? clean(v, max) : '');
const strs = (v: unknown, n: number, max: number) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => clean(x, max)).filter(Boolean).slice(0, n) : [];
const objs = (v: unknown, n: number) =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null).slice(0, n) : [];
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'place';

function extractJson(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object');
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// World generation
// ---------------------------------------------------------------------------
export interface ParsedWorld {
  recognized: boolean;
  name: string;
  premise: string;
  tone: string;
  rules: string;
  stat_labels: StatLabels;
  locations: Location[];
  npcs: Npc[];
  facts: string[];
}

/** Turn the model's JSON into a safe, internally consistent world. Everything is length-capped and repaired. */
export function parseWorldPack(raw: string, worldId: string, fallbackName: string): ParsedWorld {
  let o: Record<string, unknown>;
  try {
    o = extractJson(raw);
  } catch {
    throw new HttpError(502, 'The storyteller returned an unusable world. Try again.');
  }

  // Locations: unique slugs, real exits only, two-way links, nothing stranded.
  const locs: { slug: string; name: string; description: string; exits: string[] }[] = [];
  const seen = new Set<string>();
  for (const l of objs(o.locations, 10)) {
    const name = str(l.name, 50);
    if (!name) continue;
    let slug = slugify(str(l.id, 40) || name);
    while (seen.has(slug)) slug += '_x';
    seen.add(slug);
    locs.push({ slug, name, description: str(l.description, 500), exits: strs(l.exits, 8, 40).map(slugify) });
  }
  if (locs.length < 3) throw new HttpError(502, 'The storyteller returned too few locations. Try again.');
  const bySlug = new Map(locs.map((l) => [l.slug, l]));
  for (const l of locs) l.exits = [...new Set(l.exits.filter((e) => bySlug.has(e) && e !== l.slug))];
  for (const l of locs) for (const e of l.exits) if (!bySlug.get(e)!.exits.includes(l.slug)) bySlug.get(e)!.exits.push(l.slug);
  const hub = locs[0]!;
  for (const l of locs.slice(1)) {
    if (l.exits.length === 0) {
      l.exits.push(hub.slug);
      hub.exits.push(l.slug);
    }
  }
  const locId = (slug: string) => `${worldId}_${slug}`;
  const locations: Location[] = locs.map((l) => ({
    id: locId(l.slug),
    world_id: worldId,
    name: l.name,
    description: l.description,
    exits: l.exits.map(locId),
  }));

  // NPCs: placed in real locations (fall back to the hub).
  const npcs: Npc[] = [];
  const npcSeen = new Set<string>();
  for (const n of objs(o.npcs, 10)) {
    const name = str(n.name, 50);
    if (!name) continue;
    let slug = slugify(str(n.id, 40) || name);
    while (npcSeen.has(slug)) slug += '_x';
    npcSeen.add(slug);
    const where = slugify(str(n.location, 40));
    npcs.push({
      id: `${worldId}_${slug}`,
      world_id: worldId,
      name,
      description: str(n.description, 300),
      location_id: locId(bySlug.has(where) ? where : hub.slug),
      disposition: str(n.disposition, 24) || 'neutral',
      notes: str(n.notes, 300),
    });
  }

  const labels = (o.stat_labels ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const stat_labels = Object.fromEntries(
    STAT_KEYS.map((k) => [
      k,
      {
        label: str(labels[k]?.label, 14) || DEFAULT_STAT_LABELS[k].label,
        hint: str(labels[k]?.hint, 40) || DEFAULT_STAT_LABELS[k].hint,
      },
    ]),
  ) as StatLabels;

  return {
    recognized: o.recognized !== false,
    name: str(o.name, 40) || fallbackName,
    premise: str(o.premise, 700),
    tone: str(o.tone, 200),
    rules: str(o.rules, 1000),
    stat_labels,
    locations,
    npcs,
    facts: strs(o.facts, 8, 200),
  };
}

function newCode(): string {
  for (;;) {
    const code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    if (!getWorldByCode(code)) return code;
  }
}

export async function generateWorld(player: Player, referenceRaw: unknown, notesRaw: unknown): Promise<World> {
  const reference = typeof referenceRaw === 'string' ? clean(referenceRaw, 80) : '';
  const notes = typeof notesRaw === 'string' ? notesRaw.replace(/\s+/g, ' ').trim().slice(0, 800) : '';
  if (reference.length < 2) throw new HttpError(400, 'Name the story, series or book your world should be based on.');
  if (worldsCreatedSince(player.id, Date.now() - 3_600_000) >= 3)
    throw new HttpError(429, 'You can build 3 worlds per hour. Try again a little later.');
  limit(`world:${player.id}`, 3, 60_000);

  // World building is non-explicit work: always request the "mature" tier of routing.
  const { model } = resolveModel(player.model_id, 'mature');
  let raw: string;
  try {
    raw = await providerFor(model).complete(
      [
        { role: 'system', content: WORLD_ARCHITECT_SYSTEM },
        { role: 'user', content: `REFERENCE: ${reference}\nNOTES: ${notes || 'none'}` },
      ],
      { maxTokens: 3000, temperature: 0.7 },
    );
  } catch (err) {
    console.warn('[worldgen] model call failed:', (err as Error).message);
    throw new HttpError(502, 'The storyteller could not be reached. Try again in a moment.');
  }

  const worldId = `w${randomBytes(3).toString('hex')}`;
  const pack = parseWorldPack(raw, worldId, `${reference} world`);
  if (!pack.recognized && notes.length < 40)
    throw new HttpError(422, "I don't recognise that story. Add a few sentences of notes describing the setting and I'll build from those.");

  const world: World = {
    id: worldId,
    code: newCode(),
    name: pack.name,
    reference,
    premise: pack.premise,
    tone: pack.tone,
    rules: pack.rules,
    stat_labels: pack.stat_labels,
    // Set by code, never by the model. Worlds built from other stories stay non-explicit:
    // those casts often include minors and the model cannot reliably tell who is who.
    max_rating: 'mature',
    start_location: (pack.locations[0] as Location).id,
    owner_player_id: player.id,
    created_at: Date.now(),
  };
  insertWorld(world, pack.locations, pack.npcs, pack.facts);
  return world;
}

// ---------------------------------------------------------------------------
// Character advisor: concept -> stats, abilities, items
// ---------------------------------------------------------------------------
export function normalizeStats(raw: unknown): Stats {
  const r = (raw ?? {}) as Record<string, unknown>;
  const v: Stats = { might: 1, finesse: 1, wits: 1, charm: 1 };
  for (const k of STAT_KEYS) {
    const n = Math.round(Number(r[k]));
    v[k] = Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 1;
  }
  let sum = STAT_KEYS.reduce((a, k) => a + v[k], 0);
  while (sum > 6) {
    const k = STAT_KEYS.reduce((best, c) => (v[c] > v[best] ? c : best), STAT_KEYS[0]);
    v[k]--;
    sum--;
  }
  while (sum < 6) {
    const k = STAT_KEYS.reduce((best, c) => (v[c] < v[best] ? c : best), STAT_KEYS[0]);
    v[k]++;
    sum++;
  }
  return v;
}

export interface Suggestion {
  name: string | null;
  stats: Stats;
  abilities: Ability[];
  items: string[];
  note: string;
}

export async function suggestCharacter(player: Player, world: World, conceptRaw: unknown): Promise<Suggestion> {
  const concept = typeof conceptRaw === 'string' ? clean(conceptRaw, 160) : '';
  if (concept.length < 3) throw new HttpError(400, 'Describe your character first (e.g. "a calm swordsman with a dangerous secret").');
  limit(`suggest:${player.id}`, 10, 60_000);

  const labels = Object.entries(world.stat_labels)
    .map(([k, l]) => `${k} = ${l.label} (${l.hint})`)
    .join('; ');
  const { model } = resolveModel(player.model_id, 'mature');
  let raw: string;
  try {
    raw = await providerFor(model).complete(
      [
        { role: 'system', content: ADVISOR_SYSTEM },
        {
          role: 'user',
          content: `WORLD: ${world.name}: ${world.premise}\nPOWER RULES: ${world.rules || 'none specified'}\nSTAT NAMES: ${labels}\nCONCEPT: ${concept}`,
        },
      ],
      { maxTokens: 700, temperature: 0.6 },
    );
  } catch (err) {
    console.warn('[worldgen] advisor call failed:', (err as Error).message);
    throw new HttpError(502, 'The storyteller could not be reached. Try again in a moment.');
  }
  let o: Record<string, unknown>;
  try {
    o = extractJson(raw);
  } catch {
    throw new HttpError(502, 'The advisor returned something unusable. Try again.');
  }
  return {
    name: str(o.name, 30) || null,
    stats: normalizeStats(o.stats),
    abilities: parseAbilities(o.abilities),
    items: strs(o.items, 3, 40),
    note: str(o.note, 200),
  };
}
