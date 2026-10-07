"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
const HAS_MAPBOX_TOKEN = Boolean(
  TOKEN?.startsWith("pk.") && TOKEN !== "pk.your_mapbox_token_here",
);

const SIGNAL_COLORS = ["#ff6b45", "#f3b95f", "#d8788f", "#9cad72", "#62a89b"];

function dotColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return SIGNAL_COLORS[Math.abs(hash) % SIGNAL_COLORS.length];
}

function MapControlIcon({ kind }: { kind: "locate" | "world" }) {
  if (kind === "locate") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9h17M3.5 15h17M12 3c2.1 2.45 3.15 5.45 3.15 9S14.1 18.55 12 21M12 3C9.9 5.45 8.85 8.45 8.85 12S9.9 18.55 12 21" />
    </svg>
  );
}

export default function WorldMap({
  peers,
  me,
  onPeerClick,
  canConnect,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState(false);

  // Marker click handlers are bound once, so read the live click handler +
  // connectability through refs (synced in an effect, never during render).
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
  });

  // Initialise the map once.
  useEffect(() => {
    if (!HAS_MAPBOX_TOKEN || !TOKEN || !containerRef.current) return;
    const accessToken = TOKEN;
    let cancelled = false;
    let loaded = false;
    const markers = markersRef.current;

    (async () => {
      try {
        const mapboxgl = (await import("mapbox-gl")).default;
        if (cancelled || !containerRef.current) return;
        mapboxgl.accessToken = accessToken;
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/dark-v11",
          projection: "globe",
          // Open centered on the user if we know where they are, else world view.
          center: me ? [me.lng, me.lat] : [0, 20],
          zoom: me ? 4 : 1.4,
          attributionControl: true,
        });
        map.on("load", () => {
          loaded = true;
          if (!cancelled) {
            map.setFog({
              color: "#090806",
              "high-color": "#17110d",
              "horizon-blend": 0.08,
              "space-color": "#050403",
              "star-intensity": 0.08,
            });
            setMapError(false);
            setReady(true);
          }
        });
        map.on("error", () => {
          if (!cancelled && !loaded) setMapError(true);
        });
        mapRef.current = map;
      } catch {
        if (!cancelled) setMapError(true);
      }
    })();

    return () => {
      cancelled = true;
      markers.forEach((m) => m.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // `me` is only read for the initial center; we don't want to re-init on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show / move the user's own "you are here" pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You are here";
        el.setAttribute("aria-label", "Your approximate location");
        el.innerHTML = `<span class="pulse-me-label">You</span><span class="pulse-me-core"></span>`;
        // anchor "bottom" → the pin's tip sits on the exact coordinate.
        meMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // Reconcile markers whenever the peer list changes (or the map becomes ready).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let marker = markers.get(peer.id);
        if (!marker) {
          const el = document.createElement("button");
          const core = document.createElement("span");
          const label = document.createElement("span");
          el.type = "button";
          el.className = "pulse-dot";
          el.style.setProperty("--signal-color", dotColor(peer.id));
          core.className = "pulse-dot-core";
          label.className = "pulse-dot-label";
          el.append(core, label);
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (canConnectRef.current) onPeerClickRef.current(peer.id);
          });
          marker = new mapboxgl.Marker({ element: el })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          markers.set(peer.id, marker);
        }
        marker.setLngLat([peer.lng, peer.lat]);
        const element = marker.getElement() as HTMLButtonElement;
        element.disabled = peer.busy || !canConnect;
        element.title = peer.busy
          ? "Already connected"
          : canConnect
            ? "Tap to connect"
            : "Finish your current signal first";
        element.setAttribute(
          "aria-label",
          peer.busy
            ? "Signal already in a conversation"
            : canConnect
              ? "Connect to this signal"
              : "Signal unavailable while you are connecting",
        );
        element.classList.toggle("is-busy", peer.busy);
        const label = element.querySelector<HTMLElement>(".pulse-dot-label");
        if (label) {
          label.textContent = peer.busy
            ? "In conversation"
            : canConnect
              ? "Open signal"
              : "Signal paused";
        }
      }

      // Drop markers for peers that went offline / got filtered out.
      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready, canConnect]);

  function recenterOnMe() {
    if (!mapRef.current || !me) return;
    mapRef.current.easeTo({
      center: [me.lng, me.lat],
      zoom: 4,
      duration: 900,
    });
  }

  function showWholeWorld() {
    mapRef.current?.easeTo({
      center: [0, 20],
      zoom: 1.4,
      duration: 1100,
    });
  }

  const onlineCount = peers.length + (me ? 1 : 0);

  return (
    <div className="map-shell absolute inset-0">
      <div ref={containerRef} className="pulse-map h-full w-full" />
      <div className="map-vignette" aria-hidden="true" />

      <header className="map-header">
        <div className="wordmark wordmark-map">
          <span className="wordmark-signal" aria-hidden="true" />
          <span>Pulse</span>
        </div>
        <div className="map-header-status">
          <span aria-hidden="true" />
          <p>Scanning the night / live now</p>
        </div>
      </header>

      {!HAS_MAPBOX_TOKEN && (
        <div className="map-system-state" role="alert">
          <p className="map-system-kicker">Map unavailable</p>
          <h2>Your Mapbox token is missing.</h2>
          <p>
            Add <code>NEXT_PUBLIC_MAPBOX_TOKEN</code> to <code>.env</code>, then
            restart the app.
          </p>
        </div>
      )}

      {HAS_MAPBOX_TOKEN && mapError && (
        <div className="map-system-state" role="alert">
          <p className="map-system-kicker">Signal interrupted</p>
          <h2>Couldn&rsquo;t reach the map.</h2>
          <p>Check the Mapbox token and your network, then refresh the page.</p>
        </div>
      )}

      {HAS_MAPBOX_TOKEN && !ready && !mapError && (
        <div className="map-loading" role="status">
          <div className="map-loading-orbit" aria-hidden="true">
            <span />
          </div>
          <p>Finding your place in the night</p>
        </div>
      )}

      {ready && (
        <nav className="map-controls" aria-label="Map view controls">
          <button
            type="button"
            onClick={recenterOnMe}
            disabled={!me}
            aria-label="Center map on my location"
            title="Find me"
          >
            <MapControlIcon kind="locate" />
            <span>Find me</span>
          </button>
          <button
            type="button"
            onClick={showWholeWorld}
            aria-label="Show the whole world"
            title="World view"
          >
            <MapControlIcon kind="world" />
            <span>World view</span>
          </button>
        </nav>
      )}

      {ready && peers.length === 0 && (
        <section className="map-empty" aria-live="polite">
          <div className="map-empty-frequency" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <p className="map-system-kicker">Listening worldwide</p>
          <h2>You&rsquo;re the first signal here.</h2>
          <p>
            Keep this tab open. New people appear the moment they enter Pulse.
          </p>
        </section>
      )}

      {ready && peers.length > 0 && (
        <div className="map-legend" aria-label="Map legend">
          <span><i className="is-you" />You</span>
          <span><i className="is-open" />Open signal</span>
          <span><i className="is-busy" />In conversation</span>
        </div>
      )}

      <div className="map-presence">
        <span className="map-presence-dot" aria-hidden="true" />
        <div>
          <strong>{onlineCount}</strong>
          <span>{onlineCount === 1 ? "signal online" : "signals online"}</span>
        </div>
      </div>

      <div className="map-hint">
        <span>Explore the night</span>
        <span className="map-hint-line" aria-hidden="true" />
        <span>Tap a signal to connect</span>
      </div>
    </div>
  );
}
