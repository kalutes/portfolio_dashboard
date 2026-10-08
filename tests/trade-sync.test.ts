import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historySchema } from "../lib/history-schema";
import { tradeSchema } from "../lib/trade-store";
import {
  fetchActivities,
  normalizeActivity,
  type ActivityClient,
  type Activity,
} from "../lib/trade-sync/activities";
import {
  recordActivities,
  setTradeAccountLink,
  withTradeWriter,
} from "../lib/trade-sync/store";
import { syncTrades } from "../lib/trade-sync/run";

const now = "2030-05-12T00:00:00Z";
function activity(patch: Partial<Activity> = {}): Activity {
  return {
    id: "activity-one",
    type: "BUY",
    side: "BUY",
    date: "2030-05-10",
    settlement: "2030-05-12",
    symbol: "AAA",
    quantity: 2,
    price: 10,
    amount: 20,
    fee: 0,
    currency: "USD",
    optionAction: "",
    issue: null,
    ...patch,
  };
}
function fixture(
  run: (path: string, db: DatabaseSync) => void | Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), "trade-sync-")),
    path = join(dir, "test.sqlite"),
    db = new DatabaseSync(path);
  db.exec(historySchema + tradeSchema);
  db.prepare(
    "INSERT INTO metadata VALUES ('schemaVersion','1'),('revision',?)",
  ).run("a".repeat(64));
  return Promise.resolve()
    .then(() => run(path, db))
    .finally(() => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    });
}
function link(path: string, through = "2030-05-01") {
  setTradeAccountLink(
    {
      accountId: "account-one",
      account: "Example account",
      institution: "Example broker",
      coveredThrough: through,
    },
    path,
  );
}
function seed(db: DatabaseSync, date = "2030-05-10") {
  db.prepare(
    "INSERT INTO historical_trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    "imported",
    date,
    "AAA",
    "Example",
    "Example account",
    "Example broker",
    "BUY",
    "2",
    "10",
    "20",
    "Statement date",
    "Imported statement",
    "",
  );
}

test("normalization keeps only small trade fields, distinguishes non-trades and uncertain events", () => {
  const a = normalizeActivity({
    id: "id",
    type: "BUY",
    trade_date: now,
    units: -2,
    price: 10,
    amount: -20,
    currency: { code: "USD" },
    symbol: { symbol: "AAA" },
    description: "Private description",
    unexpected: "raw field",
  });
  assert.equal(a?.quantity, 2);
  assert.equal(a?.amount, 20);
  assert.equal(a?.issue, null);
  assert.equal("description" in a!, false);
  assert.equal("unexpected" in a!, false);
  assert.equal(normalizeActivity({ type: "TRANSFER" }), null);
  assert.match(
    normalizeActivity({ type: "OPTIONEXERCISE" })!.issue!,
    /Unsupported/,
  );
  assert.match(
    normalizeActivity({
      id: "x",
      type: "BUY",
      units: 1,
      symbol: { symbol: "AAA" },
      trade_date: now,
      currency: { code: "JPY" },
    })!.issue!,
    /Currency/,
  );
  assert.equal(
    normalizeActivity({
      id: "x",
      type: "REI",
      units: 1,
      symbol: { symbol: "AAA" },
      trade_date: now,
      currency: { code: "USD" },
    })?.side,
    "BUY",
  );
});

test("import overlap matches settlement dates without changing imported rows; replay is idempotent", () =>
  fixture((path, db) => {
    link(path, "2030-05-12");
    seed(db, "2030-05-12");
    const original = db.prepare("SELECT * FROM historical_trades").all();
    assert.equal(
      recordActivities("account-one", [activity()], now, path).matched,
      1,
    );
    assert.equal(
      recordActivities("account-one", [activity()], now, path).unchanged,
      1,
    );
    assert.deepEqual(
      db.prepare("SELECT * FROM historical_trades").all(),
      original,
    );
  }));

test("new trades append once; later corrections and changed IDs remain in review across retries", () =>
  fixture((path, db) => {
    link(path);
    assert.equal(
      recordActivities("account-one", [activity()], now, path).added,
      1,
    );
    assert.equal(
      recordActivities("account-one", [activity()], now, path).unchanged,
      1,
    );
    assert.equal(
      recordActivities(
        "account-one",
        [activity({ id: "replacement" })],
        now,
        path,
      ).review,
      1,
    );
    const changed = activity({ date: "2030-06-01", amount: 25 });
    assert.equal(
      recordActivities("account-one", [changed], now, path).review,
      1,
    );
    assert.equal(
      recordActivities("account-one", [changed], now, path).review,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM historical_trades").get()?.n,
      1,
    );
    assert.equal(
      db.prepare("SELECT amount FROM historical_trades").get()?.amount,
      "20",
    );
  }));

test("unmapped accounts, unmatched covered history and uncertain economics cannot append", () =>
  fixture((path, db) => {
    seed(db);
    assert.equal(
      recordActivities("other-account", [activity()], now, path).review,
      1,
    );
    link(path, "2030-05-12");
    assert.equal(
      recordActivities("account-one", [activity({ quantity: 3 })], now, path)
        .review,
      1,
    );
    assert.equal(
      recordActivities(
        "account-one",
        [activity({ id: "other", symbol: "BBB" })],
        now,
        path,
      ).review,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM historical_trades").get()?.n,
      1,
    );
  }));

test("ambiguous identical fills are not silently merged with one imported row", () =>
  fixture((path, db) => {
    link(path);
    seed(db);
    const counts = recordActivities(
      "account-one",
      [activity(), activity({ id: "another-fill" })],
      now,
      path,
    );
    assert.equal(counts.review, 2);
    assert.equal(counts.matched, 0);
  }));

test("pagination and retry collect all pages; a later failure discards the account", async () => {
  const offsets: number[] = [];
  const sleeps: number[] = [];
  let retry = true;
  const client = {
    getAccountActivities: async ({ offset }: { offset: number }) => {
      offsets.push(offset);
      if (retry) {
        retry = false;
        throw { response: { status: 429 } };
      }
      return {
        data: {
          data: [
            {
              id: `id-${offset}`,
              type: "SELL",
              symbol: { symbol: "AAA" },
              units: 1,
              trade_date: now,
              currency: { code: "USD" },
            },
          ],
          pagination: { offset, limit: 1, total: 2 },
        },
      };
    },
  } as unknown as ActivityClient;
  assert.equal(
    (
      await fetchActivities(client, "account", async (ms) => {
        sleeps.push(ms);
      })
    ).length,
    2,
  );
  assert.deepEqual(offsets, [0, 0, 1]);
  assert.deepEqual(sleeps, [1000]);
  const failing = {
    getAccountActivities: async ({ offset }: { offset: number }) => {
      if (offset) throw { response: { status: 403 } };
      return {
        data: {
          data: [{ id: "first", type: "BUY" }],
          pagination: { offset, limit: 1, total: 2 },
        },
      };
    },
  } as unknown as ActivityClient;
  await assert.rejects(fetchActivities(failing, "account"), /request failed/);
});

test("malformed or repeated pagination is rejected", async () => {
  for (const data of [
    {},
    { data: [], pagination: { total: 2 } },
    { data: [], pagination: { offset: 9, total: 0 } },
  ]) {
    await assert.rejects(
      fetchActivities(
        {
          getAccountActivities: async () => ({ data }),
        } as unknown as ActivityClient,
        "account",
      ),
    );
  }
});

test("one account API failure preserves other successful trade updates and clears on retry", () =>
  fixture(async (path, db) => {
    link(path);
    let fail = true;
    const client = {
      accountInformation: {
        listUserAccounts: async () => ({
          data: [{ id: "account-one" }, { id: "account-two" }],
        }),
        getAccountActivities: async ({ accountId }: { accountId: string }) => {
          if (accountId === "account-two" && fail)
            throw { response: { status: 403 } };
          return {
            data: {
              data:
                accountId === "account-one"
                  ? [
                      {
                        id: "live",
                        type: "BUY",
                        trade_date: "2030-05-10",
                        symbol: { symbol: "AAA" },
                        units: 2,
                        amount: -20,
                        price: 10,
                        currency: { code: "USD" },
                      },
                    ]
                  : [],
              pagination: { total: accountId === "account-one" ? 1 : 0 },
            },
          };
        },
      },
    } as unknown as Parameters<typeof syncTrades>[0];
    assert.deepEqual(await syncTrades(client, path), {
      failed: 1,
      added: 1,
      matched: 0,
      review: 0,
      unchanged: 0,
    });
    assert.equal(
      db
        .prepare(
          "SELECT failed FROM trade_sync_state WHERE accountId='account-two'",
        )
        .get()?.failed,
      1,
    );
    fail = false;
    assert.equal((await syncTrades(client, path)).unchanged, 1);
    assert.equal(
      db
        .prepare(
          "SELECT failed FROM trade_sync_state WHERE accountId='account-two'",
        )
        .get()?.failed,
      0,
    );
  }));

test("writer rejects wrong schema and rolls back failed changes", () =>
  fixture((path, db) => {
    assert.throws(() =>
      withTradeWriter((d) => {
        d.prepare("INSERT INTO metadata VALUES ('temporary','x')").run();
        throw new Error("stop");
      }, path),
    );
    assert.equal(
      db.prepare("SELECT 1 FROM metadata WHERE key='temporary'").get(),
      undefined,
    );
    db.exec("UPDATE metadata SET value='999' WHERE key='schemaVersion'");
    assert.throws(
      () => recordActivities("account", [activity()], now, path),
      /Unsupported/,
    );
  }));

test("distinct new fills of different quantities survive the same-day symbol overlap", () =>
  fixture((path, db) => {
    link(path);
    const counts = recordActivities(
      "account-one",
      [activity(), activity({ id: "larger-fill", quantity: 3, amount: 30 })],
      now,
      path,
    );
    assert.equal(counts.added, 2);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM historical_trades").get()?.n,
      2,
    );
  }));

test("option trades use the contract ticker rather than merging with underlying shares", () => {
  const normalized = normalizeActivity({
    id: "option",
    type: "BUY",
    trade_date: now,
    units: 1,
    price: 2,
    amount: -200,
    currency: { code: "USD" },
    symbol: { symbol: "AAA" },
    option_symbol: {
      id: "contract",
      ticker: "AAA   300621C00020000",
      option_type: "CALL",
      strike_price: 20,
      expiration_date: "2030-06-21",
      underlying_symbol: {},
    },
  });
  assert.equal(normalized?.symbol, "AAA   300621C00020000");
  assert.equal(normalized?.quantity, 1);
  assert.equal(normalized?.amount, 200);
});

test("failed paginated account retrieval leaves existing trades and last success intact", () =>
  fixture(async (path, db) => {
    link(path);
    recordActivities("account-one", [activity()], now, path);
    const client = {
      accountInformation: {
        listUserAccounts: async () => ({ data: [{ id: "account-one" }] }),
        getAccountActivities: async ({ offset }: { offset: number }) => {
          if (offset) throw { response: { status: 403 } };
          return {
            data: {
              data: [
                {
                  id: "new-id",
                  type: "SELL",
                  trade_date: now,
                  units: 1,
                  symbol: { symbol: "AAA" },
                  currency: { code: "USD" },
                },
              ],
              pagination: { offset, limit: 1, total: 2 },
            },
          };
        },
      },
    } as unknown as Parameters<typeof syncTrades>[0];
    assert.equal((await syncTrades(client, path)).failed, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM historical_trades").get()?.n,
      1,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM trade_sync_records").get()?.n,
      1,
    );
    assert.equal(
      db.prepare("SELECT succeededAt FROM trade_sync_state").get()?.succeededAt,
      now,
    );
  }));

test("a penny difference does not merge distinct fills when both execution prices are known", () =>
  fixture((path, db) => {
    link(path);
    seed(db);
    db.prepare(
      "INSERT INTO historical_trades SELECT ?,date,symbol,description,account,institution,side,quantity,?,?,dateBasis,source,notes FROM historical_trades WHERE id=?",
    ).run("second", "10.01", "20.02", "imported");
    const counts = recordActivities(
      "account-one",
      [activity(), activity({ id: "penny-fill", price: 10.01, amount: 20.02 })],
      now,
      path,
    );
    assert.equal(counts.matched, 2);
    assert.equal(counts.review, 0);
  }));
