"use client";

import { useState } from "react";

export default function EntryGate({
  onReady,
}: {
  onReady: (lat: number, lng: number) => Promise<void>;
}) {
  const [status, setStatus] = useState<"idle" | "locating" | "error">("idle");
  const [error, setError] = useState<string>("");

  function enter() {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setError("Your browser doesn't support location access.");
      return;
    }
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          await onReady(pos.coords.latitude, pos.coords.longitude);
        } catch {
          setStatus("error");
          setError("Couldn't join Pulse. Please try again.");
        }
      },
      (err) => {
        setStatus("error");
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is required to place you on the map."
            : "Couldn't get your location. Please try again.",
        );
      },
      // High accuracy + maximumAge:0 forces a fresh fix (Wi-Fi/GPS scan)
      // instead of reusing the browser's cached IP-based location.
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }

  return (
    <main className="entry-shell">
      <div className="entry-noise" aria-hidden="true" />
      <div className="entry-horizon" aria-hidden="true" />

      <header className="entry-header">
        <div className="wordmark">
          <span className="wordmark-signal" aria-hidden="true" />
          <span>Pulse</span>
        </div>
        <div className="entry-status">
          <span className="entry-status-dot" aria-hidden="true" />
          live worldwide
        </div>
      </header>

      <div className="entry-grid">
        <section className="entry-hero">
          <p className="eyebrow">Anonymous / ephemeral / peer to peer</p>
          <h1>
            The world
            <br />
            is <em>awake.</em>
          </h1>
          <p className="entry-lede">
            Somewhere, someone else is looking at the same night. Find a signal
            and say hello.
          </p>
          <div className="signal-line" aria-hidden="true">
            <span />
          </div>
        </section>

        <section className="entry-panel" aria-labelledby="enter-title">
          <div className="entry-step">01 / ARRIVAL</div>
          <h2 id="enter-title">Enter without leaving a trace.</h2>
          <p className="entry-panel-copy">
            We use your location once to place an anonymous dot nearby, never on
            your exact position.
          </p>

          <dl className="entry-facts">
            <div>
              <dt>Identity</dt>
              <dd>None required</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>Peer to peer</dd>
            </div>
            <div>
              <dt>History</dt>
              <dd>Never stored</dd>
            </div>
          </dl>

          <button
            onClick={enter}
            disabled={status === "locating"}
            className="entry-button"
          >
            <span>
              {status === "locating" ? "Finding your signal" : "Enter the map"}
            </span>
            <span className="entry-button-mark" aria-hidden="true">
              {status === "locating" ? "•••" : "↗"}
            </span>
          </button>

          {status === "error" && (
            <p className="entry-error" role="alert">
              {error}
            </p>
          )}

          <p className="entry-privacy">
            By entering you allow location access for this session. Closing the
            tab removes your dot and ends everything.
          </p>
        </section>
      </div>

      <footer className="entry-footer">
        <span>One world, no profiles</span>
        <span>Coordinates softened by 1–3 km</span>
      </footer>
    </main>
  );
}
