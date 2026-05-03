-- Run in Turso dashboard SQL shell to free up space.
-- Safe: only drops data that's outside the dashboard's lookback windows.
-- Run each block separately so you can see how many rows each prunes.

-- 1. sync_runs (we write 1 row every 2 min per account → ~720/day).
--    Banner only needs the last failed run, so 7 days is plenty.
DELETE FROM sync_runs
WHERE finished_at < (strftime('%s', 'now', '-7 days') * 1000);

-- 2. daily_metrics older than 365 days (Executive's max range is "Last 6mo" = 180d).
--    Keeps a year of history, drops anything past that.
DELETE FROM daily_metrics
WHERE date < date('now', '-365 days');

-- 3. alerts older than 90 days (resolved/dismissed long ago).
DELETE FROM alerts
WHERE created_at < (strftime('%s', 'now', '-90 days') * 1000);

-- 4. Reclaim the freed space (SQLite/libSQL doesn't return it to the OS until VACUUM).
VACUUM;

-- After running, check sizes:
SELECT 'daily_metrics' AS tbl, COUNT(*) AS rows FROM daily_metrics
UNION ALL SELECT 'sync_runs', COUNT(*) FROM sync_runs
UNION ALL SELECT 'alerts', COUNT(*) FROM alerts
UNION ALL SELECT 'ads', COUNT(*) FROM ads;
