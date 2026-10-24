import { decodeBase64Json } from "./x402.js";

export const DEFAULT_REGISTRY_URL = "https://lax.kognai.ai/registry";

/** What the registry sent with its 402: the decoded PAYMENT-REQUIRED header (version 2) or the JSON body. */
export type PaymentRequired = { x402Version?: number; accepts?: unknown[]; [key: string]: unknown };

export interface ListOfferOptions {
  offer: unknown;
  registryUrl?: string;
  fetch?: typeof fetch;
  /** Returns the payment header value for the registry's 402. The caller holds the key; it never reaches this function. */
  pay: (paymentRequired: PaymentRequired) => Promise<string> | string;
}

export class ListOfferError extends Error {
  constructor(message: string, readonly status: number, readonly body?: unknown) {
    super(message);
    this.name = "ListOfferError";
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function paymentRequiredFrom(res: Response, body: unknown): PaymentRequired {
  const header = res.headers.get("payment-required");
  if (header) {
    try {
      return decodeBase64Json<PaymentRequired>(header);
    } catch {
      // fall back to the body
    }
  }
  if (body && typeof body === "object") return body as PaymentRequired;
  throw new ListOfferError("registry answered 402 without payment requirements", 402, body);
}

function idFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { id?: unknown; offer?: { id?: unknown } };
  if (typeof b.id === "string" && b.id) return b.id;
  if (typeof b.offer?.id === "string" && b.offer.id) return b.offer.id;
  return undefined;
}

/**
 * POST <registryUrl>/offers with the offer. On 402 it asks `pay` for the payment header and posts again
 * with X-PAYMENT (x402 version 1) or PAYMENT-SIGNATURE (version 2). Returns the listing id.
 * Nothing is logged; errors carry only the status and the registry's answer.
 */
export async function listOffer({ offer, registryUrl = DEFAULT_REGISTRY_URL, fetch: doFetch = fetch, pay }: ListOfferOptions): Promise<{ id: string }> {
  const url = `${registryUrl.replace(/\/+$/, "")}/offers`;
  const body = JSON.stringify(offer);
  const post = (extra: Record<string, string> = {}) =>
    doFetch(url, { method: "POST", headers: { "content-type": "application/json", ...extra }, body });

  let res = await post();
  let answer = await readBody(res);

  if (res.status === 402) {
    const required = paymentRequiredFrom(res, answer);
    const paymentHeader = await pay(required);
    if (typeof paymentHeader !== "string" || !paymentHeader) throw new ListOfferError("pay() returned no payment header", 402);
    const headerName = required.x402Version === 2 ? "PAYMENT-SIGNATURE" : "X-PAYMENT";
    res = await post({ [headerName]: paymentHeader });
    answer = await readBody(res);
  }

  if (!res.ok) throw new ListOfferError(`registry answered ${res.status}`, res.status, answer);
  const id = idFrom(answer);
  if (!id) throw new ListOfferError("registry answer has no listing id", res.status, answer);
  return { id };
}
