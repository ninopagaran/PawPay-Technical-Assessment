import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { STALE_MS } from "@/lib/presence";

type CountRow = { count: number };

function inserted(rows: CountRow[]): boolean {
  return rows[0]?.count === 1;
}

// Every helper is one PostgreSQL statement. The row locks serialize competing
// requests while the data-changing CTE keeps state changes + mailbox delivery
// atomic without relying on an interactive transaction over the pooler.
export async function createConnectionRequest(
  fromId: string,
  toId: string,
): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - STALE_MS);
  const rows = await prisma.$queryRaw<CountRow[]>`
    WITH locked AS (
      SELECT "id", "busy", "peerId"
      FROM "Presence"
      WHERE "id" IN (${fromId}, ${toId})
        AND "lastSeen" >= ${staleCutoff}
      FOR UPDATE
    ), ready AS (
      SELECT COUNT(*) = 2
        AND BOOL_AND(NOT "busy" AND "peerId" IS NULL) AS ok
      FROM locked
    ), updated AS (
      UPDATE "Presence"
      SET
        "busy" = true,
        "peerId" = CASE WHEN "id" = ${fromId} THEN ${toId} ELSE ${fromId} END,
        "connectionState" = 'pending',
        "isInitiator" = ("id" = ${fromId})
      WHERE "id" IN (${fromId}, ${toId})
        AND COALESCE((SELECT ok FROM ready), false)
      RETURNING "id"
    ), inserted AS (
      INSERT INTO "Signal" ("id", "toId", "fromId", "type", "payload", "createdAt")
      SELECT ${randomUUID()}, ${toId}, ${fromId}, 'request', NULL, NOW()
      WHERE (SELECT COUNT(*) FROM updated) = 2
      RETURNING "id"
    )
    SELECT COUNT(*)::int AS count FROM inserted
  `;

  return inserted(rows);
}

// Delete stale rows and release any active counterpart in one statement. The
// DELETE ... RETURNING values are the current row values after lock waiting,
// so a connection created during cleanup cannot be missed by an earlier
// JavaScript snapshot.
export async function reapStalePresences(staleCutoff: Date): Promise<void> {
  await prisma.$executeRaw`
    WITH stale AS MATERIALIZED (
      DELETE FROM "Presence"
      WHERE "lastSeen" < ${staleCutoff}
      RETURNING "id", "peerId"
    ), interrupted AS MATERIALIZED (
      SELECT stale."id" AS "fromId", stale."peerId" AS "toId"
      FROM stale
      WHERE stale."peerId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stale AS counterpart
          WHERE counterpart."id" = stale."peerId"
        )
    ), released AS (
      UPDATE "Presence" AS peer
      SET
        "busy" = false,
        "peerId" = NULL,
        "connectionState" = NULL,
        "isInitiator" = false
      FROM interrupted
      WHERE peer."id" = interrupted."toId"
        AND peer."peerId" = interrupted."fromId"
      RETURNING interrupted."fromId", interrupted."toId"
    )
    INSERT INTO "Signal" (
      "id", "toId", "fromId", "type", "payload", "createdAt"
    )
    SELECT
      gen_random_uuid()::text,
      released."toId",
      released."fromId",
      'end',
      NULL,
      NOW()
    FROM released
  `;
}

export async function acceptConnectionRequest(
  fromId: string,
  toId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    WITH locked AS (
      SELECT "id", "peerId", "connectionState", "isInitiator"
      FROM "Presence"
      WHERE "id" IN (${fromId}, ${toId})
      FOR UPDATE
    ), ready AS (
      SELECT COUNT(*) = 2 AND BOOL_AND(
        ("id" = ${fromId} AND "peerId" = ${toId}
          AND "connectionState" = 'pending' AND NOT "isInitiator")
        OR
        ("id" = ${toId} AND "peerId" = ${fromId}
          AND "connectionState" = 'pending' AND "isInitiator")
      ) AS ok
      FROM locked
    ), updated AS (
      UPDATE "Presence"
      SET "connectionState" = 'connected'
      WHERE "id" IN (${fromId}, ${toId})
        AND COALESCE((SELECT ok FROM ready), false)
      RETURNING "id"
    ), inserted AS (
      INSERT INTO "Signal" ("id", "toId", "fromId", "type", "payload", "createdAt")
      SELECT ${randomUUID()}, ${toId}, ${fromId}, 'accept', NULL, NOW()
      WHERE (SELECT COUNT(*) FROM updated) = 2
      RETURNING "id"
    )
    SELECT COUNT(*)::int AS count FROM inserted
  `;

  return inserted(rows);
}

export async function declineConnectionRequest(
  fromId: string,
  toId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    WITH locked AS (
      SELECT "id", "peerId", "connectionState", "isInitiator"
      FROM "Presence"
      WHERE "id" IN (${fromId}, ${toId})
      FOR UPDATE
    ), ready AS (
      SELECT COUNT(*) = 2 AND BOOL_AND(
        ("id" = ${fromId} AND "peerId" = ${toId}
          AND "connectionState" = 'pending' AND NOT "isInitiator")
        OR
        ("id" = ${toId} AND "peerId" = ${fromId}
          AND "connectionState" = 'pending' AND "isInitiator")
      ) AS ok
      FROM locked
    ), updated AS (
      UPDATE "Presence"
      SET "busy" = false, "peerId" = NULL, "connectionState" = NULL,
        "isInitiator" = false
      WHERE "id" IN (${fromId}, ${toId})
        AND COALESCE((SELECT ok FROM ready), false)
      RETURNING "id"
    ), inserted AS (
      INSERT INTO "Signal" ("id", "toId", "fromId", "type", "payload", "createdAt")
      SELECT ${randomUUID()}, ${toId}, ${fromId}, 'decline', NULL, NOW()
      WHERE (SELECT COUNT(*) FROM updated) = 2
      RETURNING "id"
    )
    SELECT COUNT(*)::int AS count FROM inserted
  `;

  return inserted(rows);
}

export async function endConnection(
  fromId: string,
  toId: string,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    WITH locked AS (
      SELECT "id", "peerId", "connectionState"
      FROM "Presence"
      WHERE "id" IN (${fromId}, ${toId})
      FOR UPDATE
    ), ready AS (
      SELECT COUNT(*) = 2 AND BOOL_AND(
        ("id" = ${fromId} AND "peerId" = ${toId}
          AND "connectionState" IN ('pending', 'connected'))
        OR
        ("id" = ${toId} AND "peerId" = ${fromId}
          AND "connectionState" IN ('pending', 'connected'))
      ) AS ok
      FROM locked
    ), updated AS (
      UPDATE "Presence"
      SET "busy" = false, "peerId" = NULL, "connectionState" = NULL,
        "isInitiator" = false
      WHERE "id" IN (${fromId}, ${toId})
        AND COALESCE((SELECT ok FROM ready), false)
      RETURNING "id"
    ), inserted AS (
      INSERT INTO "Signal" ("id", "toId", "fromId", "type", "payload", "createdAt")
      SELECT ${randomUUID()}, ${toId}, ${fromId}, 'end', NULL, NOW()
      WHERE (SELECT COUNT(*) FROM updated) = 2
      RETURNING "id"
    )
    SELECT COUNT(*)::int AS count FROM inserted
  `;

  return inserted(rows);
}

export async function relayConnectedSignal(
  fromId: string,
  toId: string,
  type: "offer" | "answer" | "ice",
  payload: string | null,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<CountRow[]>`
    WITH locked AS (
      SELECT "id", "peerId", "connectionState"
      FROM "Presence"
      WHERE "id" IN (${fromId}, ${toId})
      FOR SHARE
    ), ready AS (
      SELECT COUNT(*) = 2 AND BOOL_AND(
        ("id" = ${fromId} AND "peerId" = ${toId}
          AND "connectionState" = 'connected')
        OR
        ("id" = ${toId} AND "peerId" = ${fromId}
          AND "connectionState" = 'connected')
      ) AS ok
      FROM locked
    ), inserted AS (
      INSERT INTO "Signal" ("id", "toId", "fromId", "type", "payload", "createdAt")
      SELECT ${randomUUID()}, ${toId}, ${fromId}, ${type}, ${payload}, NOW()
      WHERE COALESCE((SELECT ok FROM ready), false)
      RETURNING "id"
    )
    SELECT COUNT(*)::int AS count FROM inserted
  `;

  return inserted(rows);
}
