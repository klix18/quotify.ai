# skill_updater

Self-improving parser loop. Reads events with manual field corrections, figures
out which corrections represent parser misses (the value WAS in the original
PDF, the parser dropped it), proposes edits to the relevant
`backend/parsers/skills/parse_<type>/SKILL.md`, and lets you review/approve them
before they're applied.

This folder is **fully isolated** from `backend/`. It depends on the live
Postgres (for `analytics_events` + `pdf_documents`) and the SKILL.md files on
disk. It does NOT import any backend Python.

## Quick start

```bash
cd skill_updater
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Reuse the backend's .env (same DATABASE_URL + GEMINI_API_KEY)
cp ../backend/.env .env
# Or fill in .env.example manually

# One-time DB setup
python -c "import asyncio, db; asyncio.run(db.init_schema())"

# Launch the UI
streamlit run app.py
```

## How it works

1. **Click "Run analysis"** in the UI → for every `analytics_events` row
   with `manually_changed_fields` set and not yet analyzed, the pipeline:
   - Loads the original (uploaded) PDF and the generated PDF from `pdf_documents`
   - Calls Gemini Flash on the generated PDF: "for each of these code names,
     what's the display label and final value?"
   - Calls Gemini Flash on the original PDF: "for each (label, value) pair,
     find it in the document; quote the surrounding text; report the actual
     label used in the original."
   - Writes a per-event finding JSON to `findings/<event_id>.json` and a
     row in `skill_event_analysis` (the cursor — stops re-processing).
2. **Per insurance type**, the synthesizer aggregates findings and calls
   Gemini Pro: "given these N parser misses and the current SKILL.md, propose
   the smallest set of edits that would catch them. Output the full revised
   SKILL.md."
3. **Review in the UI** — one collapsible per insurance type, side-by-side
   diff, edit textarea, approve/decline.
4. **Approve** → snapshots current SKILL.md to `skill_history`, writes the
   proposed text to disk. Commit through git when satisfied.

## File layout

| Path | Role |
|---|---|
| `migrations/001_skill_updater.sql` | DDL for the four tables |
| `db.py` | Async Postgres queries |
| `skill_io.py` | Read/write SKILL.md + history snapshots |
| `analyzer.py` | Per-event vision calls |
| `synthesizer.py` | Per-insurance-type consolidation call |
| `pipeline.py` | Orchestrator (called from UI) |
| `app.py` | Streamlit UI |
| `prompts/*.md` | LLM prompts (edit-friendly) |
| `findings/<event_id>.json` | Cached per-event findings (gitignored) |

## Models

- Analyzer: `gemini-2.5-flash` (vision; ~$0.0005/event) — needs `GEMINI_API_KEY`
- Synthesizer: `gpt-5` (reasoning; ~$0.05/proposal) — needs `OPENAI_API_KEY`

Why split providers: Gemini Flash is the cost-optimal vision model and the
analyzer is a vision/OCR-style task. The synthesizer is a reasoning-heavy
prompt-engineering task where GPT-5 shines; structured output is enforced
via OpenAI's strict `json_schema` response_format, which guarantees the
{rationale, proposed_skill_md} shape.

Total cost for a 100-event backlog: under $5.
