# Ceo3 Delegation Contract

Ceo MCP Media runs as a child MCP rather than inflating the primary Ceo MCP Agent tool surface.

## Intent routing
Delegate for media production intents: image/video generation, storyboard, character continuity, subtitles, audio, render, movie, clip or Google Flow.

## Minimal default tools
- `media.capabilities`
- `media.project.create`
- `media.storyboard.plan`
- `media.image.generate`
- `media.video.generate`
- `media.job.status`

Expand child tool schema only when advanced operations are needed: regenerate, voice/music, subtitle, compose, provider status or Flow handoff.

## Example
User: `@Ceo3 ทำคลิปโรงเรียน 24 วินาที แนวตั้ง`

1. Ceo3 creates/uses a Ceo MCP Media project.
2. `media.storyboard.plan` creates three <=8s shots.
3. `media.video.generate` creates one durable job per shot.
4. Worker/ticks progress jobs across separate MCP calls.
5. `media.compose` creates final render job.
6. Ceo3 returns final path/status.

The primary Ceo MCP Agent stays responsive even if a provider takes minutes to render.
