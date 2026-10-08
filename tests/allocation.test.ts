import test from "node:test";
import assert from "node:assert/strict";
import {
  allocationBySymbol,
  allocationSegments,
  type AllocationInput,
} from "../lib/allocation";
import { normalizePosition } from "../lib/normalize";
function position(
  symbol: string,
  amount: string | null,
  cashEquivalent = false,
  basis: string | null = null,
) {
  return normalizePosition({
    instrument: { kind: "stock", id: symbol, symbol, raw_symbol: symbol },
    units: "1",
    cost_basis: basis,
    price: amount,
    cash_equivalent: cashEquivalent,
  });
}
test("combines symbols across accounts and counts cash equivalents only once", () => {
  const result = allocationBySymbol([
    {
      balances: [{ amount: 100 }],
      positions: [position("ABC", "100"), position("FUND", "80", true)],
    },
    {
      balances: [{ amount: 50 }],
      positions: [position("ABC", "50")],
    },
  ]);
  assert.equal(result.partial, false);
  assert.equal(result.total, 300);
  assert.deepEqual(result.rows, [
    {
      symbol: "ABC",
      amount: 150,
      percent: 50,
      costBasis: 150,
      gain: 0,
      gainPercent: 0,
      isCash: false,
      basisEstimated: true,
      missingBasisValue: 150,
    },
    {
      symbol: "Cash",
      amount: 150,
      percent: 50,
      costBasis: null,
      gain: null,
      gainPercent: null,
      isCash: true,
      basisEstimated: false,
      missingBasisValue: 0,
    },
  ]);
});
test("missing cash falls back to known equivalents per account and flags partial data", () => {
  const result = allocationBySymbol([
    {
      balances: [{ amount: 100 }],
      positions: [position("FUND", "80", true)],
    },
    { balances: null, positions: [position("FUND", "40", true)] },
    {
      balances: [{ amount: 0 }],
      positions: [
        position("FUND", "10", true),
        position("SECONDFUND", "20", true),
      ],
    },
  ]);
  assert.equal(result.partial, true);
  assert.equal(result.total, 140);
});
test("missing valuations are omitted and flagged as partial", () => {
  const result = allocationBySymbol([
    {
      balances: [{ amount: 0 }],
      positions: [
        position("ABC", "50"),
        position("XYZ", "75"),
        position("UNKNOWN", null),
      ],
    },
  ]);
  assert.equal(result.partial, true);
  assert.equal(result.total, 125);
  assert.deepEqual(
    result.rows.map((r) => [r.symbol, r.amount]),
    [
      ["XYZ", 75],
      ["ABC", 50],
    ],
  );
});
test("negative allocations suppress pie percentages while preserving signed amounts", () => {
  const result = allocationBySymbol([
    {
      balances: [{ amount: -10 }],
      positions: [position("ABC", "50")],
    },
  ]);
  assert.equal(result.chartable, false);
  assert.equal(result.total, 40);
  assert.ok(result.rows.every((r) => r.percent === null));
});
test("empty and failed sections do not invent allocation", () => {
  assert.deepEqual(allocationBySymbol([]), {
    partial: false,
    total: 0,
    chartable: false,
    rows: [],
  });
  assert.deepEqual(allocationBySymbol([{ balances: null, positions: null }]), {
    partial: true,
    total: 0,
    chartable: false,
    rows: [],
  });
  const account: AllocationInput = {
    balances: [{ amount: 0 }],
    positions: [],
  };
  assert.equal(allocationBySymbol([account]).chartable, false);
});

test("aggregates basis before computing gain and weighted percentage across accounts", () => {
  const result = allocationBySymbol([
    {
      balances: [{ amount: 0 }],
      positions: [position("ABC", "200", false, "100")],
    },
    {
      balances: [{ amount: 0 }],
      positions: [position("ABC", "150", false, "200")],
    },
  ]);
  const row = result.rows[0];
  assert.equal(row.costBasis, 300);
  assert.equal(row.gain, 50);
  assert.ok(Math.abs(row.gainPercent! - (50 / 300) * 100) < 1e-9);
  assert.deepEqual(allocationSegments(row), [
    { kind: "basis", amount: 300 },
    { kind: "gain", amount: 50 },
  ]);
  assert.equal(row.amount, 350);
});

test("missing value leaves aggregate gain unknown in either order", () => {
  for (const missing of [position("ABC", null, false, "80")]) {
    for (const positions of [
      [position("ABC", "200", false, "100"), missing],
      [missing, position("ABC", "200", false, "100")],
    ]) {
      const r = allocationBySymbol([{ balances: [{ amount: 0 }], positions }])
        .rows[0];
      assert.equal(r.costBasis, null);
      assert.equal(r.gain, null);
      assert.equal(r.gainPercent, null);
      assert.deepEqual(allocationSegments(r), [
        { kind: "value", amount: r.amount },
      ]);
    }
  }
});

test("losses, break-even and zero-cost holdings never distort current allocation", () => {
  for (const [value, basis] of [
    [80, 100],
    [100, 100],
    [120, 0],
    [120, 80],
  ]) {
    const r = allocationBySymbol([
      {
        balances: [{ amount: 0 }],
        positions: [position("ABC", String(value), false, String(basis))],
      },
    ]).rows[0];
    const parts = allocationSegments(r);
    assert.ok(parts.every((p) => p.amount >= 0));
    assert.equal(
      parts.reduce((s, p) => s + p.amount, 0),
      value,
    );
    assert.equal(r.gain, value - basis);
    if (value < basis)
      assert.deepEqual(parts, [{ kind: "basis", amount: value }]);
    if (basis === 0) {
      assert.equal(r.gainPercent, null);
      assert.deepEqual(parts, [{ kind: "gain", amount: value }]);
    }
  }
});

test("missing basis in one account preserves another account's known gain in either order", () => {
  for (const positions of [
    [position("ABC", "200", false, "100"), position("ABC", "50")],
    [position("ABC", "50"), position("ABC", "200", false, "100")],
  ]) {
    const result = allocationBySymbol([
      { balances: [{ amount: 0 }], positions },
    ]);
    const row = result.rows[0];
    assert.equal(result.total, 250);
    assert.equal(row.costBasis, 150);
    assert.equal(row.gain, 100);
    assert.equal(row.gainPercent, (100 / 150) * 100);
    assert.equal(row.basisEstimated, true);
    assert.equal(row.missingBasisValue, 50);
    assert.deepEqual(allocationSegments(row), [
      { kind: "basis", amount: 150 },
      { kind: "gain", amount: 100 },
    ]);
  }
});

test("partial lots and a second account combine without double-counting the missing portion", () => {
  const p = position("ABC", "100");
  p.units = 10;
  p.lots = [
    { date: null, quantity: 4, costBasis: { amount: 20 } },
    { date: null, quantity: 6, costBasis: { amount: null } },
  ];
  const row = allocationBySymbol([
    { balances: [{ amount: 0 }], positions: [p, position("ABC", "50")] },
  ]).rows[0];
  assert.equal(row.amount, 150);
  assert.equal(row.costBasis, 130);
  assert.equal(row.gain, 20);
  assert.equal(row.missingBasisValue, 110);
  assert.equal(
    allocationSegments(row).reduce((sum, part) => sum + part.amount, 0),
    150,
  );
});
