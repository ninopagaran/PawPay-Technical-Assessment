import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isValidSessionId, sameOriginError } from "@/lib/api-security";
import { STALE_MS, SIGNAL_TTL_MS } from "@/lib/presence";
import { rateLimit } from "@/lib/rate-limit";
import { isValidSessionToken, sessionTokenMatches } from "@/lib/session-auth";
import { reapStalePresences } from "@/lib/signal-state";
import type { PollResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POLL_LIMIT_PER_MINUTE = 60;

// GET /api/poll?id= — the single endpoint that drives the live map.
// It (1) heartbeats the caller, (2) reaps stale presence + orphan signals,
// (3) returns the filtered online peers, and (4) drains this user's mailbox.
export async function GET(request: NextRequest) {
  const crossOrigin = sameOriginError(request);
  if (crossOrigin) return crossOrigin;

  const params = request.nextUrl.searchParams;
  const id = params.get("id");
  const sessionToken = request.headers.get("x-pulse-session");

  if (
    !isValidSessionId(id) ||
    params.getAll("id").length !== 1 ||
    [...params.keys()].some((key) => key !== "id")
  ) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!isValidSessionToken(sessionToken)) {
    return Response.json({ error: "invalid session" }, { status: 401 });
  }

  const presence = await prisma.presence.findUnique({
    where: { id },
    select: { sessionHash: true },
  });
  if (!presence) {
    return Response.json({ error: "presence expired" }, { status: 410 });
  }
  if (!sessionTokenMatches(presence.sessionHash, sessionToken)) {
    return Response.json({ error: "invalid session" }, { status: 401 });
  }

  const limited = await rateLimit(
    request,
    `poll:${id}`,
    POLL_LIMIT_PER_MINUTE,
  );
  if (limited) return limited;

  const now = Date.now();
  const staleCutoff = new Date(now - STALE_MS);
  const signalCutoff = new Date(now - SIGNAL_TTL_MS);

  // 1) Heartbeat — refresh lastSeen for the caller.
  const heartbeat = await prisma.presence.updateMany({
    where: { id, sessionHash: presence.sessionHash },
    data: { lastSeen: new Date(now) },
  });
  if (heartbeat.count === 0) {
    return Response.json({ error: "presence expired" }, { status: 410 });
  }

  // 2) Reap stale presence rows, release their server-recorded peers, and
  // deliver an end signal so an active counterpart resets immediately.
  await reapStalePresences(staleCutoff);
  await prisma.signal.deleteMany({ where: { createdAt: { lt: signalCutoff } } });

  // 3) Online peers, excluding self.
  const peers = await prisma.presence.findMany({
    where: {
      id: { not: id },
      lastSeen: { gte: staleCutoff },
    },
    select: { id: true, lat: true, lng: true, busy: true },
  });

  // 4) Drain this user's mailbox: read, then delete exactly what we read so a
  // concurrently-inserted signal is never lost.
  const inbox = await prisma.signal.findMany({
    where: { toId: id },
    orderBy: { createdAt: "asc" },
  });
  if (inbox.length > 0) {
    await prisma.signal.deleteMany({
      where: { id: { in: inbox.map((s) => s.id) } },
    });
  }

  const response: PollResponse = {
    peers: peers.map((p) => ({
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      busy: p.busy,
    })),
    signals: inbox.map((s) => ({
      id: s.id,
      fromId: s.fromId,
      toId: s.toId,
      type: s.type as PollResponse["signals"][number]["type"],
      payload: s.payload,
      createdAt: s.createdAt.toISOString(),
    })),
  };

  return Response.json(response);
}
