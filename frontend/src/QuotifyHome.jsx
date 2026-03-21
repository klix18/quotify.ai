import React from "react";
import COLORS from "./colors";
import { INSURANCE_OPTIONS, INSURANCE_HEADER_MAP } from "./insuranceOptions";
import {
  HOMEOWNERS_FIELDS,
  HOMEOWNERS_YES_NO_FIELDS,
  HOMEOWNERS_AGENT_FIELDS,
  HOMEOWNERS_CLIENT_FIELDS,
  HOMEOWNERS_LABEL_MAP,
  HOMEOWNERS_ROWS,
  EMPTY_HOMEOWNERS_FORM,
} from "./homeownersConfig";
import {
  AUTO_POLICY_HEADER_FIELDS,
  AUTO_POLICY_LABEL_MAP,
  AUTO_PREMIUM_SUMMARY_FIELDS,
  AUTO_PREMIUM_LABEL_MAP,
  EMPTY_AUTO_FORM,
  emptyDriver,
  emptyCoverage,
  emptyVehicle,
} from "./autoConfig";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export default function QuotifyHome() {
  const [selectedInsurance, setSelectedInsurance] = React.useState("homeowners");
  const [hoveredInsurance, setHoveredInsurance] = React.useState("");
  const [isBrowseHovered, setIsBrowseHovered] = React.useState(false);
  const [isGenerateHovered, setIsGenerateHovered] = React.useState(false);
  const [isAdvisorHovered, setIsAdvisorHovered] = React.useState(false);
  const [advisors, setAdvisors] = React.useState([]);
  const [advisorSearch, setAdvisorSearch] = React.useState("");
  const [isAdvisorDropdownOpen, setIsAdvisorDropdownOpen] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [fileName, setFileName] = React.useState("");
  const [homeownersForm, setHomeownersForm] = React.useState(EMPTY_HOMEOWNERS_FORM);
  const [autoForm, setAutoForm] = React.useState({
    ...EMPTY_AUTO_FORM,
    drivers: [emptyDriver()],
    vehicles: [emptyVehicle()],
  });
  const [isParsing, setIsParsing] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [parseStatus, setParseStatus] = React.useState("");

  const [homeownersManual, setHomeownersManual] = React.useState(
    () => Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false]))
  );
  const [homeownersLoading, setHomeownersLoading] = React.useState(
    () => Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false]))
  );
  const [homeownersFinalized, setHomeownersFinalized] = React.useState(
    () => Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false]))
  );

  const fileInputRef = React.useRef(null);
  const advisorDropdownRef = React.useRef(null);

  const uploaderEnabled = selectedInsurance === "homeowners" || selectedInsurance === "auto";
  const uploaderActive = uploaderEnabled && isDragging;
  const informationHeader =
    INSURANCE_HEADER_MAP[selectedInsurance] || "Insurance Information";

  const selectedAdvisorName =
    selectedInsurance === "homeowners"
      ? homeownersForm.agent_name || ""
      : autoForm.agent_name || "";

  const advisorInputValue = isAdvisorDropdownOpen ? advisorSearch : selectedAdvisorName;

  const resetHomeownersFieldState = () => {
    setHomeownersLoading(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
    setHomeownersFinalized(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
    setHomeownersManual(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
  };

  const startHomeownersFieldState = () => {
    setHomeownersLoading(
      Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, !key.startsWith("agent_")]))
    );
    setHomeownersFinalized(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
    setHomeownersManual(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
  };

  const onBrowseClick = () => fileInputRef.current?.click();

  const updateHomeownersField = (key, value) => {
    setHomeownersForm((prev) => ({ ...prev, [key]: value }));
    setHomeownersManual((prev) => ({ ...prev, [key]: true }));
  };

  const updateAutoField = (key, value) => {
    setAutoForm((prev) => ({ ...prev, [key]: value }));
  };

  const updateAutoPremiumField = (key, value) => {
    setAutoForm((prev) => ({
      ...prev,
      premium_summary: {
        ...prev.premium_summary,
        [key]: value,
      },
    }));
  };

  const updateAutoDriver = (index, key, value) => {
    setAutoForm((prev) => {
      const nextDrivers = [...prev.drivers];
      nextDrivers[index] = { ...nextDrivers[index], [key]: value };
      return { ...prev, drivers: nextDrivers };
    });
  };

  const addDriver = () => {
    setAutoForm((prev) => ({
      ...prev,
      drivers: [...prev.drivers, emptyDriver()],
    }));
  };

  const removeDriver = (index) => {
    setAutoForm((prev) => ({
      ...prev,
      drivers: prev.drivers.filter((_, i) => i !== index),
    }));
  };

  const updateAutoVehicle = (index, key, value) => {
    setAutoForm((prev) => {
      const nextVehicles = [...prev.vehicles];
      nextVehicles[index] = { ...nextVehicles[index], [key]: value };
      return { ...prev, vehicles: nextVehicles };
    });
  };

  const updateAutoVehicleDiscounts = (index, value) => {
    setAutoForm((prev) => {
      const nextVehicles = [...prev.vehicles];
      nextVehicles[index] = {
        ...nextVehicles[index],
        vehicle_discounts: splitLines(value),
      };
      return { ...prev, vehicles: nextVehicles };
    });
  };

  const updateAutoCoverage = (vehicleIndex, coverageIndex, key, value) => {
    setAutoForm((prev) => {
      const nextVehicles = [...prev.vehicles];
      const nextCoverages = [...nextVehicles[vehicleIndex].coverages];
      nextCoverages[coverageIndex] = {
        ...nextCoverages[coverageIndex],
        [key]: value,
      };
      nextVehicles[vehicleIndex] = {
        ...nextVehicles[vehicleIndex],
        coverages: nextCoverages,
      };
      return { ...prev, vehicles: nextVehicles };
    });
  };

  const addVehicle = () => {
    setAutoForm((prev) => ({
      ...prev,
      vehicles: [...prev.vehicles, emptyVehicle()],
    }));
  };

  const removeVehicle = (index) => {
    setAutoForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.filter((_, i) => i !== index),
    }));
  };

  const updatePolicyCoverage = (index, key, value) => {
    setAutoForm((prev) => {
      const next = [...prev.policy_level_coverages];
      next[index] = { ...next[index], [key]: value };
      return { ...prev, policy_level_coverages: next };
    });
  };

  const addPolicyCoverage = () => {
    setAutoForm((prev) => ({
      ...prev,
      policy_level_coverages: [...prev.policy_level_coverages, emptyCoverage("")],
    }));
  };

  const removePolicyCoverage = (index) => {
    setAutoForm((prev) => ({
      ...prev,
      policy_level_coverages: prev.policy_level_coverages.filter((_, i) => i !== index),
    }));
  };

  const updateDiscountList = (groupKey, value) => {
    setAutoForm((prev) => ({
      ...prev,
      discounts: {
        ...prev.discounts,
        [groupKey]: splitLines(value),
      },
    }));
  };

  React.useEffect(() => {
    const loadAdvisors = async () => {
      try {
        const resp = await fetch(`${API_BASE_URL}/api/advisors`);
        if (!resp.ok) return;
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
        setIsAdvisorHovered(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedAdvisorName]);

  const handleAdvisorSelect = (advisor) => {
    setAdvisorSearch(advisor.name || "");
    setIsAdvisorDropdownOpen(false);

    if (selectedInsurance === "homeowners") {
      setHomeownersForm((prev) => ({
        ...prev,
        agent_name: advisor.name || "",
        agent_address: advisor.office_address || "",
        agent_phone: advisor.phone || "",
        agent_email: advisor.email || "",
      }));
      setHomeownersManual((prev) => ({
        ...prev,
        agent_name: false,
        agent_address: false,
        agent_phone: false,
        agent_email: false,
      }));
    } else if (selectedInsurance === "auto") {
      setAutoForm((prev) => ({
        ...prev,
        agent_name: advisor.name || "",
        agent_address: advisor.office_address || "",
        agent_phone: advisor.phone || "",
        agent_email: advisor.email || "",
      }));
    }
  };

  const parseHomeownersFile = async (file) => {
    setFileName(file.name);
    setErrorMessage("");
    setParseStatus("Uploading PDF...");
    setIsParsing(true);
    startHomeownersFieldState();

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

      setHomeownersForm((prev) => ({
        ...EMPTY_HOMEOWNERS_FORM,
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

        setHomeownersForm((prev) => ({
          ...prev,
          ...restPatch,
        }));

        setHomeownersLoading((prev) => {
          const next = { ...prev };
          for (const key of keys) next[key] = false;
          return next;
        });

        if (isFinal) {
          setHomeownersFinalized((prev) => {
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

      setHomeownersForm((prev) => ({
        ...prev,
        ...restPayload,
      }));

      setHomeownersLoading(
        Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false]))
      );

      setHomeownersFinalized((prev) => {
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
      resetHomeownersFieldState();
    } finally {
      setIsParsing(false);
    }
  };

  const parseAutoFile = async (file) => {
    setFileName(file.name);
    setErrorMessage("");
    setParseStatus("Uploading PDF...");
    setIsParsing(true);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-auto-quote`, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        let detail = "Failed to parse auto quote.";
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
        } catch (_) {}
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("Streaming response body is not available.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData = null;

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

          if ((message.type === "draft_patch" || message.type === "final_patch") && message.data) {
            setAutoForm((prev) => ({
              ...prev,
              ...message.data,
              premium_summary: {
                ...prev.premium_summary,
                ...(message.data.premium_summary || {}),
              },
              discounts: {
                ...prev.discounts,
                ...(message.data.discounts || {}),
              },
            }));
          }

          if (message.type === "result") {
            finalData = message.data;
          }

          if (message.type === "error") {
            throw new Error(message.error || "Streaming parse failed.");
          }
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);
          if (message.type === "result") finalData = message.data;
          if (message.type === "error") throw new Error(message.error || "Streaming parse failed.");
        } catch (_) {}
      }

      if (!finalData) {
        throw new Error("No final parsed result was returned.");
      }

      setAutoForm((prev) => ({
        ...prev,
        ...finalData,
        premium_summary: {
          ...prev.premium_summary,
          ...(finalData.premium_summary || {}),
        },
        discounts: {
          ...prev.discounts,
          ...(finalData.discounts || {}),
        },
      }));

      setParseStatus("Done.");
    } catch (error) {
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
    } finally {
      setIsParsing(false);
    }
  };

  const generateAndDownloadQuote = async () => {
    setErrorMessage("");
    setIsGenerating(true);

    try {
      const endpoint =
        selectedInsurance === "homeowners"
          ? `${API_BASE_URL}/api/generate-homeowners-quote`
          : `${API_BASE_URL}/api/generate-auto-quote`;

      const payload = selectedInsurance === "homeowners" ? homeownersForm : autoForm;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let detail =
          selectedInsurance === "homeowners"
            ? "Failed to generate homeowners quote."
            : "Failed to generate auto quote.";
        try {
          const json = await response.json();
          detail = json?.detail || detail;
        } catch (_) {}
        throw new Error(detail);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      let outFileName =
        selectedInsurance === "homeowners"
          ? "homeowners_quote_filled.pdf"
          : "auto_quote_filled.pdf";

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
      setErrorMessage(
        error.message || "Something went wrong while generating the quote."
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFile = async (file) => {
    if (!file || !uploaderEnabled) return;
    if (selectedInsurance === "homeowners") {
      await parseHomeownersFile(file);
    } else if (selectedInsurance === "auto") {
      await parseAutoFile(file);
    }
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

  const insuranceReady = !!selectedInsurance;
  const advisorReady = !!selectedAdvisorName;
  const uploadReady = !!fileName;

  const homeownersCompletedFields = HOMEOWNERS_FIELDS.filter(
    ([key]) => String(homeownersForm[key] || "").trim() !== ""
  ).length;

  const autoCompletedEstimate = getAutoCompletionCount(autoForm);

  return (
    <div
      style={{
        height: "100vh",
        overflow: "hidden",
        background: COLORS.pageBg,
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

          *::-webkit-scrollbar {
            width: 10px;
            height: 10px;
          }

          *::-webkit-scrollbar-thumb {
            background: #D4E2F4;
            border-radius: 999px;
          }

          *::-webkit-scrollbar-track {
            background: transparent;
          }
        `}
      </style>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px minmax(0, 1fr)",
          height: "100vh",
        }}
      >
        <aside
          style={{
            background: "#F7FAFF",
            borderRight: `1px solid ${COLORS.borderGrey}`,
            padding: "18px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            height: "100vh",
            boxSizing: "border-box",
            minHeight: 0,
            overflow: "hidden",
            paddingBottom: 36,
          }}
        >
          <div style={{ padding: "6px 4px 10px 4px" }}>
            <img
              src="/Combination_Blue_Medium.png"
              alt="Sizemore Insurance"
              style={{ height: 30, marginBottom: 12 }}
            />

            <div
              style={{
                fontFamily: "SentientCustom, Georgia, serif",
                fontSize: 34,
                lineHeight: 0.95,
                letterSpacing: "-0.05em",
                marginBottom: 8,
              }}
            >
              The Sizemore Snapshot
            </div>

            <div
              style={{
                fontSize: 13,
                color: COLORS.mutedText,
                lineHeight: 1.45,
              }}
            >
              AI quote intake, extraction, review, and download in one workspace.
            </div>
          </div>

          <SidebarBlock
            title="Insurance Type"
            status={insuranceReady}
            style={{
              flex: 1,
              minHeight: 220,
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 8,
                overflowY: "auto",
                flex: 1,
                minHeight: 0,
                paddingRight: 2,
              }}
            >
              {INSURANCE_OPTIONS.map((item) => {
                const isSelected = selectedInsurance === item.key;
                const isHovered = hoveredInsurance === item.key;

                return (
                  <button
                    key={item.key}
                    type="button"
                    disabled={!item.enabled}
                    onClick={() => {
                      if (!item.enabled) return;
                      setSelectedInsurance(item.key);
                      setErrorMessage("");
                      setParseStatus("");
                      setIsDragging(false);
                      setFileName("");
                    }}
                    onMouseEnter={() => setHoveredInsurance(item.key)}
                    onMouseLeave={() => setHoveredInsurance("")}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: `1px solid ${isSelected ? COLORS.blue : COLORS.borderGrey}`,
                      background: isSelected ? COLORS.blueSoft : COLORS.white,
                      cursor: item.enabled ? "pointer" : "not-allowed",
                      opacity: item.enabled ? 1 : 0.55,
                      transition: "all 200ms ease",
                      boxShadow: isHovered ? `0 0 24px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
                      textAlign: "left",
                    }}
                  >
                    <img
                      src={item.icon}
                      alt={item.label}
                      style={{
                        width: 24,
                        height: 24,
                        objectFit: "contain",
                        filter: item.enabled ? "none" : COLORS.disabledIcon,
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: item.enabled ? COLORS.black : COLORS.disabledText,
                      }}
                    >
                      {item.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </SidebarBlock>

          <SidebarBlock title="Advisor" status={advisorReady}>
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
                  setIsAdvisorHovered(true);
                }}
                onMouseEnter={() => setIsAdvisorHovered(true)}
                onMouseLeave={() => setIsAdvisorHovered(false)}
                placeholder="Search by name"
                style={{
                  width: "100%",
                  height: 44,
                  borderRadius: 12,
                  border: `1px solid ${isAdvisorDropdownOpen ? COLORS.blue : COLORS.borderGrey}`,
                  background: COLORS.white,
                  padding: "0 40px 0 12px",
                  fontSize: 14,
                  fontFamily: "Poppins, sans-serif",
                  outline: "none",
                  transition: "all 200ms ease",
                  boxSizing: "border-box",
                  boxShadow:
                    isAdvisorHovered || isAdvisorDropdownOpen
                      ? `0 0 24px ${COLORS.hoverShadow}`
                      : "0 0 0 rgba(0,0,0,0)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: COLORS.blue,
                  pointerEvents: "none",
                }}
              >
                ▾
              </div>

              {isAdvisorDropdownOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: 50,
                    left: 0,
                    right: 0,
                    zIndex: 20,
                    background: COLORS.white,
                    border: `1px solid ${COLORS.borderGrey}`,
                    borderRadius: 14,
                    boxShadow: `0 0 32px ${COLORS.hoverShadow}`,
                    maxHeight: 240,
                    overflowY: "auto",
                  }}
                >
                  {filteredAdvisors.length > 0 ? (
                    filteredAdvisors.map((advisor, index) => (
                      <button
                        key={advisor.name}
                        type="button"
                        onClick={() => handleAdvisorSelect(advisor)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          background: COLORS.white,
                          padding: "10px 12px",
                          cursor: "pointer",
                          borderBottom:
                            index === filteredAdvisors.length - 1
                              ? "none"
                              : `1px solid ${COLORS.borderGrey}`,
                        }}
                      >
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{advisor.name}</div>
                        <div style={{ fontSize: 12, color: COLORS.mutedText, marginTop: 2 }}>
                          {advisor.office_address || advisor.email || ""}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div style={{ padding: 12, fontSize: 13, color: COLORS.subtextGrey }}>
                      No advisors found
                    </div>
                  )}
                </div>
              )}
            </div>
          </SidebarBlock>

          <SidebarBlock title="Upload Quote" status={uploadReady}>
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
                borderRadius: 16,
                border: `1.5px dashed ${
                  uploaderEnabled
                    ? uploaderActive
                      ? COLORS.blue
                      : COLORS.borderStrong
                    : COLORS.borderGrey
                }`,
                background: uploaderActive ? COLORS.blueSoft : COLORS.white,
                padding: 14,
                transition: "all 200ms ease",
                opacity: uploaderEnabled ? 1 : 0.5,
                pointerEvents: uploaderEnabled ? "auto" : "none",
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: uploaderEnabled ? COLORS.blue : COLORS.black,
                  lineHeight: 1.4,
                  marginBottom: 6,
                }}
              >
                {fileName || "Drag & drop PDF"}
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: COLORS.mutedText,
                  lineHeight: 1.4,
                  marginBottom: 12,
                }}
              >
                PDF only · up to 200MB
              </div>

              {isParsing && parseStatus ? (
                <div
                  style={{
                    fontSize: 12,
                    color: COLORS.black,
                    fontWeight: 500,
                    marginBottom: 10,
                  }}
                >
                  {parseStatus}
                </div>
              ) : null}

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
                  width: "100%",
                  height: 42,
                  borderRadius: 12,
                  border: `1px solid ${isBrowseHovered ? COLORS.blueDark : COLORS.borderGrey}`,
                  background: isBrowseHovered ? COLORS.blue : COLORS.lightGrey,
                  color: isBrowseHovered ? COLORS.white : uploaderEnabled ? COLORS.blue : COLORS.black,
                  fontWeight: 600,
                  fontSize: 13,
                  fontFamily: "Poppins, sans-serif",
                  cursor: uploaderEnabled && !isParsing ? "pointer" : "not-allowed",
                  transition: "all 200ms ease",
                }}
              >
                {isParsing ? "PARSING..." : "Browse Files"}
              </button>
            </div>
          </SidebarBlock>

          {errorMessage ? (
            <div
              style={{
                marginTop: "auto",
                borderRadius: 14,
                border: `1px solid ${COLORS.dangerBorder}`,
                background: COLORS.dangerSoft,
                color: COLORS.danger,
                padding: 12,
                fontSize: 12,
                lineHeight: 1.45,
              }}
            >
              {errorMessage}
            </div>
          ) : (
            <div style={{ marginTop: "auto" }} />
          )}
        </aside>

        <main
          style={{
            minWidth: 0,
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            background:
              "radial-gradient(circle at top, rgba(23,101,212,0.06) 0%, rgba(23,101,212,0.015) 20%, #FFFFFF 56%)",
          }}
        >
          <div
            style={{
              flex: "0 0 auto",
              padding: "22px 28px 18px 28px",
              borderBottom: `1px solid ${COLORS.borderGrey}`,
              background: "rgba(255,255,255,0.78)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 20,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "SentientCustom, Georgia, serif",
                    fontSize: 34,
                    lineHeight: 0.95,
                    letterSpacing: "-0.04em",
                    color: COLORS.blue,
                    marginBottom: 8,
                  }}
                >
                  {informationHeader}
                </div>

                <div
                  style={{
                    fontSize: 14,
                    color: COLORS.mutedText,
                    fontWeight: 500,
                  }}
                >
                  Review the extracted information and edit anything that needs correction.
                </div>
              </div>

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
                  color: COLORS.white,
                  border: `1px solid ${COLORS.blue}`,
                  borderRadius: 14,
                  minHeight: 48,
                  padding: "0 24px",
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "Poppins, sans-serif",
                  cursor: isGenerating ? "not-allowed" : "pointer",
                  transition: "all 200ms ease",
                  boxShadow: isGenerateHovered ? `0 0 28px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
                  flexShrink: 0,
                }}
              >
                {isGenerating ? "GENERATING..." : "Generate + Download Quote"}
              </button>
            </div>
          </div>

          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              padding: "22px 28px 24px 28px",
            }}
          >
            {selectedInsurance === "homeowners" ? (
              <HomeownersPanel
                form={homeownersForm}
                onFieldChange={updateHomeownersField}
                loadingFields={homeownersLoading}
                finalizedFields={homeownersFinalized}
                manuallyEditedFields={homeownersManual}
              />
            ) : selectedInsurance === "auto" ? (
              <AutoPanel
                form={autoForm}
                onFieldChange={updateAutoField}
                onPremiumFieldChange={updateAutoPremiumField}
                onDriverChange={updateAutoDriver}
                onAddDriver={addDriver}
                onRemoveDriver={removeDriver}
                onVehicleChange={updateAutoVehicle}
                onVehicleDiscountsChange={updateAutoVehicleDiscounts}
                onCoverageChange={updateAutoCoverage}
                onAddVehicle={addVehicle}
                onRemoveVehicle={removeVehicle}
                onPolicyCoverageChange={updatePolicyCoverage}
                onAddPolicyCoverage={addPolicyCoverage}
                onRemovePolicyCoverage={removePolicyCoverage}
                onDiscountListChange={updateDiscountList}
              />
            ) : (
              <UnavailablePanel label={selectedInsurance} />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function HomeownersPanel({
  form,
  onFieldChange,
  loadingFields,
  finalizedFields,
  manuallyEditedFields,
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
            const rowHasAgentFields = row.every(({ key }) => HOMEOWNERS_AGENT_FIELDS.has(key));
            const rowHasClientFields = row.every(({ key }) => HOMEOWNERS_CLIENT_FIELDS.has(key));

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
                      {rowHasClientFields ? "Client Information" : "Advisor Information"}
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

function AutoPanel({
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
                      onChange={(key, value) => onVehicleChange(vehicleIndex, key, value)}
                    />
                  </div>
                  <div style={{ gridColumn: "span 3" }}>
                    <FieldControl
                      fieldKey="vin"
                      label="VIN"
                      value={vehicle.vin || ""}
                      onChange={(key, value) => onVehicleChange(vehicleIndex, key, value)}
                    />
                  </div>
                  <div style={{ gridColumn: "span 3" }}>
                    <FieldControl
                      fieldKey="garaging_zip_county"
                      label="Garaging ZIP / County"
                      value={vehicle.garaging_zip_county || ""}
                      onChange={(key, value) => onVehicleChange(vehicleIndex, key, value)}
                    />
                  </div>
                  <div style={{ gridColumn: "span 2" }}>
                    <FieldControl
                      fieldKey="vehicle_subtotal"
                      label="Vehicle Subtotal"
                      value={vehicle.vehicle_subtotal || ""}
                      onChange={(key, value) => onVehicleChange(vehicleIndex, key, value)}
                    />
                  </div>
                  <div style={{ gridColumn: "span 12" }}>
                    <FieldControl
                      fieldKey="lienholder_loss_payee"
                      label="Lienholder / Loss Payee"
                      value={vehicle.lienholder_loss_payee || ""}
                      onChange={(key, value) => onVehicleChange(vehicleIndex, key, value)}
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
                    onChange={(_, value) => onVehicleDiscountsChange(vehicleIndex, value)}
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
                  onChange={(key, value) => onPolicyCoverageChange(index, key, value)}
                />
                <FieldControl
                  fieldKey="limit"
                  label="Limit"
                  value={coverage.limit || ""}
                  onChange={(key, value) => onPolicyCoverageChange(index, key, value)}
                />
                <FieldControl
                  fieldKey="deductible"
                  label="Deductible"
                  value={coverage.deductible || ""}
                  onChange={(key, value) => onPolicyCoverageChange(index, key, value)}
                />
                <FieldControl
                  fieldKey="premium"
                  label="Premium"
                  value={coverage.premium || ""}
                  onChange={(key, value) => onPolicyCoverageChange(index, key, value)}
                />
                <FieldControl
                  fieldKey="status"
                  label="Status"
                  value={coverage.status || ""}
                  onChange={(key, value) => onPolicyCoverageChange(index, key, value)}
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
              onChange={(_, value) => onDiscountListChange("available_not_applied", value)}
              multiline
              rows={6}
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

function UnavailablePanel({ label }) {
  return (
    <div
      style={{
        background: "linear-gradient(180deg, #FFFFFF 0%, #FBFDFF 100%)",
        border: `1px solid ${COLORS.borderGrey}`,
        borderRadius: 24,
        boxShadow: "0 18px 44px rgba(23,101,212,0.07)",
        padding: 28,
      }}
    >
      <div
        style={{
          fontFamily: "SentientCustom, Georgia, serif",
          fontSize: 28,
          color: COLORS.blue,
          marginBottom: 10,
        }}
      >
        {label} UI Coming Soon
      </div>
      <div
        style={{
          fontSize: 14,
          color: COLORS.mutedText,
        }}
      >
        This insurance type is not enabled yet.
      </div>
    </div>
  );
}

function SidebarBlock({ title, status, children, style = {} }) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: `1px solid ${COLORS.borderGrey}`,
        borderRadius: 18,
        padding: 14,
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: status ? COLORS.green : COLORS.danger,
            flexShrink: 0,
          }}
        />
        <div
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: COLORS.blue,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          {title}
        </div>
      </div>
      {children}
    </div>
  );
}

function SectionCard({ title, children, action = null }) {
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontFamily: "SentientCustom, Georgia, serif",
              fontSize: 22,
              lineHeight: 1,
              letterSpacing: "-0.03em",
              color: COLORS.black,
            }}
          >
            {title}
          </div>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}

function SubCard({ title, action = null, children }) {
  return (
    <div
      style={{
        border: `1px solid ${COLORS.borderGrey}`,
        borderRadius: 18,
        background: COLORS.white,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 15,
            color: COLORS.black,
          }}
        >
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SmallActionButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${COLORS.blue}`,
        background: COLORS.blueSoft,
        color: COLORS.blue,
        borderRadius: 999,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "Poppins, sans-serif",
      }}
    >
      {children}
    </button>
  );
}

function SmallGhostButton({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: `1px solid ${COLORS.borderGrey}`,
        background: COLORS.white,
        color: COLORS.mutedText,
        borderRadius: 999,
        padding: "8px 12px",
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "Poppins, sans-serif",
      }}
    >
      {children}
    </button>
  );
}

function EmptyHint({ text }) {
  return (
    <div
      style={{
        border: `1px dashed ${COLORS.borderGrey}`,
        background: COLORS.lightGrey,
        borderRadius: 16,
        padding: 16,
        color: COLORS.mutedText,
        fontSize: 13,
      }}
    >
      {text}
    </div>
  );
}

function FieldControl({
  fieldKey,
  label,
  value,
  onChange,
  isLoading = false,
  isFinal = false,
  isAgentField = false,
  isManuallyEdited = false,
  isYesNo = false,
  multiline = false,
  rows = 4,
}) {
  const [isHovered, setIsHovered] = React.useState(false);
  const showSkeleton = isLoading && !value;
  const hasValue = String(value ?? "").trim() !== "";

  const commonInputStyle = {
    width: "100%",
    boxSizing: "border-box",
    background: isAgentField ? COLORS.inputBgAlt : COLORS.inputBg,
    border: `1px solid ${
      !hasValue && !showSkeleton
        ? COLORS.dangerBorder
        : isHovered
          ? COLORS.blueBorder
          : isAgentField
            ? COLORS.borderStrong
            : COLORS.borderGrey
    }`,
    borderRadius: 12,
    color: COLORS.black,
    fontSize: 13,
    fontFamily: "Poppins, sans-serif",
    outline: "none",
    transition: "all 200ms ease",
  };

  const wrapperStyle = {
    position: "relative",
    transition: "all 200ms ease",
    borderRadius: 12,
    boxShadow: isHovered ? `0 0 24px ${COLORS.hoverShadow}` : "0 0 0 rgba(0,0,0,0)",
  };

  const successStatus = (text) => ({
    text,
    bg: COLORS.greenSoft,
    color: COLORS.green,
    border: COLORS.greenBorder,
  });

  const getStatus = () => {
    if (showSkeleton) {
      return {
        text: "Extracting",
        bg: "#F2F4F7",
        color: "#7E8A99",
        border: "#E2E8F0",
      };
    }

    if (!hasValue) {
      return {
        text: "Missing",
        bg: COLORS.dangerSoft,
        color: COLORS.danger,
        border: COLORS.dangerBorder,
      };
    }

    if (isAgentField) return successStatus("Selected");
    if (isManuallyEdited) return successStatus("Manual");
    if (isFinal) return successStatus("Verified");

    return {
      text: "Draft",
      bg: "#F3F5F7",
      color: "#6E7B89",
      border: "#E3E8EE",
    };
  };

  const status = getStatus();

  const skeletonStyle = {
    position: "absolute",
    inset: 0,
    borderRadius: 12,
    background: "linear-gradient(90deg, #F2F4F7 0%, #E8EDF3 50%, #F2F4F7 100%)",
    backgroundSize: "200% 100%",
    animation: "quotifyShimmer 1.2s infinite linear",
    pointerEvents: "none",
  };

  const labelBlock = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 8,
        minHeight: 22,
        flexWrap: "wrap",
      }}
    >
      <label
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#2C3742",
          lineHeight: 1,
          letterSpacing: "-0.01em",
          fontFamily: "Poppins, sans-serif",
          display: "flex",
          alignItems: "center",
          height: 22,
        }}
      >
        {label}
      </label>

      <div
        style={{
          fontSize: 10,
          color: status.color,
          background: status.bg,
          border: `1px solid ${status.border}`,
          fontWeight: 700,
          lineHeight: 1,
          padding: "0 8px",
          borderRadius: 999,
          whiteSpace: "nowrap",
          letterSpacing: "0.02em",
          height: 22,
          display: "flex",
          alignItems: "center",
          boxSizing: "border-box",
          fontFamily: "Poppins, sans-serif",
        }}
      >
        {status.text}
      </div>
    </div>
  );

  if (isYesNo) {
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
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            style={{
              ...commonInputStyle,
              height: 42,
              padding: "0 12px",
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

  if (multiline) {
    return (
      <div>
        {labelBlock}
        <div style={wrapperStyle}>
          <textarea
            value={value}
            onChange={(e) => onChange(fieldKey, e.target.value)}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            rows={rows}
            style={{
              ...commonInputStyle,
              padding: "10px 12px",
              minHeight: rows * 20,
              lineHeight: 1.45,
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
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{
            ...commonInputStyle,
            height: 42,
            padding: "0 12px",
            opacity: showSkeleton ? 0.35 : 1,
          }}
        />
        {showSkeleton ? <div style={skeletonStyle} /> : null}
      </div>
    </div>
  );
}

function splitLines(value) {
  return String(value || "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
}

function getAutoCompletionCount(form) {
  let count = 0;

  const topLevel = [
    "named_insured",
    "mailing_address",
    "phone_number",
    "quote_effective_date",
    "quote_expiration_date",
    "policy_term",
    "agent_name",
    "agent_address",
    "agent_phone",
    "agent_email",
  ];

  topLevel.forEach((key) => {
    if (String(form[key] || "").trim()) count += 1;
  });

  (form.drivers || []).forEach((driver) => {
    if (String(driver.driver_name || "").trim()) count += 1;
    if (String(driver.license_state || "").trim()) count += 1;
  });

  (form.vehicles || []).forEach((vehicle) => {
    if (String(vehicle.year_make_model || "").trim()) count += 1;
    if (String(vehicle.vin || "").trim()) count += 1;
    if (String(vehicle.garaging_zip_county || "").trim()) count += 1;
    if (String(vehicle.lienholder_loss_payee || "").trim()) count += 1;
    if (String(vehicle.vehicle_subtotal || "").trim()) count += 1;

    (vehicle.coverages || []).forEach((coverage) => {
      if (String(coverage.coverage_name || "").trim()) count += 1;
      if (String(coverage.limit || "").trim()) count += 1;
      if (String(coverage.deductible || "").trim()) count += 1;
      if (String(coverage.premium || "").trim()) count += 1;
      if (String(coverage.status || "").trim()) count += 1;
    });
  });

  Object.values(form.premium_summary || {}).forEach((value) => {
    if (String(value || "").trim()) count += 1;
  });

  count += (form.policy_level_coverages || []).length;
  count += (form.discounts?.policy_level || []).length;
  count += (form.discounts?.vehicle_level || []).length;
  count += (form.discounts?.available_not_applied || []).length;

  return count;
}