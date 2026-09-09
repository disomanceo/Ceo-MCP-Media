# Ceo3 Delegation Contract

Ceo MCP Media runs as a child MCP rather than inflating the primary Ceo MCP Agent tool surface.

## Intent routing
Delegate for media production intents: image/video generation, storyboard, character continuity, subtitles, audio, render, movie, clip or Google Flow. Thai intents such as ภาพ, วิดีโอ, คลิป, หนัง, หนังสั้น, สตอรี่บอร์ด, เสียง, ซับ and เรนเดอร์ are included in the child manifest.

## V7 preferred route
For complete short-film requests, prefer:
- `media.movie.create`
- `media.movie.status`
- `media.preflight.check`

`media.movie.create` is a durable parent workflow. It creates the media project, character lock, storyboard, anchor image, bounded/serial shots, subtitles and final composition. The child MCP auto-worker advances due jobs while the child process is alive, so ChatGPT does not need to issue repeated `media.job.tick` calls during normal operation.

## Minimal default tools
- `media.capabilities`
- `media.movie.create`
- `media.movie.status`
- `media.preflight.check`
- `media.project.create`
- `media.storyboard.plan`
- `media.image.generate`
- `media.video.generate`
- `media.job.status`

Expand child tool schema only when diagnostics or advanced operations are needed: regenerate, voice/music, manual subtitle/compose, provider status, Flow handoff or low-level job controls.

## Example
User: `@Ceo3 ทำคลิปโรงเรียน 24 วินาที แนวตั้ง ตัวละครหน้าเหมือนเดิมทุกฉาก ใส่เสียงและซับ`

Preferred V7 execution:
1. Ceo3 routes the intent to `ceo-mcp-media`.
2. Call `media.movie.create` once with the complete brief and character definition.
3. Return `movieJobId` immediately.
4. Auto-worker advances Anchor → Shot 1 → Shot 2 → Shot 3 → SRT → Compose.
5. Ceo3 reads `media.movie.status` to report progress/final paths.

The primary Ceo MCP Agent remains responsive even when a provider takes minutes to render.

## Provider and quota policy
- Complete movie workflows should explicitly request the intended real provider, normally `gemini`.
- Explicit provider requests are strict by default and do not silently degrade to Mock.
- Default movie video concurrency is 1 to reduce 429 bursts.
- 429 retry metadata creates both job backoff and provider-wide cooldown.
- Guardrail preflight should run before paid generation; movie workflows enable originality rewrite by default.
