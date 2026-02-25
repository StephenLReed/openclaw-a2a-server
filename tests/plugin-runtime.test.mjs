import { describe, test } from "node:test";
import assert from "node:assert/strict";

import plugin from "../dist/index.js";

describe("plugin runtime", () => {
  test("registers gateway methods", async () => {
    const handlers = new Map();
    await plugin.register({
      pluginConfig: { authToken: "test-token", host: "127.0.0.1", port: 0 },
      registerGatewayMethod(name, handler) {
        handlers.set(name, handler);
      },
    });

    assert.ok(handlers.has("a2a-server.start"));
    assert.ok(handlers.has("a2a-server.stop"));
    assert.ok(handlers.has("a2a-server.status"));
    assert.ok(handlers.has("a2a-server.card"));
    assert.ok(handlers.has("a2a-server.smoke"));
  });

  test("start/status/stop lifecycle works", async () => {
    const handlers = new Map();
    await plugin.register({
      pluginConfig: { authToken: "test-token", host: "127.0.0.1", port: 0 },
      registerGatewayMethod(name, handler) {
        handlers.set(name, handler);
      },
    });

    const start = await handlers.get("a2a-server.start")({ params: {} });
    assert.equal(start.ok, true);
    assert.equal(start.status.running, true);

    const status = await handlers.get("a2a-server.status")({ params: {} });
    assert.equal(status.status.running, true);

    const stop = await handlers.get("a2a-server.stop")({ params: {} });
    assert.equal(stop.ok, true);
  });
});
