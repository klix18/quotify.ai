/**
 * Developer-only parse/accuracy metrics.
 *
 * Why this exists:
 *   We want to reason about how different LLM orchestration designs affect
 *   parse latency and accuracy. Every parse run posts a "parse" event
 *   (latency + insurance_type) and every quote generation posts a "quote"
 *   event (manual-edit counts + the actual changed field values). Both
 *   rows share a `parse_id` so the viewer can join them.
 *
 * This file is the ONLY place that talks to `/api/dev-metrics/log`. It is
 * completely silent on failure — the dev-metrics POST must never break
 * the user-facing parse/quote flow.
 *
 * Change SYSTEM_DESIGN_VERSION whenever the parsing orchestration is
 * materially altered (model swap, new pass, different prompt strategy,
 * etc.), and add a matching section to dev_metrics/SYSTEM_DESIGN.md so
 * old rows remain interpretable.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/**
 * Tag every row written while the current orchestration is in place.
 * Bump this when the LLM orchestration (models, passes, prompts,
 * fallback chain, skill layer) is changed in a way that could move
 * the latency or accuracy needle. The corresponding entry in
 * dev_metrics/SYSTEM_DESIGN.md documents what the tag represents.
 */
export const SYSTEM_DESIGN_VERSION = "single-pass-cached-2026-04-21";

/**
 * Client-identity field keys across all insurance types. These are
 * excluded from the "non_client_count" metric because they're always
 * user-specific data that can't be extracted reliably from the PDF —
 * they'd otherwise dominate the "manual correction" signal and hide
 * the real accuracy story.
 *
 * Keep this union in sync with configs/*Config.js — every type's
 * client-info block should be represented here.
 */
const CLIENT_INFO_FIELD_KEYS = new Set([
  "client_name",      // homeowners, auto, bundle
  "client_address",   // homeowners, auto, bundle, dwelling
  "client_phone",     // all
  "client_email",     // all
  "named_insured",    // dwelling, commercial
  "mailing_address",  // commercial
]);

// Standards-compliant RFC 4122 v4 UUID generator. crypto.randomUUID()
// exists in every modern browser, but some iOS Safari versions < 15.4
// don't support it — fall back to a Math.random-based implementation
// there so dev-metrics never becomes a source of runtime errors.
export function generateParseId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch (_) {
    // fall through
  }
  // Fallback: RFC 4122 v4-ish. Good enough for dev metrics, never
  // used for security.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Start a parse stopwatch. Call at the very top of each parse function
 * (before any network activity). The returned object is opaque to the
 * caller — pass it to `logParseComplete` when the parse finishes.
 *
 * Returning a closure-with-state (rather than just a number) lets us
 * tack on additional telemetry later without touching the 5 call sites.
 */
export function startParseTimer({ insuranceType, pdfCount = 1 } = {}) {
  return {
    parseId: generateParseId(),
    startedAt:
      typeof performance !== "undefined" && performance.now
        ? performance.now()
        : Date.now(),
    insuranceType: insuranceType || "",
    pdfCount: pdfCount || 1,
    // Set to true by the caller (in the AbortError branch) when the
    // parse was cancelled by the user. logParseComplete skips aborted
    // sessions so the data set isn't polluted with partial-latency rows.
    aborted: false,
    // Set to true by the caller on any non-abort error so we can still
    // record that a parse attempt happened (useful for "how often does
    // this design fail?" analysis) while flagging it as an error row.
    errored: false,
  };
}

/**
 * Fire a "parse" event to /api/dev-metrics/log. Silent on failure.
 *
 * @param {object} session  — the object returned by startParseTimer.
 * @returns {Promise<void>} — always resolves. Awaitable so callers can
 *   run this right before the parse function returns without racing
 *   navigation, but parse functions typically don't navigate, so
 *   fire-and-forget is also fine.
 */
export async function logParseComplete(session) {
  if (!session || !session.parseId) return;
  // Aborted parses don't represent real latency — the user cancelled
  // before the LLM could finish — so skip them to avoid dragging the
  // latency distribution down with partial runs.
  if (session.aborted) return;

  const now =
    typeof performance !== "undefined" && performance.now
      ? performance.now()
      : Date.now();
  const latencyMs = Math.max(0, Math.round(now - session.startedAt));

  const payload = {
    event: "parse",
    parse_id: session.parseId,
    insurance_type: session.insuranceType || "",
    pdf_count: session.pdfCount || 1,
    latency_ms: latencyMs,
    system_design: SYSTEM_DESIGN_VERSION,
  };

  await postSilently(payload);
}

/**
 * Fire a "quote" event. Called from the quote-generation flow, right
 * after the backend returns the filled PDF. Carries the manual-edit
 * counters + the actual values of each changed field (for the viewer
 * to show the user what a tester corrected).
 *
 * @param {object} args
 * @param {string} args.parseId      — parseId from the last parse session
 *                                     (read `session.parseId` and stash it
 *                                     on the form state after the parse
 *                                     completes).
 * @param {string} args.insuranceType
 * @param {object} args.manualMap    — per-field edit state ({ field: true, ... })
 * @param {object} args.formValues   — current form values keyed by field name.
 *                                     Used to snapshot the actual edit values.
 */
export async function logQuoteGenerated({
  parseId,
  insuranceType,
  manualMap,
  formValues,
}) {
  if (!parseId) {
    // No parse_id means the user clicked Generate without a parse (unlikely,
    // but possible if they manually entered every field). Skip the metric
    // rather than writing an orphan row we'll have to filter out later.
    return;
  }

  const changedFields = Object.entries(manualMap || {})
    .filter(([, changed]) => changed === true)
    .map(([key]) => key);

  const manualChanges = changedFields.map((field) => ({
    field,
    value: stringifyFormValue(formValues, field),
  }));

  const allCount = changedFields.length;
  const nonClientCount = changedFields.filter(
    (k) => !CLIENT_INFO_FIELD_KEYS.has(k)
  ).length;

  const payload = {
    event: "quote",
    parse_id: parseId,
    insurance_type: insuranceType || "",
    manual_changes_all_count: allCount,
    manual_changes_non_client_count: nonClientCount,
    manual_changes: manualChanges,
    system_design: SYSTEM_DESIGN_VERSION,
  };

  await postSilently(payload);
}

// ── internals ─────────────────────────────────────────────────────────

async function postSilently(payload) {
  const url = `${API_BASE_URL}/api/dev-metrics/log`;

  // For "quote" events the flow kicks off a file download right after, which
  // can kill any in-flight fetch. sendBeacon is purpose-built for "send this
  // before the page goes away" and survives navigation/downloads reliably.
  // For "parse" events the user stays on the page, so a normal fetch is both
  // more reliable (sendBeacon has a 64KB cap) and lets us log the response.
  const isQuote = payload && payload.event === "quote";

  if (isQuote && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      const ok = navigator.sendBeacon(url, blob);
      if (ok) {
        if (typeof console !== "undefined" && console.debug) {
          console.debug("[devMetrics] sent via beacon:", payload.event);
        }
        return;
      }
      // sendBeacon returned false (queue full, too large, etc.) — fall through
      // to fetch so we still have a chance of landing the row.
    } catch (_) {
      // fall through
    }
  }

  // Parse events and the beacon fallback both come through here.
  // NOTE: no `keepalive: true` here. For parse events the user stays on the
  // page, and Chrome silently deprioritizes/drops keepalive requests under
  // concurrent network load (the parse stream itself is active at this
  // moment), which caused intermittent misses. Plain fetch lands more
  // reliably and — importantly — gives us a response status to log.
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (typeof console !== "undefined" && console.debug) {
      console.debug(
        `[devMetrics] ${payload.event} → ${resp.status} ${resp.ok ? "OK" : "FAIL"}`
      );
    }
    if (!resp.ok && typeof console !== "undefined" && console.warn) {
      // Surface non-2xx so a 500 from a bad payload or DB issue is visible.
      const body = await resp.text().catch(() => "");
      console.warn("[devMetrics] non-OK response:", resp.status, body.slice(0, 200));
    }
  } catch (err) {
    // Completely silent on network failure. Dev metrics are not allowed to
    // break the user flow; the user-facing UI already surfaces parse/quote
    // errors through its own paths.
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[devMetrics] log failed (non-fatal):", err);
    }
  }
}

/**
 * Best-effort string representation of a manual edit's value for the
 * dev viewer. Nested paths (e.g. drivers.0.first_name) are not tracked
 * in the shallow manualMap today, so this only handles flat keys.
 */
function stringifyFormValue(formValues, key) {
  if (!formValues || typeof formValues !== "object") return "";
  const v = formValues[key];
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch (_) {
    return "";
  }
}
