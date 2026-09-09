import test from "node:test";
import assert from "node:assert/strict";
import { schemaFor } from "../src/mcp/schemas.js";

test("movie.create exposes a typed MCP schema", () => {
  const schema: any = schemaFor("media.movie.create");
  assert.equal(schema.type, "object");
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes("name"));
  assert.ok(schema.required.includes("brief"));
  assert.ok(schema.required.includes("character"));
  assert.deepEqual(schema.properties.aspectRatio.enum, ["16:9", "9:16", "1:1"]);
  assert.deepEqual(schema.properties.resolution.enum, ["720p", "1080p", "4k"]);
  assert.equal(schema.properties.character.type, "object");
  assert.ok(schema.properties.provider.enum.includes("auto"));
  assert.ok(schema.properties.provider.enum.includes("flow-native"));
  assert.ok(schema.properties.provider.enum.includes("flow-web"));
  assert.ok(schema.properties.provider.enum.includes("ai-studio-web"));
  assert.deepEqual(schema.properties.finalEditor.enum, ["auto", "ffmpeg", "capcut"]);
});

test("video.generate schema describes durable generation inputs", () => {
  const schema: any = schemaFor("media.video.generate");
  assert.ok(schema.required.includes("prompt"));
  assert.equal(schema.properties.referenceImages.type, "array");
  assert.equal(schema.properties.durationSec.type, "number");
});

test("V10 ffmpeg and asset schemas are typed", () => {
  const check: any = schemaFor("media.ffmpeg.check");
  assert.ok(check.required.includes("input"));
  assert.ok(check.properties.platform.enum.includes("reels"));
  const asset: any = schemaFor("media.asset.register");
  assert.ok(asset.required.includes("path"));
  const compose: any = schemaFor("media.compose");
  assert.equal(compose.properties.transitionSec.type, "number");
  assert.equal(compose.properties.loudnessLufs.type, "number");
});
