import React from "react";
import { useUser, useAuth } from "@clerk/clerk-react";
import COLORS from "../lib/colors";
import { trackEvent, getManualFieldNames } from "../lib/trackEvent";
import {
  startParseTimer,
  logParseComplete,
  logQuoteGenerated,
} from "../lib/devMetrics";
import { INSURANCE_OPTIONS } from "../configs/insuranceOptions";
import {
  HOMEOWNERS_FIELDS,
  EMPTY_HOMEOWNERS_FORM,
} from "../configs/homeownersConfig";
import {
  EMPTY_AUTO_FORM,
  emptyDriver,
  emptyVehicle,
} from "../configs/autoConfig";
import {
  EMPTY_DWELLING_FORM,
  emptyProperty,
} from "../configs/dwellingConfig";
import {
  EMPTY_COMMERCIAL_FORM,
  emptyWcClassCode,
} from "../configs/commercialConfig";
import {
  EMPTY_BUNDLE_FORM,
  emptyDriver as emptyBundleDriver,
  emptyVehicle as emptyBundleVehicle,
} from "../configs/bundleConfig";
import HomeownersPanel from "../panels/HomeownersPanel";
import AutoPanel from "../panels/AutoPanel";
import DwellingPanel from "../panels/DwellingPanel";
import CommercialPanel from "../panels/CommercialPanel";
import BundlePanel from "../panels/BundlePanel";
import { triggerSparkleFlow } from "../lib/sparkleFlow";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

// FastAPI returns validation errors (e.g. 422) with `detail` as an ARRAY
// of objects ({ loc, msg, type, ... }). Rendering that directly produces
// "[object Object]" in the UI. This helper coerces whatever shape `detail`
// has into a readable string.
function extractErrorDetail(payload, fallback) {
  const raw = payload?.detail;
  if (!raw) return fallback;
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const joined = raw
      .map((e) => (typeof e === "string" ? e : e?.msg || JSON.stringify(e)))
      .filter(Boolean)
      .join("; ");
    return joined || fallback;
  }
  if (typeof raw === "object") {
    return raw.msg || JSON.stringify(raw);
  }
  return String(raw);
}

export default function QuotifyHome({ isAdmin }) {
  const { user } = useUser();
  const { getToken } = useAuth();
  const [selectedInsurance, setSelectedInsurance] = React.useState("homeowners");
  const [hoveredInsurance, setHoveredInsurance] = React.useState("");
  const [isBrowseHovered, setIsBrowseHovered] = React.useState(false);
  const [isGenerateHovered, setIsGenerateHovered] = React.useState(false);
  const [isClearHovered, setIsClearHovered] = React.useState(false);
  const [isAdvisorHovered, setIsAdvisorHovered] = React.useState(false);
  const [advisors, setAdvisors] = React.useState([]);
  const [advisorSearch, setAdvisorSearch] = React.useState("");
  const [isAdvisorDropdownOpen, setIsAdvisorDropdownOpen] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const [fileName, setFileName] = React.useState("");
  const [bundleFileNames, setBundleFileNames] = React.useState([]);
  const [bundleUploadMode, setBundleUploadMode] = React.useState("combined"); // "combined" | "separate"
  const [separateHomeFile, setSeparateHomeFile] = React.useState(null);
  const [separateAutoFile, setSeparateAutoFile] = React.useState(null);
  const separateHomeInputRef = React.useRef(null);
  const separateAutoInputRef = React.useRef(null);
  // Homeowners + wind/hail (separate) — used when the primary homeowners
  // quote doesn't include wind coverage and a standalone wind/hail quote
  // must be merged in.
  const [homeownersUploadMode, setHomeownersUploadMode] = React.useState("combined"); // "combined" | "separate"
  const [homeMainFile, setHomeMainFile] = React.useState(null);
  const [homeWindFile, setHomeWindFile] = React.useState(null);
  const homeMainInputRef = React.useRef(null);
  const homeWindInputRef = React.useRef(null);
  // Dwelling + wind/hail (separate) — same pattern, wind quote covers the
  // same set of properties as the primary dwelling quote.
  const [dwellingUploadMode, setDwellingUploadMode] = React.useState("combined"); // "combined" | "separate"
  const [dwellingMainFile, setDwellingMainFile] = React.useState(null);
  const [dwellingWindFile, setDwellingWindFile] = React.useState(null);
  const dwellingMainInputRef = React.useRef(null);
  const dwellingWindInputRef = React.useRef(null);
  const [homeownersForm, setHomeownersForm] = React.useState(EMPTY_HOMEOWNERS_FORM);
  const [autoForm, setAutoForm] = React.useState({
    ...EMPTY_AUTO_FORM,
    drivers: [emptyDriver()],
    vehicles: [emptyVehicle()],
  });
  const [isParsing, setIsParsing] = React.useState(false);
  const [isGenerating, setIsGenerating] = React.useState(false);
  const generateBtnRef = React.useRef(null);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [parseStatus, setParseStatus] = React.useState("");

  // Track viewport width so we can shrink the left sidebar on smaller
  // screens (non-MacBook-Pro laptops), giving the right panel more room
  // for the actual intake form. MacBook Pro 14" reports 1512px and 16"
  // reports 1728px, so 1440 is a safe "MacBook Pro or bigger" threshold.
  const SIDEBAR_COMPACT_BREAKPOINT = 1440;
  const [winW, setWinW] = React.useState(
    typeof window !== "undefined" ? window.innerWidth : 1920
  );
  React.useEffect(() => {
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isCompactViewport = winW < SIDEBAR_COMPACT_BREAKPOINT;
  const sidebarWidth = isCompactViewport ? 248 : 320;

  const [autoIsLoading, setAutoIsLoading] = React.useState(false);
  const [autoIsParsed, setAutoIsParsed] = React.useState(false);
  const [autoManual, setAutoManual] = React.useState({});
  const [autoConfidence, setAutoConfidence] = React.useState({});

  const [homeownersManual, setHomeownersManual] = React.useState(
    () => Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false]))
  );
  const [homeownersLoading, setHomeownersLoading] = React.useState(
    () => Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false]))
  );
  const [homeownersFinalized, setHomeownersFinalized] = React.useState(
    () => Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false]))
  );
  const [homeownersConfidence, setHomeownersConfidence] = React.useState({});

  const [dwellingForm, setDwellingForm] = React.useState({
    ...EMPTY_DWELLING_FORM,
    properties: [emptyProperty()],
  });
  const [dwellingIsLoading, setDwellingIsLoading] = React.useState(false);
  const [dwellingIsParsed, setDwellingIsParsed] = React.useState(false);
  const [dwellingManual, setDwellingManual] = React.useState({});
  const [dwellingConfidence, setDwellingConfidence] = React.useState({});

  const [commercialForm, setCommercialForm] = React.useState(EMPTY_COMMERCIAL_FORM);
  const [commercialIsLoading, setCommercialIsLoading] = React.useState(false);
  const [commercialIsParsed, setCommercialIsParsed] = React.useState(false);
  const [commercialManual, setCommercialManual] = React.useState({});
  const [commercialConfidence, setCommercialConfidence] = React.useState({});
  const [windParsing, setWindParsing] = React.useState(false);
  const [windParseStatus, setWindParseStatus] = React.useState("");
  const [windFileName, setWindFileName] = React.useState("");

  const [bundleForm, setBundleForm] = React.useState({
    ...EMPTY_BUNDLE_FORM,
    drivers: [emptyBundleDriver()],
    vehicles: [emptyBundleVehicle()],
  });
  const [bundleIsLoading, setBundleIsLoading] = React.useState(false);
  const [bundleIsParsed, setBundleIsParsed] = React.useState(false);
  const [bundleManual, setBundleManual] = React.useState({});
  const [bundleConfidence, setBundleConfidence] = React.useState({});
  // Skill version from the most recent parse — passed to analytics on quote generation
  const [lastSkillVersion, setLastSkillVersion] = React.useState("");
  // parse_id from the most recent parse — used by the dev-metrics logger to
  // join a "quote" event back to its originating "parse" event. Ref (not
  // state) because no UI reads this; it just needs to survive across renders
  // from parse completion to quote click.
  const lastParseIdRef = React.useRef("");

  const abortControllerRef = React.useRef(null);
  const fileInputRef = React.useRef(null);
  const advisorDropdownRef = React.useRef(null);
  const mainRef = React.useRef(null);
  const orbPrimaryRef = React.useRef(null);
  const orbCyanRef = React.useRef(null);
  const orbTrailRef = React.useRef(null);
  const mouseTarget = React.useRef({ x: 0, y: 0 });
  const orbPrimary = React.useRef({ x: 0, y: 0 });
  const orbCyan = React.useRef({ x: 0, y: 0 });
  const orbTrail = React.useRef({ x: 0, y: 0 });
  const velocity = React.useRef({ x: 0, y: 0 });
  const prevSmooth = React.useRef({ x: 0, y: 0 });
  const rafId = React.useRef(null);
  const mouseInside = React.useRef(false);

  React.useEffect(() => {
    const lerp = (a, b, t) => a + (b - a) * t;
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

    const tick = () => {
      // Lerp each orb at different speeds
      orbPrimary.current.x = lerp(orbPrimary.current.x, mouseTarget.current.x, 0.04);
      orbPrimary.current.y = lerp(orbPrimary.current.y, mouseTarget.current.y, 0.04);
      orbCyan.current.x = lerp(orbCyan.current.x, mouseTarget.current.x, 0.018);
      orbCyan.current.y = lerp(orbCyan.current.y, mouseTarget.current.y, 0.018);
      orbTrail.current.x = lerp(orbTrail.current.x, mouseTarget.current.x, 0.007);
      orbTrail.current.y = lerp(orbTrail.current.y, mouseTarget.current.y, 0.007);

      // Velocity from primary orb movement
      const vx = orbPrimary.current.x - prevSmooth.current.x;
      const vy = orbPrimary.current.y - prevSmooth.current.y;
      velocity.current.x = lerp(velocity.current.x, vx, 0.15);
      velocity.current.y = lerp(velocity.current.y, vy, 0.15);
      prevSmooth.current.x = orbPrimary.current.x;
      prevSmooth.current.y = orbPrimary.current.y;

      // Stretch based on speed
      const speed = Math.sqrt(velocity.current.x ** 2 + velocity.current.y ** 2);
      const angle = Math.atan2(velocity.current.y, velocity.current.x) * (180 / Math.PI);
      const stretchAmt = clamp(1 + speed * 0.06, 1, 2.0);
      const squishAmt = clamp(1 - speed * 0.015, 0.7, 1);

      const opacity = mouseInside.current ? 1 : 0;

      // Primary blue orb — tight follow
      if (orbPrimaryRef.current) {
        orbPrimaryRef.current.style.transform =
          `translate(${orbPrimary.current.x}px, ${orbPrimary.current.y}px) translate(-50%, -50%) rotate(${angle}deg) scale(${stretchAmt}, ${squishAmt})`;
        orbPrimaryRef.current.style.opacity = opacity;
      }

      // Cyan orb — medium lag
      if (orbCyanRef.current) {
        const cStretch = clamp(1 + speed * 0.04, 1, 1.6);
        const cSquish = clamp(1 - speed * 0.01, 0.8, 1);
        orbCyanRef.current.style.transform =
          `translate(${orbCyan.current.x}px, ${orbCyan.current.y}px) translate(-50%, -50%) rotate(${angle}deg) scale(${cStretch}, ${cSquish})`;
        orbCyanRef.current.style.opacity = opacity;
      }

      // Trail orb — heavy lag
      if (orbTrailRef.current) {
        orbTrailRef.current.style.transform =
          `translate(${orbTrail.current.x}px, ${orbTrail.current.y}px) translate(-50%, -50%)`;
        orbTrailRef.current.style.opacity = opacity;
      }

      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  const handleMainMouseMove = React.useCallback((e) => {
    const el = mainRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    mouseTarget.current.x = e.clientX - rect.left;
    mouseTarget.current.y = e.clientY - rect.top;
    if (!mouseInside.current) mouseInside.current = true;
  }, []);

  const handleMainMouseLeave = React.useCallback(() => {
    mouseInside.current = false;
  }, []);

  const uploaderEnabled = selectedInsurance === "homeowners" || selectedInsurance === "auto" || selectedInsurance === "dwelling" || selectedInsurance === "commercial" || selectedInsurance === "bundle";
  const uploaderActive = uploaderEnabled && isDragging;
  const selectedAdvisorName =
    homeownersForm.agent_name || autoForm.agent_name || dwellingForm.agent_name || commercialForm.agent_name || bundleForm.agent_name || "";

  const advisorInputValue = isAdvisorDropdownOpen ? advisorSearch : selectedAdvisorName;

  const resetHomeownersFieldState = () => {
    setHomeownersLoading(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
    setHomeownersFinalized(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
    setHomeownersManual(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
    setHomeownersConfidence({});
  };

  const startHomeownersFieldState = () => {
    setHomeownersLoading(
      Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, !key.startsWith("agent_")]))
    );
    setHomeownersFinalized(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
    setHomeownersManual(Object.fromEntries(HOMEOWNERS_FIELDS.map(([key]) => [key, false])));
    setHomeownersConfidence({});
  };

  const handleClearSnapshot = () => {
    // Reset all forms to their empty state
    setHomeownersForm(EMPTY_HOMEOWNERS_FORM);
    setAutoForm({ ...EMPTY_AUTO_FORM, drivers: [emptyDriver()], vehicles: [emptyVehicle()] });
    setDwellingForm({ ...EMPTY_DWELLING_FORM, properties: [emptyProperty()] });
    setCommercialForm(EMPTY_COMMERCIAL_FORM);
    setBundleForm({ ...EMPTY_BUNDLE_FORM, drivers: [emptyBundleDriver()], vehicles: [emptyBundleVehicle()] });
    // Reset field-level states
    resetHomeownersFieldState();
    setAutoIsParsed(false);
    setAutoManual({});
    setAutoConfidence({});
    setDwellingIsParsed(false);
    setDwellingManual({});
    setDwellingConfidence({});
    setCommercialIsParsed(false);
    setCommercialManual({});
    setCommercialConfidence({});
    setBundleIsParsed(false);
    setBundleManual({});
    setBundleConfidence({});
    // Reset upload / file state
    setFileName("");
    setBundleFileNames([]);
    setSeparateHomeFile(null);
    setSeparateAutoFile(null);
    setBundleUploadMode("combined");
    setWindFileName("");
    // Reset status
    setErrorMessage("");
    setParseStatus("");
    setIsParsing(false);
    setIsGenerating(false);
    setAdvisorSearch("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const onBrowseClick = () => fileInputRef.current?.click();

  const cancelParsing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsParsing(false);
    setParseStatus("");
    setErrorMessage("Operation cancelled.");
    // Reset per-type loading flags
    setAutoIsLoading(false);
    setDwellingIsLoading(false);
    setCommercialIsLoading(false);
    setBundleIsLoading(false);
    resetHomeownersFieldState();
  };

  const updateHomeownersField = (key, value) => {
    setHomeownersForm((prev) => ({ ...prev, [key]: value }));
    setHomeownersManual((prev) => ({ ...prev, [key]: true }));
  };

  const updateAutoField = (path, value) => {
    setAutoManual((prev) => ({ ...prev, [path]: true }));
    setAutoForm((prev) => {
      const parts = path.split(".");
      if (parts.length === 1) {
        return { ...prev, [path]: value };
      }
      if (parts[0] === "coverages") {
        return { ...prev, coverages: { ...prev.coverages, [parts[1]]: value } };
      }
      if (parts[0] === "payment_options") {
        if (parts.length === 3) {
          return {
            ...prev,
            payment_options: {
              ...prev.payment_options,
              [parts[1]]: {
                ...(prev.payment_options[parts[1]] || {}),
                [parts[2]]: value,
              },
            },
          };
        }
      }
      return prev;
    });
  };

  const updateAutoDriver = (index, key, value) => {
    setAutoManual((prev) => ({ ...prev, [`drivers.${index}.${key}`]: true }));
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
    setAutoManual((prev) => ({ ...prev, [`vehicles.${index}.${key}`]: true }));
    setAutoForm((prev) => {
      const nextVehicles = [...prev.vehicles];
      nextVehicles[index] = { ...nextVehicles[index], [key]: value };
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

  const togglePaidInFullDiscount = () => {
    setAutoForm((prev) => ({
      ...prev,
      payment_options: {
        ...prev.payment_options,
        show_paid_in_full_discount: !prev.payment_options.show_paid_in_full_discount,
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

    const agentFields = {
      agent_name: advisor.name || "",
      agent_address: advisor.office_address || "",
      agent_phone: advisor.phone || "",
      agent_email: advisor.email || "",
    };

    // Apply to all insurance forms universally
    setHomeownersForm((prev) => ({ ...prev, ...agentFields }));
    setHomeownersManual((prev) => ({
      ...prev,
      agent_name: false,
      agent_address: false,
      agent_phone: false,
      agent_email: false,
    }));

    setAutoForm((prev) => ({ ...prev, ...agentFields }));
    setAutoManual((prev) => {
      const next = { ...prev };
      delete next.agent_name;
      delete next.agent_address;
      delete next.agent_phone;
      delete next.agent_email;
      return next;
    });

    setDwellingForm((prev) => ({ ...prev, ...agentFields }));
    setDwellingManual((prev) => {
      const next = { ...prev };
      delete next.agent_name;
      delete next.agent_address;
      delete next.agent_phone;
      delete next.agent_email;
      return next;
    });

    setCommercialForm((prev) => ({ ...prev, ...agentFields }));
    setCommercialManual((prev) => {
      const next = { ...prev };
      delete next.agent_name;
      delete next.agent_address;
      delete next.agent_phone;
      delete next.agent_email;
      return next;
    });

    setBundleForm((prev) => ({ ...prev, ...agentFields }));
    setBundleManual((prev) => {
      const next = { ...prev };
      delete next.agent_name;
      delete next.agent_address;
      delete next.agent_phone;
      delete next.agent_email;
      return next;
    });
  };

  const parseHomeownersFile = async (file, windFile = null) => {
    // When a separate wind/hail PDF is attached, show both names so the
    // user can see that the merge is happening on the backend.
    setFileName(windFile ? `${file.name} + ${windFile.name}` : file.name);
    setErrorMessage("");
    setParseStatus("Extracting...");
    setIsParsing(true);
    startHomeownersFieldState();

    // Dev-metrics: start the latency stopwatch BEFORE the upload so we
    // capture real end-to-end time (including network upload, not just
    // LLM work). Logged on parse completion in the finally block below.
    const __devSession = startParseTimer({
      insuranceType: "homeowners",
      pdfCount: windFile ? 2 : 1,
    });
    lastParseIdRef.current = __devSession.parseId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      body.append("file", file);
      if (windFile) body.append("wind_file", windFile);

      const response = await fetch(`${API_BASE_URL}/api/parse-quote?insurance_type=homeowners`, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "Failed to parse homeowners quote.";
        try {
          const payload = await response.json();
          detail = extractErrorDetail(payload, detail);
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
      let finalConfidence = {};

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
            setParseStatus("Extracting...");
          }

          if (message.type === "final_patch" && message.data) {
            setParseStatus("Extracting...");
            applyPatch(message.data, true);
          }

          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
            setLastSkillVersion(message.skill_version || "");
            setParseStatus("Extracting...");
          }

          if (message.type === "error") {
            throw new Error(message.error || "Streaming parse failed.");
          }
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);

          if (message.type === "final_patch" && message.data) {
            applyPatch(message.data, true);
          } else if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
            setLastSkillVersion(message.skill_version || "");
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

      setHomeownersConfidence(finalConfidence);
      setParseStatus("Verified");

    } catch (error) {
      if (error.name === "AbortError") { __devSession.aborted = true; return; }
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      resetHomeownersFieldState();
      setHomeownersConfidence({});
    } finally {
      setIsParsing(false);
      // Log the end-to-end parse latency. Fire-and-forget: errors here
      // are swallowed inside devMetrics, we don't want to block the UI.
      logParseComplete(__devSession);
    }
  };

  const deepMergeAutoForm = (prev, patch) => {
    const next = { ...prev };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "drivers" || key === "vehicles") {
        next[key] = value;
      } else if (key === "coverages" && typeof value === "object") {
        next.coverages = { ...prev.coverages, ...value };
      } else if (key === "payment_options" && typeof value === "object") {
        next.payment_options = { ...prev.payment_options };
        for (const [pk, pv] of Object.entries(value)) {
          if (typeof pv === "object" && pv !== null && !Array.isArray(pv)) {
            next.payment_options[pk] = {
              ...(prev.payment_options[pk] || {}),
              ...pv,
            };
          } else {
            next.payment_options[pk] = pv;
          }
        }
        // Auto-reveal the Paid-in-Full Discount section whenever the AI
        // actually populates any of its fields — simulates the user
        // clicking "+ Add Paid-in-Full Discount" for them.
        const pif = next.payment_options.paid_in_full_discount;
        if (pif && Object.values(pif).some((v) => String(v || "").trim() !== "")) {
          next.payment_options.show_paid_in_full_discount = true;
        }
      } else if (key === "premium_summary" && typeof value === "object") {
        // Map legacy premium_summary from parser to top-level fields
        if (value.total_premium) next.total_premium = value.total_premium;
        if (value.paid_in_full_discount) next.paid_in_full_discount = value.paid_in_full_discount;
        if (value.total_pay_in_full) next.total_pay_in_full = value.total_pay_in_full;
      } else {
        next[key] = value;
      }
    }
    return next;
  };

  const parseAutoFile = async (file) => {
    setFileName(file.name);
    setErrorMessage("");
    setParseStatus("Extracting...");
    setIsParsing(true);
    setAutoIsLoading(true);
    setAutoIsParsed(false);
    setAutoManual({});
    setAutoConfidence({});

    const __devSession = startParseTimer({
      insuranceType: "auto",
      pdfCount: 1,
    });
    lastParseIdRef.current = __devSession.parseId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-quote?insurance_type=auto`, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "Failed to parse auto quote.";
        try {
          const payload = await response.json();
          detail = extractErrorDetail(payload, detail);
        } catch (_) {}
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("Streaming response body is not available.");
      }

      // Reset form but preserve agent fields
      setAutoForm((prev) => ({
        ...EMPTY_AUTO_FORM,
        drivers: [emptyDriver()],
        vehicles: [emptyVehicle()],
        agent_name: prev.agent_name || "",
        agent_address: prev.agent_address || "",
        agent_phone: prev.agent_phone || "",
        agent_email: prev.agent_email || "",
      }));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData = null;
      let finalConfidence = {};

      const applyAutoPatch = (patch) => {
        if (!patch || Object.keys(patch).length === 0) return;
        const {
          agent_name,
          agent_address,
          agent_phone,
          agent_email,
          ...restPatch
        } = patch;

        setAutoForm((prev) => deepMergeAutoForm(prev, restPatch));
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
            setParseStatus("Extracting...");
          }

          if (message.type === "final_patch" && message.data) {
            setParseStatus("Extracting...");
            applyAutoPatch(message.data);
          }

          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
            setLastSkillVersion(message.skill_version || "");
            setParseStatus("Extracting...");
          }

          if (message.type === "error") {
            throw new Error(message.error || "Streaming parse failed.");
          }
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);
          if (message.type === "final_patch" && message.data) {
            applyAutoPatch(message.data);
          } else if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
            setLastSkillVersion(message.skill_version || "");
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
        ...restFinal
      } = finalData || {};

      setAutoForm((prev) => deepMergeAutoForm(prev, restFinal));
      setAutoConfidence(finalConfidence);

      setAutoIsLoading(false);
      setAutoIsParsed(true);
      setParseStatus("Verified");

    } catch (error) {
      if (error.name === "AbortError") { __devSession.aborted = true; return; }
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      setAutoIsLoading(false);
      setAutoIsParsed(false);
      setAutoConfidence({});
    } finally {
      setIsParsing(false);
      logParseComplete(__devSession);
    }
  };

  /* ── Dwelling field handlers ────────────────────────────────── */
  const updateDwellingField = (path, value) => {
    setDwellingManual((prev) => ({ ...prev, [path]: true }));
    setDwellingForm((prev) => ({ ...prev, [path]: value }));
  };

  const updateDwellingProperty = (index, key, value) => {
    setDwellingManual((prev) => ({ ...prev, [`properties.${index}.${key}`]: true }));
    setDwellingForm((prev) => {
      const next = [...prev.properties];
      next[index] = { ...next[index], [key]: value };
      return { ...prev, properties: next };
    });
  };

  const addDwellingProperty = () => {
    setDwellingForm((prev) => ({
      ...prev,
      properties: [...prev.properties, emptyProperty()],
    }));
  };

  const removeDwellingProperty = (index) => {
    setDwellingForm((prev) => ({
      ...prev,
      properties: prev.properties.filter((_, i) => i !== index),
    }));
  };

  const updateDwellingPaymentPlan = (planKey, field, value) => {
    setDwellingManual((prev) => ({ ...prev, [`payment_plans.${planKey}.${field}`]: true }));
    setDwellingForm((prev) => ({
      ...prev,
      payment_plans: {
        ...prev.payment_plans,
        [planKey]: { ...(prev.payment_plans[planKey] || {}), [field]: value },
      },
    }));
  };

  const toggleDwellingPaidInFullDiscount = () => {
    setDwellingForm((prev) => ({
      ...prev,
      payment_plans: {
        ...prev.payment_plans,
        show_paid_in_full_discount: !prev.payment_plans.show_paid_in_full_discount,
      },
    }));
  };

  /* ── Dwelling parser ────────────────────────────────────────── */
  const deepMergeDwellingForm = (prev, patch) => {
    const next = { ...prev };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "properties" && Array.isArray(value)) {
        next.properties = value;
      } else if (key === "premium_summary" && Array.isArray(value)) {
        // Map legacy premium_summary array to top-level fields
        if (value.length > 0) {
          const ps = value[0];
          if (ps.total_premium) next.total_premium = ps.total_premium;
        }
      } else if (key === "payment_plans" && typeof value === "object") {
        next.payment_plans = { ...prev.payment_plans };
        for (const [pk, pv] of Object.entries(value)) {
          if (typeof pv === "object" && pv !== null && !Array.isArray(pv)) {
            next.payment_plans[pk] = { ...(prev.payment_plans[pk] || {}), ...pv };
          } else {
            next.payment_plans[pk] = pv;
          }
        }
        // Auto-reveal the Paid-in-Full Discount section whenever the AI
        // actually populates any of its fields — simulates the user
        // clicking "+ Add Paid-in-Full Discount" for them.
        const pif = next.payment_plans.paid_in_full_discount;
        if (pif && Object.values(pif).some((v) => String(v || "").trim() !== "")) {
          next.payment_plans.show_paid_in_full_discount = true;
        }
      } else {
        next[key] = value;
      }
    }
    return next;
  };

  const parseDwellingFile = async (file, windFile = null) => {
    // Show both filenames when a separate wind/hail PDF is merged in.
    setFileName(windFile ? `${file.name} + ${windFile.name}` : file.name);
    setErrorMessage("");
    setParseStatus("Extracting...");
    setIsParsing(true);
    setDwellingIsLoading(true);
    setDwellingIsParsed(false);
    setDwellingManual({});
    setDwellingConfidence({});

    const __devSession = startParseTimer({
      insuranceType: "dwelling",
      pdfCount: windFile ? 2 : 1,
    });
    lastParseIdRef.current = __devSession.parseId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      body.append("file", file);
      if (windFile) body.append("wind_file", windFile);

      const response = await fetch(`${API_BASE_URL}/api/parse-quote?insurance_type=dwelling`, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "Failed to parse dwelling quote.";
        try {
          const payload = await response.json();
          detail = extractErrorDetail(payload, detail);
        } catch (_) {}
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("Streaming response body is not available.");
      }

      // Reset form but preserve agent fields
      setDwellingForm((prev) => ({
        ...EMPTY_DWELLING_FORM,
        properties: [emptyProperty()],
        agent_name: prev.agent_name || "",
        agent_address: prev.agent_address || "",
        agent_phone: prev.agent_phone || "",
        agent_email: prev.agent_email || "",
      }));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData = null;
      let finalConfidence = {};

      const applyDwellingPatch = (patch) => {
        if (!patch || Object.keys(patch).length === 0) return;
        const { agent_name, agent_address, agent_phone, agent_email, ...restPatch } = patch;
        setDwellingForm((prev) => deepMergeDwellingForm(prev, restPatch));
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
          try { message = JSON.parse(line); } catch { continue; }

          if (message.type === "status") setParseStatus("Extracting...");
          if (message.type === "final_patch" && message.data) {
            setParseStatus("Extracting...");
            applyDwellingPatch(message.data);
          }
          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
            setLastSkillVersion(message.skill_version || "");
            setParseStatus("Extracting...");
          }
          if (message.type === "error") {
            throw new Error(message.error || "Streaming parse failed.");
          }
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);
          if (message.type === "final_patch" && message.data) applyDwellingPatch(message.data);
          else if (message.type === "result") { finalData = message.data; finalConfidence = message.confidence || {}; setLastSkillVersion(message.skill_version || ""); }
          else if (message.type === "error") throw new Error(message.error || "Streaming parse failed.");
        } catch (_) {}
      }

      if (!finalData) throw new Error("No final parsed result was returned.");

      const { agent_name, agent_address, agent_phone, agent_email, ...restFinal } = finalData || {};
      setDwellingForm((prev) => deepMergeDwellingForm(prev, restFinal));
      setDwellingConfidence(finalConfidence);
      setDwellingIsLoading(false);
      setDwellingIsParsed(true);
      setParseStatus("Verified");

    } catch (error) {
      if (error.name === "AbortError") { __devSession.aborted = true; return; }
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      setDwellingIsLoading(false);
      setDwellingIsParsed(false);
      setDwellingConfidence({});
    } finally {
      setIsParsing(false);
      logParseComplete(__devSession);
    }
  };

  /* ── Commercial field handlers ─────────────────────────────── */
  const updateCommercialField = (path, value) => {
    setCommercialManual((prev) => ({ ...prev, [path]: true }));
    setCommercialForm((prev) => ({ ...prev, [path]: value }));
  };

  const updateCommercialWcClassCode = (index, key, value) => {
    setCommercialManual((prev) => ({ ...prev, [`wc_class_codes.${index}.${key}`]: true }));
    setCommercialForm((prev) => {
      const next = [...(prev.wc_class_codes || [])];
      next[index] = { ...next[index], [key]: value };
      return { ...prev, wc_class_codes: next };
    });
  };

  const addCommercialWcClassCode = () => {
    setCommercialForm((prev) => ({
      ...prev,
      wc_class_codes: [...(prev.wc_class_codes || []), emptyWcClassCode()],
    }));
  };

  const removeCommercialWcClassCode = (index) => {
    setCommercialForm((prev) => ({
      ...prev,
      wc_class_codes: (prev.wc_class_codes || []).filter((_, i) => i !== index),
    }));
  };

  /* ── Bundle field handlers ────────────────────────────────────── */
  const updateBundleField = (path, value) => {
    setBundleManual((prev) => ({ ...prev, [path]: true }));
    setBundleForm((prev) => {
      const parts = path.split(".");
      if (parts.length === 1) {
        return { ...prev, [path]: value };
      }
      if (parts[0] === "coverages") {
        return { ...prev, coverages: { ...prev.coverages, [parts[1]]: value } };
      }
      if (parts[0] === "payment_options") {
        if (parts.length === 3) {
          return {
            ...prev,
            payment_options: {
              ...prev.payment_options,
              [parts[1]]: {
                ...(prev.payment_options[parts[1]] || {}),
                [parts[2]]: value,
              },
            },
          };
        }
      }
      return prev;
    });
  };

  const updateBundleDriver = (index, key, value) => {
    setBundleManual((prev) => ({ ...prev, [`drivers.${index}.${key}`]: true }));
    setBundleForm((prev) => {
      const nextDrivers = [...prev.drivers];
      nextDrivers[index] = { ...nextDrivers[index], [key]: value };
      return { ...prev, drivers: nextDrivers };
    });
  };

  const addBundleDriver = () => {
    setBundleForm((prev) => ({
      ...prev,
      drivers: [...prev.drivers, emptyBundleDriver()],
    }));
  };

  const removeBundleDriver = (index) => {
    setBundleForm((prev) => ({
      ...prev,
      drivers: prev.drivers.filter((_, i) => i !== index),
    }));
  };

  const updateBundleVehicle = (index, key, value) => {
    setBundleManual((prev) => ({ ...prev, [`vehicles.${index}.${key}`]: true }));
    setBundleForm((prev) => {
      const nextVehicles = [...prev.vehicles];
      nextVehicles[index] = { ...nextVehicles[index], [key]: value };
      return { ...prev, vehicles: nextVehicles };
    });
  };

  const addBundleVehicle = () => {
    setBundleForm((prev) => ({
      ...prev,
      vehicles: [...prev.vehicles, emptyBundleVehicle()],
    }));
  };

  const removeBundleVehicle = (index) => {
    setBundleForm((prev) => ({
      ...prev,
      vehicles: prev.vehicles.filter((_, i) => i !== index),
    }));
  };

  const toggleBundlePaidInFullDiscount = () => {
    setBundleForm((prev) => ({
      ...prev,
      payment_options: {
        ...prev.payment_options,
        show_paid_in_full_discount: !prev.payment_options.show_paid_in_full_discount,
      },
    }));
  };

  /* ── Bundle parser ──────────────────────────────────────────── */
  const deepMergeBundleForm = (prev, patch) => {
    const next = { ...prev };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "drivers" || key === "vehicles") {
        next[key] = value;
      } else if (key === "coverages" && typeof value === "object") {
        next.coverages = { ...prev.coverages, ...value };
      } else if (key === "payment_options" && typeof value === "object") {
        next.payment_options = { ...prev.payment_options };
        for (const [pk, pv] of Object.entries(value)) {
          if (typeof pv === "object" && pv !== null && !Array.isArray(pv)) {
            next.payment_options[pk] = {
              ...(prev.payment_options[pk] || {}),
              ...pv,
            };
          } else {
            next.payment_options[pk] = pv;
          }
        }
        // Auto-reveal the Paid-in-Full Discount section whenever the AI
        // actually populates any of its fields — simulates the user
        // clicking "+ Add Paid-in-Full Discount" for them.
        const pif = next.payment_options.paid_in_full_discount;
        if (pif && Object.values(pif).some((v) => String(v || "").trim() !== "")) {
          next.payment_options.show_paid_in_full_discount = true;
        }
      } else {
        next[key] = value;
      }
    }
    return next;
  };

  const parseBundleFiles = async (files) => {
    const fileArr = Array.isArray(files) ? files : [files];
    const names = fileArr.map((f) => f.name);
    setBundleFileNames(names);
    setFileName(names.join(", "));
    setErrorMessage("");
    setParseStatus("Extracting...");
    setIsParsing(true);
    setBundleIsLoading(true);
    setBundleIsParsed(false);
    setBundleManual({});
    setBundleConfidence({});

    const __devSession = startParseTimer({
      insuranceType: "bundle",
      pdfCount: fileArr.length,
    });
    lastParseIdRef.current = __devSession.parseId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      // Backend expects `file` (primary PDF) and an optional `secondary_file`
      // (second PDF). Bundle separate mode fills both; combined mode only
      // fills the first. Sending repeated `files` fields returns 422.
      if (fileArr[0]) body.append("file", fileArr[0]);
      if (fileArr[1]) body.append("secondary_file", fileArr[1]);

      const response = await fetch(`${API_BASE_URL}/api/parse-quote?insurance_type=bundle`, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "Failed to parse bundle quote.";
        try {
          const payload = await response.json();
          detail = extractErrorDetail(payload, detail);
        } catch (_) {}
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("Streaming response body is not available.");
      }

      // Reset form but preserve agent fields
      setBundleForm((prev) => ({
        ...EMPTY_BUNDLE_FORM,
        drivers: [emptyBundleDriver()],
        vehicles: [emptyBundleVehicle()],
        agent_name: prev.agent_name || "",
        agent_address: prev.agent_address || "",
        agent_phone: prev.agent_phone || "",
        agent_email: prev.agent_email || "",
      }));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData = null;
      let finalConfidence = {};

      const applyBundlePatch = (patch) => {
        if (!patch || Object.keys(patch).length === 0) return;
        const { agent_name, agent_address, agent_phone, agent_email, ...restPatch } = patch;
        setBundleForm((prev) => deepMergeBundleForm(prev, restPatch));
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
          try { message = JSON.parse(line); } catch { continue; }

          if (message.type === "status") setParseStatus("Extracting...");
          if (message.type === "final_patch" && message.data) {
            setParseStatus("Extracting...");
            applyBundlePatch(message.data);
          }
          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
            setLastSkillVersion(message.skill_version || "");
            setParseStatus("Extracting...");
          }
          if (message.type === "error") {
            throw new Error(message.error || "Streaming parse failed.");
          }
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);
          if (message.type === "final_patch" && message.data) applyBundlePatch(message.data);
          else if (message.type === "result") { finalData = message.data; finalConfidence = message.confidence || {}; setLastSkillVersion(message.skill_version || ""); }
          else if (message.type === "error") throw new Error(message.error || "Streaming parse failed.");
        } catch (_) {}
      }

      if (!finalData) throw new Error("No final parsed result was returned.");

      const { agent_name, agent_address, agent_phone, agent_email, ...restFinal } = finalData || {};
      setBundleForm((prev) => deepMergeBundleForm(prev, restFinal));
      setBundleConfidence(finalConfidence);
      setBundleIsLoading(false);
      setBundleIsParsed(true);
      setParseStatus("Verified");

    } catch (error) {
      if (error.name === "AbortError") { __devSession.aborted = true; return; }
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      setBundleIsLoading(false);
      setBundleIsParsed(false);
      setBundleConfidence({});
    } finally {
      setIsParsing(false);
      logParseComplete(__devSession);
    }
  };

  /* ── Commercial parser ───────────────────────────────────────── */
  // Nested section keys that Gemini Pass 2 returns as sub-objects.
  // We flatten these into top-level keys so coverage fields populate in real-time.
  const COMMERCIAL_SECTION_KEYS = new Set([
    "commercial_property", "general_liability", "workers_comp",
    "excess_liability", "cyber", "wind_insurance",
  ]);

  const deepMergeCommercialForm = (prev, patch) => {
    const next = { ...prev };
    for (const [key, value] of Object.entries(patch)) {
      if (key === "wc_class_codes" && Array.isArray(value)) {
        next.wc_class_codes = value;
      } else if (key === "premium_lines" && Array.isArray(value)) {
        // Ignore premium_lines from parser (no longer used in UI)
      } else if (COMMERCIAL_SECTION_KEYS.has(key) && value && typeof value === "object" && !Array.isArray(value)) {
        // Flatten nested section objects (e.g., commercial_property.building_limit → building_limit)
        for (const [subKey, subValue] of Object.entries(value)) {
          next[subKey] = subValue;
        }
      } else {
        next[key] = value;
      }
    }
    return next;
  };

  const parseCommercialFile = async (file) => {
    setFileName(file.name);
    setErrorMessage("");
    setParseStatus("Extracting...");
    setIsParsing(true);
    setCommercialIsLoading(true);
    setCommercialIsParsed(false);
    setCommercialManual({});
    setCommercialConfidence({});

    const __devSession = startParseTimer({
      insuranceType: "commercial",
      pdfCount: 1,
    });
    lastParseIdRef.current = __devSession.parseId;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-quote?insurance_type=commercial`, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "Failed to parse commercial quote.";
        try {
          const payload = await response.json();
          detail = extractErrorDetail(payload, detail);
        } catch (_) {}
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error("Streaming response body is not available.");
      }

      // Reset form but preserve agent fields
      setCommercialForm((prev) => ({
        ...EMPTY_COMMERCIAL_FORM,
        agent_name: prev.agent_name || "",
        agent_address: prev.agent_address || "",
        agent_phone: prev.agent_phone || "",
        agent_email: prev.agent_email || "",
      }));

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData = null;
      let finalConfidence = {};

      const applyCommercialPatch = (patch) => {
        if (!patch || Object.keys(patch).length === 0) return;
        const { agent_name, agent_address, agent_phone, agent_email, ...restPatch } = patch;
        setCommercialForm((prev) => deepMergeCommercialForm(prev, restPatch));
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
          try { message = JSON.parse(line); } catch { continue; }

          if (message.type === "status") setParseStatus("Extracting...");
          if (message.type === "final_patch" && message.data) {
            setParseStatus("Extracting...");
            applyCommercialPatch(message.data);
          }
          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
            setLastSkillVersion(message.skill_version || "");
            setParseStatus("Extracting...");
          }
          if (message.type === "error") {
            throw new Error(message.error || "Streaming parse failed.");
          }
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);
          if (message.type === "final_patch" && message.data) applyCommercialPatch(message.data);
          else if (message.type === "result") { finalData = message.data; finalConfidence = message.confidence || {}; setLastSkillVersion(message.skill_version || ""); }
          else if (message.type === "error") throw new Error(message.error || "Streaming parse failed.");
        } catch (_) {}
      }

      if (!finalData) throw new Error("No final parsed result was returned.");

      const { agent_name, agent_address, agent_phone, agent_email, ...restFinal } = finalData || {};
      setCommercialForm((prev) => deepMergeCommercialForm(prev, restFinal));
      setCommercialConfidence(finalConfidence);
      setCommercialIsLoading(false);
      setCommercialIsParsed(true);
      setParseStatus("Verified");

    } catch (error) {
      if (error.name === "AbortError") { __devSession.aborted = true; return; }
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      setCommercialIsLoading(false);
      setCommercialIsParsed(false);
      setCommercialConfidence({});
    } finally {
      setIsParsing(false);
      logParseComplete(__devSession);
    }
  };

  /* ── Wind parser (inline, commercial sub-section) ───────────── */
  const parseWindFile = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setWindFileName(file.name);
    setWindParseStatus("Extracting...");
    setWindParsing(true);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-quote?insurance_type=wind`, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        let detail = "Failed to parse wind quote.";
        try {
          const payload = await response.json();
          detail = extractErrorDetail(payload, detail);
        } catch (_) {}
        throw new Error(detail);
      }

      if (!response.body) throw new Error("Streaming not available.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalData = null;
      let finalConfidence = {};

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          let message;
          try { message = JSON.parse(line); } catch { continue; }

          if (message.type === "status") setWindParseStatus("Extracting...");
          if (message.type === "final_patch" && message.data) {
            setCommercialForm((prev) => ({ ...prev, ...message.data }));
          }
          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
            setLastSkillVersion(message.skill_version || "");
          }
          if (message.type === "error") throw new Error(message.error || "Wind parse failed.");
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);
          if (message.type === "final_patch" && message.data) {
            setCommercialForm((prev) => ({ ...prev, ...message.data }));
          } else if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
          } else if (message.type === "error") throw new Error(message.error || "Wind parse failed.");
        } catch (_) {}
      }

      if (finalData) {
        setCommercialForm((prev) => ({ ...prev, ...finalData }));
        setCommercialConfidence((prev) => ({ ...prev, ...finalConfidence }));
      }
      setWindParseStatus("Verified");

    } catch (error) {
      setWindParseStatus("");
      setWindFileName("");
      setErrorMessage(error.message || "Wind parse failed.");
    } finally {
      setWindParsing(false);
    }
  };

  const generateAndDownloadQuote = async () => {
    setErrorMessage("");
    setIsGenerating(true);

    /* fire sparkle animation — fields dissolve into the button */
    triggerSparkleFlow(generateBtnRef.current);

    try {
      const endpointMap = {
        homeowners: `${API_BASE_URL}/api/generate-homeowners-quote`,
        auto: `${API_BASE_URL}/api/generate-auto-quote`,
        commercial: `${API_BASE_URL}/api/generate-commercial-quote`,
        dwelling: `${API_BASE_URL}/api/generate-dwelling-quote`,
        bundle: `${API_BASE_URL}/api/generate-bundle-quote`,
      };
      const endpoint = endpointMap[selectedInsurance] || endpointMap.homeowners;

      const payloadMap = {
        homeowners: homeownersForm,
        auto: autoForm,
        commercial: commercialForm,
        dwelling: dwellingForm,
        bundle: bundleForm,
      };
      const payload = payloadMap[selectedInsurance] || homeownersForm;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        let detail = `Failed to generate ${selectedInsurance} quote.`;
        try {
          const json = await response.json();
          detail = json?.detail || detail;
        } catch (_) {}
        throw new Error(detail);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get("content-disposition") || "";
      let outFileName = `${selectedInsurance}_quote_filled.pdf`;

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

      // Track workflow event for analytics
      const manualMap = {
        homeowners: homeownersManual,
        auto: autoManual,
        dwelling: dwellingManual,
        commercial: commercialManual,
        bundle: bundleManual,
      };
      const userName = user?.fullName
        || (user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : null)
        || user?.primaryEmailAddress?.emailAddress
        || "Unknown";
      // Pull client name out of whichever form corresponds to the selected insurance.
      // Homeowners/auto/bundle use `client_name`; dwelling/commercial use `named_insured`.
      const formForClient = (payloadMap[selectedInsurance] || {});
      const clientName = String(
        formForClient.client_name || formForClient.named_insured || ""
      ).trim();
      // AWAIT the tracking call. Fire-and-forget was causing the backend
      // POST to be cancelled when the browser started the PDF download
      // immediately after — the request never reached Railway, so the
      // row never appeared in analytics_events and the leaderboard
      // undercounted the user. trackEvent never throws, so this await
      // cannot break the quote flow; at worst it takes ~200ms extra.
      await trackEvent({
        userName,
        insuranceType: selectedInsurance,
        advisor: selectedAdvisorName,
        uploadedPdf: fileName,
        manuallyChangedFields: getManualFieldNames(manualMap[selectedInsurance] || {}),
        createdQuote: true,
        generatedPdf: outFileName,
        clientName,
        skillVersion: lastSkillVersion,
        getToken,
      });

      // Dev-metrics: log a "quote" event tied back to the most recent parse
      // via parse_id. Carries the manual-edit counters (with/without client
      // info) and the actual changed values so the viewer can show a
      // tester's corrections. Fire-and-forget — devMetrics swallows errors,
      // and the PDF has already been downloaded at this point anyway.
      logQuoteGenerated({
        parseId: lastParseIdRef.current,
        insuranceType: selectedInsurance,
        manualMap: manualMap[selectedInsurance] || {},
        formValues: formForClient,
      });
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
    } else if (selectedInsurance === "dwelling") {
      await parseDwellingFile(file);
    } else if (selectedInsurance === "commercial") {
      await parseCommercialFile(file);
    } else if (selectedInsurance === "bundle") {
      await parseBundleFiles([file]);
    }
  };

  const handleBundleFiles = async (fileList) => {
    if (!fileList || fileList.length === 0 || !uploaderEnabled) return;
    const pdfs = Array.from(fileList).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf")
    );
    if (pdfs.length === 0) return;
    if (pdfs.length > 2) {
      setErrorMessage("Bundle accepts at most 2 PDFs (one homeowners, one auto).");
      return;
    }
    await parseBundleFiles(pdfs);
  };

  const handleSeparateHomeFile = (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setSeparateHomeFile(file);
    setErrorMessage("");
  };

  const handleSeparateAutoFile = (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setSeparateAutoFile(file);
    setErrorMessage("");
  };

  /* ── Homeowners separate-mode helpers ─────────────────────── */
  const handleHomeMainFile = (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setHomeMainFile(file);
    setErrorMessage("");
  };
  const handleHomeWindFile = (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setHomeWindFile(file);
    setErrorMessage("");
  };

  /* ── Dwelling separate-mode helpers ───────────────────────── */
  const handleDwellingMainFile = (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setDwellingMainFile(file);
    setErrorMessage("");
  };
  const handleDwellingWindFile = (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setDwellingWindFile(file);
    setErrorMessage("");
  };

  /* ── Auto-parse trigger when both files are staged ──────────
     Separate-mode uploads fire parsing automatically the moment the
     second PDF is chosen, per the spec ("just make it immediately
     start parsing after both files are uploaded"). No manual
     "Parse Both Quotes" button in any insurance type. */
  React.useEffect(() => {
    if (
      selectedInsurance === "homeowners" &&
      homeownersUploadMode === "separate" &&
      homeMainFile &&
      homeWindFile &&
      !isParsing
    ) {
      parseHomeownersFile(homeMainFile, homeWindFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeMainFile, homeWindFile, homeownersUploadMode, selectedInsurance]);

  React.useEffect(() => {
    if (
      selectedInsurance === "dwelling" &&
      dwellingUploadMode === "separate" &&
      dwellingMainFile &&
      dwellingWindFile &&
      !isParsing
    ) {
      parseDwellingFile(dwellingMainFile, dwellingWindFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dwellingMainFile, dwellingWindFile, dwellingUploadMode, selectedInsurance]);

  React.useEffect(() => {
    if (
      selectedInsurance === "bundle" &&
      bundleUploadMode === "separate" &&
      separateHomeFile &&
      separateAutoFile &&
      !isParsing
    ) {
      parseBundleFiles([separateHomeFile, separateAutoFile]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [separateHomeFile, separateAutoFile, bundleUploadMode, selectedInsurance]);

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (selectedInsurance === "bundle") {
      await handleBundleFiles(e.dataTransfer.files);
    } else {
      const file = e.dataTransfer.files?.[0];
      await handleFile(file);
    }
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
  const uploadReady = (() => {
    if (selectedInsurance === "bundle" && bundleUploadMode === "separate") {
      return !!(separateHomeFile && separateAutoFile);
    }
    if (selectedInsurance === "homeowners" && homeownersUploadMode === "separate") {
      return !!(homeMainFile && homeWindFile);
    }
    if (selectedInsurance === "dwelling" && dwellingUploadMode === "separate") {
      return !!(dwellingMainFile && dwellingWindFile);
    }
    return !!fileName;
  })();

  // Required fields per insurance type: client info, advisor info, and policy
  const REQUIRED_FIELDS_MAP = {
    homeowners: [
      "client_name", "agent_name", "total_premium",
    ],
    auto: [
      "client_name", "agent_name", "total_premium",
    ],
    dwelling: [
      "named_insured", "agent_name", "total_premium",
    ],
    commercial: [
      "named_insured", "agent_name", "total_premium",
    ],
    bundle: [
      "client_name", "agent_name", "bundle_total_premium",
    ],
  };

  const FORM_MAP = {
    homeowners: homeownersForm,
    auto: autoForm,
    dwelling: dwellingForm,
    commercial: commercialForm,
    bundle: bundleForm,
  };

  const allRequiredFilled = (() => {
    const fields = REQUIRED_FIELDS_MAP[selectedInsurance];
    const form = FORM_MAP[selectedInsurance];
    if (!fields || !form) return false;
    return fields.every((key) => String(form[key] || "").trim() !== "");
  })();

  const allReady = allRequiredFilled;

  const homeownersCompletedFields = HOMEOWNERS_FIELDS.filter(
    ([key]) => String(homeownersForm[key] || "").trim() !== ""
  ).length;

  const autoCompletedEstimate = getAutoCompletionCount(autoForm);

  return (
    <div
      style={{
        height: "calc(100vh - 48px)",
        overflow: "hidden",
        background: "#EFF2F7",
        fontFamily: "Poppins, sans-serif",
        color: COLORS.black,
      }}
    >


      {/* Global styles (scrollbar, shimmer) now in index.css */}

      <div
        ref={mainRef}
        onMouseMove={handleMainMouseMove}
        onMouseLeave={handleMainMouseLeave}
        style={{
          display: "grid",
          // 320px on MacBook Pro and larger, 248px on smaller laptops so
          // the right-hand intake form gets a meaningful amount of room back.
          gridTemplateColumns: `${sidebarWidth}px minmax(0, 1fr)`,
          height: "100%",
          position: "relative",
        }}
      >
        {/* Orbs at grid level — behind both panels */}
        <div ref={orbPrimaryRef} style={{ position: "absolute", width: 400, height: 400, borderRadius: "50%", background: "rgba(23,101,212,0.14)", filter: "blur(80px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 0.4s ease" }} />
        <div ref={orbCyanRef} style={{ position: "absolute", width: 500, height: 500, borderRadius: "50%", background: "rgba(201,242,255,0.22)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 0.6s ease" }} />
        <div ref={orbTrailRef} style={{ position: "absolute", width: 700, height: 700, borderRadius: "50%", background: "rgba(11,145,230,0.08)", filter: "blur(120px)", pointerEvents: "none", zIndex: 0, willChange: "transform, opacity", opacity: 0, transition: "opacity 1s ease" }} />

        <aside
          style={{
            position: "relative",
            borderRight: "1px solid rgba(180,200,230,0.3)",
            height: "100%",
            boxSizing: "border-box",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {/* Sidebar glass layers */}
          <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.70)", backdropFilter: "blur(48px) saturate(2.0) brightness(1.05)", WebkitBackdropFilter: "blur(48px) saturate(2.0) brightness(1.05)", zIndex: 0 }} />
          <div style={{ position: "absolute", inset: 0, boxShadow: "inset -1px 0 0 0 rgba(255,255,255,0.5), inset 1px 0 0 0 rgba(255,255,255,0.2)", zIndex: 3, pointerEvents: "none" }} />
          {/* Rainbow refraction — right edge */}
          <div style={{ position: "absolute", top: "10%", bottom: "10%", right: 0, width: 1, background: "linear-gradient(180deg, transparent, rgba(255,100,100,0.12), rgba(255,255,100,0.08), rgba(100,200,255,0.12), transparent)", zIndex: 4, pointerEvents: "none" }} />
          {/* Sidebar content */}
          <div
            style={{
              position: "relative",
              zIndex: 5,
              padding: "18px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              height: "100%",
              boxSizing: "border-box",
              paddingBottom: 18,
              overflow: "hidden",
              justifyContent: "flex-start",
            }}
          >
          <div style={{ padding: "2px 4px 6px 4px" }}>
            <div
              style={{
                fontSize: 13,
                color: COLORS.mutedText,
                lineHeight: 1.45,
              }}
            >
              AI quote intake, extraction, review,{"\n"}and download in one place.
            </div>
          </div>

          <SidebarBlock
            title="Insurance Type"
            status={insuranceReady}
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              paddingRight: 2,
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 6,
                overflowY: "auto",
                minHeight: 0,
                flex: 1,
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
                      setBundleFileNames([]);
                      setSeparateHomeFile(null);
                      setSeparateAutoFile(null);
                      setBundleUploadMode("combined");
                    }}
                    onMouseEnter={() => setHoveredInsurance(item.key)}
                    onMouseLeave={() => setHoveredInsurance("")}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      borderRadius: 12,
                      border: `1px solid ${
                        isSelected ? COLORS.blue : COLORS.borderGrey
                      }`,
                      background: isSelected ? COLORS.blueSoft : COLORS.white,
                      cursor: item.enabled ? "pointer" : "not-allowed",
                      opacity: item.enabled ? 1 : 0.55,
                      transition: "all 200ms ease",
                      boxShadow: isHovered
                        ? `0 0 24px ${COLORS.hoverShadow}`
                        : "0 0 0 rgba(0,0,0,0)",
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

          <SidebarBlock title="Advisor" status={advisorReady} style={{ position: "relative", zIndex: 10 }}>
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
                  border: `1px solid ${
                    isAdvisorDropdownOpen ? COLORS.blue : COLORS.borderGrey
                  }`,
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
                        <div style={{ fontWeight: 600, fontSize: 13 }}>
                          {advisor.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: COLORS.mutedText,
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
                        padding: 12,
                        fontSize: 13,
                        color: COLORS.subtextGrey,
                      }}
                    >
                      No advisors found
                    </div>
                  )}
                </div>
              )}
            </div>
          </SidebarBlock>

          <SidebarBlock title="Upload Quote" status={uploadReady} style={{ flexShrink: 1, minHeight: 0, overflow: "hidden" }}>
            {/* ── Apple-style toggle: combined vs separate ────────
                Shown for bundle (home + auto), homeowners (home + wind),
                and dwelling (dwelling + wind). Each type uses its own
                mode state and resets its own file buffers. */}
            {(selectedInsurance === "bundle" ||
              selectedInsurance === "homeowners" ||
              selectedInsurance === "dwelling") && (() => {
              const currentMode =
                selectedInsurance === "bundle" ? bundleUploadMode
                : selectedInsurance === "homeowners" ? homeownersUploadMode
                : dwellingUploadMode;
              const flipMode = () => {
                const next = currentMode === "combined" ? "separate" : "combined";
                if (selectedInsurance === "bundle") {
                  setBundleUploadMode(next);
                  setBundleFileNames([]);
                  setSeparateHomeFile(null);
                  setSeparateAutoFile(null);
                } else if (selectedInsurance === "homeowners") {
                  setHomeownersUploadMode(next);
                  setHomeMainFile(null);
                  setHomeWindFile(null);
                } else {
                  setDwellingUploadMode(next);
                  setDwellingMainFile(null);
                  setDwellingWindFile(null);
                }
                setFileName("");
                setErrorMessage("");
                setParseStatus("");
              };
              return (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: currentMode === "combined" ? COLORS.blue : COLORS.mutedText, transition: "color 200ms ease" }}>Combined</span>
                  <button
                    type="button"
                    onClick={flipMode}
                    style={{
                      position: "relative",
                      width: 44,
                      height: 24,
                      borderRadius: 12,
                      border: "none",
                      background: currentMode === "separate" ? COLORS.blue : "#D1D5DB",
                      cursor: isParsing ? "not-allowed" : "pointer",
                      transition: "background 300ms ease",
                      flexShrink: 0,
                      padding: 0,
                    }}
                    disabled={isParsing}
                  >
                    <div style={{
                      position: "absolute",
                      top: 2,
                      left: currentMode === "separate" ? 22 : 2,
                      width: 20,
                      height: 20,
                      borderRadius: 10,
                      background: "#fff",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      transition: "left 300ms cubic-bezier(0.4, 0, 0.2, 1)",
                    }} />
                  </button>
                  <span style={{ fontSize: 12, fontWeight: 600, color: currentMode === "separate" ? COLORS.blue : COLORS.mutedText, transition: "color 200ms ease" }}>Separate</span>
                </div>
              );
            })()}

            {/* ── Combined mode: single combined upload zone ──────── */}
            {(() => {
              if (selectedInsurance === "bundle") return bundleUploadMode === "combined";
              if (selectedInsurance === "homeowners") return homeownersUploadMode === "combined";
              if (selectedInsurance === "dwelling") return dwellingUploadMode === "combined";
              return true;
            })() && (
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
                minHeight: 140,
                borderRadius: 16,
                border: `1.5px dashed ${
                  uploaderEnabled
                    ? uploaderActive
                      ? COLORS.blue
                      : COLORS.borderStrong
                    : COLORS.borderGrey
                }`,
                background: uploaderActive ? COLORS.blueSoft : COLORS.white,
                padding: "12px 14px",
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
                {fileName || (
                  selectedInsurance === "bundle" ||
                  selectedInsurance === "homeowners" ||
                  selectedInsurance === "dwelling"
                    ? "Drag & drop combined PDF"
                    : "Drag & drop PDF"
                )}
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: COLORS.mutedText,
                  lineHeight: 1.4,
                  marginBottom: 12,
                }}
              >
                {selectedInsurance === "bundle"
                  ? "PDF only · single combined home & auto · up to 200MB"
                  : selectedInsurance === "homeowners"
                    ? "PDF only · single combined home & wind · up to 200MB"
                    : selectedInsurance === "dwelling"
                      ? "PDF only · single combined dwelling & auto · up to 200MB"
                      : "PDF only · up to 200MB"}
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
                multiple={selectedInsurance === "bundle" && bundleUploadMode === "combined"}
                style={{ display: "none" }}
                onChange={(e) => {
                  if (selectedInsurance === "bundle") {
                    handleBundleFiles(e.target.files);
                  } else {
                    handleFile(e.target.files?.[0]);
                  }
                }}
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
                  border: `1px solid ${
                    isBrowseHovered ? COLORS.blueDark : COLORS.borderGrey
                  }`,
                  background: isBrowseHovered ? COLORS.blue : COLORS.lightGrey,
                  color: isBrowseHovered
                    ? COLORS.white
                    : uploaderEnabled
                      ? COLORS.blue
                      : COLORS.black,
                  fontWeight: 600,
                  fontSize: 13,
                  fontFamily: "Poppins, sans-serif",
                  cursor: uploaderEnabled && !isParsing ? "pointer" : "not-allowed",
                  transition: "all 200ms ease",
                }}
              >
                {isParsing ? "PARSING..." : "Browse Files"}
              </button>

              {isParsing && (
                <button
                  type="button"
                  onClick={cancelParsing}
                  style={{
                    width: "100%",
                    height: 36,
                    marginTop: 8,
                    borderRadius: 12,
                    border: `1px solid ${COLORS.danger}`,
                    background: COLORS.dangerSoft,
                    color: COLORS.danger,
                    fontWeight: 600,
                    fontSize: 12,
                    fontFamily: "Poppins, sans-serif",
                    cursor: "pointer",
                    transition: "all 200ms ease",
                  }}
                >
                  Cancel Operation
                </button>
              )}

              {errorMessage && (
                <div
                  style={{
                    marginTop: 8,
                    color: COLORS.danger,
                    fontSize: 12,
                    fontWeight: 500,
                    textAlign: "center",
                    lineHeight: 1.4,
                  }}
                >
                  {errorMessage}
                </div>
              )}
            </div>
            )}

            {/* ── Separate mode: two mini upload zones ────────────── */}
            {selectedInsurance === "bundle" && bundleUploadMode === "separate" && (
              <div style={{ display: "grid", gap: 8 }}>
                {/* Homeowners zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleSeparateHomeFile(file);
                  }}
                  style={{
                    borderRadius: 16,
                    border: `1.5px dashed ${separateHomeFile ? COLORS.blue : COLORS.borderStrong}`,
                    background: separateHomeFile ? COLORS.blueSoft : COLORS.white,
                    padding: "14px 14px 16px",
                    transition: "all 200ms ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <img src="/i-homeowners.png" alt="Home" style={{ width: 18, height: 18, objectFit: "contain" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.blue }}>Homeowners Quote</span>
                    {separateHomeFile && (
                      <button type="button" onClick={() => setSeparateHomeFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.danger, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Remove
                      </button>
                    )}
                  </div>
                  {separateHomeFile ? (
                    <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {separateHomeFile.name}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: COLORS.mutedText, lineHeight: 1.4, marginBottom: 10 }}>Drag PDF or browse</div>
                      <input ref={separateHomeInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleSeparateHomeFile(e.target.files[0]); }} />
                      <button
                        type="button"
                        disabled={isParsing}
                        onClick={() => separateHomeInputRef.current?.click()}
                        style={{
                          width: "100%",
                          height: 38,
                          borderRadius: 10,
                          border: `1px solid ${COLORS.borderGrey}`,
                          background: COLORS.lightGrey,
                          color: COLORS.blue,
                          fontWeight: 600,
                          fontSize: 13,
                          fontFamily: "Poppins, sans-serif",
                          cursor: isParsing ? "not-allowed" : "pointer",
                          transition: "all 200ms ease",
                        }}
                      >
                        Browse
                      </button>
                    </>
                  )}
                </div>

                {/* Auto zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleSeparateAutoFile(file);
                  }}
                  style={{
                    borderRadius: 16,
                    border: `1.5px dashed ${separateAutoFile ? COLORS.blue : COLORS.borderStrong}`,
                    background: separateAutoFile ? COLORS.blueSoft : COLORS.white,
                    padding: "14px 14px 16px",
                    transition: "all 200ms ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <img src="/i-auto.png" alt="Auto" style={{ width: 18, height: 18, objectFit: "contain" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.blue }}>Auto Quote</span>
                    {separateAutoFile && (
                      <button type="button" onClick={() => setSeparateAutoFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.danger, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Remove
                      </button>
                    )}
                  </div>
                  {separateAutoFile ? (
                    <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {separateAutoFile.name}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: COLORS.mutedText, lineHeight: 1.4, marginBottom: 10 }}>Drag PDF or browse</div>
                      <input ref={separateAutoInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleSeparateAutoFile(e.target.files[0]); }} />
                      <button
                        type="button"
                        disabled={isParsing}
                        onClick={() => separateAutoInputRef.current?.click()}
                        style={{
                          width: "100%",
                          height: 38,
                          borderRadius: 10,
                          border: `1px solid ${COLORS.borderGrey}`,
                          background: COLORS.lightGrey,
                          color: COLORS.blue,
                          fontWeight: 600,
                          fontSize: 13,
                          fontFamily: "Poppins, sans-serif",
                          cursor: isParsing ? "not-allowed" : "pointer",
                          transition: "all 200ms ease",
                        }}
                      >
                        Browse
                      </button>
                    </>
                  )}
                </div>

                {/* Parsing kicks off automatically via useEffect when both
                    home + auto PDFs are staged — no manual button. */}

                {isParsing && parseStatus ? (
                  <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, textAlign: "center", padding: "4px 0" }}>
                    {parseStatus}
                  </div>
                ) : null}

                {isParsing && (
                  <button
                    type="button"
                    onClick={cancelParsing}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 12,
                      border: `1px solid ${COLORS.danger}`,
                      background: COLORS.dangerSoft,
                      color: COLORS.danger,
                      fontWeight: 600,
                      fontSize: 12,
                      fontFamily: "Poppins, sans-serif",
                      cursor: "pointer",
                      transition: "all 200ms ease",
                    }}
                  >
                    Cancel Operation
                  </button>
                )}

                {errorMessage && (
                  <div style={{ color: COLORS.danger, fontSize: 12, fontWeight: 500, textAlign: "center", lineHeight: 1.4 }}>
                    {errorMessage}
                  </div>
                )}
              </div>
            )}

            {/* ── Homeowners separate mode: home + wind dropzones ── */}
            {selectedInsurance === "homeowners" && homeownersUploadMode === "separate" && (
              <div style={{ display: "grid", gap: 8 }}>
                {/* Homeowners primary zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleHomeMainFile(file);
                  }}
                  style={{
                    borderRadius: 16,
                    border: `1.5px dashed ${homeMainFile ? COLORS.blue : COLORS.borderStrong}`,
                    background: homeMainFile ? COLORS.blueSoft : COLORS.white,
                    padding: "14px 14px 16px",
                    transition: "all 200ms ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <img src="/i-homeowners.png" alt="Home" style={{ width: 18, height: 18, objectFit: "contain" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.blue }}>Homeowners Quote</span>
                    {homeMainFile && !isParsing && (
                      <button type="button" onClick={() => setHomeMainFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.danger, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Remove
                      </button>
                    )}
                  </div>
                  {homeMainFile ? (
                    <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {homeMainFile.name}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: COLORS.mutedText, lineHeight: 1.4, marginBottom: 10 }}>Drag PDF or browse</div>
                      <input ref={homeMainInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleHomeMainFile(e.target.files[0]); }} />
                      <button
                        type="button"
                        disabled={isParsing}
                        onClick={() => homeMainInputRef.current?.click()}
                        style={{
                          width: "100%",
                          height: 38,
                          borderRadius: 10,
                          border: `1px solid ${COLORS.borderGrey}`,
                          background: COLORS.lightGrey,
                          color: COLORS.blue,
                          fontWeight: 600,
                          fontSize: 13,
                          fontFamily: "Poppins, sans-serif",
                          cursor: isParsing ? "not-allowed" : "pointer",
                          transition: "all 200ms ease",
                        }}
                      >
                        Browse
                      </button>
                    </>
                  )}
                </div>

                {/* Wind / Hail zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleHomeWindFile(file);
                  }}
                  style={{
                    borderRadius: 16,
                    border: `1.5px dashed ${homeWindFile ? COLORS.blue : COLORS.borderStrong}`,
                    background: homeWindFile ? COLORS.blueSoft : COLORS.white,
                    padding: "14px 14px 16px",
                    transition: "all 200ms ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <img src="/i-wind.png" alt="Wind" style={{ width: 18, height: 18, objectFit: "contain" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.blue }}>Wind / Hail Quote</span>
                    {homeWindFile && !isParsing && (
                      <button type="button" onClick={() => setHomeWindFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.danger, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Remove
                      </button>
                    )}
                  </div>
                  {homeWindFile ? (
                    <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {homeWindFile.name}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: COLORS.mutedText, lineHeight: 1.4, marginBottom: 10 }}>Drag PDF or browse</div>
                      <input ref={homeWindInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleHomeWindFile(e.target.files[0]); }} />
                      <button
                        type="button"
                        disabled={isParsing}
                        onClick={() => homeWindInputRef.current?.click()}
                        style={{
                          width: "100%",
                          height: 38,
                          borderRadius: 10,
                          border: `1px solid ${COLORS.borderGrey}`,
                          background: COLORS.lightGrey,
                          color: COLORS.blue,
                          fontWeight: 600,
                          fontSize: 13,
                          fontFamily: "Poppins, sans-serif",
                          cursor: isParsing ? "not-allowed" : "pointer",
                          transition: "all 200ms ease",
                        }}
                      >
                        Browse
                      </button>
                    </>
                  )}
                </div>

                {isParsing && parseStatus ? (
                  <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, textAlign: "center", padding: "4px 0" }}>
                    {parseStatus}
                  </div>
                ) : null}

                {isParsing && (
                  <button
                    type="button"
                    onClick={cancelParsing}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 12,
                      border: `1px solid ${COLORS.danger}`,
                      background: COLORS.dangerSoft,
                      color: COLORS.danger,
                      fontWeight: 600,
                      fontSize: 12,
                      fontFamily: "Poppins, sans-serif",
                      cursor: "pointer",
                      transition: "all 200ms ease",
                    }}
                  >
                    Cancel Operation
                  </button>
                )}

                {errorMessage && (
                  <div style={{ color: COLORS.danger, fontSize: 12, fontWeight: 500, textAlign: "center", lineHeight: 1.4 }}>
                    {errorMessage}
                  </div>
                )}
              </div>
            )}

            {/* ── Dwelling separate mode: dwelling + wind dropzones ── */}
            {selectedInsurance === "dwelling" && dwellingUploadMode === "separate" && (
              <div style={{ display: "grid", gap: 8 }}>
                {/* Dwelling primary zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleDwellingMainFile(file);
                  }}
                  style={{
                    borderRadius: 16,
                    border: `1.5px dashed ${dwellingMainFile ? COLORS.blue : COLORS.borderStrong}`,
                    background: dwellingMainFile ? COLORS.blueSoft : COLORS.white,
                    padding: "14px 14px 16px",
                    transition: "all 200ms ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <img src="/i-dwelling.png" alt="Dwelling" style={{ width: 18, height: 18, objectFit: "contain" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.blue }}>Dwelling Quote</span>
                    {dwellingMainFile && !isParsing && (
                      <button type="button" onClick={() => setDwellingMainFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.danger, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Remove
                      </button>
                    )}
                  </div>
                  {dwellingMainFile ? (
                    <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {dwellingMainFile.name}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: COLORS.mutedText, lineHeight: 1.4, marginBottom: 10 }}>Drag PDF or browse</div>
                      <input ref={dwellingMainInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleDwellingMainFile(e.target.files[0]); }} />
                      <button
                        type="button"
                        disabled={isParsing}
                        onClick={() => dwellingMainInputRef.current?.click()}
                        style={{
                          width: "100%",
                          height: 38,
                          borderRadius: 10,
                          border: `1px solid ${COLORS.borderGrey}`,
                          background: COLORS.lightGrey,
                          color: COLORS.blue,
                          fontWeight: 600,
                          fontSize: 13,
                          fontFamily: "Poppins, sans-serif",
                          cursor: isParsing ? "not-allowed" : "pointer",
                          transition: "all 200ms ease",
                        }}
                      >
                        Browse
                      </button>
                    </>
                  )}
                </div>

                {/* Wind / Hail zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleDwellingWindFile(file);
                  }}
                  style={{
                    borderRadius: 16,
                    border: `1.5px dashed ${dwellingWindFile ? COLORS.blue : COLORS.borderStrong}`,
                    background: dwellingWindFile ? COLORS.blueSoft : COLORS.white,
                    padding: "14px 14px 16px",
                    transition: "all 200ms ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <img src="/i-wind.png" alt="Wind" style={{ width: 18, height: 18, objectFit: "contain" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.blue }}>Wind / Hail Quote</span>
                    {dwellingWindFile && !isParsing && (
                      <button type="button" onClick={() => setDwellingWindFile(null)} style={{ marginLeft: "auto", background: "none", border: "none", color: COLORS.danger, fontSize: 11, fontWeight: 600, cursor: "pointer", padding: 0 }}>
                        Remove
                      </button>
                    )}
                  </div>
                  {dwellingWindFile ? (
                    <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {dwellingWindFile.name}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 12, color: COLORS.mutedText, lineHeight: 1.4, marginBottom: 10 }}>Drag PDF or browse</div>
                      <input ref={dwellingWindInputRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) handleDwellingWindFile(e.target.files[0]); }} />
                      <button
                        type="button"
                        disabled={isParsing}
                        onClick={() => dwellingWindInputRef.current?.click()}
                        style={{
                          width: "100%",
                          height: 38,
                          borderRadius: 10,
                          border: `1px solid ${COLORS.borderGrey}`,
                          background: COLORS.lightGrey,
                          color: COLORS.blue,
                          fontWeight: 600,
                          fontSize: 13,
                          fontFamily: "Poppins, sans-serif",
                          cursor: isParsing ? "not-allowed" : "pointer",
                          transition: "all 200ms ease",
                        }}
                      >
                        Browse
                      </button>
                    </>
                  )}
                </div>

                {isParsing && parseStatus ? (
                  <div style={{ fontSize: 12, color: COLORS.black, fontWeight: 500, textAlign: "center", padding: "4px 0" }}>
                    {parseStatus}
                  </div>
                ) : null}

                {isParsing && (
                  <button
                    type="button"
                    onClick={cancelParsing}
                    style={{
                      width: "100%",
                      height: 36,
                      borderRadius: 12,
                      border: `1px solid ${COLORS.danger}`,
                      background: COLORS.dangerSoft,
                      color: COLORS.danger,
                      fontWeight: 600,
                      fontSize: 12,
                      fontFamily: "Poppins, sans-serif",
                      cursor: "pointer",
                      transition: "all 200ms ease",
                    }}
                  >
                    Cancel Operation
                  </button>
                )}

                {errorMessage && (
                  <div style={{ color: COLORS.danger, fontSize: 12, fontWeight: 500, textAlign: "center", lineHeight: 1.4 }}>
                    {errorMessage}
                  </div>
                )}
              </div>
            )}
          </SidebarBlock>

          </div>
        </aside>

        <main
          style={{
            minWidth: 0,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Floating Clear + Create Proposal buttons — fixed top-right with dashboard-style BlurAura */}
          <div style={{
            position: "absolute", top: 16, right: 28, zIndex: 20,
            pointerEvents: "auto",
          }}>
            <div style={{ position: "relative", display: "flex", gap: 10, alignItems: "center" }}>
              {/* Blur halo behind buttons — matches AdminDashboard BlurAura
                  (spread=60, blur=22, radial mask 40%→72%, radius 14+spread). */}
              <div style={{
                position: "absolute",
                top: -60, left: -60, right: -60, bottom: -60,
                borderRadius: 74,
                backdropFilter: "blur(22px)",
                WebkitBackdropFilter: "blur(22px)",
                maskImage: "radial-gradient(ellipse at center, black 40%, transparent 72%)",
                WebkitMaskImage: "radial-gradient(ellipse at center, black 40%, transparent 72%)",
                pointerEvents: "none",
                zIndex: 0,
              }} />
              <button
                type="button"
                onClick={handleClearSnapshot}
                disabled={isGenerating || isParsing}
                onMouseEnter={() => setIsClearHovered(true)}
                onMouseLeave={() => setIsClearHovered(false)}
                style={{
                  position: "relative",
                  zIndex: 1,
                  background: isClearHovered ? "#f5f5f5" : "#fff",
                  color: COLORS.mutedText,
                  border: `1px solid ${COLORS.borderGrey}`,
                  borderRadius: 14,
                  height: 48,
                  padding: "0 22px",
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "Poppins, sans-serif",
                  cursor: isGenerating || isParsing ? "not-allowed" : "pointer",
                  transition: "all 200ms ease",
                  opacity: isGenerating || isParsing ? 0.5 : 1,
                  flexShrink: 0,
                }}
              >
                Clear
              </button>
              <button
                ref={generateBtnRef}
                type="button"
                onClick={generateAndDownloadQuote}
                disabled={!allReady || isGenerating}
                onMouseEnter={() => {
                  if (allReady && !isGenerating) setIsGenerateHovered(true);
                }}
                onMouseLeave={() => setIsGenerateHovered(false)}
                style={{
                  position: "relative",
                  zIndex: 1,
                  background: allReady ? COLORS.blue : COLORS.disabledBg,
                  color: allReady ? COLORS.white : COLORS.disabledText,
                  border: `1px solid ${allReady ? COLORS.blue : COLORS.disabledBg}`,
                  borderRadius: 14,
                  height: 48,
                  width: 180,
                  padding: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "Poppins, sans-serif",
                  cursor: allReady && !isGenerating ? "pointer" : "not-allowed",
                  transition: "all 200ms ease",
                  boxShadow: isGenerateHovered
                    ? `0 0 28px ${COLORS.hoverShadow}`
                    : "0 0 0 rgba(0,0,0,0)",
                  flexShrink: 0,
                }}
              >
                {isGenerating ? "Creating..." : "Create Proposal"}
              </button>
            </div>
          </div>

          <div
            style={{
              flex: "1 1 auto",
              minHeight: 0,
              overflowY: "auto",
              padding: "22px 28px 24px 28px",
              position: "relative",
              zIndex: 1,
            }}
          >
            {/* Insurance type title — scrolls with content, matches BigSectionHeader style */}
            {(() => {
              const opt = INSURANCE_OPTIONS.find(o => o.key === selectedInsurance);
              const label = opt?.label?.replace(" (Beta)", "") || selectedInsurance;
              const icon = opt?.icon;
              return (
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 6,
                }}>
                  {icon && (
                    <img
                      src={icon}
                      alt={label}
                      style={{ width: 28, height: 28, objectFit: "contain" }}
                    />
                  )}
                  <div style={{
                    fontFamily: "SentientCustom, Georgia, serif",
                    fontSize: 26,
                    lineHeight: 1,
                    letterSpacing: "-0.03em",
                    color: COLORS.blue,
                  }}>
                    {label}
                  </div>
                  <div style={{
                    flex: 1,
                    height: 1,
                    background: `linear-gradient(90deg, ${COLORS.blueBorder}, transparent)`,
                    marginLeft: 8,
                  }} />
                </div>
              );
            })()}
            <div style={{
              fontSize: 12,
              color: COLORS.mutedText,
              fontWeight: 400,
              lineHeight: 1.4,
              marginBottom: 22,
              maxWidth: 600,
            }}>
              The Sizemore Snapshot is an AI and can make mistakes. Please verify fields yourself, especially when marked "Double Check".
            </div>
            {selectedInsurance === "homeowners" ? (
              <HomeownersPanel
                form={homeownersForm}
                onFieldChange={updateHomeownersField}
                loadingFields={homeownersLoading}
                finalizedFields={homeownersFinalized}
                manuallyEditedFields={homeownersManual}
                confidenceMap={homeownersConfidence}
                FieldControl={FieldControl}
                SectionCard={SectionCard}
              />
            ) : selectedInsurance === "auto" ? (
              <AutoPanel
                form={autoForm}
                isLoading={autoIsLoading}
                isParsed={autoIsParsed}
                manualFields={autoManual}
                confidenceMap={autoConfidence}
                onFieldChange={updateAutoField}
                onDriverChange={updateAutoDriver}
                onAddDriver={addDriver}
                onRemoveDriver={removeDriver}
                onVehicleChange={updateAutoVehicle}
                onAddVehicle={addVehicle}
                onRemoveVehicle={removeVehicle}
                onTogglePaidInFullDiscount={togglePaidInFullDiscount}
                FieldControl={FieldControl}
                SectionCard={SectionCard}
                SubCard={SubCard}
                SmallActionButton={SmallActionButton}
                SmallGhostButton={SmallGhostButton}
                EmptyHint={EmptyHint}
                COLORS={COLORS}
              />
            ) : selectedInsurance === "dwelling" ? (
              <DwellingPanel
                form={dwellingForm}
                isLoading={dwellingIsLoading}
                isParsed={dwellingIsParsed}
                manualFields={dwellingManual}
                confidenceMap={dwellingConfidence}
                onFieldChange={updateDwellingField}
                onPropertyChange={updateDwellingProperty}
                onAddProperty={addDwellingProperty}
                onRemoveProperty={removeDwellingProperty}
                onPaymentPlanChange={updateDwellingPaymentPlan}
                onTogglePaidInFullDiscount={toggleDwellingPaidInFullDiscount}
                FieldControl={FieldControl}
                SectionCard={SectionCard}
                SubCard={SubCard}
                SmallActionButton={SmallActionButton}
                SmallGhostButton={SmallGhostButton}
                EmptyHint={EmptyHint}
                COLORS={COLORS}
              />
            ) : selectedInsurance === "commercial" ? (
              <CommercialPanel
                form={commercialForm}
                isLoading={commercialIsLoading}
                isParsed={commercialIsParsed}
                manualFields={commercialManual}
                confidenceMap={commercialConfidence}
                onFieldChange={updateCommercialField}
                onWcClassCodeChange={updateCommercialWcClassCode}
                onAddWcClassCode={addCommercialWcClassCode}
                onRemoveWcClassCode={removeCommercialWcClassCode}
                FieldControl={FieldControl}
                SectionCard={SectionCard}
                SubCard={SubCard}
                SmallActionButton={SmallActionButton}
                SmallGhostButton={SmallGhostButton}
                EmptyHint={EmptyHint}
                COLORS={COLORS}
                onWindFile={parseWindFile}
                windParsing={windParsing}
                windParseStatus={windParseStatus}
                windFileName={windFileName}
              />
            ) : selectedInsurance === "bundle" ? (
              <BundlePanel
                form={bundleForm}
                isLoading={bundleIsLoading}
                isParsed={bundleIsParsed}
                manualFields={bundleManual}
                confidenceMap={bundleConfidence}
                onFieldChange={updateBundleField}
                onDriverChange={updateBundleDriver}
                onAddDriver={addBundleDriver}
                onRemoveDriver={removeBundleDriver}
                onVehicleChange={updateBundleVehicle}
                onAddVehicle={addBundleVehicle}
                onRemoveVehicle={removeBundleVehicle}
                onTogglePaidInFullDiscount={toggleBundlePaidInFullDiscount}
                FieldControl={FieldControl}
                SectionCard={SectionCard}
                SubCard={SubCard}
                SmallActionButton={SmallActionButton}
                SmallGhostButton={SmallGhostButton}
                EmptyHint={EmptyHint}
                COLORS={COLORS}
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

function UnavailablePanel({ label }) {
  return (
    <div
      style={{
        background: COLORS.white,
        border: `1px solid ${COLORS.borderGrey}`,
        borderRadius: 24,
        boxShadow: "none",
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
  const borderRadius = 18;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.65)",
        backdropFilter: "blur(20px) saturate(1.6)",
        WebkitBackdropFilter: "blur(20px) saturate(1.6)",
        border: "1px solid rgba(180,200,230,0.3)",
        borderRadius,
        padding: 14,
        boxShadow: "inset 0 1.5px 0 0 rgba(255,255,255,0.9)",
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

function GlassPanel({ children, borderRadius = 24, style = {} }) {
  return (
    <div
      style={{
        position: "relative",
        borderRadius,
        overflow: "hidden",
        border: "none",
        ...style,
      }}
    >
      {/* Glass base — heavy blur + saturation */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255,255,255,0.70)",
          backdropFilter: "blur(48px) saturate(2.0) brightness(1.05)",
          WebkitBackdropFilter: "blur(48px) saturate(2.0) brightness(1.05)",
          zIndex: 0,
        }}
      />
      {/* Refraction highlights — top bright, bottom dim */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius,
          boxShadow:
            "inset 0 2px 0 0 rgba(255,255,255,1), inset 0 -1px 0 0 rgba(255,255,255,0.2), inset 1px 0 0 0 rgba(255,255,255,0.4), inset -1px 0 0 0 rgba(255,255,255,0.4)",
          zIndex: 3,
          pointerEvents: "none",
        }}
      />
      {/* Rainbow refraction shimmer — top edge */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: "10%",
          right: "10%",
          height: 1,
          background: "linear-gradient(90deg, transparent, rgba(255,100,100,0.15), rgba(255,255,100,0.1), rgba(100,200,255,0.15), transparent)",
          zIndex: 4,
          pointerEvents: "none",
        }}
      />
      {/* Content */}
      <div style={{ position: "relative", zIndex: 5 }}>
        {children}
      </div>
    </div>
  );
}

function SectionCard({ title, children, action = null }) {
  return (
    <GlassPanel>
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
    </GlassPanel>
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
  selectOptions = null,
  multiline = false,
  rows = 4,
  confidence = null,
}) {
  const CONFIDENCE_THRESHOLD = 0.85;
  const [isHovered, setIsHovered] = React.useState(false);
  const showSkeleton = isLoading && !value;
  const hasValue = String(value ?? "").trim() !== "";

  // "Not Found" = AI confidently confirmed field is absent from document
  const isNotFound =
    isFinal && !hasValue && confidence !== null && confidence >= CONFIDENCE_THRESHOLD;

  const commonInputStyle = {
    width: "100%",
    boxSizing: "border-box",
    background: COLORS.white,
    border: `1px solid ${
      !hasValue && !showSkeleton && !isNotFound
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

  const doubleCheckStatus = () => ({
    text: "Double Check",
    bg: "#FFF8E1",
    color: "#D97706",
    border: "#FDE68A",
  });

  const notFoundStatus = () => ({
    text: "Not Found",
    bg: "#F2F4F7",
    color: "#7E8A99",
    border: "#E2E8F0",
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

    if (isAgentField && hasValue) return successStatus("Selected");
    if (isManuallyEdited) return successStatus("Manual");

    // After extraction complete (isFinal) with confidence data
    if (isFinal && confidence !== null) {
      if (hasValue) {
        return confidence >= CONFIDENCE_THRESHOLD
          ? successStatus("Verified")
          : doubleCheckStatus();
      } else {
        return confidence >= CONFIDENCE_THRESHOLD
          ? notFoundStatus()
          : doubleCheckStatus();
      }
    }

    // Fallback: isFinal but no confidence (legacy / missing confidence)
    if (isFinal) {
      return hasValue ? successStatus("Verified") : notFoundStatus();
    }

    // Not yet extracted
    if (!hasValue) {
      return {
        text: "Missing",
        bg: COLORS.dangerSoft,
        color: COLORS.danger,
        border: COLORS.dangerBorder,
      };
    }

    // Defensive fallback — in Design 2, hasValue only occurs together with
    // isFinal=true (we removed draft_patch), so this branch is effectively
    // unreachable. Kept to avoid an undefined status if state ever diverges.
    return successStatus("Verified");
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

  if (selectOptions) {
    return (
      <div>
        {labelBlock}
        <div style={wrapperStyle}>
          <select
            value={value || ""}
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
            {selectOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {showSkeleton ? <div style={skeletonStyle} /> : null}
        </div>
      </div>
    );
  }

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
              display: "block",
              padding: "10px 12px",
              height: rows * 20 + 20,
              lineHeight: 1.45,
              resize: "none",
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

function getAutoCompletionCount(form) {
  let count = 0;

  const filled = (v) => String(v || "").trim() !== "";

  const topLevel = [
    "client_name", "client_address", "client_email", "client_phone",
    "quote_date", "quote_effective_date", "quote_expiration_date",
    "policy_term",
    "total_premium", "paid_in_full_discount", "total_pay_in_full",
    "agent_name", "agent_address", "agent_phone", "agent_email",
  ];

  topLevel.forEach((key) => {
    if (filled(form[key])) count += 1;
  });

  (form.drivers || []).forEach((driver) => {
    if (filled(driver.driver_name)) count += 1;
    if (filled(driver.gender)) count += 1;
    if (filled(driver.marital_status)) count += 1;
    if (filled(driver.license_state)) count += 1;
  });

  (form.vehicles || []).forEach((vehicle) => {
    if (filled(vehicle.year_make_model_trim)) count += 1;
    if (filled(vehicle.vin)) count += 1;
    if (filled(vehicle.vehicle_use)) count += 1;
    if (filled(vehicle.garaging_zip_county)) count += 1;
  });

  Object.values(form.coverages || {}).forEach((v) => {
    if (filled(v)) count += 1;
  });

  const po = form.payment_options || {};
  ["full_pay", "semi_annual", "quarterly", "monthly"].forEach((plan) => {
    Object.values(po[plan] || {}).forEach((v) => {
      if (filled(v)) count += 1;
    });
  });
  Object.values(po.paid_in_full_discount || {}).forEach((v) => {
    if (filled(v)) count += 1;
  });
  return count;
}