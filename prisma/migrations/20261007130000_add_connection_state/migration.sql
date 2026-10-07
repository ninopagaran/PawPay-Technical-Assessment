ALTER TABLE "Presence"
  ADD COLUMN "peerId" TEXT,
  ADD COLUMN "connectionState" TEXT,
  ADD COLUMN "isInitiator" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Presence_peerId_idx" ON "Presence"("peerId");
