import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { JobStore } from "../src/core/job-store.js";
import { JobRunner } from "../src/core/job-runner.js";
import { ProviderRouter } from "../src/providers/router.js";
import { ProviderError, type MediaProvider } from "../src/providers/provider.js";
import { invokeFlowNative } from "../src/providers/flow-native-provider.js";
import { clearProviderCooldown, getProviderCooldown } from "../src/providers/quota-manager.js";

class RateLimitedGemini implements MediaProvider {
  id = "gemini" as const;
  async health() { return { id: this.id, ready: true, capabilities: ["image"] }; }
  async generateImage(): Promise<{ outputPath: string }> { throw new ProviderError("rate limited", { retryable: true, retryAfterMs: 5000, code: "RATE_LIMIT", status: 429 }); }
}

class GuardrailGemini implements MediaProvider {
  id = "gemini" as const;
  async health() { return { id: this.id, ready: true, capabilities: ["image"] }; }
  async generateImage(): Promise<{ outputPath: string }> { throw new ProviderError("third-party content guardrail", { retryable: false, code: "GUARDRAIL", status: 400 }); }
}

test("429 applies retry delay and provider-wide cooldown", async () => {
  clearProviderCooldown();
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-rate-"));
  const store = new JobStore();
  const router = new ProviderRouter();
  router.register(new RateLimitedGemini());
  const runner = new JobRunner(store, router);
  const job = await store.create({ type: "image.generate", provider: "gemini", input: { prompt: "x", outputPath: path.join(process.env.CEO_MEDIA_DATA_DIR!, "x.jpg") } });
  const before = Date.now();
  const done = await runner.runOnce(job.id);
  assert.equal(done.status, "waiting");
  assert.ok(new Date(String(done.nextRunAt)).getTime() - before >= 4500);
  assert.equal(getProviderCooldown("gemini").active, true);
  clearProviderCooldown();
});

test("guardrail errors fail fast instead of wasting retries", async () => {
  clearProviderCooldown();
  process.env.CEO_MEDIA_DATA_DIR = await mkdtemp(path.join(os.tmpdir(), "ceo-media-guard-"));
  const store = new JobStore();
  const router = new ProviderRouter();
  router.register(new GuardrailGemini());
  const runner = new JobRunner(store, router);
  const job = await store.create({ type: "image.generate", provider: "gemini", input: { prompt: "x", outputPath: path.join(process.env.CEO_MEDIA_DATA_DIR!, "x.jpg") } });
  const done = await runner.runOnce(job.id);
  assert.equal(done.status, "failed");
  assert.equal(done.attempts, 1);
});

test("Flow policy and anti-abuse blockers are non-retryable", async () => {
  const oldCommand = process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND;
  const oldArgs = process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON;
  process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND = process.execPath;
  try {
    for (const code of ["FLOW_PERSON_POLICY", "FLOW_UNUSUAL_ACTIVITY"]) {
      process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON = JSON.stringify([
        "-e",
        `process.stderr.write("[${code}] blocked by Flow"); process.exit(1);`
      ]);
      await assert.rejects(
        () => invokeFlowNative("video.start", {}),
        (error: unknown) => error instanceof ProviderError && error.code === code && error.retryable === false
      );
    }
  } finally {
    if (oldCommand == null) delete process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND; else process.env.CEO_MEDIA_FLOW_NATIVE_COMMAND = oldCommand;
    if (oldArgs == null) delete process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON; else process.env.CEO_MEDIA_FLOW_NATIVE_ARGS_JSON = oldArgs;
  }
});