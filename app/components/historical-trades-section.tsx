import { loadHistoricalTrades } from "@/lib/trade-store";
import HistoricalTrades from "./historical-trades";

export default function HistoricalTradesSection() {
  let history;
  try {
    history = loadHistoricalTrades();
  } catch {
    history = null;
  }
  if (!history) {
    return (
      <section aria-labelledby="trades-title">
        <h2 id="trades-title">Historical trades</h2>
        <p className="notice error" role="alert">
          Historical trades are unavailable. Check the portfolio database. Other
          portfolio sections remain available.
        </p>
      </section>
    );
  }
  return <HistoricalTrades history={history} />;
}
