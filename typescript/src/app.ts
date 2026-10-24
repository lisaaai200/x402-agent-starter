import { DEFAULT_FACILITATOR_URL, httpFacilitator } from "./facilitator.js";
import {
  USDC,
  decodeBase64Json,
  encodeBase64Json,
  isNetwork,
  toAtomicUsdc,
  type Facilitator,
  type Network,
  type PaymentPayload,
  type PaymentRequirements,
} from "./x402.js";

export interface AppOptions {
  /** Decimal USDC string, for example "0.01". */
  price: string;
  /** Payee address (0x and 40 hex). */
  payTo: string;
  network: Network;
  /** Facilitator object, or its URL. Defaults to HTTP calls to DEFAULT_FACILITATOR_URL. */
  facilitator?: Facilitator | string;
  description?: string;
  /** The paid work. Runs only after the payment is verified and settled. */
  work?: (request: Request) => unknown | Promise<unknown>;
  maxTimeoutSeconds?: number;
}

export interface App {
  fetch(request: Request): Promise<Response>;
}

const DEFAULT_DESCRIPTION = "Paid agent route: one call, priced in USDC over x402.";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Default paid work: replace with your agent's real job. */
function defaultWork(request: Request): unknown {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return { answer: q ? `You asked: ${q}` : "Paid call accepted.", servedAt: new Date().toISOString() };
}

export function createApp(options: AppOptions): App {
  const { price, payTo, network } = options;
  if (!isNetwork(network)) throw new Error(`network must be "base" or "base-sepolia", got ${JSON.stringify(network)}`);
  if (typeof payTo !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(payTo)) throw new Error("payTo must be an address (0x and 40 hex)");
  const amount = toAtomicUsdc(price);
  const facilitator: Facilitator =
    typeof options.facilitator === "object" && options.facilitator !== null
      ? options.facilitator
      : httpFacilitator(typeof options.facilitator === "string" ? options.facilitator : DEFAULT_FACILITATOR_URL);
  const description = options.description ?? DEFAULT_DESCRIPTION;
  const work = options.work ?? defaultWork;
  const usdc = USDC[network];

  function requirementsFor(request: Request): PaymentRequirements {
    const url = new URL(request.url);
    return {
      scheme: "exact",
      network,
      maxAmountRequired: amount,
      resource: `${url.origin}${url.pathname}`,
      description,
      mimeType: "application/json",
      payTo,
      maxTimeoutSeconds: options.maxTimeoutSeconds ?? 60,
      asset: usdc.address,
      extra: { name: usdc.name, version: usdc.version },
    };
  }

  function paymentRequired(requirements: PaymentRequirements, error: string): Response {
    return json(402, { x402Version: 1, error, accepts: [requirements] });
  }

  async function paid(request: Request): Promise<Response> {
    const requirements = requirementsFor(request);
    const header = request.headers.get("x-payment");
    if (!header) return paymentRequired(requirements, "X-PAYMENT header is required");

    let payment: PaymentPayload;
    try {
      payment = decodeBase64Json<PaymentPayload>(header);
    } catch {
      return paymentRequired(requirements, "X-PAYMENT is not base64 JSON");
    }
    if (!payment || typeof payment !== "object" || payment.x402Version !== 1) {
      return paymentRequired(requirements, "unsupported x402Version");
    }
    if (payment.scheme !== "exact" || payment.network !== network) {
      return paymentRequired(requirements, "payment scheme or network does not match");
    }

    try {
      const verified = await facilitator.verify(payment, requirements);
      if (!verified?.isValid) return paymentRequired(requirements, verified?.invalidReason ?? "payment did not verify");
    } catch {
      return paymentRequired(requirements, "payment verification failed");
    }

    let settlement;
    try {
      settlement = await facilitator.settle(payment, requirements);
    } catch {
      return paymentRequired(requirements, "payment settlement failed");
    }
    if (!settlement?.success) return paymentRequired(requirements, settlement?.errorReason ?? "payment did not settle");

    // Paid and settled: now do the work.
    const result = await work(request);
    return json(200, { result }, { "X-PAYMENT-RESPONSE": encodeBase64Json(settlement) });
  }

  return {
    async fetch(request: Request): Promise<Response> {
      const { pathname } = new URL(request.url);
      if (pathname === "/health" && request.method === "GET") return json(200, { ok: true });
      if (pathname === "/paid") {
        if (request.method !== "GET") return json(405, { error: "method not allowed" }, { allow: "GET" });
        return paid(request);
      }
      return json(404, { error: "not found" });
    },
  };
}
