# Plugin Layer

Registered methods:

1. `a2a-server.start`
2. `a2a-server.stop`
3. `a2a-server.status`
4. `a2a-server.card`
5. `a2a-server.smoke`

Behavior mirrors `openclaw-a2a-client` plugin style:

1. Config from plugin config plus per-call overrides.
2. Optional `ctx.respond(ok, payload)` support.
3. Deterministic payload contracts.
