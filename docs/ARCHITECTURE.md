# Architecture

```text
ChatGPT / Ceo3
      |
      v
Ceo MCP Media (stdio MCP)
      |
      +-- V8 Studio Router
      |      +-- Gemini API (when credential exists)
      |      +-- Google AI Studio Web external action (image/anchor)
      |      +-- Google Flow Web external action (video)
      |      +-- CapCut external editor action
      |
      +-- V7 Durable Director
      |      +-- Prompt / guardrail preflight
      |      +-- Movie workflow parent job
      |      +-- Auto worker / stale-running recovery
      |      +-- Provider quota cooldown
      |
      +-- ProjectService
      +-- Storyboard / Character Lock / Auto Director
      +-- Durable JobStore + JobRunner
      |       +-- Mock
      |       +-- Gemini Image
      |       +-- Veo long-running video
      |       +-- Voice / Music provider contracts
      |
      +-- ExternalActionService
      |       +-- studio.image
      |       +-- studio.video
      |       +-- capcut.compose
      |
      +-- FFmpeg Composer / ffprobe verification
```

## Browser-provider boundary
Ceo MCP Media does not impersonate a signed-in browser. Web providers are represented as durable `external.action` jobs containing the URL, prompt, local references, expected output type and bounded semantic instructions. Ceo3/Playwright or Browser Companion performs the browser interaction, downloads the media locally, then calls `media.external.complete` with the resulting file path.

If Google requests sign-in, Ceo3 must pause for manual user sign-in. Account passwords, OTPs and other credentials are never requested, stored or typed by the media child.

## AUTO routing
`provider=auto` resolves independently by capability:
- Gemini API is preferred when `GEMINI_API_KEY` is ready.
- Without a Gemini key, image/anchor generation prefers Google AI Studio Web.
- Without a Gemini key, video generation prefers Google Flow Web.
- Browser routes remain serial by default to reduce credit/quota pressure and preserve continuity.
- Mock is used only when explicitly selected or `CEO_MEDIA_AUTO_ALLOW_MOCK=true`.

## External-action invariant
`external.action` jobs are persisted as `waiting` but excluded from normal `JobStore.due()` auto-worker polling. They remain stable until Ceo3 explicitly calls `media.external.complete` or `media.external.fail`. This prevents browser actions from being re-fired repeatedly.

## V8 movie workflow
For an API route, `media.movie.create` stays fully autonomous. For a browser route, the parent movie waits at each external stage and `media.movie.status` exposes `nextExternalAction`. Completing that action automatically allows the durable parent workflow to continue.

## CapCut bridge
When `finalEditor=capcut`, the parent movie creates a durable `capcut.compose` external action with ordered clips, subtitle file and expected final path. Ceo3 should inspect CapCut doctor/version state first, prefer managed capcut-cli, and avoid forcing an old draft template into a newer CapCut schema. FFmpeg remains the reliable autonomous composer/fallback.

## Recovery / quota / persistence
- Atomic JSON writes protect job/project records.
- Stale `running` jobs become due after `CEO_MEDIA_RUNNING_LEASE_MS`.
- Provider polling does not consume normal submit retry attempts.
- HTTP 429 honors retry metadata and activates provider-wide cooldown.
- Windows defaults to `%LOCALAPPDATA%\Ceo\media-data` when no explicit data directory is configured.
- External actions survive child restarts because their full recipe is persisted in the JobStore.
