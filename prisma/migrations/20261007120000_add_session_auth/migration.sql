-- Presence is deliberately transient, so invalidate active sessions while
-- introducing credentials instead of creating unusable secrets for old rows.
DELETE FROM "Signal";
DELETE FROM "Presence";

ALTER TABLE "Presence" ADD COLUMN "sessionHash" TEXT NOT NULL;
