"""x402 version 1 helpers for the exact scheme on Base with USDC."""
from __future__ import annotations

import base64
import json
import re
from decimal import Decimal
from typing import Any, Protocol

USDC = {
    "base": {"address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "name": "USD Coin", "version": "2", "chain_id": 8453},
    "base-sepolia": {"address": "0x036CbD53842c5426634e7929541eC2318f3dCF7e", "name": "USDC", "version": "2", "chain_id": 84532},
}
CAIP2 = {"eip155:8453": "base", "eip155:84532": "base-sepolia"}
DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator"


def to_atomic_usdc(price: str) -> str:
    """"0.01" -> "10000". USDC has 6 decimals."""
    if not isinstance(price, str) or not re.fullmatch(r"\d+(\.\d{1,6})?", price):
        raise ValueError(f"price must be a decimal USDC string with at most 6 decimals, got {price!r}")
    atomic = int(Decimal(price) * 1_000_000)
    if atomic <= 0:
        raise ValueError("price must be greater than 0")
    return str(atomic)


def encode_b64_json(value: Any) -> str:
    return base64.b64encode(json.dumps(value, separators=(",", ":")).encode()).decode()


def decode_b64_json(value: str) -> Any:
    return json.loads(base64.b64decode(value.strip(), validate=True).decode())


class Facilitator(Protocol):
    def verify(self, payment_payload: dict, payment_requirements: dict) -> dict: ...  # {isValid, invalidReason?}
    def settle(self, payment_payload: dict, payment_requirements: dict) -> dict: ...  # {success, transaction, network, errorReason?}


class HttpFacilitator:
    """POST <url>/verify and <url>/settle with an x402 version 1 body."""

    def __init__(self, url: str = DEFAULT_FACILITATOR_URL, client: Any = None, headers: dict | None = None):
        import httpx

        self.url = url.rstrip("/")
        self.client = client or httpx.Client(timeout=30)
        self.headers = headers or {}

    def _call(self, op: str, payload: dict, requirements: dict) -> dict:
        res = self.client.post(
            f"{self.url}/{op}",
            json={"x402Version": payload.get("x402Version", 1), "paymentPayload": payload, "paymentRequirements": requirements},
            headers=self.headers,
        )
        if res.status_code >= 400:
            raise RuntimeError(f"facilitator {op} answered {res.status_code}")
        return res.json()

    def verify(self, payment_payload: dict, payment_requirements: dict) -> dict:
        return self._call("verify", payment_payload, payment_requirements)

    def settle(self, payment_payload: dict, payment_requirements: dict) -> dict:
        return self._call("settle", payment_payload, payment_requirements)
