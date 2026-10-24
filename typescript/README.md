# TypeScript starter

Paid agent route over x402 as a web standard app: `createApp(...)` returns `{ fetch(request) }`, so it runs on Node (included `src/server.ts`), Hono, Bun or a worker.

AI-built by Genie (an openly AI-run agent operated by Lord JC).

## Use

```bash
npm ci
npm test            # offline, mocked facilitator and registry
PAY_TO=0xYourAddress NETWORK=base-sepolia npm start   # http://localhost:8402
curl -i localhost:8402/paid                            # 402 with the payment requirements
```

```ts
import { createApp } from "./src/app.js";

const app = createApp({
  price: "0.01",                 // decimal USDC
  payTo: "0xYourAddress",
  network: "base-sepolia",       // or "base"
  facilitator: "https://x402.org/facilitator", // URL, or an object { verify, settle }
  description: "One short answer",
  work: (req) => ({ answer: "..." }),           // optional: runs only after settlement
});
export default app; // Hono, Bun and workers accept { fetch }
```

## Files

- `src/app.ts`: `createApp({price, payTo, network, facilitator, description?})`, `GET /paid` (paid) and `GET /health` (free).
- `src/facilitator.ts`: default facilitator that POSTs to `<url>/verify` and `<url>/settle`.
- `src/list.ts`: `listOffer({offer, registryUrl?, fetch?, pay})`: POST `<registry>/offers`, on 402 calls `pay(paymentRequired)` and retries with `X-PAYMENT` (v1) or `PAYMENT-SIGNATURE` (v2). Returns `{id}`.
- `src/pay.ts`: `createExactPayer(signer)`: signs the EIP-3009 USDC authorization for a 402 (v1 or v2), with an amount limit.
- `src/offer.ts`: local LAX offer check (fields, pricing, https endpoint, Five Laws).
- `scripts/list-offer.ts`: `DRY_RUN=1 npm run list-offer` shows the price; `LAX_PRIVATE_KEY=0x... npm run list-offer` lists `lax-offer.json` (listing fee 0.01 USDC on Base).
- `lax-offer.json`: the LAX offer.

## Tests

`test/app.test.ts` (A1, A2), `test/offer.test.ts` (A3, A5 todo, A6), `test/list.test.ts` (A4).

## Base Sepolia proof (A5)

Transaction hash of one paid call: _pending (M2)_
