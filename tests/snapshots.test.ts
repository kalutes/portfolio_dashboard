import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { historySchema, protectHistory } from "../lib/history-schema";
import {
  normalizeSnapshot,
  type DailySnapshot,
} from "../lib/snapshots/normalize";
import { appendSnapshot, loadSnapshotSources } from "../lib/snapshots/store";
import { loadPortfolio, type ReadClient } from "../lib/portfolio";
import { manualAccountDetail } from "../lib/manual/portfolio";

const now = new Date("2026-09-15T22:00:00Z");
async function portfolio() {
  const client = {
    accountInformation: {
      listUserAccounts: async () => ({
        data: [
          {
            id: "one",
            brokerage_authorization: "c",
            sync_status: {},
            balance: {},
          },
        ],
      }),
      getUserAccountBalance: async () => ({ data: [{ cash: 100 }] }),
      getAllAccountPositions: async () => ({
        data: {
          data_freshness: { as_of: now.toISOString() },
          results: [
            {
              units: 2,
              price: 10,
              instrument: { kind: "stock", symbol: "VOO" },
            },
            {
              units: 100,
              price: 1,
              cash_equivalent: true,
              instrument: { kind: "mutualfund", symbol: "SWEEP" },
            },
          ],
        },
      }),
    },
    connections: {
      listBrokerageAuthorizations: async () => ({
        data: [{ id: "c", disabled: false }],
      }),
    },
  } as unknown as ReadClient;
  return loadPortfolio(client);
}
test("snapshot includes manual lots and cash once, excluding sweep duplication", async () => {
  const p = await portfolio();
  const manual = manualAccountDetail(
    { id: "m", name: "Manual", institution: "Example" },
    [
      {
        id: "lot",
        accountId: "m",
        symbol: "VOO",
        description: "",
        quantity: 3,
        cashEquivalent: false,
        quoteSymbol: "VOO",
        manualValue: null,
        manualAsOf: null,
        costBasis: 25,
        acquiredDate: "2026-01-01",
        quotePrice: 10,
        quoteAsOf: now.toISOString(),
        quoteRetrievedAt: now.toISOString(),
      },
    ],
    new Set(),
    now,
  );
  const result = normalizeSnapshot(p, { details: [manual], error: null }, now);
  assert.equal(result.holdings.find((h) => h.symbol === "VOO")?.quantity, 5);
  assert.equal(
    result.holdings.reduce((n, h) => n + (h.value ?? 0), 0),
    150,
  );
  assert.equal(result.holdings.filter((h) => h.symbol === "CASH").length, 1);
  assert.equal(
    result.holdings.find((h) => h.symbol === "SWEEP"),
    undefined,
  );
});
test("missing data carries prior holdings while available sections update", async () => {
  const first = normalizeSnapshot(
    await portfolio(),
    { details: [], error: null },
    now,
  );
  const p = await portfolio();
  p.details[0].positions.data = null;
  p.details[0].positions.error = "Unavailable";
  p.details[0].balances.data![0].amount = 250;
  const next = normalizeSnapshot(
    p,
    { details: [], error: null },
    new Date("2026-09-16T22:00:00Z"),
    first.sources,
  );
  assert.equal(next.holdings.find((h) => h.symbol === "VOO")?.value, 20);
  assert.equal(next.holdings.find((h) => h.symbol === "CASH")?.value, 250);
  assert.equal(next.holdings.find((h) => h.symbol === "VOO")?.stale, true);
  assert.equal(
    next.holdings.find((h) => h.symbol === "VOO")?.asOf,
    now.toISOString(),
  );
  assert.ok(!JSON.stringify(next.sources).includes('"one"'));
});
test("missing data without a prior observation stays explicitly unpriced", async () => {
  const p = await portfolio();
  p.details[0].positions.data!.rows[0].value.amount = null;
  const result = normalizeSnapshot(
    p,
    { details: [], error: "unavailable" },
    now,
  );
  assert.ok(result.holdings.some((h) => h.value === null));
  assert.equal(result.holdings.find((h) => h.symbol === "CASH")?.value, 100);
});
test("an account-list outage carries all last-known sources; an empty successful list removes them", async () => {
  const first = normalizeSnapshot(
    await portfolio(),
    { details: [], error: null },
    now,
  );
  const p = await portfolio();
  p.accounts.data = null;
  p.accounts.error = "Unavailable";
  p.details = [];
  const next = normalizeSnapshot(
    p,
    { details: [], error: null },
    now,
    first.sources,
  );
  assert.equal(next.holdings.find((h) => h.symbol === "VOO")?.value, 20);
  assert.ok(next.holdings.every((h) => h.stale));
  p.accounts.data = [];
  p.accounts.error = null;
  assert.deepEqual(
    normalizeSnapshot(p, { details: [], error: null }, now, first.sources)
      .holdings,
    [],
  );
});
test("stale and unknown freshness are labeled instead of passed off as current", async () => {
  const p = await portfolio();
  p.details[0].positions.data!.asOf = null;
  const result = normalizeSnapshot(p, { details: [], error: null }, now);
  assert.equal(result.stale, true);
  assert.ok(result.holdings.every((h) => h.stale));
});
test("daily append is atomic, idempotent, frozen-history safe and updates revision", () => {
  const dir = mkdtempSync(join(tmpdir(), "snapshots-"));
  const path = join(dir, "history.sqlite");
  const db = new DatabaseSync(path);
  db.exec(historySchema);
  db.exec(
    `INSERT INTO metadata VALUES ('schemaVersion','1'),('revision','${"a".repeat(64)}'),('historicalThrough','2026-08-31');`,
  );
  db.exec(protectHistory);
  db.close();
  const snapshot: DailySnapshot = {
    date: "2026-09-15",
    retrievedAt: now.toISOString(),
    stale: false,
    holdings: [
      { key: "symbol:A", symbol: "A", quantity: 1, value: 1.01, stale: false },
      {
        key: "cash:USD",
        symbol: "CASH",
        quantity: 2.02,
        value: 2.02,
        stale: false,
      },
    ],
  };
  try {
    snapshot.sources = [
      {
        source: "snaptrade:hashed",
        section: "positions",
        observedAt: now.toISOString(),
        holdings: snapshot.holdings,
      },
    ];
    assert.equal(appendSnapshot(snapshot, path), true);
    assert.equal(loadSnapshotSources(path).length, 1);
    assert.equal(appendSnapshot(snapshot, path), false);
    const check = new DatabaseSync(path);
    assert.equal(
      check.prepare("SELECT totalValue FROM portfolio_values").get()
        ?.totalValue,
      "3.03",
    );
    const revision = check
      .prepare("SELECT value FROM metadata WHERE key='revision'")
      .get()?.value;
    assert.notEqual(revision, "a".repeat(64));
    assert.throws(
      () =>
        appendSnapshot(
          {
            ...snapshot,
            date: "2026-08-31",
            retrievedAt: "2026-08-31T22:00:00Z",
          },
          path,
        ),
      /frozen/,
    );
    assert.throws(() =>
      appendSnapshot(
        {
          ...snapshot,
          date: "2026-09-16",
          retrievedAt: "2026-09-16T22:00:00Z",
          holdings: [snapshot.holdings[0], snapshot.holdings[0]],
        },
        path,
      ),
    );
    assert.equal(
      check.prepare("SELECT COUNT(*) n FROM portfolio_values").get()?.n,
      1,
    );
    assert.equal(
      check.prepare("SELECT value FROM metadata WHERE key='revision'").get()
        ?.value,
      revision,
    );
    assert.throws(
      () => check.exec("DELETE FROM portfolio_values"),
      /append-only/,
    );
    const partial = {
      ...snapshot,
      date: "2026-09-17",
      retrievedAt: "2026-09-17T22:00:00Z",
      holdings: [
        snapshot.holdings[0],
        {
          key: "missing",
          symbol: "Unknown",
          quantity: null,
          value: null,
          stale: true,
        },
      ],
    };
    assert.equal(appendSnapshot(partial, path), true);
    const row = check
      .prepare("SELECT * FROM portfolio_values WHERE date='2026-09-17'")
      .get();
    assert.equal(row?.totalValue, null);
    assert.equal(row?.knownValue, "1.01");
    assert.equal(row?.unpricedHoldings, 1);
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("saved dashboard retains failed sections and timestamps, while accepting successful empty results", async () => {
  const { mergeSavedPortfolio } = await import("../lib/dashboard-store");
  const previous = await portfolio();
  previous.details[0].positions.retrievedAt = "2026-09-14T22:00:00Z";
  const next = await portfolio();
  next.details[0].positions = {
    data: null,
    error: "Unavailable",
    retrievedAt: now.toISOString(),
  };
  next.details[0].balances.data![0].amount = 250;
  const merged = mergeSavedPortfolio(next, previous);
  assert.deepEqual(
    merged.details[0].positions.data,
    previous.details[0].positions.data,
  );
  assert.equal(merged.details[0].positions.retrievedAt, "2026-09-14T22:00:00Z");
  assert.match(merged.details[0].positions.error!, /last saved/);
  assert.equal(merged.details[0].balances.data![0].amount, 250);
  next.accounts = { ...next.accounts, data: null, error: "Unavailable" };
  next.details = [];
  assert.equal(mergeSavedPortfolio(next, previous).details.length, 1);
  next.accounts = { ...next.accounts, data: [], error: null };
  assert.deepEqual(mergeSavedPortfolio(next, previous).details, []);
});

test("dashboard saves atomically and can update without rewriting an existing historical day", async () => {
  const { readSavedPortfolio } = await import("../lib/dashboard-store");
  const dir = mkdtempSync(join(tmpdir(), "dashboard-"));
  const path = join(dir, "portfolio.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(historySchema);
    db.exec(
      `INSERT INTO metadata VALUES ('schemaVersion','1'),('revision','${"a".repeat(64)}'),('historicalThrough','2026-08-31');`,
    );
    assert.equal(readSavedPortfolio(path), null);
    const snapshot: DailySnapshot = {
      date: "2026-09-15",
      retrievedAt: now.toISOString(),
      stale: false,
      holdings: [],
      dashboard: await portfolio(),
    };
    assert.equal(appendSnapshot(snapshot, path), true);
    assert.deepEqual(readSavedPortfolio(path), snapshot.dashboard);
    const before = db.prepare("SELECT * FROM portfolio_values").all();
    const revision = db
      .prepare("SELECT value FROM metadata WHERE key='revision'")
      .get()?.value;
    snapshot.dashboard!.retrievedAt = "2026-09-15T23:00:00Z";
    assert.equal(appendSnapshot(snapshot, path), false);
    assert.equal(
      readSavedPortfolio(path)?.retrievedAt,
      snapshot.dashboard!.retrievedAt,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM portfolio_values").all(),
      before,
    );
    assert.equal(
      db.prepare("SELECT value FROM metadata WHERE key='revision'").get()
        ?.value,
      revision,
    );
    const saved = readSavedPortfolio(path);
    assert.throws(() =>
      appendSnapshot(
        {
          ...snapshot,
          date: "2026-09-16",
          retrievedAt: "2026-09-16T22:00:00Z",
          dashboard: { ...snapshot.dashboard!, retrievedAt: "changed" },
          holdings: [
            {
              key: "invalid",
              symbol: "X",
              quantity: 1,
              value: NaN,
              stale: false,
            },
          ],
        },
        path,
      ),
    );
    assert.deepEqual(readSavedPortfolio(path), saved);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
