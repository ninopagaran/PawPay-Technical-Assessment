import "server-only";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

type RateLimitRow = { count: number; expiresAt: Date };

function clientAddress(request: Request): string {
  const forwarded =
    request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip");
  return forwarded?.split(",", 1)[0]?.trim() || "unknown";
}

export async function rateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowSeconds = 60,
): Promise<Response | null> {
  const addressHash = createHash("sha256")
    .update(clientAddress(request))
    .digest("hex");
  const key = `${scope}:${addressHash}`;

  const rows = await prisma.$queryRaw<RateLimitRow[]>`
    WITH pruned AS (
      DELETE FROM "RateLimit"
      WHERE "key" <> ${key}
        AND "expiresAt" < NOW() - INTERVAL '5 minutes'
    ), consumed AS (
      INSERT INTO "RateLimit" ("key", "count", "expiresAt")
      VALUES (${key}, 1, NOW() + (${windowSeconds} * INTERVAL '1 second'))
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE
          WHEN "RateLimit"."expiresAt" <= NOW() THEN 1
          ELSE LEAST("RateLimit"."count" + 1, ${limit + 1})
        END,
        "expiresAt" = CASE
          WHEN "RateLimit"."expiresAt" <= NOW()
            THEN NOW() + (${windowSeconds} * INTERVAL '1 second')
          ELSE "RateLimit"."expiresAt"
        END
      RETURNING "count", "expiresAt"
    )
    SELECT "count", "expiresAt" FROM consumed
  `;

  const result = rows[0];
  if (!result || result.count <= limit) return null;

  const retryAfter = Math.max(
    1,
    Math.ceil((result.expiresAt.getTime() - Date.now()) / 1_000),
  );
  return Response.json(
    { error: "too many requests" },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(retryAfter),
      },
    },
  );
}
