import { existsSync } from 'node:fs';

// Load .env if present (Node 22 built-in; no dotenv dependency).
if (existsSync('.env')) process.loadEnvFile('.env');

export const config = {
  port: Number(process.env.PORT ?? 8787),
  dbPath: process.env.DB_PATH ?? 'realms.db',
  modelsFile: process.env.MODELS_FILE ?? 'models.json',
  /** Model id (from models.json) used when a player hasn't picked one. */
  defaultModel: process.env.DEFAULT_MODEL ?? 'venice-rp',
  /** Optional separate model for JSON state extraction. Empty = same model as narration. */
  extractorModel: process.env.EXTRACTOR_MODEL ?? '',
  enableMock: process.env.ENABLE_MOCK === '1',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  minAge: 18,
  /** How long an X-card caps a location at the non-explicit rating. */
  xcardMinutes: 30,
  turnsPerMinute: Number(process.env.TURNS_PER_MINUTE ?? 20),
  startLocation: 'gilded_eel',
} as const;
