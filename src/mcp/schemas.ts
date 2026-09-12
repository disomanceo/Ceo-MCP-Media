type Schema = Record<string, any>;
const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
const num = (description?: string): Schema => ({ type: "number", ...(description ? { description } : {}) });
const bool = (description?: string): Schema => ({ type: "boolean", ...(description ? { description } : {}) });
const arr = (items: Schema, description?: string): Schema => ({ type: "array", items, ...(description ? { description } : {}) });
const aspect: Schema = { type: "string", enum: ["16:9", "9:16", "1:1"] };
const resolution: Schema = { type: "string", enum: ["720p", "1080p", "4k"] };
const provider: Schema = { type: "string", enum: ["auto", "mock", "gemini", "flow-native", "flow-web", "ai-studio-web", "flow"] };
const apiProvider: Schema = { type: "string", enum: ["mock", "gemini"] };
const editor: Schema = { type: "string", enum: ["auto", "ffmpeg", "capcut"] };
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}) });

const schemas: Record<string, Schema> = {
  "media.movie.create": obj({
    name: str("Project/movie name"), brief: str("Complete creative brief"), script: str("Optional full script; when supplied it is used to plan shots and is persisted in the production workspace"),
    totalDurationSec: num("Total target duration; storyboard is split into <=8 second shots"), aspectRatio: aspect, resolution, fps: num(), provider,
    character: obj({ name: str(), description: str(), wardrobe: str(), voice: str(), referenceImages: arr(str(), "Seed/reference image file paths, up to 3"), continuityTags: arr(str()) }, ["name", "description"]),
    anchorPrompt: str(), shotPrompts: arr(str()), dialogues: arr(str()), outputPath: str(), subtitlePath: str(), compose: bool(), finalEditor: editor,
    generateVoice: bool(), voiceProvider: apiProvider, voiceLanguage: str(), voiceSpeed: num(), voiceStyle: str(),
    generateMusic: bool(), musicProvider: apiProvider, musicPrompt: str(), musicMood: str(),
    autoRewriteGuardrails: bool(), videoConcurrency: num("1-4 for API/local/native providers; browser providers remain serial"), idempotencyKey: str(), timeoutMs: num()
  }, ["name", "brief", "character"]),
  "media.movie.status": obj({ jobId: str() }, ["jobId"]),
  "media.movie.manifest": obj({ jobId: str() }, ["jobId"]),
  "media.preflight.check": obj({ prompt: str(), autoRewrite: bool() }, ["prompt"]),
  "media.studio.status": obj({}),
  "media.studio.route": obj({ capability: { type: "string", enum: ["image", "video"] }, provider }, ["capability"]),
  "media.external.next": obj({ projectId: str() }),
  "media.external.list": obj({ projectId: str() }),
  "media.external.complete": obj({ jobId: str(), outputPath: str(), metadata: { type: "object", additionalProperties: true } }, ["jobId", "outputPath"]),
  "media.external.fail": obj({ jobId: str(), error: str(), retryable: bool() }, ["jobId", "error"]),
  "media.asset.list": obj({ projectId: str() }),
  "media.asset.get": obj({ assetId: str() }, ["assetId"]),
  "media.asset.register": obj({ path: str(), projectId: str(), jobId: str(), source: str(), provenance: { type: "object", additionalProperties: true } }, ["path"]),
  "media.ffmpeg.status": obj({}),
  "media.ffmpeg.doctor": obj({}),
  "media.ffmpeg.contract": obj({ static: bool() }),
  "media.ffmpeg.render": obj({ project: str(), work: str(), keep: bool(), fast: bool() }, ["project"]),
  "media.ffmpeg.probe": obj({ input: str(), analyze: bool() }, ["input"]),
  "media.ffmpeg.check": obj({ input: str(), platform: { type: "string", enum: ["youtube", "shorts", "reels", "tiktok", "x", "linkedin", "broadcast", "podcast", "custom"] }, aspect: str(), lufs: num(), tp: num(), noLoudness: bool() }, ["input"]),
  "media.ffmpeg.look": obj({ input: str(), output: str(), tiles: str(), width: num(), noTimecode: bool() }, ["input"]),
  "media.project.create": obj({ name: str(), brief: str(), aspectRatio: aspect, resolution, fps: num() }, ["name", "brief"]),
  "media.project.list": obj({}),
  "media.project.get": obj({ projectId: str() }, ["projectId"]),
  "media.character.lock": obj({ projectId: str(), name: str(), description: str(), wardrobe: str(), voice: str(), referenceImages: arr(str()), continuityTags: arr(str()) }, ["projectId", "name", "description"]),
  "media.storyboard.plan": obj({ projectId: str(), title: str(), brief: str(), totalDurationSec: num(), aspectRatio: aspect, maxShotSec: num() }, ["projectId", "totalDurationSec"]),
  "media.image.generate": obj({ projectId: str(), name: str(), prompt: str(), provider, outputPath: str(), aspectRatio: aspect, referenceImages: arr(str()), idempotencyKey: str(), autoRewriteGuardrails: bool() }, ["prompt"]),
  "media.video.generate": obj({ projectId: str(), name: str(), prompt: str(), provider, outputPath: str(), aspectRatio: aspect, resolution, durationSec: num(), referenceImages: arr(str()), firstFrame: str(), lastFrame: str(), idempotencyKey: str(), autoRewriteGuardrails: bool() }, ["prompt"]),
  "media.video.regenerate": obj({ jobId: str(), prompt: str(), provider: apiProvider, outputPath: str(), idempotencyKey: str() }, ["jobId"]),
  "media.audio.voice": obj({ projectId: str(), name: str(), text: str(), provider: apiProvider, outputPath: str(), voice: str(), language: str(), speed: num(), style: str(), idempotencyKey: str() }, ["text"]),
  "media.audio.music": obj({ projectId: str(), name: str(), prompt: str(), provider: apiProvider, outputPath: str(), durationSec: num(), mood: str(), instrumental: bool(), idempotencyKey: str() }, ["prompt"]),
  "media.compose": obj({ projectId: str(), clips: arr(str()), outputPath: str(), subtitleFile: str(), audioFile: str(), musicFile: str(), transitionSec: num(), deliveryPlatform: { type: "string", enum: ["youtube", "shorts", "reels", "tiktok", "x", "linkedin", "broadcast", "podcast"] }, loudnessLufs: num(), truePeakDb: num(), idempotencyKey: str() }, ["clips", "outputPath"]),
  "media.subtitle.generate": obj({ projectId: str(), outputPath: str() }, ["projectId"]),
  "media.director.review": obj({ projectId: str(), threshold: num() }, ["projectId"]),
  "media.job.status": obj({ jobId: str() }, ["jobId"]),
  "media.job.list": obj({}),
  "media.job.run_once": obj({ jobId: str() }, ["jobId"]),
  "media.job.tick": obj({ limit: num() }),
  "media.job.cancel": obj({ jobId: str() }, ["jobId"]),
  "media.provider.status": obj({}),
  "media.flow.local_status": obj({}),
  "media.flow.local_auth": obj({ action: { type: "string", enum: ["open", "check"] } }, ["action"]),
  "media.flow.handoff": obj({ projectId: str(), outputPath: str() }, ["projectId"]),
  "media.capabilities": obj({})
};

export function schemaFor(name: string): Schema { return schemas[name] ?? obj({}); }
