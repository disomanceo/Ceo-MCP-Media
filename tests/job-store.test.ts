import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { JobStore } from "../src/core/job-store.js";
test("job store enforces idempotency key", async () => { process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-")); const store = new JobStore(); const a = await store.create({ type: "image.generate", input: { prompt: "x" }, idempotencyKey: "same" }); const b = await store.create({ type: "image.generate", input: { prompt: "x" }, idempotencyKey: "same" }); assert.equal(a.id, b.id); });
