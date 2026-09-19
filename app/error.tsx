"use client";
export default function Error({ retry }: { retry: () => void }) {
  return (
    <main id="main">
      <h1>Dashboard unavailable</h1>
      <p role="alert">
        An unexpected error prevented this view from loading. Try again.
      </p>
      <button onClick={() => retry()}>Try again</button>
    </main>
  );
}
