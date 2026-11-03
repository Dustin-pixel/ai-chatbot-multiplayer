import { createApp } from './app.ts';
import { config } from './config.ts';
import { seedWorld } from './seed.ts';
import { listAvailable, loadModels } from './models/registry.ts';

seedWorld();
loadModels();

createApp().listen(config.port, () => {
  const models = listAvailable().map((m) => m.id);
  console.log(`Shared Realms server listening on :${config.port}`);
  console.log(`Available models: ${models.join(', ') || 'NONE (set VENICE_API_KEY in .env)'}`);
  console.log(`Default model: ${config.defaultModel}`);
});
