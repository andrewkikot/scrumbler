-- The super admin can disconnect every open tab in a room, or in all rooms.
-- A tab whose session began before "disconnectedAt" stops streaming and
-- pinging until someone in it clicks Reconnect. Seats and votes are untouched.
--
-- Additive and NULL on every existing room: nothing is disconnected until the
-- super admin asks, and code deployed before this column existed ignores it.

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "disconnectedAt" TIMESTAMP(3);
