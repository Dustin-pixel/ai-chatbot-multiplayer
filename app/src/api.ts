import type { CharacterSummary, ModelInfo, PlayerInfo, Scene, Stats, TurnResult } from './types';

// On a physical phone, localhost is the phone itself. Use your computer's LAN IP, e.g.
// EXPO_PUBLIC_API_URL=http://192.168.1.20:8787 (or your deployed server's https URL).
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8787';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let token: string | null = null;
export const setToken = (t: string | null) => {
  token = t;
};

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 20_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(API_URL + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
    return data as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === 'AbortError') throw new ApiError(0, 'The server took too long to respond.');
    throw new ApiError(0, `Could not reach the server at ${API_URL}.`);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  register: (name: string, birthDate: string) =>
    request<{ token: string; player: PlayerInfo }>('POST', '/players', { name, birthDate }),
  me: () => request<PlayerInfo>('GET', '/players/me'),
  updateSettings: (patch: { adultContent?: boolean; blockedThemes?: string[]; modelId?: string | null }) =>
    request<PlayerInfo>('PATCH', '/players/me/settings', patch),
  models: () => request<ModelInfo[]>('GET', '/models'),
  characters: () => request<CharacterSummary[]>('GET', '/characters'),
  createCharacter: (name: string, concept: string, stats: Stats) =>
    request<Scene>('POST', '/characters', { name, concept, stats }),
  scene: (id: string, since: number) => request<Scene>('GET', `/characters/${id}/scene?since=${since}`),
  // LLM turns can be slow: allow two minutes.
  turn: (id: string, action: string, since: number) =>
    request<TurnResult>('POST', `/characters/${id}/turn`, { action, since }, 120_000),
  xcard: (id: string, since: number) => request<Scene>('POST', `/characters/${id}/xcard`, { since }),
};
