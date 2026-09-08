import test from "node:test";
import assert from "node:assert/strict";
import { planStoryboard } from "../src/core/storyboard.js";
test("storyboard splits long duration into <=8 second shots", () => { const board = planStoryboard({ projectId: "p", title: "t", brief: "One. Two. Three.", totalDurationSec: 25 }); assert.equal(board.shots.length, 4); assert.ok(board.shots.every((s) => s.durationSec <= 8)); assert.equal(board.shots.reduce((n, s) => n + s.durationSec, 0), 25); });
