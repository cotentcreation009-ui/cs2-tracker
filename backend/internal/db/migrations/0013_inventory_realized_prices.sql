-- Item prices now come from the median of real Skinport sales wherever an item
-- sells often enough for a median to mean something, instead of always using
-- Skinport's suggested price. Snapshots written under the old basis hold the
-- old figures, so the same profile would show a different total depending only
-- on when it was last read, with nothing on screen to explain the difference.
--
-- Clearing costs one Steam read per profile and makes every displayed value
-- come from the same method.
DELETE FROM inventory_snapshots;
