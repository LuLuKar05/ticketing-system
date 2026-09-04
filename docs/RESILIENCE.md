# Resilient · Observable · Secure — deliverables

The write-up for the "make it resilient, observable and secure" phases. Every claim below is backed
either by a **captured run** against the real service, or by a **named test** you can run yourself.

Run the API locally with `npm start` (needs `DATABASE_URL`); the suite with `npm run check`.

---

## A. Observability — one id ties a request together

Every request is stamped with a **correlation id** the moment it arrives (before body parsing, so
even a malformed-body failure is traceable). It's held in an `AsyncLocalStorage` store, injected into
every Pino log line as `correlation_id`, returned to the client as **`ref`** on any error, and echoed
in the `x-correlation-id` response header.

**The contract: the `ref` the client sees IS the `correlation_id` in the logs.** Grep one id, get the
whole request.

### Captured trace

Client sees (a real response from a running instance):

```json
{ "error": "UNAUTHORIZED", "message": "Authentication required.", "ref": "225a9171-fa50-43b0-8fcd-243d46015bc4" }
```

Server logged, for that same request (stack trace elided):

```json
{"level":30,"correlation_id":"225a9171-fa50-43b0-8fcd-243d46015bc4","method":"POST","url":"/api/v1/reserves","msg":"request received"}
{"level":40,"correlation_id":"225a9171-fa50-43b0-8fcd-243d46015bc4","err":{"type":"UnauthorizedError","message":"Authentication required.","stack":"…"},"ref":"225a9171-fa50-43b0-8fcd-243d46015bc4","code":"UNAUTHORIZED","statusCode":401,"msg":"request failed"}
{"level":30,"correlation_id":"225a9171-fa50-43b0-8fcd-243d46015bc4","method":"POST","url":"/api/v1/reserves","status":401,"durationMs":6,"msg":"request completed"}
```

Three lines — **receive → fail → complete** — all keyed by the id the client was handed. The error
line carries the machine-readable `code`, the `statusCode`, and the full stack (server-side only; the
client never sees internals).

**Verify it yourself:**

```bash
curl -s -X POST http://localhost:5000/api/v1/reserves \
  -H 'Content-Type: application/json' -d '{"concertId":"00000000-0000-0000-0000-000000000000","seats":["A1"]}'
# take the "ref" from the response, then:
#   grep <ref> <your log stream>
```

Errors are uniform everywhere: **`{ error: CODE, message, ref }`**, mapped in one place
(`app.ts`) from a single `AppError` base — so a new domain error gets the right status and shape for
free. Tests: `tests/api/errorShape.test.ts`, `tests/api/correlationId.test.ts`.

---

## B. Request safety — reject early, expose nothing extra

**Captured** — a request with a bad enum _and_ an injected unknown key:

```
GET /api/v1/concerts?status=nope&evil=1
```

```json
{
    "error": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
        { "code": "invalid_union", "path": ["status"], "message": "Invalid input" },
        { "code": "unrecognized_keys", "keys": ["evil"], "path": [], "message": "Unrecognized key: \"evil\"" }
    ],
    "ref": "c3a86758-3ec7-45d3-83cd-0f902ea7fdf9"
}
```

Note `unrecognized_keys` — schemas are **`.strict()`**, so unknown input is **rejected**, not silently
stripped (OWASP API3, mass assignment). The controls:

| Control                 | How                                                                                                      | Evidence                           |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Strict input validation | one zod DTO per route drives `validate()` **and** the OpenAPI spec — docs can't drift                    | `requestSafety.test.ts`            |
| Response whitelisting   | mappers typed as `z.infer<schema>` — a leak is a **compile error**, not a runtime surprise               | `responseDto.test.ts`              |
| Body size caps          | per-route limits (16 kb writes, 1 MB seat import) → `413`, not a 500                                     | `requestSafety.test.ts`            |
| Rate limiting           | per-IP, per-endpoint counters (Redis-backed, in-memory fallback) → `429` + `Retry-After`; **fails open** | `rateLimit.test.ts`                |
| Security headers        | helmet, strict CSP; the inline-script exception is **scoped to the Swagger route only**                  | `requestSafety.test.ts`            |
| Identity                | never from the request body — always from the verified session token                                     | `reserve.test.ts`, `order.test.ts` |

---

## C. Concurrency — correctness under a stampede

The guarantees and where they're proven:

| Guarantee                               | Mechanism                                                                                                              | Test                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| A seat is never sold twice              | partial unique index `Uq_ticket_concert_seat … WHERE status='sold'` — the second `INSERT` **fails**, it can't be raced | `confirmOrder.test.ts`                  |
| A seat is never double-held             | partial unique index on `status='pending'`; cancelling a hold frees the seat automatically                             | `holdFlow.test.ts`                      |
| Multi-seat purchases are all-or-nothing | one transaction; a mid-order failure writes **nothing**                                                                | `confirmOrder.test.ts`                  |
| Only one confirm wins                   | compare-and-set `UPDATE … WHERE status='pending'`                                                                      | `confirmOrder.test.ts`                  |
| A retried payment never double-charges  | idempotent replay keyed on `orderId` — returns the **same tickets**                                                    | `confirmOrder.test.ts`, `order.test.ts` |
| The waiting room never over-admits      | atomic Lua promotion; cap holds under 20 simultaneous joins                                                            | `queueStore.test.ts`                    |

An experiment comparing **optimistic / pessimistic / atomic** locking under 25 concurrent buyers at
stock 5 (all correct; they differ in cost) — and why the seat path uses a **constraint** instead — is
written up in the README's "Concurrency control — three strategies".

**Load testing (not yet done).** The suite proves correctness under concurrency, not throughput. A
throughput baseline would be, e.g.:

```bash
npx autocannon -c 50 -d 30 http://localhost:5000/api/v1/concerts
```

Worth capturing before any capacity claim; nothing here asserts a req/s number.

---

## D. Ops — graceful shutdown drain

On `SIGTERM`/`SIGINT` the process **drains** instead of dropping connections:

1. **Flag draining** → `/health` immediately answers **`503 shutting_down`**, so a load balancer takes
   this instance out of rotation _before_ the socket closes. (New traffic goes elsewhere while
   in-flight work finishes — the step most "graceful shutdowns" forget.)
2. Stop background work — the reserve **sweeper** and the **socket server**.
3. `server.close()` — stop **accepting** new connections; let in-flight requests finish.
4. `server.closeIdleConnections()` — hang up **idle keep-alive** sockets, which would otherwise hold
   `close()` open for their full timeout even though they'll never send another byte.
5. Release the **DataSource + Redis**, exit `0`.
6. **Hard deadline** (`SHUTDOWN_TIMEOUT_MS`, default 5 s): if the drain overruns,
   `closeAllConnections()` and exit `1`. A stuck request must never block a deploy.

A second signal is ignored so the sequence can't restart mid-flight.

**Verify:** the readiness flip is asserted by `tests/api/health.test.ts`
("responds 503 shutting_down once a drain has begun").

For the full signal path, use a real POSIX signal:

```bash
docker compose up -d api
docker stop ticketing_system-api-1     # sends SIGTERM
docker logs ticketing_system-api-1 --tail 20
```

Expect:

```
shutdown: draining in-flight requests   (signal, timeoutMs)
shutdown: drained cleanly (Data Source + Redis closed)
```

> **Honest caveat — Windows.** This was _not_ captured live on Windows: Windows has no POSIX signals,
> so `process.kill(pid,'SIGTERM')` terminates the process unconditionally instead of delivering a
> catchable signal, and the handler never runs (verified — the process exited with no drain logs).
> The drain is exercised on Linux/Docker, which is where it matters (that's what `docker stop` and
> Kubernetes send). Keep `SHUTDOWN_TIMEOUT_MS` **below** the orchestrator's kill grace period
> (Docker's default is 10 s) or the platform will `SIGKILL` mid-drain.

---

## E. API documentation

Swagger UI: **`/api/v1/docs`** · raw spec: **`/api/v1/openapi.json`** (import into Postman/Insomnia).

The spec is **generated from the same zod DTOs the routes validate with**, so a documented request
shape cannot drift from what the API enforces — and `tests/api/docs.test.ts` asserts every mounted
path is documented and that the reserve schema matches the DTO. Tags: **Auth**, **Queue**,
**Concerts**, **Seats**, **Reserves**, **Orders**; protected operations declare `bearerAuth` /
`cookieAuth` and their `401`/`403` responses.

---

## Summary

| Phase                                                                               | Status                                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| A — Observability (correlation ids, structured logs, uniform error contract)        | ✅ captured above                                                           |
| B — Request safety (strict DTOs, response whitelisting, caps, rate limits, headers) | ✅ captured above                                                           |
| C — Concurrency (constraints, CAS, idempotency, queue admission)                    | ✅ test-backed                                                              |
| D — Graceful shutdown drain                                                         | ✅ implemented; readiness test-backed, signal path verified on Linux/Docker |
| E — Deliverables (this document)                                                    | ✅                                                                          |

Not claimed: a measured throughput/load baseline (see C).
