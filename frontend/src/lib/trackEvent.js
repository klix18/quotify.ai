/**
 * Analytics event tracker.
 * Sends workflow events to the backend for admin dashboard tracking.
 *
 * Failure handling — IMPORTANT:
 *   Callers should `await` this function before letting the browser
 *   navigate or close (e.g. in the PDF download handler). Fire-and-forget
 *   was how we lost Kevin Li's events after a download — the navigation
 *   aborted the in-flight POST before it reached the backend.
 *
 *   This function STILL does not throw on failure so the user's workflow
 *   never breaks, but it now:
 *     1. Waits for the response instead of returning after fetch() starts
 *     2. Logs a loud console.error with status + response body on non-2xx
 *     3. Returns a boolean so callers can log a retry if desired
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/**
 * Track a complete workflow event.
 * @returns {Promise<boolean>} true if the event was accepted by the backend.
 */
export async function trackEvent({
  userName,
  insuranceType,
  advisor = "",
  uploadedPdf = "",
  manuallyChangedFields = "",
  createdQuote = false,
  generatedPdf = "",
  clientName = "",
  skillVersion = "",
  getToken,
}) {
  try {
    const token = await getToken();
    if (!token) {
      console.error("[trackEvent] no Clerk token — event NOT recorded", {
        userName,
        insuranceType,
      });
      return false;
    }

    const resp = await fetch(`${API_BASE_URL}/api/track-event`, {
      method: "POST",
      // keepalive: allow the request to complete even if the user navigates
      // away (e.g. while a PDF download triggers a nav). Caps at ~64KB body,
      // which is plenty for a single tracking event.
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        user_name: userName,
        insurance_type: insuranceType,
        advisor,
        uploaded_pdf: uploadedPdf,
        manually_changed_fields: manuallyChangedFields,
        created_quote: createdQuote,
        generated_pdf: generatedPdf,
        client_name: clientName,
        skill_version: skillVersion,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(
        `[trackEvent] backend rejected event (${resp.status}):`,
        body,
        { userName, insuranceType },
      );
      return false;
    }
    return true;
  } catch (err) {
    // Analytics should never break the main app flow — log loudly so the
    // issue is visible in the browser console, but don't throw.
    console.error("[trackEvent] network/exception failure:", err, {
      userName,
      insuranceType,
    });
    return false;
  }
}

/**
 * Get comma-separated list of manually changed field names.
 * Takes a manual state object like { dwelling: true, loss_of_use: false, ... }
 * Returns string like "dwelling, personal_property"
 */
export function getManualFieldNames(manualState) {
  if (!manualState || typeof manualState !== "object") return "";
  return Object.entries(manualState)
    .filter(([, changed]) => changed === true)
    .map(([key]) => key)
    .join(", ");
}
