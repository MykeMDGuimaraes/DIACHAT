# DiaChat Messaging V1 Completion Design

## Objective

Complete the approved monolithic messaging architecture on `codex/messaging-v1`: route all outbound WhatsApp messages through the messaging module, deliver customer webhooks durably, add a per-company Meta Cloud API channel configured from the frontend, and provide a real-environment capacity gate.

## Constraints

- Keep a modular monolith in `app/backend/src/messaging`; do not add NestJS, Prisma, PM2, or a second process.
- PostgreSQL is the source of truth. Redis/Bull may accelerate work but cannot be required for message or webhook durability.
- Baileys imports remain inside `messaging/adapters/baileys` after the legacy migration.
- The public API continues to require `dch_live_<tokenId>.<secret>`, scope checks, connection authorization, and `Idempotency-Key`.
- A provider failure after a possible transmission becomes `unknown` and is never automatically resent.
- Production Meta connections are real customer connections. The backend must not generate, persist, or route through a fake Meta provider.
- Each company configures its own channel and webhook subscriptions from the frontend.
- The legacy `/api/messages/send` endpoint remains available with telemetry and deprecation headers until 14 consecutive days without relevant traffic after the configured sunset date.

## Channel Model

`Whatsapp` remains the application-facing connection identifier used by tickets and public commands. New provider-specific configuration is stored in `messaging.ChannelProviderConfig`, keyed by `whatsappId` and `companyId`.

For `baileys`, the row stores only routing metadata and the runtime uses the existing session ownership model. For `meta-cloud`, the row stores `phoneNumberId`, `wabaId`, a fixed `graphVersion`, encrypted access token ciphertext, encryption key version, verify token hash, status, and last validation metadata. The plaintext access token and verify token are accepted only by the create/update request, used to validate the real channel, encrypted or hashed, then discarded from responses and logs.

The frontend channel wizard has two provider cards: Baileys and Meta Cloud API. Selecting Meta presents a manual form for display name, phone number, `phone_number_id`, `waba_id`, permanent system-user token, graph version, and verify token. Saving invokes the backend validation call against the configured Graph version. A failed validation does not activate the channel.

## Outbound Delivery

All user-facing outbound flows call a messaging application service rather than `WASocket.sendMessage`. The service persists the contact/ticket/message command/outbox event in one PostgreSQL transaction. The dispatcher claims events with `FOR UPDATE SKIP LOCKED`, changes a command to `sending` under a lease, and routes it by `provider`.

`BaileysMessageCommandProvider` sends through the Baileys adapter. `MetaCloudMessageProvider` calls `POST /{phone_number_id}/messages` on the configured Graph API version using the decrypted tenant token. Both return a provider message id. A successful provider acknowledgement marks the command `sent`; a timeout or exception after dispatch enters `unknown`. The reconciler marks expired `sending` commands `unknown` and never enqueues them again.

The migration replaces direct send calls in helper, queue, integration, Typebot, ticket, Wbot listener, monitor, media, and provider-service paths with typed operations on the Baileys adapter/application port. A CI check rejects direct `baileys` imports and `.sendMessage(` use outside the adapter allowlist.

## Meta Callback Handling

The callback endpoint is provider-specific and does not use customer webhook secrets:

- `GET /api/v1/meta/webhooks/:whatsappId` validates the `hub.mode`, `hub.verify_token`, and `hub.challenge` using the stored verify-token hash.
- `POST /api/v1/meta/webhooks/:whatsappId` consumes the raw request body, validates `X-Hub-Signature-256` using the tenant's configured Meta app secret, deduplicates the provider event id in an inbox table, and records incoming messages and status updates transactionally.
- The Graph version is never `latest`. A scheduled check exposes an alert metric when the selected version approaches Meta's published sunset window.

The first release supports text messages, media messages already supported by the application upload pipeline, inbound messages, and sent/delivered/read status callbacks. Templates are persisted and sent only through a dedicated template command; groups and Meta Embedded Signup remain outside V1.

## Customer Webhooks

`messaging.WebhookSubscription` stores company, enabled flag, URL, event allowlist, message filters, encrypted signing secret, encryption key version, failure count, and pause state. `messaging.WebhookDelivery` stores a snapshot of the URL, encrypted secret/key version, payload, attempt number, timestamps, lease, response metadata, and terminal state.

When a domain event is committed, the application writes an outbox event. The webhook fan-out transaction resolves subscriptions and writes one delivery per matching subscription with its URL/secret snapshot. A dispatcher posts each delivery with:

- `X-DiaChat-Timestamp` (Unix seconds)
- `X-DiaChat-Signature: sha256=<HMAC-SHA256(secret, timestamp + '.' + rawBody)>`
- an immutable event id and delivery id in the JSON envelope.

Outgoing URLs are validated before save and re-resolved immediately before each connection. The validator rejects private, loopback, link-local, multicast, unspecified, and metadata-service addresses for IPv4 and IPv6. Redirects are disabled. Events originating from the public API are excluded by default to prevent automation loops; each subscription can explicitly opt in.

Delivery is at-least-once: successful 2xx completes it; retryable failures use exponential backoff with bounded jitter and honor `Retry-After`; after six failed attempts it is dead-lettered; 50 consecutive terminal failures pause the subscription. The runtime exposes counts for ready, leased, dead-letter, paused subscriptions, and oldest ready outbox age.

## Security and Operations

Tenant provider tokens and customer webhook secrets use AES-256-GCM with a versioned platform key. API credential secrets retain their HMAC-plus-pepper design. Plaintext secrets are never returned after initial creation and never included in structured logs, audit payloads, or error bodies.

The API rate limiter is configurable per company, including request/minute and upload MB/minute. Metrics are available on an authenticated internal endpoint from Phase A onward. Retention jobs purge inbox/outbox delivery payloads after the approved retention periods and emit success/failure/age metrics.

## Capacity Gate

A production-like, opt-in capacity command is added under `app/backend/scripts`. It refuses to run without an explicit `MESSAGING_CAPACITY_RUN=1`, PostgreSQL, Redis, a configured target URL, and an allowlisted set of 20 existing Baileys connections. It performs 50 requests/second against a dedicated internal test path using a provider observation mode that does not create customer messages. It reports process RSS, p95 API latency, oldest outbox age, dispatcher throughput, PostgreSQL pool usage, and provider session count.

The deployment gate is: 20 authorized sessions, 50 req/s for 30 minutes, no command loss after Redis restart, no duplicate outbound command, p95 API latency within the configured SLO, and RSS below the configured 8 GB VM safety threshold. The harness does not fabricate sessions or provider credentials.

## Acceptance Criteria

1. No direct Baileys send/import outside the approved adapter boundary; CI rejects regressions.
2. A company can configure, validate, rotate, and revoke a real Meta channel from the frontend without exposing token plaintext after save.
3. Public text and supported media commands route through Baileys or Meta using the same idempotent command/outbox contract.
4. Meta callbacks and customer webhook deliveries are durable, signed, isolated by tenant, and recover after process/Redis failure.
5. Customer webhook retries, DLQ, pause behavior, SSRF protections, and snapshot secret rotation behavior have automated coverage.
6. Legacy traffic is observable before any endpoint removal.
7. The capacity script provides a reproducible real-environment report and fails its configured gates.
