import test from "node:test";
import assert from "node:assert/strict";

import { directionLabelFromVector, updateEnemyFacingState } from "../web/src/render-facing.js";

test("directionLabelFromVector maps all eight directions", () => {
  assert.equal(directionLabelFromVector(1, 0), "east");
  assert.equal(directionLabelFromVector(1, 1), "south-east");
  assert.equal(directionLabelFromVector(0, 1), "south");
  assert.equal(directionLabelFromVector(-1, 1), "south-west");
  assert.equal(directionLabelFromVector(-1, 0), "west");
  assert.equal(directionLabelFromVector(-1, -1), "north-west");
  assert.equal(directionLabelFromVector(0, -1), "north");
  assert.equal(directionLabelFromVector(1, -1), "north-east");
});

test("wisp facing rotates through non-front directions from real movement only", () => {
  let state = {
    kind: "wisp",
    previousFacing: "south",
    previousSmoothedDx: 0,
    previousSmoothedDy: 0,
    movementDx: 0,
    movementDy: 0,
  };

  const samples = [
    { x: 0.22, y: 0, expected: "east" },
    { x: 0.18, y: -0.18, expected: "north-east" },
    { x: 0, y: -0.24, expected: "north" },
    { x: -0.18, y: -0.18, expected: "north-west" },
    { x: -0.24, y: 0, expected: "west" },
    { x: -0.18, y: 0.18, expected: "south-west" },
    { x: 0, y: 0.24, expected: "south" },
    { x: 0.18, y: 0.18, expected: "south-east" },
  ];

  const facings = [];
  for (const sample of samples) {
    state = updateEnemyFacingState({
      ...state,
      movementDx: sample.x,
      movementDy: sample.y,
    });
    facings.push(state.facing);
  }

  assert.deepEqual(facings, samples.map((sample) => sample.expected));
});

test("enemy facing stays stable when there is effectively no movement", () => {
  const state = updateEnemyFacingState({
    kind: "wisp",
    previousFacing: "east",
    previousSmoothedDx: 0.16,
    previousSmoothedDy: 0,
    movementDx: 0.0005,
    movementDy: 0.0004,
  });

  assert.equal(state.facing, "east");
});
