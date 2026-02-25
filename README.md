# OpenClaw A2A Server

TypeScript-only A2A server for OpenClaw with standards-profile methods and Bearer auth.

## Features

1. Endpoints: `GET /`, `GET /.well-known/agent-card.json`, `POST /a2a`
2. Methods: `message/send`, `tasks/get`, `message/stream`, `tasks/resubscribe`
3. Profile: `standards` only (no compat in v1)
4. Auth: Bearer token required

## Build and test

```bash
npm install
npm run build
npm test
```

## Plugin methods

1. `a2a-server.start`
2. `a2a-server.stop`
3. `a2a-server.status`
4. `a2a-server.card`
5. `a2a-server.smoke`
