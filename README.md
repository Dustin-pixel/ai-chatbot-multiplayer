# Shared Realms

A mobile AI dungeon master for several players at once. Everyone plays their own storyline in **one persistent world**; when two characters are in the same place they see each other, and the narrator knows about both.

- `server/` — backend (Node 22.18+, **zero npm dependencies**). World state in SQLite, model-agnostic. It also **serves the mobile web client** (`server/public/`), so one deployed URL is the whole game.
- `app/` — optional native Expo / React Native client (TypeScript), for later.

## Status: what was and wasn't tested

| Part | Status |
| --- | --- |
| Server logic (shared scenes, ratings, X-card, movement, state tracking, memory, rate limit) | **Tested**: `cd server && npm test` runs 15 end-to-end checks over real HTTP using a mock model |
| Real calls to Venice | **Not tested** (no API key or network here). Model ID `venice-uncensored-role-play` came from a third-party page; confirm it against `GET https://api.venice.ai/api/v1/models` |
| Mobile web client (`server/public`) | **Tested** in a headless phone-sized browser: two players sign up, see each other, act, and change settings |
| Dockerfile / `render.yaml` | **Not tested** (never deployed). Expect to adjust on first deploy |
| Native Expo app (`app/`) | **Written but never built or run**. Optional; the web client does the same job |

## Play from your phone with no computer

1. Put this repo on a host that runs Docker or Node 22. The included `Dockerfile` works on Render, Railway, Fly.io, Koyeb and similar.
   - **Render:** New → Blueprint → select this repo (uses `render.yaml`) → paste your `VENICE_API_KEY` when asked.
   - **Others:** point at `server/` as the build context and set the env vars below.
2. Environment variables: `VENICE_API_KEY` (required), `DB_PATH=/data/realms.db` with a **persistent disk mounted at `/data`** (without one, the world resets on every deploy/restart), optional `DEFAULT_MODEL`.
3. Open the service URL on your phone. On iPhone use Share → *Add to Home Screen*; on Android use the browser menu → *Add to Home screen* / *Install app*.
4. Share the URL with friends. Each person signs up and creates a character; they start in the same tavern and can meet.

Check each host's current pricing and free-tier limits (free tiers often sleep when idle and have no persistent disk).

## Run the server locally

```bash
cd server
cp .env.example .env        # add VENICE_API_KEY
node -v                     # must be >= 22.18
npm start                   # http://localhost:8787
npm test                    # mock-model smoke test, no key needed
```

## Run the native app (optional)

```bash
npx create-expo-app@latest realms-app --template blank-typescript
cd realms-app
npx expo install expo-secure-store react-native-safe-area-context
# copy App.tsx and the src/ folder from ./app over the generated ones
EXPO_PUBLIC_API_URL=http://<your-computer-LAN-ip>:8787 npx expo start
```

On a real phone `localhost` means the phone itself, so use your computer's LAN IP (or a deployed HTTPS URL).

## How it works

- **One world, many threads.** Locations, NPCs, world facts and every event live in SQLite. The model never relies on chat history for world truth; each turn it is handed the current slice: the location, who is here, recent scene events, the character's memory summary.
- **Players meeting.** Each action produces a private narration for the actor plus a short third-person `observable` line for bystanders. Other players in the same location see only that line, and the narrator for *their* next turn is told what happened.
- **No contradictions.** Turns are serialised per location, so simultaneous actions resolve in order.
- **Code owns the numbers.** The server rolls the d20, validates HP/inventory/moves/NPC changes the model reports, and only allows movement along real exits. A second model call extracts structured state from the narration.
- **Memory.** After 24 turns, older ones are condensed into a short per-character summary.

## Models

`server/models.json` lists models. Venice Role-Play Uncensored is the default; Venice general, a local OpenAI-compatible server (Ollama, llama.cpp, vLLM), OpenRouter and Claude are included but disabled until enabled and keyed. Add any OpenAI-compatible endpoint by copying an entry. Players pick their storyteller in Settings.

Each model has `adultContent: true/false`. **Adult-rated scenes are only ever routed to models flagged true**; if none is available the scene is downgraded to "mature". Don't flag a model `true` unless its provider's terms allow adult content. (Claude's usage policy does not, so it ships as `false`.)

## Content & safety design

- **Age gate:** 18+ date of birth and confirmation at signup.
- **Opt-in per player:** adult content is off by default, and a scene is only "adult" when **every** player in it has opted in. Otherwise it is "mature" (violence/horror OK, sex fades to black).
- **X-card:** the ✕ button caps the location at "mature" for 30 minutes and tells the narrator to steer away, no explanation needed.
- **Blocked themes:** per-player list, merged across everyone present.
- **Hard limits in the prompt:** characters in sexual contexts are adults; no sexual violence; sexual content involving another player's character requires them to have acted willingly.
- Bystanders never receive a player's private narration, only the sanitised `observable` line.

## Before you launch publicly

1. **Real age verification.** The DOB field is self-declared. Use a verification provider before public release.
2. **Independent moderation.** Prompt rules alone are not a safeguard. Run a classifier on player input and model output, especially for sexual content involving minors, and log/block violations.
3. **App stores.** Apple prohibits overtly sexual material and Google Play prohibits apps primarily built to provide sexually gratifying content, both enforced against AI chat apps in 2026. A PWA/web build, or a store build with adult mode off, avoids the issue. Check current policies and consider legal advice.
4. **Auth & hosting.** Replace the anonymous token signup with real accounts, serve over HTTPS, put the SQLite file on persistent storage (or move to Postgres), and use a shared lock (e.g. Redis) if you run more than one server instance.
5. **Privacy.** Roleplay logs are sensitive. Decide retention, add delete-my-data, and write a privacy policy.
6. **Cost controls.** Add per-player daily limits and a spending cap on your provider account.
