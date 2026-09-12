# Ceo3 Delegation Contract

Ceo MCP Media runs as a child MCP rather than inflating the primary Ceo MCP Agent tool surface.

## Intent routing
Delegate for image/video generation, storyboard, character continuity, temporal continuity, subtitles, audio, render, movie, Google Flow, Google AI Studio, browser-studio and CapCut intents. Thai media intents remain included in the child manifest.

## V12 preferred route
For complete movie/short-film requests, prefer:
- `media.movie.create`
- `media.movie.status`
- `media.movie.manifest`
- `media.studio.status`
- `media.external.next`
- `media.external.complete`

Use `provider:"auto"` unless the user explicitly requires a particular route. Multi-shot video defaults to `continuityMode:"strict"`; do not turn it off unless the user explicitly wants independent shots or an intentional discontinuous montage.

The first `media.movie.create` call may contain the full creative brief/script and local reference-image paths. After that, prefer the returned `movieJobId` and local manifest instead of resending all scene prompts through chat on every step.

## V12 mandatory temporal-continuity rule
For every multi-shot movie with `continuityMode:"strict"`:
1. Run video shots serially. Never submit Shot N+1 before Shot N has completed.
2. Extract a near-final handoff frame from Shot N after the generated MP4 is available.
3. Pass that handoff image into the provider's actual Start Frame / first-frame input for Shot N+1. Do not treat it as only a style/reference image.
4. Preserve character identity, wardrobe, body proportions, pose logic, limb continuity, body/screen direction, eye line, action momentum, camera angle/height/lens feel/movement, lighting, environment and spatial orientation.
5. Do not reset a moving character to a neutral pose and do not restart an action already in progress.
6. Every planned shot must carry an `actionHandoff`, `cameraLock` and transition intent. Unexplained camera reversals, teleporting, pose resets and jump cuts are continuity failures.
7. If the provider cannot honor the required Start Frame or the end-frame extraction fails, treat strict continuity as blocked/failed rather than silently generating an independent replacement shot.
8. `continuityMode:"off"` is only for intentionally independent shots.

### When Gemini API is ready
Ceo MCP Media runs the API/local workflow autonomously through the durable worker. Veo receives the chained frame through its first-frame image input.

### When Gemini API is not ready
AUTO creates browser external actions:
1. AI Studio Web generates the continuity anchor/image, using seeded local reference images when supplied.
2. Flow Web generates video shots serially. For Shot 2 onward the external action contains the previous shot end-frame path and explicitly requires the real Flow Start Frame slot.
3. Ceo3/Playwright downloads each result and calls `media.external.complete`.
4. Ceo MCP Media extracts the near-final handoff frame before allowing the next shot to be created.
5. After shots, the workflow creates SRT and optional durable voice/music jobs.
6. Browser-mode movie defaults may create a CapCut external compose action containing clips, SRT, voice/music paths and the production manifest.
7. FFmpeg/ffprobe remains available as fallback/verification and for the V12 handoff-frame extraction.

## V12 native / asset / FFmpeg rules
- Prefer `provider:"auto"`; AUTO uses Gemini API when ready, then a configured `flow-native` adapter, then browser routes.
- Do not construct shell command text for Flow Native or ffmpeg-skill. Use the typed child tools and their structured arguments.
- Use `media.asset.list/get` to reuse already registered outputs instead of regenerating identical media when a matching asset is available.
- Treat `IDEMPOTENCY_CONFLICT` as a caller error: create a new key only when the intended request really changed.
- For autonomous FFmpeg finalization, `media.ffmpeg.status` must report the exact 0.15.3 pin as usable. Delivery/loudness/check failures are real failures and must not be hidden by legacy fallback.
- Strict temporal continuity overrides provider parallelism: multi-shot video jobs are serial because Shot N+1 depends on Shot N's actual output frame.
- Browser external actions remain serial; API/local/native jobs may use bounded concurrency only when continuity is explicitly off or when work items are independent.

## Browser safety
If Flow or AI Studio asks for Google sign-in, stop automated interaction and let the user sign in manually. Do not ask for, type, store or proxy Google passwords, OTPs or recovery credentials. After the user signs in, resume the persisted external action.

## External action contract
`media.movie.status` includes `nextExternalAction` when the parent workflow is waiting on Flow, AI Studio or CapCut. The action contains semantic instructions, URL, prompt, local reference paths, optional `firstFrame`, and expected output type/path. Do not mark the action complete until a local output file exists.

`media.external.complete(jobId, outputPath)` attaches the file and unblocks the parent movie. `media.external.fail` records an error without falsifying completion.

## Production manifest contract
`media.movie.manifest(jobId)` returns the persistent local movie recipe/progress. The manifest is the canonical handoff for script, scene prompts, planned output paths, `startFramePath`, `endFramePath`, action/camera handoff state, audio state, editor state and export state. A consumer should read the manifest/action recipe locally instead of asking ChatGPT to reconstruct the same long payload.

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
