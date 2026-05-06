# AI Automation Orchestration Core

Production-grade backend orchestration core for an AI automation platform. This repository focuses on the **Tool Integration Layer** and **Workflow Execution Layer** only: no frontend dashboard, CRM, billing, analytics, or onboarding product surface.

## Architecture Decisions by Phase

### Phase 1 — Architecture, Monorepo Shape, Schema, Token Management

- **Runtime:** Node.js 20 + TypeScript with strict compiler settings for predictable backend behavior.
- **API Gateway:** Fastify service with Helmet, API bearer authentication, rate limiting, health checks, readiness checks, structured errors, and Prometheus metrics.
- **Database:** PostgreSQL via Prisma. The schema models tenants, credentials, integration connections, workflow definitions, workflow runs, step runs, webhook endpoints, and audit logs.
- **Secure token storage:** OAuth2 access tokens, refresh tokens, API keys, and bearer tokens are encrypted at rest with AES-256-GCM before persistence. Provider adapters request the auth-header strategy they need, so API-key providers and bearer-token providers are not conflated.
- **Configuration:** Environment variables are validated at boot with Zod so misconfigured deployments fail fast.
- **Idempotency:** Workflow triggers accept an `Idempotency-Key` header and persist it on workflow runs to prevent duplicate async jobs from repeated client/webhook delivery attempts.

### Phase 2 — Integration Framework, Webhooks, MCP, Workflow Engine

- **Integration registry:** Providers are isolated behind a shared adapter contract. Initial adapters include REST, GraphQL, CLI, PostgreSQL, MCP, and AI routing.
- **Initial integrations:** OpenAI, Claude, WhatsApp Graph API, Gmail, Google Drive, Slack, Notion, GitHub REST, GitHub GraphQL, PostgreSQL query execution, Supabase API/CLI, MCP tools, and generic AI tool calls.
- **Provider safety:** REST/GraphQL calls use provider-specific base URLs, default headers, auth schemes, tenant/provider Redis rate limits, and retry wrappers for retryable upstream failures.
- **Webhook service:** Webhook ingestion routes provider events into workflow runs. HMAC signature helpers are included, and webhook-triggered workflow runs use the correlation id as an idempotency key.
- **Workflow engine:** Workflow definitions execute ordered/routed steps with context passing, schema validation, cycle detection, `onFailure` routing, and conditional next-step routing. Step results are persisted for replay, debugging, and auditability.

### Phase 3 — Queues, Retries, Async Execution, AI Routing

- **Queue system:** BullMQ + Redis queues long-running workflow runs and decouples API request latency from execution time.
- **Retry logic:** Jobs use exponential backoff and bounded retry attempts. Upstream HTTP 429/5xx responses are translated into retryable errors and retried with bounded jittered backoff inside adapters and again at the durable queue boundary.
- **AI runtime:** Agent steps route to OpenAI or Claude and preserve workflow context for tool-calling style execution.
- **Worker isolation:** API and worker processes can scale independently.

### Phase 4 — Testing, Docker, Deployment, Documentation

- **Dockerized setup:** `docker-compose.yml` runs PostgreSQL, Redis, API, and worker processes.
- **Deployment configs:** A production Dockerfile and Kubernetes deployment manifest are included.
- **Testing:** Vitest covers security-critical secret encryption behavior; TypeScript build validates the backend contract.

## Repository Structure

```text
src/
  agent/              Multi-model AI routing runtime
  auth/               Token encryption and OAuth/API-key credential manager
  config/             Environment validation
  db/                 Prisma client
  http/               API gateway plugins and routes
  integrations/       Adapter contracts, provider configs, retry, rate limits, and providers
  logging/            Pino logger
  mcp/                Minimal MCP JSON-RPC client
  observability/      Prometheus metrics
  queues/             BullMQ queues and Redis connection
  webhooks/           Webhook ingestion/signature services
  workflows/          Workflow definitions, service, and engine
  workers/            BullMQ worker entrypoint
prisma/schema.prisma  PostgreSQL data model
```

## Local Development

1. Copy environment values:

   ```bash
   cp .env.example .env
   ```

2. Start dependencies and services:

   ```bash
   docker compose up --build
   ```

3. In another shell, run migrations if needed:

   ```bash
   docker compose exec api npx prisma migrate deploy
   ```

4. Authenticate API requests with:

   ```http
   Authorization: Bearer <API_AUTH_TOKEN>
   x-tenant-id: <tenant-id>
   ```

## Core API Examples

### Register a Credential

```bash
curl -X POST http://localhost:8080/credentials \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -H "x-tenant-id: tenant_123" \
  -H "content-type: application/json" \
  -d '{"provider":"slack","type":"BEARER_TOKEN","accessToken":"xoxb-..."}'
```

### Execute an Integration Action

REST and GraphQL adapters enforce relative paths and provider-specific auth/header behavior. Example Slack call:

```bash
curl -X POST http://localhost:8080/integrations/slack/actions/api-call \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -H "x-tenant-id: tenant_123" \
  -H "content-type: application/json" \
  -d '{"method":"POST","path":"/chat.postMessage","body":{"channel":"C123","text":"Workflow executed"}}'
```

### Create and Trigger a Workflow

```bash
curl -X POST http://localhost:8080/workflows \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -H "x-tenant-id: tenant_123" \
  -H "content-type: application/json" \
  -d '{
    "name":"AI Slack responder",
    "definition":{
      "trigger":{"type":"api"},
      "steps":[
        {"id":"draft","type":"agent","action":"complete","input":{"provider":"openai","messages":[{"role":"user","content":"Summarize the workflow input from context."}]},"next":"notify"},
        {"id":"notify","type":"integration","provider":"slack","action":"post","input":{"method":"POST","path":"/chat.postMessage","body":{"channel":"C123","text":"Done"}}}
      ]
    }
  }'
```

Then trigger it with idempotency protection:

```bash
curl -X POST http://localhost:8080/workflows/<workflow-id>/runs \
  -H "Authorization: Bearer $API_AUTH_TOKEN" \
  -H "x-tenant-id: tenant_123" \
  -H "Idempotency-Key: request-123" \
  -H "content-type: application/json" \
  -d '{"customer":"Acme","request":"Open support ticket"}'
```


## Workflow Definition Contract

Workflow definitions are validated before persistence. Each step id must be unique, all `next`, `onFailure`, `when.next`, and `when.otherwise` routes must reference existing steps, and the engine rejects cycles at runtime. Supported step types are:

- `integration`: call a registered external provider adapter.
- `agent`: call the AI runtime, which routes to OpenAI or Claude.
- `condition`: evaluate simple, safe path-based conditions without executing arbitrary code.
- `delay`: pause execution for a bounded amount of time inside the worker.

Example conditional route:

```json
{
  "id": "gate",
  "type": "condition",
  "when": {
    "left": "input.approved",
    "operator": "equals",
    "right": true,
    "next": "execute",
    "otherwise": "stop"
  }
}
```

## Operational Hardening Included

- Tenant/provider Redis sliding-window rate limits for outbound integration calls.
- Adapter-local retry wrappers with jitter for retryable upstream 429/5xx failures.
- Durable BullMQ retries with exponential backoff for full workflow jobs.
- Correlation ids propagated to outbound REST calls and persisted on workflow runs.
- Optional idempotency keys for workflow triggers and webhook delivery de-duplication.
- Read-only default guard for PostgreSQL query integration.

## Deployment Steps

1. Build and push the image:

   ```bash
   docker build -t ghcr.io/example/ai-orchestration-core:latest .
   docker push ghcr.io/example/ai-orchestration-core:latest
   ```

2. Provision managed PostgreSQL and Redis.
3. Store `.env.example` values as secrets in your runtime platform.
4. Run Prisma migrations:

   ```bash
   npx prisma migrate deploy
   ```

5. Deploy API and worker separately. Scale API replicas for ingress throughput and worker replicas for workflow concurrency.
6. Export `/metrics` to Prometheus and centralize JSON logs from stdout.

## Production Notes

- Use a KMS-managed `TOKEN_ENCRYPTION_KEY`; rotating it requires a token re-encryption migration.
- Keep CLI integration disabled or tightly allowlisted in high-security tenants.
- Add provider-specific webhook verification secrets per endpoint before exposing public webhook routes.
- Use separate Redis queues for high-priority or tenant-isolated workloads as volume grows.
