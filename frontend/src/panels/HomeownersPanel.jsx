import {
  HOMEOWNERS_YES_NO_FIELDS,
  HOMEOWNERS_AGENT_FIELDS,
  HOMEOWNERS_CLIENT_FIELDS,
  HOMEOWNERS_LABEL_MAP,
  HOMEOWNERS_ROWS,
} from "../configs/homeownersConfig";

export default function HomeownersPanel({
  form,
  onFieldChange,
  loadingFields,
  finalizedFields,
  manuallyEditedFields,
  confidenceMap,
  FieldControl,
  SectionCard,
}) {
  /* ── helpers ───────────────────────────────────────────────────── */
  const renderRow = (row) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
        gap: 14,
        alignItems: "start",
      }}
    >
      {row.map(({ key, span }) => (
        <div
          key={key}
          style={{
            gridColumn: `span ${span || 3}`,
            minWidth: 0,
          }}
        >
          <FieldControl
            fieldKey={key}
            label={HOMEOWNERS_LABEL_MAP[key]}
            value={form[key] || ""}
            onChange={onFieldChange}
            isLoading={loadingFields[key]}
            isFinal={finalizedFields[key]}
            isAgentField={HOMEOWNERS_AGENT_FIELDS.has(key)}
            isManuallyEdited={manuallyEditedFields[key]}
            isYesNo={HOMEOWNERS_YES_NO_FIELDS.has(key)}
            confidence={confidenceMap?.[key] ?? null}
          />
        </div>
      ))}
    </div>
  );

  /* ── group rows into sections ──────────────────────────────────── */
  const policyRows = [];
  const clientRows = [];
  const agentRows = [];

  HOMEOWNERS_ROWS.forEach((row) => {
    const isClient = row.every(({ key }) => HOMEOWNERS_CLIENT_FIELDS.has(key));
    const isAgent = row.every(({ key }) => HOMEOWNERS_AGENT_FIELDS.has(key));

    if (isClient) clientRows.push(row);
    else if (isAgent) agentRows.push(row);
    else policyRows.push(row);
  });

  /* ── render ────────────────────────────────────────────────────── */
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <SectionCard title="Homeowners Policy">
        <div style={{ display: "grid", gap: 14 }}>
          {policyRows.map((row, i) => (
            <div key={i}>{renderRow(row)}</div>
          ))}
          <FieldControl
            fieldKey="why_selected"
            label="Why This Plan Was Selected"
            value={form.why_selected || ""}
            onChange={onFieldChange}
            multiline
            rows={4}
            isLoading={loadingFields["why_selected"] || Object.values(loadingFields).some(Boolean)}
            isFinal={finalizedFields["why_selected"]}
            isManuallyEdited={manuallyEditedFields["why_selected"]}
            confidence={confidenceMap?.["why_selected"] ?? null}
          />
        </div>
      </SectionCard>

      {clientRows.length > 0 && (
        <SectionCard title="Client Information">
          <div style={{ display: "grid", gap: 14 }}>
            {clientRows.map((row, i) => (
              <div key={i}>{renderRow(row)}</div>
            ))}
          </div>
        </SectionCard>
      )}

      {agentRows.length > 0 && (
        <SectionCard title="Advisor Information">
          <div style={{ display: "grid", gap: 14 }}>
            {agentRows.map((row, i) => (
              <div key={i}>{renderRow(row)}</div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
