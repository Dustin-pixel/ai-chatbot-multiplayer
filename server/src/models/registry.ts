import { readFileSync } from 'node:fs';
import { config } from '../config.ts';
import type { ChatMessage, CompleteOptions, Provider } from '../types.ts';

/** One entry in models.json. */
export interface ModelEntry {
  id: string;
  label: string;
  type: 'openai' | 'anthropic' | 'mock';
  baseUrl?: string;
  apiKeyEnv?: string | null;
  model?: string;
  /** May this model be sent scenes rated "adult"? Enforced by the engine. */
  adultContent: boolean;
  enabled: boolean;
  extraBody?: Record<string, unknown>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

/** Some reasoning models wrap chain-of-thought in <think> tags; never show it to players. */
const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

async function postJson(url: string, headers: Record<string, string>, body: unknown, label: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      if (attempt < 2) {
        await sleep(800 * 2 ** attempt);
        continue;
      }
      throw new Error(`${label}: network error (${(err as Error).message})`);
    }
    if (res.ok) return res.json();
    if (RETRY_STATUS.has(res.status) && attempt < 2) {
      await sleep(800 * 2 ** attempt);
      continue;
    }
    throw new Error(`${label}: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  }
}

function openAiProvider(entry: ModelEntry): Provider {
  const key = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined;
  return {
    async complete(messages: ChatMessage[], opts: CompleteOptions) {
      const data = (await postJson(
        `${(entry.baseUrl ?? '').replace(/\/$/, '')}/chat/completions`,
        key ? { authorization: `Bearer ${key}` } : {},
        {
          model: entry.model,
          messages,
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          ...(entry.extraBody ?? {}),
        },
        entry.id,
      )) as { choices?: { message?: { content?: string } }[] };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new Error(`${entry.id}: response had no message content`);
      return stripThinking(text);
    },
  };
}

function anthropicProvider(entry: ModelEntry): Provider {
  const key = entry.apiKeyEnv ? process.env[entry.apiKeyEnv] : undefined;
  return {
    async complete(messages: ChatMessage[], opts: CompleteOptions) {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const convo = messages.filter((m) => m.role !== 'system');
      const data = (await postJson(
        `${(entry.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`,
        { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' },
        {
          model: entry.model,
          max_tokens: opts.maxTokens,
          temperature: Math.min(opts.temperature, 1),
          system,
          messages: convo,
        },
        entry.id,
      )) as { content?: { type: string; text?: string }[] };
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('');
      if (!text) throw new Error(`${entry.id}: response had no text`);
      return stripThinking(text);
    },
  };
}

// ---------------------------------------------------------------------------
// Mock provider: deterministic, used by the smoke tests (ENABLE_MOCK=1).
// ---------------------------------------------------------------------------
export const mockCalls: { system: string; user: string }[] = [];

function mockProvider(): Provider {
  return {
    async complete(messages: ChatMessage[]) {
      const system = messages.find((m) => m.role === 'system')?.content ?? '';
      const user = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
      mockCalls.push({ system, user });

      if (system.includes('GAME-STATE EXTRACTOR')) {
        const name = /CHARACTER: (.+?) \(/.exec(user)?.[1] ?? 'Someone';
        const action = /PLAYER ACTION: "(.*)"/.exec(user)?.[1] ?? '';
        const move = /go to (\w+)/.exec(action)?.[1] ?? null;
        return JSON.stringify({
          observable_summary: `${name} does something: ${action}`,
          hp_change: /\bpunch/.test(action) ? -3 : 0,
          items_gained: /\bpick up/.test(action) ? ['mystery trinket'] : [],
          items_lost: [],
          move_to: move,
          new_facts: /\bremember/.test(action) ? ['A mock fact was recorded.'] : [],
          npc_updates: [],
          quest_updates: [],
        });
      }
      if (system.includes('WORLD ARCHITECT')) {
        const ref = /REFERENCE: (.*)/.exec(user)?.[1] ?? 'Mock';
        const lab = (label: string, hint: string) => ({ label, hint });
        return JSON.stringify({
          recognized: !/unknown/i.test(ref),
          name: `${ref} Realm`,
          premise: `A test world inspired by ${ref}.`,
          tone: 'Test tone.',
          rules: 'Powers cost stamina.',
          stat_labels: { might: lab('Power', 'Raw force'), finesse: lab('Technique', 'Skill'), wits: lab('Cunning', 'Tactics'), charm: lab('Presence', 'Aura') },
          // Deliberately messy: one-way exits, a stranded room, a bad exit id, an NPC in a missing room.
          locations: [
            { id: 'Academy Gate', name: 'Academy Gate', description: 'The hub.', exits: ['courtyard'] },
            { id: 'courtyard', name: 'Courtyard', description: 'Open yard.', exits: ['academy_gate', 'library'] },
            { id: 'library', name: 'Library', description: 'Quiet.', exits: [] },
            { id: 'cellar', name: 'Cellar', description: 'Dark.', exits: ['nonexistent'] },
          ],
          npcs: [
            { id: 'sensei', name: 'Sensei', description: 'A teacher.', location: 'courtyard', disposition: 'friendly', notes: '' },
            { id: 'ghost', name: 'Ghost', description: 'Spooky.', location: 'nowhere', disposition: 'wary', notes: '' },
          ],
          facts: ['A test fact.'],
        });
      }
      if (system.includes('CHARACTER ADVISOR')) {
        return JSON.stringify({
          name: null,
          stats: { might: 3, finesse: 3, wits: 3, charm: 3 }, // sums to 12: must be normalised to 6
          abilities: [
            { name: 'Shadow Step', description: 'Slip between shadows.', limit: 'Only in dim light.' },
            { name: 'Second', description: 'b', limit: '' },
            { name: 'Third', description: 'c', limit: 'x' },
            { name: 'Fourth', description: 'd', limit: 'y' },
          ],
          items: ['a', 'b', 'c', 'd', 'e'],
          note: 'Fits the concept.',
        });
      }
      if (system.includes('MEMORY KEEPER')) return 'Mock memory summary.';
      const rating = /SCENE RATING: (\w+)/.exec(system)?.[1]?.toLowerCase() ?? '?';
      return `[mock narration | rating=${rating}] The world responds.`;
    },
  };
}

// ---------------------------------------------------------------------------
let entries: ModelEntry[] | null = null;

export function loadModels(): ModelEntry[] {
  if (entries) return entries;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(config.modelsFile, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${config.modelsFile}: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) throw new Error('models.json must be an array');
  const out: ModelEntry[] = [];
  for (const raw of parsed as Record<string, unknown>[]) {
    if (typeof raw.id !== 'string' || typeof raw.type !== 'string') throw new Error('models.json: each entry needs id and type');
    out.push({
      id: raw.id,
      label: typeof raw.label === 'string' ? raw.label : raw.id,
      type: raw.type as ModelEntry['type'],
      baseUrl: raw.baseUrl as string | undefined,
      apiKeyEnv: (raw.apiKeyEnv as string | null | undefined) ?? null,
      model: raw.model as string | undefined,
      adultContent: raw.adultContent === true,
      enabled: raw.enabled !== false,
      extraBody: raw.extraBody as Record<string, unknown> | undefined,
    });
  }
  if (config.enableMock) {
    out.push({ id: 'mock', label: 'Mock (testing)', type: 'mock', adultContent: true, enabled: true });
    out.push({ id: 'mock-safe', label: 'Mock non-adult (testing)', type: 'mock', adultContent: false, enabled: true });
  }
  entries = out;
  return out;
}

/** A model is available if enabled and, when it needs a key, that key is set. */
export function isAvailable(e: ModelEntry): boolean {
  if (!e.enabled) return false;
  if (e.type === 'mock') return true;
  return !e.apiKeyEnv || Boolean(process.env[e.apiKeyEnv]);
}

export function listAvailable(): ModelEntry[] {
  return loadModels().filter(isAvailable);
}

export function getModel(id: string): ModelEntry | undefined {
  return listAvailable().find((m) => m.id === id);
}

const providers = new Map<string, Provider>();
export function providerFor(entry: ModelEntry): Provider {
  let p = providers.get(entry.id);
  if (!p) {
    p = entry.type === 'anthropic' ? anthropicProvider(entry) : entry.type === 'mock' ? mockProvider() : openAiProvider(entry);
    providers.set(entry.id, p);
  }
  return p;
}
