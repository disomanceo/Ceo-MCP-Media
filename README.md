# Ceo MCP Media

Standalone durable media-production MCP for ChatGPT/Ceo3. It is deliberately separate from `Ceo-MCP-Agent`.

## V1-V11
- **V1** MCP foundation, projects, storyboards, provider contracts, durable jobs, FFmpeg composition.
- **V2** Character Bible/Lock, reference images, multi-shot continuity, single-shot regeneration.
- **V3** durable voice/music jobs, subtitles, audio composition, 16:9/9:16/1:1 presets, resolution/FPS metadata.
- **V4** Auto Director continuity scoring, bounded retry prompts and render QA hooks.
- **V5** provider router, Gemini image + Veo long-running adapter, optional Google Flow handoff.
- **V6** child-MCP manifest and Ceo3 delegation contract with minimal default tool exposure.
- **V7** Durable Director / Auto Movie Pipeline with one-call project → anchor → shots → subtitles → compose orchestration, auto-worker, quota/backoff, guardrail preflight and stale-job recovery.
- **V8** Studio Router: `provider=auto` uses Gemini API when available; without `GEMINI_API_KEY`, anchor-image work routes to Google AI Studio Web and video shots route to Google Flow Web as durable external actions. CapCut is supported as a durable final-editor handoff.
- **V9** Production Workspace: script/scene files, seeded user reference images, persistent `manifest.json`, compact progress/status, optional durable voice/music stage, and deterministic CapCut/FFmpeg export folders.
- **V10** Production hardening: optional Flow Native executable provider, content-addressed Asset Registry, strong idempotency conflict detection, bounded 4-worker execution, pinned `ffmpeg-skill` 0.15.3 adapter, loudness/delivery checks and contact-sheet verification with legacy FFmpeg fallback when the skill is unavailable.
- **V11** Ceo Flow Browser: bundled Playwright/Chrome driver controls Google Flow directly with a dedicated local browser profile, persistent operation state, duplicate-submit protection, polling/download, reference-image upload and manual-only Google sign-in. No `useapi.net` dependency is required.

## One-call production workflow

`media.movie.create` returns immediately with a `movieJobId`, `workspaceRoot` and `manifestPath`.

### API/local path
`brief/script -> preflight -> project -> character/reference lock -> storyboard -> anchor -> <=8s shots -> SRT -> optional voice/music -> FFmpeg/CapCut -> export`

### No-API browser path
`brief/script -> manifest -> AI Studio anchor action -> Flow shot action(s) -> SRT/audio -> CapCut action -> export`

After creation, Ceo3 should use `movieJobId` / `media.movie.manifest` instead of repeatedly resending every scene prompt through chat. The durable production manifest stores the complete local recipe and progress.

## V9 production workspace

Each movie gets its own stable workspace under the media data directory:

```text
<workspace>/
  00-script/
    script.md
  01-anchor/
    anchor_prompt.md
    anchor.jpg
  02-flow/
    shot01.md
    shot01.mp4
    shot02.md
    shot02.mp4
    ...
  03-audio/
    voice.wav
    music.wav
  04-capcut/
    subtitle.srt
    capcut-edit.md
  05-export/
    export.json
    final.mp4
  manifest.json
```

`manifest.json` records the phase, shot count, output paths, audio readiness and final export state. `media.movie.status` exposes compact progress and the next browser/CapCut external action.

## V10 orchestration hardening

- `provider=flow-native` executes a configured local/native Flow adapter through structured stdin/stdout JSON; for video, AUTO prefers the local Ceo Flow Browser, then Gemini API, then browser fallback routes.
- Asset Registry assigns stable `asset-<sha256>` identities and records path, project/job provenance and content hash for generated/downloaded assets.
- Idempotency keys are request-bound: identical requests reuse the existing job; a changed request with the same key fails with `IDEMPOTENCY_CONFLICT`.
- Durable worker execution is bounded to four concurrent due jobs; browser external actions remain serial/manual and are never auto-resubmitted.
- `npm run install:ffmpeg-skill` installs upstream `ffmpeg-skill` **0.15.3** from pinned commit `7dfbdc5b30a622dbb3c7029e690280b7ac43615e`. It does not follow upstream `main`.
- When that exact skill pin is usable, FFmpeg composition uses declarative render + probe + delivery/loudness check + contact-sheet look verification. When the skill is unavailable, the V9 legacy FFmpeg composer remains the fallback.
- MCP tools expose asset registry and ffmpeg-skill status/doctor/contract/render/probe/check/look operations without accepting raw shell command strings.

## V11 Ceo Flow Browser

- `media.flow.local_status` reports Chrome detection, local state/profile paths and authentication readiness without generating media.
- `media.flow.local_auth` with `action=open` opens the dedicated Ceo Flow profile for the user to sign in manually; `action=check` verifies the session. Passwords, OTPs and CAPTCHA answers are never typed or stored by Ceo MCP Media.
- The bundled driver stores operation state under `%LOCALAPPDATA%\Ceo\media-data\flow-native` and uses `%LOCALAPPDATA%\Ceo\flow-browser-profile` for the dedicated browser profile by default.
- Video submission uses an exact-once guard immediately before the credit-spending Generate click. If submission state becomes uncertain, the operation fails closed rather than automatically spending credits twice.
- AUTO video routing is `authenticated local Flow Native driver -> Gemini API fallback -> Flow Web external action`; image/anchor work still prefers Gemini or AI Studio Web because the bundled V11 Flow driver currently exposes video generation only.

## Reference images / character continuity

`media.movie.create.character.referenceImages` accepts up to three local seed images. These are used while creating the continuity anchor, then the generated anchor plus seed references are reused across later shots. This is intended for workflows where the user supplies their own character/person reference images.

## Optional audio stage

Set `generateVoice=true` and/or `generateMusic=true` to insert durable audio jobs after all video shots and subtitles are ready. CapCut handoff receives voice/music paths; FFmpeg composition can use voice plus ducked background music. Real production TTS/music depends on configured providers; the mock provider remains test-only.

## Studio Router

Useful tools:
- `media.studio.status` — inspect AUTO route choices.
- `media.studio.route` — resolve image/video route without generating.
- `media.flow.local_status` - inspect the local Ceo Flow Browser driver and authentication readiness.
- `media.flow.local_auth` - open/check the dedicated Google Flow browser profile for manual sign-in.
- `media.external.next` — read the next browser/CapCut action Ceo3 should perform.
- `media.external.complete` — attach the downloaded/exported local file and resume the movie workflow.
- `media.external.fail` — record a browser/editor failure without corrupting the parent workflow.
- `media.movie.manifest` — read the persistent production recipe/progress for a movie job.

Default AUTO routing when no Gemini API credential is available:
- **Image / anchor:** Google AI Studio Web.
- **Video:** authenticated local Ceo Flow Browser (`flow-native`) first; Google Flow Web remains fallback.
- **Final editor for browser-mode movies:** CapCut handoff (configurable).
- **Verification/fallback:** FFmpeg/ffprobe.

Browser providers are modeled as durable external actions. Ceo3/Playwright or Browser Companion owns signed-in browser interaction and returns local assets to the child workflow. Browser actions do **not** store or type Google credentials; if Google requests sign-in, pause for manual user sign-in and resume the same durable action.

## Durable execution

Long generation never waits inside one MCP request. Jobs persist with idempotency keys, retry/backoff, cancellation, timeout and resumability. Stale `running` jobs are recoverable after `CEO_MEDIA_RUNNING_LEASE_MS`. Provider polling has its own error budget and does not consume normal submit retry attempts. External browser/CapCut actions are excluded from auto-worker polling until completed/failed explicitly.

## Quota and provider behavior
- 429/`Retry-After` applies a job retry delay and provider-wide cooldown.
- Explicit `provider: "gemini"` does not silently fall back to Mock.
- `provider: "auto"` can choose web studio routes when Gemini API is unavailable.
- Guardrail/non-retryable provider errors fail fast instead of wasting paid retries.
- `media.preflight.check` detects common third-party character/franchise references and can rewrite them toward an original design before generation.

## CapCut

When `finalEditor=capcut`, V9 emits a `capcut.compose` external action containing ordered clips, SRT, optional voice/music assets, production manifest and expected final path. Ceo3 should run CapCut doctor/version checks first and prefer a compatible current project template. Automatic publishing/upload remains blocked.

## Persistence

If `CEO_MEDIA_DATA_DIR` is blank/unset, Windows defaults to `%LOCALAPPDATA%\Ceo\media-data`, so managed child-MCP updates do not erase projects/jobs/assets/workspaces.

## Setup

```powershell
npm install
npm run install:ffmpeg-skill
Copy-Item .env.example .env
npm run typecheck
npm test
npm run build
```

A Gemini API key is optional. Without it, leave `GEMINI_API_KEY` blank. For local Google Flow video automation, run `npm run flow:auth`, sign in manually in the dedicated Ceo profile, close that browser window, then run `npm run flow:auth-check`. Flow Web remains available as fallback.

Start MCP stdio server:

```powershell
npm start
```

See `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/CEO3-DELEGATION.md`, and `docs/API-NOTES.md`.
