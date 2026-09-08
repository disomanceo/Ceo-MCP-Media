# Security

- API credentials come from environment variables only.
- `.env` is ignored; only `.env.example` is committed.
- Never place credentials inside project manifests, prompts, job events or Flow handoffs.
- Remote provider errors are bounded before logging to reduce accidental secret/large-payload capture.
- Paid provider calls are never required by tests; MockProvider is deterministic for image, video, voice and music jobs.
- Google Flow is optional and receives only explicitly prepared prompts/assets.
- Before push/release run secret scan and review staged diff.
