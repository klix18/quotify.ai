import React from "react";
import COLORS from "./colors";
import {
  HOMEOWNERS_YES_NO_FIELDS,
  HOMEOWNERS_AGENT_FIELDS,
  HOMEOWNERS_CLIENT_FIELDS,
  HOMEOWNERS_LABEL_MAP,
  HOMEOWNERS_ROWS,
} from "./homeownersConfig";

export default function HomeownersPanel({
  form,
  onFieldChange,
  loadingFields,
  finalizedFields,
  manuallyEditedFields,
  FieldControl,
}) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #FFFFFF 0%, #FBFDFF 100%)",
        border: `1px solid ${COLORS.borderGrey}`,
        borderRadius: 24,
        boxShadow: "0 18px 44px rgba(23,101,212,0.07)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: 22 }}>
        <div style={{ display: "grid", gap: 18 }}>
          {HOMEOWNERS_ROWS.map((row, rowIndex) => {
            const rowHasAgentFields = row.every(({ key }) =>
              HOMEOWNERS_AGENT_FIELDS.has(key)
            );
            const rowHasClientFields = row.every(({ key }) =>
              HOMEOWNERS_CLIENT_FIELDS.has(key)
            );

            return (
              <div key={rowIndex}>
                {(rowHasClientFields || rowHasAgentFields) && (
                  <div
                    style={{
                      borderTop: `1px solid ${COLORS.borderGrey}`,
                      paddingTop: 14,
                      marginTop: 6,
                      marginBottom: 14,
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "SentientCustom, Georgia, serif",
                        fontSize: 20,
                        lineHeight: 1,
                        letterSpacing: "-0.02em",
                        color: COLORS.black,
                      }}
                    >
                      {rowHasClientFields
                        ? "Client Information"
                        : "Advisor Information"}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                    gap: 14,
                    alignItems: "start",
                  }}
                >
                  {row.map(({ key }) => (
                    <div
                      key={key}
                      style={{
                        gridColumn: "span 3",
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
                      />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}