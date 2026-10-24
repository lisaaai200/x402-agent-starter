"""List lax-offer.json on the LAX registry.

Run: LAX_PRIVATE_KEY=0x... python list_offer.py   (DRY_RUN=1 stops at the 402 and prints the price)
The listing fee (0.01 USDC on Base at the time of writing) is paid by the key's wallet. The key is read
from the environment by this script only; list_offer() never sees it and nothing logs it.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import sys
import time
from pathlib import Path
from typing import Any, Callable

from x402 import CAIP2, USDC, decode_b64_json, encode_b64_json

DEFAULT_REGISTRY_URL = "https://lax.kognai.ai/registry"


class ListOfferError(Exception):
    def __init__(self, message: str, status: int, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


def _body(res: Any) -> Any:
    try:
        return res.json()
    except Exception:
        return res.text or None


def _id(body: Any) -> str | None:
    if isinstance(body, dict):
        if isinstance(body.get("id"), str) and body["id"]:
            return body["id"]
        offer = body.get("offer")
        if isinstance(offer, dict) and isinstance(offer.get("id"), str) and offer["id"]:
            return offer["id"]
    return None


def list_offer(offer: dict, pay: Callable[[dict], str], registry_url: str = DEFAULT_REGISTRY_URL, client: Any = None) -> dict:
    """POST <registry_url>/offers; on 402 call pay(payment_required) and post again with X-PAYMENT (v1)
    or PAYMENT-SIGNATURE (v2). Returns {"id": listing id}."""
    if client is None:
        import httpx

        client = httpx.Client(timeout=30)
    url = registry_url.rstrip("/") + "/offers"
    res = client.post(url, json=offer)
    body = _body(res)
    if res.status_code == 402:
        required = None
        header = res.headers.get("payment-required")
        if header:
            try:
                required = decode_b64_json(header)
            except Exception:
                required = None
        if required is None:
            if not isinstance(body, dict):
                raise ListOfferError("registry answered 402 without payment requirements", 402, body)
            required = body
        payment = pay(required)
        if not isinstance(payment, str) or not payment:
            raise ListOfferError("pay() returned no payment header", 402)
        name = "PAYMENT-SIGNATURE" if required.get("x402Version") == 2 else "X-PAYMENT"
        res = client.post(url, json=offer, headers={name: payment})
        body = _body(res)
    if res.status_code >= 400:
        raise ListOfferError(f"registry answered {res.status_code}", res.status_code, body)
    listing_id = _id(body)
    if not listing_id:
        raise ListOfferError("registry answer has no listing id", res.status_code, body)
    return {"id": listing_id}


def exact_payer(account: Any, max_atomic: int = 1_000_000, now: Callable[[], int] = lambda: int(time.time())) -> Callable[[dict], str]:
    """pay() for list_offer: signs an EIP-3009 TransferWithAuthorization for the exact USDC requirement on Base.
    `account` is an eth_account LocalAccount. Refuses amounts above max_atomic."""

    def pay(required: dict) -> str:
        version = 2 if required.get("x402Version") == 2 else 1
        req = next(
            (a for a in required.get("accepts") or [] if isinstance(a, dict) and a.get("scheme") == "exact" and (a.get("network") in USDC or a.get("network") in CAIP2)),
            None,
        )
        if req is None:
            raise ValueError("no exact USDC requirement on Base in the 402")
        network = CAIP2.get(req["network"], req["network"])
        usdc = USDC[network]
        value = str(req.get("maxAmountRequired") or req.get("amount") or "")
        if not value.isdigit():
            raise ValueError("payment amount missing")
        if int(value) > max_atomic:
            raise ValueError(f"payment of {value} atomic USDC is above the limit")
        if str(req.get("asset", "")).lower() != usdc["address"].lower():
            raise ValueError("asset is not USDC on this network")
        t = now()
        auth = {
            "from": account.address,
            "to": req["payTo"],
            "value": value,
            "validAfter": str(t - 600),
            "validBefore": str(t + int(req.get("maxTimeoutSeconds") or 60)),
            "nonce": "0x" + secrets.token_hex(32),
        }
        extra = req.get("extra") or {}
        signed = account.sign_typed_data(
            domain_data={"name": extra.get("name", usdc["name"]), "version": extra.get("version", usdc["version"]), "chainId": usdc["chain_id"], "verifyingContract": usdc["address"]},
            message_types={
                "TransferWithAuthorization": [
                    {"name": "from", "type": "address"},
                    {"name": "to", "type": "address"},
                    {"name": "value", "type": "uint256"},
                    {"name": "validAfter", "type": "uint256"},
                    {"name": "validBefore", "type": "uint256"},
                    {"name": "nonce", "type": "bytes32"},
                ]
            },
            message_data={**auth, "value": int(auth["value"]), "validAfter": int(auth["validAfter"]), "validBefore": int(auth["validBefore"]), "nonce": bytes.fromhex(auth["nonce"][2:])},
        )
        sig = signed.signature.hex()
        payload = {"signature": sig if sig.startswith("0x") else "0x" + sig, "authorization": auth}
        if version == 2:
            body = {"x402Version": 2, "resource": required.get("resource"), "accepted": req, "payload": payload}
        else:
            body = {"x402Version": 1, "scheme": "exact", "network": req["network"], "payload": payload}
        return encode_b64_json(body)

    return pay


def main() -> int:
    offer = json.loads((Path(__file__).parent / "lax-offer.json").read_text())
    registry = os.environ.get("LAX_REGISTRY_URL", DEFAULT_REGISTRY_URL)
    if os.environ.get("DRY_RUN") == "1":
        def pay(required: dict) -> str:
            print("Registry asks for:", json.dumps(required.get("accepts", required)))
            raise SystemExit(0)
    else:
        key = os.environ.get("LAX_PRIVATE_KEY", "")
        if not re.fullmatch(r"0x[0-9a-fA-F]{64}", key):
            print("Set LAX_PRIVATE_KEY (0x and 64 hex) in the environment, or DRY_RUN=1.", file=sys.stderr)
            return 1
        from eth_account import Account

        pay = exact_payer(Account.from_key(key), max_atomic=100_000)
        del key
    try:
        print("Listed:", list_offer(offer, pay, registry)["id"])
        return 0
    except ListOfferError as e:
        print(f"Listing failed: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
