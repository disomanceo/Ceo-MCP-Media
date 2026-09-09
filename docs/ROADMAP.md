# Roadmap V1-V8

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
- `media.movie.status` surfaces the next external action directly.
- Browser-mode movies can use CapCut as the final editor via durable `capcut.compose` handoff.
- CapCut handoff requires doctor/version checks and warns against old-template/new-app schema mismatch.
- Browser sign-in is manual-only; the media system never stores or types Google credentials.
- FFmpeg/ffprobe remains the canonical autonomous fallback and verification layer.

## Production hardening next
### P1
- Browser recipe adapters with semantic state verification for current Flow/AI Studio UI, including login-required/quota-required/completed states.
- Local download watcher + asset checksum matching for browser-generated files.
- CapCut draft adapter that can select a current compatible empty-project template automatically.
- Vision-based rendered-frame QA: face, wardrobe, location, motion and shot continuity.
- Auto-regenerate only low-quality shots based on visual QA.
- FFmpeg normalize/loudness/exact-duration gate.
- SQLite WAL index for larger histories and multi-process locking.
- Asset hash cache, deduplication and retention cleanup.

### P2
- Real TTS/music providers and loudness-aware mixing.
- Object storage/signed URLs for multi-machine workers.
- Additional production media providers after orchestration/QA are stable.
- Cost/credit/latency telemetry across API and browser routes.
