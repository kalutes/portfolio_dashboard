import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historySchema } from "../lib/history-schema";
import { tradeSchema, loadHistoricalTrades } from "../lib/trade-store";
import { filterTrades } from "../lib/trade-types";

test("trade history distinguishes absent import, empty import and known records with nullable prices", () => {
  const dir = mkdtempSync(join(tmpdir(), "trades-"));
  const path = join(dir, "portfolio.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(historySchema);
    db.prepare(
      "INSERT INTO metadata VALUES ('schemaVersion','1'),('revision',?)",
    ).run("a".repeat(64));
    assert.deepEqual(loadHistoricalTrades(path), {
      available: false,
      importedAt: null,
      trades: [],
    });
    db.exec(tradeSchema);
    assert.deepEqual(loadHistoricalTrades(path), {
      available: true,
      importedAt: null,
      trades: [],
    });
    const insert = db.prepare(
      "INSERT INTO historical_trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    insert.run(
      "b",
      "2020-02-02",
      "AAA",
      "Example asset",
      "Closed account",
      "Example broker",
      "SELL",
      "2",
      "12",
      "24",
      "Activity date",
      "Imported statement",
      "",
    );
    insert.run(
      "a",
      "2020-02-02",
      "AAA",
      "Example asset",
      "Open account",
      "Example broker",
      "BUY",
      "3",
      null,
      "30",
      "Approximate date",
      "Reviewed history",
      "Estimated",
    );
    insert.run(
      "c",
      "2019-01-01",
      "BBB",
      "Other asset",
      "Open account",
      "Example broker",
      "BUY",
      "1",
      "10",
      "10",
      "Trade date",
      "Imported statement",
      "",
    );
    const history = loadHistoricalTrades(path);
    assert.deepEqual(
      history.trades.map((t) => t.id),
      ["a", "b", "c"],
    );
    assert.equal(history.trades[0].price, null);
    assert.equal(history.trades[0].amount, 30);
    assert.equal(history.trades[0].notes, "Estimated");
    assert.equal(filterTrades(history.trades, "aaa", "SELL", "").length, 1);
    assert.equal(
      filterTrades(history.trades, "", "BUY", "Example broker · Open account")
        .length,
      2,
    );
    assert.equal(filterTrades(history.trades, "2019", "", "").length, 1);
    assert.equal(filterTrades(history.trades, "' OR 1=1 --", "", "").length, 0);
    db.exec("UPDATE historical_trades SET quantity='invalid' WHERE id='a'");
    assert.throws(() => loadHistoricalTrades(path), /Invalid historical trade/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
