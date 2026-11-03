import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { config } from './config.ts';
import {
  createPlayer,
  getCharacter,
  getPlayerByTokenHash,
  getWorld,
  getWorldByCode,
  listCharacters,
  listWorldsFor,
  updatePlayerSettings,
} from './db.ts';
import { HttpError, buildScene, startCharacter, takeTurn, xcard } from './engine.ts';
import { getModel, listAvailable } from './models/registry.ts';
import { generateWorld, suggestCharacter } from './worldgen.ts';
import type { Player, World } from './types.ts';

interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  player: Player | null;
}
type Handler = (ctx: Ctx) => unknown | Promise<unknown>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  auth: boolean;
  handler: Handler;
}

const routes: Route[] = [];
function route(method: string, path: string, auth: boolean, handler: Handler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    '^' +
      path.replace(/:([a-z]+)/gi, (_m, k: string) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '/?$',
  );
  routes.push({ method, pattern, keys, auth, handler });
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const me = (ctx: Ctx): Player => {
  if (!ctx.player) throw new HttpError(401, 'Missing or invalid token.');
  return ctx.player;
};
const sinceOf = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};
const ownCharacter = (ctx: Ctx) => {
  const ch = getCharacter(ctx.params.id ?? '');
  if (!ch) throw new HttpError(404, 'Character not found.');
  if (ch.player_id !== me(ctx).id) throw new HttpError(403, 'That is not your character.');
  return ch;
};
const publicPlayer = (p: Player) => ({
  id: p.id,
  name: p.name,
  adultContent: p.adult_content === 1,
  blockedThemes: p.blocked_themes,
  modelId: p.model_id,
});

const worldView = (w: World, viewer: Player) => ({
  id: w.id,
  code: w.code,
  name: w.name,
  premise: w.premise,
  tone: w.tone,
  reference: w.reference,
  maxRating: w.max_rating,
  statLabels: w.stat_labels,
  mine: w.owner_player_id === viewer.id,
});

function ageOn(birthDate: string, today = new Date()): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age--;
  return age;
}

// ---------- routes ----------
route('GET', '/health', false, () => ({ ok: true, models: listAvailable().map((m) => m.id) }));

route('GET', '/models', true, () =>
  listAvailable().map((m) => ({ id: m.id, label: m.label, adultContent: m.adultContent })),
);

route('POST', '/players', false, (ctx) => {
  const name = typeof ctx.body.name === 'string' ? ctx.body.name.replace(/\s+/g, ' ').trim().slice(0, 24) : '';
  const birth = typeof ctx.body.birthDate === 'string' ? ctx.body.birthDate : '';
  if (name.length < 2) throw new HttpError(400, 'Pick a display name (2-24 characters).');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birth) || Number.isNaN(Date.parse(birth))) throw new HttpError(400, 'birthDate must be YYYY-MM-DD.');
  const age = ageOn(birth);
  if (age < 0 || age > 120) throw new HttpError(400, 'That birth date does not look right.');
  if (age < config.minAge) throw new HttpError(403, 'You must be 18 or older to use this app.');
  const token = randomBytes(32).toString('hex');
  const player = createPlayer(name, birth, sha256(token));
  return { token, player: publicPlayer(player) };
});

route('GET', '/players/me', true, (ctx) => publicPlayer(me(ctx)));

route('PATCH', '/players/me/settings', true, (ctx) => {
  const p = me(ctx);
  const patch: Parameters<typeof updatePlayerSettings>[1] = {};
  if (ctx.body.adultContent !== undefined) {
    if (typeof ctx.body.adultContent !== 'boolean') throw new HttpError(400, 'adultContent must be true or false.');
    patch.adult_content = ctx.body.adultContent;
  }
  if (ctx.body.blockedThemes !== undefined) {
    const t = ctx.body.blockedThemes;
    if (!Array.isArray(t) || t.length > 12 || !t.every((x) => typeof x === 'string'))
      throw new HttpError(400, 'blockedThemes must be a list of up to 12 short strings.');
    patch.blocked_themes = (t as string[]).map((x) => x.trim().slice(0, 40)).filter(Boolean);
  }
  if (ctx.body.modelId !== undefined) {
    if (ctx.body.modelId === null) patch.model_id = null;
    else if (typeof ctx.body.modelId === 'string' && getModel(ctx.body.modelId)) patch.model_id = ctx.body.modelId;
    else throw new HttpError(400, 'Unknown or unavailable model.');
  }
  return publicPlayer(updatePlayerSettings(p.id, patch));
});

route('GET', '/worlds', true, (ctx) => listWorldsFor(me(ctx).id).map((w) => worldView(w, me(ctx))));

route('GET', '/worlds/by-code/:code', true, (ctx) => {
  const w = getWorldByCode(ctx.params.code ?? '');
  if (!w) throw new HttpError(404, 'No world with that code.');
  return worldView(w, me(ctx));
});

// Slow (one LLM call): builds a playable world from a story. Generated worlds are capped at "mature".
route('POST', '/worlds', true, async (ctx) =>
  worldView(await generateWorld(me(ctx), ctx.body.reference, ctx.body.notes), me(ctx)),
);

route('POST', '/worlds/:id/suggest', true, async (ctx) => {
  const w = getWorld(ctx.params.id ?? '');
  if (!w) throw new HttpError(404, 'World not found.');
  return suggestCharacter(me(ctx), w, ctx.body.concept);
});

route('GET', '/characters', true, (ctx) =>
  listCharacters(me(ctx).id).map((c) => ({ id: c.id, name: c.name, concept: c.concept, hp: c.hp, max_hp: c.max_hp, location_id: c.location_id })),
);

route('POST', '/characters', true, (ctx) => {
  const ch = startCharacter(me(ctx), {
    name: ctx.body.name,
    concept: ctx.body.concept,
    stats: ctx.body.stats,
    worldId: ctx.body.worldId,
    abilities: ctx.body.abilities,
    items: ctx.body.items,
  });
  return buildScene(ch.id, 0);
});

route('GET', '/characters/:id/scene', true, (ctx) => buildScene(ownCharacter(ctx).id, sinceOf(ctx.query.get('since'))));

route('POST', '/characters/:id/turn', true, async (ctx) => {
  const ch = ownCharacter(ctx);
  return takeTurn(me(ctx), ch.id, ctx.body.action, sinceOf(ctx.body.since));
});

route('POST', '/characters/:id/xcard', true, (ctx) => xcard(me(ctx), ownCharacter(ctx).id, sinceOf(ctx.body.since)));

// ---------- server plumbing ----------
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64 * 1024) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('not an object');
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Body must be a JSON object.');
  }
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'access-control-allow-origin': config.corsOrigin,
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
  });
  res.end(data);
}

// ---------- static web client (whitelist only: no path traversal possible) ----------
const PUBLIC_DIR = new URL('../public/', import.meta.url);
const STATIC: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json' },
  '/icon.svg': { file: 'icon.svg', type: 'image/svg+xml' },
  '/apple-touch-icon.png': { file: 'apple-touch-icon.png', type: 'image/png' },
};

function sendStatic(res: ServerResponse, entry: { file: string; type: string }): void {
  const data = readFileSync(new URL(entry.file, PUBLIC_DIR));
  res.writeHead(200, {
    'content-type': entry.type,
    'content-length': data.length,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy':
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
  });
  res.end(data);
}

export function createApp(): Server {
  return createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') return send(res, 204, {});
      const url = new URL(req.url ?? '/', 'http://localhost');
      const asset = req.method === 'GET' ? STATIC[url.pathname] : undefined;
      if (asset) return sendStatic(res, asset);
      let matchedPath = false;
      for (const r of routes) {
        const m = r.pattern.exec(url.pathname);
        if (!m) continue;
        matchedPath = true;
        if (r.method !== req.method) continue;

        let player: Player | null = null;
        const auth = req.headers.authorization ?? '';
        if (auth.startsWith('Bearer ')) player = getPlayerByTokenHash(sha256(auth.slice(7).trim())) ?? null;
        if (r.auth && !player) throw new HttpError(401, 'Missing or invalid token.');

        const params: Record<string, string> = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
        const body = req.method === 'GET' ? {} : await readJson(req);
        return send(res, 200, await r.handler({ params, query: url.searchParams, body, player }));
      }
      throw new HttpError(matchedPath ? 405 : 404, matchedPath ? 'Method not allowed.' : 'Not found.');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error('[server] unexpected error:', err);
      send(res, 500, { error: 'Something went wrong on our side.' });
    }
  });
}
