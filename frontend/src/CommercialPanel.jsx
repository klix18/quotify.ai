import {
  COMMERCIAL_POLICY_FIELDS,
  COMMERCIAL_CLIENT_FIELDS,
  COMMERCIAL_AGENT_FIELDS,
  COMMERCIAL_PROPERTY_COVERAGE_FIELDS,
  GL_COVERAGE_FIELDS,
  WC_COVERAGE_FIELDS,
  WC_CLASS_CODE_FIELDS,
  EXCESS_COVERAGE_FIELDS,
  CYBER_COVERAGE_FIELDS,
} from "./commercialConfig";

export default function CommercialPanel({
  form,
  isLoading,
  isParsed,
  manualFields,
  confidenceMap,
  onFieldChange,
  onWcClassCodeChange,
  onAddWcClassCode,
  onRemoveWcClassCode,
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

  /* helper: render a coverage section with rows of N (4 per row default, remainder fills wider) */
  const renderCoverageSection = (title, coverageFields, { perRow = 4 } = {}) => {
    const span = perRow === 2 ? cell6 : cell3;
    return (
      <SectionCard title={title}>
        <div style={gridRow}>
          {coverageFields.map(([key, label]) => (
            <div key={key} style={span}>
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
  };

  /* ============================================================
     SECTION 1 — Commercial Policy
     ============================================================ */
  const policySection = (
    <SectionCard title="Commercial Policy">
      <div style={gridRow}>
        {COMMERCIAL_POLICY_FIELDS.map(([key, label]) => (
          <div key={key} style={cell4}>
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
     SECTION 1b — Client Information
     ============================================================ */
  const clientSection = (
    <SectionCard title="Client Information">
      <div style={gridRow}>
        {COMMERCIAL_CLIENT_FIELDS.map(([key, label]) => (
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
        {COMMERCIAL_AGENT_FIELDS.map(([key, label]) => (
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
     SECTION 3 — Commercial Property
     ============================================================ */
  const commercialPropertySection = renderCoverageSection(
    "Commercial Property",
    COMMERCIAL_PROPERTY_COVERAGE_FIELDS,
  );

  /* ============================================================
     SECTION 4 — General Liability
     ============================================================ */
  const generalLiabilitySection = renderCoverageSection(
    "General Liability",
    GL_COVERAGE_FIELDS,
  );

  /* ============================================================
     SECTION 5 — Workers' Compensation
     ============================================================ */
  const wcClassCodes = form.wc_class_codes || [];

  const workersCompSection = (
    <SectionCard title="Workers' Compensation">
      {/* Coverage limits */}
      <div style={{ marginBottom: 16 }}>
        <div style={gridRow}>
          {WC_COVERAGE_FIELDS.map(([key, label]) => (
            <div key={key} style={cell4}>
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
      </div>

      {/* Repeatable Class Code subsections */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.black }}>
            Class Codes ({wcClassCodes.length})
          </div>
          <SmallActionButton onClick={onAddWcClassCode}>
            + Add Class Code
          </SmallActionButton>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          {wcClassCodes.length === 0 ? (
            <EmptyHint text="No class codes added yet." />
          ) : (
            wcClassCodes.map((cc, ci) => (
              <SubCard
                key={ci}
                title={`Class Code ${ci + 1}`}
                action={
                  wcClassCodes.length > 1 ? (
                    <SmallGhostButton onClick={() => onRemoveWcClassCode(ci)}>
                      Remove
                    </SmallGhostButton>
                  ) : null
                }
              >
                <div style={gridRow}>
                  {WC_CLASS_CODE_FIELDS.map(([fk, fl]) => (
                    <div key={fk} style={cell3}>
                      <FieldControl
                        fieldKey={`wc_class_codes.${ci}.${fk}`}
                        label={fl}
                        value={cc[fk] || ""}
                        onChange={(k, v) => onWcClassCodeChange(ci, fk, v)}
                        {...fp(`wc_class_codes.${ci}.${fk}`)}
                      />
                    </div>
                  ))}
                </div>
              </SubCard>
            ))
          )}
        </div>
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 6 — Excess / Umbrella Liability
     ============================================================ */
  const excessLiabilitySection = renderCoverageSection(
    "Excess / Umbrella Liability",
    EXCESS_COVERAGE_FIELDS,
    { perRow: 2 },
  );

  /* ============================================================
     SECTION 7 — Cyber Liability
     ============================================================ */
  const cyberSection = renderCoverageSection(
    "Cyber Liability",
    CYBER_COVERAGE_FIELDS,
  );

  /* ── render ──────────────────────────────────────────────────── */
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {policySection}
      {clientSection}
      {agentSection}
      {commercialPropertySection}
      {generalLiabilitySection}
      {workersCompSection}
      {excessLiabilitySection}
      {cyberSection}
    </div>
  );
}
