-- Inventory entries now carry per-copy detail (applied stickers/charms, paint
-- float, seed, inspect payload) and stickered or float-bearing copies stand
-- alone instead of merging into their plain namesakes. Old snapshots lack all
-- of it and use the old grouping, so the detail view would open empty for any
-- profile served from one. They cost one read each to rebuild — and reads now
-- survive Steam throttling via the steamapis fallback, so a clear no longer
-- risks the stampede that the earlier ones caused.
DELETE FROM inventory_snapshots;
