import type { allocationBySymbol } from "@/lib/allocation";
import AllocationDonut from "./allocation-donut";

const colors = [
  "#82e4c5",
  "#8ca8ff",
  "#f0c674",
  "#bb9af7",
  "#f28e9b",
  "#b5d882",
  "#70cce0",
  "#e6a1dc",
  "#6c85d9",
  "#dba985",
];
export default function SymbolAllocation({
  allocation,
}: {
  allocation: ReturnType<typeof allocationBySymbol>;
}) {
  return (
    <section id="allocation" aria-labelledby="allocation-title">
      <h2 id="allocation-title">Allocation by symbol</h2>
      <p className="muted">
        Holdings combined across accounts, with cash and cash equivalents in one
        Cash category. Weights use available estimated holdings and cash values,
        which may differ from reported account totals.
      </p>
      {allocation.partial && (
        <p className="notice" role="status">
          Partial allocation: some balances, positions, or values are
          unavailable. Percentages reflect only included data.
        </p>
      )}
      <article className="allocation">
        {!allocation.chartable && (
          <p className="muted">
            {allocation.rows.length
              ? "Donut chart unavailable for negative allocations or nonpositive totals."
              : "No nonzero holdings or cash available to chart."}
          </p>
        )}
        <div className="symbol-allocation">
          {allocation.chartable && (
            <AllocationDonut
              rows={allocation.rows}
              total={allocation.total}
              colors={colors}
            />
          )}
        </div>
      </article>
    </section>
  );
}
