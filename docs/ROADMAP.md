# Roadmap V1-V6

## V1 - Foundation
Standalone TypeScript MCP server, project manifests, storyboard planner, provider contracts, local asset/job stores, FFmpeg composer, durable job lifecycle and CLI.

## V2 - Character continuity
Character Bible/Lock stores stable identity description, wardrobe, voice, reference-image slots, continuity tags, multi-shot storyboards and regenerate-one-shot workflow.

## V3 - Audio / subtitles / formats
Project presets carry aspect ratio, resolution and FPS. Storyboard dialogue exports SRT. Voice/TTS and music generation use durable provider jobs. Composer supports optional audio and subtitle burn-in, and future audio providers plug into the same provider/job abstraction without changing MCP callers.

## V4 - Auto Director
Deterministic continuity scoring/review with retry prompt generation. Job retries are bounded/durable. Render QA is a pre-compose/post-compose gate.

## V5 - Provider router + Flow
Gemini adapter supports Gemini image Interactions API and Veo long-running operations. Router falls back without caller changes. Flow bridge creates a portable handoff package and remains optional.

## V6 - Ceo3 delegation
`ceo-mcp-child.json` defines child MCP startup, intent tags, minimal default exposure and dynamic expansion. Ceo3 delegates media work without loading the full media schema into every coding conversation.

## Production hardening next
- Provider-side idempotency where supported.
- SQLite/Postgres store for multi-machine workers.
- Add real production TTS/music provider adapters and audio loudness QA beyond the durable provider contracts/mock implementation.
- Vision-based rendered-frame QA and continuity scoring.
- Object storage/signed URLs for cloud workers.
- Explicit Flow browser bridge only when UI automation is needed.
