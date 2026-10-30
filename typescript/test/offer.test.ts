import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIVE_LAWS, validateOffer } from "../src/offer.js";

const load = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));

describe("A3 the offer passes LAX validation with the Five Laws", () => {
  it("A3 typescript/lax-offer.json is valid, per_call USDC over x402, https endpoint, Five Laws", () => {
    const offer = load("../lax-offer.json");
    expect(validateOffer(offer)).toEqual([]);
    expect(offer.capabilities[0].pricing).toEqual({ model: "per_call", amount: "0.01", currency: "USDC", rail: "x402" });
    expect(offer.endpoint.startsWith("https://")).toBe(true);
    for (const law of FIVE_LAWS) expect(offer.constitutional_constraints).toContain(law);
  });

  it("A3 the validator refuses an offer missing a law or with a bad endpoint", () => {
    const offer = load("../lax-offer.json");
    expect(validateOffer({ ...offer, constitutional_constraints: FIVE_LAWS.slice(1) })).toContain("constitutional_constraints is missing Solidarity Oath");
    expect(validateOffer({ ...offer, endpoint: "http://insecure.example" }).length).toBeGreaterThan(0);
    expect(validateOffer({ ...offer, capabilities: [] }).length).toBeGreaterThan(0);
    expect(validateOffer({ ...offer, description: "short" }).length).toBeGreaterThan(0);
  });
});

describe("A5 paid call on Base Sepolia", () => {
  it("A5 README holds the Base Sepolia transaction hash of one paid call", () => {
    const root = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    const local = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    expect(root).toMatch(/0xbb597078294187f0ba06261ac2daab8f6586f6fa15153ce2c49c8733e9672774/);
    expect(local).toMatch(/0xbb597078294187f0ba06261ac2daab8f6586f6fa15153ce2c49c8733e9672774/);
    expect(root).toMatch(/sepolia\.basescan\.org\/tx\/0xbb597078294187f0ba06261ac2daab8f6586f6fa15153ce2c49c8733e9672774/);
  });
});

describe("A6 the Python starter mirrors A1 to A4", () => {
  it("A6 python starter files exist, requirements are pinned and its offer is valid", () => {
    for (const f of ["../../python/app.py", "../../python/list_offer.py", "../../python/requirements.txt", "../../python/tests/test_app.py"]) {
      expect(() => readFileSync(new URL(f, import.meta.url))).not.toThrow();
    }
    const reqs = readFileSync(new URL("../../python/requirements.txt", import.meta.url), "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    expect(reqs.length).toBeGreaterThan(0);
    for (const r of reqs) expect(r).toMatch(/==/);
    const tests = readFileSync(new URL("../../python/tests/test_app.py", import.meta.url), "utf8");
    for (const a of ["a1", "a2", "a3", "a4"]) expect(tests).toContain(`def test_${a}_`);
    expect(validateOffer(load("../../python/lax-offer.json"))).toEqual([]);
  });
});
