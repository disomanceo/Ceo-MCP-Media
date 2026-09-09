# Security

- API credentials come from environment variables only.
- `.env` is ignored; only `.env.example` is committed.
- Never place credentials inside project manifests, prompts, job events or Flow handoffs.
- Remote provider errors are bounded before logging to reduce accidental secret/large-payload capture.
- Paid provider calls are never required by tests; MockProvider is deterministic for image, video, voice and music jobs.
- Google Flow is optional and receives only explicitly prepared prompts/assets.
- Persistent runtime media data defaults outside the managed child install directory; addon updates should not erase projects/jobs/assets.
- Explicit provider requests are strict by default, preventing an unavailable real provider from silently returning Mock artifacts.
- Common third-party/franchise references can be detected and rewritten before paid generation through `media.preflight.check` / the V7 movie workflow.
- Non-retryable 4xx/guardrail failures fail fast. 429 responses use bounded backoff and provider-wide cooldown.
- Video downloads stream to disk when delivered by URL, reducing peak memory exposure for large media files.
- MCP tools expose explicit typed JSON schemas with `additionalProperties: false` to reduce accidental/ambiguous arguments.
- Before push/release run typecheck, tests, FFmpeg smoke, npm audit, staged diff check and secret scan.
