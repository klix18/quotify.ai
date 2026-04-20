/**
 * Analytics event tracker.
 * Sends workflow events to the backend for admin dashboard tracking.
 * Fires asynchronously — never blocks the main UI flow.
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

/**
 * Track a complete workflow event.
 * @param {Object} params
 * @param {string} params.userName - Clerk first + last name
 * @param {string} params.insuranceType - e.g. "homeowners", "auto"
 * @param {string} params.advisor - selected advisor name
 * @param {string} params.uploadedPdf - uploaded PDF filename
 * @param {string} params.manuallyChangedFields - comma-separated field names
 * @param {boolean} params.createdQuote - whether a quote was generated
 * @param {string} params.generatedPdf - generated PDF filename
 * @param {string} params.clientName - client name from the form
 * @param {string} params.skillVersion - skill version from parse result (e.g. "1.2")
 * @param {Function} params.getToken - Clerk getToken function
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
    if (!token) return;

    await fetch(`${API_BASE_URL}/api/track-event`, {
      method: "POST",
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
  } catch (err) {
    // Analytics should never break the main app flow
    console.warn("Analytics tracking failed:", err.message);
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
