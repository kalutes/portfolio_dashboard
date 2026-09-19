"use client";

import { useState } from "react";
import { money } from "@/lib/format";

type Slice = { symbol: string; amount: number; percent: number | null };
export default function AllocationDonut({
  rows,
  total,
  colors,
}: {
  rows: Slice[];
  total: number;
  colors: string[];
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const active = hovered ?? selected;
  const row = active === null ? null : rows[active];
  const circumference = 2 * Math.PI * 112;
  return (
    <div className="allocation-donut">
      <div className="donut-visual">
        <svg
          viewBox="0 0 280 280"
          role="group"
          aria-label="Portfolio allocation. Focus or select a slice for details."
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
            const length = ((slice.percent ?? 0) / 100) * circumference;
            const gap = rows.length === 1 ? 0 : Math.min(3, length * 0.12);
            const dashOffset = -rows
              .slice(0, i)
              .reduce(
                (sum, prior) =>
                  sum + ((prior.percent ?? 0) / 100) * circumference,
                0,
              );
            const percent =
              (slice.percent ?? 0) < 0.1
                ? "<0.1%"
                : `${slice.percent?.toFixed(1)}%`;
            return (
              <circle
                key={`${slice.symbol}-${i}`}
                className="donut-slice"
                cx="140"
                cy="140"
                r="112"
                fill="none"
                stroke={colors[i % colors.length]}
                strokeWidth={active === i ? 38 : 30}
                strokeDasharray={`${length - gap} ${circumference - length + gap}`}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 140 140)"
                style={{ opacity: active === null || active === i ? 1 : 0.35 }}
                tabIndex={0}
                role="button"
                aria-pressed={selected === i}
                aria-label={`${slice.symbol}: ${money(slice.amount)}, ${percent}`}
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
              />
            );
          })}
        </svg>
        <div className="donut-center" aria-hidden="true">
          <span className="donut-label">{row?.symbol ?? "Included value"}</span>
          {row && (
            <strong className="donut-percent">
              {(row.percent ?? 0) < 0.1
                ? "<0.1%"
                : `${row.percent?.toFixed(1)}%`}
            </strong>
          )}
          <span className="donut-value">{money(row?.amount ?? total)}</span>
        </div>
      </div>
    </div>
  );
}
