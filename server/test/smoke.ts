// End-to-end smoke test against the real HTTP server using the mock model.
// Run with: npm test
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/app.ts';
import { getCharacter } from '../src/db.ts';
import { loadModels, mockCalls } from '../src/models/registry.ts';
import { seedWorld } from '../src/seed.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type J = any;

seedWorld();
loadModels();
const server = createApp();
await new Promise<void>((r) => server.listen(0, r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

async function api(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; json: J }> {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${(err as Error).message}`);
    process.exitCode = 1;
    throw err;
  }
}

const STATS = { might: 2, finesse: 2, wits: 1, charm: 1 };
const lastNarration = () => mockCalls.filter((c) => !c.system.includes('GAME-STATE EXTRACTOR') && !c.system.includes('MEMORY KEEPER')).at(-1)!;

async function newPlayer(name: string): Promise<string> {
  const r = await api('POST', '/players', { name, birthDate: '1990-05-17' });
  assert.equal(r.status, 200);
  return r.json.token as string;
}
async function newChar(token: string, name: string): Promise<string> {
  const r = await api('POST', '/characters', { name, concept: 'wandering test fixture', stats: STATS }, token);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  return r.json.character.id as string;
}

try {
  console.log('Shared Realms smoke test');

  await test('serves the mobile web client and nothing else from disk', async () => {
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type') ?? '', /text\/html/);
    assert.match(home.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.match(await home.text(), /The Lantern Coast/);
    assert.equal((await fetch(base + '/manifest.webmanifest')).status, 200);
    assert.equal((await fetch(base + '/apple-touch-icon.png')).headers.get('content-type'), 'image/png');
    assert.equal((await fetch(base + '/%2e%2e/src/db.ts')).status, 404);
    assert.equal((await fetch(base + '/src/db.ts')).status, 404);
  });

  await test('age gate rejects under-18 and bad dates', async () => {
    const year = new Date().getUTCFullYear() - 10;
    assert.equal((await api('POST', '/players', { name: 'Kid', birthDate: `${year}-01-01` })).status, 403);
    assert.equal((await api('POST', '/players', { name: 'Bad', birthDate: 'yesterday' })).status, 400);
  });

  await test('endpoints require a token', async () => {
    assert.equal((await api('GET', '/characters')).status, 401);
    assert.equal((await api('GET', '/models', undefined, 'nope')).status, 401);
  });

  const tA = await newPlayer('Alice');
  const tB = await newPlayer('Bob');
  let cA = '';
  let cB = '';

  await test('character creation validates stats and starts at the tavern', async () => {
    const bad = await api('POST', '/characters', { name: 'Mira', concept: 'thief', stats: { might: 3, finesse: 3, wits: 3, charm: 3 } }, tA);
    assert.equal(bad.status, 400);
    cA = await newChar(tA, 'Mira');
    cB = await newChar(tB, 'Kael');
    const scene = (await api('GET', `/characters/${cA}/scene`, undefined, tA)).json;
    assert.equal(scene.location.id, 'gilded_eel');
    assert.deepEqual(scene.present.map((p: J) => p.name), ['Kael']);
    assert.ok(scene.npcs.length >= 2);
  });

  await test('players cannot read or act as each other', async () => {
    assert.equal((await api('GET', `/characters/${cA}/scene`, undefined, tB)).status, 403);
    assert.equal((await api('POST', `/characters/${cA}/turn`, { action: 'hi' }, tB)).status, 403);
  });

  await test('scene is "mature" until EVERY player present has opted in', async () => {
    assert.equal((await api('GET', `/characters/${cA}/scene`, undefined, tA)).json.rating, 'mature');
    await api('PATCH', '/players/me/settings', { adultContent: true }, tA);
    assert.equal((await api('GET', `/characters/${cA}/scene`, undefined, tA)).json.rating, 'mature', 'Bob has not opted in');
    await api('PATCH', '/players/me/settings', { adultContent: true }, tB);
    assert.equal((await api('GET', `/characters/${cA}/scene`, undefined, tA)).json.rating, 'adult');
  });

  await test('settings reject unknown models', async () => {
    assert.equal((await api('PATCH', '/players/me/settings', { modelId: 'does-not-exist' }, tA)).status, 400);
    assert.equal((await api('PATCH', '/players/me/settings', { modelId: 'mock' }, tA)).status, 200);
  });

  let sinceB = 0;
  await test("Alice's action is narrated to her and only summarised to Bob", async () => {
    const r = await api('POST', `/characters/${cA}/turn`, { action: 'I greet Marta warmly', since: 0 }, tA);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.rating, 'adult');
    assert.ok(r.json.roll >= 1 && r.json.roll <= 20);
    const mine = r.json.scene.events.filter((e: J) => e.mine && e.kind === 'action');
    assert.match(mine[0].text, /mock narration \| rating=adult/);

    const bob = (await api('GET', `/characters/${cB}/scene?since=0`, undefined, tB)).json;
    const seen = bob.events.find((e: J) => !e.mine && e.actor === 'Mira');
    assert.ok(seen, 'Bob should see Mira acting');
    assert.match(seen.text, /Mira does something/);
    assert.ok(!bob.events.some((e: J) => /mock narration/.test(e.text)), "Bob must not receive Alice's private narration");
    sinceB = bob.lastEventId;
  });

  await test("Bob's narrator is told what Alice just did (shared world)", async () => {
    const r = await api('POST', `/characters/${cB}/turn`, { action: 'I nod at the stranger', since: sinceB }, tB);
    assert.equal(r.status, 200);
    const ctx = lastNarration().user;
    assert.match(ctx, /RECENT SCENE[\s\S]*Mira does something: I greet Marta warmly/);
    assert.match(ctx, /OTHER PLAYER CHARACTERS HERE \(do not control them\):\n- Mira/);
  });

  await test('simultaneous turns in one location both resolve', async () => {
    const [a, b] = await Promise.all([
      api('POST', `/characters/${cA}/turn`, { action: 'I order two ales' }, tA),
      api('POST', `/characters/${cB}/turn`, { action: 'I check my belt knife' }, tB),
    ]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
  });

  await test('double-submit by the same character is rejected, not duplicated', async () => {
    const rs = await Promise.all([
      api('POST', `/characters/${cA}/turn`, { action: 'I look around' }, tA),
      api('POST', `/characters/${cA}/turn`, { action: 'I look around again' }, tA),
    ]);
    const statuses = rs.map((r) => r.status).sort();
    assert.ok(statuses.every((s) => s === 200 || s === 409), String(statuses));
    assert.ok(statuses.includes(200));
  });

  await test('X-card caps the scene at "mature" and tells the narrator', async () => {
    const r = await api('POST', `/characters/${cB}/xcard`, {}, tB);
    assert.equal(r.status, 200);
    assert.equal(r.json.rating, 'mature');
    assert.equal(r.json.xcardActive, true);
    assert.ok(r.json.events.some((e: J) => e.kind === 'system'));
    const t = await api('POST', `/characters/${cA}/turn`, { action: 'I keep talking' }, tA);
    assert.match(t.json.scene.events.at(-1).text, /rating=mature/);
    assert.match(lastNarration().system, /called a pause/);
  });

  await test('state extraction: HP, inventory and world facts are applied', async () => {
    const r = await api('POST', `/characters/${cB}/turn`, { action: 'I punch the post, then pick up the coin and remember this', since: 0 }, tB);
    assert.equal(r.status, 200);
    const ch = getCharacter(cB)!;
    assert.equal(ch.hp, 17);
    assert.ok(ch.inventory.includes('mystery trinket'));
    assert.ok(r.json.scene.character.hp === 17);
  });

  await test('movement follows real exits and other players see departures and arrivals', async () => {
    const m = await api('POST', `/characters/${cA}/turn`, { action: 'go to saltmarket', since: 0 }, tA);
    assert.equal(m.json.scene.location.id, 'saltmarket');
    const bobFeed = (await api('GET', `/characters/${cB}/scene?since=0`, undefined, tB)).json;
    assert.ok(bobFeed.events.some((e: J) => /Mira leaves toward Saltmarket Docks/.test(e.text)));

    // An invalid destination (not an exit of saltmarket) must not move anyone.
    const bad = await api('POST', `/characters/${cA}/turn`, { action: 'go to abbey', since: 0 }, tA);
    assert.equal(bad.json.scene.location.id, 'saltmarket');

    // Bob follows, so the two meet at the docks.
    const f = await api('POST', `/characters/${cB}/turn`, { action: 'go to saltmarket', since: 0 }, tB);
    assert.equal(f.json.scene.location.id, 'saltmarket');
    assert.deepEqual(f.json.scene.present.map((p: J) => p.name), ['Mira']);
    const aliceFeed = (await api('GET', `/characters/${cA}/scene?since=0`, undefined, tA)).json;
    assert.ok(aliceFeed.events.some((e: J) => !e.mine && /Kael arrives/.test(e.text)));
  });

  await test('adult scenes are routed only to adult-capable models', async () => {
    const tC = await newPlayer('Cleo');
    const cC = await newChar(tC, 'Dax');
    await api('PATCH', '/players/me/settings', { adultContent: true, modelId: 'mock-safe' }, tC);
    // The tavern is still under Bob's X-card (30 min cap), so Cleo's first turn there stays "mature".
    const capped = await api('POST', `/characters/${cC}/turn`, { action: 'go to old_road' }, tC);
    assert.equal(capped.json.rating, 'mature');
    assert.equal(capped.json.scene.location.id, 'old_road');
    // On the road (alone, opted in, no cap) the scene is adult.
    const r = await api('POST', `/characters/${cC}/turn`, { action: 'I sit by the milestone' }, tC);
    assert.equal(r.json.rating, 'adult');
    assert.equal(r.json.model, 'mock', 'mock-safe is not flagged adultContent, so the engine must route elsewhere');
  });

  await test('memory summaries kick in and the rate limit holds', async () => {
    const tD = await newPlayer('Dora');
    const cD = await newChar(tD, 'Zed');
    let limited = false;
    for (let i = 0; i < 32; i++) {
      const r = await api('POST', `/characters/${cD}/turn`, { action: `step ${i}` }, tD);
      if (r.status === 429) {
        limited = true;
        break;
      }
      assert.equal(r.status, 200);
    }
    assert.ok(limited, 'expected a 429 after 30 turns in a minute');
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(getCharacter(cD)!.summary, 'Mock memory summary.');
  });

  // ------------------------------------------------------------------ worlds from stories
  const tW = await newPlayer('Wren');
  let world: J = null;
  let suggestion: J = null;
  const hubId = () => world.id as string;

  await test('builds a world from a story: capped at mature, repaired map, share code', async () => {
    const r = await api('POST', '/worlds', { reference: 'Test Franchise' }, tW);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    world = r.json;
    assert.equal(world.name, 'Test Franchise Realm');
    assert.equal(world.maxRating, 'mature', 'generated worlds must never allow adult scenes');
    assert.match(world.code, /^[A-Z2-9]{6}$/);
    assert.equal(world.statLabels.might.label, 'Power');
    assert.ok(world.mine);
  });

  await test('unknown stories need notes; four builds in a minute are refused', async () => {
    const unknown = await api('POST', '/worlds', { reference: 'Unknown Story' }, tW);
    assert.equal(unknown.status, 422);
    const withNotes = await api('POST', '/worlds', { reference: 'Unknown Story', notes: 'A seaside village where every villager hides a small, odd talent they are ashamed of.' }, tW);
    assert.equal(withNotes.status, 200, JSON.stringify(withNotes.json));
    assert.equal((await api('POST', '/worlds', { reference: 'Another' }, tW)).status, 429);
    assert.equal((await api('POST', '/worlds', { reference: '' }, tW)).status, 400);
  });

  await test('advisor normalises stats to 6 and caps abilities/items', async () => {
    const r = await api('POST', `/worlds/${hubId()}/suggest`, { concept: 'a calm swordsman with a dangerous secret' }, tW);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    suggestion = r.json;
    const vals = Object.values(suggestion.stats) as number[];
    assert.equal(vals.reduce((a, b) => a + b, 0), 6);
    assert.ok(vals.every((v) => Number.isInteger(v) && v >= 0 && v <= 3));
    assert.equal(suggestion.abilities.length, 3);
    assert.ok(suggestion.abilities.every((a: J) => a.limit.length > 0), 'every ability must carry a limit');
    assert.equal(suggestion.items.length, 3);
    assert.equal((await api('POST', `/worlds/${hubId()}/suggest`, { concept: 'x' }, tW)).status, 400);
  });

  let cW = '';
  await test('character starts at the world hub with abilities; map was repaired', async () => {
    const r = await api('POST', '/characters', { worldId: hubId(), name: 'Sora', concept: 'calm swordsman', stats: suggestion.stats, abilities: [...suggestion.abilities, suggestion.abilities[0], suggestion.abilities[0]], items: suggestion.items }, tW);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    cW = r.json.character.id;
    assert.equal(r.json.world.id, hubId());
    assert.equal(r.json.location.name, 'Academy Gate');
    assert.deepEqual(r.json.exits.map((e: J) => e.name).sort(), ['Cellar', 'Courtyard'], 'stranded cellar must be linked to the hub, bad exit dropped');
    assert.equal(r.json.character.abilities.length, 3);
    assert.deepEqual(r.json.character.inventory, suggestion.items);
    assert.match(r.json.events[0].text, /Welcome to Test Franchise Realm/);
    const courtyard = r.json.exits.find((e: J) => e.name === 'Courtyard');
    const m = await api('POST', `/characters/${cW}/turn`, { action: `go to ${courtyard.id}`, since: 0 }, tW);
    assert.equal(m.json.scene.location.name, 'Courtyard');
    assert.deepEqual(m.json.scene.exits.map((e: J) => e.name).sort(), ['Academy Gate', 'Library'], 'one-way exit must be made two-way');
    assert.ok(m.json.scene.npcs.some((n: J) => n.name === 'Sensei'));
    const back = await api('POST', `/characters/${cW}/turn`, { action: 'go to ' + m.json.scene.exits.find((e: J) => e.name === 'Academy Gate').id, since: 0 }, tW);
    assert.ok(back.json.scene.npcs.some((n: J) => n.name === 'Ghost'), 'NPC placed in a missing room falls back to the hub');
  });

  await test('narrator is given the world rules, labels, ability limits and the minors safeguard', async () => {
    await api('POST', `/characters/${cW}/turn`, { action: 'I look around' }, tW);
    const { system, user } = lastNarration();
    assert.match(system, /Dungeon Master of "Test Franchise Realm"/);
    assert.match(system, /inspired by another story[\s\S]*minor/);
    assert.match(user, /WORLD RULES: Powers cost stamina\./);
    assert.match(user, /Power \+\d, Technique \+\d, Cunning \+\d, Presence \+\d/);
    assert.match(user, /ABILITIES \(honour the limits\): Shadow Step: .* LIMIT: Only in dim light\./);
  });

  await test('even when everyone opts in, a story-based world stays mature', async () => {
    const tX = await newPlayer('Xan');
    const byCode = await api('GET', `/worlds/by-code/${world.code.toLowerCase()}`, undefined, tX);
    assert.equal(byCode.status, 200);
    const cX = (await api('POST', '/characters', { worldId: byCode.json.id, name: 'Xander', concept: 'new student', stats: STATS }, tX)).json.character.id;
    await api('PATCH', '/players/me/settings', { adultContent: true }, tX);
    await api('PATCH', '/players/me/settings', { adultContent: true }, tW);
    const scene = (await api('GET', `/characters/${cX}/scene`, undefined, tX)).json;
    assert.deepEqual(scene.present.map((p: J) => p.name), ['Sora']);
    assert.equal(scene.rating, 'mature');
    assert.equal(scene.world.maxRating, 'mature');
    const t = await api('POST', `/characters/${cX}/turn`, { action: 'I introduce myself' }, tX);
    assert.equal(t.json.rating, 'mature');
    assert.match(t.json.scene.events.at(-1).text, /rating=mature/);
  });

  await test('worlds are isolated and only listed to people connected to them', async () => {
    const stranger = await newPlayer('Stranger');
    const list = (await api('GET', '/worlds', undefined, stranger)).json as J[];
    assert.deepEqual(list.map((w) => w.id), ['lantern_coast']);
    const mine = (await api('GET', '/worlds', undefined, tW)).json as J[];
    assert.ok(mine.some((w) => w.id === 'lantern_coast') && mine.some((w) => w.id === hubId()));
    assert.equal((await api('GET', '/worlds/by-code/ZZZZZZ', undefined, stranger)).status, 404);
    assert.equal((await api('POST', '/characters', { worldId: 'nope', name: 'Nobody', concept: 'lost soul', stats: STATS }, stranger)).status, 404);
  });

  console.log(`\nAll ${passed} checks passed.`);
} catch {
  console.error('\nSmoke test failed.');
} finally {
  server.close();
  process.exit(process.exitCode ?? 0);
}
