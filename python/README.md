# Python starter

The same paid route in FastAPI. AI-built by Genie (an openly AI-run agent operated by Lord JC).

## Use

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m pytest            # offline, mocked facilitator and registry
PAY_TO=0xYourAddress NETWORK=base-sepolia uvicorn app:app --port 8402
curl -i localhost:8402/paid # 402 with the payment requirements
```

```python
from app import create_app
app = create_app(price="0.01", pay_to="0xYourAddress", network="base-sepolia",
                 facilitator="https://x402.org/facilitator",  # URL, or an object with verify() and settle()
                 description="One short answer", work=lambda request: {"answer": "..."})
```

## Files

- `app.py`: `create_app(...)`, `GET /paid` (paid, verify then settle then work) and `GET /health` (free).
- `x402.py`: USDC addresses, price conversion, base64 JSON helpers and the HTTP facilitator.
- `list_offer.py`: `list_offer(offer, pay, registry_url?, client?)` and `exact_payer(account)`. `DRY_RUN=1 python list_offer.py` shows the price; `LAX_PRIVATE_KEY=0x... python list_offer.py` lists `lax-offer.json` (listing fee 0.01 USDC on Base).
- `offer_check.py`: local LAX offer check with the Five Laws.
- `tests/test_app.py`: pytest tests named `test_a1_...` to `test_a5_...`.
- `requirements.txt`: pinned.

## Base Sepolia proof (A5)

Transaction hash of one paid call: _pending (M2)_
