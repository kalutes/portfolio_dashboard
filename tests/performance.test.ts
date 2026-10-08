import test from "node:test";
import assert from "node:assert/strict";
import { unrealizedPerformance, gainPercent } from "../lib/performance";

test("unrealized returns retain losses, and distinguish missing from zero basis", () => {
  assert.deepEqual(unrealizedPerformance(150, 100), {
    costBasis: 100,
    gain: 50,
    gainPercent: 50,
  });
  assert.deepEqual(unrealizedPerformance(75, 100), {
    costBasis: 100,
    gain: -25,
    gainPercent: -25,
  });
  assert.deepEqual(unrealizedPerformance(0, 100), {
    costBasis: 100,
    gain: -100,
    gainPercent: -100,
  });
  assert.deepEqual(unrealizedPerformance(150, 0), {
    costBasis: 0,
    gain: 150,
    gainPercent: null,
  });
  for (const basis of [null, NaN, Infinity, -1])
    assert.equal(unrealizedPerformance(150, basis).gain, null);
  for (const value of [null, NaN, Infinity])
    assert.equal(unrealizedPerformance(value, 100).gain, null);
  assert.equal(gainPercent(12.5), "+12.50%");
  assert.equal(gainPercent(-12.5), "-12.50%");
  assert.equal(gainPercent(null), "Unavailable");
});
