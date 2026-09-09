import test from "node:test";
import assert from "node:assert/strict";
import { preflightPrompt } from "../src/core/preflight.js";

test("preflight detects and rewrites third-party references", () => {
  const result = preflightPrompt("ฮีโร่แรงบันดาลใจจาก Iron Man ของ Marvel ต่อสู้ในโรงเรียน", true);
  assert.equal(result.risk, "high");
  assert.equal(result.rewritten, true);
  assert.match(result.safePrompt, /original|ออริจินัล/i);
  assert.doesNotMatch(result.safePrompt, /iron\s*man|marvel/i);
});

test("preflight leaves original prompts unchanged when low risk", () => {
  const prompt = "Thai rescue engineer in an industrial exoskeleton at a school";
  const result = preflightPrompt(prompt, true);
  assert.equal(result.risk, "low");
  assert.equal(result.safePrompt, prompt);
  assert.equal(result.rewritten, false);
});
