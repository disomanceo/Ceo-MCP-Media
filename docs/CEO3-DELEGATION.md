# Ceo3 Delegation Contract

Ceo MCP Media runs as a child MCP rather than inflating the primary Ceo MCP Agent tool surface.

## Intent routing
Delegate for image/video generation, storyboard, character continuity, subtitles, audio, render, movie, Google Flow, Google AI Studio, browser-studio and CapCut intents. Thai media intents remain included in the child manifest.

## V9 preferred route
For complete movie/short-film requests, prefer:
- `media.movie.create`
- `media.movie.status`
- `media.movie.manifest`
- `media.studio.status`
- `media.external.next`
- `media.external.complete`

Use `provider:"auto"` unless the user explicitly requires a particular route.

The first `media.movie.create` call may contain the full creative brief/script and local reference-image paths. After that, prefer the returned `movieJobId` and local manifest instead of resending all scene prompts through chat on every step.

### When Gemini API is ready
Ceo MCP Media runs the API/local workflow autonomously through the durable worker.

### When Gemini API is not ready
AUTO creates browser external actions:
1. AI Studio Web generates the continuity anchor/image, using seeded local reference images when supplied.
2. Flow Web generates video shots serially using the persisted anchor/reference set and per-shot recipe from the production workspace.
3. Ceo3/Playwright downloads each result and calls `media.external.complete`.
4. After shots, the workflow creates SRT and optional durable voice/music jobs.
5. Browser-mode movie defaults may create a CapCut external compose action containing clips, SRT, voice/music paths and the production manifest.
6. FFmpeg/ffprobe remains available as fallback/verification.

## Browser safety
If Flow or AI Studio asks for Google sign-in, stop automated interaction and let the user sign in manually. Do not ask for, type, store or proxy Google passwords, OTPs or recovery credentials. After the user signs in, resume the persisted external action.

## External action contract
`media.movie.status` includes `nextExternalAction` when the parent workflow is waiting on Flow, AI Studio or CapCut. The action contains semantic instructions, URL, prompt, local reference paths and expected output type/path. Do not mark the action complete until a local output file exists.

`media.external.complete(jobId, outputPath)` attaches the file and unblocks the parent movie. `media.external.fail` records an error without falsifying completion.

## Production manifest contract
`media.movie.manifest(jobId)` returns the persistent local movie recipe/progress. The manifest is the canonical handoff for script, scene prompts, planned output paths, audio state, editor state and export state. A consumer should read the manifest/action recipe locally instead of asking ChatGPT to reconstruct the same long payload.

## CapCut policy
Before a CapCut action, use Ceo CapCut status/doctor. Prefer managed capcut-cli; use CapCut MCP only as fallback when configured. If the CLI warns that its bundled draft template is older than the installed CapCut app, use a current empty project as template rather than forcing an incompatible draft. Never auto-publish/upload.

## Minimal default tools
- `media.capabilities`
- `media.movie.create`
- `media.movie.status`
- `media.movie.manifest`
- `media.studio.status`
- `media.studio.route`
- `media.external.next`
- `media.external.complete`
- `media.preflight.check`
- `media.project.create`
- `media.storyboard.plan`
- `media.image.generate`
- `media.video.generate`
- `media.job.status`

Expand advanced tools only for diagnostics, manual regeneration, voice/music, direct FFmpeg composition, Flow handoff or low-level job control.
