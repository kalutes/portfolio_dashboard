import assert from "node:assert/strict";
import { test } from "node:test";
import { compactUsd } from "../lib/format";

test("chart currency labels do not depend on runtime Intl compact defaults", (t) => {
  t.mock.method(Intl, "NumberFormat", () => {
    throw new Error(
      "Runtime-dependent formatting must not be used for axis labels",
    );
  });
  for (const [value, expected] of [
    [0, "$0"],
    [-0, "$0"],
    [-0.01, "$0"],
    [12.34, "$12.3"],
    [1000, "$1K"],
    [125_000, "$125K"],
    [481_062.93, "$481.1K"],
    [999_999, "$1M"],
    [1_500_000, "$1.5M"],
    [-1500, "-$1.5K"],
    [1_000_000_000, "$1B"],
    [NaN, "Unavailable"],
  ] as const) {
    assert.equal(compactUsd(value), expected);
  }
});
