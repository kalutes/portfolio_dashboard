import test from "node:test";
import assert from "node:assert/strict";
import { allocationBySymbol, type AllocationInput } from "../lib/allocation";
import { normalizePosition } from "../lib/normalize";
function position(
  symbol: string,
  amount: string | null,
  cashEquivalent = false,
) {
  return normalizePosition({
    instrument: { kind: "stock", id: symbol, symbol, raw_symbol: symbol },
    units: "1",
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
    { symbol: "ABC", amount: 150, percent: 50 },
    { symbol: "Cash", amount: 150, percent: 50 },
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
