// Local check of a LAX offer against https://lax.kognai.ai/aiax/sections/lax_offer.json
// plus the rules this starter needs (a per_call USDC x402 capability and an https endpoint).

export const FIVE_LAWS = ["Solidarity Oath", "Renewal Mandate", "Treasury Equilibrium", "Harm Shield", "Transparency Covenant"] as const;

const PRICING_MODELS = ["per_call", "per_minute", "flat", "free"];

function isHttps(u: unknown): boolean {
  if (typeof u !== "string") return false;
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

/** Returns a list of problems; an empty list means the offer is valid. */
export function validateOffer(offer: any): string[] {
  const errors: string[] = [];
  if (!offer || typeof offer !== "object" || Array.isArray(offer)) return ["offer must be an object"];
  if (offer.lax_version !== undefined && offer.lax_version !== "1.0") errors.push("lax_version must be 1.0");
  if (typeof offer.name !== "string" || offer.name.length < 3 || offer.name.length > 80) errors.push("name must be 3 to 80 characters");
  if (typeof offer.description !== "string" || offer.description.length < 20 || offer.description.length > 600)
    errors.push("description must be 20 to 600 characters");
  if (offer.category !== undefined && (typeof offer.category !== "string" || offer.category.length < 2 || offer.category.length > 40))
    errors.push("category must be 2 to 40 characters");
  if (!isHttps(offer.endpoint) && !isHttps(offer.pact_endpoint)) errors.push("endpoint or pact_endpoint must be an https url");
  if (offer.endpoint !== undefined && !isHttps(offer.endpoint)) errors.push("endpoint must be an https url");
  if (offer.agent_did !== undefined && !/^did:[a-z0-9]+:.+$/.test(offer.agent_did)) errors.push("agent_did must be did:method:identifier");
  const caps = offer.capabilities;
  if (!Array.isArray(caps) || caps.length < 1 || caps.length > 10) errors.push("capabilities must have 1 to 10 items");
  else
    caps.forEach((c: any, i: number) => {
      if (!c || typeof c.skill_id !== "string" || !c.skill_id) errors.push(`capabilities[${i}].skill_id is required`);
      if (!c || typeof c.description !== "string" || !c.description) errors.push(`capabilities[${i}].description is required`);
      const p = c?.pricing;
      if (!p || !PRICING_MODELS.includes(p.model)) errors.push(`capabilities[${i}].pricing.model is invalid`);
      else if (p.model !== "free" && (typeof p.amount !== "string" || !/^\d+(\.\d{1,6})?$/.test(p.amount)))
        errors.push(`capabilities[${i}].pricing.amount must be a decimal string`);
      if (p && p.currency !== "USDC") errors.push(`capabilities[${i}].pricing.currency must be USDC`);
      if (p && p.rail !== "x402") errors.push(`capabilities[${i}].pricing.rail must be x402`);
    });
  if (Array.isArray(caps) && !caps.some((c: any) => c?.pricing?.model === "per_call" && c?.pricing?.rail === "x402" && c?.pricing?.currency === "USDC"))
    errors.push("needs a capability priced per_call in USDC over x402");
  const laws = offer.constitutional_constraints;
  if (!Array.isArray(laws)) errors.push("constitutional_constraints must be an array");
  else for (const law of FIVE_LAWS) if (!laws.includes(law)) errors.push(`constitutional_constraints is missing ${law}`);
  if (offer.payment_rails !== undefined) {
    if (!Array.isArray(offer.payment_rails) || offer.payment_rails.some((r: unknown) => !["x402", "usdc", "usdc-base"].includes(r as string)))
      errors.push("payment_rails may only hold x402, usdc or usdc-base");
  }
  return errors;
}
