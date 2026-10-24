import type { Facilitator, PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "../src/x402.js";
import { encodeBase64Json } from "../src/x402.js";

export const PAY_TO = "0x1111111111111111111111111111111111111111";
export const TX = "0x" + "ab".repeat(32);

/** Offline facilitator that records every call. */
export function mockFacilitator(opts: { verify?: Partial<VerifyResponse> | Error; settle?: Partial<SettleResponse> | Error } = {}) {
  const calls: { op: "verify" | "settle"; payload: PaymentPayload; requirements: PaymentRequirements }[] = [];
  const facilitator: Facilitator = {
    async verify(payload, requirements) {
      calls.push({ op: "verify", payload, requirements });
      if (opts.verify instanceof Error) throw opts.verify;
      return { isValid: true, payer: "0x2222222222222222222222222222222222222222", ...(opts.verify ?? {}) };
    },
    async settle(payload, requirements) {
      calls.push({ op: "settle", payload, requirements });
      if (opts.settle instanceof Error) throw opts.settle;
      return { success: true, transaction: TX, network: requirements.network, ...(opts.settle ?? {}) };
    },
  };
  return { facilitator, calls };
}

export function paymentHeader(network = "base-sepolia", extra: Record<string, unknown> = {}): string {
  return encodeBase64Json({
    x402Version: 1,
    scheme: "exact",
    network,
    payload: {
      signature: "0x" + "00".repeat(65),
      authorization: { from: "0x2222222222222222222222222222222222222222", to: PAY_TO, value: "10000", validAfter: "0", validBefore: "9999999999", nonce: "0x" + "01".repeat(32) },
    },
    ...extra,
  });
}
