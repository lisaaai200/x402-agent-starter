"""pytest tests named after the acceptance items. Offline: mocked facilitator and registry."""
import json
from pathlib import Path

import httpx
import pytest
from eth_account import Account
from eth_account.messages import encode_typed_data
from fastapi.testclient import TestClient

from app import create_app
from list_offer import ListOfferError, exact_payer, list_offer
from offer_check import FIVE_LAWS, validate_offer
from x402 import HttpFacilitator, decode_b64_json, encode_b64_json, to_atomic_usdc

PAY_TO = "0x1111111111111111111111111111111111111111"
TX = "0x" + "ab" * 32
HERE = Path(__file__).resolve().parent.parent


class MockFacilitator:
    def __init__(self, verify=None, settle=None):
        self.calls, self._verify, self._settle = [], verify, settle

    def verify(self, payload, reqs):
        self.calls.append("verify")
        if isinstance(self._verify, Exception):
            raise self._verify
        return self._verify or {"isValid": True}

    def settle(self, payload, reqs):
        self.calls.append("settle")
        if isinstance(self._settle, Exception):
            raise self._settle
        return self._settle or {"success": True, "transaction": TX, "network": reqs["network"]}


def payment(network="base-sepolia", **extra):
    return encode_b64_json({"x402Version": 1, "scheme": "exact", "network": network, "payload": {"signature": "0x" + "00" * 65, "authorization": {}}, **extra})


def client(fac, network="base-sepolia", price="0.01", work=None):
    return TestClient(create_app(price=price, pay_to=PAY_TO, network=network, facilitator=fac, description="Test route", work=work), base_url="https://agent.example.com")


# A1
def test_a1_unpaid_call_answers_402_with_requirements():
    fac = MockFacilitator()
    res = client(fac).get("/paid")
    assert res.status_code == 402
    body = res.json()
    assert body["x402Version"] == 1 and isinstance(body["error"], str)
    r = body["accepts"][0]
    assert r["scheme"] == "exact" and r["network"] == "base-sepolia" and r["maxAmountRequired"] == "10000"
    assert r["resource"] == "https://agent.example.com/paid" and r["description"] == "Test route"
    assert r["mimeType"] == "application/json" and r["payTo"] == PAY_TO and r["maxTimeoutSeconds"] > 0
    assert r["asset"] == "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    assert fac.calls == []


def test_a1_base_network_and_price():
    r = client(MockFacilitator(), network="base", price="1.5").get("/paid").json()["accepts"][0]
    assert r["asset"] == "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" and r["maxAmountRequired"] == "1500000"
    assert to_atomic_usdc("0.000001") == "1"
    for bad in ("0.0000001", "-1", "0", "abc"):
        with pytest.raises(ValueError):
            to_atomic_usdc(bad)
    with pytest.raises(ValueError):
        create_app(price="0.01", pay_to="nope", network="base", facilitator=MockFacilitator())


def test_a1_health_is_free():
    fac = MockFacilitator()
    assert client(fac).get("/health").json() == {"ok": True}
    assert fac.calls == []


# A2
def test_a2_paid_call_verified_settled_then_200():
    fac, done = MockFacilitator(), []
    res = client(fac, work=lambda r: done.append(1) or {"done": True}).get("/paid", headers={"X-PAYMENT": payment()})
    assert res.status_code == 200 and res.json() == {"result": {"done": True}}
    assert fac.calls == ["verify", "settle"] and done == [1]
    assert decode_b64_json(res.headers["X-PAYMENT-RESPONSE"]) == {"success": True, "transaction": TX, "network": "base-sepolia"}


@pytest.mark.parametrize(
    "fac,header,calls",
    [
        (MockFacilitator(verify={"isValid": False, "invalidReason": "insufficient_funds"}), payment(), ["verify"]),
        (MockFacilitator(settle={"success": False, "transaction": "", "errorReason": "settle_failed"}), payment(), ["verify", "settle"]),
        (MockFacilitator(verify=RuntimeError("down")), payment(), ["verify"]),
        (MockFacilitator(settle=RuntimeError("down")), payment(), ["verify", "settle"]),
        (MockFacilitator(), "not base64!", []),
        (MockFacilitator(), payment("base"), []),
        (MockFacilitator(), payment(x402Version=9), []),
    ],
)
def test_a2_failed_payment_gets_402_and_no_work(fac, header, calls):
    done = []
    res = client(fac, work=lambda r: done.append(1)).get("/paid", headers={"X-PAYMENT": header})
    assert res.status_code == 402 and res.json()["accepts"][0]["payTo"] == PAY_TO
    assert "x-payment-response" not in res.headers
    assert fac.calls == calls and done == []


def test_a2_http_facilitator_posts_v1_bodies():
    seen = []

    def handler(request: httpx.Request):
        seen.append((str(request.url), json.loads(request.content)))
        if request.url.path.endswith("/verify"):
            return httpx.Response(200, json={"isValid": True})
        return httpx.Response(200, json={"success": True, "transaction": TX, "network": "base-sepolia"})

    fac = HttpFacilitator("https://facilitator.test/", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert client(fac).get("/paid", headers={"X-PAYMENT": payment()}).status_code == 200
    assert [u for u, _ in seen] == ["https://facilitator.test/verify", "https://facilitator.test/settle"]
    assert seen[0][1]["x402Version"] == 1 and seen[0][1]["paymentRequirements"]["payTo"] == PAY_TO


# A3
def test_a3_offer_is_valid_with_five_laws():
    offer = json.loads((HERE / "lax-offer.json").read_text())
    assert validate_offer(offer) == []
    assert offer["capabilities"][0]["pricing"] == {"model": "per_call", "amount": "0.01", "currency": "USDC", "rail": "x402"}
    assert offer["endpoint"].startswith("https://")
    assert all(law in offer["constitutional_constraints"] for law in FIVE_LAWS)
    assert "constitutional_constraints is missing Harm Shield" in validate_offer({**offer, "constitutional_constraints": FIVE_LAWS[:3] + FIVE_LAWS[4:]})
    assert validate_offer({**offer, "endpoint": "http://insecure.example"})


# A4
V2 = {
    "x402Version": 2,
    "resource": {"url": "https://registry.test/offers"},
    "accepts": [{"scheme": "exact", "network": "eip155:8453", "amount": "10000", "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                 "payTo": "0x3333333333333333333333333333333333333333", "maxTimeoutSeconds": 60, "extra": {"name": "USD Coin", "version": "2"}}],
}


def registry(first, second):
    calls = []

    def handler(request: httpx.Request):
        calls.append(request)
        return first() if len(calls) == 1 else second()

    return httpx.Client(transport=httpx.MockTransport(handler)), calls


def test_a4_v2_registry_402_paid_and_id_returned():
    c, calls = registry(lambda: httpx.Response(402, json={"x402Version": 2}, headers={"PAYMENT-REQUIRED": encode_b64_json(V2)}),
                        lambda: httpx.Response(200, json={"ok": True, "id": "lax-ext-123"}))
    got = []
    out = list_offer({"name": "x"}, lambda r: got.append(r) or "signed", "https://registry.test/", client=c)
    assert out == {"id": "lax-ext-123"} and got == [V2]
    assert [str(r.url) for r in calls] == ["https://registry.test/offers"] * 2
    assert "payment-signature" not in calls[0].headers and calls[1].headers["payment-signature"] == "signed"


def test_a4_v1_body_and_x_payment_and_errors():
    c, calls = registry(lambda: httpx.Response(402, json={"x402Version": 1, "accepts": []}),
                        lambda: httpx.Response(201, json={"ok": True, "offer": {"id": "lax-ext-9"}}))
    assert list_offer({"name": "x"}, lambda r: "p1", client=c) == {"id": "lax-ext-9"}
    assert str(calls[0].url) == "https://lax.kognai.ai/registry/offers" and calls[1].headers["x-payment"] == "p1"
    paid = []
    c2, _ = registry(lambda: httpx.Response(422, json={"error": "invalid"}), lambda: httpx.Response(500))
    with pytest.raises(ListOfferError) as e:
        list_offer({"name": "x"}, lambda r: paid.append(1) or "p", client=c2)
    assert e.value.status == 422 and paid == []


def test_a4_key_never_sent_or_logged_and_signature_valid(capsys):
    acct = Account.create()
    key_hex = acct.key.hex().removeprefix("0x")
    c, calls = registry(lambda: httpx.Response(402, json=V2), lambda: httpx.Response(200, json={"ok": True, "id": "lax-ext-key"}))
    assert list_offer({"name": "x"}, exact_payer(acct, now=lambda: 1_800_000_000), client=c)["id"] == "lax-ext-key"
    out = capsys.readouterr()
    assert out.out == "" and out.err == ""
    for r in calls:
        assert key_hex not in (r.content.decode() + json.dumps(dict(r.headers))).lower()
    pay = decode_b64_json(calls[1].headers["payment-signature"])
    assert pay["x402Version"] == 2 and pay["accepted"]["network"] == "eip155:8453"
    a = pay["payload"]["authorization"]
    assert a["from"] == acct.address and a["value"] == "10000"
    msg = encode_typed_data(full_message={
        "types": {"EIP712Domain": [{"name": "name", "type": "string"}, {"name": "version", "type": "string"}, {"name": "chainId", "type": "uint256"}, {"name": "verifyingContract", "type": "address"}],
                  "TransferWithAuthorization": [{"name": "from", "type": "address"}, {"name": "to", "type": "address"}, {"name": "value", "type": "uint256"},
                                                {"name": "validAfter", "type": "uint256"}, {"name": "validBefore", "type": "uint256"}, {"name": "nonce", "type": "bytes32"}]},
        "primaryType": "TransferWithAuthorization",
        "domain": {"name": "USD Coin", "version": "2", "chainId": 8453, "verifyingContract": V2["accepts"][0]["asset"]},
        "message": {**a, "value": int(a["value"]), "validAfter": int(a["validAfter"]), "validBefore": int(a["validBefore"]), "nonce": bytes.fromhex(a["nonce"][2:])},
    })
    assert Account.recover_message(msg, signature=pay["payload"]["signature"]) == acct.address


def test_a4_payer_refuses_over_limit():
    with pytest.raises(ValueError, match="above the limit"):
        exact_payer(Account.create(), max_atomic=5000)(V2)


# A5
def test_a5_base_sepolia_paid_call():
    root = Path(__file__).resolve().parents[2] / "README.md"
    local = Path(__file__).resolve().parents[1] / "README.md"
    tx = "0x08555824aabaf82199f1dedf99e66654a32d2d948c3c892f763ef36aca9a9af8"
    assert tx in root.read_text()
    assert tx in local.read_text()
    assert f"sepolia.basescan.org/tx/{tx}" in root.read_text()
