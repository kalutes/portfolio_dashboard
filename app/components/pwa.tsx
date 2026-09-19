"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
const subscribeSecure = () => () => {};
export default function Pwa() {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [offline, setOffline] = useState(false);
  const secure = useSyncExternalStore(
    subscribeSecure,
    () => window.isSecureContext,
    () => true,
  );
  const [message, setMessage] = useState("");
  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const checkDisplay = () =>
      setInstalled(
        display.matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone ===
            true,
      );
    const checkNetwork = () => setOffline(!navigator.onLine);
    const install = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPrompt);
    };
    const complete = () => {
      setInstalled(true);
      setPrompt(null);
    };
    checkDisplay();
    checkNetwork();
    display.addEventListener("change", checkDisplay);
    window.addEventListener("online", checkNetwork);
    window.addEventListener("offline", checkNetwork);
    window.addEventListener("beforeinstallprompt", install);
    window.addEventListener("appinstalled", complete);
    if (
      process.env.NODE_ENV === "production" &&
      window.isSecureContext &&
      "serviceWorker" in navigator
    ) {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() =>
          setMessage(
            "Offline launch is unavailable. You can still use the app online.",
          ),
        );
    }
    return () => {
      display.removeEventListener("change", checkDisplay);
      window.removeEventListener("online", checkNetwork);
      window.removeEventListener("offline", checkNetwork);
      window.removeEventListener("beforeinstallprompt", install);
      window.removeEventListener("appinstalled", complete);
    };
  }, []);
  async function install() {
    if (!prompt) return;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setMessage(
        choice.outcome === "accepted"
          ? "Installation requested. Open Portfolio from your home screen."
          : "You can install later from your browser menu.",
      );
    } catch {
      setMessage("Use your browser menu to install this app.");
    } finally {
      setPrompt(null);
    }
  }
  return (
    <>
      {offline && (
        <p className="network-status" role="status">
          Offline · Displayed values may be out of date. Reconnect to your
          network and Tailscale, then refresh.
        </p>
      )}
      {!installed && (
        <aside className="install-help" aria-label="Install Portfolio">
          <details>
            <summary>Install Portfolio on your phone</summary>
            {!secure && (
              <p>
                Open the dashboard using its HTTPS Tailscale hostname to enable
                installation.
              </p>
            )}
            {prompt && secure && (
              <button type="button" onClick={install}>
                Install app
              </button>
            )}
            <p>
              <strong>iPhone:</strong> In Safari, tap Share → Add to Home
              Screen. Keep “Open as Web App” enabled if shown.
            </p>
            <p>
              <strong>Android:</strong> In Chrome, use Install app or Add to
              Home screen from the browser menu.
            </p>
            <p className="muted">
              Keep Tailscale connected to reach your home server. Portfolio data
              requires a connection; it is not saved for offline browsing.
            </p>
          </details>
          {message && <p role="status">{message}</p>}
        </aside>
      )}
    </>
  );
}
