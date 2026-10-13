-- One-off cleanup: keep only the newest 10 rounds per room (ROUND_HISTORY_LIMIT).
-- Their votes go with them via the Vote_roundId_fkey cascade. From here on the
-- round route prunes on write, so this never needs repeating.
DELETE FROM "Round"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "roomId" ORDER BY "number" DESC) AS rn
    FROM "Round"
  ) ranked
  WHERE rn > 10
);
