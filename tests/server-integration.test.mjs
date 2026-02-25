import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import { A2AServer, resolveConfig } from "../dist/server.js";

let server;
let baseUrl;
const token = "test-token";

async function postA2A(payload) {
  const res = await fetch(`${baseUrl}/a2a`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return res;
}

beforeEach(async () => {
  server = new A2AServer(resolveConfig({ host: "127.0.0.1", port: 0, authToken: token }));
  await server.start();
  baseUrl = server.status().publicBaseUrl;
});

afterEach(async () => {
  await server.stop();
});

describe("auth and surface", () => {
  test("rejects unauthorized request", async () => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 401);
  });

  test("returns standards agent card", async () => {
    const res = await fetch(`${baseUrl}/.well-known/agent-card.json`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.protocol, "a2a");
    assert.deepEqual(body.profiles, ["standards"]);
  });
});

describe("json-rpc methods", () => {
  test("supports blocking message/send", async () => {
    const res = await postA2A({
      jsonrpc: "2.0",
      id: "req-1",
      method: "message/send",
      params: { message: { messageId: "m1", role: "user", parts: [{ text: "hi" }] } },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, "req-1");
    assert.equal(body.result.clientOperation, "message/send");
  });

  test("supports async send + tasks/get", async () => {
    const sendRes = await postA2A({
      jsonrpc: "2.0",
      id: "req-2",
      method: "message/send",
      params: { metadata: { executionMode: "async" }, message: { messageId: "m2", role: "user", parts: [{ text: "run" }] } },
    });
    const sendBody = await sendRes.json();
    assert.equal(sendBody.result.status, "accepted");
    const taskId = sendBody.result.taskId;

    await new Promise((r) => setTimeout(r, 20));

    const taskRes = await postA2A({
      jsonrpc: "2.0",
      id: "req-3",
      method: "tasks/get",
      params: { taskId },
    });
    const taskBody = await taskRes.json();
    assert.equal(taskBody.id, "req-3");
    assert.equal(taskBody.result.taskId, taskId);
    assert.ok(["running", "succeeded"].includes(taskBody.result.status.state));
  });

  test("streams events for message/stream", async () => {
    const res = await postA2A({
      jsonrpc: "2.0",
      id: "req-4",
      method: "message/stream",
      params: { message: { messageId: "m3", role: "user", parts: [{ text: "stream" }] } },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const body = await res.text();
    assert.match(body, /event: task/);
    assert.match(body, /"taskId"/);
  });

  test("returns deterministic not-found for unknown task", async () => {
    const res = await postA2A({ jsonrpc: "2.0", id: "req-5", method: "tasks/get", params: { taskId: "missing" } });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.data.code, "A2A_TASK_NOT_FOUND");
  });
});
