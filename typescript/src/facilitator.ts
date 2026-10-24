import type { Facilitator, PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "./x402.js";

/** Public x402 facilitator for Base Sepolia tests. Production should set X402_FACILITATOR_URL. */
export const DEFAULT_FACILITATOR_URL = "https://x402.org/facilitator";

/**
 * Facilitator that calls POST <url>/verify and POST <url>/settle (x402 version 1 body).
 * Pass `headers` for facilitators that need an API key; read it from the environment, never hard code it.
 */
export function httpFacilitator(
  url: string = DEFAULT_FACILITATOR_URL,
  opts: { fetch?: typeof fetch; headers?: Record<string, string> } = {},
): Facilitator {
  const doFetch = opts.fetch ?? fetch;
  const base = url.replace(/\/+$/, "");
  async function call<T>(path: "verify" | "settle", paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<T> {
    const res = await doFetch(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(opts.headers ?? {}) },
      body: JSON.stringify({ x402Version: paymentPayload.x402Version ?? 1, paymentPayload, paymentRequirements }),
    });
    if (!res.ok) throw new Error(`facilitator ${path} answered ${res.status}`);
    return (await res.json()) as T;
  }
  return {
    verify: (p, r) => call<VerifyResponse>("verify", p, r),
    settle: (p, r) => call<SettleResponse>("settle", p, r),
  };
}
