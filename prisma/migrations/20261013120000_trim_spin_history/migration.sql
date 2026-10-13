-- One-off cleanup: keep only the newest 8 spins per room (SPIN_HISTORY_LIMIT).
-- From here on the spin route prunes on write, so this never needs repeating.
DELETE FROM "Spin"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "roomId" ORDER BY "createdAt" DESC) AS rn
    FROM "Spin"
  ) ranked
  WHERE rn > 8
);
