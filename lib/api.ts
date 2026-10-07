// Client-side helpers for talking to the coordination API.
import type { PollResponse, SignalType } from "@/lib/types";

export class PresenceExpiredError extends Error {
  constructor() {
    super("presence expired");
    this.name = "PresenceExpiredError";
  }
}

export async function join(
  id: string,
  sessionToken: string,
  lat: number,
  lng: number,
): Promise<void> {
  const res = await fetch("/api/join", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, sessionToken, lat, lng }),
  });
  if (!res.ok) throw new Error(`join failed: ${res.status}`);
}

export async function poll(
  id: string,
  sessionToken: string,
): Promise<PollResponse> {
  const res = await fetch(`/api/poll?id=${encodeURIComponent(id)}`, {
    cache: "no-store",
    headers: { "X-Pulse-Session": sessionToken },
  });
  if (res.status === 410) throw new PresenceExpiredError();
  if (!res.ok) throw new Error(`poll failed: ${res.status}`);
  return res.json();
}

export async function sendSignal(
  fromId: string,
  sessionToken: string,
  toId: string,
  type: SignalType,
  payload?: string,
): Promise<void> {
  const res = await fetch("/api/signal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fromId, sessionToken, toId, type, payload }),
  });
  if (!res.ok) throw new Error(`signal failed: ${res.status}`);
}

// Fire-and-forget leave that survives the tab closing.
export function leave(id: string, sessionToken: string): void {
  const body = JSON.stringify({ id, sessionToken });
  if (
    typeof navigator !== "undefined" &&
    navigator.sendBeacon?.(
      "/api/leave",
      new Blob([body], { type: "application/json" }),
    )
  ) {
    return;
  }
  void fetch("/api/leave", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  });
}
