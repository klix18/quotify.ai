// ─── Bundle = Homeowners + Auto combined ─────────────────────────

// ─── Section 1: Bundle Policy ────────────────────────────────────
export const BUNDLE_POLICY_FIELDS = [
  ["bundle_total_premium", "Total Premium (Home + Auto)"],
  ["home_premium", "Homeowners Premium"],
  ["auto_premium", "Auto Premium"],
];

// ─── Section 1b: Client Information ──────────────────────────────
export const BUNDLE_CLIENT_FIELDS = [
  ["client_name", "Client Name"],
  ["client_address", "Client Address"],
  ["client_email", "Client Email"],
  ["client_phone", "Client Phone"],
];

export const BUNDLE_CLIENT_FIELD_KEYS = new Set(
  BUNDLE_CLIENT_FIELDS.map(([k]) => k)
);

// ─── Section 2: Advisor Information ──────────────────────────────
export const BUNDLE_AGENT_FIELDS = [
  ["agent_name", "Advisor Name"],
  ["agent_address", "Advisor Address"],
  ["agent_phone", "Advisor Phone"],
  ["agent_email", "Advisor Email"],
];

export const BUNDLE_AGENT_FIELD_KEYS = new Set(
  BUNDLE_AGENT_FIELDS.map(([k]) => k)
);

// ═══════════════════════════════════════════════════════════════════
// HOMEOWNERS SECTION
// ═══════════════════════════════════════════════════════════════════

export const BUNDLE_HOMEOWNERS_COVERAGE_FIELDS = [
  ["dwelling", "Dwelling"],
  ["other_structures", "Other Structures"],
  ["personal_property", "Personal Property"],
  ["loss_of_use", "Loss of Use"],
  ["personal_liability", "Personal Liability"],
  ["medical_payments", "Medical Payments"],
  ["replacement_cost_on_contents", "Replacement Cost on Contents"],
  ["25_extended_replacement_cost", "25% Ext Replacement Cost"],
  ["all_perils_deductible", "All Perils Deductible"],
  ["wind_hail_deductible", "Wind / Hail Deductible"],
  ["water_and_sewer_backup", "Water and Sewer Backup"],
];

export const BUNDLE_HOMEOWNERS_YES_NO_FIELDS = new Set([
  "replacement_cost_on_contents",
  "25_extended_replacement_cost",
]);

// ═══════════════════════════════════════════════════════════════════
// AUTO SECTION
// ═══════════════════════════════════════════════════════════════════

// Auto Policy details (dates, term, program — no premiums here)
export const BUNDLE_AUTO_POLICY_FIELDS = [
  ["auto_quote_date", "Quote Date / Print Date"],
  ["auto_quote_effective_date", "Quote Effective Date"],
  ["auto_quote_expiration_date", "Quote Expiration Date"],
  ["auto_policy_term", "Policy Term"],
  ["auto_program", "Program"],
  ["auto_paid_in_full_discount", "Paid-in-Full Discount"],
  ["auto_total_pay_in_full", "Total Pay-in-Full (After Discount)"],
];

export const AUTO_POLICY_TERM_OPTIONS = ["6-Month", "12-Month"];

// ─── Drivers ─────────────────────────────────────────────────────
export const BUNDLE_AUTO_DRIVER_FIELDS = [
  ["driver_name", "Driver Name"],
  ["gender", "Gender"],
  ["marital_status", "Marital Status"],
  ["license_state", "License State"],
];

export const DRIVER_GENDER_OPTIONS = ["Male", "Female"];

export const emptyDriver = () => ({
  driver_name: "",
  gender: "",
  marital_status: "",
  license_state: "",
});

// ─── Vehicles ────────────────────────────────────────────────────
export const BUNDLE_AUTO_VEHICLE_FIELDS = [
  ["year_make_model_trim", "Year / Make / Model / Trim"],
  ["vin", "VIN"],
  ["vehicle_use", "Vehicle Use"],
  ["garaging_zip_county", "Garaging ZIP / County"],
];

export const emptyVehicle = () => ({
  year_make_model_trim: "",
  vin: "",
  vehicle_use: "",
  garaging_zip_county: "",
  coverage_premiums: {
    bi_premium: "",
    pd_premium: "",
    medpay_premium: "",
    um_uim_bi_premium: "",
    umpd_premium: "",
    comprehensive_premium: "",
    collision_premium: "",
    rental_premium: "",
    towing_premium: "",
  },
  subtotal: "",
});

// ─── Auto Coverages ──────────────────────────────────────────────
export const BUNDLE_AUTO_COVERAGE_FIELDS = [
  ["bi_limit", "Bodily Injury (BI) Limit"],
  ["pd_limit", "Property Damage (PD) Limit"],
  ["medpay_limit", "Medical Payments (MedPay) Limit"],
  ["um_uim_bi_limit", "UM/UIM Bodily Injury Limit"],
  ["umpd_limit", "Uninsured Motorist PD (UMPD) Limit"],
  ["umpd_deductible", "UMPD Deductible"],
  ["comprehensive_deductible", "Comprehensive Deductible"],
  ["collision_deductible", "Collision Deductible"],
  ["rental_limit", "Rental / Transportation Limit"],
  ["towing_limit", "Towing & Labor / Roadside Limit"],
];

// ─── Auto Payment Options ────────────────────────────────────────
export const BUNDLE_PAYMENT_PLAN_FIELDS = [
  ["down_payment", "Required Down Payment"],
  ["amount_per_installment", "Amount per Installment"],
  ["eft_reduces_fee", "EFT/Auto-Pay Reduces Fee"],
];

export const BUNDLE_PAYMENT_PLANS = [
  ["full_pay", "Full Pay"],
  ["semi_annual", "Semi-Annual"],
  ["quarterly", "Quarterly"],
  ["monthly", "Monthly"],
];

export const BUNDLE_PAID_IN_FULL_DISCOUNT_FIELDS = [
  ["gross_premium", "Gross Premium (Before Discount)"],
  ["discount_amount", "Discount Amount"],
  ["net_pay_in_full", "Net Pay-in-Full Total"],
];

const emptyPaymentPlan = () => ({
  down_payment: "",
  amount_per_installment: "",
  eft_reduces_fee: "",
});

// ─── Complete Empty Form ─────────────────────────────────────────
export const EMPTY_BUNDLE_FORM = {
  // Why This Plan Was Selected (AI-generated, editable)
  why_selected: "",

  // S1: Bundle Policy
  bundle_total_premium: "",
  home_premium: "",
  auto_premium: "",

  // S1b: Client Information
  client_name: "",
  client_address: "",
  client_email: "",
  client_phone: "",

  // S2: Advisor Information
  agent_name: "",
  agent_address: "",
  agent_phone: "",
  agent_email: "",

  // ── Homeowners Coverages ──
  dwelling: "",
  other_structures: "",
  personal_property: "",
  loss_of_use: "",
  personal_liability: "",
  medical_payments: "",
  replacement_cost_on_contents: "",
  "25_extended_replacement_cost": "",
  all_perils_deductible: "",
  wind_hail_deductible: "",
  water_and_sewer_backup: "",

  // ── Auto Policy Details ──
  auto_quote_date: "",
  auto_quote_effective_date: "",
  auto_quote_expiration_date: "",
  auto_policy_term: "",
  auto_program: "",
  auto_paid_in_full_discount: "",
  auto_total_pay_in_full: "",

  // ── Auto Drivers ──
  drivers: [],

  // ── Auto Vehicles ──
  vehicles: [],

  // ── Auto Coverages ──
  coverages: {
    bi_limit: "",
    pd_limit: "",
    medpay_limit: "",
    um_uim_bi_limit: "",
    umpd_limit: "",
    umpd_deductible: "",
    comprehensive_deductible: "",
    collision_deductible: "",
    rental_limit: "",
    towing_limit: "",
  },

  // ── Auto Payment Options ──
  payment_options: {
    full_pay: emptyPaymentPlan(),
    semi_annual: emptyPaymentPlan(),
    quarterly: emptyPaymentPlan(),
    monthly: emptyPaymentPlan(),
    show_paid_in_full_discount: false,
    paid_in_full_discount: {
      gross_premium: "",
      discount_amount: "",
      net_pay_in_full: "",
    },
  },
};
