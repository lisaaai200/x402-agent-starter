"""Paid agent starter (FastAPI): GET /paid priced in USDC over x402, GET /health free.

Run: PAY_TO=0x... NETWORK=base-sepolia uvicorn app:app --port 8402
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from x402 import DEFAULT_FACILITATOR_URL, USDC, HttpFacilitator, decode_b64_json, encode_b64_json, to_atomic_usdc

DEFAULT_DESCRIPTION = "Paid agent route: one call, priced in USDC over x402."


def default_work(request: Request) -> Any:
    q = request.query_params.get("q", "")
    return {"answer": f"You asked: {q}" if q else "Paid call accepted.", "servedAt": datetime.now(timezone.utc).isoformat()}


def create_app(
    *,
    price: str,
    pay_to: str,
    network: str,
    facilitator: Any = None,
    description: str | None = None,
    work: Callable[[Request], Any] | None = None,
    max_timeout_seconds: int = 60,
) -> FastAPI:
    if network not in USDC:
        raise ValueError('network must be "base" or "base-sepolia"')
    if not isinstance(pay_to, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", pay_to):
        raise ValueError("pay_to must be an address (0x and 40 hex)")
    amount = to_atomic_usdc(price)
    if facilitator is None or isinstance(facilitator, str):
        facilitator = HttpFacilitator(facilitator or DEFAULT_FACILITATOR_URL)
    usdc = USDC[network]
    work = work or default_work
    app = FastAPI(title="x402 agent starter")

    def requirements(request: Request) -> dict:
        url = request.url
        return {
            "scheme": "exact",
            "network": network,
            "maxAmountRequired": amount,
            "resource": f"{url.scheme}://{url.netloc}{url.path}",
            "description": description or DEFAULT_DESCRIPTION,
            "mimeType": "application/json",
            "payTo": pay_to,
            "maxTimeoutSeconds": max_timeout_seconds,
            "asset": usdc["address"],
            "extra": {"name": usdc["name"], "version": usdc["version"]},
        }

    def payment_required(reqs: dict, error: str) -> JSONResponse:
        return JSONResponse({"x402Version": 1, "error": error, "accepts": [reqs]}, status_code=402)

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.get("/paid")
    async def paid(request: Request):
        reqs = requirements(request)
        header = request.headers.get("x-payment")
        if not header:
            return payment_required(reqs, "X-PAYMENT header is required")
        try:
            payment = decode_b64_json(header)
        except Exception:
            return payment_required(reqs, "X-PAYMENT is not base64 JSON")
        if not isinstance(payment, dict) or payment.get("x402Version") != 1:
            return payment_required(reqs, "unsupported x402Version")
        if payment.get("scheme") != "exact" or payment.get("network") != network:
            return payment_required(reqs, "payment scheme or network does not match")
        try:
            verified = facilitator.verify(payment, reqs)
        except Exception:
            return payment_required(reqs, "payment verification failed")
        if not verified or not verified.get("isValid"):
            return payment_required(reqs, (verified or {}).get("invalidReason") or "payment did not verify")
        try:
            settlement = facilitator.settle(payment, reqs)
        except Exception:
            return payment_required(reqs, "payment settlement failed")
        if not settlement or not settlement.get("success"):
            return payment_required(reqs, (settlement or {}).get("errorReason") or "payment did not settle")
        result = work(request)  # paid and settled: now do the work
        return JSONResponse({"result": result}, headers={"X-PAYMENT-RESPONSE": encode_b64_json(settlement)})

    return app


def _from_env() -> FastAPI | None:
    pay_to = os.environ.get("PAY_TO")
    if not pay_to:
        return None
    return create_app(
        price=os.environ.get("PRICE_USDC", "0.01"),
        pay_to=pay_to,
        network=os.environ.get("NETWORK", "base-sepolia"),
        facilitator=os.environ.get("X402_FACILITATOR_URL", DEFAULT_FACILITATOR_URL),
        description=os.environ.get("DESCRIPTION"),
    )


app = _from_env()
