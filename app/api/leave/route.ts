import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hasOnlyKeys,
  isValidSessionId,
  jsonBodyError,
  readJsonObject,
  sameOriginError,
} from "@/lib/api-security";
import { isValidSessionToken, sessionTokenMatches } from "@/lib/session-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LEAVE_BODY_BYTES = 1_024;

// POST /api/leave — body { id, sessionToken }. Removes the presence row and any
// pending signals to/from this user. The paired peer comes only from trusted
// server state, never from the request. Called via navigator.sendBeacon on tab
// close, using an application/json Blob so the same strict parser can be used.
export async function POST(request: NextRequest) {
  const crossOrigin = sameOriginError(request);
  if (crossOrigin) return crossOrigin;

  const parsed = await readJsonObject(request, MAX_LEAVE_BODY_BYTES);
  if (!parsed.ok) return jsonBodyError(parsed);
  if (!hasOnlyKeys(parsed.value, ["id", "sessionToken"])) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const { id, sessionToken } = parsed.value;

  if (!isValidSessionId(id)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!isValidSessionToken(sessionToken)) {
    return Response.json({ error: "invalid session" }, { status: 401 });
  }

  const presence = await prisma.presence.findUnique({
    where: { id },
    select: { sessionHash: true, peerId: true },
  });
  if (!presence) {
    return Response.json({ ok: true });
  }
  if (!sessionTokenMatches(presence.sessionHash, sessionToken)) {
    return Response.json({ error: "invalid session" }, { status: 401 });
  }

  // Independent cleanup deletes — no atomicity needed (and interactive
  // transactions are unreliable over a PgBouncer pooler).
  await prisma.signal.deleteMany({
    where: { OR: [{ toId: id }, { fromId: id }] },
  });
  await prisma.presence.deleteMany({ where: { id } });

  if (presence.peerId) {
    const released = await prisma.presence.updateMany({
      where: { id: presence.peerId, peerId: id },
      data: {
        busy: false,
        peerId: null,
        connectionState: null,
        isInitiator: false,
      },
    });
    if (released.count > 0) {
      await prisma.signal.create({
        data: {
          fromId: id,
          toId: presence.peerId,
          type: "end",
          payload: null,
        },
      });
    }
  }

  return Response.json({ ok: true });
}
