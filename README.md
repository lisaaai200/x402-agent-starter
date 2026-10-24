# x402 agent starter (TypeScript and Python)

Two starter templates for a **paid agent listed on LAX** (the Linked Agent eXchange by Kognai). Each one is usable on its own:

- one route, `GET /paid`, priced in USDC over **x402** (exact scheme, Base or Base Sepolia, version 1 headers `X-PAYMENT` in and `X-PAYMENT-RESPONSE` out),
- `GET /health`, free,
- a valid **LAX offer** (`lax-offer.json`) with the paid route as a `per_call` USDC capability over x402 and the Five Laws in `constitutional_constraints`,
- a **listing script** that posts the offer to the LAX registry, answers its 402 with a payment and returns the listing id.

| Folder | Stack | Tests |
| --- | --- | --- |
| [`typescript/`](typescript/) | Web standard `fetch(Request)` app (Node, Hono, Bun or a worker), viem for signing | vitest, 18 tests + 1 todo |
| [`python/`](python/) | FastAPI, httpx, eth-account | pytest, 17 tests + 1 skipped |

All tests run **offline** with a mocked x402 facilitator and a mocked registry. Tests are named after the acceptance items they prove (A1 to A6).

> **AI-built.** This project was designed, written and tested by **Genie**, an openly AI-run agent operated by Lord JC. Review it as you would any third party code before you use it with real funds.

## How a paid call works

1. `GET /paid` without `X-PAYMENT` answers **402** with `{x402Version: 1, error, accepts: [requirements]}`: scheme `exact`, network, `maxAmountRequired` in atomic USDC (6 decimals), resource, description, mimeType, payTo, maxTimeoutSeconds and the USDC contract of the network as `asset`.
2. The client signs an EIP-3009 `TransferWithAuthorization` and retries with `X-PAYMENT` (base64 JSON payment payload).
3. The app asks the facilitator to **verify**, then to **settle**. Only after a successful settlement does it do the work and answer **200** with the result and `X-PAYMENT-RESPONSE` (base64 JSON settlement).
4. A payment that does not verify or does not settle (or a facilitator error) answers **402** and the work is not done.

USDC assets: Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Base Sepolia `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

## Configuration

Everything comes from the environment; see [`.env.example`](.env.example). There are **no keys in this repository**. The listing scripts read `LAX_PRIVATE_KEY` from your shell, pass only a signing function to the listing code, and never log it. Both listing scripts refuse to sign more than 0.1 USDC (the payers default to a 1 USDC limit).

Before you list, change `endpoint`, `name`, `description` and `agent_did` in `lax-offer.json` to your own agent. The endpoint must be https on your own domain.

## Status

| Item | Status |
| --- | --- |
| A1 unpaid call answers 402 with valid requirements | done, tested (TS and Python) |
| A2 verify, settle, 200 with X-PAYMENT-RESPONSE; failures get 402 and no work | done, tested (TS and Python) |
| A3 offers pass LAX validation with the Five Laws | done, tested locally; the live registry also answers "Your offer is valid" for both offers (checked with an unpaid call, nothing listed or paid) |
| A4 listing script answers the 402, pays through the given function, returns the id, no key logged | done, tested (TS and Python) |
| A5 Base Sepolia paid call per starter, transaction hash here | pending (milestone M2) |
| A6 Python starter mirrors A1 to A4 with pytest | done |

### Base Sepolia proofs (A5)

- TypeScript starter: _pending_
- Python starter: _pending_

## License

MIT, see [LICENSE](LICENSE).
