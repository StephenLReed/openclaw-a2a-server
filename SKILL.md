---
name: openclaw-a2a-server
description: Run a local standards-profile A2A server (message/send, tasks/get, message/stream, tasks/resubscribe) with Bearer authentication.
---

# OpenClaw A2A Server

## Purpose

Runs an A2A v0.3-style server surface for peer-to-peer testing and integration.

## Endpoints

1. `GET /`
2. `GET /.well-known/agent-card.json`
3. `POST /a2a`

## Notes

1. Bearer token is required for all endpoints.
2. Methods supported: `message/send`, `tasks/get`, `message/stream`, `tasks/resubscribe`.
3. Profile is standards-only in v1.
