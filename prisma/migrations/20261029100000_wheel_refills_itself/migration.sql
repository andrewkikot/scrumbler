-- The rotation refills itself. When a shrinking wheel runs out of names, every
-- name goes straight back on it — the one that just led included. It is the
-- next *draw* that skips them, not the wheel that benches them, so that nobody
-- leads two dailies running across the seam and yet everybody is on the wheel
-- the whole time.
--
-- "wheelHeldOverLabel" is whom that next draw skips. The spin route clears it
-- as it serves it: a hold is exactly one draw long.
--
-- "wheelSettledSpinId" is which draw the roster has already been settled for.
-- The settle route used to know that by asking "is the winner still on the
-- wheel?", which a refill now answers yes to — so without this, the second
-- client to report a rotation-closing draw would drop that winner straight
-- back off the freshly refilled wheel.
--
-- Additive, and NULL on every existing room: a room mid-rotation settles its
-- next draw exactly as it did before.

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "wheelHeldOverLabel" TEXT,
ADD COLUMN     "wheelSettledSpinId" TEXT;
