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
  ["total_premium", "Total Premium"],
  ["dwelling", "Dwelling"],
  ["other_structures", "Other Structures"],
  ["personal_property", "Personal Property"],
  ["loss_of_use", "Loss of Use"],
  ["personal_liability", "Personal Liability"],
  ["medical_payments", "Medical Payments"],
  ["replacement_cost_on_contents", "Replacement Cost on Contents"],
  ["25_ext_replacement_cost", "25% Ext Replacement Cost"],
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

const YES_NO_FIELDS = new Set([
  "replacement_cost_on_contents",
  "25_ext_replacement_cost",
]);

const TEXTAREA_FIELDS = new Set([
  "client_address",
  "agent_address",
]);

const NO_STATUS_FIELDS = new Set([
  "client_name",
  "client_address",
  "client_phone",
  "client_email",
  "agent_name",
  "agent_address",
  "agent_phone",
  "agent_email",
]);

const LABEL_MAP = Object.fromEntries(EDITABLE_FIELDS);

const EXTRACTED_ROWS = [
  [
    { key: "total_premium", span: 5 },
    { key: "dwelling", span: 5 },
    { key: "other_structures", span: 5 },
    { key: "personal_property", span: 5 },
  ],

  [
    { key: "loss_of_use", span: 5 },
    { key: "personal_liability", span: 5 },
    { key: "medical_payments", span: 5 },
    { key: "all_perils_deductible", span: 5 },
  ],

  [
    { key: "replacement_cost_on_contents", span: 5 },
    { key: "25_ext_replacement_cost", span: 5 },
    { key: "water_and_sewer_backup", span: 5 },
    { key: "wind_hail_deductible", span: 5 },
  ],

  [
    { key: "client_name", span: 5 },
    { key: "client_address", span: 5 },
    { key: "client_phone", span: 5 },
    { key: "client_email", span: 5 },
  ],

  [
    { key: "agent_name", span: 5 },
    { key: "agent_address", span: 5 },
    { key: "agent_phone", span: 5 },
    { key: "agent_email", span: 5 },
  ],
];

const EMPTY_FORM = Object.fromEntries(EDITABLE_FIELDS.map(([key]) => [key, ""]));

export default function QuotifyHome() {
  const [selectedInsurance, setSelectedInsurance] = React.useState("");
  const [hoveredCard, setHoveredCard] = React.useState("");
  const [isBrowseHovered, setIsBrowseHovered] = React.useState(false);
  const [isGenerateHovered, setIsGenerateHovered] = React.useState(false);
  const [advisors, setAdvisors] = React.useState([]);
  const [advisorSearch, setAdvisorSearch] = React.useState("");
  const [isAdvisorDropdownOpen, setIsAdvisorDropdownOpen] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [fileName, setFileName] = React.useState("");
  const [formData, setFormData] = React.useState(EMPTY_FORM);
  const [isParsing, setIsParsing] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [parseStatus, setParseStatus] = React.useState("");
  const fileInputRef = React.useRef(null);
  const advisorDropdownRef = React.useRef(null);
  const [loadingFields, setLoadingFields] = React.useState(
    () => Object.fromEntries(EDITABLE_FIELDS.map(([key]) => [key, false]))
  );
  const [finalizedFields, setFinalizedFields] = React.useState(
    () => Object.fromEntries(EDITABLE_FIELDS.map(([key]) => [key, false]))
  );

  const resetFieldLoadingState = () => {
    setLoadingFields(
      Object.fromEntries(EDITABLE_FIELDS.map(([key]) => [key, false]))
    );
    setFinalizedFields(
      Object.fromEntries(EDITABLE_FIELDS.map(([key]) => [key, false]))
    );
  };

  const startFieldLoadingState = () => {
    const next = Object.fromEntries(
      EDITABLE_FIELDS.map(([key]) => [
        key,
        !key.startsWith("agent_"),
      ])
    );
    setLoadingFields(next);

    setFinalizedFields(
      Object.fromEntries(EDITABLE_FIELDS.map(([key]) => [key, false]))
    );
  };

  const maxWidth = 920;
  const extractedMaxWidth = 1280;
  const uploaderEnabled = selectedInsurance === "homeowners";
  const uploaderActive = uploaderEnabled && isDragging;
  const selectedAdvisorName = formData.agent_name || "";
  const advisorInputValue = isAdvisorDropdownOpen ? advisorSearch : selectedAdvisorName;

  const onBrowseClick = () => fileInputRef.current?.click();

  const updateField = (key, value) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  React.useEffect(() => {
    const loadAdvisors = async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/advisors`);
        if (!resp.ok) {
          const text = await resp.text();
          console.error("Failed advisors response:", text);
          return;
        }

        const data = await resp.json();
        setAdvisors(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Error loading advisors:", err);
      }
    };

    loadAdvisors();
  }, []);

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        advisorDropdownRef.current &&
        !advisorDropdownRef.current.contains(event.target)
      ) {
        setIsAdvisorDropdownOpen(false);
        setAdvisorSearch(selectedAdvisorName);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [selectedAdvisorName]);

  const handleAdvisorSelect = (advisor) => {
    setAdvisorSearch(advisor.name || "");
    setIsAdvisorDropdownOpen(false);
    setFormData((prev) => ({
      ...prev,
      agent_name: advisor.name || "",
      agent_address: advisor.office_address || "",
      agent_phone: advisor.phone || "",
      agent_email: advisor.email || "",
    }));
  };

  const parseFile = async (file) => {
    if (!file || !uploaderEnabled) return;

    setFileName(file.name);
    setErrorMessage("");
    setParseStatus("Uploading PDF...");
    setIsParsing(true);
    startFieldLoadingState();

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-homeowners-quote`, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        let detail = "Failed to parse homeowners quote.";
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
        } catch (_) {}
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("Streaming response body is not available.");
      }

      setFormData((prev) => ({
        ...EMPTY_FORM,
        agent_name: prev.agent_name || "",
        agent_address: prev.agent_address || "",
        agent_phone: prev.agent_phone || "",
        agent_email: prev.agent_email || "",
      }));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData = null;

      const applyPatch = (patch, isFinal = false) => {
        const {
          agent_name,
          agent_address,
          agent_phone,
          agent_email,
          ...restPatch
        } = patch || {};

        const keys = Object.keys(restPatch);

        if (keys.length === 0) return;

        setFormData((prev) => ({
          ...prev,
          ...restPatch,
        }));

        setLoadingFields((prev) => {
          const next = { ...prev };
          for (const key of keys) next[key] = false;
          return next;
        });

        if (isFinal) {
          setFinalizedFields((prev) => {
            const next = { ...prev };
            for (const key of keys) next[key] = true;
            return next;
          });
        }
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }

          if (message.type === "status") {
            setParseStatus(message.message || "Parsing...");
          }

          if (message.type === "draft_patch" && message.data) {
            setParseStatus("Filling likely fields...");
            applyPatch(message.data, false);
          }

          if (message.type === "final_patch" && message.data) {
            setParseStatus("Verifying and refining fields...");
            applyPatch(message.data, true);
          }

          if (message.type === "result") {
            finalData = message.data;
            setParseStatus("Applying final values...");
          }

          if (message.type === "error") {
            throw new Error(message.error || "Streaming parse failed.");
          }
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);

          if (message.type === "draft_patch" && message.data) {
            applyPatch(message.data, false);
          } else if (message.type === "final_patch" && message.data) {
            applyPatch(message.data, true);
          } else if (message.type === "result") {
            finalData = message.data;
          } else if (message.type === "error") {
            throw new Error(message.error || "Streaming parse failed.");
          }
        } catch (_) {}
      }

      if (!finalData) {
        throw new Error("No final parsed result was returned.");
      }

      const {
        agent_name,
        agent_address,
        agent_phone,
        agent_email,
        ...restPayload
      } = finalData || {};

      setFormData((prev) => ({
        ...prev,
        ...restPayload,
      }));

      setLoadingFields(
        Object.fromEntries(EDITABLE_FIELDS.map(([key]) => [key, false]))
      );
      setFinalizedFields((prev) => {
        const next = { ...prev };
        for (const key of Object.keys(restPayload)) {
          next[key] = true;
        }
        return next;
      });

      setParseStatus("Done.");
    } catch (error) {
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      resetFieldLoadingState();
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
      let outFileName = "homeowners_quote_filled.pdf";

      const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
      const plainMatch = contentDisposition.match(/filename="?([^"]+)"?/i);

      if (utf8Match?.[1]) {
        outFileName = decodeURIComponent(utf8Match[1]);
      } else if (plainMatch?.[1]) {
        outFileName = plainMatch[1];
      }

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = outFileName;
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

  const filteredAdvisors = [...advisors]
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
    .filter((advisor) =>
      (advisor.name || "")
        .toLowerCase()
        .includes(advisorSearch.toLowerCase().trim())
    );

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
      <style>
        {`
          @keyframes quotifyShimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}
      </style>

      <div style={{ maxWidth: extractedMaxWidth, margin: "0 auto", textAlign: "center" }}>
        <img
          src="/Combination_Blue_Medium.png"
          alt="Sizemore Insurance"
          style={{ height: 38, marginBottom: 10 }}
        />

        <h1
          style={{
            fontFamily: "SentientCustom, Georgia, serif",
            fontSize: 66,
            lineHeight: 0.95,
            margin: "6px 0 8px 0",
            color: COLORS.black,
            letterSpacing: "-0.06em",
          }}
        >
          The Sizemore Snapshot
        </h1>

        <p
          style={{
            fontSize: 18,
            fontWeight: 500,
            margin: "16px 0 34px 0",
            color: COLORS.black,
          }}
        >
          Your AI Quote Filler
        </p>

        <div
          style={{
            maxWidth,
            margin: "0 auto",
            textAlign: "left",
          }}
        >
          <h2
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.blue,
              margin: "2rem 0 22px 0",
            }}
          >
            Select Insurance Type
          </h2>

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
                    setParseStatus("");
                  }}
                  onMouseEnter={() => setHoveredCard(item.key)}
                  onMouseLeave={() => setHoveredCard("")}
                  disabled={!isEnabled}
                  style={{
                    background: COLORS.lightGrey,
                    borderRadius: 18,
                    padding: "14px 14px 12px 14px",
                    textAlign: "center",
                    minHeight: 148,
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
                      height: 76,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 6,
                    }}
                  >
                    <img
                      src={item.icon}
                      alt={item.label}
                      style={{
                        width: 66,
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
                      fontSize: 15,
                      fontWeight: 500,
                      fontFamily: "Poppins, sans-serif",
                      color: isEnabled ? COLORS.black : COLORS.disabledText,
                      transition: "all 200ms ease",
                      lineHeight: 1.2,
                    }}
                  >
                    {item.label}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            maxWidth,
            margin: "24px auto 0",
            textAlign: "left",
          }}
        >
          <h2
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.blue,
              margin: "5rem 0 10px 0",
            }}
          >
            Select Advisor
          </h2>

          <div ref={advisorDropdownRef} style={{ position: "relative" }}>
            <input
              type="text"
              value={advisorInputValue}
              onChange={(e) => {
                setAdvisorSearch(e.target.value);
                setIsAdvisorDropdownOpen(true);
              }}
              onFocus={() => {
                setAdvisorSearch("");
                setIsAdvisorDropdownOpen(true);
              }}
              placeholder="Search by name"
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: COLORS.lightGrey,
                border: "none",
                borderRadius: 12,
                color: COLORS.black,
                fontSize: 16,
                fontFamily: "Poppins, sans-serif",
                outline: "none",
                padding: "0 14px",
                height: 52,
              }}
            />

            {isAdvisorDropdownOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "60px",
                  left: 0,
                  right: 0,
                  maxHeight: 260,
                  overflowY: "auto",
                  background: "#FFFFFF",
                  borderRadius: 12,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                  border: "1px solid #E8E8E8",
                  zIndex: 10,
                }}
              >
                {filteredAdvisors.length > 0 ? (
                  filteredAdvisors.map((advisor) => (
                    <button
                      key={advisor.name}
                      type="button"
                      onClick={() => handleAdvisorSelect(advisor)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 14px",
                        background: "#FFFFFF",
                        border: "none",
                        borderBottom: "1px solid #F1F1F1",
                        cursor: "pointer",
                        fontFamily: "Poppins, sans-serif",
                        fontSize: 14,
                        color: COLORS.black,
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{advisor.name}</div>
                      <div
                        style={{
                          fontSize: 12,
                          color: COLORS.subtextGrey,
                          marginTop: 2,
                        }}
                      >
                        {advisor.office_address || advisor.email || ""}
                      </div>
                    </button>
                  ))
                ) : (
                  <div
                    style={{
                      padding: "12px 14px",
                      fontSize: 14,
                      color: COLORS.subtextGrey,
                      fontFamily: "Poppins, sans-serif",
                    }}
                  >
                    No advisors found
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            maxWidth,
            margin: "22px auto 0 auto",
            textAlign: "left",
          }}
        >
          <h2
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.blue,
              margin: "5rem 0 22px 0",
            }}
          >
            Upload Quote Document
          </h2>

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
                uploaderEnabled
                  ? uploaderActive
                    ? COLORS.blue
                    : COLORS.borderGrey
                  : COLORS.borderGrey
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

              {isParsing && parseStatus ? (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 13,
                    color: COLORS.black,
                    fontWeight: 500,
                  }}
                >
                  {parseStatus}
                </div>
              ) : null}
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

        <div
          style={{
            maxWidth: extractedMaxWidth,
            margin: "42px auto 0",
            textAlign: "left",
          }}
        >
          <h2
            style={{
              fontSize: 28,
              fontWeight: 700,
              color: COLORS.blue,
              margin: "0 0 6px 0",
            }}
          >
            Extracted Values
          </h2>

          <div
            style={{
              fontSize: 18,
              fontWeight: 500,
              fontFamily: "Poppins, sans-serif",
              color: COLORS.black,
              marginBottom: 22,
            }}
          >
            Please double check the information is correct and edit where needed
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            {EXTRACTED_ROWS.map((row, rowIndex) => (
              <div
                key={rowIndex}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(20, minmax(0, 1fr))",
                  gap: 18,
                  alignItems: "start",
                }}
              >
                {row.map(({ key, span }) => (
                  <div
                    key={key}
                    style={{
                      gridColumn: `span ${span}`,
                      minWidth: 0,
                    }}
                  >
                    <FieldControl
                      fieldKey={key}
                      label={LABEL_MAP[key]}
                      value={formData[key] || ""}
                      onChange={updateField}
                      isLoading={loadingFields[key]}
                      isFinal={finalizedFields[key]}
                      hideStatus={NO_STATUS_FIELDS.has(key)}
                    />
                  </div>
                ))}
              </div>
            ))}
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
              onMouseEnter={() => {
                if (!isGenerating) setIsGenerateHovered(true);
              }}
              onMouseLeave={() => setIsGenerateHovered(false)}
              style={{
                background: COLORS.blue,
                color: "#FFFFFF",
                border: "none",
                borderRadius: 14,
                minHeight: 56,
                padding: "0 28px",
                fontSize: 16,
                fontWeight: 500,
                fontFamily: "Poppins, sans-serif",
                cursor: isGenerating ? "not-allowed" : "pointer",
                boxShadow:
                  !isGenerating && isGenerateHovered
                    ? `0 0 32px ${COLORS.hoverShadow}`
                    : "0 0 0 rgba(0,0,0,0)",
                transition: "all 200ms ease",
              }}
            >
              {isGenerating ? "GENERATING..." : "Generate + Download Quote"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldControl({
  fieldKey,
  label,
  value,
  onChange,
  isLoading,
  isFinal,
  hideStatus = false,
}) {
  const showSkeleton = isLoading && !value;

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

  const wrapperStyle = {
    position: "relative",
  };

  const statusStyle = {
    fontSize: 12,
    color: isFinal ? COLORS.blue : COLORS.subtextGrey,
    fontWeight: 500,
    lineHeight: 1,
    marginLeft: 8,
    whiteSpace: "nowrap",
  };

  const skeletonStyle = {
    position: "absolute",
    inset: 0,
    borderRadius: 12,
    background:
      "linear-gradient(90deg, #F2F2F2 0%, #E8E8E8 50%, #F2F2F2 100%)",
    backgroundSize: "200% 100%",
    animation: "quotifyShimmer 1.2s infinite linear",
    pointerEvents: "none",
  };

  const statusText = hideStatus
    ? ""
    : showSkeleton
      ? "Extracting..."
      : isFinal && value
        ? "Verified"
        : value
          ? "Draft"
          : "";

  const labelBlock = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 0,
        marginBottom: 8,
        minHeight: 20,
      }}
    >
      <label
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: COLORS.black,
          lineHeight: 1.2,
        }}
      >
        {label}
      </label>

      {statusText ? <div style={statusStyle}>{statusText}</div> : null}
    </div>
  );

  if (YES_NO_FIELDS.has(fieldKey)) {
    const normalized = String(value).trim().toLowerCase();
    const selectValue =
      normalized === "yes" ? "Yes" : normalized === "no" ? "No" : "";

    return (
      <div>
        {labelBlock}

        <div style={wrapperStyle}>
          <select
            value={selectValue}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            style={{
              ...commonInputStyle,
              height: 52,
              padding: "0 14px",
              appearance: "auto",
              cursor: "pointer",
              opacity: showSkeleton ? 0.35 : 1,
            }}
          >
            <option value=""></option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>

          {showSkeleton ? <div style={skeletonStyle} /> : null}
        </div>
      </div>
    );
  }

  if (TEXTAREA_FIELDS.has(fieldKey)) {
    return (
      <div>
        {labelBlock}

        <div style={wrapperStyle}>
          <textarea
            value={value}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            rows={3}
            style={{
              ...commonInputStyle,
              padding: "14px",
              minHeight: 96,
              resize: "vertical",
              opacity: showSkeleton ? 0.35 : 1,
            }}
          />

          {showSkeleton ? <div style={skeletonStyle} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      {labelBlock}

      <div style={wrapperStyle}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(fieldKey, e.target.value)}
          style={{
            ...commonInputStyle,
            height: 52,
            padding: "0 14px",
            opacity: showSkeleton ? 0.35 : 1,
          }}
        />

        {showSkeleton ? <div style={skeletonStyle} /> : null}
      </div>
    </div>
  );
}