import React from "react";

const COLORS = {
  blue: "#1765D4",
  black: "#20272D",
  lightGrey: "#F2F2F2",
  hoverShadow: "#C9F2FF",
  disabledText: "#B8B8B8",
  disabledIcon: "grayscale(1) opacity(0.38)",
  borderGrey: "#D7D7D7",
  subtextGrey: "#C8C8C8",
};

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const INSURANCE_OPTIONS = [
  { key: "homeowners", label: "Homeowners", icon: "/i-homeowners.png", enabled: true },
  { key: "auto", label: "Auto", icon: "/i-auto.png", enabled: false },
  { key: "motorcycle", label: "Motorcycle", icon: "/i-motor.png", enabled: false },
  { key: "boat", label: "Boat", icon: "/i-boat.png", enabled: false },
  { key: "renters", label: "Renters", icon: "/i-renter.png", enabled: false },
  { key: "rv", label: "RV", icon: "/i-rv.png", enabled: false },
  { key: "umbrella", label: "Umbrella", icon: "/i-umbrella.png", enabled: false },
  { key: "flood", label: "Flood", icon: "/i-flood.png", enabled: false },
];

const EDITABLE_FIELDS = [
  ["carrier", "Carrier"],
  ["total_premium", "Total Premium"],
  ["dwelling", "Dwelling"],
  ["other_structures", "Other Structures"],
  ["of_dwelling", "Of Dwelling"],
  ["personal_property", "Personal Property"],
  ["loss_of_use", "Loss of Use"],
  ["personal_liability", "Personal Liability"],
  ["medical_payments", "Medical Payments"],
  ["replacement_cost_on_contents", "Replacement Cost on Contents"],
  ["25_extended_replacement_cost", "25% Extended Replacement Cost"],
  ["all_perils_deductible", "All Perils Deductible"],
  ["wind_hail_deductible", "Wind / Hail Deductible"],
  ["water_and_sewer_backup", "Water and Sewer Backup"],
  ["client_name", "Client Name"],
  ["client_address", "Client Address"],
  ["client_phone", "Client Phone"],
  ["client_email", "Client Email"],
  ["agent_name", "Agent Name"],
  ["agent_address", "Agent Address"],
  ["agent_phone", "Agent Phone"],
  ["agent_email", "Agent Email"],
];

const LEFT_KEYS = new Set([
  "carrier",
  "total_premium",
  "dwelling",
  "other_structures",
  "of_dwelling",
  "personal_property",
  "loss_of_use",
  "personal_liability",
  "medical_payments",
  "replacement_cost_on_contents",
  "25_extended_replacement_cost",
  "all_perils_deductible",
  "wind_hail_deductible",
  "water_and_sewer_backup",
]);

const YES_NO_FIELDS = new Set([
  "replacement_cost_on_contents",
  "25_extended_replacement_cost",
]);

const TEXTAREA_FIELDS = new Set([
  "client_address",
  "agent_address",
]);

const EMPTY_FORM = Object.fromEntries(EDITABLE_FIELDS.map(([key]) => [key, ""]));

export default function QuotifyHome() {
  const [selectedInsurance, setSelectedInsurance] = React.useState("");
  const [hoveredCard, setHoveredCard] = React.useState("");
  const [isBrowseHovered, setIsBrowseHovered] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [fileName, setFileName] = React.useState("");
  const [formData, setFormData] = React.useState(EMPTY_FORM);
  const [isParsing, setIsParsing] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const fileInputRef = React.useRef(null);

  const maxWidth = 920;
  const uploaderEnabled = selectedInsurance === "homeowners";
  const uploaderActive = uploaderEnabled && isDragging;

  const onBrowseClick = () => fileInputRef.current?.click();

  const updateField = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const parseFile = async (file) => {
    if (!file || !uploaderEnabled) return;

    setFileName(file.name);
    setErrorMessage("");
    setIsParsing(true);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-homeowners-quote`, {
        method: "POST",
        body,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.detail || "Failed to parse homeowners quote.");
      }

      setFormData({
        ...EMPTY_FORM,
        ...payload,
      });
    } catch (error) {
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
    } finally {
      setIsParsing(false);
    }
  };

  const generateAndDownloadQuote = async () => {
    setErrorMessage("");
    setIsGenerating(true);
  
    try {
      const response = await fetch(`${API_BASE_URL}/api/generate-homeowners-quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });
  
      if (!response.ok) {
        let detail = "Failed to generate homeowners quote.";
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
        } catch (_) {}
        throw new Error(detail);
      }
  
      const blob = await response.blob();
  
      const contentDisposition = response.headers.get("content-disposition") || "";
      let fileName = "homeowners_quote_filled.pdf";
  
      const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
      const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  
      if (utf8Match?.[1]) {
        fileName = decodeURIComponent(utf8Match[1]);
      } else if (plainMatch?.[1]) {
        fileName = plainMatch[1];
      }
  
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setErrorMessage(error.message || "Something went wrong while generating the quote.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    await parseFile(file);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    await handleFile(file);
  };

  const hasFormValues = Object.values(formData).some((value) => String(value).trim() !== "");

  return (
    <div
      style={{
        background: "#fff",
        minHeight: "100vh",
        padding: "40px 20px 56px",
        fontFamily: "Poppins, sans-serif",
        color: COLORS.black,
      }}
    >
      <div style={{ maxWidth, margin: "0 auto", textAlign: "center" }}>
        <img
          src="/Combination_Blue_Medium.png"
          alt="Sizemore Insurance"
          style={{ height: 48, marginBottom: 8 }}
        />

        <h1
          style={{
            fontFamily: "SentientCustom, Georgia, serif",
            fontSize: 78,
            lineHeight: 0.95,
            margin: "6px 0 8px 0",
            color: COLORS.black,
          }}
        >
          Quotify.ai
        </h1>

        <p
          style={{
            fontSize: 18,
            fontWeight: 500,
            margin: "16px 0 34px 0",
            color: COLORS.black,
          }}
        >
          Your Automatic Quote Filler
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 18,
            maxWidth,
            margin: "0 auto",
          }}
        >
          {INSURANCE_OPTIONS.map((item) => {
            const isSelected = selectedInsurance === item.key;
            const isEnabled = item.enabled;
            const isHovered = hoveredCard === item.key;

            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  if (!isEnabled) return;
                  setSelectedInsurance(item.key);
                  setIsDragging(false);
                  setErrorMessage("");
                }}
                onMouseEnter={() => setHoveredCard(item.key)}
                onMouseLeave={() => setHoveredCard("")}
                disabled={!isEnabled}
                style={{
                  background: COLORS.lightGrey,
                  borderRadius: 20,
                  padding: "20px 16px 16px 16px",
                  textAlign: "center",
                  minHeight: 220,
                  border: `3px solid ${isSelected ? COLORS.blue : "transparent"}`,
                  cursor: isEnabled ? "pointer" : "not-allowed",
                  transition: "all 200ms ease",
                  boxShadow:
                    isEnabled && isHovered
                      ? `0 0 32px ${COLORS.hoverShadow}`
                      : "0 0 0 rgba(0,0,0,0)",
                }}
              >
                <div
                  style={{
                    height: 110,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 14,
                  }}
                >
                  <img
                    src={item.icon}
                    alt={item.label}
                    style={{
                      width: 82,
                      height: "auto",
                      objectFit: "contain",
                      display: "block",
                      filter: isEnabled ? "none" : COLORS.disabledIcon,
                      transition: "all 200ms ease",
                    }}
                  />
                </div>

                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 500,
                    fontFamily: "Poppins, sans-serif",
                    color: isEnabled ? COLORS.black : COLORS.disabledText,
                    transition: "all 200ms ease",
                  }}
                >
                  {item.label}
                </div>
              </button>
            );
          })}
        </div>

        <div
          style={{
            maxWidth,
            margin: "22px auto 0 auto",
          }}
        >
          <div
            onDragEnter={(e) => {
              if (!uploaderEnabled) return;
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragOver={(e) => {
              if (!uploaderEnabled) return;
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              if (!uploaderEnabled) return;
              e.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              if (!uploaderEnabled) return;
              handleDrop(e);
            }}
            style={{
              borderRadius: 20,
              border: `2px dashed ${
                uploaderEnabled ? (uploaderActive ? COLORS.blue : COLORS.borderGrey) : COLORS.borderGrey
              }`,
              background: "#fff",
              padding: "21px 24px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              transition: "all 200ms ease",
              boxShadow: "none",
              opacity: uploaderEnabled ? 1 : 0.45,
              pointerEvents: uploaderEnabled ? "auto" : "none",
            }}
          >
            <div style={{ textAlign: "left" }}>
              <div
                style={{
                  color: uploaderEnabled ? COLORS.blue : COLORS.black,
                  fontWeight: 500,
                  fontSize: 16,
                  transition: "all 200ms ease",
                }}
              >
                {fileName || "Drag and Drop File Here"}
              </div>

              <div
                style={{
                  marginTop: 3,
                  fontSize: 13,
                  color: COLORS.subtextGrey,
                  transition: "all 200ms ease",
                }}
              >
                Limit 200MB per file - PDF
              </div>
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              <button
                type="button"
                disabled={!uploaderEnabled || isParsing}
                onClick={() => {
                  if (!uploaderEnabled || isParsing) return;
                  onBrowseClick();
                }}
                onMouseEnter={() => {
                  if (!uploaderEnabled || isParsing) return;
                  setIsBrowseHovered(true);
                }}
                onMouseLeave={() => setIsBrowseHovered(false)}
                style={{
                  background: COLORS.lightGrey,
                  borderRadius: 12,
                  border: "none",
                  height: 44,
                  minWidth: 156,
                  padding: "0 24px",
                  color: uploaderEnabled ? COLORS.blue : COLORS.black,
                  fontWeight: 600,
                  fontSize: 16,
                  cursor: uploaderEnabled && !isParsing ? "pointer" : "not-allowed",
                  transition: "all 200ms ease",
                  boxShadow:
                    uploaderEnabled && isBrowseHovered && !isParsing
                      ? `0 0 32px ${COLORS.hoverShadow}`
                      : "0 0 0 rgba(0,0,0,0)",
                }}
              >
                {isParsing ? "PARSING..." : "BROWSE FILES"}
              </button>
            </div>
          </div>
        </div>

        {errorMessage ? (
          <div
            style={{
              maxWidth,
              margin: "16px auto 0",
              textAlign: "left",
              color: "#B3261E",
              fontSize: 14,
            }}
          >
            {errorMessage}
          </div>
        ) : null}

        {hasFormValues ? (
          <div
            style={{
              maxWidth,
              margin: "42px auto 0",
              textAlign: "left",
            }}
          >
            <h2
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: COLORS.black,
                margin: "0 0 22px 0",
              }}
            >
              Extracted Values – Please Edit Where Needed
            </h2>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 18,
                alignItems: "start",
              }}
            >
              <div style={{ display: "grid", gap: 18 }}>
                {EDITABLE_FIELDS.filter(([key]) => LEFT_KEYS.has(key)).map(([key, label]) => (
                  <FieldControl
                    key={key}
                    fieldKey={key}
                    label={label}
                    value={formData[key] || ""}
                    onChange={updateField}
                  />
                ))}
              </div>

              <div style={{ display: "grid", gap: 18 }}>
                {EDITABLE_FIELDS.filter(([key]) => !LEFT_KEYS.has(key)).map(([key, label]) => (
                  <FieldControl
                    key={key}
                    fieldKey={key}
                    label={label}
                    value={formData[key] || ""}
                    onChange={updateField}
                  />
                ))}
              </div>
            </div>

            <div
              style={{
                marginTop: 28,
                display: "flex",
                justifyContent: "center",
              }}
            >
              <button
                type="button"
                onClick={generateAndDownloadQuote}
                disabled={isGenerating}
                style={{
                  background: COLORS.blue,
                  color: "#FFFFFF",
                  border: "2px solid #FFFFFF",
                  borderRadius: 14,
                  minHeight: 56,
                  padding: "0 28px",
                  fontSize: 16,
                  fontWeight: 700,
                  fontFamily: "Poppins, sans-serif",
                  cursor: isGenerating ? "not-allowed" : "pointer",
                  boxShadow: "0 6px 18px rgba(23, 101, 212, 0.18)",
                  transition: "all 200ms ease",
                }}
              >
                {isGenerating ? "GENERATING..." : "Generate + Download Quote"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FieldControl({ fieldKey, label, value, onChange }) {
  const commonInputStyle = {
    width: "100%",
    boxSizing: "border-box",
    background: COLORS.lightGrey,
    border: "none",
    borderRadius: 12,
    color: COLORS.black,
    fontSize: 16,
    fontFamily: "Poppins, sans-serif",
    outline: "none",
    transition: "all 200ms ease",
  };

  if (YES_NO_FIELDS.has(fieldKey)) {
    const normalized = String(value).trim().toLowerCase();
    const selectValue =
      normalized === "yes" ? "Yes" : normalized === "no" ? "No" : "";

    return (
      <div>
        <label
          style={{
            display: "block",
            fontSize: 16,
            fontWeight: 500,
            marginBottom: 8,
            color: COLORS.black,
          }}
        >
          {label}
        </label>
        <select
          value={selectValue}
          onChange={(e) => onChange(fieldKey, e.target.value)}
          style={{
            ...commonInputStyle,
            height: 52,
            padding: "0 14px",
            appearance: "auto",
            cursor: "pointer",
          }}
        >
          <option value="Yes">Yes</option>
          <option value="No">No</option>
          <option value=""></option>
        </select>
      </div>
    );
  }

  if (TEXTAREA_FIELDS.has(fieldKey)) {
    return (
      <div>
        <label
          style={{
            display: "block",
            fontSize: 16,
            fontWeight: 500,
            marginBottom: 8,
            color: COLORS.black,
          }}
        >
          {label}
        </label>
        <textarea
          value={value}
          onChange={(e) => onChange(fieldKey, e.target.value)}
          rows={3}
          style={{
            ...commonInputStyle,
            padding: "14px",
            minHeight: 96,
            resize: "vertical",
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 16,
          fontWeight: 500,
          marginBottom: 8,
          color: COLORS.black,
        }}
      >
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        style={{
          ...commonInputStyle,
          height: 52,
          padding: "0 14px",
        }}
      />
    </div>
  );
}