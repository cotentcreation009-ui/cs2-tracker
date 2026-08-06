-- Skinport prices each Doppler finish separately under one market name, and
-- the price map was built by assigning rows one at a time, so whichever finish
-- happened to land last won. That could value an ordinary Phase 3 knife at a
-- Ruby's price — measured up to 8.8x the median across finishes. Any snapshot
-- written since prices started working carries that error.
--
-- Prices are now the median across finishes, so clear the table and let every
-- profile rebuild against it.
DELETE FROM inventory_snapshots;
