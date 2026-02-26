import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { A2AServer, resolveConfig } from "../dist/server.js";

let server;
let baseUrl;
const token = "test-token";

async function postA2A(payload, headers = {}) {
  const res = await fetch(`${baseUrl}/a2a`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...headers,
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

  test("supports async send + tasks/get and normalizes taskId", async () => {
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
      params: { taskId: `  ${taskId.slice(0, 5)} ${taskId.slice(5)}  ` },
    });
    const taskBody = await taskRes.json();
    assert.equal(taskBody.id, "req-3");
    assert.equal(taskBody.result.taskId, taskId);
    assert.equal(taskBody.result.status.state, "succeeded");
    assert.equal(taskBody.result.result.taskId, taskId);
  });

  test("streams ordered events and includes terminal final=true event", async () => {
    const res = await postA2A({
      jsonrpc: "2.0",
      id: "req-4",
      method: "message/stream",
      params: { message: { messageId: "m3", role: "user", parts: [{ text: "stream" }] } },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "text/event-stream");
    const body = await res.text();

    const eventIds = Array.from(body.matchAll(/^id:\s*(\d+)$/gm)).map((m) => Number(m[1]));
    assert.ok(eventIds.length >= 3);
    assert.equal(eventIds[0], 1);
    assert.equal(eventIds[eventIds.length - 1], Math.max(...eventIds));
    assert.match(body, /"state":"accepted"/);
    assert.match(body, /"state":"running"/);
    assert.match(body, /"state":"succeeded"/);
    assert.match(body, /"final":true/);
  });

  test("tasks/resubscribe replays from Last-Event-ID and includes terminal", async () => {
    const streamRes = await postA2A({
      jsonrpc: "2.0",
      id: "req-5",
      method: "message/stream",
      params: { message: { messageId: "m4", role: "user", parts: [{ text: "stream+resub" }] } },
    });
    const streamBody = await streamRes.text();
    const taskId = /"taskId":"([^"]+)"/.exec(streamBody)?.[1];
    assert.ok(taskId);

    const resubRes = await postA2A(
      {
        jsonrpc: "2.0",
        id: "req-6",
        method: "tasks/resubscribe",
        params: { taskId: ` ${taskId} ` },
      },
      { "Last-Event-ID": "1" }
    );

    assert.equal(resubRes.status, 200);
    assert.equal(resubRes.headers.get("content-type"), "text/event-stream");
    const resubBody = await resubRes.text();
    const eventIds = Array.from(resubBody.matchAll(/^id:\s*(\d+)$/gm)).map((m) => Number(m[1]));
    assert.ok(eventIds.length >= 2);
    assert.equal(eventIds[0], 2);
    assert.match(resubBody, /"final":true/);
  });

  test("returns deterministic not-found for unknown task", async () => {
    const res = await postA2A({ jsonrpc: "2.0", id: "req-7", method: "tasks/get", params: { taskId: "missing" } });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error.data.code, "A2A_TASK_NOT_FOUND");
  });
});

describe("semantic bridge mode", () => {
  test("returns assistant message from semantic responder", async () => {
    const responder = http.createServer((req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: "Jennifer semantic reply" }));
    });
    await new Promise((resolve) => responder.listen(0, "127.0.0.1", resolve));
    const addr = responder.address();
    const responderUrl = `http://127.0.0.1:${addr.port}/semantic`;

    const semanticServer = new A2AServer(resolveConfig({ host: "127.0.0.1", port: 0, authToken: token, semanticMode: true, semanticResponderUrl: responderUrl }));
    await semanticServer.start();
    const semanticBase = semanticServer.status().publicBaseUrl;

    try {
      const res = await fetch(`${semanticBase}/a2a`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "req-sem-1",
          method: "message/send",
          params: { message: { messageId: "m-sem", role: "user", parts: [{ text: "hello semantic" }] } },
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.id, "req-sem-1");
      assert.equal(body.result.message.parts[0].text, "Jennifer semantic reply");
    } finally {
      await semanticServer.stop();
      await new Promise((resolve) => responder.close(resolve));
    }
  });
});
