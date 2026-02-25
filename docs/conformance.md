# Conformance Notes (v0.1.0)

Implemented wire baseline:

1. HTTP transport
2. JSON-RPC 2.0 envelopes on `/a2a`
3. SSE output for stream methods

Implemented canonical methods:

1. `message/send`
2. `tasks/get`
3. `message/stream`
4. `tasks/resubscribe`

Operational rules:

1. Preserve JSON-RPC `id`
2. Deterministic method and task-not-found errors
3. Advertise `profiles: ["standards"]`
