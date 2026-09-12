# Architecture

```text
ChatGPT / Ceo3
      |
      v
Ceo MCP Media (stdio MCP)
      |
      +-- V11 Ceo Flow Browser
      |      +-- bundled Playwright/Chrome driver
      |      +-- dedicated local browser profile
      |      +-- manual-only Google sign-in boundary
      |      +-- persistent Flow operation/job state
      |      +-- exact-once submit guard + polling/download
      |      +-- reference-image upload
      |
      +-- V10 Hardening Layer
      |      +-- Flow Native executable adapter
      |      +-- Asset Registry (SHA-256 identity/provenance)
      |      +-- Strong request-bound idempotency
      |      +-- Bounded 4-worker scheduler
      |      +-- ffmpeg-skill 0.15.3 pinned adapter
      |      |      +-- doctor / contract / render / probe / check / look
      |      +-- delivery/loudness/contact-sheet verification
      |
      +-- V9 Production Workspace / Manifest
      |      +-- 00-script
      |      +-- 01-anchor
      |      +-- 02-flow scenes
      |      +-- 03-audio
      |      +-- 04-capcut
      |      +-- 05-export
      |      +-- manifest.json
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

## V9 production-workspace invariant

A movie job owns one stable local workspace. Script text, anchor recipe, per-shot prompts, generated assets, SRT/audio, editor plan, export plan and final output all have deterministic locations. The root `manifest.json` is the compact handoff contract between ChatGPT/Ceo3, the browser recipe executor and final editor.

The practical effect is that long scene prompts are written once during `media.movie.create`. Follow-up execution can operate from `movieJobId`, `manifestPath` and the next durable external action rather than repeatedly serializing the whole movie plan through the conversation.

## Browser-provider boundary

V11 has two browser paths. The bundled `flow-native` driver controls a dedicated local Chrome profile directly for Google Flow video jobs and persists operation state locally. The legacy `flow-web` / `ai-studio-web` providers remain durable `external.action` jobs performed by Ceo3/Playwright or Browser Companion. Both paths keep authentication user-controlled.

If Google requests sign-in, Ceo3 must pause for manual user sign-in. Account passwords, OTPs and other credentials are never requested, stored or typed by the media child.

## AUTO routing

`provider=auto` resolves independently by capability:
- For image/anchor generation, Gemini API is preferred when `GEMINI_API_KEY` is ready; otherwise Google AI Studio Web is preferred.
- For video generation, the authenticated bundled Flow Native driver is preferred first; Gemini API is the API fallback, then Google Flow Web remains the browser fallback.
- Set `CEO_MEDIA_VIDEO_AUTO_PREFER_FLOW=false` only when API-first video routing is intentionally desired.
- Browser routes remain serial by default to reduce credit/quota pressure and preserve continuity.
- Mock is used only when explicitly selected or `CEO_MEDIA_AUTO_ALLOW_MOCK=true`.

## External-action invariant

`external.action` jobs are persisted as `waiting` but excluded from normal `JobStore.due()` auto-worker polling. They remain stable until Ceo3 explicitly calls `media.external.complete` or `media.external.fail`. This prevents browser actions from being re-fired repeatedly.

## V9 movie workflow

`media.movie.create` persists the complete recipe and returns immediately. The durable parent then advances through:

`anchor -> shots -> subtitles -> audio -> editor/compose -> completed`

For browser routes, the parent pauses only at external stages. `media.movie.status` returns compact progress and `nextExternalAction`; `media.movie.manifest` returns the persisted production recipe. Seed reference images are applied to the continuity anchor and reused across later shots.

## Audio stage

Voice and music are optional durable children of the parent movie job. When enabled, they run after all shots and SRT are complete. CapCut receives both assets plus the manifest. FFmpeg can combine narration and background music before final export. Real production TTS/music still depends on configured providers.

## CapCut bridge

When `finalEditor=capcut`, the parent movie creates a durable `capcut.compose` external action with ordered clips, subtitle file, optional voice/music files, production manifest and expected final path. Ceo3 should inspect CapCut doctor/version state first, prefer managed capcut-cli, and avoid forcing an old draft template into a newer CapCut schema. FFmpeg remains the reliable autonomous composer/fallback.

## Recovery / quota / persistence
- Atomic JSON writes protect job/project/manifest records.
- Stale `running` jobs become due after `CEO_MEDIA_RUNNING_LEASE_MS`.
- Provider polling does not consume normal submit retry attempts.
- HTTP 429 honors retry metadata and activates provider-wide cooldown.
- Windows defaults to `%LOCALAPPDATA%\Ceo\media-data` when no explicit data directory is configured.
- External actions and production workspaces survive child restarts because their full recipe/state is persisted locally.
