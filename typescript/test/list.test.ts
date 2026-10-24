import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyTypedData } from "viem";
import { listOffer } from "../src/list.js";
import { createExactPayer } from "../src/pay.js";
import { decodeBase64Json, encodeBase64Json } from "../src/x402.js";

const offer = { name: "Test Agent", description: "An offer used by the tests only.", capabilities: [] };
const v2Required = {
  x402Version: 2,
  error: "payment required",
  resource: { url: "https://registry.test/offers", description: "listing", mimeType: "application/json" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "10000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x3333333333333333333333333333333333333333",
      maxTimeoutSeconds: 60,
      extra: { name: "USD Coin", version: "2" },
    },
  ],
};

function fakeRegistry(first: () => Response, second: () => Response) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: Object.fromEntries(new Headers(init.headers)), body: String(init.body) });
    return calls.length === 1 ? first() : second();
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("A4 listing script answers the registry 402, pays and returns the id", () => {
  it("A4 version 2: PAYMENT-REQUIRED header, pay() called, retried with PAYMENT-SIGNATURE, id returned", async () => {
    const reg = fakeRegistry(
      () => new Response(JSON.stringify({ x402Version: 2 }), { status: 402, headers: { "PAYMENT-REQUIRED": encodeBase64Json(v2Required) } }),
      () => new Response(JSON.stringify({ ok: true, id: "lax-ext-123", transaction: "0xabc" }), { status: 200 }),
    );
    const pay = vi.fn(async () => "signed-payment");
    const out = await listOffer({ offer, registryUrl: "https://registry.test/", fetch: reg.fetch, pay });
    expect(out).toEqual({ id: "lax-ext-123" });
    expect(pay).toHaveBeenCalledWith(v2Required);
    expect(reg.calls.map((c) => c.url)).toEqual(["https://registry.test/offers", "https://registry.test/offers"]);
    expect(JSON.parse(reg.calls[0].body)).toEqual(offer);
    expect(reg.calls[0].headers["payment-signature"]).toBeUndefined();
    expect(reg.calls[1].headers["payment-signature"]).toBe("signed-payment");
  });

  it("A4 version 1: requirements from the body, retried with X-PAYMENT, default registry URL", async () => {
    const reg = fakeRegistry(
      () => new Response(JSON.stringify({ x402Version: 1, error: "x", accepts: [] }), { status: 402 }),
      () => new Response(JSON.stringify({ ok: true, offer: { id: "lax-ext-9" } }), { status: 201 }),
    );
    const out = await listOffer({ offer, fetch: reg.fetch, pay: () => "v1-payment" });
    expect(out.id).toBe("lax-ext-9");
    expect(reg.calls[0].url).toBe("https://lax.kognai.ai/registry/offers");
    expect(reg.calls[1].headers["x-payment"]).toBe("v1-payment");
  });

  it("A4 errors carry the status, and a refused offer is never paid", async () => {
    const pay = vi.fn(async () => "p");
    const bad = fakeRegistry(() => new Response(JSON.stringify({ error: "invalid offer" }), { status: 422 }), () => new Response("", { status: 500 }));
    await expect(listOffer({ offer, fetch: bad.fetch, pay })).rejects.toMatchObject({ status: 422 });
    expect(pay).not.toHaveBeenCalled();
    const refused = fakeRegistry(
      () => new Response(JSON.stringify(v2Required), { status: 402 }),
      () => new Response(JSON.stringify({ error: "settle refused" }), { status: 402 }),
    );
    await expect(listOffer({ offer, fetch: refused.fetch, pay })).rejects.toMatchObject({ status: 402 });
  });

  it("A4 the signing key never reaches the registry or the console", async () => {
    const key = generatePrivateKey();
    const account = privateKeyToAccount(key);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const reg = fakeRegistry(
      () => new Response(JSON.stringify(v2Required), { status: 402 }),
      () => new Response(JSON.stringify({ ok: true, id: "lax-ext-key" }), { status: 200 }),
    );
    const pay = createExactPayer(account, { now: () => 1_800_000_000 });
    expect((await listOffer({ offer, fetch: reg.fetch, pay })).id).toBe("lax-ext-key");
    const everything = JSON.stringify(reg.calls);
    expect(everything.toLowerCase()).not.toContain(key.slice(2).toLowerCase());
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
    // The payment is a valid EIP-3009 authorization signed by the account.
    const payment = decodeBase64Json<any>(reg.calls[1].headers["payment-signature"]);
    expect(payment.x402Version).toBe(2);
    expect(payment.accepted.network).toBe("eip155:8453");
    const a = payment.payload.authorization;
    expect(a).toMatchObject({ from: account.address, to: v2Required.accepts[0].payTo, value: "10000" });
    const ok = await verifyTypedData({
      address: account.address,
      domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: v2Required.accepts[0].asset as `0x${string}` },
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
      message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
      signature: payment.payload.signature,
    });
    expect(ok).toBe(true);
  });

  it("A4 the payer refuses amounts above its limit and non USDC assets", async () => {
    const pay = createExactPayer(privateKeyToAccount(generatePrivateKey()), { maxAtomic: 5000n });
    await expect(pay(v2Required)).rejects.toThrow(/above the limit/);
    const pay2 = createExactPayer(privateKeyToAccount(generatePrivateKey()));
    await expect(pay2({ ...v2Required, accepts: [{ ...v2Required.accepts[0], asset: "0x0000000000000000000000000000000000000001" }] })).rejects.toThrow(/USDC/);
  });
});
