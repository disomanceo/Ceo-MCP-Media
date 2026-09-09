# Roadmap V1-V7

## V1 - Foundation
Standalone TypeScript MCP server, project manifests, storyboard planner, provider contracts, local asset/job stores, FFmpeg composer, durable job lifecycle and CLI.

## V2 - Character continuity
Character Bible/Lock stores stable identity description, wardrobe, voice, reference-image slots, continuity tags, multi-shot storyboards and regenerate-one-shot workflow.

## V3 - Audio / subtitles / formats
Project presets carry aspect ratio, resolution and FPS. Storyboard dialogue exports SRT. Voice/TTS and music generation use durable provider jobs. Composer supports optional audio and subtitle burn-in.

## V4 - Auto Director
Deterministic continuity scoring/review with retry prompt generation. Job retries are bounded/durable. Render QA hooks are available around composition.

## V5 - Provider router + Flow
Gemini adapter supports Gemini image Interactions API and Veo long-running operations. Router provides controlled fallback behavior. Flow bridge creates a portable handoff package and remains optional.

## V6 - Ceo3 delegation
`ceo-mcp-child.json` defines child MCP startup, intent tags, minimal default exposure and dynamic expansion. Ceo3 delegates media work without loading the full media schema into every coding conversation.

## V7 - Durable Director / Auto Movie Pipeline
Implemented:
- `media.movie.create` / `media.movie.status` durable parent workflow.
- One workflow coordinates project, character lock, storyboard, anchor image, serial/bounded video shots, SRT and final compose.
- Built-in MCP auto-worker with bounded batch size.
- Stale `running` job recovery through a configurable lease.
- Provider poll errors separated from submit retry budget.
- HTTP 429/Retry-After aware backoff plus provider-wide cooldown.
- Guardrail/IP prompt preflight with optional originality rewrite.
- Explicit Gemini requests no longer silently fall back to Mock.
- Typed MCP input schemas instead of empty `properties` objects.
- Veo downloads stream to disk instead of buffering the whole response in RAM.
- Persistent default data path outside managed child install.

## Production hardening next
### P1
- SQLite WAL job/project index for large histories and multi-process locking.
- Vision-based rendered-frame QA: face, wardrobe, location, motion and shot-continuity scoring.
- Auto-regenerate only failed/low-quality shots based on visual QA.
- FFmpeg normalize gate: resolution/FPS/timebase/audio normalization, loudness QA, exact-duration verification and temp cleanup.
- Asset hash cache, deduplication and retention/cleanup policy.

### P2
- Real production TTS/music providers and loudness-aware mixing.
- Object storage/signed URLs for cloud/multi-machine workers.
- More production video/image providers only after orchestration/QA are stable.
- Cost/latency/success-rate telemetry and adaptive provider scoring.
- Explicit Flow browser bridge only when UI automation is needed.
