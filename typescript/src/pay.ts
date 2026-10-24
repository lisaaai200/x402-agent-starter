import { USDC, encodeBase64Json, type Network } from "./x402.js";

/** Anything that can sign EIP-712 typed data, for example a viem account. */
export interface TypedDataSigner {
  address: `0x${string}`;
  signTypedData(args: {
    domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

const CAIP2: Record<string, Network> = { "eip155:8453": "base", "eip155:84532": "base-sepolia" };

function networkOf(n: unknown): Network | undefined {
  if (n === "base" || n === "base-sepolia") return n;
  return typeof n === "string" ? CAIP2[n] : undefined;
}

function randomNonce(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Builds a pay() function for listOffer (or any x402 client): picks the "exact" USDC requirement on Base,
 * signs an EIP-3009 TransferWithAuthorization and returns the base64 payment header.
 * Works with x402 version 1 (maxAmountRequired, network "base") and version 2 (amount, network "eip155:8453").
 * `maxAtomic` refuses to sign anything above that amount (default 1 USDC).
 */
export function createExactPayer(signer: TypedDataSigner, opts: { maxAtomic?: bigint; now?: () => number } = {}) {
  const maxAtomic = opts.maxAtomic ?? 1_000_000n;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  return async function pay(paymentRequired: { x402Version?: number; accepts?: unknown[]; resource?: unknown }): Promise<string> {
    const version = paymentRequired.x402Version === 2 ? 2 : 1;
    const accepts = Array.isArray(paymentRequired.accepts) ? (paymentRequired.accepts as Record<string, any>[]) : [];
    const req = accepts.find((a) => a && a.scheme === "exact" && networkOf(a.network));
    if (!req) throw new Error("no exact USDC requirement on Base in the 402");
    const network = networkOf(req.network)!;
    const usdc = USDC[network];
    const value = String(req.maxAmountRequired ?? req.amount ?? "");
    if (!/^\d+$/.test(value)) throw new Error("payment amount missing");
    if (BigInt(value) > maxAtomic) throw new Error(`payment of ${value} atomic USDC is above the limit`);
    if (String(req.asset).toLowerCase() !== usdc.address.toLowerCase()) throw new Error("asset is not USDC on this network");
    const t = now();
    const authorization = {
      from: signer.address,
      to: req.payTo as `0x${string}`,
      value,
      validAfter: String(t - 600),
      validBefore: String(t + Number(req.maxTimeoutSeconds ?? 60)),
      nonce: randomNonce(),
    };
    const signature = await signer.signTypedData({
      domain: { name: req.extra?.name ?? usdc.name, version: req.extra?.version ?? usdc.version, chainId: usdc.chainId, verifyingContract: usdc.address },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        ...authorization,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
      },
    });
    const payload = { signature, authorization };
    const body =
      version === 2
        ? { x402Version: 2, resource: paymentRequired.resource, accepted: req, payload }
        : { x402Version: 1, scheme: "exact", network: req.network, payload };
    return encodeBase64Json(body);
  };
}
