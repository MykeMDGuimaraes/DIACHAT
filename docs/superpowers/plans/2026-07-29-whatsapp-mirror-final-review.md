# WhatsApp Mirror Final Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all six integrated-review findings without running unavailable staging or PostgreSQL gates.

**Architecture:** Encrypt rich provider snapshots at the outbox boundary and keep JSONB correlation-only; decrypt with fenced AAD in fanout. Replace hash revision ordering with observed callback ordering, make replay timing causal, expose both webhook contracts in OpenAPI, and make capacity/runtime schedulers backlog-aware.

**Tech Stack:** TypeScript, Jest, Sequelize/PostgreSQL, AES-256-GCM, OpenAPI, Node.js.

## Global Constraints

- No plaintext rich DTO or PII in `MessagingOutboxEvent.payload`, admin output, or logs.
- Preserve lease fencing and encrypted dead-letter retention.
- Do not run staging load or PostgreSQL-dependent gates locally.
- Each task follows RED, observed failure, minimal GREEN, and focused verification.

---

### Task 1: Encrypted outbox boundary and backfill

**Files:** publisher, fanout, outbox model/migration, backfill, admin and their tests.

- [ ] Add RED tests with text/JID/phone/vCard proving payload is correlation-only and ciphertext decrypts with the expected AAD/digest.
- [ ] Persist rich snapshots in existing encrypted columns and decrypt them in fanout before projection.
- [ ] Make legacy processing backfill recover to ready with cleared lease and preserve encrypted dead letters for purge.
- [ ] Run publisher/fanout/backfill/admin/purge/migration tests.

### Task 2: Chat callback ordering

**Files:** lifecycle identity, provider publisher/chat state tests.

- [ ] Add RED tests for equal/missing timestamp later observation, duplicate callback, and truly old timestamp.
- [ ] Replace hash revision comparison with provider-time plus deterministic observed order/idempotency.
- [ ] Run adapter/publisher/chat-state tests.

### Task 3: OpenAPI dual contract

**Files:** messaging OpenAPI schemas and tests.

- [ ] Add RED assertions for `oneOf` legacy 1.1 and mirror 1.2, with `schema` optional in legacy only.
- [ ] Update the public webhook component schemas and examples.
- [ ] Run OpenAPI contract tests.

### Task 4: Causal replay timing

**Files:** capacity runner, replay request/service and tests.

- [ ] Add RED tests for future UUID/run offsets and identical retries.
- [ ] Pass fixed `runStartedAt`; derive sequence time at 150/s and reject future timestamps.
- [ ] Run replay/controller/capacity tests.

### Task 5: Offered-rate capacity scheduler and adaptive runtime

**Files:** capacity scheduler, messaging runtime and tests.

- [ ] Add clock-driven RED tests for 1,800 offered windows/270,000 events and explicit completion tolerance.
- [ ] Add runtime RED proving backlog beyond one batch is drained without the outer 5-second interval.
- [ ] Implement monotonic offered scheduling, completion/wall measurements, AbortController, and bounded adaptive drain.
- [ ] Run capacity/runtime tests.

### Task 6: Release evidence

**Files:** rollout docs, capacity artifact, ignored task report.

- [ ] Update operational contracts, blocked external gates, and evidence.
- [ ] Run all focused suites, build, scoped lint, dry gates, and diff check.
- [ ] Create one separate final-review commit and report the SHA.
