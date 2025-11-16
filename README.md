# Sentinel Support - AI-Powered Fraud Triage System

A production-ready fraud detection and customer support triage system built with TypeScript, React, and Claude API.

## Quick Start (3 Commands)

```bash
# 1. Start all services (Postgres, Redis, API, Web)
podman compose up -d

# 2. Wait for services to initialize, then seed database
cd api && pnpm

# 3. Open the web UI
open http://localhost:5173
```

**Default Credentials:**
- API Key: `sentinel-dev-key`
- Database: PostgreSQL on port 5432
- API: http://localhost:8080
- Web UI: http://localhost:5173

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (React + Vite)                     │
│  - Alert Queue Dashboard                                            │
│  - Real-time Triage Drawer (SSE)                                    │
│  - Action Buttons (Freeze Card, Open Dispute, Contact Customer)     │
└────────────────┬────────────────────────────────────────────────────┘
                 │ HTTP/SSE
┌────────────────▼────────────────────────────────────────────────────┐
│                      API Server (Express + TypeScript)              │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Routes Layer                                                 │   │
│  │  - /api/alerts (get alerts queue)                            │   │
│  │  - /api/triage (start triage run)                            │   │
│  │  - /api/triage/:runId/stream (SSE for real-time updates)     │   │
│  │  - /api/action/* (freeze card, open dispute)                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Middleware                                                   │   │
│  │  - API Key Auth                                              │   │
│  │  - Rate Limiting (Redis-backed, 5 req/60s for triage)        │   │
│  │  - Helmet Security Headers                                   │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Triage Orchestrator (Multi-Agent System)                     │   │
│  │  Step 1: Load Context (customer, alert, transactions)        │   │
│  │  Step 2: FraudAgent - Risk scoring with fallback             │   │
│  │  Step 3: KBAgent - Search knowledge base                     │   │
│  │  Step 4: Final Decision - Synthesize + KB refinement         │   │
│  │  - Publishes events to Redis (SSE)                           │   │
│  │  - Records traces to DB (with PII redaction)                 │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ Agents                                                       │   │
│  │  - FraudAgent: Deterministic rule-based risk scoring         │   │
│  │  - KBAgent: Search dispute/compliance docs                   │   │
│  │  - RedactorAgent: PII redaction (PAN, email)                 │   │
│  │  - ComplianceAgent: Policy checks (OTP, freeze rules)        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────┬────────────────────────────┬──────────────────────┬───────── ─┘
      │                            │                      │
┌─────▼──────┐            ┌────────▼────────┐     ┌──────▼──────────┐
│ PostgreSQL │            │ Redis (Pub/Sub) │     │ Redis (Cache)   │
│ - Customers│            │ - SSE Events    │     │ - Rate Limits   │
│ - Cards    │            │ - Real-time     │     │ - Idempotency   │
│ - Txns     │            │   Updates       │     │                 │
│ - Alerts   │            └─────────────────┘     └─────────────────┘
│ - Cases    │
│ - KB Docs  │
└────────────┘
```

---

## Key Features

### 1. **Real-Time Triage with SSE**
- Server-Sent Events stream triage progress to UI
- Non-blocking async orchestration
- Live updates: plan_built → tool_update → decision_finalized

### 2. **Multi-Agent Decision System**
- **FraudAgent**: Rule-based risk scoring (velocity, MCC, country, amount)
- **KBAgent**: Searches knowledge base for merchant patterns, dispute guidance
- **Duplicate Detection**: Identifies pre-auth vs capture scenarios
- **Fallback Mechanism**: Gracefully handles agent timeouts (Acceptance Test #4)

### 3. **Production-Grade Security**
- **PII Redaction**: Automatic redaction of PANs and emails in logs, traces, API responses
- **Rate Limiting**: Redis-backed, per-endpoint limits (5 req/60s for triage)
- **API Key Auth**: Header-based authentication
- **CORS**: Configured for local dev (http://localhost:5173)
- **Helmet**: Security headers (CSP, HSTS, etc.)

### 4. **Idempotency & Reliability**
- Idempotency keys for actions (freeze card, open dispute)
- Stored in Redis with 24h TTL
- Prevents duplicate charges/actions

### 5. **Performance Optimized**
- **Keyset Pagination**: Cursor-based pagination for transactions (p95 ≤ 100ms SLO)
- **Indexed Queries**: Composite indexes on (customer_id, ts DESC)
- **Prometheus Metrics**: `/metrics` endpoint for monitoring

---

## Key Trade-offs

### 1. **Deterministic Rules vs ML Models**
**Choice**: Deterministic rule-based FraudAgent
- ✅ **Pro**: Explainable, auditable, no training data needed
- ✅ **Pro**: Instant results, no GPU/inference costs
- ❌ **Con**: Requires manual rule updates for new fraud patterns
- **Trade-off**: Prioritized **transparency and compliance** over adaptive learning

### 2. **SSE vs WebSockets**
**Choice**: Server-Sent Events (SSE) for real-time updates
- ✅ **Pro**: Simpler implementation, automatic reconnection
- ✅ **Pro**: HTTP/1.1 compatible, firewall-friendly
- ❌ **Con**: One-way communication only (server → client)
- **Trade-off**: Triage is **read-heavy**, so SSE fits perfectly

### 3. **Redis Pub/Sub vs Direct SSE**
**Choice**: Redis Pub/Sub as SSE backend
- ✅ **Pro**: Horizontal scaling (multiple API instances can share events)
- ✅ **Pro**: Decouples orchestrator from HTTP layer
- ❌ **Con**: Adds Redis dependency and latency (~1-5ms)
- **Trade-off**: **Scalability** over minimal latency for single-instance setups

### 4. **In-Memory State vs Database State**
**Choice**: Store pending triage state in-memory Map
- ✅ **Pro**: Fast access, no DB round-trips during orchestration
- ❌ **Con**: Lost on server restart (requires SSE reconnect)
- **Trade-off**: **Performance** over crash recovery (acceptable for dev/MVP)

### 5. **Full PII Redaction vs Partial Masking**
**Choice**: Complete redaction (`****REDACTED****`)
- ✅ **Pro**: Zero PII leakage risk, GDPR/PCI compliant
- ❌ **Con**: No partial visibility for debugging (e.g., last 4 digits)
- **Trade-off**: **Maximum security** over developer convenience

### 6. **Keyset Pagination vs Offset/Limit**
**Choice**: Cursor-based keyset pagination for transactions
- ✅ **Pro**: Consistent performance at any page depth (no OFFSET scan)
- ✅ **Pro**: Meets p95 ≤ 100ms SLO
- ❌ **Con**: Can't jump to arbitrary page numbers
- **Trade-off**: **Performance at scale** over UX flexibility

---

## Project Structure

```
sentinel-support/
├── api/                        # Backend API (Express + TypeScript)
│   ├── src/
│   │   ├── routes/             # API endpoints
│   │   ├── Services/           # Business logic
│   │   │   ├── TriageOrchestrator.ts
│   │   │   ├── agents/         # FraudAgent, KBAgent, RedactorAgent
│   │   │   ├── SseService.ts   # Redis Pub/Sub for SSE
│   │   │   └── MetricsService.ts
│   │   ├── middleware/         # Auth, rate limiting
│   │   └── lib/                # Prisma, Redis clients
│   ├── prisma/
│   │   └── schema.prisma       # Database schema
│   └── scripts/
│       └── seed.ts             # Database seeding
├── web/                        # Frontend (React + Vite)
│   ├── src/
│   │   ├── pages/              # Alerts, Dashboard
│   │   ├── components/         # TriageDrawer, AlertCard
│   │   └── hooks/              # useTriageStream (SSE)
├── fixtures/                   # Test data (alerts, customers, transactions)
├── docker-compose.yml          # Postgres, Redis, API, Web
└── ACCEPTANCE_TESTS.md         # 7 end-to-end test scenarios
```

---

## Technology Stack

**Backend:**
- Node.js 20+ with TypeScript
- Express.js (API framework)
- Prisma ORM (PostgreSQL)
- ioredis (Redis client)
- Zod (validation)
- Helmet (security)
- express-rate-limit (rate limiting)

**Frontend:**
- React 18
- Vite (build tool)
- Radix UI (accessible components)
- TailwindCSS (styling)
- EventSource (SSE client)

**Infrastructure:**
- PostgreSQL 16 (database)
- Redis 7 (pub/sub, caching)
- Podman Compose (container orchestration)

---

## Environment Variables

Create `.env` in `api/` directory:

```env
DATABASE_URL="postgresql://sentinel:sentinel@postgres:5432/sentinel_db"
REDIS_URL="redis://redis:6379"
PORT=8080
NODE_ENV=development
```

---

## Monitoring & Observability

- **Metrics**: `GET /api/metrics` (Prometheus format)
  - `http_requests_total`
  - `http_request_duration_seconds`
  - `rate_limit_blocked_total`
  - `agent_tool_call_duration_seconds`
  - `agent_fallback_total`

- **Logs**: Structured JSON logs via Pino
  - All PII automatically redacted
  - Trace IDs for request correlation

---

## Development

```bash
# View database
podman exec -it sentinel_pg psql -U sentinel -d sentinel_db

# Check Redis
podman exec -it sentinel_redis redis-cli

# Restart API only
podman compose restart api

# View logs
podman compose logs -f api
```

---

## License

MIT

---

## Support

For issues or questions, see [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) for debugging steps.
