/** Runtime schema: daily observations only, with no account/transaction reconciliation. */
export const historySchema = `
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE portfolio_values (
 date TEXT PRIMARY KEY, totalValue TEXT, knownValue TEXT NOT NULL,
 unpricedHoldings INTEGER NOT NULL, estimatedHoldings INTEGER NOT NULL,
 stale INTEGER NOT NULL CHECK(stale IN (0,1)), retrievedAt TEXT
) STRICT;
CREATE TABLE portfolio_holdings (
 date TEXT NOT NULL REFERENCES portfolio_values(date), key TEXT NOT NULL,
 symbol TEXT NOT NULL, quantity TEXT, value TEXT, method TEXT NOT NULL,
 previousAnchor TEXT, nextAnchor TEXT, PRIMARY KEY(date,key)
) STRICT;
`;

export const protectHistory = `
CREATE TRIGGER totals_no_update BEFORE UPDATE ON portfolio_values BEGIN SELECT RAISE(ABORT,'Daily history is append-only'); END;
CREATE TRIGGER totals_no_delete BEFORE DELETE ON portfolio_values BEGIN SELECT RAISE(ABORT,'Daily history is append-only'); END;
CREATE TRIGGER holdings_no_update BEFORE UPDATE ON portfolio_holdings BEGIN SELECT RAISE(ABORT,'Daily history is append-only'); END;
CREATE TRIGGER holdings_no_delete BEFORE DELETE ON portfolio_holdings BEGIN SELECT RAISE(ABORT,'Daily history is append-only'); END;
CREATE TRIGGER totals_no_backfill BEFORE INSERT ON portfolio_values WHEN NEW.date <= (SELECT value FROM metadata WHERE key='historicalThrough') BEGIN SELECT RAISE(ABORT,'Historical seed is frozen'); END;
CREATE TRIGGER holdings_no_backfill BEFORE INSERT ON portfolio_holdings WHEN NEW.date <= (SELECT value FROM metadata WHERE key='historicalThrough') BEGIN SELECT RAISE(ABORT,'Historical seed is frozen'); END;
`;
