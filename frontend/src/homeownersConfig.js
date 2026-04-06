export const HOMEOWNERS_FIELDS = [
    ["total_premium", "Total Premium"],
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
    ["client_name", "Client Name"],
    ["client_address", "Client Address"],
    ["client_phone", "Client Phone"],
    ["client_email", "Client Email"],
    ["agent_name", "Advisor Name"],
    ["agent_address", "Advisor Address"],
    ["agent_phone", "Advisor Phone"],
    ["agent_email", "Advisor Email"],
  ];
  
  export const HOMEOWNERS_YES_NO_FIELDS = new Set([
    "replacement_cost_on_contents",
    "25_extended_replacement_cost",
  ]);
  
  export const HOMEOWNERS_AGENT_FIELDS = new Set([
    "agent_name",
    "agent_address",
    "agent_phone",
    "agent_email",
  ]);
  
  export const HOMEOWNERS_CLIENT_FIELDS = new Set([
    "client_name",
    "client_address",
    "client_phone",
    "client_email",
  ]);
  
  export const HOMEOWNERS_LABEL_MAP = Object.fromEntries(HOMEOWNERS_FIELDS);
  
  export const HOMEOWNERS_ROWS = [
    [
      { key: "total_premium", span: 3 },
      { key: "dwelling", span: 3 },
      { key: "other_structures", span: 3 },
      { key: "personal_property", span: 3 },
    ],
    [
      { key: "loss_of_use", span: 3 },
      { key: "personal_liability", span: 3 },
      { key: "medical_payments", span: 3 },
      { key: "all_perils_deductible", span: 3 },
    ],
    [
      { key: "replacement_cost_on_contents", span: 3 },
      { key: "25_extended_replacement_cost", span: 3 },
      { key: "water_and_sewer_backup", span: 3 },
      { key: "wind_hail_deductible", span: 3 },
    ],
    [
      { key: "client_name", span: 3 },
      { key: "client_address", span: 3 },
      { key: "client_phone", span: 3 },
      { key: "client_email", span: 3 },
    ],
    [
      { key: "agent_name", span: 3 },
      { key: "agent_address", span: 3 },
      { key: "agent_phone", span: 3 },
      { key: "agent_email", span: 3 },
    ],
  ];
  
  export const EMPTY_HOMEOWNERS_FORM = {
    ...Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, ""])),
    why_selected: "",
  };