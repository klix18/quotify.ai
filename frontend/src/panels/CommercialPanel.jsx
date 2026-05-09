import React from "react";
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
  WIND_COVERAGE_FIELDS,
  WIND_BUYDOWN_FIELDS,
} from "../configs/commercialConfig";

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
  onWindFile,
  windParsing,
  windParseStatus,
  windFileName,
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

  /* helper: render a coverage section where every row fills full 12-col width */
  const renderCoverageSection = (title, coverageFields, { perRow = 4 } = {}) => {
    const defaultSpan = 12 / perRow; // 3 for perRow=4, 6 for perRow=2
    const total = coverageFields.length;
    const remainder = total % perRow;

    return (
      <SectionCard title={title}>
        <div style={gridRow}>
          {coverageFields.map(([key, label], i) => {
            // For last-row fields when they don't fill a complete row, expand them
            let span = defaultSpan;
            if (remainder > 0 && i >= total - remainder) {
              span = 12 / remainder;
            }
            return (
              <div key={key} style={{ gridColumn: `span ${span}`, minWidth: 0 }}>
                <FieldControl
                  fieldKey={key}
                  label={label}
                  value={form[key] || ""}
                  onChange={onFieldChange}
                  {...fp(key)}
                />
              </div>
            );
          })}
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

  /* ============================================================
     SECTION 8 — Wind Insurance (toggle sub-sections)
     ============================================================ */
  const [showWindCoverage, setShowWindCoverage] = React.useState(
    () => WIND_COVERAGE_FIELDS.some(([k]) => !!form[k])
  );
  const [showWindBuydown, setShowWindBuydown] = React.useState(
    () => WIND_BUYDOWN_FIELDS.some(([k]) => !!form[k])
  );

  const windFileRef = React.useRef(null);

  const windSection = (
    <SectionCard title="Wind Insurance">
      {/* Toggle buttons */}
      <div style={{ display: "flex", gap: 10, marginBottom: showWindCoverage || showWindBuydown ? 14 : 0 }}>
        <button
          type="button"
          onClick={() => setShowWindCoverage(true)}
          disabled={showWindCoverage}
          style={{
            border: `1px solid ${COLORS.blue}`,
            background: showWindCoverage ? COLORS.blue : COLORS.blueSoft,
            color: showWindCoverage ? "#fff" : COLORS.blue,
            borderRadius: 999,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            cursor: showWindCoverage ? "default" : "pointer",
            fontFamily: "Poppins, sans-serif",
            transition: "all 200ms ease",
          }}
        >
          {showWindCoverage ? "✓ Wind Coverage" : "+ Wind Coverage"}
        </button>

        <button
          type="button"
          onClick={() => setShowWindBuydown(true)}
          disabled={showWindBuydown}
          style={{
            border: `1px solid ${COLORS.blue}`,
            background: showWindBuydown ? COLORS.blue : COLORS.blueSoft,
            color: showWindBuydown ? "#fff" : COLORS.blue,
            borderRadius: 999,
            padding: "8px 12px",
            fontSize: 12,
            fontWeight: 700,
            cursor: showWindBuydown ? "default" : "pointer",
            fontFamily: "Poppins, sans-serif",
            transition: "all 200ms ease",
          }}
        >
          {showWindBuydown ? "✓ Wind Buydown" : "+ Wind Buydown"}
        </button>
      </div>

      {/* Compact inline wind PDF dropbox */}
      {(showWindCoverage || showWindBuydown) && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file && file.type === "application/pdf") onWindFile?.(file);
          }}
          style={{
            borderRadius: 10,
            border: `1.5px dashed ${COLORS.borderStrong}`,
            background: COLORS.white,
            padding: "10px 14px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.blue, lineHeight: 1.3 }}>
              {windParsing
                ? (windParseStatus || "Parsing...")
                : windFileName
                  ? windFileName
                  : "Upload wind PDF (optional)"}
            </div>
            <div style={{ fontSize: 11, color: COLORS.mutedText, lineHeight: 1.3, marginTop: 2 }}>
              Drag & drop or browse to parse wind fields
            </div>
          </div>
          <input
            ref={windFileRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onWindFile?.(file);
            }}
          />
          <button
            type="button"
            disabled={windParsing}
            onClick={() => windFileRef.current?.click()}
            style={{
              flexShrink: 0,
              border: `1px solid ${COLORS.borderGrey}`,
              background: COLORS.lightGrey,
              color: COLORS.blue,
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 11,
              fontWeight: 600,
              fontFamily: "Poppins, sans-serif",
              cursor: windParsing ? "not-allowed" : "pointer",
              transition: "all 150ms ease",
            }}
          >
            {windParsing ? "Parsing..." : "Browse"}
          </button>
        </div>
      )}

      {/* Wind Coverage fields */}
      {showWindCoverage && (
        <div style={{ marginBottom: showWindBuydown ? 18 : 0 }}>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 12,
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.black }}>
              Wind Coverage
            </div>
            <SmallGhostButton onClick={() => setShowWindCoverage(false)}>
              Remove
            </SmallGhostButton>
          </div>
          <div style={gridRow}>
            {WIND_COVERAGE_FIELDS.map(([key, label]) => (
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
        </div>
      )}

      {/* Wind Buydown fields */}
      {showWindBuydown && (
        <div>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            marginBottom: 12,
          }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.black }}>
              Wind Buydown
            </div>
            <SmallGhostButton onClick={() => setShowWindBuydown(false)}>
              Remove
            </SmallGhostButton>
          </div>
          <div style={gridRow}>
            {WIND_BUYDOWN_FIELDS.map(([key, label]) => (
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
      )}
    </SectionCard>
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
      {windSection}
    </div>
  );
}
