// ─── Section 1: Commercial Policy ───────────────────────────────
export const COMMERCIAL_POLICY_FIELDS = [
  ["policy_term", "Policy Term"],
  ["total_premium", "Total Annual Premium"],
  ["additional_premiums_taxes_fees", "Additional Premiums, Taxes & Fees"],
];

// ─── Section 1b: Client Information ─────────────────────────────
export const COMMERCIAL_CLIENT_FIELDS = [
  ["named_insured", "Client Name"],
  ["mailing_address", "Client Address"],
  ["client_email", "Client Email"],
  ["client_phone", "Client Phone"],
];

export const COMMERCIAL_CLIENT_FIELD_KEYS = new Set(
  COMMERCIAL_CLIENT_FIELDS.map(([k]) => k)
);

// ─── Section 2: Advisor Information ─────────────────────────────
export const COMMERCIAL_AGENT_FIELDS = [
  ["agent_name", "Advisor Name"],
  ["agent_address", "Advisor Address"],
  ["agent_phone", "Advisor Phone"],
  ["agent_email", "Advisor Email"],
];

export const COMMERCIAL_AGENT_FIELD_KEYS = new Set(
  COMMERCIAL_AGENT_FIELDS.map(([k]) => k)
);

// ─── Section 3: Commercial Property ─────────────────────────────
export const COMMERCIAL_PROPERTY_COVERAGE_FIELDS = [
  ["building_limit", "Building Limit"],
  ["building_deductible", "Building Deductible"],
  ["bpp_limit", "Business Personal Property Limit"],
  ["bpp_deductible", "BPP Deductible"],
  ["stretch_blanket", "Stretch Blanket"],
  ["business_income", "Business Income"],
  ["business_income_waiting_period", "Waiting Period"],
  ["equipment_breakdown", "Equipment Breakdown"],
  ["back_up_sewers_drains", "Back-up of Sewers & Drains"],
  ["ordinance_or_law", "Ordinance or Law"],
  ["wind_hail_deductible", "Wind/Hail Deductible"],
];

// ─── Section 4: General Liability ───────────────────────────────
export const GL_COVERAGE_FIELDS = [
  ["gl_each_occurrence", "Each Occurrence"],
  ["gl_general_aggregate", "General Aggregate"],
  ["gl_products_completed_ops_aggregate", "Products/Completed Ops Aggregate"],
  ["gl_medical_expenses", "Medical Expenses"],
  ["gl_damage_to_premises_rented", "Damage to Premises Rented to You"],
  ["gl_personal_advertising_injury", "Personal & Advertising Injury"],
];

// ─── Section 5: Workers' Compensation ───────────────────────────
export const WC_COVERAGE_FIELDS = [
  ["wc_bi_accident_each_accident", "BI by Accident – Each Accident"],
  ["wc_bi_disease_policy_limit", "BI by Disease – Policy Limit"],
  ["wc_bi_disease_each_employee", "BI by Disease – Each Employee"],
];

// Repeatable class code subsections
export const WC_CLASS_CODE_FIELDS = [
  ["class_code", "Class Code"],
  ["estimated_annual_remuneration", "Estimated Annual Remuneration"],
  ["rating", "Rating"],
  ["premium", "Premium"],
];

export const emptyWcClassCode = () => ({
  class_code: "",
  estimated_annual_remuneration: "",
  rating: "",
  premium: "",
});

// ─── Section 6: Excess / Umbrella Liability ─────────────────────
export const EXCESS_COVERAGE_FIELDS = [
  ["umbrella_each_occurrence", "Umbrella Each Occurrence"],
  ["umbrella_aggregate", "Umbrella Aggregate"],
];

// ─── Section 7: Cyber Liability ─────────────────────────────────
export const CYBER_COVERAGE_FIELDS = [
  ["cyber_aggregate_limit", "Policy Aggregate Limit"],
  ["cyber_deductible", "Deductible"],
  ["cyber_breach_response", "Breach Response Costs"],
  ["cyber_business_interruption", "Business Interruption"],
  ["cyber_cyber_extortion", "Cyber Extortion"],
  ["cyber_funds_transfer_fraud", "Funds Transfer Fraud"],
  ["cyber_regulatory_defense", "Regulatory Defense & Penalties"],
  ["cyber_media_tech_liability", "Media, Tech, Data & Network Liability"],
];

// ─── Section 8: Wind Insurance ───────────────────────────────────
export const WIND_COVERAGE_FIELDS = [
  ["wind_coverage", "Wind"],
  ["wind_deductible", "Wind Deductible"],
  ["wind_percent_deductible", "Wind % Deductible"],
  ["wind_coverage_premium", "Premium"],
];

export const WIND_BUYDOWN_FIELDS = [
  ["wind_buydown", "Wind Buydown"],
  ["wind_buydown_amount", "Buydown Amount"],
  ["wind_buydown_premium", "Premium"],
];

// ─── Empty Structures ───────────────────────────────────────────

export const EMPTY_COMMERCIAL_FORM = {
  // S1: Commercial Policy
  policy_term: "",
  total_premium: "",
  additional_premiums_taxes_fees: "",

  // S1b: Client Information
  named_insured: "",
  mailing_address: "",
  client_email: "",
  client_phone: "",

  // S2: Advisor Information
  agent_name: "",
  agent_address: "",
  agent_phone: "",
  agent_email: "",

  // S3: Commercial Property
  building_limit: "",
  building_deductible: "",
  bpp_limit: "",
  bpp_deductible: "",
  stretch_blanket: "",
  business_income: "",
  business_income_waiting_period: "",
  equipment_breakdown: "",
  back_up_sewers_drains: "",
  ordinance_or_law: "",
  wind_hail_deductible: "",

  // S4: General Liability
  gl_each_occurrence: "",
  gl_general_aggregate: "",
  gl_products_completed_ops_aggregate: "",
  gl_medical_expenses: "",
  gl_damage_to_premises_rented: "",
  gl_personal_advertising_injury: "",

  // S5: Workers' Compensation
  wc_bi_accident_each_accident: "",
  wc_bi_disease_policy_limit: "",
  wc_bi_disease_each_employee: "",
  wc_class_codes: [],

  // S6: Excess / Umbrella Liability
  umbrella_each_occurrence: "",
  umbrella_aggregate: "",

  // S7: Cyber Liability
  cyber_aggregate_limit: "",
  cyber_deductible: "",
  cyber_breach_response: "",
  cyber_business_interruption: "",
  cyber_cyber_extortion: "",
  cyber_funds_transfer_fraud: "",
  cyber_regulatory_defense: "",
  cyber_media_tech_liability: "",

  // S8: Wind Insurance
  wind_coverage: "",
  wind_deductible: "",
  wind_percent_deductible: "",
  wind_coverage_premium: "",
  wind_buydown: "",
  wind_buydown_amount: "",
  wind_buydown_premium: "",
};
