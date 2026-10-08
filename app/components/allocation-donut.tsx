"use client";

import { useState } from "react";
import { money } from "@/lib/format";
import { gainPercent } from "@/lib/performance";
import { allocationSegments, type AllocationRow } from "@/lib/allocation";

export default function AllocationDonut({
  rows,
  total,
  colors,
}: {
  rows: AllocationRow[];
  total: number;
  colors: string[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const active = hovered ?? selected;
  const row = active === null ? null : rows[active];
  const circumference = 2 * Math.PI * 112;
  const percent = (value: number | null) =>
    (value ?? 0) < 0.1 ? "<0.1%" : `${value!.toFixed(1)}%`;
  return (
    <div className="allocation-donut">
      <div className="donut-visual">
        <svg
          viewBox="0 0 280 280"
          role="group"
          aria-label="Portfolio allocation. Each symbol uses muted cost basis and brighter gains. Focus or select a symbol for details."
        >
          <circle
            cx="140"
            cy="140"
            r="112"
            fill="none"
            stroke="var(--raised)"
            strokeWidth="30"
          />
          {rows.map((slice, i) => {
            const parts = allocationSegments(slice);
            const offset = rows
              .slice(0, i)
              .reduce(
                (sum, prior) => sum + (prior.amount / total) * circumference,
                0,
              );
            const label = `${slice.symbol}: ${money(slice.amount)}, ${percent(slice.percent)}. ${slice.isCash ? "Cash." : `Cost basis ${money(slice.costBasis)}. Unrealized gain or loss ${money(slice.gain)}, ${gainPercent(slice.gainPercent)}.`}`;
            return (
              <g
                key={slice.symbol}
                className="donut-slice"
                tabIndex={0}
                role="button"
                aria-pressed={selected === i}
                aria-label={label}
                onPointerEnter={() => setHovered(i)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setSelected(i)}
                onBlur={() => setSelected(null)}
                onClick={() => setSelected(i)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected(i);
                  }
                  if (event.key === "Escape") {
                    setSelected(null);
                    setHovered(null);
                  }
                }}
                style={{ opacity: active === null || active === i ? 1 : 0.35 }}
              >
                <title>{label}</title>
                {parts.map((part, j) => {
                  const length = (part.amount / total) * circumference;
                  const gap =
                    j === parts.length - 1 && rows.length > 1
                      ? Math.min(3, length * 0.12)
                      : 0;
                  const start =
                    offset +
                    parts
                      .slice(0, j)
                      .reduce(
                        (sum, p) => sum + (p.amount / total) * circumference,
                        0,
                      );
                  return (
                    <circle
                      key={part.kind}
                      cx="140"
                      cy="140"
                      r="112"
                      fill="none"
                      stroke={colors[i % colors.length]}
                      strokeOpacity={part.kind === "basis" ? 0.55 : 1}
                      strokeWidth={active === i ? 38 : 30}
                      strokeDasharray={`${length - gap} ${circumference - length + gap}`}
                      strokeDashoffset={-start}
                      transform="rotate(-90 140 140)"
                    >
                      <title>
                        {part.kind === "basis" && (slice.gain ?? 0) < 0
                          ? "Remaining value below cost basis"
                          : part.kind === "basis"
                            ? "Cost basis"
                            : part.kind === "gain"
                              ? "Unrealized gain"
                              : part.kind === "cash"
                                ? "Cash"
                                : "Value; cost basis unavailable"}
                        : {money(part.amount)}
                      </title>
                    </circle>
                  );
                })}
              </g>
            );
          })}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <span className="donut-label">{row?.symbol ?? "Included value"}</span>
          {row && (
            <strong className="donut-percent">{percent(row.percent)}</strong>
          )}
          <span className="donut-value">{money(row?.amount ?? total)}</span>
        </div>
      </div>
      <div className="donut-legend" aria-hidden="true">
        <span>
          <i className="legend-basis" />
          Cost basis
        </span>
        <span>
          <i className="legend-gain" />
          Unrealized gain
        </span>
      </div>
      <div className="donut-details" aria-live="polite" aria-atomic="true">
        {row ? (
          <>
            <strong>
              {row.symbol} · {money(row.amount)}
            </strong>
            {row.isCash ? (
              <p className="muted">
                Cash and cash equivalents; no investment gain calculated.
              </p>
            ) : (
              <dl>
                <div>
                  <dt>Cost basis</dt>
                  <dd>{money(row.costBasis)}</dd>
                </div>
                <div>
                  <dt>Unrealized gain / loss</dt>
                  <dd
                    className={
                      row.gain === null
                        ? "muted"
                        : row.gain < 0
                          ? "performance-loss"
                          : "performance-gain"
                    }
                  >
                    {money(row.gain)}
                  </dd>
                </div>
                <div>
                  <dt>Gain / loss %</dt>
                  <dd>{gainPercent(row.gainPercent)}</dd>
                </div>
              </dl>
            )}
          </>
        ) : (
          <p className="muted">
            Hover, tap or focus a symbol to see its value, basis and unrealized
            gain.
          </p>
        )}
      </div>
    </div>
  );
}
