import {
  AUTO_POLICY_TERM_OPTIONS,
  AUTO_AGENT_FIELDS,
  DRIVER_GENDER_OPTIONS,
  AUTO_COVERAGE_FIELDS,
  PAYMENT_PLANS,
  PAYMENT_PLAN_FIELDS,
  PAID_IN_FULL_DISCOUNT_FIELDS,
  AUTO_PREMIUM_SUMMARY_FIELDS,
} from "./autoConfig";

export default function AutoPanel({
  form,
  isLoading,
  isParsed,
  manualFields,
  confidenceMap,
  onFieldChange,
  onDriverChange,
  onAddDriver,
  onRemoveDriver,
  onVehicleChange,
  onAddVehicle,
  onRemoveVehicle,
  onTogglePaidInFullDiscount,
  onVehicleSubtotalChange,
  FieldControl,
  SectionCard,
  SubCard,
  SmallActionButton,
  SmallGhostButton,
  EmptyHint,
  COLORS,
}) {
  /* ── helpers for field status props ─────────────────────────── */
  const fp = (path) => ({
    isLoading,
    isFinal: isParsed && !manualFields[path],
    isManuallyEdited: !!manualFields[path],
    confidence: confidenceMap?.[path] ?? null,
  });

  /* ============================================================
     SECTION 1 — Auto Policy
     ============================================================ */
  const policySection = (
    <SectionCard title="Auto Policy">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {/* Row 1 */}
        <div style={{ gridColumn: "span 3", minWidth: 0 }}>
          <FieldControl
            fieldKey="client_name"
            label="Client Name"
            value={form.client_name || ""}
            onChange={onFieldChange}
            {...fp("client_name")}
          />
        </div>
        <div style={{ gridColumn: "span 3", minWidth: 0 }}>
          <FieldControl
            fieldKey="client_address"
            label="Client Address"
            value={form.client_address || ""}
            onChange={onFieldChange}
            {...fp("client_address")}
          />
        </div>
        <div style={{ gridColumn: "span 3", minWidth: 0 }}>
          <FieldControl
            fieldKey="client_phone"
            label="Client Phone"
            value={form.client_phone || ""}
            onChange={onFieldChange}
            {...fp("client_phone")}
          />
        </div>
        <div style={{ gridColumn: "span 3", minWidth: 0 }}>
          <FieldControl
            fieldKey="quote_date"
            label="Quote Date / Print Date"
            value={form.quote_date || ""}
            onChange={onFieldChange}
            {...fp("quote_date")}
          />
        </div>

        {/* Row 2 */}
        <div style={{ gridColumn: "span 3", minWidth: 0 }}>
          <FieldControl
            fieldKey="quote_effective_date"
            label="Quote Effective Date"
            value={form.quote_effective_date || ""}
            onChange={onFieldChange}
            {...fp("quote_effective_date")}
          />
        </div>
        <div style={{ gridColumn: "span 3", minWidth: 0 }}>
          <FieldControl
            fieldKey="quote_expiration_date"
            label="Quote Expiration Date"
            value={form.quote_expiration_date || ""}
            onChange={onFieldChange}
            {...fp("quote_expiration_date")}
          />
        </div>
        <div style={{ gridColumn: "span 3", minWidth: 0 }}>
          <FieldControl
            fieldKey="policy_term"
            label="Policy Term"
            value={form.policy_term || ""}
            onChange={onFieldChange}
            selectOptions={AUTO_POLICY_TERM_OPTIONS}
            {...fp("policy_term")}
          />
        </div>
        <div style={{ gridColumn: "span 3", minWidth: 0 }}>
          <FieldControl
            fieldKey="program"
            label="Program"
            value={form.program || ""}
            onChange={onFieldChange}
            {...fp("program")}
          />
        </div>
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 2 — Agent Information
     ============================================================ */
  const agentSection = (
    <SectionCard title="Agent Information">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {AUTO_AGENT_FIELDS.map(([key, label]) => (
          <div key={key} style={{ gridColumn: "span 3", minWidth: 0 }}>
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
     SECTION 3 — Drivers
     ============================================================ */
  const driversSection = (
    <SectionCard
      title={`Drivers (${form.drivers.length})`}
      action={
        <SmallActionButton onClick={onAddDriver}>
          + Add Driver
        </SmallActionButton>
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        {form.drivers.length === 0 ? (
          <EmptyHint text="No drivers added yet." />
        ) : (
          form.drivers.map((driver, index) => (
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
                <div style={{ gridColumn: "span 3", minWidth: 0 }}>
                  <FieldControl
                    fieldKey="driver_name"
                    label="Driver Name"
                    value={driver.driver_name || ""}
                    onChange={(k, v) => onDriverChange(index, k, v)}
                    {...fp(`drivers.${index}.driver_name`)}
                  />
                </div>
                <div style={{ gridColumn: "span 3", minWidth: 0 }}>
                  <FieldControl
                    fieldKey="gender"
                    label="Gender"
                    value={driver.gender || ""}
                    onChange={(k, v) => onDriverChange(index, k, v)}
                    selectOptions={DRIVER_GENDER_OPTIONS}
                    {...fp(`drivers.${index}.gender`)}
                  />
                </div>
                <div style={{ gridColumn: "span 3", minWidth: 0 }}>
                  <FieldControl
                    fieldKey="marital_status"
                    label="Marital Status"
                    value={driver.marital_status || ""}
                    onChange={(k, v) => onDriverChange(index, k, v)}
                    {...fp(`drivers.${index}.marital_status`)}
                  />
                </div>
                <div style={{ gridColumn: "span 3", minWidth: 0 }}>
                  <FieldControl
                    fieldKey="license_state"
                    label="License State"
                    value={driver.license_state || ""}
                    onChange={(k, v) => onDriverChange(index, k, v)}
                    {...fp(`drivers.${index}.license_state`)}
                  />
                </div>
              </div>
            </SubCard>
          ))
        )}
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 4 — Vehicles
     ============================================================ */
  const vehiclesSection = (
    <SectionCard
      title={`Vehicles (${form.vehicles.length})`}
      action={
        <SmallActionButton onClick={onAddVehicle}>
          + Add Vehicle
        </SmallActionButton>
      }
    >
      <div style={{ display: "grid", gap: 16 }}>
        {form.vehicles.length === 0 ? (
          <EmptyHint text="No vehicles added yet." />
        ) : (
          form.vehicles.map((vehicle, vi) => (
            <SubCard
              key={vi}
              title={`Vehicle ${vi + 1}`}
              action={
                form.vehicles.length > 1 ? (
                  <SmallGhostButton onClick={() => onRemoveVehicle(vi)}>
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
                <div style={{ gridColumn: "span 3", minWidth: 0 }}>
                  <FieldControl
                    fieldKey="year_make_model_trim"
                    label="Year / Make / Model / Trim"
                    value={vehicle.year_make_model_trim || ""}
                    onChange={(k, v) => onVehicleChange(vi, k, v)}
                    {...fp(`vehicles.${vi}.year_make_model_trim`)}
                  />
                </div>
                <div style={{ gridColumn: "span 3", minWidth: 0 }}>
                  <FieldControl
                    fieldKey="vin"
                    label="VIN"
                    value={vehicle.vin || ""}
                    onChange={(k, v) => onVehicleChange(vi, k, v)}
                    {...fp(`vehicles.${vi}.vin`)}
                  />
                </div>
                <div style={{ gridColumn: "span 3", minWidth: 0 }}>
                  <FieldControl
                    fieldKey="vehicle_use"
                    label="Vehicle Use"
                    value={vehicle.vehicle_use || ""}
                    onChange={(k, v) => onVehicleChange(vi, k, v)}
                    {...fp(`vehicles.${vi}.vehicle_use`)}
                  />
                </div>
                <div style={{ gridColumn: "span 3", minWidth: 0 }}>
                  <FieldControl
                    fieldKey="garaging_zip_county"
                    label="Garaging ZIP / County"
                    value={vehicle.garaging_zip_county || ""}
                    onChange={(k, v) => onVehicleChange(vi, k, v)}
                    {...fp(`vehicles.${vi}.garaging_zip_county`)}
                  />
                </div>
              </div>
            </SubCard>
          ))
        )}
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 5 — Coverages
     ============================================================ */
  const coveragesSection = (
    <SectionCard title="Coverages">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {/* Row 1: BI, PD, MedPay, UM/UIM BI */}
        {AUTO_COVERAGE_FIELDS.slice(0, 4).map(([key, label]) => (
          <div key={key} style={{ gridColumn: "span 3", minWidth: 0 }}>
            <FieldControl
              fieldKey={`coverages.${key}`}
              label={label}
              value={form.coverages?.[key] || ""}
              onChange={onFieldChange}
              {...fp(`coverages.${key}`)}
            />
          </div>
        ))}

        {/* Row 2: UMPD Limit, UMPD Deductible, Comprehensive, Collision */}
        {AUTO_COVERAGE_FIELDS.slice(4, 8).map(([key, label]) => (
          <div key={key} style={{ gridColumn: "span 3", minWidth: 0 }}>
            <FieldControl
              fieldKey={`coverages.${key}`}
              label={label}
              value={form.coverages?.[key] || ""}
              onChange={onFieldChange}
              {...fp(`coverages.${key}`)}
            />
          </div>
        ))}

        {/* Row 3: Rental, Towing */}
        {AUTO_COVERAGE_FIELDS.slice(8).map(([key, label]) => (
          <div key={key} style={{ gridColumn: "span 6", minWidth: 0 }}>
            <FieldControl
              fieldKey={`coverages.${key}`}
              label={label}
              value={form.coverages?.[key] || ""}
              onChange={onFieldChange}
              {...fp(`coverages.${key}`)}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 6 — Payment Options
     ============================================================ */
  const paymentPlansBlock = PAYMENT_PLANS.map(([planKey, planLabel]) => {
    const plan = form.payment_options?.[planKey] || {};
    return (
      <SubCard key={planKey} title={planLabel}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
            gap: 14,
          }}
        >
          {PAYMENT_PLAN_FIELDS.map(([fk, fl]) => (
            <div key={fk} style={{ gridColumn: "span 4", minWidth: 0 }}>
              <FieldControl
                fieldKey={`payment_options.${planKey}.${fk}`}
                label={fl}
                value={plan[fk] || ""}
                onChange={onFieldChange}
                {...fp(`payment_options.${planKey}.${fk}`)}
              />
            </div>
          ))}
        </div>
      </SubCard>
    );
  });

  const showPIF = form.payment_options?.show_paid_in_full_discount;
  const pifData = form.payment_options?.paid_in_full_discount || {};

  const paidInFullBlock = showPIF ? (
    <SubCard
      title="Paid-in-Full Discount"
      action={
        <SmallGhostButton onClick={onTogglePaidInFullDiscount}>
          Remove
        </SmallGhostButton>
      }
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {PAID_IN_FULL_DISCOUNT_FIELDS.map(([fk, fl]) => (
          <div key={fk} style={{ gridColumn: "span 4", minWidth: 0 }}>
            <FieldControl
              fieldKey={`payment_options.paid_in_full_discount.${fk}`}
              label={fl}
              value={pifData[fk] || ""}
              onChange={onFieldChange}
              {...fp(`payment_options.paid_in_full_discount.${fk}`)}
            />
          </div>
        ))}
      </div>
    </SubCard>
  ) : null;

  const paymentSection = (
    <SectionCard
      title="Payment Options"
      action={
        !showPIF ? (
          <SmallActionButton onClick={onTogglePaidInFullDiscount}>
            + Add Paid-in-Full Discount
          </SmallActionButton>
        ) : null
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {paymentPlansBlock}
        {paidInFullBlock}
      </div>
    </SectionCard>
  );

  /* ============================================================
     SECTION 7 — Premium Summary
     ============================================================ */
  const vehicleSubtotals = form.premium_summary?.vehicle_subtotals || [];
  const premSummary = form.premium_summary || {};

  const premiumSection = (
    <SectionCard title="Premium Summary">
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, minmax(0, 1fr))",
          gap: 14,
        }}
      >
        {/* Per-vehicle subtotals */}
        {vehicleSubtotals.map((val, i) => (
          <div key={`vsub-${i}`} style={{ gridColumn: "span 3", minWidth: 0 }}>
            <FieldControl
              fieldKey={`premium_summary.vehicle_subtotals.${i}`}
              label={`Vehicle ${i + 1} Subtotal`}
              value={val || ""}
              onChange={(_, v) => onVehicleSubtotalChange(i, v)}
              {...fp(`premium_summary.vehicle_subtotals.${i}`)}
            />
          </div>
        ))}

        {vehicleSubtotals.length > 0 && (
          <div style={{ gridColumn: "span 12" }}>
            <div
              style={{
                borderTop: `1px solid ${COLORS.borderGrey}`,
                marginTop: 2,
              }}
            />
          </div>
        )}

        {/* Fixed summary fields */}
        {AUTO_PREMIUM_SUMMARY_FIELDS.map(([key, label]) => (
          <div key={key} style={{ gridColumn: "span 4", minWidth: 0 }}>
            <FieldControl
              fieldKey={`premium_summary.${key}`}
              label={label}
              value={premSummary[key] || ""}
              onChange={onFieldChange}
              {...fp(`premium_summary.${key}`)}
            />
          </div>
        ))}
      </div>
    </SectionCard>
  );

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {policySection}
      {agentSection}
      {driversSection}
      {vehiclesSection}
      {coveragesSection}
      {paymentSection}
      {premiumSection}
    </div>
  );
}
