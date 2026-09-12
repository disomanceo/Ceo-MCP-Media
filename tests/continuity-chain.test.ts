import test from "node:test";
import assert from "node:assert/strict";
import { planStoryboard } from "../src/core/storyboard.js";
import { buildContinuityPrompt } from "../src/core/continuity.js";
import { reviewShot } from "../src/core/director.js";

test("V12 storyboard defaults to strict action/camera continuity metadata", () => {
  const board = planStoryboard({ projectId: "p1", title: "Continuity", brief: "A runner crosses a school yard. The runner enters the classroom.", totalDurationSec: 16, aspectRatio: "9:16", characters: [] });
  assert.equal(board.shots.length, 2);
  assert.equal(board.shots[0].continuityMode, "strict");
  assert.equal(board.shots[1].startFrameRequired, true);
  assert.ok(board.shots[0].actionHandoff);
  assert.ok(board.shots[1].cameraLock);
  assert.equal(board.shots[1].transition, "continuous");
});

test("V12 continuity prompt explicitly forbids action reset and requires previous end-frame start", () => {
  const board = planStoryboard({ projectId: "p2", title: "Chain", brief: "Run forward. Continue running.", totalDurationSec: 16, characters: [] });
  const prompt = buildContinuityPrompt("Continue running toward the door.", board.shots[1], board.shots[0]);
  assert.match(prompt, /MANDATORY TEMPORAL CONTINUITY/);
  assert.match(prompt, /Start exactly from the supplied previous-shot end frame/);
  assert.match(prompt, /first 1\.0 second/);
  assert.match(prompt, /final ~0\.75 seconds/);
  assert.match(prompt, /Do not return the character to a neutral pose/);
  const review = reviewShot(board.shots[1], board.shots[0], 70);
  assert.equal(review.accepted, true);
});
