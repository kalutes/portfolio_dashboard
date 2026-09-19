import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualStore } from "../lib/manual/store";
import {
  accountInput,
  holdingInput,
  type ManualAccount,
  type ManualHolding,
} from "../lib/manual/types";
import {
  manualAccountDetail,
  refreshManualQuotes,
} from "../lib/manual/portfolio";
import { parseYahooQuote } from "../lib/manual/quotes";
import { allocationBySymbol } from "../lib/allocation";
const account: ManualAccount = {
  id: "account",
  name: "Retirement",
  institution: "Employer",
};
const now = new Date("2026-09-10T12:00:00Z");
function holding(overrides: Partial<ManualHolding> = {}): ManualHolding {
  return {
    id: "holding",
    accountId: account.id,
    symbol: "Fund",
    description: "",
    quantity: 2,
    cashEquivalent: false,
    quoteSymbol: "",
    manualValue: 10000,
    manualAsOf: "2026-09-10",
    costBasis: null,
    acquiredDate: null,
    quotePrice: null,
    quoteAsOf: null,
    quoteRetrievedAt: null,
    ...overrides,
  };
}
function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
test("SQLite persists CRUD across connections and cascades account deletion", () => {
  const dir = mkdtempSync(join(tmpdir(), "manual-store-test-"));
  try {
    let store = new ManualStore(join(dir, "manual.sqlite"));
    const id = store.saveAccount({ ...account, id: "" });
    const entry = store.saveHolding({ ...holding(), id: "", accountId: id });
    store.close();
    store = new ManualStore(join(dir, "manual.sqlite"));
    try {
      assert.equal(store.snapshot().holdings[0].manualValue, 10000);
      assert.equal(
        Object.getPrototypeOf(store.snapshot().accounts[0]),
        Object.prototype,
      );
      assert.equal(
        Object.getPrototypeOf(store.snapshot().holdings[0]),
        Object.prototype,
      );
      store.saveHolding({
        ...holding(),
        id: entry,
        accountId: id,
        manualValue: 12000,
      });
      assert.equal(store.snapshot().holdings[0].manualValue, 12000);
      store.deleteHolding(entry);
      assert.equal(store.snapshot().holdings.length, 0);
      store.saveHolding({ ...holding(), id: "", accountId: id });
      store.deleteAccount(id);
      assert.deepEqual(store.snapshot(), { accounts: [], holdings: [] });
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("server validation rejects missing names, invalid numbers, unsafe quote symbols, and invalid dates", () => {
  assert.throws(
    () => accountInput(form({ name: "", institution: "B" })),
    /name/,
  );
  const base = {
    accountId: "a",
    symbol: "Fund",
    quantity: "1",
    manualValue: "1000",
    manualAsOf: "2026-01-01",
  };
  assert.equal(holdingInput(form(base)).manualValue, 1000);
  assert.throws(
    () => holdingInput(form({ ...base, quantity: "NaN" })),
    /number/,
  );
  assert.throws(
    () => holdingInput(form({ ...base, manualValue: "" })),
    /manual total/,
  );
  assert.throws(
    () => holdingInput(form({ ...base, manualAsOf: "2026-02-30" })),
    /date/,
  );
  assert.throws(
    () => holdingInput(form({ ...base, quoteSymbol: "https://example.com" })),
    /symbol/,
  );
});
test("manual cash participates once in portfolio total and allocation", () => {
  const detail = manualAccountDetail(
    account,
    [
      holding(),
      holding({
        id: "cash",
        symbol: "Cash",
        cashEquivalent: true,
        manualValue: 2500,
      }),
    ],
    new Set(),
    now,
  );
  assert.equal(detail.account.total.amount, 12500);
  assert.equal(detail.balances.data?.[0].amount, 2500);
  const allocation = allocationBySymbol([
    { balances: detail.balances.data, positions: detail.positions.data!.rows },
  ]);
  assert.equal(allocation.total, 12500);
  assert.equal(allocation.rows.find((r) => r.symbol === "Cash")?.amount, 2500);
});
test("quote failures retain known values and keep completely unknown totals unavailable", async () => {
  const saved = holding({
    quoteSymbol: "VTI",
    quotePrice: 250,
    quoteAsOf: "2026-09-10T09:00:00Z",
  });
  const refreshed = await refreshManualQuotes(
    { accounts: [account], holdings: [saved] },
    async () => {
      throw new Error("rate limited");
    },
    () => {},
    now,
  );
  const detail = manualAccountDetail(
    account,
    refreshed.holdings,
    refreshed.errors,
    now,
  );
  assert.equal(detail.account.total.amount, 500);
  assert.ok(detail.notes.some((note) => note.includes("last-known")));
  const unknown = manualAccountDetail(
    account,
    [holding({ manualValue: null, manualAsOf: null })],
    new Set(),
    now,
  );
  assert.equal(unknown.account.total.amount, null);
  assert.equal(unknown.positions.data?.rows[0].value.amount, null);
});
test("quotes are deduplicated and persisted", async () => {
  let calls = 0;
  let writes = 0;
  const q = {
    price: 250,
    asOf: "2026-09-10T09:00:00Z",
    retrievedAt: now.toISOString(),
  };
  const snapshot = {
    accounts: [account],
    holdings: [
      holding({ quoteSymbol: "VTI" }),
      holding({ id: "second", quoteSymbol: "VTI" }),
    ],
  };
  const result = await refreshManualQuotes(
    snapshot,
    async () => {
      calls++;
      return q;
    },
    () => {
      writes++;
    },
    now,
  );
  assert.equal(calls, 1);
  assert.equal(writes, 2);
  assert.equal(result.holdings[0].quotePrice, 250);
  await refreshManualQuotes(
    { ...snapshot, holdings: result.holdings },
    async () => assert.fail("Fresh persisted quotes should be reused"),
    () => {},
    now,
  );
});
test("manual value newer than a quote is respected", () => {
  const detail = manualAccountDetail(
    account,
    [
      holding({
        quotePrice: 250,
        quoteAsOf: "2026-09-09T00:00:00Z",
      }),
    ],
    new Set(),
    now,
  );
  assert.equal(detail.account.total.amount, 10000);
  assert.match(detail.positions.data!.rows[0].description, /Manual/);
});
test("Yahoo parser validates symbol, numeric prices and timestamps", () => {
  const meta = {
    symbol: "VTI",
    regularMarketPrice: 250,
    regularMarketTime: now.getTime() / 1000 - 60,
  };
  const data = (m: object) => ({
    chart: { result: [{ meta: m }], error: null },
  });
  assert.equal(parseYahooQuote(data(meta), "VTI", now).price, 250);
  assert.throws(() =>
    parseYahooQuote(data({ ...meta, regularMarketPrice: null }), "VTI", now),
  );
  assert.throws(() => parseYahooQuote(data(meta), "WRONG", now));
  assert.throws(() =>
    parseYahooQuote({ chart: { result: null, error: {} } }, "VTI", now),
  );
});

test("cost basis and acquisition date validation preserve optional fields and zero basis", () => {
  const base = {
    accountId: "a",
    symbol: "Fund",
    quantity: "2",
    manualValue: "1000",
    manualAsOf: "2026-09-01",
  };
  assert.equal(holdingInput(form(base)).costBasis, null);
  assert.equal(
    holdingInput(form({ ...base, costBasis: "0", acquiredDate: "2025-01-01" }))
      .costBasis,
    0,
  );
  assert.throws(
    () => holdingInput(form({ ...base, costBasis: "-1" })),
    /zero or positive/,
  );
  assert.throws(
    () => holdingInput(form({ ...base, acquiredDate: "2025-02-30" })),
    /acquisition date/,
  );
  assert.throws(
    () => holdingInput(form({ ...base, acquiredDate: "2026-09-02" })),
    /after/,
  );
});

test("store persists holdings and dated value observations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "manual-store-value-test-"));
  const path = join(dir, "manual.sqlite");
  try {
    let store = new ManualStore(path);
    const id = store.saveAccount({ ...account, id: "" });
    const holdingId = store.saveHolding({
      ...holding(),
      id: "",
      accountId: id,
    });
    let h = store.snapshot().holdings[0];
    assert.equal(h.manualValue, 10000);
    assert.equal(h.costBasis, null);
    assert.equal(h.acquiredDate, null);
    store.saveHolding({
      ...h,
      id: holdingId,
      costBasis: 8000,
      acquiredDate: "2025-01-15",
    });
    store.close();
    store = new ManualStore(path);
    try {
      h = store.snapshot().holdings[0];
      assert.equal(h.costBasis, 8000);
      assert.equal(h.acquiredDate, "2025-01-15");
      store.deleteAccount(id);
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy currency column does not prevent adding and editing accounts", () => {
  const dir = mkdtempSync(join(tmpdir(), "manual-legacy-test-"));
  const path = join(dir, "manual.sqlite");
  try {
    const db = new DatabaseSync(path);
    db.exec(
      "CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT NOT NULL, institution TEXT NOT NULL, currency TEXT NOT NULL) STRICT;",
    );
    db.close();
    const store = new ManualStore(path);
    try {
      const id = store.saveAccount({ ...account, id: "" });
      const lot = store.saveHolding({
        ...holding(),
        id: "",
        accountId: id,
        costBasis: 123.45,
        acquiredDate: "2025-10-06",
      });
      store.saveAccount({ ...account, id, name: "Updated" });
      assert.equal(store.snapshot().accounts[0].name, "Updated");
      assert.equal(
        store.snapshot().holdings.find((h) => h.id === lot)?.costBasis,
        123.45,
      );
    } finally {
      store.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("page reads saved manual valuations without fetching stale quotes", async () => {
  const { readManualPortfolio } = await import("../lib/manual/read");
  const dir = mkdtempSync(join(tmpdir(), "manual-read-"));
  const oldPath = process.env.MANUAL_DB_PATH;
  const oldFetch = globalThis.fetch;
  process.env.MANUAL_DB_PATH = join(dir, "manual.sqlite");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Network forbidden");
  };
  try {
    const store = new ManualStore(process.env.MANUAL_DB_PATH);
    const accountId = store.saveAccount({ ...account, id: "" });
    store.saveHolding({ ...holding(), id: "", accountId, quoteSymbol: "VTI" });
    store.close();
    const result = readManualPortfolio();
    assert.equal(result.error, null);
    assert.equal(result.details[0].account.total.amount, 10000);
    assert.equal(result.details[0].positions.retrievedAt, "2026-09-10");
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldPath === undefined) delete process.env.MANUAL_DB_PATH;
    else process.env.MANUAL_DB_PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});
