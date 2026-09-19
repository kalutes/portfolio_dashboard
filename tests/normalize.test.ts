import test from "node:test";
import assert from "node:assert/strict";
import type { Account, AccountPosition } from "snaptrade-typescript-sdk";
import {
  normalizeAccount,
  normalizeBalance,
  normalizePosition,
  numeric,
  sumMoney,
  freshness,
} from "../lib/normalize";
import { money } from "../lib/format";

test("missing amounts stay missing, zero survives, and nonfinite numbers are rejected", () => {
  for (const value of [null, undefined, "", "  ", "NaN", Infinity, {}, true])
    assert.equal(numeric(value), null);
  assert.equal(numeric("0"), 0);
  assert.deepEqual(
    normalizeBalance({ currency: { code: "USD" }, cash: null }),
    { amount: null },
  );
  assert.equal(money({ amount: null }), "Unavailable");
  assert.equal(money(null), "Unavailable");
});
test("money sum adds valid amounts and formats cleanly as USD", () => {
  assert.deepEqual(sumMoney([{ amount: 10 }, { amount: 20 }, { amount: 5 }]), {
    amount: 35,
  });
  assert.equal(money({ amount: 500 }), "$500.00");
  assert.equal(money(1234.56), "$1,234.56");
});
test("account normalization strips full identifiers and raw metadata", () => {
  const a = normalizeAccount({
    id: "a",
    created_date: "2026-09-09",
    is_paper: false,
    number: "123456789",
    name: null,
    institution_name: "Institution",
    brokerage_authorization: "c",
    balance: { total: { amount: 0, currency: "CAD" } },
    sync_status: {},
    meta: { secret: "private" },
  } as Account);
  assert.equal(a.suffix, "6789");
  assert.equal(a.total.amount, 0);
  assert.equal(a.name, "Unnamed account");
  assert.ok(!JSON.stringify(a).includes("123456789"));
  assert.ok(!JSON.stringify(a).includes("private"));
});
test("unified positions handle numeric strings, short options, and unsupported valuations", () => {
  const stock: AccountPosition = {
    instrument: {
      kind: "stock",
      id: "s",
      symbol: "EXAMPLE",
      raw_symbol: "EXAMPLE",
    },
    units: "2.5",
    price: "10",
  };
  assert.deepEqual(normalizePosition(stock).value, {
    amount: 25,
  });
  assert.equal(normalizePosition({ ...stock, units: null }).value.amount, null);
  const option = {
    ...stock,
    instrument: {
      kind: "option",
      id: "o",
      symbol: "OPTION",
      multiplier: "100",
      option_type: "CALL",
      strike_price: "10",
      expiration_date: "2026-12-31",
      underlying: {},
    },
    units: "-2",
    price: "3",
  } as AccountPosition;
  assert.equal(normalizePosition(option).value.amount, -600);
  assert.equal(
    normalizePosition({
      ...stock,
      instrument: { ...stock.instrument, kind: "bond" },
    } as AccountPosition).value.amount,
    null,
  );
});
test("freshness separates fresh, old, absent and future brokerage timestamps", () => {
  const now = Date.parse("2026-09-09T12:00:00Z");
  assert.match(freshness("2026-09-09T11:00:00Z", now), /within/);
  assert.match(freshness("2026-09-07T11:00:00Z", now), /Stale/);
  assert.equal(freshness(null, now), "Freshness unknown");
  assert.equal(freshness("2026-09-10T11:00:00Z", now), "Freshness unknown");
});

test("SnapTrade average purchase price is converted to total basis while lot basis remains a total", () => {
  const p: AccountPosition = {
    instrument: { kind: "stock", id: "a", symbol: "ABC", raw_symbol: "ABC" },
    units: "10",
    price: "12",
    cost_basis: "8",
    currency: "USD",
    tax_lots: [
      {
        original_purchase_date: "2025-01-15T12:00:00Z",
        quantity: "10",
        cost_basis: "80",
      },
    ],
  };
  const result = normalizePosition(p);
  assert.equal(result.costBasis.amount, 80);
  assert.equal(result.lots[0].costBasis.amount, 80);
  assert.equal(result.acquiredDate, "2025-01-15");
  assert.equal(
    normalizePosition({ ...p, cost_basis: null, tax_lots: undefined }).costBasis
      .amount,
    null,
  );
  assert.equal(
    normalizePosition({ ...p, tax_lots: [...p.tax_lots!, ...p.tax_lots!] })
      .acquiredDate,
    null,
  );
});
