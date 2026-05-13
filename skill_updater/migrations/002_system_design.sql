-- 002_system_design.sql — ensure analytics_events.system_design exists
--
-- The backend's core/database.init_db() also adds this column with the
-- same `ADD COLUMN IF NOT EXISTS` guard. We add it here too so
-- skill_updater works against a fresh database without requiring the
-- backend to start first. Idempotent — safe to re-run.
--
-- Why skill_updater needs this column:
--   list_unanalyzed_events SELECTs e.system_design and the pipeline
--   dispatches to analyze_event (Design 2 vision) or analyze_event_design3
--   (Design 3 fitz placement) based on its value. The operator picks
--   the design in the UI; events whose system_design doesn't match
--   are skipped with outcome='design_mismatch' so a Design 3 run
--   doesn't waste budget on Design 2 events (and vice-versa).

ALTER TABLE analytics_events
    ADD COLUMN IF NOT EXISTS system_design TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_events_system_design
    ON analytics_events (system_design);
