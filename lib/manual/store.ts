import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  ManualInputError,
  type ManualAccount,
  type ManualHolding,
  type ManualSnapshot,
  type accountInput,
  type holdingInput,
} from "./types";

export function withManualStore<T>(
  run: (store: ManualStore) => T,
  path = process.env.MANUAL_DB_PATH || resolve("data/manual.sqlite"),
): T {
  mkdirSync(dirname(path), { recursive: true });
  const store = new ManualStore(path);
  try {
    return run(store);
  } finally {
    store.close();
  }
}
export class ManualStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;",
      );
      this.db.exec("BEGIN IMMEDIATE;");
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          institution TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS holdings (
          id TEXT PRIMARY KEY,
          accountId TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
          symbol TEXT NOT NULL,
          description TEXT NOT NULL,
          quantity REAL NOT NULL,
          cashEquivalent INTEGER NOT NULL,
          quoteSymbol TEXT NOT NULL,
          manualValue REAL,
          manualAsOf TEXT,
          costBasis REAL,
          acquiredDate TEXT,
          quotePrice REAL,
          quoteAsOf TEXT,
          quoteRetrievedAt TEXT
        ) STRICT;
      `);
      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.db.close();
  }
  snapshot(): ManualSnapshot {
    const accounts = this.db
      .prepare("SELECT id, name, institution FROM accounts ORDER BY name, id")
      .all()
      .map((row) => ({ ...row })) as unknown as ManualAccount[];
    const holdings = this.db
      .prepare("SELECT * FROM holdings ORDER BY symbol, id")
      .all()
      .map((row) => ({
        ...row,
        cashEquivalent: row.cashEquivalent === 1,
      })) as unknown as ManualHolding[];
    return { accounts, holdings };
  }
  saveAccount(input: ReturnType<typeof accountInput>) {
    const id = input.id || randomUUID();
    if (input.id) {
      const old = this.db.prepare("SELECT id FROM accounts WHERE id=?").get(id);
      if (!old)
        throw new ManualInputError(
          "Account no longer exists. Reload the page.",
        );
      this.db
        .prepare("UPDATE accounts SET name=?, institution=? WHERE id=?")
        .run(input.name, input.institution, id);
    } else {
      // Older stores retain a required currency column; current manual inputs use USD.
      const legacyCurrency = this.db
        .prepare("PRAGMA table_info(accounts)")
        .all()
        .some((column) => column.name === "currency");
      this.db
        .prepare(
          legacyCurrency
            ? "INSERT INTO accounts (id,name,institution,currency) VALUES (?,?,?,'USD')"
            : "INSERT INTO accounts (id,name,institution) VALUES (?,?,?)",
        )
        .run(id, input.name, input.institution);
    }
    return id;
  }
  saveHolding(input: ReturnType<typeof holdingInput>) {
    if (
      !this.db
        .prepare("SELECT id FROM accounts WHERE id=?")
        .get(input.accountId)
    )
      throw new ManualInputError("Account no longer exists. Reload the page.");
    const id = input.id || randomUUID();
    const values = [
      input.symbol,
      input.description,
      input.quantity,
      Number(input.cashEquivalent),
      input.quoteSymbol,
      input.manualValue,
      input.manualAsOf,
      input.costBasis,
      input.acquiredDate,
    ];
    if (input.id) {
      const result = this.db
        .prepare(
          `UPDATE holdings SET symbol=?, description=?, quantity=?, cashEquivalent=?, quoteSymbol=?, manualValue=?, manualAsOf=?, costBasis=?, acquiredDate=?,
        quotePrice=NULL, quoteAsOf=NULL, quoteRetrievedAt=NULL WHERE id=? AND accountId=?`,
        )
        .run(...values, id, input.accountId);
      if (!result.changes)
        throw new ManualInputError(
          "Holding no longer exists. Reload the page.",
        );
    } else
      this.db
        .prepare(
          "INSERT INTO holdings (symbol,description,quantity,cashEquivalent,quoteSymbol,manualValue,manualAsOf,costBasis,acquiredDate,id,accountId) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(...values, id, input.accountId);
    return id;
  }
  deleteAccount(id: string) {
    this.db.prepare("DELETE FROM accounts WHERE id=?").run(id);
  }
  deleteHolding(id: string) {
    this.db.prepare("DELETE FROM holdings WHERE id=?").run(id);
  }
  saveQuote(
    holding: ManualHolding,
    quote: {
      price: number;
      asOf: string;
      retrievedAt: string;
    },
  ) {
    // A quote finishing after an edit must not replace that edit's price state.
    this.db
      .prepare(
        `UPDATE holdings SET quotePrice=?, quoteAsOf=?, quoteRetrievedAt=?
      WHERE id=? AND quoteSymbol=? AND quantity=?`,
      )
      .run(
        quote.price,
        quote.asOf,
        quote.retrievedAt,
        holding.id,
        holding.quoteSymbol,
        holding.quantity,
      );
  }
}
