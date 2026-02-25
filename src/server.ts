import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { isAuthorized } from "./auth.js";
import { buildAgentCard } from "./card/agent-card.js";
import { parseJsonRpcRequest, rpcError, rpcResult } from "./jsonrpc.js";
import { TaskStore } from "./tasks/task-store.js";
import type { ServerConfig } from "./types.js";

export class A2AServer {
  private server?: http.Server;
  private boundPort?: number;
  private readonly tasks = new TaskStore();

  constructor(private readonly config: ServerConfig) {}

  status() {
    const port = this.boundPort ?? this.config.port;
    return {
      running: Boolean(this.server?.listening),
      host: this.config.host,
      port,
      publicBaseUrl: this.config.publicBaseUrl ?? `http://${this.config.host}:${port}`,
    };
  }

  async start(): Promise<void> {
    if (this.server?.listening) return;
    this.server = http.createServer((req, res) => this.route(req, res));
    await new Promise<void>((resolve) => this.server!.listen(this.config.port, this.config.host, () => resolve()));
    const addr = this.server.address();
    if (addr && typeof addr === "object") {
      this.boundPort = addr.port;
    }
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
    this.boundPort = undefined;
  }

  private unauthorized(res: ServerResponse) {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "unauthorized" }));
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isAuthorized(req, this.config.authToken)) {
      this.unauthorized(res);
      return;
    }

    const path = req.url ?? "/";

    if (req.method === "GET" && path === "/") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, service: "openclaw-a2a-server" }));
      return;
    }

    if (req.method === "GET" && path === "/.well-known/agent-card.json") {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(buildAgentCard(this.config)));
      return;
    }

    if (req.method === "POST" && path === "/a2a") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString("utf8");

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(rpcError(null, -32700, "Parse error", "A2A_PARSE_ERROR")));
        return;
      }

      const rpc = parseJsonRpcRequest(parsed);
      if (!rpc) {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(rpcError(null, -32600, "Invalid Request", "A2A_INVALID_REQUEST")));
        return;
      }

      if (rpc.method === "message/send") {
        const executionMode = (rpc.params?.metadata as Record<string, unknown> | undefined)?.executionMode;
        if (executionMode === "async") {
          const task = this.tasks.create("accepted");
          this.tasks.update(task.taskId, "running", { progress: 40, message: "processing" });
          setTimeout(() => {
            this.tasks.update(task.taskId, "succeeded", {
              progress: 100,
              final: true,
              message: "completed",
              result: { status: "accepted", clientOperation: "message/send", taskId: task.taskId },
            });
          }, 10);

          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(rpcResult(rpc.id, {
            status: "accepted",
            taskId: task.taskId,
            pollMethod: "tasks/get",
            pollAfterMs: 1000,
          })));
          return;
        }

        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(rpcResult(rpc.id, { status: "accepted", clientOperation: "message/send" })));
        return;
      }

      if (rpc.method === "tasks/get") {
        const taskId = String((rpc.params?.taskId as string | undefined) ?? "");
        const task = this.tasks.get(taskId);
        if (!task) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(rpcError(rpc.id, -32004, "Task not found", "A2A_TASK_NOT_FOUND")));
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(rpcResult(rpc.id, {
          status: { state: task.state, message: task.message, progress: task.progress },
          taskId: task.taskId,
          result: task.result,
        })));
        return;
      }

      if (rpc.method === "message/stream" || rpc.method === "tasks/resubscribe") {
        let taskId = "";
        if (rpc.method === "tasks/resubscribe") {
          taskId = String((rpc.params?.taskId as string | undefined) ?? "");
          if (!taskId || !this.tasks.get(taskId)) {
            res.statusCode = 404;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(rpcError(rpc.id, -32004, "Task not found", "A2A_TASK_NOT_FOUND")));
            return;
          }
        } else {
          const task = this.tasks.create("accepted");
          taskId = task.taskId;
          this.tasks.update(taskId, "running", { progress: 30, message: "started" });
          setTimeout(() => this.tasks.update(taskId, "running", { progress: 70, message: "working" }), 5);
          setTimeout(() => this.tasks.update(taskId, "succeeded", { progress: 100, message: "completed", final: true }), 10);
        }

        const task = this.tasks.get(taskId)!;
        res.statusCode = 200;
        res.setHeader("content-type", "text/event-stream");
        res.setHeader("cache-control", "no-cache");
        for (const event of task.events) {
          res.write(`id: ${event.id}\n`);
          res.write("event: task\n");
          res.write(`data: ${JSON.stringify({ taskId, status: { state: event.state, progress: event.progress, message: event.message }, final: Boolean(event.final) })}\n\n`);
        }
        res.end();
        return;
      }

      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(rpcError(rpc.id, -32601, "Method not found", "A2A_METHOD_NOT_FOUND")));
      return;
    }

    res.statusCode = 404;
    res.end();
  }
}

export function resolveConfig(input: unknown = {}): ServerConfig {
  const cfg = (input ?? {}) as Partial<ServerConfig>;
  if (!cfg.authToken) {
    throw new Error("authToken is required");
  }
  return {
    host: cfg.host ?? "127.0.0.1",
    port: cfg.port ?? 8787,
    publicBaseUrl: cfg.publicBaseUrl,
    authToken: cfg.authToken,
    taskTtlMs: cfg.taskTtlMs ?? 3_600_000,
  };
}
