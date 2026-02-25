import type { IncomingMessage } from "node:http";

export function isAuthorized(req: IncomingMessage, token: string): boolean {
  const auth = req.headers.authorization;
  return auth === `Bearer ${token}`;
}
