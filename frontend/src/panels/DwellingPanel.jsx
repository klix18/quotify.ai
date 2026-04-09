import {
  DWELLING_POLICY_FIELDS,
  DWELLING_CLIENT_FIELDS,
  DWELLING_AGENT_FIELDS,
  DWELLING_PROPERTY_INFO_FIELDS,
  DWELLING_COVERAGE_FIELDS,
  DWELLING_LOSS_SETTLEMENT_OPTIONS,
  DWELLING_NA_FIELDS,
  DWELLING_DEDUCTIBLE_FIELDS_V1,
  DWELLING_DEDUCTIBLE_FIELDS_V2,
  DWELLING_PAYMENT_PLAN_TYPES,
  DWELLING_PAYMENT_PLAN_FIELDS,
  POLICY_FORM_OPTIONS,
  CONSTRUCTION_TYPE_OPTIONS,
} from "../configs/dwellingConfig";

export default function DwellingPanel({
  form,
  isLoading,
  isParsed,
  manualFields,
  confidenceMap,
  onFieldChange,
  onPropertyChange,
  onAddProperty,
  onRemoveProperty,
  onPaymentPlanChange,
  FieldControl,
  SectionCard,
  SubCard,
  SmallActionButton,
  SmallGhostButton,
  EmptyHint,
  COLORS,
}) {
  /* ── helpers ─────────────────────────────────────────────────── */
  const fp = (path) => ({
    isLoading,
    isFinal: isParsed && !manualFields[path],
    isManuallyEdited: !!manualFields[path],
    confidence: confidenceMap?.[path] ?? null,
  });

  const gridRow = { display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 14 };
  const cell3 = { gridColumn: "span 3", minWidth: 0 };
  const cell4 = { gridColumn: "span 4", minWidth: 0 };
  const cell6 = { gridColumn: "span 6", minWidth: 0 };

  /* ============================================================
     SECTION 1 — Dwelling Policy
     ============================================================ */
  const policySection = (
    <SectionCard title="Dwelling Policy">
      <div style={gridRow}>
        {DWELLING_POLICY_FIELDS.map(([key, label]) => (
          <div key={key} style={cell3}>
            <FieldControl
              fieldKey={key}
              label={label}
              value={form[key] || ""}
              onChange={onFieldChange}
              {...fp(key)}
            />
          </div>
        ))}
        <div style={{ gridColumn: "span 12", minWidth: 0 }}>
          <FieldControl
            fieldKey="why_selected"
            label="Why This Plan Was Selected"
            value={form.why_selected || ""}
            onChange={onFieldChange}
            multiline
            rows={4}
            {...fp("why_selected")}
          />
        </div>
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 1b — Client Information
     ============================================================ */
  const clientSection = (
    <SectionCard title="Client Information">
      <div style={gridRow}>
        {DWELLING_CLIENT_FIELDS.map(([key, label]) => (
          <div key={key} style={cell3}>
            <FieldControl
              fieldKey={key}
              label={label}
              value={form[key] || ""}
              onChange={onFieldChange}
              {...fp(key)}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 2 — Advisor Information
     ============================================================ */
  const agentSection = (
    <SectionCard title="Advisor Information">
      <div style={gridRow}>
        {DWELLING_AGENT_FIELDS.map(([key, label]) => (
          <div key={key} style={cell3}>
            <FieldControl
              fieldKey={key}
              label={label}
              value={form[key] || ""}
              onChange={onFieldChange}
              isAgentField
              {...fp(key)}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 3 — Property Details (repeatable)
     ============================================================ */
  const propertiesSection = (
    <SectionCard
      title={`Property Details (${form.properties.length})`}
      action={
        <SmallActionButton onClick={onAddProperty}>
          + Add Property
        </SmallActionButton>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        {form.properties.length === 0 ? (
          <EmptyHint text="No properties added yet." />
        ) : (
          form.properties.map((prop, pi) => {
            const pp = (field) => `properties.${pi}.${field}`;
            const propFp = (field) => fp(pp(field));

            return (
              <SubCard
                key={pi}
                title={`Property ${pi + 1}`}
                action={
                  form.properties.length > 1 ? (
                    <SmallGhostButton onClick={() => onRemoveProperty(pi)}>
                      Remove
                    </SmallGhostButton>
                  ) : null
                }
              >
                {/* Dwelling Info */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.black, marginBottom: 10 }}>
                    Dwelling Information
                  </div>
                  <div style={gridRow}>
                    <div style={cell4}>
                      <FieldControl
                        fieldKey={pp("property_address")}
                        label="Property Address"
                        value={prop.property_address || ""}
                        onChange={(k, v) => onPropertyChange(pi, "property_address", v)}
                        {...propFp("property_address")}
                      />
                    </div>
                    <div style={cell4}>
                      <FieldControl
                        fieldKey={pp("year_built")}
                        label="Year Built"
                        value={prop.year_built || ""}
                        onChange={(k, v) => onPropertyChange(pi, "year_built", v)}
                        {...propFp("year_built")}
                      />
                    </div>
                    <div style={cell4}>
                      <FieldControl
                        fieldKey={pp("construction_type")}
                        label="Construction Type"
                        value={prop.construction_type || ""}
                        onChange={(k, v) => onPropertyChange(pi, "construction_type", v)}
                        selectOptions={CONSTRUCTION_TYPE_OPTIONS}
                        {...propFp("construction_type")}
                      />
                    </div>
                    <div style={cell4}>
                      <FieldControl
                        fieldKey={pp("roof_year")}
                        label="Roof Year"
                        value={prop.roof_year || ""}
                        onChange={(k, v) => onPropertyChange(pi, "roof_year", v)}
                        {...propFp("roof_year")}
                      />
                    </div>
                    <div style={cell4}>
                      <FieldControl
                        fieldKey={pp("occupancy")}
                        label="Occupancy"
                        value={prop.occupancy || ""}
                        onChange={(k, v) => onPropertyChange(pi, "occupancy", v)}
                        {...propFp("occupancy")}
                      />
                    </div>
                    <div style={cell4}>
                      <FieldControl
                        fieldKey={pp("policy_form")}
                        label="Policy Form"
                        value={prop.policy_form || ""}
                        onChange={(k, v) => onPropertyChange(pi, "policy_form", v)}
                        selectOptions={POLICY_FORM_OPTIONS}
                        {...propFp("policy_form")}
                      />
                    </div>
                  </div>
                </div>

                {/* Coverages */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.black, marginBottom: 10 }}>
                    Coverages
                  </div>
                  <div style={gridRow}>
                    {DWELLING_COVERAGE_FIELDS.map(([key, label]) => {
                      const isSettlement = key === "dwelling_loss_settlement" || key === "personal_property_loss_settlement";
                      return (
                        <div key={key} style={cell4}>
                          <FieldControl
                            fieldKey={pp(key)}
                            label={label}
                            value={prop[key] || ""}
                            onChange={(k, v) => onPropertyChange(pi, key, v)}
                            selectOptions={isSettlement ? DWELLING_LOSS_SETTLEMENT_OPTIONS : null}
                            {...propFp(key)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Deductible */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.black, marginBottom: 10 }}>
                    Deductible
                  </div>

                  {/* Type 1: AOP + Wind/Hail */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: COLORS.black, marginBottom: 6, opacity: 0.65 }}>
                      Type 1
                    </div>
                    <div style={gridRow}>
                      {DWELLING_DEDUCTIBLE_FIELDS_V1.map(([key, label]) => (
                        <div key={key} style={cell3}>
                          <FieldControl
                            fieldKey={pp(key)}
                            label={label}
                            value={prop[key] || ""}
                            onChange={(k, v) => onPropertyChange(pi, key, v)}
                            {...propFp(key)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Type 2: Deductible (w/h included) */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: COLORS.black, marginBottom: 6, opacity: 0.65 }}>
                      Type 2
                    </div>
                    <div style={gridRow}>
                      {DWELLING_DEDUCTIBLE_FIELDS_V2.map(([key, label]) => (
                        <div key={key} style={cell3}>
                          <FieldControl
                            fieldKey={pp(key)}
                            label={label}
                            value={prop[key] || ""}
                            onChange={(k, v) => onPropertyChange(pi, key, v)}
                            {...propFp(key)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </SubCard>
            );
          })
        )}
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 5 — Payment Plans
     ============================================================ */
  const paymentSection = (
    <SectionCard title="Payment Plans">
      <div style={{ display: "grid", gap: 12 }}>
        {DWELLING_PAYMENT_PLAN_TYPES.map(([planKey, planLabel]) => {
          const plan = form.payment_plans?.[planKey] || {};
          return (
            <SubCard key={planKey} title={planLabel}>
              <div style={gridRow}>
                {DWELLING_PAYMENT_PLAN_FIELDS.map(([field, label]) => (
                  <div key={field} style={cell4}>
                    <FieldControl
                      fieldKey={`payment_plans.${planKey}.${field}`}
                      label={label}
                      value={plan[field] || ""}
                      onChange={(k, v) => onPaymentPlanChange(planKey, field, v)}
                      {...fp(`payment_plans.${planKey}.${field}`)}
                    />
                  </div>
                ))}
              </div>
            </SubCard>
          );
        })}
      </div>
    </SectionCard>
  );

  /* ── render ──────────────────────────────────────────────────── */
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {policySection}
      {clientSection}
      {agentSection}
      {propertiesSection}
      {paymentSection}
    </div>
  );
}
