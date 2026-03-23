export const AUTO_POLICY_HEADER_FIELDS = [
  ["named_insured", "Named Insured"],
  ["mailing_address", "Mailing Address"],
  ["phone_number", "Phone Number"],
  ["quote_effective_date", "Quote Effective Date"],
  ["quote_expiration_date", "Quote Expiration Date"],
  ["policy_term", "Policy Term"],
];

export const AUTO_POLICY_LABEL_MAP = Object.fromEntries(AUTO_POLICY_HEADER_FIELDS);

export const AUTO_PREMIUM_SUMMARY_FIELDS = [
  ["policy_level_subtotal", "Policy-Level Subtotal"],
  ["term_premium_total", "Term Premium Total"],
  ["policy_fees", "Policy / New Business Fees"],
  ["total_cost", "Total Cost"],
  ["pay_in_full_premium", "Pay-in-Full Premium"],
  ["paid_in_full_discount_amount", "Paid-in-Full Discount Amount"],
  ["monthly_installment_amount", "Monthly Installment Amount"],
  ["down_payment_amount", "Down Payment Amount"],
  ["number_of_remaining_installments", "Remaining Installments"],
  ["installment_fee_standard", "Installment Fee Standard"],
  ["installment_fee_eft", "Installment Fee EFT"],
];

export const AUTO_PREMIUM_LABEL_MAP = Object.fromEntries(AUTO_PREMIUM_SUMMARY_FIELDS);

export const emptyDriver = () => ({
  driver_name: "",
  license_state: "",
});

export const emptyCoverage = (coverage_name = "") => ({
  coverage_name,
  limit: "",
  deductible: "",
  premium: "",
  status: "",
});

export const emptyVehicle = () => ({
  year_make_model: "",
  vin: "",
  garaging_zip_county: "",
  lienholder_loss_payee: "",
  vehicle_subtotal: "",
  vehicle_discounts: [],
  coverages: [
    emptyCoverage("Bodily Injury Liability"),
    emptyCoverage("Property Damage Liability"),
    emptyCoverage("Medical Payments"),
    emptyCoverage("Uninsured / Underinsured Motorist BI"),
    emptyCoverage("Uninsured Motorist Property Damage"),
    emptyCoverage("Comprehensive / Other Than Collision"),
    emptyCoverage("Collision"),
    emptyCoverage("Rental / Transportation Expenses"),
    emptyCoverage("Towing & Labor / Roadside Assistance"),
  ],
});

export const EMPTY_AUTO_FORM = {
  named_insured: "",
  mailing_address: "",
  phone_number: "",
  quote_effective_date: "",
  quote_expiration_date: "",
  policy_term: "",
  drivers: [],
  vehicles: [],
  policy_level_coverages: [],
  premium_summary: {
    policy_level_subtotal: "",
    term_premium_total: "",
    policy_fees: "",
    total_cost: "",
    pay_in_full_premium: "",
    paid_in_full_discount_amount: "",
    monthly_installment_amount: "",
    down_payment_amount: "",
    number_of_remaining_installments: "",
    installment_fee_standard: "",
    installment_fee_eft: "",
  },
  discounts: {
    policy_level: [],
    vehicle_level: [],
    available_not_applied: [],
  },
  agent_name: "",
  agent_address: "",
  agent_phone: "",
  agent_email: "",
};