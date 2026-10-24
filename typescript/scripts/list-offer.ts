// Lists lax-offer.json on the LAX registry: `LAX_PRIVATE_KEY=... npm run list-offer`.
// The listing fee (0.01 USDC on Base at the time of writing) is paid by the key's wallet.
// Set DRY_RUN=1 to stop at the 402 and print the price without paying.
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { listOffer, type PaymentRequired } from "../src/list.js";
import { createExactPayer } from "../src/pay.js";

const offer = JSON.parse(readFileSync(new URL("../lax-offer.json", import.meta.url), "utf8"));
const registryUrl = process.env.LAX_REGISTRY_URL;

let pay: (r: PaymentRequired) => Promise<string>;
if (process.env.DRY_RUN === "1") {
  pay = async (r) => {
    console.log("Registry asks for:", JSON.stringify(r.accepts ?? r));
    process.exit(0);
  };
} else {
  const key = process.env.LAX_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("Set LAX_PRIVATE_KEY (0x and 64 hex) in the environment, or DRY_RUN=1.");
    process.exit(1);
  }
  pay = createExactPayer(privateKeyToAccount(key as `0x${string}`), { maxAtomic: 100_000n });
}

listOffer({ offer, registryUrl, pay })
  .then(({ id }) => console.log(`Listed: ${id}`))
  .catch((e) => {
    console.error(`Listing failed: ${e.message}`);
    process.exit(1);
  });
