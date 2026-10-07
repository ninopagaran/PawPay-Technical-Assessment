import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hasOnlyKeys,
  isValidSessionId,
  jsonBodyError,
  readJsonObject,
} from "@/lib/api-security";
import { rateLimit } from "@/lib/rate-limit";
import { isValidSessionToken, sessionTokenMatches } from "@/lib/session-auth";
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

const MAX_SIGNAL_BODY_BYTES = 72 * 1_024;
const MAX_SDP_BYTES = 64 * 1_024;
const MAX_ICE_BYTES = 8 * 1_024;
const SIGNAL_LIMIT_PER_MINUTE = 180;

const VALID_TYPES: SignalType[] = [
  "request",
  "accept",
  "decline",
  "offer",
  "answer",
  "ice",
  "end",
];

// POST /api/signal — body { fromId, sessionToken, toId, type, payload? }
// Drops one message into the recipient's mailbox. Also manages the `busy`
// flag so a user can only be in one connection at a time.
export async function POST(request: NextRequest) {
  const parsed = await readJsonObject(request, MAX_SIGNAL_BODY_BYTES);
  if (!parsed.ok) return jsonBodyError(parsed);
  if (
    !hasOnlyKeys(
      parsed.value,
      ["fromId", "sessionToken", "toId", "type"],
      ["payload"],
    )
  ) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { fromId, sessionToken, toId, type, payload } = parsed.value;

  if (
    !isValidSessionId(fromId) ||
    !isValidSessionId(toId) ||
    fromId === toId
  ) {
    return Response.json({ error: "invalid ids" }, { status: 400 });
  }
  if (!isValidSessionToken(sessionToken)) {
    return Response.json({ error: "invalid session" }, { status: 401 });
  }
  if (typeof type !== "string" || !VALID_TYPES.includes(type as SignalType)) {
    return Response.json({ error: "invalid type" }, { status: 400 });
  }

  const signalType = type as SignalType;
  if (!isValidPayload(signalType, payload)) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
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

  const limited = await rateLimit(
    request,
    `signal:${fromId}`,
    SIGNAL_LIMIT_PER_MINUTE,
  );
  if (limited) return limited;

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

function isValidPayload(type: SignalType, payload: unknown): boolean {
  if (
    type === "request" ||
    type === "accept" ||
    type === "decline" ||
    type === "end"
  ) {
    return payload === undefined || payload === null;
  }
  if (typeof payload !== "string") return false;

  const maxBytes = type === "ice" ? MAX_ICE_BYTES : MAX_SDP_BYTES;
  if (Buffer.byteLength(payload, "utf8") > maxBytes) return false;

  try {
    const value: unknown = JSON.parse(payload);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }
    const object = value as Record<string, unknown>;

    if (type === "offer" || type === "answer") {
      return (
        hasOnlyKeys(object, ["type", "sdp"]) &&
        object.type === type &&
        typeof object.sdp === "string"
      );
    }

    return (
      hasOnlyKeys(object, ["candidate"], [
        "sdpMid",
        "sdpMLineIndex",
        "usernameFragment",
      ]) &&
      typeof object.candidate === "string" &&
      (object.sdpMid === undefined ||
        object.sdpMid === null ||
        typeof object.sdpMid === "string") &&
      (object.sdpMLineIndex === undefined ||
        object.sdpMLineIndex === null ||
        (typeof object.sdpMLineIndex === "number" &&
          Number.isInteger(object.sdpMLineIndex) &&
          object.sdpMLineIndex >= 0)) &&
      (object.usernameFragment === undefined ||
        object.usernameFragment === null ||
        typeof object.usernameFragment === "string")
    );
  } catch {
    return false;
  }
}
