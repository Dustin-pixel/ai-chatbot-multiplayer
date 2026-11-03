# Shared Realms

A mobile AI dungeon master for several players at once. Everyone plays their own storyline in **one persistent world**; when two characters are in the same place they see each other, and the narrator knows about both.

- `server/` — backend (Node 22.18+, **zero npm dependencies**). World state in SQLite, model-agnostic. It also **serves the mobile web client** (`server/public/`), so one deployed URL is the whole game.
- `app/` — optional native Expo / React Native client (TypeScript), for later.

## Status: what was and wasn't tested

| Part | Status |
| --- | --- |
| Server logic (shared scenes, ratings, X-card, movement, state tracking, memory, rate limit) | **Tested**: `cd server && npm test` runs 23 end-to-end checks over real HTTP using a mock model |
| Worlds from stories: plumbing (validation, map repair, caps, stat normalisation, UI flow) | **Tested** with the mock model |
| Worlds from stories: quality of what a real model produces | **Not tested.** Depends on how well the model knows the series; expect to iterate on `WORLD_ARCHITECT_SYSTEM` in `server/src/prompts.ts` |
| Real calls to Venice | **Not tested** (no API key or network here). Model ID `venice-uncensored-role-play` came from a third-party page; confirm it against `GET https://api.venice.ai/api/v1/models` |
| Mobile web client (`server/public`) | **Tested** in a headless phone-sized browser: two players sign up, see each other, act, and change settings |
| Dockerfile / `render.yaml` | **Not tested** (never deployed). Expect to adjust on first deploy |
| Native Expo app (`app/`) | **Written but never built or run**, and it does **not** have the worlds feature yet. Use the web client |

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

## Worlds from stories (JJK, My Hero Academia, anything)

On the world screen, name a story (and optionally add notes like "start at the very beginning"). The storyteller model designs a playable world from it: premise, tone, **power-system rules with built-in costs and limits**, renamed stats (e.g. Might becomes Power), 6-8 connected locations, notable NPCs and story hooks. Everything the model returns is validated and repaired by the server (unique ids, real two-way exits, no stranded rooms, NPCs placed in real rooms, length caps).

Then describe your character ("calm swordsman with a dangerous secret") and tap **Suggest stats & abilities**. The advisor proposes a 6-point stat spread (re-balanced by code if the model gets the maths wrong) plus 1-3 abilities, each with a concrete limit the narrator must honour, and a few starting items. You can edit the stats before you begin. Characters start at an early, limited point, so nobody starts as a canon powerhouse.

Each world has a 6-character **share code** (shown in Settings). Friends enter it to join the same world and meet in it. Worlds are listed only to people who own them or already have a character there; other worlds stay separate from each other.

Notes:
- Worlds are written in the model's own words; nothing is copied from the source. If the model doesn't recognise a story it says so, and you'll be asked for notes.
- **Worlds built from other stories are always capped at "mature"** (violence and horror OK, sex fades to black), whatever anyone's settings say. The cap is set by server code, not by the model. Those casts often include teenagers and a model can't reliably tell who is who. The narrator prompt also forbids any sexual or romantic-physical content involving characters who are minors in the source, at every rating.
- The built-in Lantern Coast world is the only one that allows adult scenes (when every player present opts in).
- Limits: 3 world builds per hour per player, 10 stat suggestions per minute.

## Models

`server/models.json` lists models. Venice Role-Play Uncensored is the default; Venice general, a local OpenAI-compatible server (Ollama, llama.cpp, vLLM), OpenRouter and Claude are included but disabled until enabled and keyed. Add any OpenAI-compatible endpoint by copying an entry. Players pick their storyteller in Settings.

Each model has `adultContent: true/false`. **Adult-rated scenes are only ever routed to models flagged true**; if none is available the scene is downgraded to "mature". Don't flag a model `true` unless its provider's terms allow adult content. (Claude's usage policy does not, so it ships as `false`.)

## Content & safety design

- **Age gate:** 18+ date of birth and confirmation at signup.
- **Opt-in per player:** adult content is off by default, and a scene is only "adult" when **every** player in it has opted in. Otherwise it is "mature" (violence/horror OK, sex fades to black).
- **X-card:** the ✕ button caps the location at "mature" for 30 minutes and tells the narrator to steer away, no explanation needed.
- **Blocked themes:** per-player list, merged across everyone present.
- **World cap:** story-based worlds can never be rated above "mature" (see above).
- **Hard limits in the prompt:** characters in sexual contexts are adults; no sexual violence; sexual content involving another player's character requires them to have acted willingly.
- Bystanders never receive a player's private narration, only the sanitised `observable` line.

## Before you launch publicly

1. **Real age verification.** The DOB field is self-declared. Use a verification provider before public release.
2. **Independent moderation.** Prompt rules alone are not a safeguard. Run a classifier on player input and model output, especially for sexual content involving minors, and log/block violations.
3. **App stores.** Apple prohibits overtly sexual material and Google Play prohibits apps primarily built to provide sexually gratifying content, both enforced against AI chat apps in 2026. A PWA/web build, or a store build with adult mode off, avoids the issue. Check current policies and consider legal advice.
4. **Auth & hosting.** Replace the anonymous token signup with real accounts, serve over HTTPS, put the SQLite file on persistent storage (or move to Postgres), and use a shared lock (e.g. Redis) if you run more than one server instance.
5. **Privacy.** Roleplay logs are sensitive. Decide retention, add delete-my-data, and write a privacy policy.
6. **Cost controls.** Add per-player daily limits and a spending cap on your provider account.
