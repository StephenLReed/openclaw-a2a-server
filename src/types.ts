export type TaskState = "accepted" | "queued" | "running" | "succeeded" | "failed" | "canceled" | "expired";

export interface ServerConfig {
  host: string;
  port: number;
  publicBaseUrl?: string;
  authToken: string;
  taskTtlMs: number;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface TaskRecord {
  taskId: string;
  createdAt: number;
  updatedAt: number;
  state: TaskState;
  message?: string;
  result?: unknown;
  error?: unknown;
  progress?: number;
  events: Array<{ id: number; state: TaskState; progress?: number; message?: string; final?: boolean }>;
}

export interface GatewayContext {
  params?: unknown;
  respond?: (ok: boolean, payload: unknown) => unknown;
}

export interface PluginApi {
  pluginConfig?: unknown;
  registerGatewayMethod?: (
    name: string,
    handler: (ctx: GatewayContext) => Promise<unknown> | unknown
  ) => void;
  logger?: {
    info?: (msg: string, meta?: unknown) => void;
    warn?: (msg: string, meta?: unknown) => void;
    error?: (msg: string, meta?: unknown) => void;
  };
}
