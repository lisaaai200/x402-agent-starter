import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { httpFacilitator } from "../src/facilitator.js";
import { decodeBase64Json, toAtomicUsdc } from "../src/x402.js";
import { PAY_TO, TX, mockFacilitator, paymentHeader } from "./helpers.js";

const req = (path: string, headers: Record<string, string> = {}) => new Request(`https://agent.example.com${path}`, { headers });

describe("A1 unpaid call answers 402 with valid x402 payment requirements", () => {
  it("A1 base-sepolia: 402 with exact scheme, atomic price, payee, USDC asset", async () => {
    const { facilitator, calls } = mockFacilitator();
    const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base-sepolia", facilitator, description: "Test route" });
    const res = await app.fetch(req("/paid"));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.x402Version).toBe(1);
    expect(typeof body.error).toBe("string");
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]).toMatchObject({
      scheme: "exact",
      network: "base-sepolia",
      maxAmountRequired: "10000",
      resource: "https://agent.example.com/paid",
      description: "Test route",
      mimeType: "application/json",
      payTo: PAY_TO,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    });
    expect(body.accepts[0].maxTimeoutSeconds).toBeGreaterThan(0);
    expect(calls).toHaveLength(0);
  });

  it("A1 base: mainnet USDC asset and the configured price", async () => {
    const app = createApp({ price: "1.5", payTo: PAY_TO, network: "base", facilitator: mockFacilitator().facilitator });
    const body = await (await app.fetch(req("/paid"))).json();
    expect(body.accepts[0]).toMatchObject({ network: "base", maxAmountRequired: "1500000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" });
  });

  it("A1 price conversion is exact and bad config is refused", () => {
    expect(toAtomicUsdc("0.000001")).toBe("1");
    expect(toAtomicUsdc("12.345678")).toBe("12345678");
    expect(() => toAtomicUsdc("0.0000001")).toThrow();
    expect(() => toAtomicUsdc("-1")).toThrow();
    expect(() => toAtomicUsdc("0")).toThrow();
    expect(() => createApp({ price: "0.01", payTo: "nope", network: "base" })).toThrow();
    expect(() => createApp({ price: "0.01", payTo: PAY_TO, network: "mainnet" as any })).toThrow();
  });

  it("A1 GET /health is free and unknown paths are 404", async () => {
    const { facilitator, calls } = mockFacilitator();
    const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base", facilitator });
    const res = await app.fetch(req("/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await app.fetch(req("/other"))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe("A2 paid call is verified then settled; failures get 402 and no work", () => {
  it("A2 verify, settle, then 200 with X-PAYMENT-RESPONSE", async () => {
    const { facilitator, calls } = mockFacilitator();
    const work = vi.fn(() => ({ done: true }));
    const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base-sepolia", facilitator, work });
    const res = await app.fetch(req("/paid", { "X-PAYMENT": paymentHeader() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: { done: true } });
    expect(calls.map((c) => c.op)).toEqual(["verify", "settle"]);
    expect(calls[0].requirements.maxAmountRequired).toBe("10000");
    expect(calls[0].payload.scheme).toBe("exact");
    const settlement = decodeBase64Json<any>(res.headers.get("X-PAYMENT-RESPONSE")!);
    expect(settlement).toMatchObject({ success: true, transaction: TX, network: "base-sepolia" });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("A2 default work answers with a result", async () => {
    const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base-sepolia", facilitator: mockFacilitator().facilitator });
    const res = await app.fetch(req("/paid?q=hello", { "X-PAYMENT": paymentHeader() }));
    expect((await res.json()).result.answer).toBe("You asked: hello");
  });

  it("A2 payment that fails verification: 402, no settle, no work", async () => {
    const { facilitator, calls } = mockFacilitator({ verify: { isValid: false, invalidReason: "insufficient_funds" } });
    const work = vi.fn();
    const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base-sepolia", facilitator, work });
    const res = await app.fetch(req("/paid", { "X-PAYMENT": paymentHeader() }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("insufficient_funds");
    expect(body.accepts[0].payTo).toBe(PAY_TO);
    expect(res.headers.get("X-PAYMENT-RESPONSE")).toBeNull();
    expect(calls.map((c) => c.op)).toEqual(["verify"]);
    expect(work).not.toHaveBeenCalled();
  });

  it("A2 payment that fails settlement: 402 and no work", async () => {
    const { facilitator, calls } = mockFacilitator({ settle: { success: false, transaction: "", errorReason: "settle_failed" } });
    const work = vi.fn();
    const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base-sepolia", facilitator, work });
    const res = await app.fetch(req("/paid", { "X-PAYMENT": paymentHeader() }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("settle_failed");
    expect(calls.map((c) => c.op)).toEqual(["verify", "settle"]);
    expect(work).not.toHaveBeenCalled();
  });

  it("A2 facilitator errors, bad headers and wrong network all get 402 and no work", async () => {
    const work = vi.fn();
    for (const [opts, header] of [
      [{ verify: new Error("down") }, paymentHeader()],
      [{ settle: new Error("down") }, paymentHeader()],
      [{}, "not base64 json!"],
      [{}, paymentHeader("base")],
      [{}, paymentHeader("base-sepolia", { x402Version: 9 })],
    ] as const) {
      const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base-sepolia", facilitator: mockFacilitator(opts as any).facilitator, work });
      const res = await app.fetch(req("/paid", { "X-PAYMENT": header }));
      expect(res.status).toBe(402);
    }
    expect(work).not.toHaveBeenCalled();
  });

  it("A2 default HTTP facilitator posts x402 v1 bodies to /verify and /settle of the configured URL", async () => {
    const seen: { url: string; body: any }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      seen.push({ url, body });
      const answer = url.endsWith("/verify") ? { isValid: true } : { success: true, transaction: TX, network: "base-sepolia" };
      return new Response(JSON.stringify(answer), { status: 200 });
    }) as unknown as typeof fetch;
    const app = createApp({ price: "0.01", payTo: PAY_TO, network: "base-sepolia", facilitator: httpFacilitator("https://facilitator.test/", { fetch: fakeFetch }) });
    const res = await app.fetch(req("/paid", { "X-PAYMENT": paymentHeader() }));
    expect(res.status).toBe(200);
    expect(seen.map((s) => s.url)).toEqual(["https://facilitator.test/verify", "https://facilitator.test/settle"]);
    expect(seen[0].body.x402Version).toBe(1);
    expect(seen[0].body.paymentRequirements.payTo).toBe(PAY_TO);
    expect(seen[0].body.paymentPayload.network).toBe("base-sepolia");
  });
});
