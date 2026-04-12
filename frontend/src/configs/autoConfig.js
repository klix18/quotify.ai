// ─── Section 1: Auto Policy ─────────────────────────────────────
export const AUTO_POLICY_FIELDS = [
  ["policy_term", "Policy Term"],
  ["total_premium", "Total Premium"],
  ["quote_date", "Quote Date"],
  ["quote_effective_date", "Quote Effective Date"],
  ["quote_expiration_date", "Quote Expiration Date"],
];

export const AUTO_POLICY_TERM_OPTIONS = ["6-Month", "12-Month"];

// ─── Section 1b: Client Information ─────────────────────────────
export const AUTO_CLIENT_FIELDS = [
  ["client_name", "Client Name"],
  ["client_address", "Client Address"],
  ["client_email", "Client Email"],
  ["client_phone", "Client Phone"],
];

export const AUTO_CLIENT_FIELD_KEYS = new Set(
  AUTO_CLIENT_FIELDS.map(([k]) => k)
);

// ─── Section 2: Advisor Information ──────────────────────────────
export const AUTO_AGENT_FIELDS = [
  ["agent_name", "Advisor Name"],
  ["agent_address", "Advisor Address"],
  ["agent_phone", "Advisor Phone"],
  ["agent_email", "Advisor Email"],
];

export const AUTO_AGENT_FIELD_KEYS = new Set(
  AUTO_AGENT_FIELDS.map(([k]) => k)
);

// ─── Section 3: Driver Info ──────────────────────────────────────
export const AUTO_DRIVER_FIELDS = [
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

// ─── Section 4: Vehicle Info ─────────────────────────────────────
export const AUTO_VEHICLE_FIELDS = [
  ["year_make_model_trim", "Year / Make / Model / Trim"],
  ["vin", "VIN"],
  ["vehicle_use", "Vehicle Use"],
  ["garaging_zip_county", "Garaging ZIP / County"],
];

export const VEHICLE_COVERAGE_PREMIUM_KEYS = [
  "bi_premium",
  "pd_premium",
  "medpay_premium",
  "um_uim_bi_premium",
  "umpd_premium",
  "comprehensive_premium",
  "collision_premium",
  "rental_premium",
  "towing_premium",
];

export const emptyVehicle = () => ({
  year_make_model_trim: "",
  vin: "",
  vehicle_use: "",
  garaging_zip_county: "",
  coverage_premiums: Object.fromEntries(
    VEHICLE_COVERAGE_PREMIUM_KEYS.map((k) => [k, ""])
  ),
  subtotal: "",
});

// ─── Section 5: Coverages (Policy-Level Limits / Deductibles) ───
export const AUTO_COVERAGE_FIELDS = [
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

// Maps coverage field → per-vehicle premium key (umpd_deductible has no
// separate premium since it is already captured by umpd_limit)
export const AUTO_COVERAGE_PREMIUM_MAP = {
  bi_limit: "bi_premium",
  pd_limit: "pd_premium",
  medpay_limit: "medpay_premium",
  um_uim_bi_limit: "um_uim_bi_premium",
  umpd_limit: "umpd_premium",
  comprehensive_deductible: "comprehensive_premium",
  collision_deductible: "collision_premium",
  rental_limit: "rental_premium",
  towing_limit: "towing_premium",
};

// ─── Section 6: Payment Options ──────────────────────────────────
// Full Pay has its own fields (a single full-pay amount + EFT discount flag).
// Installment plans (Semi-Annual, Quarterly, Monthly, …) show the required
// down payment, the per-installment amount, the number of installments, and
// the EFT/Auto-Pay reduces-fee flag.
export const FULL_PAY_FIELDS = [
  ["full_pay_amount", "Full Pay Amount"],
  ["eft_reduces_fee", "EFT/Auto-Pay Reduces Fee"],
];

export const INSTALLMENT_PLAN_FIELDS = [
  ["down_payment", "Required Down Payment"],
  ["amount_per_installment", "Amount per Installment"],
  ["number_of_installments", "Number of Installments"],
  ["eft_reduces_fee", "EFT/Auto-Pay Reduces Fee"],
];

// Back-compat alias — defaults to installment fields. Anything that
// previously imported PAYMENT_PLAN_FIELDS for non-full-pay plans keeps
// working.
export const PAYMENT_PLAN_FIELDS = INSTALLMENT_PLAN_FIELDS;

export const PAYMENT_PLANS = [
  ["full_pay", "Full Pay"],
  ["semi_annual", "Semi-Annual"],
  ["quarterly", "Quarterly"],
  ["monthly", "Monthly"],
];

// Returns the field list to render for a given payment plan key.
export const fieldsForPaymentPlan = (planKey) =>
  planKey === "full_pay" ? FULL_PAY_FIELDS : INSTALLMENT_PLAN_FIELDS;

export const PAID_IN_FULL_DISCOUNT_FIELDS = [
  ["gross_premium", "Gross Premium (Before Discount)"],
  ["discount_amount", "Discount Amount"],
  ["net_pay_in_full", "Net Pay-in-Full Total"],
];

const emptyFullPayPlan = () => ({
  full_pay_amount: "",
  eft_reduces_fee: "",
});

const emptyInstallmentPlan = () => ({
  down_payment: "",
  amount_per_installment: "",
  number_of_installments: "",
  eft_reduces_fee: "",
});

// ─── Complete Empty Form ─────────────────────────────────────────
export const EMPTY_AUTO_FORM = {
  // Why This Plan Was Selected (AI-generated, editable)
  why_selected: "",

  // S1: Auto Policy
  quote_date: "",
  quote_effective_date: "",
  quote_expiration_date: "",
  policy_term: "",
  total_premium: "",
  // S1b: Client Information
  client_name: "",
  client_address: "",
  client_email: "",
  client_phone: "",

  // S2: Agent Information
  agent_name: "",
  agent_address: "",
  agent_phone: "",
  agent_email: "",

  // S3: Drivers
  drivers: [],

  // S4: Vehicles
  vehicles: [],

  // S5: Coverages
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

  // S6: Payment Options
  payment_options: {
    full_pay: emptyFullPayPlan(),
    semi_annual: emptyInstallmentPlan(),
    quarterly: emptyInstallmentPlan(),
    monthly: emptyInstallmentPlan(),
    show_paid_in_full_discount: false,
    paid_in_full_discount: {
      gross_premium: "",
      discount_amount: "",
      net_pay_in_full: "",
    },
  },

};
