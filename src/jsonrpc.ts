import type { JsonRpcRequest } from "./types.js";

export function parseJsonRpcRequest(input: unknown): JsonRpcRequest | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0") return null;
  if (typeof obj.method !== "string") return null;
  if (!(typeof obj.id === "string" || typeof obj.id === "number" || obj.id === null)) return null;
  return obj as unknown as JsonRpcRequest;
}

export function rpcResult(id: string | number | null, result: unknown): unknown {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  machineCode: string,
  detail?: string
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      data: {
        code: machineCode,
        detail: detail ?? message,
      },
    },
  };
}
