import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionTokenMatches } from "@/lib/session-auth";
import {
  acceptConnectionRequest,
  createConnectionRequest,
  declineConnectionRequest,
  endConnection,
  relayConnectedSignal,
} from "@/lib/signal-state";
import type { SignalType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

const MAX_PAYLOAD = 64 * 1024; // SDP/ICE are small; cap to be safe.

// POST /api/signal — body { fromId, sessionToken, toId, type, payload? }
// Drops one message into the recipient's mailbox. Also manages the `busy`
// flag so a user can only be in one connection at a time.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { fromId, sessionToken, toId, type, payload } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (
    typeof fromId !== "string" ||
    typeof toId !== "string" ||
    fromId === toId
  ) {
    return Response.json({ error: "invalid ids" }, { status: 400 });
  }

  const sender = await prisma.presence.findUnique({
    where: { id: fromId },
    select: { sessionHash: true, busy: true, peerId: true },
  });
  if (!sender) {
    return Response.json({ error: "presence expired" }, { status: 410 });
  }
  if (!sessionTokenMatches(sender.sessionHash, sessionToken)) {
    return Response.json({ error: "invalid session" }, { status: 401 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }
  if (
    payload !== undefined &&
    payload !== null &&
    (typeof payload !== "string" || payload.length > MAX_PAYLOAD)
  ) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }

  const signalType = type as SignalType;
  const payloadStr = typeof payload === "string" ? payload : null;

  if (signalType === "request") {
    if (sender.busy || sender.peerId) {
      return Response.json({ error: "sender unavailable" }, { status: 409 });
    }
    if (!(await createConnectionRequest(fromId, toId))) {
      await sendDecline(toId, fromId);
      return Response.json({ ok: true, autoDeclined: true });
    }
    return Response.json({ ok: true });
  }

  let delivered = false;
  switch (signalType) {
    case "accept":
      delivered = await acceptConnectionRequest(fromId, toId);
      break;
    case "decline":
      delivered = await declineConnectionRequest(fromId, toId);
      break;
    case "end":
      delivered = await endConnection(fromId, toId);
      break;
    case "offer":
    case "answer":
    case "ice":
      delivered = await relayConnectedSignal(
        fromId,
        toId,
        signalType,
        payloadStr,
      );
      break;
  }

  if (!delivered) {
    return Response.json(
      { error: "signal not allowed in current connection state" },
      { status: 409 },
    );
  }

  return Response.json({ ok: true });
}

// Helper: deliver an auto-decline from `target` back to `initiator`.
async function sendDecline(targetId: string, initiatorId: string) {
  await prisma.signal.create({
    data: { fromId: targetId, toId: initiatorId, type: "decline", payload: null },
  });
}
