import type { ServerConfig } from "../types.js";

export function buildAgentCard(config: ServerConfig) {
  const baseUrl = config.publicBaseUrl ?? `http://${config.host}:${config.port}`;
  return {
    protocol: "a2a",
    protocolVersion: "0.3",
    name: "openclaw-a2a-server",
    url: `${baseUrl}/a2a`,
    authentication: {
      schemes: ["bearer"],
    },
    capabilities: [
      "jsonrpc",
      "request-response",
      "task-polling",
      "streaming",
    ],
    profiles: ["standards"],
    methods: ["message/send", "message/stream", "tasks/get", "tasks/resubscribe"],
  };
}
