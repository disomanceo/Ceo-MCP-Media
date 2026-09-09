# Security

- API credentials come from environment variables only; `.env` is ignored.
- V8 does not require a Gemini API credential. When AUTO selects Flow/AI Studio Web, browser sign-in remains user-controlled.
- Browser actions must never request, type, store or proxy Google passwords, OTPs, recovery codes or session secrets. If sign-in is required, pause for the user to sign in manually.
- External browser/editor actions persist only bounded workflow metadata: provider name, URL, prompts, reference file paths, semantic instructions and expected output path.
- An external action is completed only after the referenced local output file exists.
- External actions are excluded from automatic due-job polling, preventing repeated browser submissions/credit consumption.
- Explicit API provider requests remain strict; unavailable Gemini does not silently return Mock artifacts.
- Guardrail/non-retryable errors fail fast. 429 responses use bounded backoff and provider-wide cooldown.
- Remote provider errors are bounded before logging.
- Video downloads stream to disk when delivered by URL.
- Persistent media data defaults outside the managed child install directory.
- CapCut automatic publishing/upload and force-write/license bypass remain out of scope. Run doctor/version checks before draft mutation; do not force an old template into a newer app schema.
- Google Flow portable handoff remains optional and contains no credentials.
- Tests use deterministic MockProvider/browser-action simulation; paid generation is never required by the test suite.
- Before release run typecheck, tests, FFmpeg smoke, npm audit, diff check and secret scan.
