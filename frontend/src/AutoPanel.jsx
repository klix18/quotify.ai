import React from "react";
import {
  AUTO_POLICY_HEADER_FIELDS,
  AUTO_PREMIUM_SUMMARY_FIELDS,
} from "./autoConfig";

export default function AutoPanel({
  form,
  onFieldChange,
  onPremiumFieldChange,
  onDriverChange,
  onAddDriver,
  onRemoveDriver,
  onVehicleChange,
  onVehicleDiscountsChange,
  onCoverageChange,
  onAddVehicle,
  onRemoveVehicle,
  onPolicyCoverageChange,
  onAddPolicyCoverage,
  onRemovePolicyCoverage,
  onDiscountListChange,
  FieldControl,
  SectionCard,
  SubCard,
  SmallActionButton,
  SmallGhostButton,
  EmptyHint,
  COLORS,
}) {
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <SectionCard title="Policy / Header Info">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            gap: 14,
          }}
        >
          {AUTO_POLICY_HEADER_FIELDS.map(([key, label]) => (
            <div
              key={key}
              style={{
                gridColumn: key === "mailing_address" ? "span 6" : "span 3",
                minWidth: 0,
              }}
            >
              <FieldControl
                fieldKey={key}
                label={label}
                value={form[key] || ""}
                onChange={onFieldChange}
              />
            </div>
          ))}

          <div style={{ gridColumn: "span 3", minWidth: 0 }}>
            <FieldControl
              fieldKey="agent_name"
              label="Agent Name"
              value={form.agent_name || ""}
              onChange={onFieldChange}
              isAgentField
            />
          </div>
          <div style={{ gridColumn: "span 3", minWidth: 0 }}>
            <FieldControl
              fieldKey="agent_phone"
              label="Agent Phone"
              value={form.agent_phone || ""}
              onChange={onFieldChange}
              isAgentField
            />
          </div>
          <div style={{ gridColumn: "span 3", minWidth: 0 }}>
            <FieldControl
              fieldKey="agent_email"
              label="Agent Email"
              value={form.agent_email || ""}
              onChange={onFieldChange}
              isAgentField
            />
          </div>
          <div style={{ gridColumn: "span 3", minWidth: 0 }}>
            <FieldControl
              fieldKey="agent_address"
              label="Agent Address"
              value={form.agent_address || ""}
              onChange={onFieldChange}
              isAgentField
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={`Drivers (${form.drivers.length})`}
        action={
          <SmallActionButton onClick={onAddDriver}>
            + Add Driver
          </SmallActionButton>
        }
      >
        <div style={{ display: "grid", gap: 12 }}>
          {form.drivers.map((driver, index) => (
            <SubCard
              key={index}
              title={`Driver ${index + 1}`}
              action={
                form.drivers.length > 1 ? (
                  <SmallGhostButton onClick={() => onRemoveDriver(index)}>
                    Remove
                  </SmallGhostButton>
                ) : null
              }
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                  gap: 14,
                }}
              >
                <div style={{ gridColumn: "span 8" }}>
                  <FieldControl
                    fieldKey="driver_name"
                    label="Driver Name"
                    value={driver.driver_name || ""}
                    onChange={(key, value) => onDriverChange(index, key, value)}
                  />
                </div>
                <div style={{ gridColumn: "span 4" }}>
                  <FieldControl
                    fieldKey="license_state"
                    label="License State"
                    value={driver.license_state || ""}
                    onChange={(key, value) => onDriverChange(index, key, value)}
                  />
                </div>
              </div>
            </SubCard>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={`Vehicles (${form.vehicles.length})`}
        action={
          <SmallActionButton onClick={onAddVehicle}>
            + Add Vehicle
          </SmallActionButton>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          {form.vehicles.map((vehicle, vehicleIndex) => (
            <SubCard
              key={vehicleIndex}
              title={`Vehicle ${vehicleIndex + 1}`}
              action={
                form.vehicles.length > 1 ? (
                  <SmallGhostButton onClick={() => onRemoveVehicle(vehicleIndex)}>
                    Remove
                  </SmallGhostButton>
                ) : null
              }
            >
              <div style={{ display: "grid", gap: 16 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
                    gap: 14,
                  }}
                >
                  <div style={{ gridColumn: "span 4" }}>
                    <FieldControl
                      fieldKey="year_make_model"
                      label="Year / Make / Model"
                      value={vehicle.year_make_model || ""}
                      onChange={(key, value) =>
                        onVehicleChange(vehicleIndex, key, value)
                      }
                    />
                  </div>
                  <div style={{ gridColumn: "span 3" }}>
                    <FieldControl
                      fieldKey="vin"
                      label="VIN"
                      value={vehicle.vin || ""}
                      onChange={(key, value) =>
                        onVehicleChange(vehicleIndex, key, value)
                      }
                    />
                  </div>
                  <div style={{ gridColumn: "span 3" }}>
                    <FieldControl
                      fieldKey="garaging_zip_county"
                      label="Garaging ZIP / County"
                      value={vehicle.garaging_zip_county || ""}
                      onChange={(key, value) =>
                        onVehicleChange(vehicleIndex, key, value)
                      }
                    />
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <FieldControl
                      fieldKey="vehicle_subtotal"
                      label="Vehicle Subtotal"
                      value={vehicle.vehicle_subtotal || ""}
                      onChange={(key, value) =>
                        onVehicleChange(vehicleIndex, key, value)
                      }
                    />
                  </div>
                  <div style={{ gridColumn: "span 12" }}>
                    <FieldControl
                      fieldKey="lienholder_loss_payee"
                      label="Lienholder / Loss Payee"
                      value={vehicle.lienholder_loss_payee || ""}
                      onChange={(key, value) =>
                        onVehicleChange(vehicleIndex, key, value)
                      }
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: COLORS.blue,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Vehicle Coverages
                  </div>

                  <div style={{ display: "grid", gap: 10 }}>
                    {vehicle.coverages.map((coverage, coverageIndex) => (
                      <div
                        key={coverageIndex}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr",
                          gap: 10,
                          alignItems: "end",
                          padding: 12,
                          borderRadius: 14,
                          background: COLORS.inputBgAlt,
                          border: `1px solid ${COLORS.borderGrey}`,
                        }}
                      >
                        <FieldControl
                          fieldKey="coverage_name"
                          label="Coverage"
                          value={coverage.coverage_name || ""}
                          onChange={(key, value) =>
                            onCoverageChange(vehicleIndex, coverageIndex, key, value)
                          }
                        />
                        <FieldControl
                          fieldKey="limit"
                          label="Limit"
                          value={coverage.limit || ""}
                          onChange={(key, value) =>
                            onCoverageChange(vehicleIndex, coverageIndex, key, value)
                          }
                        />
                        <FieldControl
                          fieldKey="deductible"
                          label="Deductible"
                          value={coverage.deductible || ""}
                          onChange={(key, value) =>
                            onCoverageChange(vehicleIndex, coverageIndex, key, value)
                          }
                        />
                        <FieldControl
                          fieldKey="premium"
                          label="Premium"
                          value={coverage.premium || ""}
                          onChange={(key, value) =>
                            onCoverageChange(vehicleIndex, coverageIndex, key, value)
                          }
                        />
                        <FieldControl
                          fieldKey="status"
                          label="Status"
                          value={coverage.status || ""}
                          onChange={(key, value) =>
                            onCoverageChange(vehicleIndex, coverageIndex, key, value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <FieldControl
                    fieldKey="vehicle_discounts"
                    label="Vehicle Discounts Applied (one per line)"
                    value={(vehicle.vehicle_discounts || []).join("\n")}
                    onChange={(_, value) =>
                      onVehicleDiscountsChange(vehicleIndex, value)
                    }
                    multiline
                    rows={3}
                  />
                </div>
              </div>
            </SubCard>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Policy-Level Coverages"
        action={
          <SmallActionButton onClick={onAddPolicyCoverage}>
            + Add Line Item
          </SmallActionButton>
        }
      >
        <div style={{ display: "grid", gap: 10 }}>
          {(form.policy_level_coverages || []).length === 0 ? (
            <EmptyHint text="No policy-level coverages added yet." />
          ) : (
            form.policy_level_coverages.map((coverage, index) => (
              <div
                key={index}
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr auto",
                  gap: 10,
                  alignItems: "end",
                  padding: 12,
                  borderRadius: 14,
                  background: COLORS.inputBgAlt,
                  border: `1px solid ${COLORS.borderGrey}`,
                }}
              >
                <FieldControl
                  fieldKey="coverage_name"
                  label="Coverage"
                  value={coverage.coverage_name || ""}
                  onChange={(key, value) =>
                    onPolicyCoverageChange(index, key, value)
                  }
                />
                <FieldControl
                  fieldKey="limit"
                  label="Limit"
                  value={coverage.limit || ""}
                  onChange={(key, value) =>
                    onPolicyCoverageChange(index, key, value)
                  }
                />
                <FieldControl
                  fieldKey="deductible"
                  label="Deductible"
                  value={coverage.deductible || ""}
                  onChange={(key, value) =>
                    onPolicyCoverageChange(index, key, value)
                  }
                />
                <FieldControl
                  fieldKey="premium"
                  label="Premium"
                  value={coverage.premium || ""}
                  onChange={(key, value) =>
                    onPolicyCoverageChange(index, key, value)
                  }
                />
                <FieldControl
                  fieldKey="status"
                  label="Status"
                  value={coverage.status || ""}
                  onChange={(key, value) =>
                    onPolicyCoverageChange(index, key, value)
                  }
                />
                <div style={{ paddingBottom: 2 }}>
                  <SmallGhostButton onClick={() => onRemovePolicyCoverage(index)}>
                    Remove
                  </SmallGhostButton>
                </div>
              </div>
            ))
          )}
        </div>
      </SectionCard>

      <SectionCard title="Premium Summary">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            gap: 14,
          }}
        >
          {AUTO_PREMIUM_SUMMARY_FIELDS.map(([key, label]) => (
            <div key={key} style={{ gridColumn: "span 3" }}>
              <FieldControl
                fieldKey={key}
                label={label}
                value={form.premium_summary?.[key] || ""}
                onChange={onPremiumFieldChange}
              />
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Discounts Applied">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            gap: 14,
          }}
        >
          <div style={{ gridColumn: "span 4" }}>
            <FieldControl
              fieldKey="policy_level"
              label="Policy-Level Discounts"
              value={(form.discounts?.policy_level || []).join("\n")}
              onChange={(_, value) => onDiscountListChange("policy_level", value)}
              multiline
              rows={6}
            />
          </div>
          <div style={{ gridColumn: "span 4" }}>
            <FieldControl
              fieldKey="vehicle_level"
              label="Vehicle-Level Discounts"
              value={(form.discounts?.vehicle_level || []).join("\n")}
              onChange={(_, value) => onDiscountListChange("vehicle_level", value)}
              multiline
              rows={6}
            />
          </div>
          <div style={{ gridColumn: "span 4" }}>
            <FieldControl
              fieldKey="available_not_applied"
              label="Available But Not Applied"
              value={(form.discounts?.available_not_applied || []).join("\n")}
              onChange={(_, value) =>
                onDiscountListChange("available_not_applied", value)
              }
              multiline
              rows={6}
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}