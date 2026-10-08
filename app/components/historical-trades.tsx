"use client";

import { useState } from "react";
import { date, money, number } from "@/lib/format";
import { filterTrades, type TradeHistory } from "@/lib/trade-types";
import DataTable from "./data-table";

const pageSize = 25;
export default function HistoricalTrades({
  history,
}: {
  history: TradeHistory;
}) {
  const [query, setQuery] = useState("");
  const [side, setSide] = useState("");
  const [account, setAccount] = useState("");
  const [page, setPage] = useState(0);
  const accounts = [
    ...new Set(history.trades.map((t) => `${t.institution} · ${t.account}`)),
  ].sort();
  const filtered = filterTrades(history.trades, query, side, account);
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const rows = filtered.slice(current * pageSize, (current + 1) * pageSize);
  return (
    <section aria-labelledby="trades-title" className="historical-trades">
      <h2 id="trades-title">Historical trades</h2>
      <p className="muted">
        Known recorded buys and sells from imported history and daily brokerage
        activity sync, including closed accounts. Transfers, vesting and
        deposits are not trades. Reported amounts may include fees; they are not
        realized gains or tax-lot cost basis.
      </p>
      {history.sync && (
        <p
          className={
            history.sync.failed || history.sync.pending ? "notice" : "retrieved"
          }
        >
          Activity sync last attempted: {date(history.sync.attemptedAt)}.
          {history.sync.failed > 0 &&
            ` ${history.sync.failed} account requests failed; saved trades are retained and the worker will retry.`}
          {history.sync.pending > 0 &&
            ` ${history.sync.pending} activities await review and have not been added as new trades.`}{" "}
          Brokerage transactions can arrive a day or more after trading.
        </p>
      )}
      {!history.available ? (
        <p className="notice">
          Trade history has not been imported into this database yet.
        </p>
      ) : (
        <>
          <p className="retrieved">
            {history.trades.length} recorded trades
            {history.trades.length > 0 &&
              ` · ${history.trades[history.trades.length - 1].date} to ${history.trades[0].date}`}{" "}
            · Imported: {date(history.importedAt)}. Coverage is limited to
            available records; some dates are activity or settlement dates.
          </p>
          <div className="trade-filters">
            <label>
              Search trades
              <input
                type="search"
                value={query}
                placeholder="Symbol, account or date"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(0);
                }}
              />
            </label>
            <label>
              Trade type
              <select
                value={side}
                onChange={(e) => {
                  setSide(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All trades</option>
                <option value="BUY">Buys</option>
                <option value="SELL">Sells</option>
              </select>
            </label>
            <label>
              Account
              <select
                value={account}
                onChange={(e) => {
                  setAccount(e.target.value);
                  setPage(0);
                }}
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p role="status" className="muted">
            {filtered.length
              ? `Showing ${current * pageSize + 1}–${Math.min((current + 1) * pageSize, filtered.length)} of ${filtered.length} trades`
              : "No matching trades"}
          </p>
          <DataTable
            headers={[
              "Trade",
              "Date",
              "Account",
              "Quantity",
              "Reported price",
              "Reported amount",
              "Source / notes",
            ]}
            empty={
              history.trades.length
                ? "No trades match these filters."
                : "No recorded buys or sells in this import."
            }
            rows={rows.map((t) => [
              <>
                <strong>
                  {t.side === "BUY" ? "Buy" : "Sell"} {t.symbol}
                </strong>
                <small>{t.description}</small>
              </>,
              <>
                {t.date}
                <small>{t.dateBasis}</small>
              </>,
              <>
                {t.account}
                <small>{t.institution}</small>
              </>,
              number(t.quantity),
              money(t.price),
              money(t.amount),
              <>
                {t.source}
                {t.notes && <small>{t.notes}</small>}
              </>,
            ])}
          />
          {pages > 1 && (
            <nav className="trade-pagination" aria-label="Trade history pages">
              <button
                type="button"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </button>
              <span>
                Page {current + 1} of {pages}
              </span>
              <button
                type="button"
                disabled={current === pages - 1}
                onClick={() => setPage(current + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
