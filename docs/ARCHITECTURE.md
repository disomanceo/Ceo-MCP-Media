# Architecture

```text
ChatGPT / Ceo3
      |
      v
Ceo MCP Media (stdio MCP)
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
      |       |
      |       +-- ProviderRouter
      |       |      +-- Mock
      |       |      +-- Gemini Image
      |       |      +-- Veo long-running video
      |       |      +-- durable Voice / Music provider contracts
      |       |      +-- future providers
      |       |
      |       +-- FFmpeg Composer
      |
      +-- Optional Flow handoff
```

## Non-blocking invariant
An MCP call creates or advances work; it does not hold the transport open while a remote model renders. Provider operation IDs and movie workflow state are persisted in job records. The MCP server has a bounded auto-worker that advances due jobs while the child process is alive; manual `media.job.tick` remains available for diagnostics/recovery.

## V7 movie workflow
`media.movie.create` creates a parent durable workflow. The parent coordinates child jobs rather than performing remote generation synchronously. Default video concurrency is 1, so one Veo shot completes before the next is submitted unless configured otherwise. This reduces 429 bursts and makes failures attributable to one shot.

## Recovery
- Atomic JSON writes protect individual local job/project records.
- `running` jobs older than `CEO_MEDIA_RUNNING_LEASE_MS` become due again after a process crash.
- Video provider polling does not consume normal submit retry attempts.
- Poll errors have a separate bounded error budget.
- Non-retryable guardrail/4xx provider errors fail fast.

## Quota management
Provider 429 responses use `Retry-After`/provider retry metadata when available. The job receives a delayed `nextRunAt`, and a process-wide provider cooldown prevents following jobs from immediately hammering the same provider.

## Persistence
If no explicit data directory is set, Windows uses `%LOCALAPPDATA%\Ceo\media-data`. This keeps projects, jobs and assets outside the managed child-MCP install directory so addon updates do not erase media state.

## Provider boundary
Callers use media capability contracts, never provider-specific endpoints. Model names and API base URLs are environment-controlled. An explicitly requested provider is strict by default and cannot silently degrade into Mock output.

## Continuity
Character identity is represented by Character Bible + continuity tags + up to three reference images. Storyboard shots inherit context. Current Auto Director scores metadata continuity; Vision-based rendered-frame QA remains a P1 hardening item.

## Composition
FFmpeg is the canonical local renderer: concatenate generated shots, optional audio mix, optional subtitle burn-in, fast-start MP4 output. Normalize/loudness/exact-duration QA is the next composition hardening layer.
