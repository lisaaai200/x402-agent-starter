"""Local check of a LAX offer against https://lax.kognai.ai/aiax/sections/lax_offer.json."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

FIVE_LAWS = ["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"]
DECIMAL = re.compile(r"\d+(\.\d{1,6})?")


def _https(u: Any) -> bool:
    return isinstance(u, str) and urlparse(u).scheme == "https" and bool(urlparse(u).netloc)


def validate_offer(offer: Any) -> list[str]:
    """Returns a list of problems; empty means valid."""
    if not isinstance(offer, dict):
        return ["offer must be an object"]
    e: list[str] = []
    if offer.get("lax_version", "1.0") != "1.0":
        e.append("lax_version must be 1.0")
    name, desc = offer.get("name"), offer.get("description")
    if not isinstance(name, str) or not 3 <= len(name) <= 80:
        e.append("name must be 3 to 80 characters")
    if not isinstance(desc, str) or not 20 <= len(desc) <= 600:
        e.append("description must be 20 to 600 characters")
    if "category" in offer and (not isinstance(offer["category"], str) or not 2 <= len(offer["category"]) <= 40):
        e.append("category must be 2 to 40 characters")
    if not _https(offer.get("endpoint")) and not _https(offer.get("pact_endpoint")):
        e.append("endpoint or pact_endpoint must be an https url")
    if "agent_did" in offer and not re.fullmatch(r"did:[a-z0-9]+:.+", str(offer["agent_did"])):
        e.append("agent_did must be did:method:identifier")
    caps = offer.get("capabilities")
    if not isinstance(caps, list) or not 1 <= len(caps) <= 10:
        e.append("capabilities must have 1 to 10 items")
        caps = []
    for i, c in enumerate(caps):
        p = (c or {}).get("pricing") or {}
        if not (c or {}).get("skill_id"):
            e.append(f"capabilities[{i}].skill_id is required")
        if not (c or {}).get("description"):
            e.append(f"capabilities[{i}].description is required")
        if p.get("model") not in ("per_call", "per_minute", "flat", "free"):
            e.append(f"capabilities[{i}].pricing.model is invalid")
        elif p["model"] != "free" and not (isinstance(p.get("amount"), str) and DECIMAL.fullmatch(p["amount"])):
            e.append(f"capabilities[{i}].pricing.amount must be a decimal string")
        if p.get("currency") != "USDC":
            e.append(f"capabilities[{i}].pricing.currency must be USDC")
        if p.get("rail") != "x402":
            e.append(f"capabilities[{i}].pricing.rail must be x402")
    if caps and not any(((c or {}).get("pricing") or {}).get("model") == "per_call" for c in caps):
        e.append("needs a capability priced per_call in USDC over x402")
    laws = offer.get("constitutional_constraints")
    if not isinstance(laws, list):
        e.append("constitutional_constraints must be an array")
    else:
        e += [f"constitutional_constraints is missing {law}" for law in FIVE_LAWS if law not in laws]
    rails = offer.get("payment_rails")
    if rails is not None and (not isinstance(rails, list) or any(r not in ("x402", "usdc", "usdc-base") for r in rails)):
        e.append("payment_rails may only hold x402, usdc or usdc-base")
    return e
