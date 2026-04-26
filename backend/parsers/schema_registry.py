"""
schema_registry.py
==================
Central registry mapping insurance_type → {
    schema:            Gemini/OpenAI structured-output JSON schema
    status_msg:        human-readable status string for the UI spinner
    why_selected_type: key passed to the why-selected generator
}

Post-processing is handled generically by parsers/post_process.py
which walks the schema to fill defaults. No per-type normalizers needed.

Adding a new insurance type: define its schema here,
then add a skills/parse_{type}/SKILL.md skill file (with YAML frontmatter
``name`` + ``description``). That's it.
"""

from __future__ import annotations

# ─────────────────────────────────────────────────────────────────
# HOMEOWNERS
# ─────────────────────────────────────────────────────────────────

_HO_KEYS = [
    "total_premium", "quote_date", "quote_effective_date", "quote_expiration_date",
    "dwelling", "other_structures", "personal_property", "loss_of_use",
    "personal_liability", "medical_payments", "all_perils_deductible",
    "wind_hail_deductible", "water_and_sewer_backup",
    "client_name", "client_address", "client_phone", "client_email",
    "replacement_cost_on_contents", "25_extended_replacement_cost",
]

HOMEOWNERS_SCHEMA = {
    "type": "object",
    "properties": {
        **{k: {"type": "string"} for k in _HO_KEYS},
        "replacement_cost_on_contents": {"type": "string", "enum": ["Yes", "No"]},
        "25_extended_replacement_cost": {"type": "string", "enum": ["Yes", "No"]},
        "confidence": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in _HO_KEYS},
            "required": _HO_KEYS,
        },
    },
    "required": _HO_KEYS + ["confidence"],
}


# ─────────────────────────────────────────────────────────────────
# AUTO
# ─────────────────────────────────────────────────────────────────

_AUTO_FLAT_KEYS = [
    "client_name", "client_address", "client_phone",
    "quote_date", "quote_effective_date", "quote_expiration_date", "policy_term",
]
_AUTO_COVERAGE_KEYS = [
    "bi_limit", "pd_limit", "medpay_limit", "um_uim_bi_limit", "umpd_limit",
    "umpd_deductible",
]
# Limits / deductibles that are captured per-vehicle — they can differ between
# vehicles on the same policy (e.g. an older car often has lower rental limits
# or a higher comprehensive deductible than a newer one).
_AUTO_VEHICLE_DEDUCTIBLE_KEYS = [
    "comprehensive_deductible", "collision_deductible",
    "rental_limit", "towing_limit",
]
_AUTO_VEHICLE_PREMIUM_KEYS = [
    "bi_premium", "pd_premium", "medpay_premium", "um_uim_bi_premium", "umpd_premium",
    "comprehensive_premium", "collision_premium", "rental_premium", "towing_premium",
]
_AUTO_FULL_PAY_KEYS = ["full_pay_amount"]
_AUTO_INSTALLMENT_KEYS = ["down_payment", "amount_per_installment", "number_of_installments"]
_AUTO_PLAN_NAMES = ["full_pay", "semi_annual", "quarterly", "monthly"]
_AUTO_PIF_KEYS = ["gross_premium", "discount_amount", "net_pay_in_full"]
_AUTO_PREMIUM_SUMMARY_KEYS = ["total_premium", "paid_in_full_discount", "total_pay_in_full"]


def _auto_plan_keys(plan: str) -> list:
    return _AUTO_FULL_PAY_KEYS if plan == "full_pay" else _AUTO_INSTALLMENT_KEYS


def _auto_confidence_type(prop_def):
    t = prop_def.get("type")
    if t == "string":
        return {"type": "number"}
    if t == "array":
        items = prop_def.get("items", {})
        if items.get("type") == "object":
            cp = {k: _auto_confidence_type(v) for k, v in items.get("properties", {}).items()}
            return {"type": "array", "items": {"type": "object", "properties": cp, "required": list(cp.keys())}}
        return {"type": "array", "items": {"type": "number"}}
    if t == "object":
        cp = {k: _auto_confidence_type(v) for k, v in prop_def.get("properties", {}).items()}
        return {"type": "object", "properties": cp, "required": list(cp.keys())}
    return {"type": "number"}


_AUTO_DATA_PROPS = {
    "client_name": {"type": "string"}, "client_address": {"type": "string"},
    "client_phone": {"type": "string"}, "quote_date": {"type": "string"},
    "quote_effective_date": {"type": "string"}, "quote_expiration_date": {"type": "string"},
    "policy_term": {"type": "string", "enum": ["6-Month", "12-Month", "Unknown"]},
    "drivers": {"type": "array", "items": {"type": "object", "properties": {
        "driver_name": {"type": "string"}, "gender": {"type": "string", "enum": ["Male", "Female", "Unknown"]},
        "marital_status": {"type": "string"}, "license_state": {"type": "string"},
    }, "required": ["driver_name", "gender", "marital_status", "license_state"]}},
    "vehicles": {"type": "array", "items": {"type": "object", "properties": {
        "year_make_model_trim": {"type": "string"}, "vin": {"type": "string"},
        "vehicle_use": {"type": "string"}, "garaging_zip_county": {"type": "string"},
        "coverage_premiums": {"type": "object",
            "properties": {k: {"type": "string"} for k in _AUTO_VEHICLE_PREMIUM_KEYS},
            "required": _AUTO_VEHICLE_PREMIUM_KEYS},
        # Comprehensive + Collision deductibles and Rental / Towing limits
        # all vary per vehicle.
        **{k: {"type": "string"} for k in _AUTO_VEHICLE_DEDUCTIBLE_KEYS},
        "subtotal": {"type": "string"},
    }, "required": [
        "year_make_model_trim", "vin", "vehicle_use", "garaging_zip_county",
        "coverage_premiums", *_AUTO_VEHICLE_DEDUCTIBLE_KEYS, "subtotal",
    ]}},
    "coverages": {"type": "object", "properties": {k: {"type": "string"} for k in _AUTO_COVERAGE_KEYS}, "required": _AUTO_COVERAGE_KEYS},
    "payment_options": {"type": "object", "properties": {
        "full_pay": {"type": "object", "properties": {k: {"type": "string"} for k in _AUTO_FULL_PAY_KEYS}, "required": _AUTO_FULL_PAY_KEYS},
        **{plan: {"type": "object", "properties": {k: {"type": "string"} for k in _AUTO_INSTALLMENT_KEYS}, "required": _AUTO_INSTALLMENT_KEYS}
           for plan in ["semi_annual", "quarterly", "monthly"]},
        "paid_in_full_discount": {"type": "object", "properties": {k: {"type": "string"} for k in _AUTO_PIF_KEYS}, "required": _AUTO_PIF_KEYS},
    }, "required": _AUTO_PLAN_NAMES + ["paid_in_full_discount"]},
    "premium_summary": {"type": "object", "properties": {
        "vehicle_subtotals": {"type": "array", "items": {"type": "string"}},
        **{k: {"type": "string"} for k in _AUTO_PREMIUM_SUMMARY_KEYS},
    }, "required": ["vehicle_subtotals"] + _AUTO_PREMIUM_SUMMARY_KEYS},
}

AUTO_SCHEMA = {
    "type": "object",
    "properties": {
        **_AUTO_DATA_PROPS,
        "confidence": {
            "type": "object",
            "properties": {k: _auto_confidence_type(v) for k, v in _AUTO_DATA_PROPS.items()},
            "required": list(_AUTO_DATA_PROPS.keys()),
        },
    },
    "required": list(_AUTO_DATA_PROPS.keys()) + ["confidence"],
}


# ─────────────────────────────────────────────────────────────────
# DWELLING
# ─────────────────────────────────────────────────────────────────

def _make_dwelling_schema():
    prop_obj = {
        "type": "object",
        "properties": {
            "property_address": {"type": "string"},
            "year_built": {"type": "string"}, "construction_type": {"type": "string"},
            "roof_year": {"type": "string"}, "occupancy": {"type": "string"},
            "policy_form": {"type": "string"},
            "dwelling_limit": {"type": "string"}, "dwelling_loss_settlement": {"type": "string"},
            "other_structures_limit": {"type": "string"},
            "personal_property_limit": {"type": "string"}, "personal_property_loss_settlement": {"type": "string"},
            "personal_property_premium": {"type": "string"},
            "fair_rental_value_limit": {"type": "string"},
            "premises_liability_limit": {"type": "string"}, "premises_liability_premium": {"type": "string"},
            "medical_payments_limit": {"type": "string"},
            "water_backup_limit": {"type": "string"}, "water_backup_premium": {"type": "string"},
            "ordinance_or_law_limit": {"type": "string"}, "extended_replacement_cost": {"type": "string"},
            "aop_deductible": {"type": "string"}, "wind_hail_deductible": {"type": "string"},
            "deductible": {"type": "string"}, "wind_hail_included": {"type": "string"},
        },
    }
    prop_conf_props = {k: {"type": "number"} for k in prop_obj["properties"]}

    ps_obj = {
        "type": "object",
        "properties": {
            "total_premium": {"type": "string"},
            "pay_in_full_discount": {"type": "string"},
            "total_if_paid_in_full": {"type": "string"},
        },
    }
    ps_conf_props = {k: {"type": "number"} for k in ps_obj["properties"]}

    plan_obj = {
        "type": "object",
        "properties": {
            "full_pay_amount": {"type": "string"},
            "down_payment": {"type": "string"}, "amount_per_installment": {"type": "string"},
            "number_of_installments": {"type": "string"},
        },
    }
    # Paid-in-Full Discount mirrors auto's structure — a nested object under
    # payment_plans with gross_premium / discount_amount / net_pay_in_full.
    pif_obj = {
        "type": "object",
        "properties": {
            "gross_premium": {"type": "string"},
            "discount_amount": {"type": "string"},
            "net_pay_in_full": {"type": "string"},
        },
    }
    plans_obj = {
        "type": "object",
        "properties": {
            **{p: plan_obj for p in ["full_pay", "two_pay", "four_pay", "monthly"]},
            "paid_in_full_discount": pif_obj,
        },
    }

    return {
        "type": "object",
        "properties": {
            "named_insured": {"type": "string"}, "carrier_name": {"type": "string"},
            "quote_date": {"type": "string"}, "quote_effective_date": {"type": "string"},
            "quote_expiration_date": {"type": "string"},
            "agent_name": {"type": "string"}, "agent_address": {"type": "string"},
            "agent_phone": {"type": "string"}, "agent_email": {"type": "string"},
            "properties": {"type": "array", "items": prop_obj},
            "premium_summary": {"type": "array", "items": ps_obj},
            "payment_plans": plans_obj,
            "confidence": {
                "type": "object",
                "properties": {
                    "named_insured": {"type": "number"}, "carrier_name": {"type": "number"},
                    "quote_date": {"type": "number"}, "quote_effective_date": {"type": "number"},
                    "quote_expiration_date": {"type": "number"},
                    "agent_name": {"type": "number"}, "agent_address": {"type": "number"},
                    "agent_phone": {"type": "number"}, "agent_email": {"type": "number"},
                    "properties": {"type": "array", "items": {"type": "object",
                        "properties": prop_conf_props}},
                    "premium_summary": {"type": "array", "items": {"type": "object",
                        "properties": ps_conf_props}},
                },
            },
        },
        "required": ["named_insured", "quote_date", "properties", "premium_summary", "confidence"],
    }

DWELLING_SCHEMA = _make_dwelling_schema()


# ─────────────────────────────────────────────────────────────────
# COMMERCIAL
# ─────────────────────────────────────────────────────────────────

_COMM_FLAT_KEYS = [
    "named_insured", "mailing_address", "client_email", "client_phone", "policy_term",
    "total_premium", "quote_date", "quote_effective_date", "quote_expiration_date",
    "additional_premiums_taxes_fees",
    "agent_name", "agent_address", "agent_phone", "agent_email",
    "building_limit", "building_deductible", "bpp_limit", "bpp_deductible",
    "stretch_blanket", "business_income", "business_income_waiting_period",
    "equipment_breakdown", "back_up_sewers_drains", "ordinance_or_law", "wind_hail_deductible",
    "gl_each_occurrence", "gl_general_aggregate", "gl_products_completed_ops_aggregate",
    "gl_medical_expenses", "gl_damage_to_premises_rented", "gl_personal_advertising_injury",
    "wc_bi_accident_each_accident", "wc_bi_disease_policy_limit", "wc_bi_disease_each_employee",
    "umbrella_each_occurrence", "umbrella_aggregate",
    "cyber_aggregate_limit", "cyber_deductible", "cyber_breach_response",
    "cyber_business_interruption", "cyber_cyber_extortion", "cyber_funds_transfer_fraud",
    "cyber_regulatory_defense", "cyber_media_tech_liability",
    "wind_coverage", "wind_deductible", "wind_percent_deductible", "wind_coverage_premium",
    "wind_buydown", "wind_buydown_amount", "wind_buydown_premium",
]

_COMM_WC_CLASS_CODE_KEYS = ["class_code", "estimated_annual_remuneration", "rating", "premium"]

COMMERCIAL_SCHEMA = {
    "type": "object",
    "properties": {
        **{k: {"type": "string"} for k in _COMM_FLAT_KEYS},
        "wc_class_codes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {k: {"type": "string"} for k in _COMM_WC_CLASS_CODE_KEYS},
                "required": _COMM_WC_CLASS_CODE_KEYS,
            },
        },
        "confidence": {
            "type": "object",
            "properties": {k: {"type": "number"} for k in _COMM_FLAT_KEYS},
        },
    },
    "required": ["named_insured", "quote_date", "confidence"],
}


# ─────────────────────────────────────────────────────────────────
# BUNDLE  (home + auto combined)
# ─────────────────────────────────────────────────────────────────

def _make_bundle_schema():
    """
    Bundle schema — intentionally FLATTER than the naive home + auto union,
    so the schema fits inside Gemini's structured-output constraint-state
    limit (400 INVALID_ARGUMENT "too many states for serving" otherwise).

    Home alone and auto alone each fit on Gemini fine. Their direct sum
    plus a mirror-nested ``confidence`` block does not — the confidence
    mirror roughly doubles the state graph, and inner ``required`` lists
    + enum constraints multiply it further. Reusing ``HOMEOWNERS_SCHEMA``
    and ``_AUTO_DATA_PROPS`` unmodified produced a schema that Gemini
    rejected at request time, forcing every bundle Pass 2 through the
    OpenAI fallback (which until the paired fix also silently dropped
    the second PDF). Simplifying the bundle-only schema keeps bundle on
    Gemini while leaving the standalone homeowners/auto schemas untouched.

    Reductions applied *only* to the bundle variant:
      • no enum constraints (``replacement_cost_on_contents`` /
        ``25_extended_replacement_cost`` Yes/No, ``policy_term``,
        driver ``gender``) — the skill prompt already constrains the
        emitted values, so the schema-level enum is belt-and-suspenders.
      • no nested ``required`` arrays on drivers / vehicles /
        coverage_premiums / coverages / payment_options /
        premium_summary — ``post_process._fill_defaults_from_schema``
        fills any missing keys with "" from the schema walk, so dropping
        ``required`` is behavior-preserving.
      • the top-level ``confidence`` is left as an unconstrained
        ``{"type": "object"}``. The CORE_SYSTEM_PROMPT still asks the
        model to emit per-field confidence, and
        ``post_process.flatten_confidence`` walks whatever nested shape
        actually arrives — we just don't encode the mirror-shape in the
        schema anymore.
    """
    # Plain-string home props — drops Yes/No enums for bundle only.
    bundle_home_props = {k: {"type": "string"} for k in _HO_KEYS}

    # Auto data props — no enums, no inner ``required`` lists.
    bundle_auto_props = {
        "client_name": {"type": "string"},
        "client_address": {"type": "string"},
        "client_phone": {"type": "string"},
        "quote_date": {"type": "string"},
        "quote_effective_date": {"type": "string"},
        "quote_expiration_date": {"type": "string"},
        "policy_term": {"type": "string"},
        "drivers": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "driver_name": {"type": "string"},
                    "gender": {"type": "string"},
                    "marital_status": {"type": "string"},
                    "license_state": {"type": "string"},
                },
            },
        },
        "vehicles": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "year_make_model_trim": {"type": "string"},
                    "vin": {"type": "string"},
                    "vehicle_use": {"type": "string"},
                    "garaging_zip_county": {"type": "string"},
                    "coverage_premiums": {
                        "type": "object",
                        "properties": {
                            k: {"type": "string"} for k in _AUTO_VEHICLE_PREMIUM_KEYS
                        },
                    },
                    **{k: {"type": "string"} for k in _AUTO_VEHICLE_DEDUCTIBLE_KEYS},
                    "subtotal": {"type": "string"},
                },
            },
        },
        "coverages": {
            "type": "object",
            "properties": {k: {"type": "string"} for k in _AUTO_COVERAGE_KEYS},
        },
        "payment_options": {
            "type": "object",
            "properties": {
                "full_pay": {
                    "type": "object",
                    "properties": {
                        k: {"type": "string"} for k in _AUTO_FULL_PAY_KEYS
                    },
                },
                **{
                    plan: {
                        "type": "object",
                        "properties": {
                            k: {"type": "string"} for k in _AUTO_INSTALLMENT_KEYS
                        },
                    }
                    for plan in ["semi_annual", "quarterly", "monthly"]
                },
                "paid_in_full_discount": {
                    "type": "object",
                    "properties": {
                        k: {"type": "string"} for k in _AUTO_PIF_KEYS
                    },
                },
            },
        },
        "premium_summary": {
            "type": "object",
            "properties": {
                "vehicle_subtotals": {
                    "type": "array",
                    "items": {"type": "string"},
                },
                **{k: {"type": "string"} for k in _AUTO_PREMIUM_SUMMARY_KEYS},
            },
        },
    }

    return {
        "type": "object",
        "properties": {
            **bundle_home_props,
            **bundle_auto_props,
            # NOTE: these key names are the frontend's canonical names
            # (see frontend/src/configs/bundleConfig.js BUNDLE_POLICY_FIELDS
            # and fillers/bundle_filler_api.py). Renaming them away from
            # the frontend's names means extracted premiums never reach
            # the UI / PDF. Keep these synchronized with the frontend.
            "home_premium": {"type": "string"},
            "auto_premium": {"type": "string"},
            "bundle_discount": {"type": "string"},
            "bundle_total_premium": {"type": "string"},
            # Unconstrained object — prompt tells the model to emit
            # per-field confidence, but we don't mirror-encode the shape
            # here (that blew Gemini's state limit).
            "confidence": {"type": "object"},
        },
        "required": ["client_name", "quote_date", "confidence"],
    }

BUNDLE_SCHEMA = _make_bundle_schema()


# ─────────────────────────────────────────────────────────────────
# REGISTRY
# ─────────────────────────────────────────────────────────────────

_REGISTRY: dict[str, dict] = {
    "homeowners": {
        "schema": HOMEOWNERS_SCHEMA,
        "status_msg": "Verifying extracted homeowners fields...",
        "why_selected_type": "homeowners",
    },
    "auto": {
        "schema": AUTO_SCHEMA,
        "status_msg": "Verifying extracted auto fields...",
        "why_selected_type": "auto",
    },
    "dwelling": {
        "schema": DWELLING_SCHEMA,
        "status_msg": "Verifying extracted dwelling fields...",
        "why_selected_type": "dwelling",
    },
    "commercial": {
        "schema": COMMERCIAL_SCHEMA,
        "status_msg": "Verifying extracted commercial fields...",
        "why_selected_type": "commercial",
    },
    "bundle": {
        "schema": BUNDLE_SCHEMA,
        "status_msg": "Verifying extracted bundle fields...",
        "why_selected_type": "bundle",
    },
}


def get_registration(insurance_type: str) -> dict:
    """
    Return the registry entry for *insurance_type*.
    Raises ValueError for unknown types.
    """
    key = insurance_type.lower().strip()
    if key not in _REGISTRY:
        raise ValueError(
            f"Unknown insurance type '{key}'. "
            f"Available: {sorted(_REGISTRY.keys())}"
        )
    return _REGISTRY[key]


def supported_types() -> list[str]:
    return sorted(_REGISTRY.keys())
