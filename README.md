# Ceo MCP Media

Standalone MCP media pipeline for ChatGPT/Ceo3. It is deliberately separate from `Ceo-MCP-Agent`.

## V1-V6
- **V1** MCP foundation, projects, storyboards, provider contracts, durable jobs, FFmpeg composition.
- **V2** Character Bible/Lock, reference images, multi-shot continuity, single-shot regeneration.
- **V3** durable voice/music jobs, subtitles, audio composition, 16:9/9:16/1:1 presets, resolution/FPS metadata.
- **V4** Auto Director continuity scoring, bounded retry prompts and render QA hooks.
- **V5** provider router, Gemini image + Veo long-running adapter, optional Google Flow handoff.
- **V6** child-MCP manifest and Ceo3 delegation contract with minimal default tool exposure.

## Durable execution
Long generation never waits inside one MCP request:

`media.video.generate -> job id -> media.job.run_once/tick -> provider operation -> waiting -> poll -> download -> completed`

Jobs persist in `data/jobs/` with idempotency keys, retry/backoff, cancellation, timeout and resumability. Voice and music generation use the same durable job lifecycle.

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

Current configurable defaults: image `gemini-3.1-flash-image`, video `veo-3.1-generate-preview`, Gemini API base `https://generativelanguage.googleapis.com/v1beta`. The Veo adapter follows the current long-running REST contract (`predictLongRunning`, operation polling, up to three asset references, first/last frames).

Google Flow is an optional creative bridge, not a runtime dependency. `media.flow.handoff` writes a portable JSON package containing shot prompts and reference assets.

Public media tools now include durable `media.audio.voice` and `media.audio.music` jobs alongside image/video generation.

See `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/CEO3-DELEGATION.md`, and `docs/API-NOTES.md`.
