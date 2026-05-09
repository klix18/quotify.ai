-- 002_system_design.sql — ensure analytics_events.system_design exists
--
-- The backend's core/database.init_db() also adds this column with the
-- same `ADD COLUMN IF NOT EXISTS` guard, but we add it here too so
-- skill_updater can be run against a fresh database without requiring
-- the backend to start first. Idempotent — safe to re-run.
--
-- Why skill_updater needs this column:
--   list_unanalyzed_events SELECTs e.system_design and analyze_event
--   dispatches to the Design 2 (vision) or Design 3 (fitz text-vs-text)
--   analyzer based on its value. Empty / unknown values are skipped
--   with outcome='design_unknown'.

ALTER TABLE analytics_events
    ADD COLUMN IF NOT EXISTS system_design TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_events_system_design
    ON analytics_events (system_design);
