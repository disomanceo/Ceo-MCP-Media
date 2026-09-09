# Ceo MCP Media

Standalone MCP media pipeline for ChatGPT/Ceo3. It is deliberately separate from `Ceo-MCP-Agent`.

## V1-V8
- **V1** MCP foundation, projects, storyboards, provider contracts, durable jobs, FFmpeg composition.
- **V2** Character Bible/Lock, reference images, multi-shot continuity, single-shot regeneration.
- **V3** durable voice/music jobs, subtitles, audio composition, 16:9/9:16/1:1 presets, resolution/FPS metadata.
- **V4** Auto Director continuity scoring, bounded retry prompts and render QA hooks.
- **V5** provider router, Gemini image + Veo long-running adapter, optional Google Flow handoff.
- **V6** child-MCP manifest and Ceo3 delegation contract with minimal default tool exposure.
- **V7** Durable Director / Auto Movie Pipeline with one-call project → anchor → shots → subtitles → compose orchestration, auto-worker, quota/backoff, guardrail preflight, stale-job recovery and typed MCP schemas.
- **V8** Studio Router: `provider=auto` uses Gemini API when available; without `GEMINI_API_KEY`, anchor-image work routes to Google AI Studio Web and video shots route to Google Flow Web as durable external actions. CapCut is supported as a durable final-editor handoff, with FFmpeg remaining the autonomous fallback/composer.

## One-call movie workflow

`media.movie.create` returns immediately with a `movieJobId`.

### API/local path
`brief -> preflight -> project -> character lock -> storyboard -> Gemini/Mock anchor -> shots -> SRT -> FFmpeg/CapCut -> completed`

### No-API browser path
`brief -> preflight -> project -> character lock -> AI Studio anchor action -> Flow shot action(s) -> SRT -> CapCut action -> completed`

Browser actions do **not** store or type Google credentials. If a browser session asks for Google sign-in, Ceo3 must pause and let the user sign in manually, then resume the same durable action.

## V8 Studio Router

Useful tools:
- `media.studio.status` — inspect AUTO route choices.
- `media.studio.route` — resolve image/video route without generating.
- `media.external.next` — read the next browser/CapCut action Ceo3 should perform.
- `media.external.complete` — attach the downloaded/exported local file and resume the movie workflow.
- `media.external.fail` — record a browser/editor failure without corrupting the parent workflow.

Default AUTO routing when no Gemini API credential is available:
- **Image / anchor:** Google AI Studio Web.
- **Video:** Google Flow Web.
- **Final editor for browser-mode movies:** CapCut handoff (configurable).
- **Verification/fallback:** FFmpeg/ffprobe.

Browser providers are deliberately modeled as durable external actions instead of pretending the child MCP can control a signed-in browser by itself. Ceo3/Playwright or Browser Companion owns browser interaction and returns local assets to the child workflow.

## Durable execution

Long generation never waits inside one MCP request. Jobs persist with idempotency keys, retry/backoff, cancellation, timeout and resumability. Stale `running` jobs are recoverable after `CEO_MEDIA_RUNNING_LEASE_MS`. Provider polling has its own error budget and does not consume normal submit retry attempts. External browser/CapCut actions are excluded from auto-worker polling until Ceo3 completes/fails them explicitly.

## Quota and provider behavior
- 429/`Retry-After` applies a job retry delay and provider-wide cooldown.
- Explicit `provider: "gemini"` does not silently fall back to Mock.
- `provider: "auto"` can choose web studio routes when Gemini API is unavailable.
- Guardrail/non-retryable provider errors fail fast instead of wasting paid retries.
- `media.preflight.check` detects common third-party character/franchise references and can rewrite them toward an original design before generation.

## CapCut
Ceo3 currently prefers managed `capcut-cli` when installed. V8 emits a `capcut.compose` external action containing ordered clips, SRT and expected output path. Ceo3 should run CapCut doctor/version checks first. If the bundled CLI template schema is older than the installed CapCut app, use a current empty CapCut project as the template rather than forcing an incompatible draft. Automatic publishing/upload remains blocked.

## Persistence
If `CEO_MEDIA_DATA_DIR` is blank/unset, Windows defaults to `%LOCALAPPDATA%\Ceo\media-data`, so managed child-MCP updates do not erase projects/jobs/assets.

## Setup
```powershell
npm install
Copy-Item .env.example .env
npm run typecheck
npm test
npm run build
```

A Gemini API key is optional in V8. Without it, leave `GEMINI_API_KEY` blank and keep the browser studio routes enabled.

Start MCP stdio server:
```powershell
npm start
```

See `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/CEO3-DELEGATION.md`, and `docs/API-NOTES.md`.
