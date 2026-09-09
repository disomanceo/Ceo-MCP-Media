import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { JobStore } from "../src/core/job-store.js";

test("job store enforces idempotency key", async () => {
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-"));
  const store = new JobStore();
  const a = await store.create({ type: "image.generate", input: { prompt: "x" }, idempotencyKey: "same" });
  const b = await store.create({ type: "image.generate", input: { prompt: "x" }, idempotencyKey: "same" });
  assert.equal(a.id, b.id);
});

test("stale running jobs become due for crash recovery", async () => {
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-stale-"));
  process.env.CEO_MEDIA_RUNNING_LEASE_MS = "10000";
  const store = new JobStore();
  const job = await store.create({ type: "image.generate", input: { prompt: "recover" } });
  job.status = "running";
  job.updatedAt = new Date(Date.now() - 20_000).toISOString();
  await store.save(job);
  // save() refreshes updatedAt, so emulate a process that died after the last persisted running state.
  const persisted = await store.get(job.id);
  persisted.updatedAt = new Date(Date.now() - 20_000).toISOString();
  const file = (store as any).file?.(job.id);
  if (file) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(file, JSON.stringify(persisted, null, 2), "utf8");
  }
  const due = await store.due(10);
  assert.ok(due.some((x) => x.id === job.id));
});
