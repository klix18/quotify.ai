import {
  BUNDLE_POLICY_FIELDS,
  BUNDLE_CLIENT_FIELDS,
  BUNDLE_AGENT_FIELDS,
  BUNDLE_HOMEOWNERS_COVERAGE_FIELDS,
  BUNDLE_HOMEOWNERS_YES_NO_FIELDS,
  AUTO_POLICY_TERM_OPTIONS,
  BUNDLE_AUTO_DRIVER_FIELDS,
  DRIVER_GENDER_OPTIONS,
  BUNDLE_AUTO_COVERAGE_FIELDS,
  BUNDLE_AUTO_VEHICLE_DEDUCTIBLE_FIELDS,
  BUNDLE_PAYMENT_PLANS,
  bundleFieldsForPaymentPlan,
  BUNDLE_PAID_IN_FULL_DISCOUNT_FIELDS,
} from "../configs/bundleConfig";

export default function BundlePanel({
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
  FieldControl,
  SectionCard,
  SubCard,
  SmallActionButton,
  SmallGhostButton,
  EmptyHint,
  COLORS,
}) {
  /* ── helpers ───────────────────────────────────────────────────── */
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

  /* ── big section divider ───────────────────────────────────────── */
  const BigSectionHeader = ({ title, icon }) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "18px 0 6px 0",
      }}
    >
      {icon && (
        <img
          src={icon}
          alt={title}
          style={{ width: 28, height: 28, objectFit: "contain" }}
        />
      )}
      <div
        style={{
          fontFamily: "SentientCustom, Georgia, serif",
          fontSize: 26,
          lineHeight: 1,
          letterSpacing: "-0.03em",
          color: COLORS.blue,
        }}
      >
        {title}
      </div>
      <div
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, ${COLORS.blueBorder}, transparent)`,
          marginLeft: 8,
        }}
      />
    </div>
  );

  /* ============================================================
     SECTION 1 — Bundle Policy (premiums)
     ============================================================ */
  const policySection = (
    <SectionCard title="Bundle Policy">
      <div style={gridRow}>
        {BUNDLE_POLICY_FIELDS.map(([key, label]) => (
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
        {BUNDLE_CLIENT_FIELDS.map(([key, label]) => (
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
        {BUNDLE_AGENT_FIELDS.map(([key, label]) => (
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
     HOMEOWNERS — Coverages
     ============================================================ */
  const homeownersCoveragesSection = (
    <SectionCard title="Homeowners Coverages">
      <div style={gridRow}>
        {BUNDLE_HOMEOWNERS_COVERAGE_FIELDS.map(([key, label], i) => {
          const total = BUNDLE_HOMEOWNERS_COVERAGE_FIELDS.length;
          const remainder = total % 4;
          const isLastRow = remainder > 0 && i >= total - remainder;
          return (
            <div key={key} style={isLastRow ? cell4 : cell3}>
              <FieldControl
                fieldKey={key}
                label={label}
                value={form[key] || ""}
                onChange={onFieldChange}
                isYesNo={BUNDLE_HOMEOWNERS_YES_NO_FIELDS.has(key)}
                {...fp(key)}
              />
            </div>
          );
        })}
      </div>
    </SectionCard>
  );

  /* ============================================================
     AUTO — Drivers
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
              <div style={gridRow}>
                {BUNDLE_AUTO_DRIVER_FIELDS.map(([fk, fl]) => (
                  <div key={fk} style={cell3}>
                    <FieldControl
                      fieldKey={fk}
                      label={fl}
                      value={driver[fk] || ""}
                      onChange={(k, v) => onDriverChange(index, k, v)}
                      selectOptions={fk === "gender" ? DRIVER_GENDER_OPTIONS : null}
                      {...fp(`drivers.${index}.${fk}`)}
                    />
                  </div>
                ))}
              </div>
            </SubCard>
          ))
        )}
      </div>
    </SectionCard>
  );

  /* ============================================================
     AUTO — Vehicles
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
              <div style={gridRow}>
                {/* Row 1: Year / VIN / Vehicle Use / Garaging ZIP
                    Row 2: Comprehensive / Collision / Rental / Towing
                    (8 fields × cell3 → two clean rows of 4) */}
                <div style={cell3}>
                  <FieldControl
                    fieldKey="year_make_model_trim"
                    label="Year / Make / Model / Trim"
                    value={vehicle.year_make_model_trim || ""}
                    onChange={(k, v) => onVehicleChange(vi, k, v)}
                    {...fp(`vehicles.${vi}.year_make_model_trim`)}
                  />
                </div>
                <div style={cell3}>
                  <FieldControl
                    fieldKey="vin"
                    label="VIN"
                    value={vehicle.vin || ""}
                    onChange={(k, v) => onVehicleChange(vi, k, v)}
                    {...fp(`vehicles.${vi}.vin`)}
                  />
                </div>
                <div style={cell3}>
                  <FieldControl
                    fieldKey="vehicle_use"
                    label="Vehicle Use"
                    value={vehicle.vehicle_use || ""}
                    onChange={(k, v) => onVehicleChange(vi, k, v)}
                    {...fp(`vehicles.${vi}.vehicle_use`)}
                  />
                </div>
                <div style={cell3}>
                  <FieldControl
                    fieldKey="garaging_zip_county"
                    label="Garaging ZIP / County"
                    value={vehicle.garaging_zip_county || ""}
                    onChange={(k, v) => onVehicleChange(vi, k, v)}
                    {...fp(`vehicles.${vi}.garaging_zip_county`)}
                  />
                </div>

                {/* Per-vehicle limits & deductibles
                    (Comprehensive / Collision deductibles +
                     Rental / Towing limits) */}
                {BUNDLE_AUTO_VEHICLE_DEDUCTIBLE_FIELDS.map(([dkey, dlabel]) => (
                  <div key={dkey} style={cell3}>
                    <FieldControl
                      fieldKey={dkey}
                      label={dlabel}
                      value={vehicle[dkey] || ""}
                      onChange={(k, v) => onVehicleChange(vi, k, v)}
                      {...fp(`vehicles.${vi}.${dkey}`)}
                    />
                  </div>
                ))}
              </div>
            </SubCard>
          ))
        )}
      </div>
    </SectionCard>
  );

  /* ============================================================
     AUTO — Coverages
     ============================================================ */
  const coveragesSection = (
    <SectionCard title="Auto Coverages">
      <div style={gridRow}>
        {/* Row 1: Policy Term, BI, PD (3 per row) */}
        <div style={cell4}>
          <FieldControl
            fieldKey="auto_policy_term"
            label="Policy Term"
            value={form.auto_policy_term || ""}
            onChange={onFieldChange}
            selectOptions={AUTO_POLICY_TERM_OPTIONS}
            {...fp("auto_policy_term")}
          />
        </div>
        {/* Policy Term + 6 policy-level coverages = 7 items total.
            Rental / Towing limits render on each vehicle (not here). */}
        {BUNDLE_AUTO_COVERAGE_FIELDS.map(([key, label]) => (
          <div key={key} style={cell4}>
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
     AUTO — Payment Options
     ============================================================ */
  const paymentPlansBlock = BUNDLE_PAYMENT_PLANS.map(([planKey, planLabel]) => {
    const plan = form.payment_options?.[planKey] || {};
    const planFields = bundleFieldsForPaymentPlan(planKey);
    // Full Pay has 1 field → span 12 (full width).
    // Installments have 3 fields → span 4 each so the row fills.
    const cellStyle = planKey === "full_pay"
      ? { gridColumn: "span 12", minWidth: 0 }
      : cell4;
    return (
      <SubCard key={planKey} title={planLabel}>
        <div style={gridRow}>
          {planFields.map(([fk, fl]) => (
            <div key={fk} style={cellStyle}>
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
      <div style={gridRow}>
        {BUNDLE_PAID_IN_FULL_DISCOUNT_FIELDS.map(([fk, fl]) => (
          <div key={fk} style={cell4}>
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
      title="Auto Payment Options"
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

  /* ── render ────────────────────────────────────────────────────── */
  return (
    <div style={{ display: "grid", gap: 18 }}>
      {policySection}
      {clientSection}
      {agentSection}

      <BigSectionHeader title="Homeowners" icon="/i-homeowners.png" />
      {homeownersCoveragesSection}

      <BigSectionHeader title="Auto" icon="/i-auto.png" />
      {coveragesSection}
      {driversSection}
      {vehiclesSection}
      {paymentSection}
    </div>
  );
}
