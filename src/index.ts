import { A2AServer, resolveConfig } from "./server.js";
import { buildAgentCard } from "./card/agent-card.js";
import type { GatewayContext, PluginApi } from "./types.js";

let instance: A2AServer | undefined;

function toObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function response(ctx: GatewayContext, payload: unknown, ok = true): unknown {
  if (typeof ctx.respond === "function") return ctx.respond(ok, payload);
  return payload;
}

const plugin = {
  id: "openclaw-a2a-server",
  register(api: PluginApi): void {
    if (typeof api.registerGatewayMethod !== "function") throw new Error("Plugin API missing registerGatewayMethod");

    api.registerGatewayMethod("a2a-server.start", async (ctx) => {
      const base = toObject(api.pluginConfig);
      const override = toObject(toObject(ctx.params).config);
      const config = resolveConfig({ ...base, ...override });
      instance = new A2AServer(config);
      await instance.start();
      return response(ctx, { ok: true, operation: "start", status: instance.status() }, true);
    });

    api.registerGatewayMethod("a2a-server.stop", async (ctx) => {
      await instance?.stop();
      instance = undefined;
      return response(ctx, { ok: true, operation: "stop" }, true);
    });

    api.registerGatewayMethod("a2a-server.status", async (ctx) => {
      return response(ctx, { ok: true, operation: "status", status: instance?.status() ?? { running: false } }, true);
    });

    api.registerGatewayMethod("a2a-server.card", async (ctx) => {
      const base = toObject(api.pluginConfig);
      const override = toObject(toObject(ctx.params).config);
      const config = resolveConfig({ ...base, ...override });
      return response(ctx, { ok: true, operation: "card", data: buildAgentCard(config) }, true);
    });

    api.registerGatewayMethod("a2a-server.smoke", async (ctx) => {
      const status = instance?.status();
      if (!status?.running) {
        return response(ctx, { ok: false, operation: "smoke", error: { code: "not_running", message: "Server is not running" } }, false);
      }
      const baseUrl = status.publicBaseUrl;
      const token = (toObject(api.pluginConfig).authToken as string | undefined) ?? "";
      const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

      const cardRes = await fetch(`${baseUrl}/.well-known/agent-card.json`, { headers: { Authorization: `Bearer ${token}` } });
      const sendRes = await fetch(`${baseUrl}/a2a`, {
        method: "POST",
        headers,
        body: JSON.stringify({ jsonrpc: "2.0", id: "smoke-1", method: "message/send", params: { message: { messageId: "m1", role: "user", parts: [{ text: "smoke" }] } } }),
      });

      return response(ctx, { ok: cardRes.ok && sendRes.ok, operation: "smoke", checks: { card: cardRes.status, send: sendRes.status } }, cardRes.ok && sendRes.ok);
    });

    api.logger?.info?.("Registered A2A server gateway methods", {
      methods: ["a2a-server.start", "a2a-server.stop", "a2a-server.status", "a2a-server.card", "a2a-server.smoke"],
    });
  },
};

export default plugin;
