-- ── skill_updater tables ──────────────────────────────────────────────
-- Run once against the same Postgres that hosts analytics_events.
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS skill_runs (
    id                UUID PRIMARY KEY,
    started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at       TIMESTAMPTZ,
    events_processed  INTEGER NOT NULL DEFAULT 0,
    events_skipped    INTEGER NOT NULL DEFAULT 0,
    status            TEXT NOT NULL DEFAULT 'running'   -- 'running' | 'completed' | 'failed'
);

-- Cursor: one row per analyzed event. event_id is the PK, so we
-- can't double-process the same event without explicitly clearing it.
CREATE TABLE IF NOT EXISTS skill_event_analysis (
    event_id         BIGINT PRIMARY KEY,                -- FK in spirit to analytics_events.id
    run_id           UUID NOT NULL REFERENCES skill_runs(id) ON DELETE CASCADE,
    insurance_type   TEXT NOT NULL,
    outcome          TEXT NOT NULL,                     -- 'analyzed' | 'no_pdfs' | 'error'
    finding          JSONB,                             -- structured Finding from analyzer.py
    error_message    TEXT,
    analyzed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sea_run_id        ON skill_event_analysis (run_id);
CREATE INDEX IF NOT EXISTS idx_sea_insurance     ON skill_event_analysis (insurance_type);

CREATE TABLE IF NOT EXISTS skill_proposals (
    id                     SERIAL PRIMARY KEY,
    run_id                 UUID NOT NULL REFERENCES skill_runs(id) ON DELETE CASCADE,
    insurance_type         TEXT NOT NULL,
    supporting_event_ids   BIGINT[] NOT NULL DEFAULT '{}',
    current_skill_md       TEXT NOT NULL,               -- full SKILL.md content at proposal time
    proposed_skill_md      TEXT NOT NULL,               -- full revised SKILL.md
    rationale              TEXT NOT NULL DEFAULT '',
    status                 TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'declined' | 'modified'
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at             TIMESTAMPTZ,
    applied_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposal_run        ON skill_proposals (run_id);
CREATE INDEX IF NOT EXISTS idx_proposal_status     ON skill_proposals (status);
CREATE INDEX IF NOT EXISTS idx_proposal_insurance  ON skill_proposals (insurance_type);

CREATE TABLE IF NOT EXISTS skill_history (
    id              SERIAL PRIMARY KEY,
    insurance_type  TEXT NOT NULL,
    skill_md        TEXT NOT NULL,                     -- snapshot of SKILL.md before each apply
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason          TEXT NOT NULL DEFAULT '',          -- 'pre_apply' | 'manual_snapshot'
    proposal_id     INTEGER REFERENCES skill_proposals(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_history_insurance ON skill_history (insurance_type);
