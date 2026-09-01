# 🎟️ Concert Ticketing System

[![CI](https://github.com/LuLuKar05/ticketing-system/actions/workflows/ci.yml/badge.svg)](https://github.com/LuLuKar05/ticketing-system/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-188%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
![Node.js](https://img.shields.io/badge/Node.js-26-339933)
![License](https://img.shields.io/badge/license-ISC-lightgrey)

A backend API for concert ticketing built around the hardest problem any ticketing platform faces: **two people must never end up owning the same seat** — while a buyer who has already reached checkout should never _lose_ their seat to someone faster.

It solves this with a **hard-hold, create-on-pay** reservation model in which seat exclusivity is **enforced by the database itself** (not by application-level checks that can race), purchases are **atomic and all-or-nothing**, abandoned holds are **automatically released**, and every seat-state change is **pushed to clients in real time over WebSockets**.

> This is a deep-dive learning project. The emphasis throughout is on three things that matter in real systems: **correctness under concurrency**, a **clean, testable layered architecture**, and a **thorough multi-layer automated test suite** (188 tests spanning unit, integration, and API).

---

## Table of contents

- [What it does](#what-it-does)
- [The core problem & the model](#the-core-problem--the-model)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Data model](#data-model)
- [Concurrency & correctness](#concurrency--correctness-the-heart-of-the-project)
- [Concurrency control — three strategies](#concurrency-control--three-strategies)
- [Request lifecycle, end to end](#request-lifecycle-end-to-end)
- [Observability & request safety](#observability--request-safety)
- [Getting started](#getting-started)
- [API reference](#api-reference)
- [Real-time (WebSockets)](#real-time-websockets)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Design decisions & trade-offs](#design-decisions--trade-offs)
- [Inventory & consistency model](#inventory--consistency-model)
- [Roadmap](#roadmap)
- ["What did you do on this project?"](#what-did-you-do-on-this-project--interview-summary)

---

## What it does

- **Browse concerts** and their **ticket tiers.** A concert has one or more tiers (e.g. _VIP_, _General_), each with its own **price**. A tier's **capacity is derived** from the seat catalog (`COUNT(seat)` in that tier) — there is no stored quantity to drift out of sync.
- **A seat catalog per concert.** An admin imports the venue **layout** (`POST /concerts/:id/seats`); every seat belongs to a tier. Clients fetch the **live seat map** (`GET /concerts/:id/seats`) — each seat reported as `available` / `held` / `sold` — as the baseline the WebSocket deltas apply to.
- **Hold specific seats** for a short window (a **5-minute TTL**). A hold is **exclusive** — while you hold seat `A10`, nobody else can hold _or_ buy it. This is the key UX difference from a naive "everyone competes, first-to-pay-wins" design, where you can enter your card details and still lose the seat.
- **Pay to convert holds into owned tickets.** A multi-seat order is **all-or-nothing**: if any one seat in the order can't be completed, the _entire_ purchase rolls back — you never get a half-finished order with 3 of 4 seats charged.
- **Automatic cleanup.** Holds that are never paid for expire, and a background **sweeper** cancels them and frees their seats — no manual intervention, no leaked inventory.
- **Live seat maps.** Every client viewing a concert receives real-time `held` / `sold` / `released` events for that concert's seats, so a seat greys out or frees up on everyone's screen the instant it changes.

---

## The core problem & the model

Ticketing is, at its core, a **concurrency** problem: many users compete for a small, fixed set of seats at the same instant. The naive approach — "read whether the seat is free, then mark it taken" — has a fatal race: two requests can both read _free_ before either writes _taken_. This project uses the model most production ticketing sites use, and pushes the correctness guarantee down into the database.

**Hard-hold · create-on-pay · assigned seats**

| Concept            | What it means                                                                                                                                                   | Why                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **Hard hold**      | Selecting a seat grants an _exclusive_ hold; others are blocked from it for the TTL.                                                                            | Buyers don't lose a seat after starting checkout.         |
| **Create-on-pay**  | A `Ticket` row exists **only when SOLD**. Unsold seats are not rows. During a hold, the seat identity `(concert, tier, seatNumber)` lives on the **`Reserve`**. | No placeholder inventory to pre-generate or keep in sync. |
| **Assigned seats** | Real seat labels (`A10`, `B5`), unique _per concert_.                                                                                                           | Matches how venues actually sell.                         |
| **Order**          | Groups the reserves/tickets of one purchase so payment is a single **all-or-nothing** unit.                                                                     | Multi-seat group bookings behave correctly.               |

The lifecycle of a seat:

```
select seats ──▶ HOLD   (create an Order + one PENDING Reserve per seat, 5-min TTL)
             ──▶ PAY    (create SOLD Tickets, confirm the Reserves)
             ──▶ EXPIRE (a sweeper cancels stale PENDING holds → the seat frees itself)
```

Because the hold's uniqueness index is **partial** (it only applies to `status='pending'`), simply flipping a hold to `cancelled` **frees the seat automatically** — there's no ticket to delete and no stock counter to restore, because **there is no stock counter at all**: capacity is derived from the seat catalog, and availability from the tickets/holds themselves. That self-freeing property is a direct payoff of the model.

---

## Architecture

A strict **layered architecture** — each layer depends only on the _interface_ of the layer directly beneath it, and no layer reaches past its neighbor.

```mermaid
flowchart TD
    Client([Client])
    subgraph Node["One Node process · one port"]
      direction TB
      Route["Route factory<br/>+ validate(zod DTO)"]
      Ctrl["Controller<br/>(throws domain errors)"]
      Svc["Service<br/>(business logic + transactions)"]
      Repo["Repository<br/>(manager-aware)"]
      ORM["TypeORM"]
      Bus["EventBus (singleton)"]
      Bridge["socket.io bridge"]
      Err["Central error middleware<br/>→ {error, message, ref}<br/>400/404/409/410/413/422/500"]
    end
    DB[("PostgreSQL")]
    WS([WebSocket clients<br/>room: concert:&lt;id&gt;])

    Client -->|HTTP request| Route --> Ctrl --> Svc --> Repo --> ORM --> DB
    Ctrl -. throws .-> Err -. JSON error .-> Client
    Svc == after commit ==> Bus --> Bridge -->|emit seat:held / sold / released| WS
```

The cross-cutting pieces that make this work:

- **Dependency injection (tsyringe).** Every class is `@injectable()` and depends on **interfaces** resolved by string tokens registered in `container.ts`. Because nothing news-up its own dependencies, tests can substitute fakes or a dedicated test database with zero changes to production code.
- **Route-factory pattern.** Routers and `createApp({ controllers })` receive their dependencies as **parameters** and never import the DI container. This decouples wiring from the app and lets the entire Express app be constructed in a test without a real server or DB.
- **Central error handling.** Services `throw` typed domain errors (`SeatsUnavailableError`, `NotFoundError`, `ReserveExpiredError`, …). A single 4-argument Express middleware maps each to the right HTTP status. Controllers therefore contain **no** try/catch and **no** HTTP-status logic — they just call a service and shape the success response.
- **Manager-aware repositories.** A repository method optionally accepts an `EntityManager`. Pass a transaction's manager and the write enlists in that transaction; omit it and the method runs standalone. This is what lets the codebase keep a clean repository layer _and_ get true atomicity across multiple writes.
- **EventBus → WebSockets.** After a transaction commits, a service publishes a domain event to an in-process **EventBus**; a socket.io **bridge** subscribes and forwards it to the concert's room. Services never import socket.io, which keeps them DB-focused and testable — and makes the bus a clean seam for a future CQRS read model.

---

## Tech stack

| Area                 | Choice                                          | Notes                                                    |
| -------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| Language / runtime   | **TypeScript**, **Node.js**                     | strict compiler settings                                 |
| HTTP framework       | **Express 5**                                   | native async error forwarding                            |
| ORM / database       | **TypeORM** + **PostgreSQL** (`pg`)             | migrations, `synchronize:false` in prod; row locks       |
| Dependency injection | **tsyringe** (`reflect-metadata`)               | interface tokens, singletons                             |
| Validation           | **zod**                                         | strict per-route DTOs (reject unknown) + `validate()`    |
| Real-time            | **socket.io**                                   | rooms per concert, env-driven CORS allowlist             |
| Logging              | **pino**                                        | structured JSON, correlation-id via AsyncLocalStorage    |
| Security             | **helmet**                                      | secure headers, strict CSP (scoped exception for docs)   |
| Rate limiting        | **rate-limiter-flexible** + **Redis** (ioredis) | per-IP, per-endpoint; in-memory fallback for tests       |
| API docs             | **swagger-ui-express** + **zod-openapi**        | OpenAPI 3.1 generated from the zod DTOs                  |
| Packaging            | **Docker** (multi-stage, alpine) + **compose**  | migrate-on-start, Postgres + Redis services, healthcheck |
| Testing              | **Jest** + **ts-jest** + **supertest**          | unit / integration / API                                 |
| Config               | **dotenv**                                      | `PORT`, `CORS_ORIGINS`, `LOG_LEVEL`, `LOG_PRETTY`        |

---

## Data model

```mermaid
erDiagram
    USER       ||--o{ ORDER      : places
    CONCERT    ||--o{ TICKETTIER  : offers
    ORDER      ||--o{ RESERVE     : "groups (holds)"
    ORDER      ||--o{ TICKET      : "groups (sold)"
    CONCERT    ||--o{ RESERVE     : for
    CONCERT    ||--o{ TICKET      : for
    TICKETTIER ||--o{ RESERVE     : "priced by"
    TICKETTIER ||--o{ TICKET      : "priced by"
    USER       ||--o{ RESERVE     : holds
    USER       ||--o{ TICKET      : owns
    CONCERT    ||--o{ SEAT        : "layout (catalog)"
    TICKETTIER ||--o{ SEAT        : "prices"

    CONCERT {
        uuid id PK
        string name
        int totalTickets
        bool oneTicketPerUser
        enum status "upcoming|ongoing|past|cancelled|rescheduled"
    }
    TICKETTIER {
        uuid id PK
        string name
        int price "minor units"
    }
    SEAT {
        uuid id PK
        string seatNumber "unique per concert"
        string section "nullable"
        string rowLabel "nullable"
    }
    ORDER {
        uuid id PK
        enum status "pending|confirmed|cancelled|failed"
        int totalAmount
    }
    RESERVE {
        uuid id PK
        string seatNumber
        enum status "pending|confirmed|cancelled"
        datetime expiresAt
    }
    TICKET {
        uuid id PK
        string seatNumber
        int pricePaid
        enum status "sold|cancelled|refunded"
    }
    USER {
        uuid id PK
        string email UK
        string password "select:false"
    }
```

Notes on the model:

- **`Reserve` and `Ticket` are siblings under `Order`** — a `Reserve` never points at a `Ticket`. Each independently carries its own seat identity `(concert, tier, seatNumber)`. At payment, a reserve's seat info is used to _create_ the matching ticket.
- **`Seat` is the catalog, never the state.** It stores the venue _layout_ (which seats exist, which tier each belongs to) — a seat's live status is always **derived**: `sold` if a Ticket exists, `held` if a pending Reserve exists, else `available`. Holding a seat resolves its tier **from the catalog, server-side** — the client sends only seat numbers, so it can't pick a cheaper tier for a seat. See [SEATMAP.md](./SEATMAP.md).
- Common columns (`id`, `createdAt`, `updatedAt`) are inherited from a shared **`AbstractEntity`**.
- Enums are stored as `varchar` (kept portable rather than as DB-native enum types, which are awkward to migrate); `seatNumber` is `varchar` so labels like `'A10'` work; money is stored as **integer minor units** to avoid floating-point drift.

**The two exclusivity guarantees — enforced by the database, not the app:**

| Index                      | Rule                                                              | Guarantees                           |
| -------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| `Uqi_reserve_concert_seat` | **UNIQUE** `(concertId, seatNumber)` **`WHERE status='pending'`** | at most **one active hold** per seat |
| `Uq_ticket_concert_seat`   | **UNIQUE** `(concertId, seatNumber)`                              | at most **one sale** per seat        |

The partial condition on the first index is what makes cancelled/expired holds stop blocking a seat — the moment a hold isn't `pending`, it leaves the index and the seat is free again.

---

## Concurrency & correctness (the heart of the project)

This is the part I'd most want to talk through in a review.

- **Exclusivity is the database's job, not the application's.** The app _does_ run pre-checks (`findHeldSeatNumbers`, `findSoldSeatNumbers`) — but only for **UX**, so it can report _all_ unavailable seats up front. The **authoritative** guard is the `INSERT` hitting a unique index. This matters because any "check then act" in application code has a **time-of-check-to-time-of-use** race: two requests can both pass the check before either writes. A unique constraint cannot be raced — the second `INSERT` simply fails, and the code maps that failure to a clean `409`.
- **Atomic, all-or-nothing operations.** Holding N seats (create the order + N reserves) and paying for N seats (create N tickets + confirm N reserves) each run inside a **single transaction** via `createQueryRunner`. A throw anywhere rolls the whole thing back — proven by tests that stub a mid-order failure and assert nothing was created.
- **Constraints over pessimistic locks — on purpose.** The database is **Postgres**, so row locks (`SELECT … FOR UPDATE`) _are_ available — the design still doesn't use them for the seat path. A seat is an **identity, not a counter** ([Concurrency control — three strategies](#concurrency-control--three-strategies)), so a **partial unique index** makes a double-sale a failed `INSERT` — race-proof with no lock held and no retry loop. Locks are the right tool for a contended mutable counter; a constraint is the right tool when the thing itself must be unique. The choice is deliberate, not a limitation of the engine.
- **Idempotent, single-winner confirm.** Paying for an order is guarded by a **compare-and-set**: `UPDATE "order" SET status='confirmed' WHERE id=:id AND status='pending'`. Of any concurrent confirms, exactly one wins the claim (1 row affected); the losers, and any retried/duplicated request (a refresh, a double-click, a client auto-retry), get the **same tickets replayed** rather than an error or a double-charge — `orderId` is the idempotency key. This makes "only one confirm wins" explicit at the order level instead of leaning on the seat index as an accidental backstop.
- **Emit after commit, never inside the transaction.** WebSocket events are published only _after_ the transaction commits (the `return` is moved past the `try/finally`, so it's reached only on success). A rollback therefore can never produce a false "seat sold" broadcast. A replayed (idempotent) confirm does _not_ re-broadcast.
- **Self-healing inventory.** A background **sweeper** (`setInterval`, 60s, guarded against overlapping runs, and wrapped so a failure never crashes the process) cancels expired PENDING holds in one transaction, then cancels any order left with no live holds. Because of the partial index, this **frees seats automatically**.

---

## Concurrency control — three strategies

The seat exclusivity above rests on a **unique constraint**, but that's only one of several ways to make concurrent writes safe. Before settling on it, I ran a small **experiment** to watch the three classic strategies behave under real contention and confirm which one actually fits ticketing. The prototype code is **not shipped** (it never belonged in the domain); what follows is the experiment, the measured result, and what it tells us.

**The experiment.** A single throwaway stock counter (`stock = 5`), hit by **25 simultaneous buyers** on real Postgres — five times the buyers than there is stock. For each strategy the question is the same: does it ever oversell, and what does it cost to guarantee that it doesn't?

### 1. Optimistic — compare-and-set on a version

Read the row and its `version`, decrement in memory, then write **only if nobody moved the row since the read**. A stale write matches zero rows, so we retry with a fresh read.

```ts
const item = await repo.findOneBy({ name }); // read stock + version
if (item.stock <= 0) throw new ConflictError('Sold out');
const result = await repo
    .createQueryBuilder()
    .update(DemoInventory)
    .set({ stock: item.stock - 1, version: item.version + 1 })
    .where('id = :id AND version = :version', { id: item.id, version: item.version })
    .execute();
if ((result.affected ?? 0) === 1) return { remaining: item.stock - 1 };
// affected 0 → someone else won the race; loop and re-read.
```

_Result:_ exactly **5 sold, 0 oversold**, the other 20 lost the compare-and-set and either retried into a sale or got a clean `409`. _What it tells us:_ correct, and cheap **when contention is low** — but a hot on-sale is exactly high contention, so the losers pile into retry storms. (Note: TypeORM's `@VersionColumn` on `save()` did **not** enforce the check in our version — silent last-write-wins — so the guarantee had to be written as an explicit `WHERE version = …`. A subtle failure mode worth knowing.)

### 2. Pessimistic — lock the row while you work

Inside a transaction, `SELECT … FOR UPDATE` locks the row; every other buyer's lock **waits** until this transaction commits, so buyers pass through one at a time.

```ts
await dataSource.transaction(async (manager) => {
    const item = await manager.findOne(DemoInventory, {
        where: { name },
        lock: { mode: 'pessimistic_write' }, // SELECT … FOR UPDATE
    });
    if (item.stock <= 0) throw new ConflictError('Sold out');
    item.stock -= 1;
    await manager.save(item);
});
```

_Result:_ exactly **5 sold, 0 oversold**, no wasted work — but the buyers were **serialized** on the hot row. _What it tells us:_ rock-solid and retry-free, at the cost of throughput bounded by one lock, and it's **Postgres-only** — SQLite has no row locks (the prototype threw `LockNotSupportedOnGivenDriverError`, which is itself a useful portability signal).

### 3. Atomic — let one statement do the check and the decrement

Skip read-modify-write entirely: a single conditional `UPDATE` checks and decrements indivisibly.

```ts
const result = await dataSource
    .createQueryBuilder()
    .update(DemoInventory)
    .set({ stock: () => 'stock - 1' })
    .where('name = :name AND stock > 0', { name })
    .execute();
if ((result.affected ?? 0) === 0) throw new ConflictError('Sold out'); // already 0
```

_Result:_ exactly **5 sold, 0 oversold**, no lock held and no retry loop. _What it tells us:_ when the operation really is "decrement one row if it's still positive," this is the simplest and fastest of the three — the database does the whole guard in one round trip.

### What the three runs measured

| Strategy    | Sold (200) | Rejected (409) | Final stock | Cost of the guarantee                         |
| ----------- | ---------- | -------------- | ----------- | --------------------------------------------- |
| Optimistic  | 5          | 20             | 0           | retry storms under high contention            |
| Pessimistic | 5          | 20             | 0           | buyers serialize on the lock; Postgres-only   |
| Atomic      | 5          | 20             | 0           | none beyond one round trip — when the op fits |

All three hold the line — **stock never went negative**. The difference is entirely in _how_ they pay for it.

### Why the real seat path uses none of these — it uses a fourth

Every strategy above manages a **shared mutable counter**. But a concert seat is not a counter — it's an **identity** ([Inventory & consistency model](#inventory--consistency-model)): there is no `stock` integer to lock, version, or conditionally decrement. So the project uses the tool that fits an identity — a **partial unique index**:

```sql
CREATE UNIQUE INDEX "Uq_ticket_concert_seat"
  ON ticket (concertId, seatId) WHERE status = 'sold';
```

A second sale of the same seat becomes a **failed `INSERT`**, not a lost race — race-proof on any engine, with no lock held, no retry loop, and no version column to reason about. The hold phase uses the same shape (`Uqi_reserve_concert_seat … WHERE status = 'pending'`). The experiment's lesson, applied: **optimistic / pessimistic / atomic are counter tools; a constraint is the identity tool** — and ticketing's unit of contention is an identity, so the constraint wins.

---

## Request lifecycle, end to end

A `POST /reserves` that hits an already-held seat, traced through every layer:

```mermaid
sequenceDiagram
    participant C as Client
    participant R as Route + validate(zod)
    participant Ctl as ReserveController
    participant S as ReserveService (txn)
    participant DB as PostgreSQL
    participant E as Error middleware

    C->>R: POST /reserves { userId, concertId, seats }
    R->>R: zod validation (400 if invalid)
    R->>Ctl: reserveTickets(req,res)
    Ctl->>S: reserveTickets({...})
    S->>DB: pre-check sold/held seats
    S->>DB: BEGIN; create Order; INSERT reserves
    DB-->>S: UNIQUE constraint failed (seat held)
    S->>DB: ROLLBACK
    S-->>Ctl: throw SeatsUnavailableError(['A1'],'held')
    Ctl-->>E: (error propagates)
    E-->>C: 409 { error:'SEATS_UNAVAILABLE', message, ref, seatNumbers:['A1'], reason:'held' }
```

---

## Observability & request safety

Every request is **traceable end to end**, and every input is **validated at the front gate** — the hardening you'd expect of a service that has to survive a high-traffic ticket drop.

### Traceability — one id from request → log → error

- **Correlation IDs.** A first-in-the-chain middleware gives every request an `X-Correlation-ID` — reused if the caller sent one (so a trace can span services), a generated UUID otherwise — and **echoes it on the response**.
- **Contextual logging (Pino).** The id lives in an `AsyncLocalStorage` request context, so the **structured JSON logger auto-stamps `correlation_id` on every line** — no service ever passes it around. Request receive/complete and all errors are logged; output is JSON by default (opt-in pretty via `LOG_PRETTY=true`), silent under tests.
- **Uniform error contract.** One global error middleware maps every domain error to `{ "error": "CODE", "message": "…", "ref": "<correlation-id>" }` and logs the stack. Because `ref` **is** the correlation id, a user-visible error links straight to its full server-side trace — grep one id, see the whole story. Each error carries its own `code` + HTTP status (an `AppError` base), so the mapper is a single branch, not a growing `instanceof` ladder.

### The front gate — OWASP-informed input hardening

- **Strict contract, enforced everywhere.** Every route validates against a zod schema (the same schemas that generate the OpenAPI), and the schemas are **`.strict()`** — unknown properties are **rejected** (`400`), not silently stripped (closes mass-assignment, OWASP **API3**).
- **Bounded inputs.** Field/array/string caps (e.g. ≤ 5 seats per hold) plus **per-endpoint body-size limits** (16 kB for holds/confirms, 1 MB for the bulk seat import → `413` beyond that) — no request can be unbounded (OWASP **API4**).
- **Secure headers (helmet).** Sane defaults on every response, including a **strict Content-Security-Policy** by default (so a future frontend is XSS-protected out of the box); the one page that needs a looser policy — Swagger UI — gets a **scoped** exception on its own route, never a global one (OWASP **API8**).

### The exit gate — whitelisted responses (never raw entities)

- **A separate response model.** Controllers return explicit **response DTOs**, never persistence entities — so relations (`ticket.user`, `ticket.ticketTier`) and internal columns (timestamps, a future `internal_note`/`version`) can't leak (OWASP **API3**, the exposure half).
- **Enforced by the type system.** Each mapper (`toOrder`, `toTicket`, …) returns `z.infer<responseSchema>`, so a mapper **physically cannot** return an undeclared field — a leak is a compile error, not a runtime surprise.
- **Same schema documents and serializes.** The response zod schemas both type the mappers **and** generate the OpenAPI response docs, so — exactly like the request side — the documented shape and the served shape can never drift.

### Abuse control — rate limiting + one-active-hold

Two distinct guards protect a high-traffic "ticket drop" (OWASP **API4/API6**):

- **Per-IP rate limiting** on the write endpoints (`POST /reserves`, `POST /orders/:id/confirm`, and the admin `POST /concerts/:id/seats`). A reusable middleware (`buildRateLimiter({ keyPrefix })`) gives each endpoint its **own counter** (default **5 requests / 60 s**). Over the limit → **`429`** + `Retry-After` (a payment endpoint returns an honest error, never a silent drop). It's a **rolling-counter window** (via `rate-limiter-flexible`): the counter is anchored to your first request and expires `duration` seconds later — so there's no shared clock boundary for everyone to burst against. **Redis-backed** in production (one shared counter across app instances, atomic via Redis Lua); an **in-memory** store under tests / when `REDIS_URL` is unset, so CI needs no Redis. **Fail-open**: if Redis is unreachable the request is allowed (a store outage can't take the endpoint down).
- **One active hold per user, per concert** (a _business_ rule, not a rate limit). A user may hold one order at a time for a concert — multiple seats in that one order are fine, a **second concurrent order is not** (`409`). It **self-clears** the moment they pay (reserves → `CONFIRMED`) or the 5-minute hold expires, because the check reads the reserve's own `status` + `expiresAt` — so it stays in sync with the hold TTL with no separate timer. This is the real anti-hoarding control; the IP limit is the anti-flood one.

---

## Getting started

### Prerequisites

- **Node.js** (a modern LTS) and **npm**, plus a **PostgreSQL** instance — or just **Docker**, which brings up Node, Postgres, and Redis together (see [Run with Docker](#run-with-docker)). The quickest local Postgres is `docker compose up -d postgres` (host port 5433).

### Install

```bash
npm install
```

### Configure

Create a `.env` file in the project root:

```env
# REQUIRED — Postgres is the only engine; the app fails fast at startup if this is unset.
DATABASE_URL=postgres://ticket:ticket@localhost:5433/ticketing
PORT=5000
# Comma-separated origins allowed to open a WebSocket connection.
# Empty = deny all cross-origin (production-safe default).
CORS_ORIGINS=http://localhost:5173,http://localhost:3000
# Log every SQL query (opt-in, dev only).
DB_LOGGING=true
```

### Database & migrations

The database is **PostgreSQL** (set via `DATABASE_URL`), configured with `synchronize: false` — all schema changes go through **migrations**, never auto-sync.

```bash
# create a migration from your current entity changes (pg dialect folder)
npm run migration:generate -- src/migrations/pg/MyChange

# apply migrations — BUILD FIRST (the migrations path points at compiled dist/)
npm run build && npm run migration:run

# roll back the most recent migration
npm run migration:revert
```

> **Why build-before-migrate:** the DataSource resolves migrations from `dist/migrations/**/*.js`, so `migration:run` executes the _compiled_ migration. `migration:generate`, on the other hand, reads the `.ts` entities directly and needs no build.

### Run

```bash
npm run dev                  # compile + watch + restart on change (development)
npm run build && npm start   # production

npm run typecheck            # tsc --noEmit (src)
npm run lint                 # ESLint (flat config, type-checked rules)
npm run format               # Prettier --write (format:check to verify only)
```

> All of these run in **CI** (`.github/workflows/ci.yml`, Node 26) on every push/PR to `main`:
> `npm ci → typecheck → lint → format:check → build → test`.

On startup the console shows the data source initialize, the HTTP server bind, the **sweeper** start, and the **WebSocket** server attach — all on the same port. `SIGINT`/`SIGTERM` trigger a **graceful shutdown** (stop the sweeper, close sockets, close the server, destroy the data source).

### Run with Docker

```bash
docker compose up --build    # build + migrate + serve on http://localhost:5000
```

- **Multi-stage image** (`Dockerfile`): a build stage compiles TypeScript; the runtime stage carries only production deps + `dist/`. Base is `node:26-alpine` — every runtime dependency is pure JS (no native toolchain), so the image stays small.
- **Compose brings up three services**: `api`, `postgres` (16-alpine), and `redis` (7-alpine). `api` waits on both healthchecks (`depends_on: condition: service_healthy`) before it starts.
- **Migrations run on startup** via `npm run migration:run:prod` (plain TypeORM CLI against the compiled `dist/data-source.js` — no ts-node in the image), then the container `exec`s into `node dist/server.js` so **SIGTERM reaches the app directly** and the graceful shutdown actually runs on `docker stop`.
- **Data persists** on the `ticket-pg` named volume (Postgres data dir). Remove it with `docker compose down -v` if you want a truly fresh database.
- **`GET /health`** is the liveness probe wired into the image's `HEALTHCHECK` (also handy for orchestrators/uptime monitors).
- Env (`DATABASE_URL`, `PORT`, `CORS_ORIGINS`, `DB_LOGGING`, `REDIS_URL`) is set in `docker-compose.yml`; per-query SQL logging is **opt-in** via `DB_LOGGING=true`.

---

## API reference

Base path: **`/api/v1`**. Success responses are JSON of the form `{ status, message, data? }`; **error responses** are uniform `{ error: "CODE", message, ref }` (where `ref` is the request's correlation id — see [Observability & request safety](#observability--request-safety)).

> **Interactive docs:** Swagger UI at **`/api/v1/docs`**, raw spec at **`/api/v1/openapi.json`** (import into Postman/Insomnia). The spec is **generated from the same zod DTOs the routes validate with** (`src/docs/openapi.ts`), so the documented request shapes cannot drift from what the API actually enforces — and a test asserts every mounted path is documented.

> **Auth:** the write endpoints require a **passkey (WebAuthn) session** — public-key credentials, no passwords. Register/log in at `/api/v1/auth/*`; login is **usernameless-capable** (email optional → discoverable passkeys / conditional-UI autofill), and the user is resolved from the passkey's credential id. A successful ceremony issues a **short-lived RS256 access JWT** + a **rotating refresh token** (both as httpOnly cookies **and** in the body — Bearer or cookie). `POST /auth/refresh` rotates the pair and **revokes the whole session family if a used token is replayed** (theft detection); `POST /auth/logout` revokes it. `requireAuth` derives the user from the verified access token (cookie **or** Bearer) — `userId` is never taken from the request body; the same verification runs on the **WebSocket handshake**. Users manage multiple devices via `/auth/credentials` (add/list/remove, with a last-passkey guard). Admin-only actions add `requireRole('admin')`; who is admin is the `ADMIN_EMAILS` allowlist, resolved server-side and signed into the token (never trusted from a client header).

### `GET /concerts` · `GET /concerts/:id`

List concerts (optionally filtered by `?status=`, validated against the status enum) and fetch a single concert by id (with its tiers).

### `GET /concerts/:id/seats` — the live seat map

The availability **read model**: the seat catalog merged with live state. Each seat comes back as `{ seatNumber, section, row, tier: { id, name, price }, status: 'available' | 'held' | 'sold' }` — the baseline a client renders, then applies the WebSocket deltas onto.

### `POST /concerts/:id/seats` — import a seat map (admin)

Full-replace of a concert's layout from one JSON document; each seat references its tier **by name**, resolved against that concert's tiers. Refused with `409` once any seat is sold or held. **Admin only** (`requireAuth` + `requireRole('admin')`): `401` without a session, `403` without the admin role.

```jsonc
// request
{ "seats": [ { "seatNumber": "A1", "section": "A", "row": "1", "tierName": "VIP" }, … ] }
```

### `POST /reserves` — hold seats

Seats are **seat numbers only** — each seat's tier (and price) is derived server-side from the seat catalog.

```jsonc
// request
{
  "userId": "<uuid>",
  "concertId": "<uuid>",
  "seats": ["A1", "A2"]
}
// 201 Created
{ "status": "success", "message": "Seats held successfully", "data": { "order": { "id": "…", "status": "pending" } } }
```

| Status | When                                                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`  | body fails validation (missing/invalid fields, empty or duplicate `seats`), or a seat isn't in the concert's catalog                                                                                          |
| `404`  | concert not found                                                                                                                                                                                             |
| `409`  | one or more seats already taken — `error: 'SEATS_UNAVAILABLE'`, body also includes `{ seatNumbers, reason: 'sold' \| 'held' }`; **or** you already have an active hold for this concert (`error: 'CONFLICT'`) |
| `429`  | too many requests from your IP (`error: 'RATE_LIMITED'`, `Retry-After` header)                                                                                                                                |
| `413`  | request body exceeds the endpoint's size limit                                                                                                                                                                |

### `POST /orders/:id/confirm` — pay

```jsonc
// request  { "userId": "<uuid>" }
// 200 OK
{ "status": "success", "message": "Order confirmed and tickets issued", "data": { "order": { "status": "confirmed", "totalAmount": 10000 }, "tickets": [ … ] } }
```

| Status | When                                                   |
| ------ | ------------------------------------------------------ |
| `400`  | invalid order id or body                               |
| `404`  | order not found                                        |
| `409`  | a seat was sold out from under the order (rolls back)  |
| `410`  | a hold in the order expired                            |
| `422`  | order not payable (e.g. already confirmed / cancelled) |
| `429`  | too many confirm attempts from your IP (`Retry-After`) |

---

## Real-time (WebSockets)

socket.io shares the same HTTP port as the REST API. A client **joins a per-concert room** and then receives that concert's seat-state events:

```js
const socket = io('http://localhost:5000');

socket.on('connect', () => socket.emit('join', { concertId: '<uuid>' }));

socket.on('seat:held', (d) => console.log('held', d)); // { concertId, seatNumbers }
socket.on('seat:sold', (d) => console.log('sold', d));
socket.on('seat:released', (d) => console.log('released', d));
```

- **`seat:held`** is emitted after a hold commits, **`seat:sold`** after a payment commits, **`seat:released`** after the sweeper frees expired holds.
- All events fire **after the transaction commits**, so a rollback never yields a false event.
- The **room** (`concert:<id>`) means a client only receives updates for the concert it's currently viewing.
- Origins allowed to connect are controlled by the `CORS_ORIGINS` allowlist.

---

## Testing

```bash
npm test    # Jest — 188 tests across three layers (requires a running Postgres)
```

- **Runner: Jest + ts-jest.** This is a deliberate, informed choice: ts-jest compiles with **`tsc`**, which emits the `emitDecoratorMetadata` that **TypeORM entities and tsyringe DI depend on** at runtime. esbuild-based runners (Vitest's default, `tsx`) **do not** emit that metadata, so DI resolution and entity mapping silently break under them. `tsconfig.test.json` overrides `module → commonjs` for Jest; `reflect-metadata` is loaded via `setupFiles`.
- **Test database: real Postgres + `synchronize:true` + `dropSchema`.** Tests run against a dedicated `ticketing_test` database (a `globalSetup` creates it and the `uuid-ossp` extension); each suite rebuilds a fresh schema directly from the entity decorators — **including the partial/unique indexes**, so exclusivity is genuinely exercised on the same engine production uses, not on a SQLite stand-in. Production stays `synchronize:false` (migrations only).
- **DI in tests.** A tsyringe **child container** (`tests/helpers/testContainer.ts`) mirrors production registration but is wired to the test DataSource, so tests resolve _real_ services/controllers against the Postgres test DB.

Three layers, each answering a different question:

| Layer           | Tooling                                                | Answers                                                                                                                                  |
| --------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **unit**        | `jest.fn()` mocks + a fake query-runner (no DB)        | _Is the branching and error-mapping logic correct?_ (UNIQUE → `SeatsUnavailableError`, expiry, rollback/commit, publish-only-on-success) |
| **integration** | real services/repos + real Postgres (`ticketing_test`) | _Do the transactions and DB constraints actually hold?_ (exclusivity, all-or-nothing, sold-race rollback, sweeper frees seats)           |
| **api**         | **supertest** against `createApp({...})` in-process    | _Does the HTTP contract match?_ (status codes, JSON shape, validation, error mapping)                                                    |

---

## Project structure

```
src/
  entities/        Concert · TicketTier · Seat · Order · Reserve · Ticket · User · AbstractEntity
  repositories/    data access (manager-aware: methods accept an EntityManager to join a txn)
  services/        ReserveService · TicketService · SeatService · SweeperService · EventBus · ConcertService
  controllers/     Concert · Reserve · Order · Seat  (throw domain errors; no HTTP-mapping logic)
  routes/          create*Router factories
  dtos/            zod schemas + inferred types
  docs/            openapi.ts — OpenAPI 3.1 document generated from the DTOs
  middleware/      validate() factory
  sockets/         socketServer.ts  (EventBus → socket.io bridge)
  migrations/      TypeORM migrations
  error.ts         typed domain errors
  app.ts           createApp() — routers + 404 + central error handler
  container.ts     tsyringe registrations
  data-source.ts   TypeORM DataSource
  server.ts        bootstrap: DB → DI → HTTP → sockets → sweeper → graceful shutdown
tests/
  unit/  integration/  api/  helpers/    (Jest + ts-jest + supertest)
deploy:
  Dockerfile         multi-stage build (compile → alpine runtime, migrate-on-start, healthcheck)
  docker-compose.yml api + postgres + redis services, env, Postgres named volume
  .dockerignore      keeps local db/node_modules/docs out of the build context
docs:
  README.md        this file
  CLAUDE.md        living architecture doc + phase-by-phase build log + deferred specs
  SEATMAP.md       seat-catalog design: derived status, import format, GA mode plan
  CODE_REVIEW.md   living review log: flaws, alternatives, trade-offs, resolution history
```

---

## Design decisions & trade-offs

Every significant choice was made deliberately, with the trade-off understood and documented:

- **Hard-hold vs. optimistic "first-to-pay-wins".** Chosen for the friendlier UX (no losing a seat after checkout). The cost — seats briefly locked by people who abandon checkout — is mitigated by the TTL and the sweeper.
- **Create-on-pay + a seat _catalog_, not seat _state_.** Tickets still exist only when SOLD — but "which seats exist" is now a stored **layout** (the `Seat` table), imported per concert. The catalog never stores availability; status stays _derived_ from sold tickets + pending holds. This closes seat validity, per-tier capacity, and the tier↔seat binding in one table without abandoning create-on-pay (see [SEATMAP.md](./SEATMAP.md)).
- **DB constraints vs. app-level locks/checks.** Unique indexes are race-proof and portable; app checks are only for UX. Even on Postgres — where row locks are available — a constraint is the right tool for a seat (an identity, not a counter), and it's the single most important correctness decision in the project.
- **EventBus abstraction vs. services calling socket.io directly.** Keeps services DB-focused and unit-testable, and turns the bus into the natural seam for a future CQRS read model — new subscribers can be added without touching services.
- **Manager-aware repositories.** Lets the codebase keep a clean repository layer _and_ still compose multiple writes into one atomic transaction — the alternative (raw `manager` calls scattered in services) would leak persistence concerns upward.
- **String DI tokens.** Simple and readable, but they trade compile-time safety for a small runtime risk (an early bug from a commented-out registration is documented in `CODE_REVIEW.md`); `Symbol`/`InjectionToken` constants are the hardening step.
- **PostgreSQL, single engine.** The app runs on Postgres in every environment — dev, test, and prod — so the concurrency guarantees the code relies on (real transactions, row locks where needed) are the same ones the tests exercise. There is no SQLite fallback: testing on one engine and shipping on another would defeat the point.

---

## Inventory & consistency model

Two foundational decisions shape how this system answers "how many seats are left?" and how it stays consistent when something fails mid-operation. Each has a well-established alternative; both alternatives are laid out here so the trade-off is explicit rather than implied.

### Availability — derived availability vs. a denormalized stock counter

**Denormalized stock counter.** Store a mutable integer (e.g. `availableStock`) on each concert or tier, decrement it on every hold/sale, and increment it on every release/expiry. Reads are O(1) — a single column — which is ideal for a high-traffic listing page. The cost is that the counter is a _second copy_ of a fact that already lives in the reservation and ticket rows: every path that claims or releases inventory must update it, inside the same transaction, or the number silently diverges from reality. One missed increment — a crash, an untested branch, a race — leaves it wrong permanently.

**Derived availability.** Store no number at all; compute it on read from the canonical rows: `available = COUNT(seat in tier) − COUNT(sold tickets) − COUNT(unexpired holds)`. There is exactly one source of truth (the actual seats, tickets, and holds), so the figure _cannot_ drift — by construction it is always whatever the rows say. The cost is read-time work: an aggregation instead of a column read, which for a long list of concerts means a `GROUP BY`/join (mitigated by the per-concert indexes, or a short-TTL cache if that read ever gets hot).

**This project uses derived availability.** Correctness is the entire point of a ticketing system — a stored number that can claim "3 left" when zero remain is worse than showing no number at all, and this codebase had already been bitten by exactly that drift when an earlier stored `availableTickets` column fell out of sync with reality. Trading a cheap O(1) read for a guaranteed-correct aggregation is the right call for inventory that must never oversell. Where read cost genuinely matters, the fix is to **cache** the derived value — never to reintroduce a mutable counter as the source of truth.

### Consistency under failure — atomic multi-row transaction vs. counter-mutation

Both patterns wrap the work in a single database transaction; they differ in _what_ is written atomically.

**Counter-mutation transaction.** In a stock-counter design a reservation is two writes — decrement the counter _and_ insert the reservation row — that must commit or roll back together. The correctness proof is: force the reservation insert to fail and show the counter is unchanged, i.e. no "phantom decrement" that leaks inventory.

**Atomic multi-row transaction (all-or-nothing).** With derived availability there is no counter to mutate; the reservation rows _are_ the inventory claim. A hold is therefore one order row plus N reserve rows written in one transaction, and a purchase is N ticket rows plus N reserve-status updates. The correctness proof is: force one row in the set to fail and show that _nothing_ was written — no order, no partial hold, no half-finished purchase. This is exactly what the `holdFlow` and `confirmOrder` tests assert.

**This project uses the atomic multi-row transaction** — the direct consequence of having no counter to protect. It is the _same_ ACID guarantee the counter proof demonstrates, expressed in the shape this data model actually takes.

**Known limitations & hardening (honest scope).** The guarantee above is exact within this project's runtime — a single-process app on Postgres, where the unique indexes are the cross-transaction backstop. A few things still want hardening before it runs as multiple app instances under heavy concurrency:

- **Row locking is available but unused by design.** Postgres offers `SELECT … FOR UPDATE`, but the seat path deliberately doesn't take it: a seat is an identity, so the partial unique index is the race-proof guard with no lock held ([Concurrency control — three strategies](#concurrency-control--three-strategies)). The lock is the documented tool for the few places that mutate a shared row (e.g. the order-status compare-and-set above).
- **The shipped suite doesn't stress-test concurrency.** The parallel-buyer experiment (25 simultaneous buys at stock 5) validated the locking strategies on real Postgres, but its throwaway harness isn't part of the committed suite — so the suite's concurrency guarantee is _architectural_ (the DB constraint), and the stress result lives in the writeup rather than in CI. Promoting a slimmed-down concurrency test into the suite is the next step.

---

## Roadmap

Fully specified in `CLAUDE.md`, deferred by choice:

- **Auth (Phase 6a — done):** **passkey (WebAuthn)** register + usernameless login → **RS256 access JWT + rotating refresh token** (reuse-detection) delivered as cookies + Bearer; `requireAuth`/`requireRole` derive identity + role from the verified token (also on the WebSocket handshake); multi-device passkey management; **email-OTP account recovery**; admins via an `ADMIN_EMAILS` allowlist.
- **Waiting-room queue (done):** Redis-backed (fail-open), per-concert (`gatedOnSale`) admission — a capped active set + FIFO line with atomic (Lua) slot-by-slot promotion; `requireActivePass` gates `POST /reserves` on gated concerts; a **"you're in" push** over the authenticated socket the moment you're promoted; the slot is **released on purchase**; an admin PATCH toggles gating. **Polish left:** per-waiter live position push (positions are polled today) and a `leave` endpoint.
- **Payment gateway (Phase 6b):** an `IPaymentGateway` abstraction (mock now, Stripe later); charge with an **idempotency key = `orderId`** _before_ issuing tickets, with a documented compensation path for the "charged but commit failed" edge.
- **Retention / purge:** a cron-scheduled job to archive/hard-delete old _terminal_ rows (distinct from the status-only sweeper), never touching audit-relevant `CONFIRMED`/`SOLD` records.
- **CQRS read model:** a transactional **outbox** + projectors behind the existing `EventBus` for fast, replayable read views.
- **Hardening:** `CHECK` constraints on enum columns; promote a concurrency stress test into the CI suite.

---

## "What did you do on this project?" — interview summary

> I built a **concert-ticketing backend in TypeScript** focused on the concurrency problem at the core of ticketing — never selling the same seat twice, without making a buyer lose a seat mid-checkout — and I made that correctness guarantee the **database's** responsibility rather than the application's.

**Things I can speak to in depth:**

- **Designed the reservation model** — a **hard-hold, create-on-pay** system with assigned seats and an `Order` that groups multi-seat purchases into a single **all-or-nothing** transaction.
- **Made correctness structural.** Seat exclusivity is enforced by **partial/unique indexes**, not application `if`-checks (which carry a time-of-check-to-time-of-use race). App-level pre-checks exist only to give the user a nice "these seats are taken" message; the unbreakable guard is the constrained `INSERT`.
- **Chose the right concurrency tool, and proved it.** The seat path uses **unique constraints + conditional writes** rather than pessimistic locks — even on Postgres, where locks are available — because a seat is an identity, not a counter. I validated the alternatives (optimistic / pessimistic / atomic) with a 25-concurrent-buyer experiment on real Postgres and wrote up why the constraint wins.
- **Built a clean, layered, DI-driven architecture** — Route → Controller → Service → Repository — with tsyringe, route factories, zod validation, and a single central error-handling middleware (controllers carry no try/catch).
- **Handled transactions correctly** using `createQueryRunner` and **manager-aware repositories**, so repository methods can enlist in a caller's transaction and every multi-write operation is atomic.
- **Added self-healing inventory** — a guarded background **sweeper** that expires abandoned holds; the partial index means cancelling a hold frees its seat with no extra work.
- **Delivered real-time updates** via an in-process **EventBus** that decouples services from **socket.io**, broadcasting seat events to per-concert rooms **after commit** — and I chose that abstraction deliberately as the seam for a future CQRS read model.
- **Wrote a genuine test suite** — **188 tests** across **unit** (mocked deps), **integration** (real Postgres), and **API** (supertest) — and diagnosed a real toolchain gotcha (esbuild runners don't emit decorator metadata, so I used **Jest + ts-jest**).
- **Practiced production hygiene** — migrations with a build-before-migrate workflow, graceful shutdown, env-driven config and a CORS allowlist, and living documentation (`CLAUDE.md`, `CODE_REVIEW.md`, this README).

**What I took away:** how to choose the _right_ concurrency primitive for the platform (DB constraint vs. lock vs. transaction), how to structure a codebase so it's testable by construction, and how to make **deliberate, documented trade-offs** rather than accidental ones.
