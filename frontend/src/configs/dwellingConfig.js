// ─── Section 1: Dwelling Policy ─────────────────────────────────
export const DWELLING_POLICY_FIELDS = [
  ["total_premium", "Total Premium"],
  ["quote_date", "Quote Date"],
  ["quote_effective_date", "Quote Effective Date"],
  ["quote_expiration_date", "Quote Expiration Date"],
  ["pay_in_full_discount", "Pay-in-Full Discount"],
  ["total_if_paid_in_full", "Total if Paid in Full"],
];

// ─── Section 1b: Client Information ─────────────────────────────
export const DWELLING_CLIENT_FIELDS = [
  ["named_insured", "Client Name"],
  ["client_address", "Client Address"],
  ["client_email", "Client Email"],
  ["client_phone", "Client Phone"],
];

export const DWELLING_CLIENT_FIELD_KEYS = new Set(
  DWELLING_CLIENT_FIELDS.map(([k]) => k)
);

// ─── Section 2: Advisor Information ─────────────────────────────
export const DWELLING_AGENT_FIELDS = [
  ["agent_name", "Advisor Name"],
  ["agent_address", "Advisor Address"],
  ["agent_phone", "Advisor Phone"],
  ["agent_email", "Advisor Email"],
];

export const DWELLING_AGENT_FIELD_KEYS = new Set(
  DWELLING_AGENT_FIELDS.map(([k]) => k)
);

// ─── Section 3: Property Details (repeatable) ───────────────────

export const DWELLING_PROPERTY_INFO_FIELDS = [
  ["property_address", "Insured Property Address"],
  ["year_built", "Year Built"],
  ["construction_type", "Construction Type"],
  ["roof_year", "Roof Year"],
  ["occupancy", "Occupancy"],
  ["policy_form", "Policy Form"],
];

export const POLICY_FORM_OPTIONS = ["DP1", "DP2", "DP3"];

export const CONSTRUCTION_TYPE_OPTIONS = [
  "Frame",
  "Masonry",
  "Masonry Veneer",
  "Fire Resistive",
  "Superior",
];

export const DWELLING_COVERAGE_FIELDS = [
  ["dwelling_limit", "Dwelling Limit"],
  ["dwelling_loss_settlement", "Dwelling Loss Settlement"],
  ["other_structures_limit", "Other Structures Limit"],
  ["personal_property_limit", "Personal Property Limit"],
  ["personal_property_loss_settlement", "Personal Property Loss Settlement"],
  ["personal_property_premium", "Personal Property Premium"],
  ["fair_rental_value_limit", "Fair Rental Value Limit"],
  ["premises_liability_limit", "Premises Liability Limit"],
  ["premises_liability_premium", "Premises Liability Premium"],
  ["medical_payments_limit", "Medical Payments Limit"],
  ["water_backup_limit", "Water Backup Limit"],
  ["water_backup_premium", "Water Backup Premium"],
  ["ordinance_or_law_limit", "Ordinance or Law Limit"],
  ["extended_replacement_cost", "Extended Replacement Cost"],
];

export const DWELLING_LOSS_SETTLEMENT_OPTIONS = ["RCV", "ACV"];

// Fields that display "N/A" when empty
export const DWELLING_NA_FIELDS = new Set([
  "premises_liability_limit",
  "premises_liability_premium",
  "water_backup_limit",
  "water_backup_premium",
  "ordinance_or_law_limit",
  "extended_replacement_cost",
]);

// ─── Section 4: Deductible ──────────────────────────────────────
// Two deductible row types per property
export const DWELLING_DEDUCTIBLE_FIELDS_V1 = [
  ["aop_deductible", "All Other Perils (AOP)"],
  ["wind_hail_deductible", "Wind / Hail"],
];

export const DWELLING_DEDUCTIBLE_FIELDS_V2 = [
  ["deductible", "Deductible (w/h included)"],
];

// ─── Section 5: Payment Plans (combined for all properties) ─────
export const DWELLING_PAYMENT_PLAN_TYPES = [
  ["full_pay", "Full Pay"],
  ["two_pay", "2-Pay"],
  ["four_pay", "4-Pay"],
  ["monthly", "Monthly"],
];

// Full Pay shows a single full-pay amount + the EFT/Auto-Pay flag.
// Installment plans (2-Pay, 4-Pay, Monthly, …) show the required down
// payment, the per-installment amount, the number of installments, and
// the EFT/Auto-Pay reduces-fee flag.
export const DWELLING_FULL_PAY_FIELDS = [
  ["full_pay_amount", "Full Pay Amount"],
  ["eft_reduces_fee", "EFT/Auto-Pay Reduces Fee"],
];

export const DWELLING_INSTALLMENT_PLAN_FIELDS = [
  ["down_payment", "Required Down Payment"],
  ["amount_per_installment", "Amount per Installment"],
  ["number_of_installments", "Number of Installments"],
  ["eft_reduces_fee", "EFT/Auto-Pay Reduces Fee"],
];

// Back-compat alias — defaults to installment fields.
export const DWELLING_PAYMENT_PLAN_FIELDS = DWELLING_INSTALLMENT_PLAN_FIELDS;

export const dwellingFieldsForPaymentPlan = (planKey) =>
  planKey === "full_pay"
    ? DWELLING_FULL_PAY_FIELDS
    : DWELLING_INSTALLMENT_PLAN_FIELDS;

// ─── Empty Structures ───────────────────────────────────────────

export const emptyProperty = () => ({
  // Property info
  property_address: "",
  year_built: "",
  construction_type: "",
  roof_year: "",
  occupancy: "",
  policy_form: "",
  // Coverages
  dwelling_limit: "",
  dwelling_loss_settlement: "",
  other_structures_limit: "",
  personal_property_limit: "",
  personal_property_loss_settlement: "",
  personal_property_premium: "",
  fair_rental_value_limit: "",
  premises_liability_limit: "",
  premises_liability_premium: "",
  medical_payments_limit: "",
  water_backup_limit: "",
  water_backup_premium: "",
  ordinance_or_law_limit: "",
  extended_replacement_cost: "",
  // Deductible (both formats)
  aop_deductible: "",
  wind_hail_deductible: "",
  deductible: "",
});

const emptyDwellingFullPayPlan = () => ({
  full_pay_amount: "",
  eft_reduces_fee: "",
});

const emptyDwellingInstallmentPlan = () => ({
  down_payment: "",
  amount_per_installment: "",
  number_of_installments: "",
  eft_reduces_fee: "",
});

export const EMPTY_DWELLING_FORM = {
  // Why This Plan Was Selected (AI-generated, editable)
  why_selected: "",

  // S1: Dwelling Policy
  total_premium: "",
  quote_date: "",
  quote_effective_date: "",
  quote_expiration_date: "",
  pay_in_full_discount: "",
  total_if_paid_in_full: "",

  // S1b: Client Information
  named_insured: "",
  client_address: "",
  client_email: "",
  client_phone: "",

  // S2: Advisor Information
  agent_name: "",
  agent_address: "",
  agent_phone: "",
  agent_email: "",

  // S3: Properties (array — at least 1)
  properties: [],

  // S5: Payment Plans
  payment_plans: {
    full_pay: emptyDwellingFullPayPlan(),
    two_pay: emptyDwellingInstallmentPlan(),
    four_pay: emptyDwellingInstallmentPlan(),
    monthly: emptyDwellingInstallmentPlan(),
  },
};
