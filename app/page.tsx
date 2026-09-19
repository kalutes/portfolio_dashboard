import { logout } from "./login/actions";
import { requireSession } from "@/lib/auth/require-session";
import HistoricalSection from "./components/historical-section";
import Link from "next/link";
import { readManualPortfolio } from "@/lib/manual/read";
import { readSavedPortfolio, type SavedPortfolio } from "@/lib/dashboard-store";
import { connection } from "next/server";
import type { ReactNode } from "react";
import type { Section } from "@/lib/portfolio";
import { freshness, sumMoney } from "@/lib/normalize";
import { date, money, number } from "@/lib/format";
import { allocationBySymbol } from "@/lib/allocation";
import SymbolAllocation from "./components/symbol-allocation";

function State<T>({
  result,
  children,
}: {
  result: Section<T>;
  children: (data: T) => ReactNode;
}) {
  return (
    <>
      <p className="retrieved">Saved observation: {date(result.retrievedAt)}</p>
      {result.error && (
        <p className="notice error" role="alert">
          {result.error}
        </p>
      )}
      {result.data !== null && children(result.data)}
    </>
  );
}
function Freshness({ at }: { at: string | null }) {
  return (
    <p className="muted">
      {freshness(at)} · Brokerage timestamp: {date(at)}
    </p>
  );
}
function Table({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  if (!rows.length) return <p className="empty">{empty}</p>;
  return (
    <>
      <div
        className="table-scroll positions-table"
        tabIndex={0}
        role="region"
        aria-label={`${headers[0]} data table`}
      >
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="position-cards">
        {rows.map((row, i) => (
          <article className="position-card" key={i}>
            <div className="position-identity">{row[0]}</div>
            <dl>
              {row.slice(1).map((cell, j) => (
                <div key={headers[j + 1]}>
                  <dt>{headers[j + 1]}</dt>
                  <dd>{cell}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </>
  );
}
export default async function Home() {
  await requireSession();
  await connection();
  let snaptrade: SavedPortfolio | null = null;
  let savedError: string | null = null;
  try {
    snaptrade = readSavedPortfolio();
  } catch {
    savedError =
      "Saved brokerage data is unavailable. Check the database and background worker.";
  }
  const manual = readManualPortfolio();
  const retrievedAt = snaptrade?.retrievedAt ?? "";
  const combinedAccounts = [
    ...(snaptrade?.accounts.data ?? []),
    ...manual.details.map((d) => d.account),
  ];
  const portfolio = {
    accounts: {
      data:
        !combinedAccounts.length &&
        (!snaptrade || snaptrade.accounts.error || manual.error)
          ? null
          : combinedAccounts,
      error:
        snaptrade?.accounts.error ??
        savedError ??
        (!snaptrade
          ? "No saved brokerage data yet. The daily background sync will populate it; saved manual holdings remain available."
          : null),
      retrievedAt,
    },
    connections: snaptrade?.connections ?? {
      data: [],
      error: null,
      retrievedAt,
    },
    details: [
      ...(snaptrade?.details ?? []).map((d) => ({
        ...d,
        manual: false,
        notes: [] as string[],
      })),
      ...manual.details,
    ],
    retrievedAt,
  };
  const sortedAccounts = [...portfolio.details].sort((a, b) => {
    const first = a.account.total.amount;
    const second = b.account.total.amount;
    if (first === null) return second === null ? 0 : 1;
    if (second === null) return -1;
    return second - first;
  });
  const total = sumMoney((portfolio.accounts.data ?? []).map((a) => a.total));
  const cash = sumMoney(
    portfolio.details.flatMap((d) => d.balances.data ?? []),
  );
  const allocation = allocationBySymbol(
    portfolio.details.map((d) => ({
      balances: d.balances.data,
      positions: d.positions.data?.rows ?? null,
    })),
  );
  const failures = Boolean(
    manual.error ||
    portfolio.accounts.error ||
    portfolio.connections.error ||
    portfolio.details.some((d) =>
      [d.balances, d.positions].some((s) => s.error),
    ),
  );
  const missingTotals = (portfolio.accounts.data ?? []).filter(
    (a) => a.total.amount === null,
  ).length;
  const missingCash = portfolio.details.some(
    (d) =>
      !d.balances.data?.length ||
      d.balances.data.some((b) => b.amount === null),
  );
  return (
    <main id="main">
      <header className="page-header">
        <h1>Portfolio</h1>
        <div className="header-tools">
          <Link href="/manual">Manual holdings</Link>
          <form action={logout}>
            <button className="sign-out" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <p className="retrieved">
        Last background sync: {date(portfolio.retrievedAt)}. Data updates daily;
        brokerage timestamps may be older.
      </p>
      {manual.error && (
        <p className="notice error" role="alert">
          {manual.error}
        </p>
      )}
      {failures && (
        <p className="notice" role="status">
          Some saved data is incomplete or carried forward from an earlier sync.
          Available sections remain visible.
        </p>
      )}
      <section id="overview" aria-labelledby="overview-title">
        <h2 id="overview-title">Portfolio overview</h2>
        <div className="summary-grid">
          <article className="summary">
            <h3>Portfolio value</h3>
            <p className="big">{money(total)}</p>
            <p className="muted">
              {missingTotals
                ? `${missingTotals} account total(s) omitted: value unavailable. `
                : ""}
              Includes reported account totals and manual holdings.
            </p>
          </article>
          <article className="summary">
            <h3>Cash balances</h3>
            <p className="big">{money(cash)}</p>
            <p className="muted">
              {missingCash ? "Partial cash totals: balances are missing. " : ""}
              Includes manual cash; excludes buying power.
            </p>
          </article>
          <article className="summary">
            <h3>Accounts</h3>
            <p className="big">
              {portfolio.accounts.data?.length ?? "Unavailable"}
            </p>
            <p className="muted">
              {portfolio.details.reduce(
                (n, d) => n + (d.positions.data?.rows.length ?? 0),
                0,
              )}{" "}
              saved positions across accounts
            </p>
          </article>
        </div>
      </section>
      <SymbolAllocation allocation={allocation} />
      <HistoricalSection />
      <section aria-labelledby="connections-title">
        <h2 id="connections-title">Connections</h2>
        <State result={portfolio.connections}>
          {(connections) =>
            connections.length ? (
              <ul className="connections">
                {connections.map((c, i) => (
                  <li key={i}>
                    <strong>{c.name}</strong>
                    <span className="badge">{c.status}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">
                No saved brokerage connections. Connections update during the
                daily sync.
              </p>
            )
          }
        </State>
      </section>
      <section id="accounts" aria-labelledby="accounts-title">
        <h2 id="accounts-title">Accounts & positions</h2>
        <State result={portfolio.accounts}>
          {(accounts) =>
            accounts.length ? null : (
              <p className="empty">
                No saved accounts yet. Accounts will appear after the background
                sync.
              </p>
            )
          }
        </State>
        {sortedAccounts.map((d) => (
          <article className="account" key={d.account.id}>
            <header className="account-header">
              <div>
                <p className="eyebrow">{d.account.institution}</p>
                <h3>{d.account.name}</h3>
                <p className="muted">
                  {d.account.suffix
                    ? `Ending ${d.account.suffix}`
                    : "Number unavailable"}{" "}
                  · {d.account.type}
                </p>
              </div>
              <p className="account-value">{money(d.account.total)}</p>
            </header>
            {d.manual ? (
              <>
                <p className="muted">
                  Manual account · Valuation date: {date(d.account.holdingsAt)}
                </p>
                {d.notes.map((note, i) => (
                  <p className="notice" key={i}>
                    {note}
                  </p>
                ))}
              </>
            ) : (
              <Freshness at={d.positions.data?.asOf ?? d.account.holdingsAt} />
            )}
            {(d.account.syncing || d.account.holdingsUnavailable) && (
              <p className="notice">
                {d.account.syncing
                  ? "Initial holdings sync is still in progress."
                  : "Brokerage reports holdings unavailable."}
              </p>
            )}
            <h4>Cash</h4>
            <State result={d.balances}>
              {(balances) =>
                balances.length ? (
                  <div className="cash-list">
                    {balances.map((b, i) => (
                      <span key={i}>{money(b)}</span>
                    ))}
                  </div>
                ) : (
                  <p className="empty">No cash balances reported.</p>
                )
              }
            </State>
            <h4>Unified positions</h4>
            <State result={d.positions}>
              {(positions) => (
                <>
                  {!d.manual && <Freshness at={positions.asOf} />}
                  <Table
                    headers={[
                      "Instrument",
                      "Units",
                      "Price",
                      "Estimated value",
                      "Total cost basis",
                      "Acquired",
                    ]}
                    empty="No positions reported."
                    rows={positions.rows.map((p) => [
                      <>
                        <strong>{p.symbol}</strong>
                        <small>{p.description}</small>
                        {p.lots.length > 0 && (
                          <details>
                            <summary>{p.lots.length} purchase lot(s)</summary>
                            {p.lots.map((lot, i) => (
                              <p key={i}>
                                {lot.date ?? "Date unavailable"} ·{" "}
                                {number(lot.quantity)} units · Basis{" "}
                                {money(lot.costBasis)}
                              </p>
                            ))}
                          </details>
                        )}
                      </>,
                      number(p.units),
                      money(p.price),
                      money(p.value),
                      money(p.costBasis),
                      p.acquiredDate ??
                        (p.lots.length > 1 ? "Multiple lots" : "Unavailable"),
                    ])}
                  />
                  <p className="muted">
                    {d.manual ? (
                      "Manual values or Yahoo quote × quantity; source and date shown per holding."
                    ) : (
                      <>
                        Estimated values use units × price and the reported
                        option multiplier where applicable. Unsupported
                        valuation conventions show unavailable.
                      </>
                    )}
                  </p>
                </>
              )}
            </State>
          </article>
        ))}
      </section>
      <footer>
        Personal portfolio · SnapTrade read-only · Manual holdings saved locally
      </footer>
    </main>
  );
}
