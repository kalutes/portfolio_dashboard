export default function Loading() {
  return (
    <main id="main" aria-busy="true">
      <h1>Portfolio</h1>
      <p role="status">Loading saved portfolio data…</p>
      <div className="skeleton" aria-hidden="true" />
    </main>
  );
}
