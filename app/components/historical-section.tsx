import { loadHistoricalSeries } from "@/lib/historical-store";
import HistoricalChart from "./historical-chart";
export default function HistoricalSection() {
  let series;
  try {
    series = loadHistoricalSeries();
  } catch {
    return (
      <section aria-labelledby="growth-title">
        <h2 id="growth-title">Portfolio value over time</h2>
        <p className="notice error" role="alert">
          Historical data is unavailable. Check HISTORY_DB_PATH and the mounted
          database, then refresh. Current holdings remain available.
        </p>
      </section>
    );
  }
  return <HistoricalChart series={series} />;
}
