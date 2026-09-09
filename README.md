# Ceo MCP Media

Standalone MCP media pipeline for ChatGPT/Ceo3. It is deliberately separate from `Ceo-MCP-Agent`.

## V1-V7
- **V1** MCP foundation, projects, storyboards, provider contracts, durable jobs, FFmpeg composition.
- **V2** Character Bible/Lock, reference images, multi-shot continuity, single-shot regeneration.
- **V3** durable voice/music jobs, subtitles, audio composition, 16:9/9:16/1:1 presets, resolution/FPS metadata.
- **V4** Auto Director continuity scoring, bounded retry prompts and render QA hooks.
- **V5** provider router, Gemini image + Veo long-running adapter, optional Google Flow handoff.
- **V6** child-MCP manifest and Ceo3 delegation contract with minimal default tool exposure.
- **V7** Durable Director / Auto Movie Pipeline: one `media.movie.create` call can create project + character lock + storyboard + anchor + serial video shots + subtitles + final composition. Includes auto worker, stale-running recovery, typed MCP schemas, provider-wide cooldown, guardrail preflight and strict explicit-provider routing.

## One-call movie workflow

`media.movie.create` returns immediately with a `movieJobId`. The child MCP auto-worker advances the workflow without holding one MCP request open:

`brief -> preflight -> project -> character lock -> storyboard -> anchor -> shots -> subtitles -> compose -> completed`

Default movie video concurrency is `1` to reduce Veo quota pressure. Set `videoConcurrency` or `CEO_MEDIA_MOVIE_VIDEO_CONCURRENCY` up to 3 only when quota allows it.

## Durable execution

Long generation never waits inside one MCP request:

`media.video.generate -> job id -> worker/tick -> provider operation -> waiting -> poll -> download -> completed`

Jobs persist with idempotency keys, retry/backoff, cancellation, timeout and resumability. Stale `running` jobs are recoverable after `CEO_MEDIA_RUNNING_LEASE_MS`. Provider polling has its own error budget and does not consume normal submit retry attempts.

## Quota and provider behavior

- 429/`Retry-After` applies a job retry delay and provider-wide cooldown.
- Explicit `provider: "gemini"` no longer silently falls back to Mock when Gemini is unavailable. Set `CEO_MEDIA_EXPLICIT_PROVIDER_FALLBACK=true` only when intentional.
- Guardrail/non-retryable provider errors fail fast instead of wasting paid retries.
- `media.preflight.check` detects common third-party character/franchise references and can rewrite them toward an original design before paid generation.

## Persistence

If `CEO_MEDIA_DATA_DIR` is blank/unset, Windows defaults to `%LOCALAPPDATA%\Ceo\media-data`, so managed child-MCP updates do not erase projects/jobs/assets. Use a custom path only when explicitly needed.

## Setup
```powershell
npm install
Copy-Item .env.example .env
npm run typecheck
npm test
npm run build
```
For real Gemini/Veo generation set `GEMINI_API_KEY` in `.env` or the process environment. Never commit secrets.

Start MCP stdio server:
```powershell
npm start
```
Development:
```powershell
npm run dev
npm run cli -- status
npm run cli -- demo
npm run worker
```

Current configurable defaults: image `gemini-3.1-flash-image`, video `veo-3.1-generate-preview`, Gemini API base `https://generativelanguage.googleapis.com/v1beta`.

Google Flow remains an optional creative bridge, not a runtime dependency. FFmpeg remains the canonical local composer.

See `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/CEO3-DELEGATION.md`, and `docs/API-NOTES.md`.
