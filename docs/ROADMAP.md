# Roadmap V1-V10

## V1 - Foundation
Standalone TypeScript MCP server, project manifests, storyboard planner, provider contracts, local asset/job stores, FFmpeg composer, durable job lifecycle and CLI.

## V2 - Character continuity
Character Bible/Lock, reference images, continuity tags and single-shot regeneration.

## V3 - Audio / subtitles / formats
Aspect ratio/resolution/FPS presets, SRT export, durable voice/music jobs and subtitle/audio composition.

## V4 - Auto Director
Deterministic continuity scoring/review with bounded retry prompts.

## V5 - Provider router + Flow
Gemini image/Veo adapters, provider routing and optional portable Flow handoff.

## V6 - Ceo3 delegation
Child MCP manifest, Thai/English media intents and dynamic tool exposure.

## V7 - Durable Director / Auto Movie Pipeline
Implemented:
- `media.movie.create` / `media.movie.status` durable parent workflow.
- Project → character lock → storyboard → anchor → serial/bounded shots → SRT → compose.
- Auto-worker, stale-running recovery, per-job in-flight guard and atomic JSON writes.
- Separate poll error budget, 429/Retry-After backoff and provider-wide cooldown.
- Guardrail/IP prompt preflight and strict explicit-provider routing.
- Typed MCP schemas, streaming Veo downloads and persistent runtime data path.

## V8 - Studio Router / No-API Browser Mode
Implemented:
- `provider=auto` selects Gemini API when available.
- Without Gemini API credentials, anchor/image work routes to Google AI Studio Web and video work routes to Google Flow Web.
- Browser generation is represented as durable `external.action` jobs rather than fake in-child browser automation.
- `media.studio.status` / `media.studio.route` expose routing decisions.
- `media.external.next` / `list` / `complete` / `fail` provide resumable Ceo3/Playwright browser handoff.
- External browser actions are excluded from auto-worker due polling so they are never duplicated.
- Browser-mode movies can use CapCut as the final editor via durable `capcut.compose` handoff.
- Browser sign-in is manual-only; the media system never stores or types Google credentials.
- FFmpeg/ffprobe remains the canonical autonomous fallback and verification layer.

## V9 - Production Workspace / Thin Command Pipeline
Implemented:
- Every `media.movie.create` job now creates a persistent production workspace instead of scattering generated files across generic asset folders.
- Workspace contains `00-script`, `01-anchor`, `02-flow`, `03-audio`, `04-capcut`, `05-export`, plus a persistent `manifest.json`.
- `media.movie.manifest` lets Ceo3 read the full local production recipe/progress from the movie job id, reducing the need to resend long scene payloads through ChatGPT/Chrome.
- User-provided `character.referenceImages` are accepted at movie creation, used to generate the continuity anchor, then carried into later shot references.
- Movie orchestration now has an explicit `audio` phase after shot/SRT completion.
- Optional durable voice and music generation can be requested by the parent movie workflow.
- CapCut handoff now receives subtitle, voice, music and manifest paths.
- FFmpeg composition supports optional voice plus looped/ducked background music.
- Movie outputs include `workspaceRoot` and `manifestPath` so follow-up commands can be short and deterministic.
- V9 production-workspace integration test covers script files, seeded references, shot generation, SRT, voice/music and manifest progress.

## V10 - Native/Asset/FFmpeg Skill Hardening
Implemented:
- Optional `flow-native` executable adapter with structured JSON I/O and AUTO routing ahead of browser fallback.
- Content-addressed Asset Registry with SHA-256 identity/provenance for generated and externally completed media.
- Strong request-bound idempotency with explicit `IDEMPOTENCY_CONFLICT` on key reuse with changed payloads.
- Bounded durable worker and movie-shot concurrency up to four for API/local/native providers; browser routes remain serial.
- Pinned upstream `ffmpeg-skill` 0.15.3 integration at commit `7dfbdc5b30a622dbb3c7029e690280b7ac43615e`; installer is fail-closed and never tracks latest `main`.
- FFmpeg Skill adapter exposes doctor, contract, render, probe, check and look operations with structured argv only.
- FFmpeg composition uses skill render/probe/loudness/delivery/contact-sheet verification when the exact pin is usable, with legacy FFmpeg fallback only when the skill is unavailable.
- MCP schemas/tools expose Asset Registry and FFmpeg Skill surfaces; manifests/capabilities report V10.
- V10 regression tests cover idempotency conflict, content identity, bounded 4-worker execution and skill pin metadata.

## Production hardening next
### P1
- Browser recipe adapters with semantic state verification for current Flow/AI Studio UI, including login-required/quota-required/completed states.
- Local download watcher + asset checksum matching for browser-generated files.
- Direct browser recipe runner that consumes the local manifest/action recipe without copying long prompts back through chat text.
- CapCut draft adapter that can select a current compatible empty-project template automatically.
- Vision-based rendered-frame QA: face, wardrobe, location, motion and shot continuity.
- Auto-regenerate only low-quality shots based on visual QA.
- FFmpeg normalize/loudness/exact-duration gate and native-audio-aware mixing.
- SQLite WAL index for larger histories and multi-process locking.
- Asset hash cache, deduplication and retention cleanup.

### P2
- Real TTS/music providers and loudness-aware mixing/ducking.
- Object storage/signed URLs for multi-machine workers.
- Additional production media providers after orchestration/QA are stable.
- Cost/credit/latency telemetry across API and browser routes.
