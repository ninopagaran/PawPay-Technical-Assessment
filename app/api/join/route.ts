import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  hasOnlyKeys,
  isValidSessionId,
  jsonBodyError,
  readJsonObject,
  sameOriginError,
} from "@/lib/api-security";
import { applyPrivacyOffset, isValidLatLng } from "@/lib/geo";
import { rateLimit } from "@/lib/rate-limit";
import {
  hashSessionToken,
  isValidSessionToken,
  sessionTokenMatches,
} from "@/lib/session-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_JOIN_BODY_BYTES = 1_024;
const JOIN_LIMIT_PER_MINUTE = 30;

// POST /api/join — body { id, sessionToken, lat, lng } (raw coords).
// Applies a 1–3 km privacy offset and upserts the presence row. Raw
// coordinates are never stored.
export async function POST(request: NextRequest) {
  const crossOrigin = sameOriginError(request);
  if (crossOrigin) return crossOrigin;

  const parsed = await readJsonObject(request, MAX_JOIN_BODY_BYTES);
  if (!parsed.ok) return jsonBodyError(parsed);
  if (!hasOnlyKeys(parsed.value, ["id", "sessionToken", "lat", "lng"])) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const { id, sessionToken, lat, lng } = parsed.value;

  if (!isValidSessionId(id)) {
    return Response.json({ error: "invalid id" }, { status: 400 });
  }
  if (!isValidSessionToken(sessionToken)) {
    return Response.json({ error: "invalid session token" }, { status: 400 });
  }
  if (!isValidLatLng(lat, lng)) {
    return Response.json({ error: "invalid coordinates" }, { status: 400 });
  }

  const limited = await rateLimit(request, "join", JOIN_LIMIT_PER_MINUTE);
  if (limited) return limited;

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
