// Template for dev_metrics/local.config.js (which is gitignored).
//
// Setup:
//   1. Copy this file to local.config.js in the same folder.
//   2. Fill in your Railway backend URL and the DEV_METRICS_API_KEY.
//   3. Open viewer.html — fields will be pre-filled.
//
// The viewer falls back to localStorage if this file is absent, so dropping
// a copy of the repo without local.config.js still works (just paste once).
window.QM_DEFAULTS = {
  backendUrl: "https://your-railway-app.up.railway.app",
  apiKey: "YOUR_DEV_METRICS_API_KEY",
};
