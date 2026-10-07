import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import {
  hashSessionToken,
  isValidSessionToken,
  sessionTokenMatches,
} from "@/lib/session-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/join — body { id, sessionToken, lat, lng } (raw coords).
// Applies a 1–3 km privacy offset and upserts the presence row. Raw
// coordinates are never stored.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { id, sessionToken, lat, lng } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof id !== "string" || id.length < 8 || id.length > 64) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!isValidSessionToken(sessionToken)) {
    return Response.json({ error: "invalid session token" }, { status: 400 });
  }
  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const offset = applyPrivacyOffset(lat as number, lng as number);
  const existing = await prisma.presence.findUnique({
    where: { id },
    select: { sessionHash: true },
  });

  if (existing && !sessionTokenMatches(existing.sessionHash, sessionToken)) {
    return Response.json({ error: "invalid session" }, { status: 401 });
  }

  await prisma.presence.upsert({
    where: { id },
    create: {
      id,
      sessionHash: hashSessionToken(sessionToken),
      lat: offset.lat,
      lng: offset.lng,
      busy: false,
      lastSeen: new Date(),
    },
    update: {
      lat: offset.lat,
      lng: offset.lng,
      lastSeen: new Date(),
    },
  });

  return Response.json({ ok: true });
}
