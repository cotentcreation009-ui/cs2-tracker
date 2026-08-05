-- The inventory snapshot payload changed shape: it now carries the whole item
-- list rather than the 60 most valuable, and each item records whether it is
-- tradable. Snapshots written under the old shape would drive the panel's new
-- category and priced/unpriced filters over a truncated list — showing "you
-- own 3 knives" to someone who owns nine — and they would survive for up to
-- the full stale window before a refresh corrected them.
--
-- These rows are a cache of public data that costs one Steam read to rebuild,
-- so clearing them is cheaper and more honest than migrating them.
DELETE FROM inventory_snapshots;
