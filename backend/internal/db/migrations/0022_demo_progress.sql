-- Live progress for a demo parse, so the page can draw a bar that means
-- something instead of a spinner that means "still going".
--
-- phase is the stage the worker is in (downloading | parsing | saving), and
-- progress is that stage's own completion in whole percent. The two are kept
-- separate rather than pre-blended into one number because the stages have
-- very different durations and the display layer is the right place to weigh
-- them — a weighting baked into the database would be wrong the moment the
-- parser got faster.
ALTER TABLE demo_results
    ADD COLUMN IF NOT EXISTS phase    TEXT,
    ADD COLUMN IF NOT EXISTS progress SMALLINT;
