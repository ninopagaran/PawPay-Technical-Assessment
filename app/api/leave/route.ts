import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sessionTokenMatches } from "@/lib/session-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/leave — body { id, sessionToken, peerId? }. Removes the presence row and any
// pending signals to/from this user. If they were connecting to a peer, release
// and notify that peer too. Called via navigator.sendBeacon on tab close, so the
// body may arrive as text — parse defensively.
export async function POST(request: NextRequest) {
  let id: string | undefined;
  let sessionToken: string | undefined;
  let peerId: string | undefined;
  try {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    id = typeof body.id === "string" ? body.id : undefined;
    sessionToken =
      typeof body.sessionToken === "string" ? body.sessionToken : undefined;
    peerId = typeof body.peerId === "string" ? body.peerId : undefined;
  } catch {
    id = undefined;
  }

  if (typeof id !== "string" || !id) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }

  const presence = await prisma.presence.findUnique({
    where: { id },
    select: { sessionHash: true },
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

  if (peerId && peerId !== id) {
    await prisma.presence.updateMany({
      where: { id: peerId },
      data: { busy: false },
    });
    await prisma.signal.create({
      data: { fromId: id, toId: peerId, type: "end", payload: null },
    });
  }

  return Response.json({ ok: true });
}
