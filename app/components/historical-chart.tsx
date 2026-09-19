"use client";
import { useEffect, useRef, useState } from "react";
import { compactUsd } from "@/lib/format";
import type {
  HistoricalDetail,
  HistoricalSeries,
} from "@/lib/historical-types";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
const label = (day: string) =>
  new Date(day + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
function methodLabel(method: string) {
  if (method.includes("daily_snapshot"))
    return method.includes("stale")
      ? "Daily snapshot (stale source)"
      : "Daily snapshot";
  if (method.includes("interpolation")) return "Interpolated estimate";
  if (method.includes("estimate")) return "Estimated from transactions";
  if (method.includes("unavailable")) return "Unpriced";
  if (method === "cash_at_par") return "Cash";
  if (method.includes("statement")) return "Statement value";
  if (method === "previous_market_close") return "Previous market close";
  return "Market close";
}
export default function HistoricalChart({
  series,
}: {
  series: HistoricalSeries;
}) {
  const chartRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(700);
  const plotWidth = width - 80;
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, entry.contentRect.width)),
    );
    observer.observe(chart);
    return () => observer.disconnect();
  }, []);
  const [range, setRange] = useState("All");
  const [day, setDay] = useState(series.points.at(-1)?.day ?? "");
  const [detail, setDetail] = useState<HistoricalDetail | null>(null);
  const [error, setError] = useState<{ day: string; message: string } | null>(
    null,
  );
  const [retry, setRetry] = useState(0);
  const end = series.points.at(-1)?.day ?? "";
  const cutoff = Date.parse(end) - (range === "1Y" ? 365 : 365 * 5) * 86400000;
  const points = series.points.filter(
    (p) => range === "All" || Date.parse(p.day) >= cutoff,
  );
  const index = Math.max(
    0,
    points.findIndex((p) => p.day === day),
  );
  const selected = points.find((p) => p.day === day) ?? points.at(-1);
  const selectedDay = selected?.day ?? "";
  useEffect(() => {
    if (!selectedDay) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/history?date=${selectedDay}&revision=${series.revision}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Historical holdings are unavailable.",
          );
        if (!controller.signal.aborted) {
          setDetail(result);
          setError(null);
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError({
            day: selectedDay,
            message:
              e instanceof Error
                ? e.message
                : "Historical holdings are unavailable.",
          });
      }
    }, 160);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedDay, series.revision, retry]);
  if (!selected || !points.length)
    return (
      <section aria-labelledby="growth-title">
        <h2 id="growth-title">Portfolio value over time</h2>
        <p className="empty">No historical dates are available.</p>
      </section>
    );
  const low = Math.min(0, ...points.map((p) => p.known));
  const high = Math.max(...points.map((p) => p.known), low + 1) * 1.05;
  const x = (i: number) =>
    58 + (i / Math.max(1, points.length - 1)) * plotWidth;
  const y = (v: number) => 216 - ((v - low) / (high - low)) * 190;
  let full = "";
  let connected = false;
  points.forEach((p, i) => {
    if (p.total === null) {
      connected = false;
      return;
    }
    full += `${connected ? "L" : "M"}${x(i)},${y(p.total)} `;
    connected = true;
  });
  const knownPath = points
    .map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.known)}`)
    .join(" ");
  const activeIndex = points.findIndex((p) => p.day === selected.day);
  const loaded = detail?.day === selected.day;
  const currentError = error?.day === selected.day ? error.message : null;
  return (
    <section className="historical-section" aria-labelledby="growth-title">
      <div className="history-toolbar">
        <h2 id="growth-title">Portfolio value over time</h2>
        <div className="history-ranges" aria-label="Chart date range">
          {["1Y", "5Y", "All"].map((r) => (
            <button
              type="button"
              key={r}
              aria-pressed={r === range}
              onClick={() => {
                setRange(r);
                setDay(end);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        Imported history through {label(end)}. Includes deposits and
        withdrawals, not investment return. Estimates and missing history are
        identified below; current manual accounts are not automatically added to
        this historical dataset.
      </p>
      <article className="account historical-card">
        <div className="history-toolbar">
          <div>
            <p className="history-value">{usd(selected.known)}</p>
            <p>
              {label(selected.day)} ·{" "}
              {selected.total === null
                ? "Partial subtotal"
                : selected.estimated
                  ? "Estimated portfolio value"
                  : "Portfolio value · known history"}
            </p>
          </div>
          <label className="history-date">
            Inspect date
            <input
              type="date"
              min={series.points[0].day}
              max={end}
              value={selected.day}
              onChange={(e) => {
                if (series.points.some((p) => p.day === e.target.value)) {
                  setRange("All");
                  setDay(e.target.value);
                }
              }}
            />
          </label>
        </div>
        <svg
          className="historical-svg"
          ref={chartRef}
          viewBox={`0 0 ${width} 246`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Portfolio history. Solid line: priced portfolio. Dashed line: known subtotal, which may omit unpriced holdings. Use the date controls below for keyboard access."
          onPointerMove={(e) => {
            if (e.pointerType === "touch" && e.buttons === 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const proportion =
              (((e.clientX - rect.left) / rect.width) * width - 58) / plotWidth;
            const i = Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(proportion * (points.length - 1)),
              ),
            );
            setDay(points[i].day);
          }}
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const i = Math.max(
              0,
              Math.min(
                points.length - 1,
                Math.round(
                  ((((e.clientX - rect.left) / rect.width) * width - 58) /
                    plotWidth) *
                    (points.length - 1),
                ),
              ),
            );
            setDay(points[i].day);
          }}
        >
          {[0, 0.5, 1].map((f) => {
            const value = low + (high - low) * f;
            return (
              <g key={f}>
                <line
                  x1="58"
                  x2={width - 22}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="var(--line)"
                />
                <text
                  x="50"
                  y={y(value) + 4}
                  textAnchor="end"
                  fill="var(--muted)"
                  fontSize="11"
                >
                  {compactUsd(value)}
                </text>
              </g>
            );
          })}
          <path
            d={knownPath}
            fill="none"
            stroke="var(--muted)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={full}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={x(activeIndex)}
            x2={x(activeIndex)}
            y1="20"
            y2="216"
            stroke="var(--muted)"
            strokeDasharray="3 3"
          />
          <circle
            cx={x(activeIndex)}
            cy={y(selected.known)}
            r="4"
            fill="var(--accent)"
          />
          <text x="58" y="240" fill="var(--muted)" fontSize="12">
            {points[0].day}
          </text>
          <text
            x={width - 22}
            y="240"
            textAnchor="end"
            fill="var(--muted)"
            fontSize="12"
          >
            {end}
          </text>
        </svg>
        <label className="history-scrubber">
          Explore by date
          <input
            aria-label="Historical date"
            aria-valuetext={`${label(selected.day)}, ${usd(selected.known)}${selected.total === null ? ", partial subtotal" : ""}`}
            type="range"
            min="0"
            max={points.length - 1}
            value={activeIndex >= 0 ? activeIndex : index}
            onChange={(e) => setDay(points[Number(e.target.value)].day)}
          />
        </label>
        <p className="muted">
          Hover or tap the chart to inspect a date. Use the slider arrow keys to
          move one day at a time. Solid: priced holdings · Dashed: known
          subtotal.
        </p>
        {selected.missing > 0 && (
          <p className="notice">
            Partial coverage: {selected.missing} holding or fund component(s)
            cannot be priced. The subtotal excludes them; they are not valued at
            zero.
          </p>
        )}
        {selected.estimated > 0 && (
          <p className="notice">
            {selected.estimated} holding or fund component(s) use estimates.
            Microsoft 401(k) interpolation can temporarily overstate the
            combined value around transfers.
          </p>
        )}
        {selected.stale && (
          <p className="notice">
            Some holdings are carried beyond their latest supplied statement.
            Later trades may be missing.
          </p>
        )}
        <h3>Holdings on {label(selected.day)}</h3>
        {currentError ? (
          <div role="alert">
            <p className="notice error">{currentError}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setRetry((n) => n + 1);
              }}
            >
              Retry holdings
            </button>
          </div>
        ) : !loaded ? (
          <p role="status">Loading holdings…</p>
        ) : detail.holdings.length === 0 ? (
          <p className="empty">No holdings recorded for this date.</p>
        ) : (
          <div
            className="table-scroll"
            tabIndex={0}
            role="region"
            aria-label={`Holdings on ${selected.day}`}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Holding</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Value</th>
                  <th scope="col">Valuation</th>
                </tr>
              </thead>
              <tbody>
                {detail.holdings.map((h) => (
                  <tr key={h.symbol}>
                    <td>{h.symbol.replaceAll("_", " ")}</td>
                    <td>
                      {h.quantity === null
                        ? "—"
                        : h.quantity.toLocaleString("en-US", {
                            maximumFractionDigits: 6,
                          })}
                    </td>
                    <td>
                      {h.value === null
                        ? "Unpriced"
                        : new Intl.NumberFormat("en-US", {
                            style: "currency",
                            currency: "USD",
                          }).format(h.value)}
                    </td>
                    <td>
                      {methodLabel(h.method)}
                      {h.method.includes("daily_snapshot") && h.previous && (
                        <small>As of {h.previous}</small>
                      )}
                      {h.previous && h.next && h.previous !== h.next && (
                        <small>
                          {h.previous} → {h.next}
                        </small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="retrieved">
          History read{" "}
          {new Date(series.retrievedAt).toLocaleString("en-US", {
            timeZone: "UTC",
          })}
          . Earlier unimported accounts and crypto may be absent. Option
          quantities are contracts.
        </p>
      </article>
    </section>
  );
}
