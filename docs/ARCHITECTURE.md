# Architecture

```text
ChatGPT / Ceo3
      |
      v
Ceo MCP Media (stdio MCP)
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
      |       |      +-- future Kling / Runway / OpenAI
      |       |
      |       +-- FFmpeg Composer
      |
      +-- Optional Flow handoff
```

## Non-blocking invariant
An MCP call creates or advances work; it does not hold the transport open while a remote model renders. Provider operation IDs are persisted in job records. A worker or later MCP call polls and resumes.

## Persistence
The local implementation uses atomic JSON files for transparent debugging. Interfaces allow later replacement with SQLite/Postgres/Redis queues.

## Provider boundary
Callers use media capability contracts, never provider-specific endpoints. Model names and API base URLs are environment-controlled.

## Continuity
Character identity is represented by Character Bible + continuity tags + up to three reference images. Storyboard shots inherit context. Auto Director scores metadata continuity before generation/regeneration.

## Composition
FFmpeg is the canonical local renderer: concatenate generated shots, optional audio mix, optional subtitle burn-in, fast-start MP4 output.
