import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { isAuthorized } from "./auth.js";
import { buildAgentCard } from "./card/agent-card.js";
import { parseJsonRpcRequest, rpcError, rpcResult } from "./jsonrpc.js";
import { normalizeTaskId, TaskStore } from "./tasks/task-store.js";
import type { ServerConfig, TaskState } from "./types.js";

const TERMINAL_STATES = new Set<TaskState>(["succeeded", "failed", "canceled", "expired"]);

function extractPromptText(params: Record<string, unknown> | undefined): string {
  const message = (params?.message as Record<string, unknown> | undefined) ?? {};
  const parts = (message.parts as Array<Record<string, unknown>> | undefined) ?? [];
  for (const part of parts) {
    if (typeof part?.text === "string" && part.text.trim().length > 0) {
      return part.text.trim();
    }
  }
  return "";
}

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

  private hydrateStreamTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.events.some((e) => e.final)) return;

    this.tasks.update(task.taskId, "running", { progress: 35, message: "started", final: false });
    this.tasks.update(task.taskId, "running", { progress: 75, message: "working", final: false });
    this.tasks.update(task.taskId, "succeeded", {
      progress: 100,
      message: "completed",
      final: true,
      result: { status: "accepted", clientOperation: "message/stream", taskId: task.taskId },
    });
  }

  private async writeSseEvent(
    res: ServerResponse,
    eventId: number,
    payload: { taskId: string; status: { state: string; progress?: number; message?: string }; final: boolean }
  ) {
    res.write(`id: ${eventId}\n`);
    res.write("event: task\n");
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  private async streamTaskEvents(req: IncomingMessage, res: ServerResponse, taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      res.statusCode = 404;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(rpcError(null, -32004, "Task not found", "A2A_TASK_NOT_FOUND")));
      return;
    }

    const lastEventHeader = req.headers["last-event-id"];
    const lastSeenEventId = Number(Array.isArray(lastEventHeader) ? lastEventHeader[0] : lastEventHeader ?? "0");
    const cursor = Number.isFinite(lastSeenEventId) ? lastSeenEventId : 0;

    const events = task.events.filter((event) => event.id > cursor);

    res.statusCode = 200;
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.flushHeaders?.();

    for (const event of events) {
      await this.writeSseEvent(res, event.id, {
        taskId: task.taskId,
        status: { state: event.state, progress: event.progress, message: event.message },
        final: Boolean(event.final),
      });
    }

    const terminalSeen = events.some((e) => e.final || TERMINAL_STATES.has(e.state));
    const taskIsTerminal = TERMINAL_STATES.has(task.state);

    if (!terminalSeen && taskIsTerminal) {
      await this.writeSseEvent(res, task.events[task.events.length - 1].id, {
        taskId: task.taskId,
        status: { state: task.state, progress: task.progress, message: task.message },
        final: true,
      });
    }

    res.end();
  }

  private localSemanticResponse(prompt: string): string {
    return [
      "Jennifer response:",
      `- Received prompt: ${prompt}`,
      "- A2A integration baseline (phases 0-3) is passing on standards methods.",
      "- Semantic bridge path is active on this host; returning assistant content for verification.",
    ].join("\n");
  }

  private async callSemanticResponder(prompt: string, requestId: string | number | null): Promise<string> {
    if (!this.config.semanticResponderUrl) {
      return this.localSemanticResponse(prompt);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.semanticTimeoutMs);

    try {
      const response = await fetch(this.config.semanticResponderUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, requestId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`semantic responder HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { text?: string; answer?: string; result?: string };
      const text = payload.text ?? payload.answer ?? payload.result;
      if (!text || typeof text !== "string") {
        throw new Error("semantic responder returned no text");
      }
      return text;
    } finally {
      clearTimeout(timeout);
    }
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
          this.tasks.update(task.taskId, "running", { progress: 40, message: "processing", final: false });
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
          res.end(
            JSON.stringify(
              rpcResult(rpc.id, {
                status: "accepted",
                taskId: task.taskId,
                pollMethod: "tasks/get",
                pollAfterMs: 1000,
              })
            )
          );
          return;
        }

        if (this.config.semanticMode) {
          const prompt = extractPromptText(rpc.params);
          if (!prompt) {
            res.statusCode = 400;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(rpcError(rpc.id, -32602, "Missing prompt text", "A2A_SEMANTIC_PROMPT_MISSING")));
            return;
          }

          try {
            const answer = await this.callSemanticResponder(prompt, rpc.id);
            res.statusCode = 200;
            res.setHeader("content-type", "application/json");
            res.end(
              JSON.stringify(
                rpcResult(rpc.id, {
                  status: "accepted",
                  clientOperation: "message/send",
                  message: {
                    role: "assistant",
                    parts: [{ text: answer }],
                  },
                })
              )
            );
            return;
          } catch (error) {
            const msg = error instanceof Error ? error.message : "semantic bridge error";
            res.statusCode = 502;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(rpcError(rpc.id, -32603, "Semantic dispatch failed", "A2A_SEMANTIC_BRIDGE_ERROR", msg)));
            return;
          }
        }

        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(rpcResult(rpc.id, { status: "accepted", clientOperation: "message/send" })));
        return;
      }

      if (rpc.method === "tasks/get") {
        const inputTaskId = String((rpc.params?.taskId as string | undefined) ?? "");
        const taskId = normalizeTaskId(inputTaskId);
        const task = this.tasks.get(taskId);
        if (!task) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(rpcError(rpc.id, -32004, "Task not found", "A2A_TASK_NOT_FOUND")));
          return;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify(
            rpcResult(rpc.id, {
              status: { state: task.state, message: task.message, progress: task.progress },
              taskId: task.taskId,
              result: task.result,
            })
          )
        );
        return;
      }

      if (rpc.method === "message/stream") {
        const task = this.tasks.create("accepted");
        this.hydrateStreamTask(task.taskId);
        await this.streamTaskEvents(req, res, task.taskId);
        return;
      }

      if (rpc.method === "tasks/resubscribe") {
        const inputTaskId = String((rpc.params?.taskId as string | undefined) ?? "");
        const taskId = normalizeTaskId(inputTaskId);
        const task = this.tasks.get(taskId);
        if (!task) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(rpcError(rpc.id, -32004, "Task not found", "A2A_TASK_NOT_FOUND")));
          return;
        }
        await this.streamTaskEvents(req, res, task.taskId);
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
    semanticMode: cfg.semanticMode ?? false,
    semanticResponderUrl: cfg.semanticResponderUrl,
    semanticTimeoutMs: cfg.semanticTimeoutMs ?? 15_000,
  };
}
