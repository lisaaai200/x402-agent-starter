// x402 version 1 types and helpers for the "exact" scheme on Base with USDC.

export type Network = "base" | "base-sepolia";

/** USDC contract per network, with the EIP-712 domain used by EIP-3009 signatures. */
export const USDC: Record<Network, { address: `0x${string}`; name: string; version: string; chainId: number }> = {
  base: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", name: "USD Coin", version: "2", chainId: 8453 },
  "base-sepolia": { address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", name: "USDC", version: "2", chainId: 84532 },
};

export interface PaymentRequirements {
  scheme: "exact";
  network: Network;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  outputSchema?: unknown;
  extra?: { name: string; version: string };
}

export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: unknown;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResponse {
  success: boolean;
  transaction: string;
  network: string;
  errorReason?: string;
  payer?: string;
}

export interface Facilitator {
  verify(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(paymentPayload: PaymentPayload, paymentRequirements: PaymentRequirements): Promise<SettleResponse>;
}

/** "0.01" -> "10000" (USDC has 6 decimals). No floating point. */
export function toAtomicUsdc(price: string): string {
  if (typeof price !== "string" || !/^\d+(\.\d{1,6})?$/.test(price)) {
    throw new Error(`price must be a decimal USDC string with at most 6 decimals, got ${JSON.stringify(price)}`);
  }
  const [whole, frac = ""] = price.split(".");
  const atomic = BigInt(whole) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  if (atomic <= 0n) throw new Error("price must be greater than 0");
  return atomic.toString();
}

export function isNetwork(n: unknown): n is Network {
  return n === "base" || n === "base-sepolia";
}

export function encodeBase64Json(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeBase64Json<T = unknown>(value: string): T {
  const text = Buffer.from(value.trim(), "base64").toString("utf8");
  return JSON.parse(text) as T;
}
