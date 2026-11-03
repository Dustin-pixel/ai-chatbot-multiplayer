import { randomInt } from 'node:crypto';
import { config } from './config.ts';
import {
  activeCap,
  addEvent,
  addFact,
  charactersAt,
  createCharacter,
  factsFor,
  feedFor,
  getCharacter,
  getLocation,
  getPlayer,
  markSummarized,
  npcsAt,
  oldestUnsummarized,
  questsFor,
  recentEventsAt,
  setCap,
  unsummarizedCount,
  updateCharacter,
  updateNpc,
  upsertQuest,
} from './db.ts';
import { getModel, listAvailable, providerFor, type ModelEntry } from './models/registry.ts';
import { EXTRACTOR_SYSTEM, SUMMARY_SYSTEM, narratorSystemPrompt } from './prompts.ts';
import { STARTER_ITEMS } from './seed.ts';
import type { Character, EventRow, Player, Rating, Stats } from './types.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Concurrency: one turn at a time per location, so two players in the same
// place never get contradictory narration. (In-process; use a shared lock such
// as Redis if you run several server instances.)
// ---------------------------------------------------------------------------
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(key, next);
  next
    .finally(() => {
      if (locks.get(key) === next) locks.delete(key);
    })
    .catch(() => {});
  return next;
}
const inFlight = new Set<string>();
const turnTimes = new Map<string, number[]>();

function checkRateLimit(playerId: string): void {
  const cutoff = Date.now() - 60_000;
  const times = (turnTimes.get(playerId) ?? []).filter((t) => t > cutoff);
  if (times.length >= config.turnsPerMinute) throw new HttpError(429, 'Slow down a little: too many turns this minute.');
  times.push(Date.now());
  turnTimes.set(playerId, times);
}

// ---------------------------------------------------------------------------
// Ratings & model routing
// ---------------------------------------------------------------------------
export function sceneSettings(locationId: string): { rating: Rating; xcard: boolean; blocked: string[] } {
  const here = charactersAt(locationId);
  const players = [...new Set(here.map((c) => c.player_id))].map((id) => getPlayer(id)).filter((p): p is Player => Boolean(p));
  const everyoneOptedIn = players.length > 0 && players.every((p) => p.adult_content === 1 && p.age_verified === 1);
  const cap = activeCap(locationId);
  const blocked = [...new Set(players.flatMap((p) => p.blocked_themes))];
  return { rating: everyoneOptedIn && !cap ? 'adult' : 'mature', xcard: cap !== null, blocked };
}

/**
 * Pick a model for the requested rating. Adult scenes only ever go to models flagged
 * adultContent; if none is available the scene is downgraded to "mature".
 */
export function resolveModel(requestedId: string | null, rating: Rating): { model: ModelEntry; rating: Rating } {
  const available = listAvailable();
  if (available.length === 0)
    throw new HttpError(503, 'No AI model is configured. Set VENICE_API_KEY (or enable another model in models.json).');
  const ordered: ModelEntry[] = [];
  const push = (m: ModelEntry | undefined) => {
    if (m && !ordered.includes(m)) ordered.push(m);
  };
  if (requestedId) push(getModel(requestedId));
  push(getModel(config.defaultModel));
  available.forEach(push);
  if (rating === 'adult') {
    const adultCapable = ordered.find((m) => m.adultContent);
    if (adultCapable) return { model: adultCapable, rating: 'adult' };
  }
  return { model: ordered[0] as ModelEntry, rating: 'mature' };
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function startCharacter(player: Player, input: { name: unknown; concept: unknown; stats: unknown }): Character {
  const name = typeof input.name === 'string' ? clean(input.name, 30) : '';
  const concept = typeof input.concept === 'string' ? clean(input.concept, 160) : '';
  if (name.length < 2) throw new HttpError(400, 'Character name must be at least 2 characters.');
  if (concept.length < 3) throw new HttpError(400, 'Give your character a short concept (e.g. "disgraced duelist turned ferry guide").');
  const s = (input.stats ?? {}) as Record<string, unknown>;
  const stats: Stats = { might: Number(s.might), finesse: Number(s.finesse), wits: Number(s.wits), charm: Number(s.charm) };
  const vals = Object.values(stats);
  if (!vals.every((v) => Number.isInteger(v) && v >= 0 && v <= 3) || vals.reduce((a, b) => a + b, 0) !== 6)
    throw new HttpError(400, 'Stats (might, finesse, wits, charm) must each be 0-3 and add up to 6.');
  const loc = getLocation(config.startLocation);
  if (!loc) throw new HttpError(500, 'World is not seeded.');
  const ch = createCharacter(player.id, name, concept, stats, loc.id, STARTER_ITEMS);
  addEvent({
    location_id: loc.id,
    character_id: ch.id,
    kind: 'arrive',
    narration: `You arrive at ${loc.name}. ${loc.description}`,
    observable: `${ch.name} arrives.`,
  });
  return ch;
}

// ---------------------------------------------------------------------------
// Scene payload (what the app renders)
// ---------------------------------------------------------------------------
const condition = (c: Character) => {
  const r = c.hp / c.max_hp;
  return c.hp <= 0 ? 'down' : r >= 0.8 ? 'unhurt' : r >= 0.5 ? 'wounded' : 'badly wounded';
};

export interface FeedItem {
  id: number;
  kind: EventRow['kind'];
  mine: boolean;
  actor: string | null;
  action: string;
  text: string;
  roll: number | null;
  at: number;
}

function toFeed(events: EventRow[], me: Character): FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of events) {
    const mine = e.character_id === me.id;
    const text = mine || e.kind === 'system' ? e.narration : e.observable;
    if (!text) continue;
    out.push({ id: e.id, kind: e.kind, mine, actor: e.actor_name, action: mine ? e.action : '', text, roll: mine ? e.roll : null, at: e.created_at });
  }
  return out;
}

export function buildScene(characterId: string, since = 0) {
  const me = getCharacter(characterId);
  if (!me) throw new HttpError(404, 'Character not found.');
  const loc = getLocation(me.location_id);
  if (!loc) throw new HttpError(500, 'Character is in an unknown location.');
  const settings = sceneSettings(loc.id);
  const feed = toFeed(feedFor(me, since), me);
  return {
    character: { id: me.id, name: me.name, concept: me.concept, stats: me.stats, hp: me.hp, max_hp: me.max_hp, inventory: me.inventory },
    location: { id: loc.id, name: loc.name, description: loc.description },
    exits: loc.exits.map((id) => ({ id, name: getLocation(id)?.name ?? id })),
    present: charactersAt(loc.id)
      .filter((c) => c.id !== me.id)
      .map((c) => ({ id: c.id, name: c.name, concept: c.concept, condition: condition(c) })),
    npcs: npcsAt(loc.id).map((n) => ({ id: n.id, name: n.name, description: n.description, disposition: n.disposition })),
    quests: questsFor(me.id),
    rating: settings.rating,
    xcardActive: settings.xcard,
    events: feed,
    lastEventId: feed.length ? (feed[feed.length - 1] as FeedItem).id : since,
  };
}

// ---------------------------------------------------------------------------
// Context for the narrator
// ---------------------------------------------------------------------------
function buildContext(me: Character, roll: number, action: string): string {
  const loc = getLocation(me.location_id) as NonNullable<ReturnType<typeof getLocation>>;
  const npcs = npcsAt(loc.id);
  const others = charactersAt(loc.id).filter((c) => c.id !== me.id);
  const facts = factsFor(loc.id);
  const quests = questsFor(me.id);
  const recent = recentEventsAt(loc.id, 10)
    .map((e) => {
      if (e.character_id === me.id && e.kind === 'action')
        return `- [${me.name} (acting character)] did: "${e.action.slice(0, 200)}" → ${e.narration.slice(0, 280)}`;
      if (e.kind === 'system') return `- [table] ${e.narration}`;
      return e.observable ? `- ${e.observable}` : '';
    })
    .filter(Boolean)
    .join('\n');
  const st = me.stats;
  return [
    `LOCATION: ${loc.name}: ${loc.description}`,
    `EXITS: ${loc.exits.map((id) => `${id} (${getLocation(id)?.name ?? id})`).join(', ') || 'none'}`,
    `NPCS HERE:\n${npcs.map((n) => `- [${n.id}] ${n.name} (${n.disposition}): ${n.description} Notes: ${n.notes}`).join('\n') || '- none'}`,
    `OTHER PLAYER CHARACTERS HERE (do not control them):\n${others.map((c) => `- ${c.name}: ${c.concept}; ${condition(c)}`).join('\n') || '- none'}`,
    `WORLD NOTES:\n${facts.map((f) => `- ${f}`).join('\n') || '- none'}`,
    `ACTING CHARACTER: ${me.name}: ${me.concept}. Might +${st.might}, Finesse +${st.finesse}, Wits +${st.wits}, Charm +${st.charm}. HP ${me.hp}/${me.max_hp} (${condition(me)}). Carrying: ${me.inventory.join(', ') || 'nothing'}.`,
    `CHARACTER MEMORY: ${me.summary || 'none yet'}`,
    `QUESTS: ${quests.map((q) => `${q.title} [${q.status}] ${q.note}`).join('; ') || 'none'}`,
    `RECENT SCENE (oldest first):\n${recent || '- nothing yet'}`,
    `HIDDEN d20 ROLL FOR THIS TURN: ${roll}`,
    `PLAYER ACTION (${me.name}): "${action}"`,
  ].join('\n\n');
}

// ---------------------------------------------------------------------------
// State extraction
// ---------------------------------------------------------------------------
interface Extraction {
  observable: string;
  hpChange: number;
  gained: string[];
  lost: string[];
  moveTo: string | null;
  facts: string[];
  npcUpdates: { id: string; disposition: string; note: string }[];
  questUpdates: { title: string; status: string; note: string }[];
}

const EMPTY_EXTRACTION: Extraction = { observable: '', hpChange: 0, gained: [], lost: [], moveTo: null, facts: [], npcUpdates: [], questUpdates: [] };

export function parseExtraction(raw: string): Extraction {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in extractor output');
  const o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? clean(v, max) : '');
  const strs = (v: unknown, n: number, max: number) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => clean(x, max)).filter(Boolean).slice(0, n) : [];
  const objs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null).slice(0, 5) : []);
  const hp = typeof o.hp_change === 'number' && Number.isFinite(o.hp_change) ? Math.max(-8, Math.min(8, Math.trunc(o.hp_change))) : 0;
  return {
    observable: str(o.observable_summary, 400),
    hpChange: hp,
    gained: strs(o.items_gained, 3, 40),
    lost: strs(o.items_lost, 3, 40),
    moveTo: typeof o.move_to === 'string' && o.move_to ? o.move_to.trim() : null,
    facts: strs(o.new_facts, 3, 160),
    npcUpdates: objs(o.npc_updates).map((n) => ({ id: str(n.id, 40), disposition: str(n.disposition, 24), note: str(n.note, 160) })),
    questUpdates: objs(o.quest_updates).map((q) => ({ title: str(q.title, 60), status: str(q.status, 10), note: str(q.note, 160) })),
  };
}

// ---------------------------------------------------------------------------
// The turn
// ---------------------------------------------------------------------------
export async function takeTurn(player: Player, characterId: string, rawAction: unknown, since: number) {
  const action = typeof rawAction === 'string' ? rawAction.replace(/\r/g, '').trim() : '';
  if (!action) throw new HttpError(400, 'Say what your character does.');
  if (action.length > 1000) throw new HttpError(400, 'Keep actions under 1000 characters.');
  const first = getCharacter(characterId);
  if (!first) throw new HttpError(404, 'Character not found.');
  if (first.player_id !== player.id) throw new HttpError(403, 'That is not your character.');
  if (inFlight.has(characterId)) throw new HttpError(409, 'Your last action is still resolving.');
  checkRateLimit(player.id);

  inFlight.add(characterId);
  try {
    const result = await withLock(first.location_id, async () => {
      const me = getCharacter(characterId) as Character;
      const loc = getLocation(me.location_id);
      if (!loc) throw new HttpError(500, 'Unknown location.');

      // Fresh settings inside the lock so an X-card or newcomer is honoured.
      const settings = sceneSettings(loc.id);
      const { model, rating } = resolveModel(player.model_id, settings.rating);
      const downgraded = settings.rating === 'adult' && rating !== 'adult';
      const roll = randomInt(1, 21);

      // 1) Narration, from the player's chosen model.
      const narrator = providerFor(model);
      let narration = (
        await narrator.complete(
          [
            { role: 'system', content: narratorSystemPrompt(rating, settings.blocked, settings.xcard) },
            { role: 'user', content: buildContext(me, roll, action) },
          ],
          { maxTokens: 700, temperature: 0.9 },
        )
      ).trim();
      if (!narration) throw new HttpError(502, 'The narrator returned nothing. Try again.');
      narration = narration.slice(0, 2500);

      // 2) State extraction (never sends adult-rated text to a model that isn't flagged for it).
      let ex = EMPTY_EXTRACTION;
      try {
        const extractorEntry = config.extractorModel ? getModel(config.extractorModel) : undefined;
        const extractorModel = extractorEntry && (rating !== 'adult' || extractorEntry.adultContent) ? extractorEntry : model;
        const exRaw = await providerFor(extractorModel).complete(
          [
            { role: 'system', content: EXTRACTOR_SYSTEM },
            {
              role: 'user',
              content: [
                `CHARACTER: ${me.name} (HP ${me.hp}/${me.max_hp}; carrying: ${me.inventory.join(', ') || 'nothing'})`,
                `EXITS (valid move_to ids): ${loc.exits.join(', ') || 'none'}`,
                `NPCS (valid ids): ${npcsAt(loc.id).map((n) => `${n.id}=${n.name}`).join(', ') || 'none'}`,
                `PLAYER ACTION: "${action.replace(/"/g, "'")}"`,
                `NARRATION:\n${narration}`,
              ].join('\n'),
            },
          ],
          { maxTokens: 500, temperature: 0.1 },
        );
        ex = parseExtraction(exRaw);
      } catch (err) {
        console.warn(`[engine] extraction failed for ${me.name}: ${(err as Error).message}`);
      }

      // 3) Apply state changes, validating everything the model claimed.
      const hp = Math.max(0, Math.min(me.max_hp, me.hp + ex.hpChange));
      const lostLower = new Set(ex.lost.map((s) => s.toLowerCase()));
      const inventory = me.inventory.filter((i) => !lostLower.has(i.toLowerCase()));
      for (const g of ex.gained) if (!inventory.some((i) => i.toLowerCase() === g.toLowerCase())) inventory.push(g);
      updateCharacter(me.id, { hp, inventory: inventory.slice(0, 30) });

      const validNpcs = new Set(npcsAt(loc.id).map((n) => n.id));
      for (const u of ex.npcUpdates) if (validNpcs.has(u.id)) updateNpc(u.id, { disposition: u.disposition || undefined, note: u.note || undefined });
      for (const f of ex.facts) addFact(loc.id, f);
      for (const q of ex.questUpdates)
        if (q.title && ['active', 'done', 'failed'].includes(q.status)) upsertQuest(me.id, q.title, q.status, q.note);

      addEvent({
        location_id: loc.id,
        character_id: me.id,
        kind: 'action',
        action,
        narration,
        observable: ex.observable,
        roll,
        rating,
      });

      // 4) Movement: only along a real exit.
      const dest = ex.moveTo && loc.exits.includes(ex.moveTo) ? getLocation(ex.moveTo) : undefined;
      if (dest) {
        addEvent({ location_id: loc.id, character_id: me.id, kind: 'depart', observable: `${me.name} leaves toward ${dest.name}.` });
        updateCharacter(me.id, { location_id: dest.id });
        addEvent({
          location_id: dest.id,
          character_id: me.id,
          kind: 'arrive',
          narration: `You arrive at ${dest.name}. ${dest.description}`,
          observable: `${me.name} arrives.`,
        });
      }
      return { roll, rating, model: model.id, downgraded };
    });

    void maybeSummarize(player, characterId).catch((e) => console.warn('[engine] summary failed:', (e as Error).message));
    return { ...result, scene: buildScene(characterId, since) };
  } finally {
    inFlight.delete(characterId);
  }
}

// ---------------------------------------------------------------------------
// X-card: anyone in the scene can cap it at the non-explicit rating for a while.
// ---------------------------------------------------------------------------
export function xcard(player: Player, characterId: string, since: number) {
  const me = getCharacter(characterId);
  if (!me) throw new HttpError(404, 'Character not found.');
  if (me.player_id !== player.id) throw new HttpError(403, 'That is not your character.');
  setCap(me.location_id, 'mature', Date.now() + config.xcardMinutes * 60_000);
  addEvent({
    location_id: me.location_id,
    character_id: null,
    kind: 'system',
    narration: 'Someone has called for a pause. The scene shifts to a gentler register.',
  });
  return buildScene(characterId, since);
}

// ---------------------------------------------------------------------------
// Long-term memory: compress old turns into a short per-character summary.
// ---------------------------------------------------------------------------
async function maybeSummarize(player: Player, characterId: string): Promise<void> {
  if (unsummarizedCount(characterId) < 24) return;
  const events = oldestUnsummarized(characterId, 16);
  const needsAdult = events.some((e) => e.rating === 'adult');
  const { model, rating } = resolveModel(player.model_id, needsAdult ? 'adult' : 'mature');
  if (needsAdult && rating !== 'adult') return; // no suitable model right now; try again later
  const me = getCharacter(characterId);
  if (!me) return;
  const text = await providerFor(model).complete(
    [
      { role: 'system', content: SUMMARY_SYSTEM },
      {
        role: 'user',
        content: `EXISTING MEMORY: ${me.summary || 'none'}\n\nNEW EVENTS:\n${events
          .map((e) => `- ${me.name}: "${e.action.slice(0, 160)}" → ${e.narration.slice(0, 300)}`)
          .join('\n')}`,
      },
    ],
    { maxTokens: 300, temperature: 0.3 },
  );
  if (!text.trim()) return;
  updateCharacter(characterId, { summary: text.trim().slice(0, 1200) });
  markSummarized(events.map((e) => e.id));
}
