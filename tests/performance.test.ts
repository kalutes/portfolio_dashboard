import test from "node:test";
import assert from "node:assert/strict";
import {
  unrealizedPerformance,
  positionPerformance,
  gainPercent,
} from "../lib/performance";
import { basisWarningText } from "../app/components/basis-warning";

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

function holding(
  value: number | null,
  basis: number | null,
  lots: { quantity: number | null; basis: number | null }[] = [],
  units: number | null = 10,
) {
  return {
    value: { amount: value },
    costBasis: { amount: basis },
    units,
    lots: lots.map((lot) => ({
      date: null,
      quantity: lot.quantity,
      costBasis: { amount: lot.basis },
    })),
  };
}

test("unknown basis is treated as break-even for display without modifying source data", () => {
  const position = holding(300, null);
  assert.deepEqual(positionPerformance(position), {
    costBasis: 300,
    gain: 0,
    gainPercent: 0,
    basisEstimated: true,
    missingBasisValue: 300,
  });
  assert.equal(position.costBasis.amount, null);
  assert.match(
    basisWarningText(positionPerformance(position)),
    /Missing cost basis for \$300/,
  );
  assert.match(basisWarningText(positionPerformance(position)), /break-even/);
  assert.equal(basisWarningText(positionPerformance(holding(300, 200))), "");
});

test("partial lots retain known gains and losses while only the unknown remainder is break-even", () => {
  for (const [basis, expectedGain] of [
    [80, 40],
    [160, -40],
  ]) {
    const result = positionPerformance(
      holding(300, null, [
        { quantity: 4, basis },
        { quantity: 3, basis: null },
      ]),
    );
    assert.equal(result.costBasis, basis + 180);
    assert.equal(result.gain, expectedGain);
    assert.equal(result.missingBasisValue, 180);
    assert.equal(result.basisEstimated, true);
    assert.equal(result.gainPercent, (expectedGain / (basis + 180)) * 100);
  }
});

test("complete position basis takes priority; complete lots and zero basis are also known", () => {
  assert.equal(
    positionPerformance(holding(300, 200, [{ quantity: 10, basis: null }]))
      .basisEstimated,
    false,
  );
  const complete = positionPerformance(
    holding(300, null, [
      { quantity: 4, basis: 80 },
      { quantity: 6, basis: 120 },
    ]),
  );
  assert.equal(complete.costBasis, 200);
  assert.equal(complete.gain, 100);
  assert.equal(complete.basisEstimated, false);
  const zero = positionPerformance(holding(300, 0));
  assert.equal(zero.gain, 300);
  assert.equal(zero.basisEstimated, false);
  const lotsZero = positionPerformance(
    holding(300, null, [{ quantity: 10, basis: 0 }]),
  );
  assert.equal(lotsZero.gain, 300);
  assert.equal(lotsZero.basisEstimated, false);
});

test("missing valuation and invalid lot coverage do not invent known gains", () => {
  for (const value of [null, NaN, Infinity, -100]) {
    const result = positionPerformance(holding(value, null));
    assert.equal(result.gain, null);
    assert.equal(result.missingBasisValue, null);
  }
  for (const lots of [
    [{ quantity: 11, basis: 100 }],
    [{ quantity: null, basis: 100 }],
    [{ quantity: -1, basis: 100 }],
  ]) {
    const result = positionPerformance(holding(300, null, lots));
    assert.equal(result.gain, 0);
    assert.equal(result.missingBasisValue, 300);
  }
  const zeroValue = positionPerformance(holding(0, null));
  assert.equal(zeroValue.gain, 0);
  assert.equal(zeroValue.basisEstimated, true);
});

test("a lot with unknown quantity does not erase other quantifiable lots' gains", () => {
  const result = positionPerformance(
    holding(300, null, [
      { quantity: 4, basis: 80 },
      { quantity: null, basis: null },
    ]),
  );
  assert.equal(result.costBasis, 260);
  assert.equal(result.gain, 40);
  assert.equal(result.missingBasisValue, 180);
  const tiny = positionPerformance(
    holding(10, null, [{ quantity: 1e-9, basis: null }], 1e-9),
  );
  assert.equal(tiny.gain, 0);
  assert.equal(tiny.missingBasisValue, 10);
});
