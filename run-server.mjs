import { A2AServer, resolveConfig } from "./dist/server.js";

const host = process.env.A2A_SERVER_HOST || "0.0.0.0";
const port = Number(process.env.A2A_SERVER_PORT || "8787");
const publicBaseUrl = process.env.A2A_SERVER_PUBLIC_BASE_URL || "http://Stephens-MacBook-Pro.local:8787";
const authToken = process.env.A2A_SERVER_AUTH_TOKEN;
const semanticMode = String(process.env.A2A_SERVER_SEMANTIC_MODE || "false").toLowerCase() === "true";
const semanticResponderUrl = process.env.A2A_SERVER_SEMANTIC_RESPONDER_URL || undefined;
const semanticTimeoutMs = Number(process.env.A2A_SERVER_SEMANTIC_TIMEOUT_MS || "15000");

if (!authToken) {
  console.error("A2A_SERVER_AUTH_TOKEN is required");
  process.exit(1);
}

const server = new A2AServer(resolveConfig({ host, port, publicBaseUrl, authToken, semanticMode, semanticResponderUrl, semanticTimeoutMs }));
await server.start();
console.log(`[a2a-server] listening on ${host}:${port} (public ${publicBaseUrl})`);

const shutdown = async () => {
  try {
    await server.stop();
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
