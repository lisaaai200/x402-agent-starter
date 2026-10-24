// Runs the starter on Node: `npm start`. Configuration comes from the environment only.
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { DEFAULT_FACILITATOR_URL } from "./facilitator.js";
import type { Network } from "./x402.js";

const app = createApp({
  price: process.env.PRICE_USDC ?? "0.01",
  payTo: process.env.PAY_TO ?? "",
  network: (process.env.NETWORK ?? "base-sepolia") as Network,
  facilitator: process.env.X402_FACILITATOR_URL ?? DEFAULT_FACILITATOR_URL,
  description: process.env.DESCRIPTION,
});
const port = Number(process.env.PORT ?? 8402);

createServer(async (req, res) => {
  try {
    const url = `http://${req.headers.host ?? `localhost:${port}`}${req.url ?? "/"}`;
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const response = await app.fetch(new Request(url, { method: req.method, headers }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal error" }));
  }
}).listen(port, () => console.log(`x402 agent starter on http://localhost:${port} (GET /health free, GET /paid paid)`));
