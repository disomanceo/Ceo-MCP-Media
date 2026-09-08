# Current Google API notes

Validated against Google AI for Developers documentation on 2026-09-08.

- Gemini image model: `gemini-3.1-flash-image` via `POST /v1beta/interactions`.
- Image output controls use `response_format` with `type: image`, `aspect_ratio`, and optional image size/mime type.
- Veo model: `veo-3.1-generate-preview` via `POST /v1beta/models/{model}:predictLongRunning`.
- Veo generation is asynchronous and returns an operation name that must be polled.
- Veo 3.1 accepts landscape `16:9` and portrait `9:16`, first/last frame interpolation, and up to three asset reference images.
- `lastFrame` is represented in the REST generation instance; reference images use `referenceType: asset`.
- 1080p/4k and reference-image/interpolation cases require 8-second generation; the adapter normalizes duration accordingly.

Model IDs and preview availability can change. Keep them environment-configurable and revalidate before production upgrades.
