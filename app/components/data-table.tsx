import type { ReactNode } from "react";

export default function DataTable({
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
