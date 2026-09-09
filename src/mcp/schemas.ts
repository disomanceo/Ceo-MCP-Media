type Schema = Record<string, any>;
const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
const num = (description?: string): Schema => ({ type: "number", ...(description ? { description } : {}) });
const bool = (description?: string): Schema => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) });
const aspect: Schema = { type: "string", enum: ["16:9", "9:16", "1:1"] };
const resolution: Schema = { type: "string", enum: ["720p", "1080p", "4k"] };
const provider: Schema = { type: "string", enum: ["mock", "gemini", "flow"] };
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}) });

const schemas: Record<string, Schema> = {
  "media.movie.create": obj({
    name: str("Project/movie name"), brief: str("Complete creative brief"), totalDurationSec: num("Total target duration; storyboard is split into <=8 second shots"), aspectRatio: aspect, resolution, fps: num(), provider,
    character: obj({ name: str(), description: str(), wardrobe: str(), voice: str(), continuityTags: arr(str()) }, ["name", "description"]),
    anchorPrompt: str(), shotPrompts: arr(str()), dialogues: arr(str()), outputPath: str(), subtitlePath: str(), compose: bool(), autoRewriteGuardrails: bool(), videoConcurrency: num("1-3; default 1 to reduce quota pressure"), idempotencyKey: str(), timeoutMs: num()
  }, ["name", "brief", "character"]),
  "media.movie.status": obj({ jobId: str() }, ["jobId"]),
  "media.preflight.check": obj({ prompt: str(), autoRewrite: bool() }, ["prompt"]),
  "media.project.create": obj({ name: str(), brief: str(), aspectRatio: aspect, resolution, fps: num() }, ["name", "brief"]),
  "media.project.list": obj({}),
  "media.project.get": obj({ projectId: str() }, ["projectId"]),
  "media.character.lock": obj({ projectId: str(), name: str(), description: str(), wardrobe: str(), voice: str(), referenceImages: arr(str()), continuityTags: arr(str()) }, ["projectId", "name", "description"]),
  "media.storyboard.plan": obj({ projectId: str(), title: str(), brief: str(), totalDurationSec: num(), aspectRatio: aspect, maxShotSec: num() }, ["projectId", "totalDurationSec"]),
  "media.image.generate": obj({ projectId: str(), name: str(), prompt: str(), provider, outputPath: str(), aspectRatio: aspect, referenceImages: arr(str()), idempotencyKey: str(), autoRewriteGuardrails: bool() }, ["prompt"]),
  "media.video.generate": obj({ projectId: str(), name: str(), prompt: str(), provider, outputPath: str(), aspectRatio: aspect, resolution, durationSec: num(), referenceImages: arr(str()), firstFrame: str(), lastFrame: str(), idempotencyKey: str(), autoRewriteGuardrails: bool() }, ["prompt"]),
  "media.video.regenerate": obj({ jobId: str(), prompt: str(), provider, outputPath: str(), idempotencyKey: str() }, ["jobId"]),
  "media.audio.voice": obj({ projectId: str(), name: str(), text: str(), provider, outputPath: str(), voice: str(), language: str(), speed: num(), style: str(), idempotencyKey: str() }, ["text"]),
  "media.audio.music": obj({ projectId: str(), name: str(), prompt: str(), provider, outputPath: str(), durationSec: num(), mood: str(), instrumental: bool(), idempotencyKey: str() }, ["prompt"]),
  "media.compose": obj({ projectId: str(), clips: arr(str()), outputPath: str(), subtitleFile: str(), audioFile: str(), idempotencyKey: str() }, ["clips", "outputPath"]),
  "media.subtitle.generate": obj({ projectId: str(), outputPath: str() }, ["projectId"]),
  "media.director.review": obj({ projectId: str(), threshold: num() }, ["projectId"]),
  "media.job.status": obj({ jobId: str() }, ["jobId"]),
  "media.job.list": obj({}),
  "media.job.run_once": obj({ jobId: str() }, ["jobId"]),
  "media.job.tick": obj({ limit: num() }),
  "media.job.cancel": obj({ jobId: str() }, ["jobId"]),
  "media.provider.status": obj({}),
  "media.flow.handoff": obj({ projectId: str(), outputPath: str() }, ["projectId"]),
  "media.capabilities": obj({})
};

export function schemaFor(name: string): Schema {
  return schemas[name] ?? obj({});
}
