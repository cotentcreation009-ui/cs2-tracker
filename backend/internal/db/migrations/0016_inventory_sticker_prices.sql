-- Applied stickers now carry their own market price (they are market items in
-- their own right — "Sticker | MICHU | London 2018" is in the same price feed
-- as the guns). Snapshots from before this don't have the field, and stickered
-- items are exactly the ones people open — so rebuild rather than show crafts
-- with unvalued stickers for the next six hours. One fallback-carried read per
-- profile.
DELETE FROM inventory_snapshots;
