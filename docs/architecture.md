# Architecture

`openclaw-a2a-server` mirrors the style of `openclaw-a2a-client`:

1. Small TypeScript runtime core.
2. Stable envelopes and deterministic errors.
3. OpenClaw plugin entrypoint plus method registration.

Core components:

1. `src/server.ts` — HTTP endpoints and JSON-RPC method routing.
2. `src/tasks/task-store.ts` — in-memory task lifecycle and event history.
3. `src/card/agent-card.ts` — standards-profile card advertisement.
4. `src/index.ts` — gateway registration layer.
