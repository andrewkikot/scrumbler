-- Read-only watch link. A volatile default is evaluated per row, so every
-- existing room gets its own token, and code deployed before this migration
-- (which never sets the column) can keep creating rooms. Additive only: nothing
-- running today reads or writes any column below.
ALTER TABLE "Room" ADD COLUMN "watchToken" TEXT NOT NULL DEFAULT replace((gen_random_uuid())::text, '-'::text, ''::text);
CREATE UNIQUE INDEX "Room_watchToken_key" ON "Room"("watchToken");

-- Discussion timer.
ALTER TABLE "Room" ADD COLUMN "allowAnyoneToTime" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Room" ADD COLUMN "timerEndsAt" TIMESTAMP(3);
ALTER TABLE "Room" ADD COLUMN "timerPausedMs" INTEGER;
ALTER TABLE "Room" ADD COLUMN "timerDurationMs" INTEGER;
ALTER TABLE "Room" ADD COLUMN "timerLabel" TEXT;
