import { requireSession } from "@/lib/auth/require-session";
import { connection } from "next/server";
import Link from "next/link";
import { withManualStore } from "@/lib/manual/store";
import { AccountForm, HoldingForm, DeleteForm } from "./forms";
import type { ManualSnapshot } from "@/lib/manual/types";

export default async function ManualPage() {
  await requireSession();
  await connection();
  let snapshot: ManualSnapshot;
  try {
    snapshot = withManualStore((store) => store.snapshot());
  } catch {
    return (
      <main id="main">
        <Link href="/">← Portfolio</Link>
        <h1>Manual holdings</h1>
        <p className="notice error" role="alert">
          Could not open the manual database. Check MANUAL_DB_PATH and directory
          permissions.
        </p>
      </main>
    );
  }
  return (
    <main id="main">
      <Link href="/">← Portfolio</Link>
      <h1>Manual holdings</h1>
      <p className="muted">
        Accounts outside SnapTrade. Values join your portfolio and allocation
        chart. Yahoo quotes are updated by the daily background sync; coverage
        and delays vary. Edits here update current holdings and future daily
        snapshots. Previously recorded history stays unchanged.
      </p>
      <section className="account">
        <h2>Add account</h2>
        <AccountForm />
      </section>
      {!snapshot.accounts.length && (
        <p className="empty">
          No manual accounts yet. Add your first account above.
        </p>
      )}
      {snapshot.accounts.map((account) => (
        <section className="account" key={account.id}>
          <h2>{account.name}</h2>
          <p className="muted">{account.institution} · Manual</p>
          <details>
            <summary>Edit account</summary>
            <AccountForm account={account} />
            <DeleteForm id={account.id} account />
          </details>
          <h3>Holdings</h3>
          {snapshot.holdings
            .filter((h) => h.accountId === account.id)
            .map((holding) => (
              <details className="holding-editor" key={holding.id}>
                <summary>
                  {holding.symbol} · {holding.quantity} units
                  {holding.acquiredDate
                    ? ` · ${holding.acquiredDate}`
                    : ""} ·{" "}
                  {holding.cashEquivalent
                    ? "Cash"
                    : holding.quoteSymbol
                      ? "Yahoo + manual fallback"
                      : "Manual valuation"}
                </summary>
                <HoldingForm account={account} holding={holding} />
                <DeleteForm id={holding.id} />
              </details>
            ))}
          <details className="holding-editor">
            <summary>Add holding</summary>
            <HoldingForm account={account} />
          </details>
        </section>
      ))}
    </main>
  );
}
