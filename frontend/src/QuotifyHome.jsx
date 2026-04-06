import React from "react";
import COLORS from "./colors";
import { INSURANCE_OPTIONS } from "./insuranceOptions";
import {
  HOMEOWNERS_FIELDS,
  EMPTY_HOMEOWNERS_FORM,
} from "./homeownersConfig";
import {
  EMPTY_AUTO_FORM,
  emptyDriver,
  emptyVehicle,
} from "./autoConfig";
import {
  EMPTY_DWELLING_FORM,
  emptyProperty,
} from "./dwellingConfig";
import {
  EMPTY_COMMERCIAL_FORM,
  emptyWcClassCode,
} from "./commercialConfig";
import {
  EMPTY_BUNDLE_FORM,
  emptyDriver as emptyBundleDriver,
  emptyVehicle as emptyBundleVehicle,
} from "./bundleConfig";
import HomeownersPanel from "./HomeownersPanel";
import AutoPanel from "./AutoPanel";
import DwellingPanel from "./DwellingPanel";
import CommercialPanel from "./CommercialPanel";
import BundlePanel from "./BundlePanel";
import { triggerSparkleFlow } from "./sparkleFlow";

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
  const [bundleFileNames, setBundleFileNames] = React.useState([]);
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

  const parseHomeownersFile = async (file) => {
    setFileName(file.name);
    setErrorMessage("");
    setParseStatus("Uploading PDF...");
    setIsParsing(true);
    startHomeownersFieldState();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-homeowners-quote`, {
        method: "POST",
        body,
        signal: controller.signal,
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
            finalConfidence = message.confidence || {};
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
            finalConfidence = message.confidence || {};
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
      setParseStatus("Done.");
    } catch (error) {
      if (error.name === "AbortError") return;
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      resetHomeownersFieldState();
      setHomeownersConfidence({});
    } finally {
      setIsParsing(false);
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
    setParseStatus("Uploading PDF...");
    setIsParsing(true);
    setAutoIsLoading(true);
    setAutoIsParsed(false);
    setAutoManual({});
    setAutoConfidence({});

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-auto-quote`, {
        method: "POST",
        body,
        signal: controller.signal,
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
            setParseStatus(message.message || "Parsing...");
          }

          if (message.type === "draft_patch" && message.data) {
            setParseStatus("Filling likely fields...");
            applyAutoPatch(message.data);
          }

          if (message.type === "final_patch" && message.data) {
            setParseStatus("Verifying and refining fields...");
            applyAutoPatch(message.data);
          }

          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
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
            applyAutoPatch(message.data);
          } else if (message.type === "final_patch" && message.data) {
            applyAutoPatch(message.data);
          } else if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
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
      setParseStatus("Done.");
    } catch (error) {
      if (error.name === "AbortError") return;
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      setAutoIsLoading(false);
      setAutoIsParsed(false);
      setAutoConfidence({});
    } finally {
      setIsParsing(false);
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
          if (ps.pay_in_full_discount) next.pay_in_full_discount = ps.pay_in_full_discount;
          if (ps.total_if_paid_in_full) next.total_if_paid_in_full = ps.total_if_paid_in_full;
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
      } else {
        next[key] = value;
      }
    }
    return next;
  };

  const parseDwellingFile = async (file) => {
    setFileName(file.name);
    setErrorMessage("");
    setParseStatus("Uploading PDF...");
    setIsParsing(true);
    setDwellingIsLoading(true);
    setDwellingIsParsed(false);
    setDwellingManual({});
    setDwellingConfidence({});

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-dwelling-quote`, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "Failed to parse dwelling quote.";
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
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

          if (message.type === "status") setParseStatus(message.message || "Parsing...");
          if (message.type === "draft_patch" && message.data) {
            setParseStatus("Filling likely fields...");
            applyDwellingPatch(message.data);
          }
          if (message.type === "final_patch" && message.data) {
            setParseStatus("Verifying and refining fields...");
            applyDwellingPatch(message.data);
          }
          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
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
          if (message.type === "draft_patch" && message.data) applyDwellingPatch(message.data);
          else if (message.type === "final_patch" && message.data) applyDwellingPatch(message.data);
          else if (message.type === "result") { finalData = message.data; finalConfidence = message.confidence || {}; }
          else if (message.type === "error") throw new Error(message.error || "Streaming parse failed.");
        } catch (_) {}
      }

      if (!finalData) throw new Error("No final parsed result was returned.");

      const { agent_name, agent_address, agent_phone, agent_email, ...restFinal } = finalData || {};
      setDwellingForm((prev) => deepMergeDwellingForm(prev, restFinal));
      setDwellingConfidence(finalConfidence);
      setDwellingIsLoading(false);
      setDwellingIsParsed(true);
      setParseStatus("Done.");
    } catch (error) {
      if (error.name === "AbortError") return;
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      setDwellingIsLoading(false);
      setDwellingIsParsed(false);
      setDwellingConfidence({});
    } finally {
      setIsParsing(false);
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
    setParseStatus("Uploading PDF" + (fileArr.length > 1 ? "s" : "") + "...");
    setIsParsing(true);
    setBundleIsLoading(true);
    setBundleIsParsed(false);
    setBundleManual({});
    setBundleConfidence({});

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      for (const f of fileArr) {
        body.append("files", f);
      }

      const response = await fetch(`${API_BASE_URL}/api/parse-bundle-quote`, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "Failed to parse bundle quote.";
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
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

          if (message.type === "status") setParseStatus(message.message || "Parsing...");
          if (message.type === "draft_patch" && message.data) {
            setParseStatus("Filling likely fields...");
            applyBundlePatch(message.data);
          }
          if (message.type === "final_patch" && message.data) {
            setParseStatus("Verifying and refining fields...");
            applyBundlePatch(message.data);
          }
          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
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
          if (message.type === "draft_patch" && message.data) applyBundlePatch(message.data);
          else if (message.type === "final_patch" && message.data) applyBundlePatch(message.data);
          else if (message.type === "result") { finalData = message.data; finalConfidence = message.confidence || {}; }
          else if (message.type === "error") throw new Error(message.error || "Streaming parse failed.");
        } catch (_) {}
      }

      if (!finalData) throw new Error("No final parsed result was returned.");

      const { agent_name, agent_address, agent_phone, agent_email, ...restFinal } = finalData || {};
      setBundleForm((prev) => deepMergeBundleForm(prev, restFinal));
      setBundleConfidence(finalConfidence);
      setBundleIsLoading(false);
      setBundleIsParsed(true);
      setParseStatus("Done.");
    } catch (error) {
      if (error.name === "AbortError") return;
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      setBundleIsLoading(false);
      setBundleIsParsed(false);
      setBundleConfidence({});
    } finally {
      setIsParsing(false);
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
    setParseStatus("Uploading PDF...");
    setIsParsing(true);
    setCommercialIsLoading(true);
    setCommercialIsParsed(false);
    setCommercialManual({});
    setCommercialConfidence({});

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-commercial-quote`, {
        method: "POST",
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = "Failed to parse commercial quote.";
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
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

          if (message.type === "status") setParseStatus(message.message || "Parsing...");
          if (message.type === "draft_patch" && message.data) {
            setParseStatus("Filling likely fields...");
            applyCommercialPatch(message.data);
          }
          if (message.type === "final_patch" && message.data) {
            setParseStatus("Verifying and refining fields...");
            applyCommercialPatch(message.data);
          }
          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
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
          if (message.type === "draft_patch" && message.data) applyCommercialPatch(message.data);
          else if (message.type === "final_patch" && message.data) applyCommercialPatch(message.data);
          else if (message.type === "result") { finalData = message.data; finalConfidence = message.confidence || {}; }
          else if (message.type === "error") throw new Error(message.error || "Streaming parse failed.");
        } catch (_) {}
      }

      if (!finalData) throw new Error("No final parsed result was returned.");

      const { agent_name, agent_address, agent_phone, agent_email, ...restFinal } = finalData || {};
      setCommercialForm((prev) => deepMergeCommercialForm(prev, restFinal));
      setCommercialConfidence(finalConfidence);
      setCommercialIsLoading(false);
      setCommercialIsParsed(true);
      setParseStatus("Done.");
    } catch (error) {
      if (error.name === "AbortError") return;
      setErrorMessage(error.message || "Something went wrong while parsing the PDF.");
      setParseStatus("");
      setCommercialIsLoading(false);
      setCommercialIsParsed(false);
      setCommercialConfidence({});
    } finally {
      setIsParsing(false);
    }
  };

  /* ── Wind parser (inline, commercial sub-section) ───────────── */
  const parseWindFile = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith(".pdf")) return;
    setWindFileName(file.name);
    setWindParseStatus("Uploading wind PDF...");
    setWindParsing(true);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${API_BASE_URL}/api/parse-wind-quote`, {
        method: "POST",
        body,
      });

      if (!response.ok) {
        let detail = "Failed to parse wind quote.";
        try {
          const payload = await response.json();
          detail = payload?.detail || detail;
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

          if (message.type === "status") setWindParseStatus(message.message || "Parsing...");
          if ((message.type === "draft_patch" || message.type === "final_patch") && message.data) {
            setCommercialForm((prev) => ({ ...prev, ...message.data }));
          }
          if (message.type === "result") {
            finalData = message.data;
            finalConfidence = message.confidence || {};
          }
          if (message.type === "error") throw new Error(message.error || "Wind parse failed.");
        }
      }

      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);
          if ((message.type === "draft_patch" || message.type === "final_patch") && message.data) {
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
      setWindParseStatus("Done.");
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
        background: "#EFF2F7",
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
        ref={mainRef}
        onMouseMove={handleMainMouseMove}
        onMouseLeave={handleMainMouseLeave}
        style={{
          display: "grid",
          gridTemplateColumns: "320px minmax(0, 1fr)",
          height: "100vh",
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
            height: "100vh",
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
              overflowY: "auto",
              justifyContent: "flex-start",
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
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gap: 6,
                overflowY: "auto",
                minHeight: 0,
                flex: 1,
                paddingRight: 10,
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

          <SidebarBlock title="Upload Quote" status={uploadReady} style={{ flexShrink: 0 }}>
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
                minHeight: 200,
                borderRadius: 16,
                border: `1.5px dashed ${
                  uploaderEnabled
                    ? uploaderActive
                      ? COLORS.blue
                      : COLORS.borderStrong
                    : COLORS.borderGrey
                }`,
                background: uploaderActive ? COLORS.blueSoft : COLORS.white,
                padding: "18px 14px",
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
                {fileName || (selectedInsurance === "bundle" ? "Drag & drop 1 or 2 PDFs" : "Drag & drop PDF")}
              </div>

              <div
                style={{
                  fontSize: 12,
                  color: COLORS.mutedText,
                  lineHeight: 1.4,
                  marginBottom: 12,
                }}
              >
                {selectedInsurance === "bundle" ? "PDF only · 1 combined or 2 separate · up to 200MB each" : "PDF only · up to 200MB"}
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
                multiple={selectedInsurance === "bundle"}
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
                    marginTop: 10,
                    borderRadius: 10,
                    border: `1px solid ${COLORS.dangerBorder}`,
                    background: COLORS.dangerSoft,
                    color: COLORS.danger,
                    padding: "8px 10px",
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}
                >
                  {errorMessage}
                </div>
              )}
            </div>
          </SidebarBlock>
          </div>
        </aside>

        <main
          style={{
            minWidth: 0,
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <GlassPanel borderRadius={0} style={{ flex: "0 0 auto", zIndex: 1, borderBottom: `1px solid rgba(23,101,212,0.06)` }}>
            <div style={{ padding: "22px 28px 18px 28px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 20,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: "Poppins, sans-serif",
                    fontSize: 20,
                    fontWeight: 600,
                    lineHeight: 1.2,
                    letterSpacing: "0",
                    color: COLORS.black,
                    marginBottom: 4,
                  }}
                >
                  {selectedInsurance === "homeowners"
                    ? "Homeowners Insurance Quote"
                    : selectedInsurance === "auto"
                      ? "Auto Insurance Quote"
                      : selectedInsurance === "dwelling"
                        ? "Dwelling Insurance Quote"
                        : selectedInsurance === "commercial"
                          ? "Commercial Insurance Quote"
                          : selectedInsurance === "bundle"
                            ? "Bundle Insurance Quote"
                            : "Insurance Quote"}
                </div>

                <div
                  style={{
                    fontSize: 13,
                    color: COLORS.mutedText,
                    fontWeight: 400,
                    lineHeight: 1.35,
                  }}
                >
                  The Sizemore Snapshot is an AI and can make mistakes. Please verify fields yourself, especially when marked "Double Check".
                </div>
              </div>

              <button
                ref={generateBtnRef}
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
                  height: 48,
                  width: 160,
                  padding: 0,
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: "Poppins, sans-serif",
                  cursor: isGenerating ? "not-allowed" : "pointer",
                  transition: "all 200ms ease",
                  boxShadow: isGenerateHovered
                    ? `0 0 28px ${COLORS.hoverShadow}`
                    : "0 0 0 rgba(0,0,0,0)",
                  flexShrink: 0,
                }}
              >
                {isGenerating ? "Creating..." : "Create Quote"}
              </button>
            </div>
            </div>
          </GlassPanel>

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
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.65)",
        backdropFilter: "blur(20px) saturate(1.6)",
        WebkitBackdropFilter: "blur(20px) saturate(1.6)",
        border: "1px solid rgba(180,200,230,0.3)",
        borderRadius: 18,
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
    "policy_term", "program",
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